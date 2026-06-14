"""Geometry evidence builder for InstruMap.

This module turns extracted drawing facts into a compact, auditable evidence
object per instrument. It deliberately stays independent from service text
generation so AI Grid, Excel, and future engineering models can consume the same
evidence without rerunning geometry.
"""
from __future__ import annotations

import json
import math
from typing import Any

import pandas as pd


_VALVE_TYPES = {
    "BDV", "CVA", "CV", "ESD", "ESDV", "ESV", "FCV", "HCV", "LCV",
    "MOV", "PCV", "SDV", "SSOV", "SSSV", "SSV", "TCV", "XV",
}
_VALVE_CONTEXT_MAX_DISTANCE = 1800.0
_EQUIPMENT_CONTEXT_MAX_DISTANCE = 2600.0
_NEAREST_LINE_LABEL_MAX_DISTANCE = 1600.0
_NEAREST_LINE_LABEL_AXIS_BAND = 420.0
_LOOP_CONTEXT_MIN_CONFIDENCE = 0.45
_LOOP_CONTEXT_SOURCE_PRIORITY = {
    "FIT": 0,
    "FT": 0,
    "PIT": 0,
    "PT": 0,
    "TIT": 0,
    "TT": 0,
    "LIT": 0,
    "LT": 0,
    "AIT": 0,
    "AT": 0,
    "FCV": 1,
    "PCV": 1,
    "LCV": 1,
    "TCV": 1,
    "SDV": 1,
    "SSV": 1,
    "BDV": 1,
    "XV": 1,
    "FE": 2,
    "TE": 2,
    "TW": 2,
    "RO": 2,
}


def _clean(value: Any) -> str:
    text = str(value or "").strip()
    return "" if text.lower() == "nan" else text


def _parse_coord(value: Any) -> tuple[float, float] | None:
    try:
        x_text, y_text = str(value or "").split(",", 1)
        return float(x_text), float(y_text)
    except Exception:
        return None


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _relative_position(inst_coord: tuple[float, float], target_coord: tuple[float, float]) -> str:
    dx = inst_coord[0] - target_coord[0]
    dy = inst_coord[1] - target_coord[1]
    if abs(dx) < max(abs(dy) * 0.75, 120.0):
        return "near"
    return "upstream" if dx < 0 else "downstream"


def _line_lookup(lines_df: pd.DataFrame | None) -> dict[str, dict]:
    if lines_df is None or lines_df.empty or "Line_Number" not in lines_df.columns:
        return {}
    lookup: dict[str, dict] = {}
    for _, row in lines_df.iterrows():
        line_no = _clean(row.get("Line_Number"))
        if line_no:
            lookup[line_no] = row.to_dict()
    return lookup


def _line_records(lines_df: pd.DataFrame | None) -> list[dict]:
    records: list[dict] = []
    if lines_df is None or lines_df.empty or "Line_Number" not in lines_df.columns:
        return records
    for _, row in lines_df.iterrows():
        coord = _parse_coord(row.get("Coordinates"))
        line_no = _clean(row.get("Line_Number"))
        if not coord or not line_no:
            continue
        records.append({
            "tag": line_no,
            "coord": coord,
            "page": _clean(row.get("P&ID_Page")),
            "record": row.to_dict(),
        })
    return records


def _line_size(line_no: str, record: dict) -> str:
    for key in ("Pipe_Size", "Size", "Line_Size", "Nominal_Size", "Size_Inch"):
        value = _clean(record.get(key))
        if value:
            return value.replace('"', "").strip()
    parts = line_no.split("-")
    if parts and parts[0].replace(".", "", 1).isdigit():
        return parts[0]
    return ""


def _safe_json(value: Any, default: Any) -> Any:
    if isinstance(value, (list, dict)):
        return value
    text = _clean(value)
    if not text:
        return default
    try:
        return json.loads(text)
    except Exception:
        return default


def _loop_instance(tag: str) -> str:
    return tag.split("-", 1)[1].strip().upper() if "-" in tag else ""


def _is_valve_row(row: pd.Series) -> bool:
    instr_type = _clean(row.get("Type")).upper()
    desc = _clean(row.get("Instrument_Description")).lower()
    return instr_type in _VALVE_TYPES or ("valve" in desc and "position" not in desc)


def _valve_records(instruments_df: pd.DataFrame) -> list[dict]:
    records: list[dict] = []
    if instruments_df is None or instruments_df.empty:
        return records
    for _, row in instruments_df.iterrows():
        if not _is_valve_row(row):
            continue
        coord = _parse_coord(row.get("Coordinates"))
        tag = _clean(row.get("Tag_Number"))
        if not coord or not tag:
            continue
        records.append({
            "tag": tag,
            "type": _clean(row.get("Type")).upper(),
            "loop": _clean(row.get("Loop")),
            "line": _clean(row.get("Connected_Line")),
            "coord": coord,
        })
    return records


def _equipment_records(equipment_df: pd.DataFrame | None) -> list[dict]:
    records: list[dict] = []
    if equipment_df is None or equipment_df.empty:
        return records
    for _, row in equipment_df.iterrows():
        coord = _parse_coord(row.get("Coordinates"))
        tag = _clean(row.get("Equipment_Tag"))
        if not coord or not tag:
            continue
        records.append({
            "tag": tag,
            "type": _clean(row.get("Equipment_Type")),
            "code": _clean(row.get("Equipment_Code")).upper(),
            "page": _clean(row.get("P&ID_Page")),
            "coord": coord,
        })
    return records


def _loop_line_records(instruments_df: pd.DataFrame) -> dict[str, list[dict]]:
    records: dict[str, list[dict]] = {}
    if instruments_df is None or instruments_df.empty:
        return records

    for _, row in instruments_df.iterrows():
        tag = _clean(row.get("Tag_Number"))
        line_no = _clean(row.get("Connected_Line"))
        if not tag or not line_no:
            continue

        try:
            confidence = float(row.get("Line_Confidence") or 0.0)
        except Exception:
            confidence = 0.0
        if confidence < _LOOP_CONTEXT_MIN_CONFIDENCE:
            continue

        loop = _loop_instance(tag)
        if not loop:
            continue

        coord = _parse_coord(row.get("Coordinates"))
        instr_type = _clean(row.get("Type")).upper()
        records.setdefault(loop, []).append({
            "tag": tag,
            "type": instr_type,
            "line": line_no,
            "confidence": confidence,
            "method": _clean(row.get("Line_Association_Method")),
            "reason": _clean(row.get("Line_Association_Reason")),
            "coord": coord,
            "priority": _LOOP_CONTEXT_SOURCE_PRIORITY.get(instr_type, 9),
        })
    return records


def _nearest_valve(row: pd.Series, valves: list[dict]) -> dict | None:
    inst_coord = _parse_coord(row.get("Coordinates"))
    if not inst_coord:
        return None
    tag = _clean(row.get("Tag_Number"))
    line_no = _clean(row.get("Connected_Line"))
    loop = _clean(row.get("Loop"))
    candidates: list[tuple[int, float, dict]] = []
    for valve in valves:
        if valve["tag"] == tag:
            continue
        dist = _distance(inst_coord, valve["coord"])
        if dist > _VALVE_CONTEXT_MAX_DISTANCE:
            continue
        same_line = bool(line_no and valve["line"] and valve["line"] == line_no)
        same_loop = bool(loop and valve["loop"] and valve["loop"] == loop)
        close_unmapped_loop_mate = bool(line_no and same_loop and not valve["line"] and dist <= 700.0)
        loop_only_match = bool(not line_no and same_loop)
        if not same_line and not close_unmapped_loop_mate and not loop_only_match:
            continue
        priority = 0 if same_line else 1 if close_unmapped_loop_mate else 2
        candidates.append((priority, dist, valve))
    if not candidates:
        return None
    priority, dist, valve = sorted(candidates, key=lambda item: (item[0], item[1]))[0]
    confidence = 0.88 if priority == 0 else 0.76 if priority == 1 else 0.62
    return {
        "tag": valve["tag"],
        "type": valve["type"],
        "position": _relative_position(inst_coord, valve["coord"]),
        "distance_px": round(dist, 1),
        "confidence": confidence,
        "basis": "same connected line" if priority == 0 else "same loop proximity",
    }


def _nearest_equipment(row: pd.Series, equipment: list[dict]) -> dict | None:
    inst_coord = _parse_coord(row.get("Coordinates"))
    if not inst_coord:
        return None
    page = _clean(row.get("P&ID_Page"))
    candidates: list[tuple[float, dict]] = []
    for eq in equipment:
        if page and eq["page"] and page != eq["page"]:
            continue
        dist = _distance(inst_coord, eq["coord"])
        if dist <= _EQUIPMENT_CONTEXT_MAX_DISTANCE:
            candidates.append((dist, eq))
    if not candidates:
        return None
    dist, eq = sorted(candidates, key=lambda item: item[0])[0]
    confidence = max(0.48, min(0.78, 0.78 - (dist / _EQUIPMENT_CONTEXT_MAX_DISTANCE) * 0.22))
    return {
        "tag": eq["tag"],
        "type": eq["type"],
        "code": eq["code"],
        "position": _relative_position(inst_coord, eq["coord"]),
        "distance_px": round(dist, 1),
        "confidence": round(confidence, 3),
        "basis": "nearest same-page equipment",
    }


def _nearest_line_label(row: pd.Series, line_records: list[dict]) -> dict | None:
    inst_coord = _parse_coord(row.get("Coordinates"))
    if not inst_coord:
        return None
    page = _clean(row.get("P&ID_Page"))
    candidates: list[tuple[float, float, dict]] = []
    for line in line_records:
        if page and line["page"] and page != line["page"]:
            continue
        dx = line["coord"][0] - inst_coord[0]
        dy = line["coord"][1] - inst_coord[1]
        dist = math.hypot(dx, dy)
        if dist > _NEAREST_LINE_LABEL_MAX_DISTANCE:
            continue
        off_axis = min(abs(dx), abs(dy))
        candidates.append((off_axis, dist, line))

    if not candidates:
        return None

    off_axis, dist, line = sorted(candidates, key=lambda item: (item[0], item[1]))[0]
    axis_aligned = off_axis <= _NEAREST_LINE_LABEL_AXIS_BAND
    confidence = 0.42 if axis_aligned else 0.28
    if dist > _NEAREST_LINE_LABEL_MAX_DISTANCE * 0.65:
        confidence -= 0.08
    return {
        "tag": line["tag"],
        "distance_px": round(dist, 1),
        "off_axis_px": round(off_axis, 1),
        "axis_aligned": axis_aligned,
        "confidence": round(max(0.18, confidence), 3),
        "size": _line_size(line["tag"], line["record"]),
        "fluid_code": _clean(line["record"].get("Fluid_Code")).upper(),
        "basis": "nearest extracted line label; not a confirmed pipe connection",
    }


def _loop_context(row: pd.Series, loop_lines: dict[str, list[dict]]) -> dict | None:
    tag = _clean(row.get("Tag_Number"))
    instr_type = _clean(row.get("Type")).upper()
    variable_family = instr_type[:1]
    loop = _loop_instance(tag)
    if not tag or not loop:
        return None

    inst_coord = _parse_coord(row.get("Coordinates"))
    candidates = []
    for candidate in loop_lines.get(loop, []):
        if candidate["tag"] == tag:
            continue
        candidate_family = _clean(candidate.get("type")).upper()[:1]
        if variable_family and candidate_family and variable_family != candidate_family:
            continue
        distance_px = None
        if inst_coord and candidate.get("coord"):
            distance_px = round(_distance(inst_coord, candidate["coord"]), 1)
        candidates.append({
            "tag": candidate["tag"],
            "type": candidate["type"],
            "line": candidate["line"],
            "confidence": round(candidate["confidence"], 3),
            "method": candidate["method"],
            "reason": candidate["reason"],
            "distance_px": distance_px,
            "_priority": candidate["priority"],
        })

    if not candidates:
        return None

    grouped: dict[str, dict] = {}
    for candidate in candidates:
        line_no = candidate["line"]
        grouped.setdefault(line_no, {
            "line": line_no,
            "best_confidence": 0.0,
            "sources": [],
        })
        grouped[line_no]["best_confidence"] = max(
            grouped[line_no]["best_confidence"],
            float(candidate["confidence"] or 0.0),
        )
        grouped[line_no]["sources"].append({
            key: value
            for key, value in candidate.items()
            if key != "_priority"
        })

    lines = sorted(
        grouped.values(),
        key=lambda item: (
            -float(item["best_confidence"] or 0.0),
            min(_LOOP_CONTEXT_SOURCE_PRIORITY.get(source["type"], 9) for source in item["sources"]),
            item["line"],
        ),
    )
    best = sorted(
        candidates,
        key=lambda item: (
            item["_priority"],
            item["distance_px"] if item["distance_px"] is not None else 999999.0,
            -float(item["confidence"] or 0.0),
            item["tag"],
        ),
    )[0]
    unique_lines = {item["line"] for item in lines}
    confidence = float(best["confidence"] or 0.0)
    return {
        "loop": loop,
        "line": best["line"],
        "source_tag": best["tag"],
        "source_type": best["type"],
        "confidence": round(confidence, 3),
        "method": "same_loop_context",
        "conflict": len(unique_lines) > 1,
        "candidate_lines": [
            {
                "line": item["line"],
                "confidence": round(float(item["best_confidence"] or 0.0), 3),
                "sources": item["sources"][:5],
            }
            for item in lines[:5]
        ],
        "basis": "same loop instance with mapped physical instrument or valve",
    }


def build_row_evidence(
    row: pd.Series,
    lines: dict[str, dict],
    line_records: list[dict],
    valves: list[dict],
    equipment: list[dict],
    loop_lines: dict[str, list[dict]] | None = None,
) -> dict:
    line_no = _clean(row.get("Connected_Line"))
    line_record = lines.get(line_no, {})
    candidates = _safe_json(row.get("Line_Candidates"), [])
    line_confidence = float(row.get("Line_Confidence") or 0.0)
    evidence: dict[str, Any] = {
        "version": 1,
        "line": None,
        "nearest_line_label": None,
        "loop_context": _loop_context(row, loop_lines or {}),
        "valve": _nearest_valve(row, valves),
        "equipment": _nearest_equipment(row, equipment),
        "overall_confidence": 0.0,
        "summary": "",
    }
    if line_no:
        top_candidate = candidates[0] if isinstance(candidates, list) and candidates else {}
        evidence["line"] = {
            "tag": line_no,
            "confidence": round(line_confidence, 3),
            "method": _clean(row.get("Line_Association_Method")),
            "reason": _clean(row.get("Line_Association_Reason")),
            "candidates": candidates if isinstance(candidates, list) else [],
            "size": _line_size(line_no, line_record),
            "size_unit": _clean(line_record.get("Size_Unit")),
            "fluid_code": _clean(line_record.get("Fluid_Code")).upper(),
            "connection_side": _clean(top_candidate.get("connection_side")),
            "pipe_axis": _clean(top_candidate.get("pipe_axis")),
            "stub_count": top_candidate.get("stub_count"),
            "run_segment_count": top_candidate.get("run_segment_count"),
        }
    else:
        evidence["nearest_line_label"] = _nearest_line_label(row, line_records)

    confidences = [
        float(part.get("confidence") or 0.0)
        for part in (
            evidence.get("line"),
            evidence.get("nearest_line_label"),
            evidence.get("loop_context"),
            evidence.get("valve"),
            evidence.get("equipment"),
        )
        if isinstance(part, dict)
    ]
    evidence["overall_confidence"] = round(max(confidences) if confidences else 0.0, 3)
    summary_parts = []
    if evidence["line"]:
        axis = f" {evidence['line']['pipe_axis']}" if evidence["line"].get("pipe_axis") else ""
        side = f" via {evidence['line']['connection_side']} stub" if evidence["line"].get("connection_side") else ""
        summary_parts.append(f"line {evidence['line']['tag']}{axis}{side}")
    if evidence["nearest_line_label"]:
        alignment = "axis-aligned " if evidence["nearest_line_label"].get("axis_aligned") else ""
        summary_parts.append(
            f"nearest {alignment}line label {evidence['nearest_line_label']['tag']} "
            f"({evidence['nearest_line_label']['distance_px']}px)"
        )
    if evidence["loop_context"]:
        conflict = " conflicting" if evidence["loop_context"].get("conflict") else ""
        summary_parts.append(
            f"{conflict} loop line {evidence['loop_context']['line']} from {evidence['loop_context']['source_tag']}"
        )
    if evidence["valve"]:
        summary_parts.append(f"{evidence['valve']['position']} valve {evidence['valve']['tag']}")
    if evidence["equipment"]:
        summary_parts.append(f"{evidence['equipment']['position']} equipment {evidence['equipment']['tag']}")
    evidence["summary"] = "; ".join(summary_parts)
    return evidence


def attach_geometry_evidence(
    instruments_df: pd.DataFrame,
    lines_df: pd.DataFrame | None = None,
    equipment_df: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Return a copy of instruments_df with Geometry_Evidence columns."""
    if instruments_df is None or instruments_df.empty:
        return instruments_df

    df = instruments_df.copy()
    lines = _line_lookup(lines_df)
    line_records = _line_records(lines_df)
    valves = _valve_records(df)
    equipment = _equipment_records(equipment_df)
    loop_lines = _loop_line_records(df)
    evidences = [build_row_evidence(row, lines, line_records, valves, equipment, loop_lines) for _, row in df.iterrows()]
    df["Geometry_Evidence"] = [
        json.dumps(evidence, separators=(",", ":"), ensure_ascii=True)
        for evidence in evidences
    ]
    df["Geometry_Evidence_Confidence"] = [evidence["overall_confidence"] for evidence in evidences]
    df["Geometry_Evidence_Summary"] = [evidence["summary"] for evidence in evidences]
    return df
