"""
Datasheet Generator service layer.
Reads/writes process_data, spec_sheet_data, and calculation_data (read-only).
"""
from __future__ import annotations

import json
from typing import Any

from app.config.local_db import connection, row_to_dict
from app.modules.instruments.service import (
    _normalize_project_id,
    ensure_project,
)


# ── Instruments with datasheet status ────────────────────────────────────────

def list_instruments_ds(
    project_id: str,
    search: str | None = None,
    ds_status: str | None = None,
    page: int = 1,
    page_size: int = 100,
) -> dict:
    """
    List instruments for a project, annotated with their latest spec-sheet status.
    ds_status can filter by 'Not Started' or any spec_sheet_data.status value.
    """
    project_id = _normalize_project_id(project_id)
    ensure_project(project_id)

    where   = ["i.project_id = ?"]
    params: list[Any] = [project_id]

    if search:
        where.append("(i.tag_number LIKE ? OR i.service LIKE ?)")
        params += [f"{search}%", f"%{search}%"]

    where_sql = " AND ".join(where)
    offset    = (page - 1) * page_size

    # Window function: pick the highest revision per instrument
    base_q = f"""
        SELECT
            i.id, i.tag_number, i.instrument_type, i.service,
            i.line_tag, i.area_code, i.unit_code, i.loop_number,
            i.status as inst_status, i.active_on_pid,
            i.created_at, i.updated_at,
            ss.status   AS ds_status,
            ss.revision AS ds_revision,
            ss.updated_at AS ds_updated_at,
            ss.prepared_by AS ds_prepared_by
        FROM instruments i
        LEFT JOIN (
            SELECT instrument_id, status, revision, updated_at, prepared_by,
                   ROW_NUMBER() OVER (
                       PARTITION BY instrument_id ORDER BY revision DESC
                   ) AS rn
            FROM spec_sheet_data
        ) ss ON ss.instrument_id = i.id AND ss.rn = 1
        WHERE {where_sql}
    """

    # Post-filter by ds_status
    if ds_status == "Not Started":
        base_q += " AND ss.instrument_id IS NULL"
    elif ds_status:
        base_q += f" AND ss.status = '{ds_status}'"

    with connection() as conn:
        total_row = conn.execute(f"SELECT COUNT(*) FROM ({base_q})", params).fetchone()
        total     = total_row[0] if total_row else 0

        rows = conn.execute(
            f"{base_q} ORDER BY i.tag_number ASC LIMIT ? OFFSET ?",
            [*params, page_size, offset],
        ).fetchall()

    return {
        "total": total,
        "page":  page,
        "page_size": page_size,
        "data": [dict(r) for r in rows],
    }


# ── Process data ──────────────────────────────────────────────────────────────

def get_process_data(instrument_id: str) -> list[dict]:
    with connection() as conn:
        rows = conn.execute(
            "SELECT * FROM process_data WHERE instrument_id = ? ORDER BY case_name",
            (instrument_id,),
        ).fetchall()
    return [row_to_dict(r) for r in rows]


def upsert_process_data(
    project_id: str,
    instrument_id: str,
    case_name: str,
    data: dict,
    user_id: str = "local-user",
) -> dict:
    project_id = _normalize_project_id(project_id)
    allowed = {
        "fluid", "fluid_state",
        "temp_operating_c", "temp_design_c", "temp_min_c",
        "press_operating_barg", "press_design_barg", "press_min_barg",
        "press_atmospheric_bara",
        "flow_rate", "flow_rate_unit",
        "flow_normal", "flow_max", "flow_min", "flow_unit",
        "density_liquid_kgm3", "density_vapour_kgm3",
        "viscosity_cp", "molecular_weight", "specific_gravity",
        "vapour_pressure_barg", "critical_pressure_barg",
        "cp_cv_ratio", "compressibility_factor", "extended",
    }
    clean = {k: v for k, v in data.items() if k in allowed}
    if "extended" in clean and not isinstance(clean["extended"], str):
        clean["extended"] = json.dumps(clean["extended"])

    cols   = list(clean.keys())
    vals   = list(clean.values())
    update = ", ".join(f"{c} = excluded.{c}" for c in cols)
    insert = ", ".join(["project_id", "instrument_id", "case_name", "updated_by"] + cols)
    ph     = ", ".join(["?", "?", "?", "?"] + ["?" for _ in cols])

    with connection() as conn:
        conn.execute(
            f"""
            INSERT INTO process_data ({insert})
            VALUES ({ph})
            ON CONFLICT(project_id, instrument_id, case_name) DO UPDATE SET
                {update},
                updated_by = excluded.updated_by,
                updated_at = CURRENT_TIMESTAMP
            """,
            [project_id, instrument_id, case_name, user_id, *vals],
        )
        row = conn.execute(
            "SELECT * FROM process_data WHERE instrument_id = ? AND case_name = ?",
            (instrument_id, case_name),
        ).fetchone()
    return row_to_dict(row)


def delete_process_case(instrument_id: str, case_name: str) -> bool:
    with connection() as conn:
        cur = conn.execute(
            "DELETE FROM process_data WHERE instrument_id = ? AND case_name = ?",
            (instrument_id, case_name),
        )
    return cur.rowcount > 0


# ── Spec sheet data ───────────────────────────────────────────────────────────

def get_spec_sheets(instrument_id: str) -> list[dict]:
    with connection() as conn:
        rows = conn.execute(
            "SELECT * FROM spec_sheet_data WHERE instrument_id = ? ORDER BY revision DESC",
            (instrument_id,),
        ).fetchall()
    return [row_to_dict(r) for r in rows]


def upsert_spec_sheet(
    project_id: str,
    instrument_id: str,
    revision: str,
    data: dict,
    user_id: str = "local-user",
) -> dict:
    project_id = _normalize_project_id(project_id)
    json_cols = {"process_conditions", "applicable_standards", "extended"}
    allowed = {
        "tag_number", "process_data_id", "calculation_data_id",
        "service_description", "pid_number", "line_tag", "area_code",
        "unit_code", "plant_code",
        "instrument_type", "manufacturer", "model_number", "serial_number",
        "body_material", "body_size_inch", "pressure_rating",
        "process_connection", "face_to_face_mm",
        "element_type", "element_material", "trim_material",
        "power_supply", "output_signal", "output_range",
        "communication_protocol", "enclosure_ip_rating",
        "range_min", "range_max", "range_unit",
        "set_point", "set_point_unit",
        "alarm_high", "alarm_high_unit", "alarm_low", "alarm_low_unit",
        "trip_high", "trip_low", "deadband", "accuracy_pct",
        "process_conditions",
        "area_classification", "gas_group", "temp_class",
        "protection_method", "certification_body", "certificate_number",
        "mounting_type", "orientation",
        "inlet_straight_run", "outlet_straight_run",
        "insulation_required", "heat_tracing_required",
        "applicable_standards", "extended",
        "status", "revision_date", "revision_description",
        "prepared_by", "checked_by", "approved_by", "issued_by", "issued_at",
        "pdf_path",
        # UDF columns (SPI-style)
        *[f"udf_{i:02d}" for i in range(1, 101)],
    }
    clean = {k: v for k, v in data.items() if k in allowed}
    for jc in json_cols:
        if jc in clean and not isinstance(clean[jc], str):
            clean[jc] = json.dumps(clean[jc])

    # tag_number is required
    if "tag_number" not in clean:
        with connection() as conn:
            row = conn.execute(
                "SELECT tag_number FROM instruments WHERE id = ?", (instrument_id,)
            ).fetchone()
        if row:
            clean["tag_number"] = row["tag_number"]

    cols   = list(clean.keys())
    vals   = list(clean.values())
    update = ", ".join(f"{c} = excluded.{c}" for c in cols)
    insert = ", ".join(
        ["project_id", "instrument_id", "revision", "updated_by"] + cols
    )
    ph = ", ".join(["?", "?", "?", "?"] + ["?" for _ in cols])

    with connection() as conn:
        conn.execute(
            f"""
            INSERT INTO spec_sheet_data ({insert})
            VALUES ({ph})
            ON CONFLICT(project_id, tag_number, revision) DO UPDATE SET
                {update},
                updated_by = excluded.updated_by,
                updated_at = CURRENT_TIMESTAMP
            """,
            [project_id, instrument_id, revision, user_id, *vals],
        )
        row = conn.execute(
            "SELECT * FROM spec_sheet_data WHERE instrument_id = ? AND revision = ?",
            (instrument_id, revision),
        ).fetchone()
    return row_to_dict(row)


# ── Calculations (read-only for now) ─────────────────────────────────────────

def get_calculations(instrument_id: str) -> list[dict]:
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT id, calc_type, case_name, result_value, result_unit, result_label,
                   selected_value, sizing_margin_pct, calc_status, revision, updated_at
            FROM calculation_data
            WHERE instrument_id = ?
            ORDER BY calc_type, case_name
            """,
            (instrument_id,),
        ).fetchall()
    return [dict(r) for r in rows]


# ── EDE Grid data ────────────────────────────────────────────────────────────

def get_grid_data(
    project_id: str,
    instrument_type: str | None = None,
    search: str | None = None,
    process_case: str = "Normal",
    page: int = 1,
    page_size: int = 500,
) -> dict:
    project_id = _normalize_project_id(project_id)
    ensure_project(project_id)

    where: list[str] = ["i.project_id = ?"]
    params: list[Any] = [project_id]

    if instrument_type:
        where.append("i.instrument_type = ?")
        params.append(instrument_type)
    if search:
        where.append("(i.tag_number LIKE ? OR i.service LIKE ?)")
        params += [f"{search}%", f"%{search}%"]

    where_sql = " AND ".join(where)
    offset    = (page - 1) * page_size
    udf_cols  = ", ".join(f"ss.udf_{i:02d}" for i in range(1, 101))

    sql = f"""
        SELECT
            -- Instrument table
            i.id, i.tag_number, i.instrument_type, i.service,
            i.line_tag, i.area_code, i.unit_code, i.loop_number,
            i.status AS inst_status, i.active_on_pid,

            -- Spec sheet standard columns
            ss.id              AS spec_id,
            ss.status          AS ds_status,
            ss.revision        AS ds_revision,
            ss.service_description,
            ss.pid_number,
            ss.manufacturer,   ss.model_number,    ss.serial_number,
            ss.body_material,  ss.body_size_inch,  ss.pressure_rating,
            ss.process_connection, ss.face_to_face_mm,
            ss.element_type,   ss.element_material, ss.trim_material,
            ss.power_supply,   ss.output_signal,   ss.output_range,
            ss.communication_protocol, ss.enclosure_ip_rating,
            ss.range_min,      ss.range_max,       ss.range_unit,
            ss.area_classification, ss.gas_group,  ss.temp_class,
            ss.protection_method, ss.certification_body,
            ss.mounting_type,  ss.orientation,
            ss.prepared_by,    ss.checked_by,      ss.approved_by,
            ss.updated_at      AS ds_updated_at,

            -- UDF columns
            {udf_cols},

            -- Process data (prefixed pd_)
            pd.case_name       AS pd_case_name,
            pd.fluid           AS pd_fluid,
            pd.fluid_state     AS pd_fluid_state,
            pd.temp_operating_c     AS pd_temp_operating_c,
            pd.temp_design_c        AS pd_temp_design_c,
            pd.temp_min_c           AS pd_temp_min_c,
            pd.press_operating_barg AS pd_press_operating_barg,
            pd.press_design_barg    AS pd_press_design_barg,
            pd.press_min_barg       AS pd_press_min_barg,
            pd.flow_normal     AS pd_flow_normal,
            pd.flow_max        AS pd_flow_max,
            pd.flow_min        AS pd_flow_min,
            pd.flow_unit       AS pd_flow_unit,
            pd.density_liquid_kgm3  AS pd_density_liquid_kgm3,
            pd.density_vapour_kgm3  AS pd_density_vapour_kgm3,
            pd.viscosity_cp         AS pd_viscosity_cp,
            pd.molecular_weight     AS pd_molecular_weight,
            pd.specific_gravity     AS pd_specific_gravity,
            pd.vapour_pressure_barg AS pd_vapour_pressure_barg,
            pd.cp_cv_ratio          AS pd_cp_cv_ratio,
            pd.compressibility_factor AS pd_compressibility_factor

        FROM instruments i
        LEFT JOIN (
            SELECT *, ROW_NUMBER() OVER (
                PARTITION BY instrument_id ORDER BY revision DESC
            ) AS rn
            FROM spec_sheet_data
        ) ss ON ss.instrument_id = i.id AND ss.rn = 1
        LEFT JOIN process_data pd
            ON pd.instrument_id = i.id AND pd.case_name = ?
        WHERE {where_sql}
        ORDER BY i.tag_number ASC
        LIMIT ? OFFSET ?
    """

    # process_case goes BEFORE where_sql params (it's the pd join param)
    with connection() as conn:
        total = (conn.execute(
            f"SELECT COUNT(*) FROM instruments i WHERE {where_sql}", params
        ).fetchone() or [0])[0]
        rows = conn.execute(sql, [process_case, *params, page_size, offset]).fetchall()

    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "process_case": process_case,
        "data": [dict(r) for r in rows],
    }


# ── Spec form templates ───────────────────────────────────────────────────────

def list_templates(instrument_type: str | None = None) -> list[dict]:
    where = "WHERE instrument_type = ?" if instrument_type else ""
    params = [instrument_type] if instrument_type else []
    with connection() as conn:
        rows = conn.execute(
            f"SELECT * FROM spec_form_templates {where} ORDER BY template_name",
            params,
        ).fetchall()
    return [row_to_dict(r) for r in rows]


def get_template_for_type(instrument_type: str) -> dict | None:
    with connection() as conn:
        row = conn.execute(
            "SELECT * FROM spec_form_templates WHERE instrument_type = ? ORDER BY is_default DESC LIMIT 1",
            (instrument_type,),
        ).fetchone()
    return row_to_dict(row)


def save_template(
    template_id: str | None,
    template_name: str,
    instrument_type: str | None,
    description: str | None,
    is_default: bool,
    field_definitions: list,
    user_id: str = "local-user",
) -> dict:
    fdef_json = json.dumps(field_definitions, separators=(",", ":"))
    with connection() as conn:
        if template_id:
            conn.execute(
                """
                UPDATE spec_form_templates
                SET template_name=?, instrument_type=?, description=?,
                    is_default=?, field_definitions=?, updated_by=?,
                    updated_at=CURRENT_TIMESTAMP
                WHERE id=?
                """,
                [template_name, instrument_type, description, int(is_default),
                 fdef_json, user_id, template_id],
            )
            row = conn.execute(
                "SELECT * FROM spec_form_templates WHERE id=?", (template_id,)
            ).fetchone()
        else:
            conn.execute(
                """
                INSERT INTO spec_form_templates
                  (template_name, instrument_type, description, is_default,
                   field_definitions, created_by, updated_by)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [template_name, instrument_type, description, int(is_default),
                 fdef_json, user_id, user_id],
            )
            row = conn.execute(
                "SELECT * FROM spec_form_templates WHERE template_name=?",
                (template_name,),
            ).fetchone()
    return row_to_dict(row)


def delete_template(template_id: str) -> bool:
    with connection() as conn:
        cur = conn.execute(
            "DELETE FROM spec_form_templates WHERE id=?", (template_id,)
        )
    return cur.rowcount > 0


def seed_default_templates(overwrite: bool = False) -> dict:
    from app.modules.datasheet.default_templates import SEED_TEMPLATES

    created = 0
    skipped = 0
    with connection() as conn:
        for tmpl in SEED_TEMPLATES:
            existing = conn.execute(
                "SELECT id FROM spec_form_templates WHERE instrument_type = ?",
                (tmpl["instrument_type"],),
            ).fetchone()
            if existing and not overwrite:
                skipped += 1
                continue
            fdef_json = json.dumps(tmpl["field_definitions"], separators=(",", ":"))
            if existing and overwrite:
                conn.execute(
                    """
                    UPDATE spec_form_templates
                    SET template_name=?, description=?, field_definitions=?,
                        is_default=1, updated_by='seed', updated_at=CURRENT_TIMESTAMP
                    WHERE id=?
                    """,
                    [tmpl["template_name"], tmpl.get("description"), fdef_json, existing["id"]],
                )
            else:
                conn.execute(
                    """
                    INSERT INTO spec_form_templates
                      (template_name, instrument_type, description, is_default,
                       field_definitions, created_by, updated_by)
                    VALUES (?, ?, ?, 1, ?, 'seed', 'seed')
                    """,
                    [tmpl["template_name"], tmpl["instrument_type"],
                     tmpl.get("description"), fdef_json],
                )
            created += 1
    return {"created": created, "skipped": skipped}


# ── Full instrument datasheet bundle ─────────────────────────────────────────

def get_instrument_bundle(instrument_id: str) -> dict | None:
    with connection() as conn:
        instr = conn.execute(
            "SELECT * FROM instruments WHERE id = ?", (instrument_id,)
        ).fetchone()
    if not instr:
        return None
    return {
        "instrument":    row_to_dict(instr),
        "process_data":  get_process_data(instrument_id),
        "spec_sheets":   get_spec_sheets(instrument_id),
        "calculations":  get_calculations(instrument_id),
    }
