"""
LLM-powered instrument type enricher.

Runs after InstrumentLogicEngine.get_epc_specs().  For every row where
IO_Type is still 'REVIEW' (or the description is unknown/low-confidence),
queries the xyra-pid-engineer Ollama model (built on qwen2.5:7b + full
ISA-5.1 knowledge base) for a refined classification.

Fully non-fatal — if Ollama is unavailable or any call fails the row
stays as-is.  Calls are made one at a time.
"""
import logging
import re
import time
from typing import Tuple

import pandas as pd

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

_PRIMARY_MODEL  = None   # resolved at runtime from env via _resolve_model()
_FALLBACK_MODEL = None   # resolved at runtime from env via _resolve_model()

_MIN_CONFIDENCE = 0.50

# Regex that identifies OCR noise / annotation fragments — never send to LLM,
# and never inject ISA letter decodes for these (they would mislead the model).
_NOISE_RE = re.compile(
    r"^(?:"
    r"NOTE[-_\d]"                                   # NOTE-1, NOTE-5R
    r"|[A-Za-z]{1,5}$"                              # A, I, CC, PIT, FIT, TIT (bare 1-5 letters — legend entries)
    r"|[A-Z]-[A-Za-z]$"                             # S-R, R-S (flip-flop symbols)
    r"|[A-Z]-\d"                                    # V-201, P-101 (single-letter equip tag)
    r"|[A-Za-z]\d+$"                                # P1, R1 (letter + digits only)
    r"|(?:REV|HOLD|DRG|MTO|VFD|PLC|MCC)(?:-|$)"   # known non-instruments
    r")",
    re.IGNORECASE,
)

# ISA-5.1 first-letter decode — injected into the prompt to avoid base-weight
# confusion (VT→Temperature, ST→Temperature Switch, etc.)
_ISA_FIRST = {
    "A": "Analysis", "B": "Burner/Combustion", "C": "Conductivity",
    "D": "Density", "E": "Voltage", "F": "Flow",
    "G": "Gauging/Glass", "H": "Hand/Manual", "I": "Current (electrical)",
    "J": "Power", "K": "Time/Schedule", "L": "Level",
    "M": "Moisture/Humidity", "N": "User-defined", "O": "User-defined",
    "P": "Pressure", "Q": "Quantity/Totalizer", "R": "Radiation",
    "S": "Speed/Frequency", "T": "Temperature", "U": "Multivariable",
    "V": "Vibration/Mechanical", "W": "Weight/Force", "X": "Unclassified/Project-specific",
    "Y": "Event/Relay/Converter", "Z": "Position/Stroke",
}

# ISA-5.1 last-letter (function) decode — injected when the final letter of the
# type code could be ambiguous (T after V or S is Transmitter, not Temperature/Switch)
_ISA_LAST = {
    "T": "Transmitter (physical field device, outputs 4-20mA)",
    "E": "Element/Sensor (passive — no standalone electrical output)",
    "W": "Well/Thermowell (passive mechanical fitting)",
    "C": "Controller (DCS software block)",
    "S": "Switch (discrete physical contact)",
    "V": "Valve (final control element)",
    "I": "Indicator (display)",
    "A": "Alarm (DCS software setpoint)",
    "R": "Recorder (DCS historian)",
    "Y": "Relay/Converter/Solenoid",
    "Z": "Driver/Actuator",
    "G": "Gauge/Sight Glass (mechanical, no electrical output)",
    "O": "Orifice/Restriction",
}

# IO_Type values that need enrichment
_REVIEW_IO = {"REVIEW"}

# IO_Type values already settled — leave alone
_SETTLED_IO = {"AI", "AO", "DI", "DO", "Soft Link", ""}

# Programmatic signal/power derivation from io_type
_IO_SIGNAL: dict = {
    "AI":        ("4-20mA + HART",       "24VDC (Loop Powered)"),
    "AO":        ("4-20mA",              "Loop Powered"),
    "DI":        ("24VDC (Dry Contact)", "24VDC"),
    "DO":        ("24VDC",               "24VDC"),
    "Soft Link": ("",                    ""),
    "":          ("",                    ""),
}

# Valid system values the LLM may return
_VALID_SYSTEMS = {"DCS", "SIS/ESD", "F&GS", ""}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _resolve_model() -> str:
    """Return the best available Ollama model for instrument classification."""
    try:
        from app.modules.llm.service import _is_available, INSTRUMENT_MODEL, INSTRUMENT_MODEL_FALLBACK
        if _is_available(INSTRUMENT_MODEL):
            return INSTRUMENT_MODEL
        if _is_available(INSTRUMENT_MODEL_FALLBACK):
            return INSTRUMENT_MODEL_FALLBACK
    except Exception:
        pass
    return ""


def _needs_enrichment(row: pd.Series) -> bool:
    tag = str(row.get("Tag_Number", "")).strip()
    if not tag or _NOISE_RE.match(tag):
        return False
    io_type = str(row.get("IO_Type", "")).strip()
    return io_type in _REVIEW_IO


def _build_prompt(tag: str, instr_type: str, loop: str, project_legend_notes: str | None = None) -> str:
    """
    Decode first letter, last letter, and HH/LL qualifier explicitly so the
    model doesn't have to recall any ISA-5.1 rule from base weights.
    """
    from app.modules.instrumap.core.project_legend import build_legend_prompt_block

    code  = instr_type.upper()
    legend_block = build_legend_prompt_block(project_legend_notes)

    # For noise-pattern tags skip ISA letter decode entirely — injecting
    # "A = Analysis" would override the system-prompt noise rules and cause
    # the model to classify equipment tags / fragments as instruments.
    if _NOISE_RE.match(tag):
        ctx = f"  Loop/system: {loop}\n" if loop and loop not in ("nan", "") else ""
        return (
            f"{legend_block}"
            f"Classify P&ID tag {tag} (type code: {code}).\n"
            f"{ctx}"
            f"Return ONLY the JSON object."
        )

    first = code[0] if code else ""
    last  = code[-1] if len(code) > 1 else ""

    first_line = (f"  First letter {first} = {_ISA_FIRST[first]} (ISA-5.1 measured variable)\n"
                  if first in _ISA_FIRST else "")
    last_line  = (f"  Last letter  {last} = {_ISA_LAST[last]} (ISA-5.1 function)\n"
                  if last in _ISA_LAST and last != first else "")

    # Decode HH / LL safety qualifiers explicitly
    qualifier = ""
    if code.endswith("HH"):
        qualifier = "  Suffix HH = High High (second-level safety trip, System=SIS/ESD)\n"
    elif code.endswith("LL"):
        qualifier = "  Suffix LL = Low Low (second-level safety trip, System=SIS/ESD)\n"
    elif code.endswith("H") and not code.endswith("HH"):
        qualifier = "  Suffix H = High (first-level alarm or trip)\n"
    elif code.endswith("L") and not code.endswith("LL") and not code.endswith("AL"):
        qualifier = "  Suffix L = Low (first-level alarm or trip)\n"

    ctx = f"  Loop/system: {loop}\n" if loop and loop not in ("nan", "") else ""

    return (
        f"{legend_block}"
        f"Classify P&ID tag {tag} (type code: {code}).\n"
        f"{first_line}"
        f"{last_line}"
        f"{qualifier}"
        f"{ctx}"
        f"Return ONLY the JSON object."
    )


def _derive_signal(io_type: str) -> Tuple[str, str]:
    return _IO_SIGNAL.get(io_type, ("", ""))


def _call_llm(tag: str, instr_type: str, loop: str, model: str, project_legend_notes: str | None = None) -> dict | None:
    try:
        from app.modules.llm.service import generate
        result = generate(_build_prompt(tag, instr_type, loop, project_legend_notes), model=model)
        return result
    except Exception as exc:
        logger.debug("TypeEnricher LLM call failed for %s: %s", tag, exc)
        return None


def _apply_result(df: pd.DataFrame, idx, result: dict) -> bool:
    """Write LLM result back. Returns True if accepted."""
    confidence = float(result.get("confidence", 0.0))
    if confidence < _MIN_CONFIDENCE:
        return False

    description = str(result.get("description", "")).strip()
    io_type     = str(result.get("io_type", "")).strip()
    system      = str(result.get("system", "")).strip()

    if not description:
        return False

    # Normalise io_type
    if io_type not in _SETTLED_IO:
        io_type = "Soft Link"

    # Normalise system
    if system not in _VALID_SYSTEMS:
        system = "DCS"

    signal_type, power_supply = _derive_signal(io_type)

    df.at[idx, "Instrument_Description"] = description
    df.at[idx, "IO_Type"]                = io_type
    df.at[idx, "System"]                 = system
    df.at[idx, "Signal_Type"]            = signal_type
    df.at[idx, "Power_Supply"]           = power_supply
    df.at[idx, "Confidence"]             = f"LLM ({confidence:.0%})"

    # F&G detectors are area monitors — not connected to a process pipe.
    # Clear any Connected_Line that geometry/proximity may have assigned.
    if system == "F&GS" and "Connected_Line" in df.columns:
        df.at[idx, "Connected_Line"] = ""

    return True


# ── Public API ────────────────────────────────────────────────────────────────

def enrich_review_types(df: pd.DataFrame, project_legend_notes: str | None = None) -> pd.DataFrame:
    """
    Attempt LLM classification for every row with IO_Type='REVIEW'.

    Uses xyra-pid-engineer (custom ISA-5.1 model) if available, falls back
    to qwen2.5:7b.  Returns unchanged df if Ollama is offline.
    """
    df = df.copy()

    model = _resolve_model()
    if not model:
        logger.info("TypeEnricher: Ollama not available — skipping")
        return df

    candidates = [idx for idx, row in df.iterrows() if _needs_enrichment(row)]
    if not candidates:
        logger.info("TypeEnricher: no REVIEW instruments to enrich")
        return df

    logger.info(
        "TypeEnricher: enriching %d REVIEW instruments via %s",
        len(candidates), model,
    )

    enriched = 0
    for idx in candidates:
        row        = df.loc[idx]
        tag        = str(row.get("Tag_Number", "")).strip()
        instr_type = str(row.get("Type", "")).strip()
        loop       = str(row.get("Loop", "")).strip()

        t0     = time.monotonic()
        result = _call_llm(tag, instr_type, loop, model, project_legend_notes)
        elapsed_ms = (time.monotonic() - t0) * 1000

        if result is None:
            logger.debug("TypeEnricher: no result for %s (%.0f ms)", tag, elapsed_ms)
            continue

        accepted = _apply_result(df, idx, result)
        logger.debug(
            "TypeEnricher: %s → '%s' / io=%s / sys=%s (conf=%.2f, %.0f ms, %s)",
            tag,
            result.get("description", ""),
            result.get("io_type", ""),
            result.get("system", ""),
            float(result.get("confidence", 0)),
            elapsed_ms,
            "accepted" if accepted else "rejected",
        )
        if accepted:
            enriched += 1

    logger.info(
        "TypeEnricher: enriched %d / %d REVIEW instruments", enriched, len(candidates)
    )
    return df
