"""
Tests for the three datasheet-pipeline tables:
  process_data      — already existed; verify columns + FK + JSON
  calculation_data  — new; full CRUD, multi-case, multi-type, JSON decoding
  spec_sheet_data   — new; full CRUD, FK chain, JSON decoding, approval workflow
  _apply_schema_upgrades — verify existing DBs without new tables get them added
"""
import json
import sqlite3

import pytest

from app.config import local_db
from app.config.settings import settings


# ── Test DB helpers ──────────────────────────────────────────────────────────

def _use_temp_db(tmp_path):
    previous = settings.XYRA_DB_PATH
    settings.XYRA_DB_PATH = str(tmp_path / "test_datasheet.db")
    local_db._initialized = False
    local_db.init_db()
    return previous


def _restore_db(previous):
    settings.XYRA_DB_PATH = previous
    local_db._initialized = False


def _seed_project_and_instrument(conn) -> tuple[str, str]:
    """Insert minimal project + instrument rows, return (project_id, instrument_id)."""
    conn.execute(
        "INSERT INTO projects (project_id, name) VALUES ('P-DS-001', 'Datasheet Test Project')"
    )
    row = conn.execute(
        """
        INSERT INTO instruments (project_id, tag_number, instrument_type)
        VALUES ('P-DS-001', '101-PT-001', 'PT')
        RETURNING id
        """
    ).fetchone()
    return "P-DS-001", row["id"]


# ── 1. Schema integrity ──────────────────────────────────────────────────────

def test_all_three_tables_exist(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            tables = {
                r[0]
                for r in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
        assert "process_data"     in tables
        assert "calculation_data" in tables
        assert "spec_sheet_data"  in tables
    finally:
        _restore_db(prev)


def test_process_data_has_required_columns(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(process_data)").fetchall()}
        required = {
            "id", "project_id", "instrument_id", "case_name",
            "fluid", "fluid_state",
            "temp_operating_c", "temp_design_c",
            "press_operating_barg", "press_design_barg",
            "flow_normal", "flow_max", "flow_min", "flow_unit",
            "density_liquid_kgm3", "density_vapour_kgm3",
            "viscosity_cp", "molecular_weight", "specific_gravity",
            "vapour_pressure_barg", "critical_pressure_barg",
            "cp_cv_ratio", "compressibility_factor",
            "created_at", "updated_at",
        }
        assert required <= cols
    finally:
        _restore_db(prev)


def test_calculation_data_has_required_columns(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(calculation_data)").fetchall()}
        required = {
            "id", "project_id", "instrument_id", "tag_number",
            "calc_type", "case_name",
            "result_value", "result_unit", "result_label",
            "selected_value", "selected_unit", "selected_label",
            "sizing_margin_pct", "governing_case",
            "calc_input", "calc_result",
            "calc_status", "revision", "revision_date",
            "calculated_by", "checked_by", "approved_by",
            "created_at", "updated_at",
        }
        assert required <= cols
    finally:
        _restore_db(prev)


def test_spec_sheet_data_has_required_columns(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(spec_sheet_data)").fetchall()}
        required = {
            "id", "project_id", "instrument_id", "tag_number",
            "process_data_id", "calculation_data_id",
            "service_description", "pid_number", "line_tag",
            "manufacturer", "model_number",
            "body_material", "body_size_inch", "pressure_rating", "process_connection",
            "element_type", "element_material", "trim_material",
            "power_supply", "output_signal", "communication_protocol",
            "range_min", "range_max", "range_unit",
            "alarm_high", "alarm_low", "trip_high", "trip_low",
            "area_classification", "gas_group", "temp_class", "protection_method",
            "mounting_type", "orientation",
            "applicable_standards", "extended", "process_conditions",
            "status", "revision", "revision_date",
            "prepared_by", "checked_by", "approved_by",
            "pdf_path", "created_at", "updated_at",
        }
        assert required <= cols
    finally:
        _restore_db(prev)


# ── 2. Indexes exist ─────────────────────────────────────────────────────────

def test_calculation_data_indexes_exist(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            idx = {
                r[1]
                for r in conn.execute("PRAGMA index_list(calculation_data)").fetchall()
            }
        assert "idx_calc_project"    in idx
        assert "idx_calc_instrument" in idx
        assert "idx_calc_tag"        in idx
        assert "idx_calc_type"       in idx
        assert "idx_calc_status"     in idx
    finally:
        _restore_db(prev)


def test_spec_sheet_data_indexes_exist(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            idx = {
                r[1]
                for r in conn.execute("PRAGMA index_list(spec_sheet_data)").fetchall()
            }
        assert "idx_spec_project"    in idx
        assert "idx_spec_instrument" in idx
        assert "idx_spec_tag"        in idx
        assert "idx_spec_status"     in idx
        assert "idx_spec_type"       in idx
    finally:
        _restore_db(prev)


# ── 3. FK wiring: process_data ───────────────────────────────────────────────

def test_process_data_fk_to_instrument(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            conn.execute(
                """
                INSERT INTO process_data
                  (project_id, instrument_id, case_name, fluid, fluid_state,
                   temp_operating_c, press_operating_barg, flow_normal, flow_unit)
                VALUES (?, ?, 'Normal', 'Natural Gas', 'Gas', 45.0, 68.5, 12500.0, 'MMSCFD')
                """,
                (project_id, instrument_id),
            )
            row = conn.execute(
                "SELECT * FROM process_data WHERE instrument_id = ?", (instrument_id,)
            ).fetchone()

        assert row is not None
        assert row["fluid"] == "Natural Gas"
        assert row["temp_operating_c"] == 45.0
        assert row["press_operating_barg"] == 68.5
    finally:
        _restore_db(prev)


def test_process_data_rejects_unknown_instrument(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with pytest.raises(sqlite3.IntegrityError):
            with local_db.connection() as conn:
                conn.execute(
                    """
                    INSERT INTO process_data (project_id, instrument_id, case_name)
                    VALUES ('P-DS-001', 'nonexistent-id', 'Normal')
                    """
                )
    finally:
        _restore_db(prev)


def test_process_data_cascade_deletes_with_instrument(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            conn.execute(
                "INSERT INTO process_data (project_id, instrument_id, case_name) VALUES (?, ?, 'Normal')",
                (project_id, instrument_id),
            )
            conn.execute("DELETE FROM instruments WHERE id = ?", (instrument_id,))
            remaining = conn.execute(
                "SELECT COUNT(*) FROM process_data WHERE instrument_id = ?", (instrument_id,)
            ).fetchone()[0]

        assert remaining == 0
    finally:
        _restore_db(prev)


def test_process_data_unique_constraint(tmp_path):
    """Same instrument + case_name twice → IntegrityError."""
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            conn.execute(
                "INSERT INTO process_data (project_id, instrument_id, case_name) VALUES (?, ?, 'Normal')",
                (project_id, instrument_id),
            )
        with pytest.raises(sqlite3.IntegrityError):
            with local_db.connection() as conn:
                conn.execute(
                    "INSERT INTO process_data (project_id, instrument_id, case_name) VALUES (?, ?, 'Normal')",
                    (project_id, instrument_id),
                )
    finally:
        _restore_db(prev)


def test_process_data_multiple_cases(tmp_path):
    """Normal / Min / Max cases all allowed for same instrument."""
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            for case, flow in [("Normal", 12500.0), ("Min", 6000.0), ("Max", 18000.0)]:
                conn.execute(
                    """
                    INSERT INTO process_data
                      (project_id, instrument_id, case_name, flow_normal, flow_unit)
                    VALUES (?, ?, ?, ?, 'MMSCFD')
                    """,
                    (project_id, instrument_id, case, flow),
                )
            count = conn.execute(
                "SELECT COUNT(*) FROM process_data WHERE instrument_id = ?", (instrument_id,)
            ).fetchone()[0]
        assert count == 3
    finally:
        _restore_db(prev)


# ── 4. FK wiring: calculation_data ───────────────────────────────────────────

def test_calculation_data_crud(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            row_id = conn.execute(
                """
                INSERT INTO calculation_data
                  (project_id, instrument_id, tag_number, calc_type, case_name,
                   result_value, result_unit, result_label,
                   selected_value, selected_unit, selected_label,
                   sizing_margin_pct, governing_case,
                   calc_input, calc_result, calc_status)
                VALUES (?, ?, '101-PT-001', 'valve_cv', 'Normal',
                        42.3, 'US gpm/psi^0.5', 'Cv required',
                        50.0, 'US gpm/psi^0.5', 'Cv selected',
                        18.2, 'Normal',
                        ?, ?, 'Draft')
                RETURNING id
                """,
                (
                    project_id, instrument_id,
                    json.dumps({"dp_barg": 0.5, "flow_m3h": 45.0, "fluid": "crude oil"}),
                    json.dumps({"cv_required": 42.3, "cv_selected": 50.0, "margin_pct": 18.2}),
                ),
            ).fetchone()

            row = conn.execute(
                "SELECT * FROM calculation_data WHERE id = ?", (row_id["id"],)
            ).fetchone()

        decoded = local_db.row_to_dict(row)
        assert decoded["result_value"]      == 42.3
        assert decoded["selected_value"]    == 50.0
        assert decoded["sizing_margin_pct"] == 18.2
        assert decoded["calc_status"]       == "Draft"
        assert decoded["calc_input"]["dp_barg"]            == 0.5
        assert decoded["calc_result"]["cv_required"]       == 42.3
        assert decoded["calc_result"]["margin_pct"]        == 18.2
    finally:
        _restore_db(prev)


def test_calculation_data_multiple_calc_types(tmp_path):
    """Same instrument can have valve_cv, orifice_bore, thermowell_wf simultaneously."""
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            for calc_type, val in [
                ("valve_cv",     42.3),
                ("orifice_bore", 52.7),
                ("thermowell_wf", 8.3),
            ]:
                conn.execute(
                    """
                    INSERT INTO calculation_data
                      (project_id, instrument_id, tag_number, calc_type, case_name,
                       result_value, calc_input, calc_result)
                    VALUES (?, ?, '101-PT-001', ?, 'Normal', ?, '{}', '{}')
                    """,
                    (project_id, instrument_id, calc_type, val),
                )
            count = conn.execute(
                "SELECT COUNT(*) FROM calculation_data WHERE instrument_id = ?", (instrument_id,)
            ).fetchone()[0]
        assert count == 3
    finally:
        _restore_db(prev)


def test_calculation_data_multiple_cases_same_type(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            for case, cv in [("Normal", 42.3), ("Max", 61.8), ("Min", 18.0)]:
                conn.execute(
                    """
                    INSERT INTO calculation_data
                      (project_id, instrument_id, tag_number, calc_type, case_name,
                       result_value, calc_input, calc_result)
                    VALUES (?, ?, '101-PT-001', 'valve_cv', ?, ?, '{}', '{}')
                    """,
                    (project_id, instrument_id, case, cv),
                )
            rows = conn.execute(
                "SELECT case_name, result_value FROM calculation_data WHERE instrument_id = ? ORDER BY case_name",
                (instrument_id,),
            ).fetchall()
        assert len(rows) == 3
        cases = {r["case_name"]: r["result_value"] for r in rows}
        assert cases["Normal"] == 42.3
        assert cases["Max"]    == 61.8
        assert cases["Min"]    == 18.0
    finally:
        _restore_db(prev)


def test_calculation_data_unique_constraint(tmp_path):
    """Same project + instrument + calc_type + case + revision → IntegrityError."""
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            conn.execute(
                """
                INSERT INTO calculation_data
                  (project_id, instrument_id, tag_number, calc_type, case_name, calc_input, calc_result)
                VALUES (?, ?, '101-PT-001', 'valve_cv', 'Normal', '{}', '{}')
                """,
                (project_id, instrument_id),
            )
        with pytest.raises(sqlite3.IntegrityError):
            with local_db.connection() as conn:
                conn.execute(
                    """
                    INSERT INTO calculation_data
                      (project_id, instrument_id, tag_number, calc_type, case_name, calc_input, calc_result)
                    VALUES (?, ?, '101-PT-001', 'valve_cv', 'Normal', '{}', '{}')
                    """,
                    (project_id, instrument_id),
                )
    finally:
        _restore_db(prev)


def test_calculation_data_cascade_deletes_with_instrument(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            conn.execute(
                """
                INSERT INTO calculation_data
                  (project_id, instrument_id, tag_number, calc_type, case_name, calc_input, calc_result)
                VALUES (?, ?, '101-PT-001', 'valve_cv', 'Normal', '{}', '{}')
                """,
                (project_id, instrument_id),
            )
            conn.execute("DELETE FROM instruments WHERE id = ?", (instrument_id,))
            remaining = conn.execute(
                "SELECT COUNT(*) FROM calculation_data WHERE instrument_id = ?", (instrument_id,)
            ).fetchone()[0]
        assert remaining == 0
    finally:
        _restore_db(prev)


def test_calculation_data_status_workflow(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            conn.execute(
                """
                INSERT INTO calculation_data
                  (project_id, instrument_id, tag_number, calc_type, case_name,
                   calc_status, calculated_by, checked_by, approved_by, calc_input, calc_result)
                VALUES (?, ?, '101-PT-001', 'relief_area', 'Normal',
                        'Approved', 'eng-1', 'sr-eng-2', 'lead-3', '{}', '{}')
                """,
                (project_id, instrument_id),
            )
            row = conn.execute(
                "SELECT calc_status, calculated_by, checked_by, approved_by FROM calculation_data"
            ).fetchone()
        assert row["calc_status"]    == "Approved"
        assert row["calculated_by"]  == "eng-1"
        assert row["checked_by"]     == "sr-eng-2"
        assert row["approved_by"]    == "lead-3"
    finally:
        _restore_db(prev)


# ── 5. FK wiring: spec_sheet_data ────────────────────────────────────────────

def test_spec_sheet_crud_and_json_decoding(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)

            # seed process_data so we can reference it
            pd_id = conn.execute(
                """
                INSERT INTO process_data
                  (project_id, instrument_id, case_name, fluid, fluid_state,
                   temp_operating_c, press_operating_barg, flow_normal, flow_unit)
                VALUES (?, ?, 'Normal', 'Crude Oil', 'Liquid', 60.0, 55.0, 1200.0, 'm3/h')
                RETURNING id
                """,
                (project_id, instrument_id),
            ).fetchone()["id"]

            # seed calculation_data
            cd_id = conn.execute(
                """
                INSERT INTO calculation_data
                  (project_id, instrument_id, tag_number, calc_type, case_name,
                   result_value, selected_value, sizing_margin_pct, calc_input, calc_result)
                VALUES (?, ?, '101-PT-001', 'valve_cv', 'Normal',
                        42.3, 50.0, 18.2, '{}', '{}')
                RETURNING id
                """,
                (project_id, instrument_id),
            ).fetchone()["id"]

            process_cond = {
                "fluid": "Crude Oil", "fluid_state": "Liquid",
                "temp_op_c": 60.0, "press_op_barg": 55.0,
                "flow_normal": 1200.0, "flow_unit": "m3/h",
            }
            standards = ["ISA 5.1", "IEC 61511", "ASME B16.5"]
            extended  = {
                "cv_required": 42.3, "cv_selected": 50.0,
                "valve_action": "Air-to-Close", "fail_position": "Fail-Closed",
            }

            conn.execute(
                """
                INSERT INTO spec_sheet_data (
                    project_id, instrument_id, tag_number,
                    process_data_id, calculation_data_id,
                    service_description, pid_number, line_tag,
                    instrument_type, manufacturer, model_number,
                    body_material, body_size_inch, pressure_rating,
                    element_type, output_signal, communication_protocol,
                    range_min, range_max, range_unit,
                    area_classification, gas_group, temp_class, protection_method,
                    process_conditions, applicable_standards, extended,
                    status, revision, prepared_by
                ) VALUES (
                    ?, ?, '101-PT-001',
                    ?, ?,
                    'Crude Inlet Pressure', 'P-101', '6-CS-1001-A',
                    'PT', 'Emerson', '3051C',
                    'SS316', '2"', 'ANSI 300',
                    'DP-cell', '4-20 mA HART', 'HART 7',
                    0.0, 100.0, 'barg',
                    'Zone 1', 'IIB', 'T4', 'Ex ia IIB T4',
                    ?, ?, ?,
                    'For-Approval', 'Rev 1', 'eng-1'
                )
                """,
                (
                    project_id, instrument_id,
                    pd_id, cd_id,
                    json.dumps(process_cond),
                    json.dumps(standards),
                    json.dumps(extended),
                ),
            )
            row = conn.execute(
                "SELECT * FROM spec_sheet_data WHERE instrument_id = ?", (instrument_id,)
            ).fetchone()

        decoded = local_db.row_to_dict(row)
        assert decoded["service_description"]      == "Crude Inlet Pressure"
        assert decoded["manufacturer"]             == "Emerson"
        assert decoded["range_min"]                == 0.0
        assert decoded["range_max"]                == 100.0
        assert decoded["area_classification"]      == "Zone 1"
        assert decoded["gas_group"]                == "IIB"
        assert decoded["status"]                   == "For-Approval"
        assert decoded["revision"]                 == "Rev 1"
        # JSON fields decoded correctly
        assert decoded["process_conditions"]["fluid"]        == "Crude Oil"
        assert decoded["process_conditions"]["press_op_barg"] == 55.0
        assert decoded["applicable_standards"]               == ["ISA 5.1", "IEC 61511", "ASME B16.5"]
        assert decoded["extended"]["valve_action"]           == "Air-to-Close"
        assert decoded["extended"]["cv_required"]            == 42.3
        # FK back-links
        assert decoded["process_data_id"]     == pd_id
        assert decoded["calculation_data_id"] == cd_id
    finally:
        _restore_db(prev)


def test_spec_sheet_unique_tag_revision(tmp_path):
    """Same tag + revision → IntegrityError."""
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            conn.execute(
                """
                INSERT INTO spec_sheet_data
                  (project_id, instrument_id, tag_number, revision,
                   process_conditions, applicable_standards, extended)
                VALUES (?, ?, '101-PT-001', 'Rev 0', '{}', '[]', '{}')
                """,
                (project_id, instrument_id),
            )
        with pytest.raises(sqlite3.IntegrityError):
            with local_db.connection() as conn:
                conn.execute(
                    """
                    INSERT INTO spec_sheet_data
                      (project_id, instrument_id, tag_number, revision,
                       process_conditions, applicable_standards, extended)
                    VALUES (?, ?, '101-PT-001', 'Rev 0', '{}', '[]', '{}')
                    """,
                    (project_id, instrument_id),
                )
    finally:
        _restore_db(prev)


def test_spec_sheet_multiple_revisions(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            for rev, status in [
                ("Rev 0", "Draft"),
                ("Rev 1", "For-Approval"),
                ("Rev 2", "Approved"),
            ]:
                conn.execute(
                    """
                    INSERT INTO spec_sheet_data
                      (project_id, instrument_id, tag_number, revision, status,
                       process_conditions, applicable_standards, extended)
                    VALUES (?, ?, '101-PT-001', ?, ?, '{}', '[]', '{}')
                    """,
                    (project_id, instrument_id, rev, status),
                )
            rows = conn.execute(
                "SELECT revision, status FROM spec_sheet_data WHERE instrument_id = ? ORDER BY revision",
                (instrument_id,),
            ).fetchall()
        assert len(rows) == 3
        assert rows[2]["status"] == "Approved"
    finally:
        _restore_db(prev)


def test_spec_sheet_cascade_deletes_with_instrument(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            conn.execute(
                """
                INSERT INTO spec_sheet_data
                  (project_id, instrument_id, tag_number, process_conditions,
                   applicable_standards, extended)
                VALUES (?, ?, '101-PT-001', '{}', '[]', '{}')
                """,
                (project_id, instrument_id),
            )
            conn.execute("DELETE FROM instruments WHERE id = ?", (instrument_id,))
            remaining = conn.execute(
                "SELECT COUNT(*) FROM spec_sheet_data WHERE instrument_id = ?", (instrument_id,)
            ).fetchone()[0]
        assert remaining == 0
    finally:
        _restore_db(prev)


def test_spec_sheet_null_fks_allowed(tmp_path):
    """process_data_id and calculation_data_id are nullable — sheet can exist before data."""
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            conn.execute(
                """
                INSERT INTO spec_sheet_data
                  (project_id, instrument_id, tag_number, process_conditions,
                   applicable_standards, extended)
                VALUES (?, ?, '101-PT-001', '{}', '[]', '{}')
                """,
                (project_id, instrument_id),
            )
            row = conn.execute("SELECT process_data_id, calculation_data_id FROM spec_sheet_data").fetchone()
        assert row["process_data_id"]    is None
        assert row["calculation_data_id"] is None
    finally:
        _restore_db(prev)


def test_spec_sheet_rejects_unknown_process_data_fk(tmp_path):
    """FK to non-existent process_data row → IntegrityError."""
    prev = _use_temp_db(tmp_path)
    try:
        with pytest.raises(sqlite3.IntegrityError):
            with local_db.connection() as conn:
                project_id, instrument_id = _seed_project_and_instrument(conn)
                conn.execute(
                    """
                    INSERT INTO spec_sheet_data
                      (project_id, instrument_id, tag_number, process_data_id,
                       process_conditions, applicable_standards, extended)
                    VALUES (?, ?, '101-PT-001', 'bad-pd-id', '{}', '[]', '{}')
                    """,
                    (project_id, instrument_id),
                )
    finally:
        _restore_db(prev)


# ── 6. Full FK chain: instrument → process_data → calculation_data → spec_sheet ──

def test_full_fk_chain(tmp_path):
    """All four tables linked; cascade delete from instrument cleans all three."""
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)

            pd_id = conn.execute(
                """
                INSERT INTO process_data
                  (project_id, instrument_id, case_name, fluid, flow_normal, flow_unit)
                VALUES (?, ?, 'Normal', 'Gas', 5000.0, 'Sm3/h')
                RETURNING id
                """,
                (project_id, instrument_id),
            ).fetchone()["id"]

            cd_id = conn.execute(
                """
                INSERT INTO calculation_data
                  (project_id, instrument_id, tag_number, calc_type, case_name,
                   calc_input, calc_result)
                VALUES (?, ?, '101-PT-001', 'orifice_bore', 'Normal', '{}', '{}')
                RETURNING id
                """,
                (project_id, instrument_id),
            ).fetchone()["id"]

            conn.execute(
                """
                INSERT INTO spec_sheet_data
                  (project_id, instrument_id, tag_number,
                   process_data_id, calculation_data_id,
                   process_conditions, applicable_standards, extended)
                VALUES (?, ?, '101-PT-001', ?, ?, '{}', '[]', '{}')
                """,
                (project_id, instrument_id, pd_id, cd_id),
            )

            # Verify all three rows exist
            assert conn.execute("SELECT COUNT(*) FROM process_data").fetchone()[0]     == 1
            assert conn.execute("SELECT COUNT(*) FROM calculation_data").fetchone()[0] == 1
            assert conn.execute("SELECT COUNT(*) FROM spec_sheet_data").fetchone()[0]  == 1

            # Delete the instrument → cascades everywhere
            conn.execute("DELETE FROM instruments WHERE id = ?", (instrument_id,))

            assert conn.execute("SELECT COUNT(*) FROM process_data").fetchone()[0]     == 0
            assert conn.execute("SELECT COUNT(*) FROM calculation_data").fetchone()[0] == 0
            assert conn.execute("SELECT COUNT(*) FROM spec_sheet_data").fetchone()[0]  == 0
    finally:
        _restore_db(prev)


# ── 7. Upgrade path: existing DB without new tables gets them ────────────────

def test_schema_upgrade_adds_new_tables_to_existing_db(tmp_path):
    """
    Simulate a DB that was created before calculation_data / spec_sheet_data
    existed, then verify _apply_schema_upgrades adds them.
    """
    db_file = tmp_path / "legacy.db"
    prev = settings.XYRA_DB_PATH
    settings.XYRA_DB_PATH = str(db_file)
    local_db._initialized = False

    try:
        # Create a DB with only the old tables (drop new ones after init)
        local_db.init_db()

        # Manually drop the new tables to simulate legacy state
        conn = sqlite3.connect(str(db_file))
        conn.execute("DROP TABLE IF EXISTS calculation_data")
        conn.execute("DROP TABLE IF EXISTS spec_sheet_data")
        conn.commit()
        conn.close()

        # Confirm they're gone
        conn = sqlite3.connect(str(db_file))
        tables_before = {
            r[0]
            for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        conn.close()
        assert "calculation_data" not in tables_before
        assert "spec_sheet_data"  not in tables_before

        # Re-init — _apply_schema_upgrades should add them back
        local_db._initialized = False
        local_db.init_db()

        conn = sqlite3.connect(str(db_file))
        tables_after = {
            r[0]
            for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }
        conn.close()
        assert "calculation_data" in tables_after
        assert "spec_sheet_data"  in tables_after

    finally:
        settings.XYRA_DB_PATH = prev
        local_db._initialized = False


# ── 8. row_to_dict decodes all new JSON columns ──────────────────────────────

def test_row_to_dict_decodes_calc_data_json(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            conn.execute(
                """
                INSERT INTO calculation_data
                  (project_id, instrument_id, tag_number, calc_type, case_name,
                   calc_input, calc_result)
                VALUES (?, ?, '101-PT-001', 'generic', 'Normal',
                        '{"key":"val"}', '{"out":99}')
                """,
                (project_id, instrument_id),
            )
            raw = conn.execute("SELECT calc_input, calc_result FROM calculation_data").fetchone()

        # raw should be strings in SQLite
        assert isinstance(raw["calc_input"],  str)
        assert isinstance(raw["calc_result"], str)

        decoded = local_db.row_to_dict(raw)
        assert decoded["calc_input"]["key"]  == "val"
        assert decoded["calc_result"]["out"] == 99
    finally:
        _restore_db(prev)


def test_row_to_dict_decodes_spec_sheet_json(tmp_path):
    prev = _use_temp_db(tmp_path)
    try:
        with local_db.connection() as conn:
            project_id, instrument_id = _seed_project_and_instrument(conn)
            conn.execute(
                """
                INSERT INTO spec_sheet_data
                  (project_id, instrument_id, tag_number,
                   process_conditions, applicable_standards, extended)
                VALUES (?, ?, '101-PT-001',
                        '{"fluid":"gas"}',
                        '["ISA 5.1","IEC 61511"]',
                        '{"cv":42.3}')
                """,
                (project_id, instrument_id),
            )
            raw = conn.execute(
                "SELECT process_conditions, applicable_standards, extended FROM spec_sheet_data"
            ).fetchone()

        decoded = local_db.row_to_dict(raw)
        assert decoded["process_conditions"]["fluid"] == "gas"
        assert decoded["applicable_standards"]        == ["ISA 5.1", "IEC 61511"]
        assert decoded["extended"]["cv"]              == 42.3
    finally:
        _restore_db(prev)
