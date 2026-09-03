"""
Instrument service text generator.

Creates short engineering service phrases for Instrument Index / IO List.
The generator is deterministic by default so client deployments do not depend
on external services for basic deliverables.
"""
from __future__ import annotations

import json
import re
import math
from typing import Dict

import pandas as pd

from app.modules.instrumap.core.geometry_evidence import attach_geometry_evidence


_FLUID_LABELS = {
    "AI": "Instrument air",
    "CA": "Compressed air",
    "CW": "Cooling water",
    "FA": "Fuel gas",
    "FG": "Fuel gas",
    "FW": "Fire water",
    "IA": "Instrument air",
    "IZ": "Chemical injection",
    "NG": "Natural gas",
    "NN": "Nitrogen",
    "PA": "Plant air",
    "PG": "Produced gas",
    "PO": "Process oil",
    "PW": "Produced water",
    "SW": "Sea water",
    "VG": "Vent gas",
}

_VARIABLES = {
    "A": "analysis",
    "C": "conductivity",
    "D": "density",
    "E": "voltage",
    "F": "flow",
    "L": "level",
    "P": "pressure",
    "S": "speed",
    "T": "temperature",
    "V": "vibration",
    "W": "weight",
    "X": "process",
    "Z": "position",
}

_VALVE_TYPES = {
    "BDV", "CVA", "CV", "ESD", "ESDV", "ESV", "FCV", "HCV", "LCV",
    "MOV", "PCV", "SDV", "SSOV", "SSSV", "SSV", "TCV", "XV",
}
_VALVE_CONTEXT_MAX_DISTANCE = 1800.0
_EQUIPMENT_CONTEXT_MAX_DISTANCE = 2600.0
_ELECTRICAL_VARIABLES = {"current", "power", "speed", "voltage", "vibration"}


def _clean(value) -> str:
    text = str(value or "").strip()
    return "" if text.lower() == "nan" else text


def _line_lookup(lines_df: pd.DataFrame | None) -> Dict[str, dict]:
    if lines_df is None or lines_df.empty or "Line_Number" not in lines_df.columns:
        return {}
    lookup: Dict[str, dict] = {}
    for _, row in lines_df.iterrows():
        line_no = _clean(row.get("Line_Number"))
        if line_no:
            lookup[line_no] = row.to_dict()
    return lookup


def _parse_coord(value) -> tuple[float, float] | None:
    try:
        x_text, y_text = str(value or "").split(",", 1)
        return float(x_text), float(y_text)
    except Exception:
        return None


def _distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _is_valve_row(row: pd.Series) -> bool:
    instr_type = _clean(row.get("Type")).upper()
    desc = _clean(row.get("Instrument_Description")).lower()
    if instr_type in _VALVE_TYPES:
        return True
    return "valve" in desc and not any(word in desc for word in ("position", "alarm"))


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
            "desc": _clean(row.get("Instrument_Description")),
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


def _relative_position(inst_coord: tuple[float, float], valve_coord: tuple[float, float]) -> str:
    dx = inst_coord[0] - valve_coord[0]
    dy = inst_coord[1] - valve_coord[1]
    # Only claim upstream/downstream when the relationship is mostly horizontal.
    # Vertical pipe direction needs flow-arrow extraction, so "near" is safer.
    if abs(dx) < max(abs(dy) * 0.75, 120.0):
        return "near"
    return "upstream" if dx < 0 else "downstream"


def _nearest_valve_context(row: pd.Series, valves: list[dict]) -> dict | None:
    if not valves:
        return None

    inst_coord = _parse_coord(row.get("Coordinates"))
    if not inst_coord:
        return None

    tag = _clean(row.get("Tag_Number"))
    line_no = _clean(row.get("Connected_Line"))
    loop = _clean(row.get("Loop"))
    candidates = []

    for valve in valves:
        if valve["tag"] == tag:
            continue
        dist = _distance(inst_coord, valve["coord"])
        same_line = bool(line_no and valve["line"] and valve["line"] == line_no)
        same_loop = bool(loop and valve["loop"] and valve["loop"] == loop)
        close_unmapped_loop_mate = bool(line_no and same_loop and not valve["line"] and dist <= 700.0)
        loop_only_match = bool(not line_no and same_loop)
        if not same_line and not close_unmapped_loop_mate and not loop_only_match:
            continue
        if dist > _VALVE_CONTEXT_MAX_DISTANCE:
            continue
        priority = 0 if same_line else 1 if close_unmapped_loop_mate else 2
        candidates.append((priority, dist, valve))

    if not candidates:
        return None

    _, dist, valve = sorted(candidates, key=lambda item: (item[0], item[1]))[0]
    return {
        "tag": valve["tag"],
        "type": valve["type"],
        "position": _relative_position(inst_coord, valve["coord"]),
        "distance": dist,
    }


def _nearest_equipment_context(row: pd.Series, equipment: list[dict]) -> dict | None:
    if not equipment:
        return None

    inst_coord = _parse_coord(row.get("Coordinates"))
    if not inst_coord:
        return None

    page = _clean(row.get("P&ID_Page"))
    candidates = []
    for eq in equipment:
        if page and eq["page"] and page != eq["page"]:
            continue
        dist = _distance(inst_coord, eq["coord"])
        if dist > _EQUIPMENT_CONTEXT_MAX_DISTANCE:
            continue
        candidates.append((dist, eq))

    if not candidates:
        return None

    dist, eq = sorted(candidates, key=lambda item: item[0])[0]
    return {
        "tag": eq["tag"],
        "type": eq["type"],
        "code": eq["code"],
        "position": _relative_position(inst_coord, eq["coord"]),
        "distance": dist,
    }


def _fluid_label(line_no: str, lines: Dict[str, dict]) -> str:
    record = lines.get(line_no, {})
    fluid_code = _clean(record.get("Fluid_Code")).upper()
    if fluid_code:
        return _FLUID_LABELS.get(fluid_code, f"{fluid_code} service")

    # Fallback for standard line numbers: size-fluid-sequence-area-insulation-spec.
    parts = line_no.split("-")
    if len(parts) >= 2:
        code = parts[1].strip().upper()
        if code:
            return _FLUID_LABELS.get(code, f"{code} service")
    return ""


def _line_size(line_no: str, lines: Dict[str, dict]) -> str:
    record = lines.get(line_no, {})
    for key in ("Size", "Line_Size", "Nominal_Size", "Size_Inch"):
        value = _clean(record.get(key))
        if value:
            return value.replace('"', "").strip()

    parts = line_no.split("-")
    if parts and re.match(r"^\d+(?:\.\d+)?$", parts[0].strip()):
        return parts[0].strip()
    return ""


def _line_context(row: pd.Series, lines: Dict[str, dict]) -> str:
    line_no = _clean(row.get("Connected_Line"))
    if not line_no:
        return ""
    return _line_context_for_line(line_no, lines)


def _line_context_for_line(line_no: str, lines: Dict[str, dict]) -> str:
    fluid = _fluid_label(line_no, lines)
    size = _line_size(line_no, lines)
    size_text = f"{size} in " if size else ""
    return f"{size_text}{fluid} line" if fluid else f"{size_text}process line"


def _line_phrase(line_ctx: str) -> str:
    return f"on {line_ctx}" if line_ctx else ""


def _geometry_evidence(row: pd.Series) -> dict:
    raw = _clean(row.get("Geometry_Evidence"))
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


def _geometry_summary(row: pd.Series) -> str:
    evidence = _geometry_evidence(row)
    if not evidence:
        return ""
    summary = _clean(evidence.get("summary"))
    if not summary:
        return ""
    try:
        return f"{summary} ({float(evidence.get('overall_confidence') or 0):.0%})"
    except Exception:
        return summary


def _loop_line_context(row: pd.Series, lines: Dict[str, dict]) -> tuple[str, dict | None]:
    evidence = _geometry_evidence(row)
    loop_ctx = evidence.get("loop_context") if isinstance(evidence, dict) else None
    if not isinstance(loop_ctx, dict):
        return "", None
    line_no = _clean(loop_ctx.get("line"))
    if not line_no:
        return "", loop_ctx
    return _line_context_for_line(line_no, lines), loop_ctx


def _basis_with_loop_context(loop_ctx: dict | None, geometry_summary: str) -> str:
    if not loop_ctx:
        return "tag type only"
    conflict = "; conflicting loop lines require review" if loop_ctx.get("conflict") else ""
    source = _clean(loop_ctx.get("source_tag"))
    line_no = _clean(loop_ctx.get("line"))
    confidence = loop_ctx.get("confidence")
    try:
        confidence_text = f"{float(confidence or 0):.0%}"
    except Exception:
        confidence_text = ""
    evidence = f"; evidence: {geometry_summary}" if geometry_summary else ""
    return (
        f"same-loop context from {source} on {line_no}"
        f"{f' ({confidence_text})' if confidence_text else ''}{conflict}{evidence}"
    )


def _context_for_service(row: pd.Series, lines: Dict[str, dict]) -> tuple[str, str, dict | None]:
    line_ctx = _line_context(row, lines)
    if line_ctx:
        return line_ctx, "", None
    loop_ctx_text, loop_ctx = _loop_line_context(row, lines)
    if loop_ctx and loop_ctx.get("conflict"):
        return "", "loop_conflict", loop_ctx
    return loop_ctx_text, "loop", loop_ctx


def _join_service(*parts: str) -> str:
    return re.sub(r"\s+", " ", " ".join(part for part in parts if part)).strip()


def _variable_for_type(instr_type: str, desc: str) -> str:
    t = instr_type.upper()
    d = desc.lower()
    if "differential pressure" in d or t.startswith("PD"):
        return "differential pressure"
    if "toxic gas" in d:
        return "toxic gas"
    if "flame" in d:
        return "flame"
    if "gas" in d and t.startswith("X"):
        return "gas"
    if "position" in d:
        return "position"
    return _VARIABLES.get(t[:1], "instrument")


def _alarm_qualifier(instr_type: str, desc: str) -> str:
    text = f"{instr_type} {desc}".upper()
    if "HH" in text or "HIGH HIGH" in text:
        return "high-high"
    if "LL" in text or "LOW LOW" in text:
        return "low-low"
    if re.search(r"(?:AH|SH|HIGH)\b", text):
        return "high"
    if re.search(r"(?:AL|SL|LOW)\b", text):
        return "low"
    return ""


def _valve_subject(valve_ctx: dict | None, variable: str) -> str:
    if not valve_ctx:
        return ""
    position = valve_ctx["position"]
    tag = valve_ctx["tag"]
    if position in {"upstream", "downstream"}:
        return f"{position} of {tag}"
    return f"near {tag}"


def _equipment_subject(equipment_ctx: dict | None, variable: str) -> str:
    if not equipment_ctx:
        return ""

    eq_type = equipment_ctx["type"]
    position = equipment_ctx["position"]

    if eq_type == "Motor":
        return "motor" if variable in _ELECTRICAL_VARIABLES else ""

    if eq_type in {"Pump", "Compressor"}:
        if position == "upstream":
            return f"{eq_type.lower()} suction"
        if position == "downstream":
            return f"{eq_type.lower()} discharge"
        return f"{eq_type.lower()}"

    if eq_type in {"Vessel", "Drum", "Tank", "Reactor"}:
        if variable == "level":
            return f"{eq_type.lower()}"
        if position == "upstream":
            return f"{eq_type.lower()} inlet"
        if position == "downstream":
            return f"{eq_type.lower()} outlet"
        return f"{eq_type.lower()}"

    if eq_type in {"Filter", "Heat Exchanger", "Heater"}:
        if variable == "differential pressure" and eq_type == "Filter":
            return "filter"
        if position == "upstream":
            return f"{eq_type.lower()} inlet"
        if position == "downstream":
            return f"{eq_type.lower()} outlet"
        return f"{eq_type.lower()}"

    return eq_type.lower() if eq_type else ""


def _result(service: str, confidence: str, basis: str) -> dict:
    return {
        "service": service,
        "confidence": confidence,
        "basis": basis,
    }


def _service_for_row(
    row: pd.Series,
    lines: Dict[str, dict],
    valves: list[dict],
    equipment: list[dict],
) -> dict:
    tag = _clean(row.get("Tag_Number"))
    instr_type = _clean(row.get("Type")).upper()
    desc = _clean(row.get("Instrument_Description"))
    system = _clean(row.get("System"))
    io_type = _clean(row.get("IO_Type"))

    if not tag or system == "REVIEW" or io_type == "REVIEW":
        return _result("Review required", "Review", "row marked for review")

    variable = _variable_for_type(instr_type, desc)
    line_no = _clean(row.get("Connected_Line"))
    line_ctx = _line_context(row, lines)
    inherited_ctx, inherited_source, loop_ctx = _context_for_service(row, lines)
    service_ctx = line_ctx or inherited_ctx
    valve_ctx = _nearest_valve_context(row, valves)
    valve_subject = _valve_subject(valve_ctx, variable)
    equipment_ctx = _nearest_equipment_context(row, equipment)
    equipment_subject = _equipment_subject(equipment_ctx, variable)
    subject = service_ctx or "Process"
    geometry_summary = _geometry_summary(row)
    line_basis = (
        f"connected line {line_no}; evidence: {geometry_summary}"
        if line_no and geometry_summary
        else f"connected line {line_no}" if line_no else "tag type only"
    )
    service_basis = line_basis
    if inherited_source in {"loop", "loop_conflict"} and loop_ctx:
        service_basis = _basis_with_loop_context(loop_ctx, geometry_summary)

    if system == "F&GS":
        if "Flame" in desc:
            return _result("Flame detection in process area", "High", "F&GS flame detector")
        if "Toxic Gas" in desc:
            return _result("Toxic gas detection in process area", "High", "F&GS toxic gas detector")
        if "Gas Alarm" in desc:
            return _result("Gas alarm indication", "High", "F&GS gas alarm")
        if "Alarm" in desc or "Annunciator" in desc:
            return _result("Fire and gas alarm indication", "High", "F&GS alarm/annunciator")
        return _result("Fire and gas detection", "High", "F&GS classification")

    if instr_type in {"CVZT", "FZT"}:
        return _result("Control valve position feedback", "High", f"{instr_type} position feedback")
    if instr_type == "CVZI":
        return _result("Control valve position indication", "High", "CVZI valve position indication")
    if instr_type == "CVA":
        return _result("Control valve actuator command", "High", "CVA valve actuator")

    if instr_type == "SVHC":
        return _result("Shutdown valve hydraulic close command", "High", "SVHC safety valve close solenoid")
    if instr_type == "SVHO":
        return _result("Shutdown valve hydraulic open command", "High", "SVHO safety valve open solenoid")
    if instr_type == "SVZA":
        return _result("Shutdown valve position alarm", "High", "SVZA safety valve position alarm")
    if instr_type in {"SSV", "SSSV", "SSOV", "SDV", "BDV", "ESV", "ESDV"}:
        return _result("Shutdown valve command", "High", f"{instr_type} shutdown valve")

    if instr_type == "HSD":
        return _result("Emergency shutdown hand switch", "High", "HSD shutdown hand switch")
    if instr_type in {"HS", "HSS"}:
        return _result("Operator hand switch", "High", f"{instr_type} hand switch")
    if instr_type == "HIC":
        return _result("Manual indicating controller", "Medium", "HIC hand/indicating controller tag")
    if instr_type in {"LAL", "LAH", "LALL", "LAHH"}:
        qualifier = _alarm_qualifier(instr_type, desc)
        suffix = f" {qualifier}" if qualifier else ""
        if inherited_source == "loop_conflict":
            return _result(f"Level{suffix} alarm line requires review", "Review", service_basis)
        return _result(
            _join_service(f"Level{suffix} alarm", _line_phrase(service_ctx)),
            "Medium" if service_ctx else "Medium",
            service_basis if service_ctx else f"{instr_type} level alarm tag",
        )
    if instr_type in {"PDHG", "PDG"}:
        if inherited_source == "loop_conflict":
            return _result("Differential pressure indication line requires review", "Review", service_basis)
        return _result(
            _join_service("Local differential pressure indication", _line_phrase(service_ctx)),
            "Medium",
            service_basis if service_ctx else f"{instr_type} differential pressure gauge/indicator tag",
        )
    if instr_type in {"PSDH", "PSDL", "PDSH", "PDSL"}:
        qualifier = "high" if instr_type.endswith("H") else "low"
        if inherited_source == "loop_conflict":
            return _result(f"Differential pressure {qualifier} switch line requires review", "Review", service_basis)
        return _result(
            _join_service(f"Differential pressure {qualifier} switch", _line_phrase(service_ctx)),
            "Medium" if service_ctx else "Medium",
            service_basis if service_ctx else f"{instr_type} differential pressure switch tag",
        )
    if instr_type in {"PSAL", "PSAH", "PSALL", "PSAHH", "PSDL", "PSDH"}:
        qualifier = _alarm_qualifier(instr_type, desc)
        suffix = f" {qualifier}" if qualifier else ""
        if inherited_source == "loop_conflict":
            return _result(f"Pressure{suffix} switch line requires review", "Review", service_basis)
        return _result(
            _join_service(f"Pressure{suffix} switch", _line_phrase(service_ctx)),
            "Medium",
            service_basis if service_ctx else f"{instr_type} pressure switch tag",
        )
    if instr_type in {"ZIH", "ZIL", "ZIHH", "ZILL"}:
        qualifier = _alarm_qualifier(instr_type, desc)
        suffix = f" {qualifier}" if qualifier else ""
        if inherited_source == "loop_conflict":
            return _result(f"Valve position{suffix} indication line requires review", "Review", service_basis)
        return _result(
            _join_service(f"Valve position{suffix} indication", _line_phrase(service_ctx)),
            "Medium",
            service_basis if service_ctx else f"{instr_type} valve position indication tag",
        )
    if instr_type == "XA":
        if inherited_source == "loop_conflict":
            return _result("Process alarm line requires review", "Review", service_basis)
        if service_ctx:
            return _result(f"Process alarm for {service_ctx}", "Medium", service_basis)
        return _result("Miscellaneous process alarm", "Medium", "XA miscellaneous/process alarm tag")

    if instr_type in {"TE", "TW", "TP", "FE", "AE", "RO", "FO"}:
        passive = {
            "TE": "Temperature element",
            "TW": "Thermowell",
            "TP": "Test point",
            "FE": "Flow element",
            "AE": "Analyzer element",
            "RO": "Restriction orifice",
            "FO": "Flow orifice",
        }.get(instr_type, desc or "Passive instrument")
        if service_ctx:
            return _result(f"{subject} {passive.lower()}", "Medium", service_basis)
        if inherited_source == "loop_conflict":
            return _result(f"{passive} line requires review", "Review", service_basis)
        if instr_type == "TP":
            return _result(passive, "Medium", "test point tag type")
        return _result(passive, "Low", "passive tag type only")

    if "Transmitter" in desc:
        if valve_subject and variable in {"pressure", "temperature", "flow", "differential pressure"}:
            return _result(
                _join_service(f"{variable.capitalize()} measurement", _line_phrase(line_ctx), valve_subject),
                "High",
                f"same line/loop valve context {valve_ctx['tag']} ({valve_ctx['position']})",
            )
        if equipment_subject:
            return _result(
                _join_service(f"{variable.capitalize()} measurement", _line_phrase(line_ctx), f"at {equipment_subject}"),
                "High",
                f"nearest equipment {equipment_ctx['tag']} ({equipment_ctx['position']})",
            )
        if inherited_source == "loop_conflict":
            return _result(f"{variable.capitalize()} measurement line requires review", "Review", service_basis)
        confidence = "Medium" if service_ctx else "Low"
        return _result(
            _join_service(f"{variable.capitalize()} measurement", _line_phrase(service_ctx))
            or f"{subject} {variable}",
            confidence,
            service_basis,
        )

    if "Indicator" in desc or "Gauge" in desc:
        if valve_subject and variable in {"pressure", "temperature", "flow", "differential pressure"}:
            return _result(
                _join_service(f"{variable.capitalize()} indication", _line_phrase(line_ctx), valve_subject),
                "High",
                f"same line/loop valve context {valve_ctx['tag']} ({valve_ctx['position']})",
            )
        if equipment_subject:
            return _result(
                _join_service(f"{variable.capitalize()} indication", _line_phrase(line_ctx), f"at {equipment_subject}"),
                "High",
                f"nearest equipment {equipment_ctx['tag']} ({equipment_ctx['position']})",
            )
        if service_ctx:
            return _result(_join_service(f"{variable.capitalize()} indication", _line_phrase(service_ctx)), "Medium", service_basis)
        if inherited_source == "loop_conflict":
            return _result(f"{variable.capitalize()} indication line requires review", "Review", service_basis)
        return _result(f"Local {variable} indication", "Low", "indicator tag type only")

    if "Switch" in desc:
        qualifier = _alarm_qualifier(instr_type, desc)
        suffix = f" {qualifier}" if qualifier else ""
        if valve_subject and variable in {"pressure", "temperature", "flow", "differential pressure"}:
            return _result(
                _join_service(f"{variable.capitalize()}{suffix} switch", _line_phrase(line_ctx), valve_subject),
                "High",
                f"same line/loop valve context {valve_ctx['tag']} ({valve_ctx['position']})",
            )
        if equipment_subject:
            return _result(
                _join_service(f"{variable.capitalize()}{suffix} switch", _line_phrase(line_ctx), f"at {equipment_subject}"),
                "High",
                f"nearest equipment {equipment_ctx['tag']} ({equipment_ctx['position']})",
            )
        if inherited_source == "loop_conflict":
            return _result(f"{variable.capitalize()}{suffix} switch line requires review", "Review", service_basis)
        confidence = "Medium" if service_ctx else "Low"
        return _result(
            _join_service(f"{variable.capitalize()}{suffix} switch", _line_phrase(service_ctx))
            or f"{subject} {variable}{suffix} switch",
            confidence,
            service_basis,
        )

    if "Alarm" in desc:
        qualifier = _alarm_qualifier(instr_type, desc)
        suffix = f" {qualifier}" if qualifier else ""
        if variable == "process" and not line_ctx and not equipment_subject:
            return _result(f"Process{suffix} alarm", "Low", line_basis)
        if valve_subject and variable in {"pressure", "temperature", "flow", "differential pressure"}:
            return _result(
                _join_service(f"{variable.capitalize()}{suffix} alarm", _line_phrase(line_ctx), valve_subject),
                "High",
                f"same line/loop valve context {valve_ctx['tag']} ({valve_ctx['position']})",
            )
        if equipment_subject:
            return _result(
                _join_service(f"{variable.capitalize()}{suffix} alarm", _line_phrase(line_ctx), f"at {equipment_subject}"),
                "High",
                f"nearest equipment {equipment_ctx['tag']} ({equipment_ctx['position']})",
            )
        if inherited_source == "loop_conflict":
            return _result(f"{variable.capitalize()}{suffix} alarm line requires review", "Review", service_basis)
        confidence = "Medium" if service_ctx else "Low"
        return _result(f"{subject} {variable}{suffix} alarm", confidence, service_basis)

    if "Controller" in desc:
        if inherited_source == "loop_conflict":
            return _result(f"Process {variable} control line requires review", "Review", service_basis)
        confidence = "Medium" if service_ctx else "Low"
        return _result(f"{subject} {variable} control", confidence, service_basis)

    if "Valve" in desc:
        if line_ctx:
            return _result(f"{subject} valve control", "Medium", line_basis)
        return _result("Valve control", "Low", "valve tag type only")

    if "Relay" in desc or "Converter" in desc:
        if service_ctx:
            return _result(
                _join_service(f"{variable.capitalize()} signal conversion", f"for {service_ctx}"),
                "Medium",
                service_basis,
            )
        if inherited_source == "loop_conflict":
            return _result(f"{variable.capitalize()} signal conversion line requires review", "Review", service_basis)
        return _result(f"{variable.capitalize()} signal conversion", "Low", "relay/converter tag type only")

    return _result(desc or "Instrument service", "Low", "description fallback")


def enrich_instrument_services(
    instruments_df: pd.DataFrame,
    lines_df: pd.DataFrame | None = None,
    equipment_df: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Return a copy of instruments_df with Instrument_Service populated."""
    if instruments_df is None or instruments_df.empty:
        return instruments_df

    df = instruments_df.copy()
    df = attach_geometry_evidence(df, lines_df, equipment_df)
    lines = _line_lookup(lines_df)
    valves = _valve_records(df)
    equipment = _equipment_records(equipment_df)
    results = [_service_for_row(row, lines, valves, equipment) for _, row in df.iterrows()]
    df["Instrument_Service"] = [r["service"] for r in results]
    df["Service_Confidence"] = [r["confidence"] for r in results]
    df["Service_Basis"] = [r["basis"] for r in results]
    return df


def build_service_enrichment(
    instruments_df: pd.DataFrame,
    lines_df: pd.DataFrame | None = None,
    equipment_df: pd.DataFrame | None = None,
) -> Dict[str, dict]:
    """
    Build the existing Excel enrichment shape:
    {Tag_Number: {"service_description": "..."}}
    """
    df = enrich_instrument_services(instruments_df, lines_df, equipment_df)
    enrichment: Dict[str, dict] = {}
    if df is None or df.empty:
        return enrichment
    for _, row in df.iterrows():
        tag = _clean(row.get("Tag_Number"))
        service = _clean(row.get("Instrument_Service"))
        if tag and service:
            enrichment[tag] = {
                "service_description": service,
                "service_confidence": _clean(row.get("Service_Confidence")),
                "service_basis": _clean(row.get("Service_Basis")),
            }
    return enrichment
