from __future__ import annotations

import math
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.config.local_db import connection, json_text, row_to_dict
from app.config.settings import settings
from app.modules.instruments.service import create_instrument, ensure_project

PREFIX = "/api/v1/flowsizing"
router = APIRouter()

FLOW_TYPES = {
    "control-valve": "Control Valve",
    "flow-element": "Flow Element",
    "relief-valve": "Relief Valve",
    "pump": "Pump",
    "storage-tank": "Storage Tank",
    "separator": "Separator",
    "heat-exchanger": "Heat Exchanger",
}


def _project_id(project_id: str | None) -> str:
    return (project_id or settings.XYRA_DEFAULT_PROJECT_ID or "default").strip() or "default"


def _num(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except Exception:
        return default


def _positive(value: Any, default: float = 1.0) -> float:
    return max(_num(value, default), 1e-9)


def _round(value: float | None, places: int = 3) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, places)


def _status(messages: list[str]) -> str:
    return "check_required" if messages else "sized"


def _promote(instrument_type: str, calc: dict) -> dict:
    promoted: dict[str, Any] = {}
    if instrument_type == "control-valve":
        best_key = max(("max", "normal", "min"), key=lambda k: _num((calc.get(k) or {}).get("requiredCv")))
        best = calc.get(best_key) or {}
        promoted["governing_case"] = best_key.capitalize()
        promoted["selected_cv"] = best.get("requiredCv")
        promoted["valve_opening_pct"] = best.get("percentOpen")
        promoted["sizing_status"] = calc.get("sizingStatus")
    elif instrument_type == "flow-element":
        promoted["beta_ratio"] = calc.get("betaRatio")
        promoted["orifice_bore_mm"] = calc.get("orificeDiameter_mm")
        promoted["sizing_status"] = calc.get("sizingStatus")
    elif instrument_type == "relief-valve":
        area_mm2 = calc.get("requiredArea_mm2")
        promoted["required_area_cm2"] = _round(area_mm2 / 100.0, 4) if area_mm2 else None
        promoted["selected_api_orifice"] = calc.get("selectedOrifice")
        promoted["sizing_status"] = calc.get("sizingStatus")
    elif instrument_type == "pump":
        promoted["tdh_m"] = calc.get("totalDynamicHead_m")
        promoted["hydraulic_power_kw"] = calc.get("hydraulicPower_kW")
        promoted["motor_power_kw"] = calc.get("motorPower_kW")
        promoted["sizing_status"] = calc.get("sizingStatus")
    elif instrument_type == "heat-exchanger":
        promoted["duty_kw"] = calc.get("heatDuty_kW")
        promoted["lmtd_c"] = calc.get("lmtd_C")
        promoted["heat_area_m2"] = calc.get("designArea_m2")
        promoted["sizing_status"] = calc.get("sizingStatus")
    elif instrument_type in {"separator", "storage-tank"}:
        diameter = calc.get("diameter_m")
        length = calc.get("shellLength_m") or calc.get("tangentHeight_m")
        promoted["vessel_id_mm"] = _round(diameter * 1000, 1) if diameter else None
        promoted["vessel_tangential_length_mm"] = _round(length * 1000, 1) if length else None
        promoted["vessel_diameter_mm"] = promoted["vessel_id_mm"]
        promoted["vessel_length_mm"] = promoted["vessel_tangential_length_mm"]
        promoted["sizing_status"] = calc.get("sizingStatus")
    return {k: v for k, v in promoted.items() if v is not None}


def _extract_process_rows(project_id: str, instrument_id: str, instrument_type: str, inp: dict) -> list[dict]:
    fluid = inp.get("fluidName") or inp.get("fluid") or inp.get("hotFluidName") or inp.get("coldFluidName")
    phase = inp.get("fluidPhase") or inp.get("phase")
    base = {
        "project_id": project_id,
        "instrument_id": instrument_id,
        "fluid": fluid,
        "fluid_state": phase,
    }
    row = {
        **base,
        "case_name": "Design",
        "temp_operating_c": inp.get("temperatureC") or inp.get("relievingTempC") or inp.get("hotInletTempC"),
        "press_operating_barg": inp.get("inletPressureBarg") or inp.get("upstreamPressureBarg") or inp.get("setPressureBarg") or inp.get("suctionPressureBarg"),
        "flow_rate": inp.get("flowM3h") or inp.get("flowKgh") or inp.get("ratedFlowM3h") or inp.get("normalFlowM3h"),
        "flow_rate_unit": inp.get("flowUnit") or ("m3/h" if inp.get("flowM3h") or inp.get("ratedFlowM3h") else None),
        "density_liquid_kgm3": inp.get("densityKgm3") or inp.get("liquidDensityKgm3"),
        "density_vapour_kgm3": inp.get("gasDensityKgm3"),
        "viscosity_cp": inp.get("viscosityCp"),
        "molecular_weight": inp.get("molecularWeight"),
        "cp_cv_ratio": inp.get("kRatio") or inp.get("kappa"),
        "compressibility_factor": inp.get("compressibility"),
        "extended": json_text({"instrument_type": instrument_type, **inp}, {}),
    }
    return [{k: v for k, v in row.items() if v not in (None, "")}]


def _select_api_orifice(area_mm2: float) -> str:
    sizes = [
        ("D", 71), ("E", 126), ("F", 198), ("G", 324), ("H", 506),
        ("J", 830), ("K", 1185), ("L", 1840), ("M", 2320), ("N", 2800),
        ("P", 4116), ("Q", 7129), ("R", 10323), ("T", 16774),
    ]
    for letter, capacity in sizes:
        if area_mm2 <= capacity:
            return letter
    return "T+"


def _control_valve(inp: dict) -> dict:
    sg = _positive(inp.get("specificGravity") or inp.get("densityKgm3"), 1.0)
    if sg > 10:
        sg = sg / 1000.0
    rated_cv = _positive(inp.get("ratedCv"), 100.0)
    valve_size = _positive(inp.get("valveSizeIn"), _positive(inp.get("lineSizeIn"), 2.0))
    messages: list[str] = []

    def case(key: str) -> dict:
        prefix = key.capitalize()
        flow_m3h = _positive(inp.get(f"{key}FlowM3h") or inp.get("flowM3h"), 1.0)
        p1 = _num(inp.get(f"{key}InletPressureBarg") or inp.get("inletPressureBarg"), 5.0)
        p2 = _num(inp.get(f"{key}OutletPressureBarg") or inp.get("outletPressureBarg"), max(p1 - 1, 0.0))
        dp_bar = max(p1 - p2, 0.01)
        q_gpm = flow_m3h * 4.40287
        dp_psi = dp_bar * 14.5038
        required_cv = q_gpm * math.sqrt(sg / dp_psi)
        opening = min(required_cv / rated_cv * 100.0, 999.0)
        if opening > 90:
            messages.append(f"{prefix} case opening is above 90%.")
        if opening < 10:
            messages.append(f"{prefix} case opening is below 10%.")
        return {
            "flowM3h": _round(flow_m3h),
            "deltaPBar": _round(dp_bar),
            "requiredCv": _round(required_cv, 2),
            "percentOpen": _round(opening, 1),
        }

    calc = {key: case(key) for key in ("min", "normal", "max")}
    calc.update({
        "lineSizeIn": _round(_positive(inp.get("lineSizeIn"), valve_size), 2),
        "valveSizeIn": _round(valve_size, 2),
        "ratedCv": _round(rated_cv, 2),
        "sizingStatus": _status(messages),
        "reviewMessages": sorted(set(messages)),
        "method": "IEC-style liquid Cv estimate for offline preliminary sizing",
    })
    return calc


def _flow_element(inp: dict) -> dict:
    line_size_in = _positive(inp.get("pipeSizeIn"), 2.0)
    pipe_id_mm = _positive(inp.get("pipeIdMm"), line_size_in * 25.4)
    beta = _num(inp.get("betaRatio"), 0.62)
    if beta <= 0:
        flow = _positive(inp.get("flowM3h"), 10.0) / 3600.0
        density = _positive(inp.get("densityKgm3"), 1000.0)
        dp_pa = _positive(inp.get("designDPmbar"), 250.0) * 100.0
        cd = 0.61
        area = flow / (cd * math.sqrt(2.0 * dp_pa / density))
        bore_mm = math.sqrt((4.0 * area) / math.pi) * 1000.0
        beta = bore_mm / pipe_id_mm
    else:
        bore_mm = beta * pipe_id_mm
    messages = []
    if beta < 0.2 or beta > 0.75:
        messages.append("Beta ratio should normally be between 0.20 and 0.75.")
    return {
        "betaRatio": _round(beta, 4),
        "orificeDiameter_mm": _round(bore_mm, 2),
        "pipeId_mm": _round(pipe_id_mm, 2),
        "sizingStatus": _status(messages),
        "reviewMessages": messages,
        "method": "ISO 5167-oriented preliminary orifice sizing",
    }


def _relief_valve(inp: dict) -> dict:
    flow_kgh = _positive(inp.get("flowKgh"), 1000.0)
    pressure_barg = _positive(inp.get("setPressureBarg"), 5.0)
    mw = _positive(inp.get("molecularWeight"), 28.97)
    temp_k = _positive(inp.get("relievingTempC"), 25.0) + 273.15
    kdr = _positive(inp.get("dischargeCoefficient"), 0.975)
    area_mm2 = flow_kgh * math.sqrt(temp_k * mw) / max(12.0 * kdr * (pressure_barg + 1.01325), 1.0)
    messages = []
    if pressure_barg < 0.5:
        messages.append("Set pressure is very low; verify relief basis.")
    return {
        "requiredArea_mm2": _round(area_mm2, 2),
        "selectedOrifice": _select_api_orifice(area_mm2),
        "sizingStatus": _status(messages),
        "reviewMessages": messages,
        "method": "API 520 gas/vapour preliminary area estimate",
    }


def _pump(inp: dict) -> dict:
    flow_m3h = _positive(inp.get("ratedFlowM3h"), 25.0)
    density = _positive(inp.get("densityKgm3"), 1000.0)
    suction = _num(inp.get("suctionPressureBarg"), 0.0)
    discharge = _num(inp.get("dischargePressureBarg"), 5.0)
    static_head = _num(inp.get("staticHeadM"), 0.0)
    line_loss = _num(inp.get("lineLossM"), 5.0)
    efficiency = min(max(_positive(inp.get("efficiencyPct"), 70.0) / 100.0, 0.01), 1.0)
    motor_margin = _positive(inp.get("motorMarginPct"), 15.0) / 100.0
    pressure_head = (discharge - suction) * 100000.0 / (density * 9.80665)
    tdh = max(pressure_head + static_head + line_loss, 0.0)
    hydraulic_kw = density * 9.80665 * (flow_m3h / 3600.0) * tdh / 1000.0
    motor_kw = hydraulic_kw / efficiency * (1 + motor_margin)
    return {
        "totalDynamicHead_m": _round(tdh, 2),
        "hydraulicPower_kW": _round(hydraulic_kw, 2),
        "motorPower_kW": _round(motor_kw, 2),
        "sizingStatus": "sized",
        "reviewMessages": [],
        "method": "Hydraulic power and TDH estimate",
    }


def _storage_tank(inp: dict) -> dict:
    volume = _positive(inp.get("workingVolumeM3"), 100.0)
    margin = _num(inp.get("designMarginPct"), 10.0) / 100.0
    hd = _positive(inp.get("heightDiameterRatio"), 1.2)
    design_volume = volume * (1 + margin)
    diameter = (4.0 * design_volume / (math.pi * hd)) ** (1.0 / 3.0)
    height = hd * diameter
    return {
        "designVolume_m3": _round(design_volume, 2),
        "diameter_m": _round(diameter, 2),
        "tangentHeight_m": _round(height, 2),
        "sizingStatus": "sized",
        "reviewMessages": [],
        "method": "Atmospheric cylindrical tank volume sizing",
    }


def _separator(inp: dict) -> dict:
    gas_flow = _positive(inp.get("gasFlowM3h"), 1000.0) / 3600.0
    gas_density = _positive(inp.get("gasDensityKgm3"), 10.0)
    liquid_density = _positive(inp.get("liquidDensityKgm3"), 800.0)
    k_value = _positive(inp.get("kValue"), 0.107)
    ld_ratio = _positive(inp.get("lengthDiameterRatio"), 3.0)
    allowable_v = k_value * math.sqrt(max(liquid_density - gas_density, 1.0) / gas_density)
    area = gas_flow / max(allowable_v, 0.01)
    diameter = math.sqrt(4 * area / math.pi)
    length = diameter * ld_ratio
    return {
        "allowableGasVelocity_ms": _round(allowable_v, 3),
        "diameter_m": _round(diameter, 2),
        "shellLength_m": _round(length, 2),
        "sizingStatus": "sized",
        "reviewMessages": [],
        "method": "Souders-Brown horizontal separator estimate",
    }


def _heat_exchanger(inp: dict) -> dict:
    duty_kw = _positive(inp.get("heatDutyKw"), 500.0)
    hot_in = _num(inp.get("hotInletTempC"), 120.0)
    hot_out = _num(inp.get("hotOutletTempC"), 80.0)
    cold_in = _num(inp.get("coldInletTempC"), 30.0)
    cold_out = _num(inp.get("coldOutletTempC"), 60.0)
    u = _positive(inp.get("overallUWM2K"), 500.0)
    correction = min(max(_positive(inp.get("correctionFactor"), 0.9), 0.1), 1.0)
    margin = _num(inp.get("foulingMarginPct"), 10.0) / 100.0
    dt1 = max(hot_in - cold_out, 0.1)
    dt2 = max(hot_out - cold_in, 0.1)
    lmtd = dt1 if abs(dt1 - dt2) < 1e-6 else (dt1 - dt2) / math.log(dt1 / dt2)
    area = duty_kw * 1000.0 / (u * lmtd * correction) * (1 + margin)
    messages = []
    if lmtd < 5:
        messages.append("LMTD is low; verify terminal temperatures.")
    return {
        "heatDuty_kW": _round(duty_kw, 2),
        "lmtd_C": _round(lmtd, 2),
        "designArea_m2": _round(area, 2),
        "sizingStatus": _status(messages),
        "reviewMessages": messages,
        "method": "LMTD heat transfer area estimate",
    }


CALCULATORS = {
    "control-valve": _control_valve,
    "flow-element": _flow_element,
    "relief-valve": _relief_valve,
    "pump": _pump,
    "storage-tank": _storage_tank,
    "separator": _separator,
    "heat-exchanger": _heat_exchanger,
}


class InstrumentAdd(BaseModel):
    project_id: str
    tag_number: str
    flowsizing_type: str
    service: str | None = None


class CalculationRequest(BaseModel):
    instrument_type: str = Field(..., description="FlowSizing calculation type")
    input_snapshot: dict[str, Any] = Field(default_factory=dict)


class SizingResultSave(BaseModel):
    project_id: str
    instrument_id: str
    tag_number: str
    instrument_type: str
    input_snapshot: dict[str, Any]
    result_snapshot: dict[str, Any]
    report_revision: str | None = "Rev 0"


@router.get("/types")
async def list_types() -> dict:
    return {"types": [{"value": key, "label": label} for key, label in FLOW_TYPES.items()]}


@router.get("/tags")
async def list_tags(
    project_id: str = Query(...),
    type: str = Query(...),
    search: str | None = Query(None),
) -> dict:
    ensure_project(project_id)
    project = _project_id(project_id)
    params: list[Any] = [project, type]
    where = "project_id=? AND flowsizing_type=?"
    if search:
        where += " AND tag_number LIKE ?"
        params.append(f"{search}%")
    with connection() as conn:
        rows = conn.execute(
            f"""
            SELECT id, tag_number, service, instrument_type, flowsizing_type
            FROM instruments
            WHERE {where}
            ORDER BY tag_number
            LIMIT 300
            """,
            params,
        ).fetchall()
    return {"tags": [row_to_dict(row) for row in rows]}


@router.post("/instruments", status_code=201)
async def add_instrument(body: InstrumentAdd) -> dict:
    if body.flowsizing_type not in FLOW_TYPES:
        raise HTTPException(status_code=400, detail="Unsupported FlowSizing type")
    project = _project_id(body.project_id)
    ensure_project(project)
    with connection() as conn:
        row = conn.execute(
            """
            SELECT code FROM instrument_type_catalog
            WHERE flowsizing_type=? AND is_active=1
            ORDER BY sort_order, code LIMIT 1
            """,
            (body.flowsizing_type,),
        ).fetchone()
    instrument_type = row["code"] if row else body.flowsizing_type
    try:
        return create_instrument(
            {
                "project_id": project,
                "tag_number": body.tag_number.strip(),
                "instrument_type": instrument_type,
                "flowsizing_type": body.flowsizing_type,
                "service": body.service,
                "source": "flowsizing",
                "status": "Draft",
            },
            user_id="local-user",
        )
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/calculate")
async def calculate(body: CalculationRequest) -> dict:
    calculator = CALCULATORS.get(body.instrument_type)
    if not calculator:
        raise HTTPException(status_code=400, detail="Unsupported FlowSizing type")
    calculation = calculator(body.input_snapshot or {})
    return {
        "status": "ok",
        "instrument_type": body.instrument_type,
        "calculation": calculation,
        "promoted": _promote(body.instrument_type, calculation),
    }


@router.post("/calculate-control-valve")
async def calculate_control_valve(payload: dict[str, Any]) -> dict:
    return {"status": "ok", "calculation": _control_valve(payload)}


@router.post("/calculate-flow-element")
async def calculate_flow_element(payload: dict[str, Any]) -> dict:
    return {"status": "ok", "calculation": _flow_element(payload)}


@router.post("/calculate-relief-valve")
async def calculate_relief_valve(payload: dict[str, Any]) -> dict:
    return {"status": "ok", "calculation": _relief_valve(payload)}


@router.post("/calculate-pump")
async def calculate_pump(payload: dict[str, Any]) -> dict:
    return {"status": "ok", "calculation": _pump(payload)}


@router.post("/calculate-storage-tank")
async def calculate_storage_tank(payload: dict[str, Any]) -> dict:
    return {"status": "ok", "calculation": _storage_tank(payload)}


@router.post("/calculate-separator")
async def calculate_separator(payload: dict[str, Any]) -> dict:
    return {"status": "ok", "calculation": _separator(payload)}


@router.post("/calculate-heat-exchanger")
async def calculate_heat_exchanger(payload: dict[str, Any]) -> dict:
    return {"status": "ok", "calculation": _heat_exchanger(payload)}


@router.get("/results")
async def list_results(
    project_id: str = Query(...),
    type: str = Query(...),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=500),
) -> dict:
    project = _project_id(project_id)
    offset = (page - 1) * page_size
    with connection() as conn:
        total = conn.execute(
            "SELECT COUNT(*) FROM sizing_results WHERE project_id=? AND instrument_type=?",
            (project, type),
        ).fetchone()[0]
        rows = conn.execute(
            """
            SELECT id, project_id, instrument_id, tag_number, instrument_type, sizing_status,
                   governing_case, selected_cv, valve_opening_pct, beta_ratio, orifice_bore_mm,
                   required_area_cm2, selected_api_orifice, tdh_m, hydraulic_power_kw,
                   motor_power_kw, duty_kw, lmtd_c, heat_area_m2, vessel_id_mm,
                   vessel_tangential_length_mm, report_revision, calculated_at, updated_at
            FROM sizing_results
            WHERE project_id=? AND instrument_type=?
            ORDER BY updated_at DESC
            LIMIT ? OFFSET ?
            """,
            (project, type, page_size, offset),
        ).fetchall()
    return {
        "data": [row_to_dict(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, -(-total // page_size)),
    }


@router.post("/results", status_code=201)
async def save_result(body: SizingResultSave) -> dict:
    project = _project_id(body.project_id)
    ensure_project(project)
    calculation = body.result_snapshot.get("calculation") or body.result_snapshot
    promoted = _promote(body.instrument_type, calculation)
    payload = {
        "project_id": project,
        "instrument_id": body.instrument_id,
        "tag_number": body.tag_number,
        "instrument_type": body.instrument_type,
        "input_snapshot": json_text(body.input_snapshot, {}),
        "result_snapshot": json_text(body.result_snapshot, {}),
        "report_revision": body.report_revision or "Rev 0",
        "updated_by": "local-user",
        "created_by": "local-user",
        **promoted,
    }
    columns = list(payload.keys())
    updates = ", ".join(f"{column}=excluded.{column}" for column in columns if column not in {"project_id", "tag_number", "instrument_type", "created_by"})
    with connection() as conn:
        conn.execute(
            f"""
            INSERT INTO sizing_results ({", ".join(columns)})
            VALUES ({", ".join("?" for _ in columns)})
            ON CONFLICT(project_id, tag_number, instrument_type) DO UPDATE SET
                {updates},
                updated_at=CURRENT_TIMESTAMP
            """,
            [payload[column] for column in columns],
        )
        saved = conn.execute(
            """
            SELECT * FROM sizing_results
            WHERE project_id=? AND tag_number=? AND instrument_type=?
            """,
            (project, body.tag_number, body.instrument_type),
        ).fetchone()
        rows = _extract_process_rows(project, body.instrument_id, body.instrument_type, body.input_snapshot)
        for row in rows:
            proc_cols = list(row.keys())
            proc_updates = ", ".join(f"{column}=excluded.{column}" for column in proc_cols if column not in {"project_id", "instrument_id", "case_name"})
            conn.execute(
                f"""
                INSERT INTO process_data ({", ".join(proc_cols)})
                VALUES ({", ".join("?" for _ in proc_cols)})
                ON CONFLICT(project_id, instrument_id, case_name) DO UPDATE SET
                    {proc_updates},
                    updated_at=CURRENT_TIMESTAMP
                """,
                [row[column] for column in proc_cols],
            )
    return row_to_dict(saved) or {}


@router.get("/results/{result_id}")
async def get_result(result_id: str) -> dict:
    with connection() as conn:
        row = conn.execute("SELECT * FROM sizing_results WHERE id=?", (result_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Sizing result not found")
    return row_to_dict(row) or {}
