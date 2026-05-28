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
import re
import time
from typing import Optional

import pandas as pd

from .service import generate, _is_available

logger = logging.getLogger(__name__)

_MAX_CANDIDATES = 8
_MIN_CONFIDENCE = 0.55

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


# ── Helpers ───────────────────────────────────────────────────────────────────

def _instrument_type_desc(tag: str) -> str:
    m = re.search(r'[A-Z]{1,2}[FCPTLASIVREYZGHQWX]', tag.upper())
    if m:
        return _TYPE_DESC.get(m.group(0)[-1], "instrument")
    return "instrument"


def _parse_coords(coord_str: str) -> Optional[tuple]:
    try:
        parts = coord_str.split(",")
        return int(float(parts[0])), int(float(parts[1]))
    except Exception:
        return None


def _dist(ax: float, ay: float, bx: float, by: float) -> float:
    return math.sqrt((ax - bx) ** 2 + (ay - by) ** 2)


def _safe_ln(ln: str) -> str:
    """Replace inch-mark chars with 'in' so they don't break JSON strings inside the model."""
    return re.sub(r'["\'′″]', 'in', ln)


def _resolve_line_no(raw: str, candidates: list) -> str:
    """
    Map the model's answer back to the exact original line number string.

    The model may return the tag without inch marks (JSON-safe form) or a
    list-index digit. Both are resolved back to the canonical candidate string.
    """
    if raw.isdigit():
        idx = int(raw) - 1
        if 0 <= idx < len(candidates):
            return candidates[idx][0]

    norm_raw = _safe_ln(raw).upper().strip()
    for ln, *_ in candidates:
        if _safe_ln(ln).upper().strip() == norm_raw:
            return ln
        if norm_raw and norm_raw in _safe_ln(ln).upper():
            return ln

    return raw


def _build_candidates(ix: int, iy: int, line_records: list) -> list:
    """Sort line records by distance from (ix, iy) and return top _MAX_CANDIDATES tuples."""
    sorted_records = sorted(line_records, key=lambda r: _dist(ix, iy, r["x"], r["y"]))
    return [
        (r["line_number"], r["x"], r["y"],
         _dist(ix, iy, r["x"], r["y"]),
         r["pipe_size"], r["fluid_code"])
        for r in sorted_records[:_MAX_CANDIDATES]
    ]


def _build_prompt(tag: str, ix: int, iy: int, candidates: list) -> str:
    inst_type = _instrument_type_desc(tag)
    cand_lines = [
        f"  - {_safe_ln(ln)}  (distance={d:.0f}px, size={size}in, fluid={fluid})"
        for ln, lx, ly, d, size, fluid in candidates
    ]
    candidates_text = "\n".join(cand_lines) if cand_lines else "  (none found)"

    return (
        f"Instrument tag: {tag}\n"
        f"  Function: {inst_type}\n"
        f"  Position on drawing: ({ix}, {iy})\n\n"
        f"Nearby pipe lines (sorted nearest first):\n"
        f"{candidates_text}\n\n"
        f"Which pipe line tag is this instrument most likely connected to?\n\n"
        f"Engineering notes:\n"
        f"- Flow instruments (FT, FIC, FE…) measure flow in a specific pipe.\n"
        f"- Pressure/Temperature instruments tap directly off the process line.\n"
        f"- Valve instruments (FV, PV, TV…) are installed IN the pipe line they control.\n"
        f"- A closer line is usually correct, but favour matching fluid/size when ambiguous.\n\n"
        f"Respond ONLY with this JSON:\n"
        f'  {{"line_number": "<pipe line tag from the list above, or empty string>", '
        f'"confidence": <0.0-1.0>, "reason": "<one sentence>"}}'
    )


def _query_llm(tag: str, ix: int, iy: int, candidates: list, model: str) -> tuple:
    """Call the LLM for one instrument. Returns (line_no, confidence, reason, raw) or ('', 0, '', None)."""
    prompt = _build_prompt(tag, ix, iy, candidates)
    result = generate(prompt, model=model, system=_SYSTEM_PROMPT)
    if result is None:
        return "", 0.0, "", None

    line_no = _resolve_line_no(str(result.get("line_number", "")).strip(), candidates)
    confidence = float(result.get("confidence", 0.0))
    reason = str(result.get("reason", "")).strip()
    return line_no, confidence, reason, result


def _parse_line_records(lines_df: pd.DataFrame) -> list:
    """Convert lines_df rows into a list of coord-enriched dicts."""
    records = []
    for _, row in lines_df.iterrows():
        coords = _parse_coords(str(row.get("Coordinates", "")))
        if coords:
            records.append({
                "line_number": str(row.get("Line_Number", "")),
                "x": coords[0],
                "y": coords[1],
                "pipe_size": str(row.get("Pipe_Size", "?")),
                "fluid_code": str(row.get("Fluid_Code", "?")),
            })
    return records


# ── Public API ────────────────────────────────────────────────────────────────

def map_instruments_to_lines_llm(
    instruments_df: pd.DataFrame,
    lines_df: pd.DataFrame,
    status_fn=None,
    model: str = "xyra-pid-engineer",
    run_logger=None,
    page: int = 1,
) -> pd.DataFrame:
    """
    Augment instruments_df with LLM-derived line assignments.

    Only processes rows where Connected_Line is absent or empty.
    Returns the modified DataFrame (new columns added in-place).
    """
    def _log(msg: str) -> None:
        logger.info(msg)
        if status_fn:
            status_fn(msg)

    for col, default in [("Connected_Line", ""), ("Line_Confidence", 0.0), ("Line_Reason", "")]:
        if col not in instruments_df.columns:
            instruments_df[col] = default

    if lines_df.empty:
        _log("LLM line mapper: no line numbers on this page — skipping.")
        if run_logger:
            run_logger.log_llm_skip(page=page, reason="no line numbers on this page")
        return instruments_df

    if not _is_available(model):
        _log(f"LLM line mapper: Ollama/{model} not available — skipping.")
        if run_logger:
            run_logger.log_llm_skip(page=page, reason=f"Ollama/{model} not available")
        return instruments_df

    line_records = _parse_line_records(lines_df)
    if not line_records:
        _log("LLM line mapper: line coordinates not parseable — skipping.")
        if run_logger:
            run_logger.log_llm_skip(page=page, reason="line coordinates not parseable")
        return instruments_df

    unmatched_mask = instruments_df["Connected_Line"].fillna("") == ""
    unmatched_count = unmatched_mask.sum()
    if unmatched_count == 0:
        return instruments_df

    _log(f"LLM line mapper: querying {model} for {unmatched_count} unmatched instruments…")
    matched = _map_rows(
        instruments_df, instruments_df.index[unmatched_mask],
        line_records, model, run_logger=run_logger, page=page,
    )
    _log(f"LLM line mapper: matched {matched}/{unmatched_count} instruments.")
    return instruments_df


def _map_rows(
    df: pd.DataFrame,
    row_indices,
    line_records: list,
    model: str,
    run_logger=None,
    page: int = 1,
) -> int:
    """Process each unmatched row and write results directly into df. Returns match count."""
    matched = 0
    for row_idx in row_indices:
        row = df.loc[row_idx]
        tag = str(row.get("Tag_Number", ""))
        coords = _parse_coords(str(row.get("Coordinates", "")))
        if not tag or not coords:
            continue

        ix, iy = coords
        candidates = _build_candidates(ix, iy, line_records)

        t0 = time.monotonic()
        line_no, confidence, reason, raw = _query_llm(tag, ix, iy, candidates, model)
        latency_ms = (time.monotonic() - t0) * 1000

        accepted = bool(line_no and confidence >= _MIN_CONFIDENCE)

        if run_logger:
            run_logger.log_llm_call(
                page=page, tag=tag, ix=ix, iy=iy,
                candidates=candidates, raw_response=raw,
                resolved_line=line_no, confidence=confidence,
                reason=reason, latency_ms=latency_ms, accepted=accepted,
            )

        if accepted:
            df.at[row_idx, "Connected_Line"] = line_no
            df.at[row_idx, "Line_Confidence"] = round(confidence, 2)
            df.at[row_idx, "Line_Reason"] = reason
            matched += 1
            logger.debug("LLM matched %s → %s (%.2f)", tag, line_no, confidence)
    return matched
