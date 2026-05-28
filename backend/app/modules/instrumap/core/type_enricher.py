"""
LLM-powered instrument type enricher.

Runs after InstrumentLogicEngine.get_epc_specs().  For every row where
IO_Type is still 'REVIEW' (or the description is unknown/low-confidence),
it asks the local Ollama LLM to classify the type code and returns a
refined description + IO classification.

Fully non-fatal — if Ollama is unavailable or any call fails the row
stays as-is.  Calls are made one at a time; with Qwen2.5:7b each takes
~2 s, so even 20 REVIEW instruments add ~40 s to the job.
"""
import logging
import re
import time
from typing import Optional, Tuple

import pandas as pd

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

_MIN_CONFIDENCE = 0.50

_SYSTEM_PROMPT = (
    "You are a senior P&ID instrument engineer specialising in oil & gas. "
    "Classify instrument type codes per ISA-5.1 and common project conventions. "
    "Respond only with a single compact JSON object."
)

# Regex that identifies OCR noise / annotation fragments — never send to LLM
_NOISE_RE = re.compile(
    r"^(NOTE|I|S|R|TT|CC\d|[A-Z][-_]\d|[A-Z]{1,2}\d)$", re.IGNORECASE
)

# IO_Type values that signal "needs enrichment"
_REVIEW_IO = {"REVIEW"}

# IO_Type values already considered settled — leave alone
_SETTLED_IO = {"AI", "AO", "DI", "DO", "Soft Link", ""}

# Programmatic signal/power derivation from io_type so LLM doesn't need to know
_IO_SIGNAL = {
    "AI": ("4-20mA + HART", "24VDC (Loop Powered)"),
    "AO": ("4-20mA", "Loop Powered"),
    "DI": ("24VDC (Dry Contact)", "24VDC"),
    "DO": ("24VDC", "24VDC"),
    "Soft Link": ("", ""),
    "": ("", ""),
}

# Known X-prefix codes to help the small 7B model
_X_TYPE_HINTS = (
    "Common project-specific type codes in oil & gas:\n"
    "  XFD  = Fault Display (DCS soft screen indicator, Soft Link)\n"
    "  XTGD = Tag Group Display (DCS soft screen group, Soft Link)\n"
    "  XTGA = Tag Group Alarm (DCS alarm group, Soft Link)\n"
    "  XGA  = Position / Status Display (Soft Link)\n"
    "  XMCA = Motor Control Actuator status (DCS Soft Link)\n"
    "  XI   = Miscellaneous Indicator (DCS Soft Link)\n"
    "  XA   = Miscellaneous Alarm (DCS Soft Link)\n"
    "  PPHS = Pump/Position High Speed Switch (DI, SIS/ESD)\n"
    "  CVZI = Control Valve Zero/Isolation Indicator (Soft Link)\n"
    "  EI   = Electrical Indicator (Soft Link)\n"
    "  SY   = Solenoid Valve (DO, DCS)\n"
    "  CC   = Combustion / Condition Controller (Soft Link or AI)\n"
    "  TP   = Test Point (field tap, no signal, IO='', System='')\n"
    "  SVZA = Safety Valve ZA position (DI, SIS/ESD)\n"
    "  SVHC = Safety Valve Hydraulic Close (DO, SIS/ESD)\n"
    "  SVHO = Safety Valve Hydraulic Open (DO, SIS/ESD)\n"
    "  HSD  = Hand Switch (Shutdown, DI)\n"
    "  PSAH = Pressure Switch Alarm High (DI)\n"
    "  PSAL = Pressure Switch Alarm Low (DI)\n"
    "  PSDH = Pressure Switch Differential High (DI)\n"
    "  PSDL = Pressure Switch Differential Low (DI)\n"
    "  SZSH = Safety Position Switch High/Open (DI, SIS/ESD)\n"
    "  SZSL = Safety Position Switch Low/Closed (DI, SIS/ESD)\n"
    "  SZIH = Safety Position Indicator High (Soft Link, SIS/ESD)\n"
    "  SZIL = Safety Position Indicator Low (Soft Link, SIS/ESD)\n"
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _needs_enrichment(row: pd.Series) -> bool:
    """Return True if this row should be sent to the LLM."""
    tag = str(row.get("Tag_Number", "")).strip()
    if not tag or _NOISE_RE.match(tag):
        return False
    io_type = str(row.get("IO_Type", "")).strip()
    if io_type not in _REVIEW_IO:
        return False
    desc = str(row.get("Instrument_Description", "")).strip()
    if desc in ("Unknown Instrument", "") or desc.endswith("(?)"):
        return True
    if io_type in _REVIEW_IO:
        return True
    return False


def _build_prompt(tag: str, instr_type: str, loop: str) -> str:
    context = f"Loop/system: {loop}" if loop and loop != "nan" else ""
    return (
        f"Classify this P&ID instrument:\n"
        f"  Tag:  {tag}\n"
        f"  Code: {instr_type}\n"
        f"  {context}\n\n"
        f"{_X_TYPE_HINTS}\n"
        f"Return ONLY this JSON (no extra text):\n"
        f'{{"description": "<concise name>", '
        f'"io_type": "<AI|AO|DI|DO|Soft Link|>", '
        f'"system": "<DCS|SIS/ESD|>", '
        f'"confidence": <0.0-1.0>}}'
    )


def _derive_signal(io_type: str) -> Tuple[str, str]:
    """Return (signal_type, power_supply) from io_type."""
    return _IO_SIGNAL.get(io_type, ("", ""))


def _call_llm(tag: str, instr_type: str, loop: str, model: str) -> Optional[dict]:
    """Query Ollama for one instrument. Returns parsed dict or None."""
    try:
        from app.modules.llm.service import generate
        prompt = _build_prompt(tag, instr_type, loop)
        result = generate(prompt, model=model, system=_SYSTEM_PROMPT)
        return result
    except Exception as exc:
        logger.debug("LLM type enricher call failed for %s: %s", tag, exc)
        return None


def _apply_result(df: pd.DataFrame, idx, result: dict) -> bool:
    """
    Write LLM result back into the dataframe row.
    Returns True if the result was accepted (confidence >= threshold).
    """
    confidence = float(result.get("confidence", 0.0))
    if confidence < _MIN_CONFIDENCE:
        return False

    description = str(result.get("description", "")).strip()
    io_type = str(result.get("io_type", "")).strip()
    system = str(result.get("system", "")).strip()

    if not description:
        return False

    # Normalise io_type to one of the settled values
    if io_type not in _SETTLED_IO:
        io_type = "Soft Link"

    signal_type, power_supply = _derive_signal(io_type)

    df.at[idx, "Instrument_Description"] = description
    df.at[idx, "IO_Type"] = io_type
    df.at[idx, "System"] = system
    df.at[idx, "Signal_Type"] = signal_type
    df.at[idx, "Power_Supply"] = power_supply
    df.at[idx, "Confidence"] = f"LLM ({confidence:.0%})"
    return True


# ── Public API ────────────────────────────────────────────────────────────────

def enrich_review_types(
    df: pd.DataFrame,
    model: str = "qwen2.5:7b",
) -> pd.DataFrame:
    """
    Attempt LLM classification for every row with IO_Type='REVIEW'.

    Args:
        df    : master instruments DataFrame after programmatic classification
        model : Ollama model name

    Returns:
        Modified copy of df with enriched rows.
    """
    df = df.copy()

    # Check availability once — avoid repeated network calls
    try:
        from app.modules.llm.service import _is_available
        if not _is_available(model):
            logger.info("TypeEnricher: Ollama/%s not available — skipping", model)
            return df
    except Exception:
        return df

    candidates = [idx for idx, row in df.iterrows() if _needs_enrichment(row)]
    if not candidates:
        logger.info("TypeEnricher: no REVIEW instruments to enrich")
        return df

    logger.info("TypeEnricher: enriching %d REVIEW instruments via %s", len(candidates), model)

    enriched = 0
    for idx in candidates:
        row = df.loc[idx]
        tag = str(row.get("Tag_Number", "")).strip()
        instr_type = str(row.get("Type", "")).strip()
        loop = str(row.get("Loop", "")).strip()

        t0 = time.monotonic()
        result = _call_llm(tag, instr_type, loop, model)
        elapsed = (time.monotonic() - t0) * 1000

        if result is None:
            logger.debug("TypeEnricher: no result for %s (%.0f ms)", tag, elapsed)
            continue

        accepted = _apply_result(df, idx, result)
        logger.debug(
            "TypeEnricher: %s → %s / %s (conf=%.2f, %.0f ms, %s)",
            tag,
            result.get("description", ""),
            result.get("io_type", ""),
            float(result.get("confidence", 0)),
            elapsed,
            "accepted" if accepted else "rejected",
        )
        if accepted:
            enriched += 1

    logger.info("TypeEnricher: enriched %d/%d REVIEW instruments", enriched, len(candidates))
    return df
