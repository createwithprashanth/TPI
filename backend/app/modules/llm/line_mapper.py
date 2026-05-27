"""
LLM-powered instrument-to-line mapper (Level 4 — OCR / scanned PDF path).

Sits after geometry-based mapping. For each instrument that still has no
Connected_Line, it:
  1. Finds the N nearest line numbers by pixel-space Euclidean distance.
  2. Builds a compact P&ID-context prompt.
  3. Calls Qwen2.5 7B via Ollama (JSON-forced output).
  4. Accepts the answer only when confidence >= MIN_CONFIDENCE.

Adds three columns to the instruments DataFrame:
  - Connected_Line   (str)   — line number, empty if no confident match
  - Line_Confidence  (float) — 0.0–1.0 from the model
  - Line_Reason      (str)   — one-sentence model explanation
"""
import logging
import math
from typing import Optional

import pandas as pd

from .service import generate, _is_available

logger = logging.getLogger(__name__)

# How many nearest line candidates to present to the model
_MAX_CANDIDATES = 8

# Only accept model answer if confidence exceeds this threshold
_MIN_CONFIDENCE = 0.55

# Instrument type letter → human-readable description (ISA 5.1)
_TYPE_DESC = {
    "F": "flow", "P": "pressure", "T": "temperature", "L": "level",
    "A": "analysis", "V": "valve / control", "S": "speed / switch",
    "I": "indicator", "C": "controller", "R": "recorder",
    "E": "element / sensor", "Y": "relay / converter", "Z": "actuator / drive",
    "H": "hand / manual", "G": "gauge", "Q": "integrator / totalizer",
    "W": "well / thermowell", "X": "unclassified",
}

_SYSTEM_PROMPT = (
    "You are a senior P&ID (Process & Instrumentation Diagram) engineer. "
    "Your job is to identify which pipe line a field instrument is connected to, "
    "using spatial proximity and engineering knowledge. "
    "Always respond with a single JSON object and nothing else."
)


def _instrument_type_desc(tag: str) -> str:
    """Extract first letter after area code digits and return human description."""
    # Tag format: AREA-FTIC-1234 or FT-1234 or 101-PT-202
    import re
    m = re.search(r'[A-Z]{1,2}[FCPTLASIVREYZGHQWX]', tag.upper())
    if m:
        letters = m.group(0)
        first_func = letters[-1]
        return _TYPE_DESC.get(first_func, "instrument")
    return "instrument"


def _parse_coords(coord_str: str) -> Optional[tuple]:
    """Parse 'x,y' string to (int, int), return None on failure."""
    try:
        parts = coord_str.split(",")
        return int(float(parts[0])), int(float(parts[1]))
    except Exception:
        return None


def _dist(ax, ay, bx, by) -> float:
    return math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)


def _build_prompt(
    tag: str,
    ix: int,
    iy: int,
    candidates: list,   # list of (line_number, lx, ly, dist, pipe_size, fluid_code)
) -> str:
    inst_type = _instrument_type_desc(tag)
    cand_lines = []
    for i, (ln, lx, ly, d, size, fluid) in enumerate(candidates, 1):
        cand_lines.append(
            f"  {i}. {ln}  (distance={d:.0f}px, size={size}\", fluid={fluid}, "
            f"position=({lx},{ly}))"
        )

    candidates_text = "\n".join(cand_lines) if cand_lines else "  (none found)"

    return (
        f"Instrument tag: {tag}\n"
        f"  Function: {inst_type}\n"
        f"  Position on drawing: ({ix}, {iy})\n\n"
        f"Nearby pipe lines (sorted nearest first):\n"
        f"{candidates_text}\n\n"
        f"Which pipe line is this instrument most likely connected to?\n\n"
        f"Engineering notes:\n"
        f"- Flow instruments (FT, FIC, FE…) measure flow in a specific pipe.\n"
        f"- Pressure/Temperature instruments tap directly off the process line.\n"
        f"- Valve instruments (FV, PV, TV…) are installed IN the pipe line they control.\n"
        f"- A closer line is usually correct, but favour matching fluid/size when ambiguous.\n\n"
        f"Respond ONLY with this JSON:\n"
        f'  {{"line_number": "<line or empty>", "confidence": <0.0-1.0>, "reason": "<one sentence>"}}'
    )


def map_instruments_to_lines_llm(
    instruments_df: pd.DataFrame,
    lines_df: pd.DataFrame,
    status_fn=None,
    model: str = "qwen2.5:7b",
) -> pd.DataFrame:
    """
    Augment instruments_df with LLM-derived line assignments.

    Only processes rows where Connected_Line is absent or empty.
    Returns the modified DataFrame (new columns added in-place).
    """

    def _log(msg):
        logger.info(msg)
        if status_fn:
            status_fn(msg)

    # Ensure output columns exist
    for col, default in [("Connected_Line", ""), ("Line_Confidence", 0.0), ("Line_Reason", "")]:
        if col not in instruments_df.columns:
            instruments_df[col] = default

    if lines_df.empty:
        _log("LLM line mapper: no line numbers found on this page — skipping.")
        return instruments_df

    if not _is_available(model):
        _log(f"LLM line mapper: Ollama/{model} not available — skipping.")
        return instruments_df

    # Pre-parse line coordinates
    line_records = []
    for _, row in lines_df.iterrows():
        coords = _parse_coords(str(row.get("Coordinates", "")))
        if coords:
            line_records.append({
                "line_number": str(row.get("Line_Number", "")),
                "x": coords[0],
                "y": coords[1],
                "pipe_size": str(row.get("Pipe_Size", "?")),
                "fluid_code": str(row.get("Fluid_Code", "?")),
            })

    if not line_records:
        _log("LLM line mapper: line coordinates not parseable — skipping.")
        return instruments_df

    unmatched_mask = instruments_df["Connected_Line"].fillna("") == ""
    unmatched_count = unmatched_mask.sum()
    if unmatched_count == 0:
        _log("LLM line mapper: all instruments already matched — nothing to do.")
        return instruments_df

    _log(f"LLM line mapper: querying {model} for {unmatched_count} unmatched instruments…")

    matched = 0
    for idx in instruments_df.index[unmatched_mask]:
        row = instruments_df.loc[idx]
        tag = str(row.get("Tag_Number", ""))
        if not tag:
            continue

        coords = _parse_coords(str(row.get("Coordinates", "")))
        if not coords:
            continue
        ix, iy = coords

        # Sort lines by distance, take top N
        candidates_sorted = sorted(
            line_records,
            key=lambda r: _dist(ix, iy, r["x"], r["y"]),
        )[:_MAX_CANDIDATES]

        candidates = [
            (r["line_number"], r["x"], r["y"],
             _dist(ix, iy, r["x"], r["y"]),
             r["pipe_size"], r["fluid_code"])
            for r in candidates_sorted
        ]

        prompt = _build_prompt(tag, ix, iy, candidates)
        result = generate(prompt, model=model, system=_SYSTEM_PROMPT)

        if result is None:
            continue

        line_no = str(result.get("line_number", "")).strip()
        confidence = float(result.get("confidence", 0.0))
        reason = str(result.get("reason", "")).strip()

        if line_no and confidence >= _MIN_CONFIDENCE:
            instruments_df.at[idx, "Connected_Line"] = line_no
            instruments_df.at[idx, "Line_Confidence"] = round(confidence, 2)
            instruments_df.at[idx, "Line_Reason"] = reason
            matched += 1
            logger.debug("LLM matched %s → %s (%.2f) — %s", tag, line_no, confidence, reason)

    _log(f"LLM line mapper: matched {matched}/{unmatched_count} instruments.")
    return instruments_df
