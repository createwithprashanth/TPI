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

_PRIMARY_MODEL  = "xyra-pid-engineer"   # custom model with ISA-5.1 knowledge
_FALLBACK_MODEL = "qwen2.5:7b"          # plain base model if custom not built yet

_MIN_CONFIDENCE = 0.50

# Regex that identifies OCR noise / annotation fragments — never send to LLM
_NOISE_RE = re.compile(r"^(NOTE[-_]|[A-Z]{1,2}$)", re.IGNORECASE)

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
    """Return the best available Ollama model."""
    try:
        from app.modules.llm.service import _is_available
        if _is_available(_PRIMARY_MODEL):
            return _PRIMARY_MODEL
        if _is_available(_FALLBACK_MODEL):
            return _FALLBACK_MODEL
    except Exception:
        pass
    return ""


def _needs_enrichment(row: pd.Series) -> bool:
    tag = str(row.get("Tag_Number", "")).strip()
    if not tag or _NOISE_RE.match(tag):
        return False
    io_type = str(row.get("IO_Type", "")).strip()
    return io_type in _REVIEW_IO


def _build_prompt(tag: str, instr_type: str, loop: str) -> str:
    """
    Minimal prompt — the ISA-5.1 knowledge is baked into the model's
    system context via the Modelfile, so we only need to supply the tag.
    """
    ctx = f"\nLoop/system context: {loop}" if loop and loop not in ("nan", "") else ""
    return (
        f"Classify this P&ID instrument tag:\n"
        f"  Tag:       {tag}\n"
        f"  Type code: {instr_type}{ctx}\n\n"
        f"Return ONLY the JSON object."
    )


def _derive_signal(io_type: str) -> Tuple[str, str]:
    return _IO_SIGNAL.get(io_type, ("", ""))


def _call_llm(tag: str, instr_type: str, loop: str, model: str) -> dict | None:
    try:
        from app.modules.llm.service import generate
        result = generate(_build_prompt(tag, instr_type, loop), model=model)
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

def enrich_review_types(df: pd.DataFrame) -> pd.DataFrame:
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
        result = _call_llm(tag, instr_type, loop, model)
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
