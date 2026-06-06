"""Offline SQLite database for XYRA Studio.

This mirrors the cloud project's shared instrument DB at a practical local
scale. It is intentionally small, dependency-free, and safe for a single
backend process in client/offline deployments.
"""
from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from app.config.settings import settings

_lock = threading.RLock()
_initialized = False


def db_path() -> Path:
    path = Path(settings.local_db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path(), timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    return conn


@contextmanager
def connection() -> Iterator[sqlite3.Connection]:
    init_db()
    with _lock:
        conn = _connect()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def row_to_dict(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    out = dict(row)
    for key in (
        "field_confidence",
        "input_snapshot",
        "result_snapshot",
        "instrument_snapshot",
        "sizing_snapshot",
        "visible_columns",
        "column_order",
        "column_widths",
        "pinned_columns",
        "saved_views",
        "aliases",
    ):
        if key in out and isinstance(out[key], str):
            try:
                out[key] = json.loads(out[key])
            except Exception:
                pass
    return out


def json_text(value, default):
    if value is None:
        value = default
    return json.dumps(value, separators=(",", ":"))


def init_db() -> None:
    global _initialized
    if _initialized:
        return
    with _lock:
        if _initialized:
            return
        conn = _connect()
        try:
            conn.executescript(_SCHEMA_SQL)
            _apply_schema_upgrades(conn)
            _seed_instrument_type_catalog(conn)
            conn.commit()
            _initialized = True
        finally:
            conn.close()


def _apply_schema_upgrades(conn: sqlite3.Connection) -> None:
    """Add columns introduced after the first local DB release."""
    table_columns = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(sizing_results)").fetchall()
    }
    sizing_columns = {
        "instrument_id": "TEXT REFERENCES instruments(id) ON DELETE SET NULL",
        "valve_opening_pct": "REAL",
        "beta_ratio": "REAL",
        "hydraulic_power_kw": "REAL",
        "duty_kw": "REAL",
        "lmtd_c": "REAL",
        "vessel_id_mm": "REAL",
        "vessel_tangential_length_mm": "REAL",
        "created_by": "TEXT",
        "updated_by": "TEXT",
        "created_at": "TEXT",
    }
    for column, definition in sizing_columns.items():
        if column not in table_columns:
            conn.execute(f"ALTER TABLE sizing_results ADD COLUMN {column} {definition}")


def _seed_instrument_type_catalog(conn: sqlite3.Connection) -> None:
    rows = [
        ("FCV", "Flow Control Valve", "final_element", "AO", "control-valve", ["Flow Control Valve", "FC Valve", "Flow Valve"], 10),
        ("PCV", "Pressure Control Valve", "final_element", "AO", "control-valve", ["Pressure Control Valve", "PC Valve"], 11),
        ("LCV", "Level Control Valve", "final_element", "AO", "control-valve", ["Level Control Valve", "LC Valve"], 12),
        ("TCV", "Temperature Control Valve", "final_element", "AO", "control-valve", ["Temperature Control Valve", "TC Valve"], 13),
        ("HCV", "Hand Control Valve", "final_element", "AO", "control-valve", ["Hand Control Valve"], 14),
        ("BDV", "Blowdown Valve", "final_element", "DO", "control-valve", ["Blowdown Valve", "BD Valve"], 15),
        ("SDV", "Shutdown Valve", "final_element", "DO", "control-valve", ["Shutdown Valve", "SD Valve", "ESD Valve"], 16),
        ("MOV", "Motor Operated Valve", "final_element", "DO", "control-valve", ["Motor Operated Valve", "MO Valve", "MOV"], 17),
        ("XV", "On-Off Valve", "final_element", "DO", "control-valve", ["On-Off Valve", "Solenoid Valve", "XV"], 18),
        ("FT", "Flow Transmitter", "field_device", "AI", None, ["Flow Transmitter", "FT"], 20),
        ("FE", "Flow Element", "field_device", "None", "flow-element", ["Flow Element", "Orifice Plate", "FE"], 21),
        ("FI", "Flow Indicator", "field_device", "None", None, ["Flow Indicator", "FI"], 22),
        ("FIC", "Flow Indicator Controller", "controller", "AI", None, ["Flow Indicator Controller", "FIC"], 23),
        ("FIT", "Flow Indicating Transmitter", "field_device", "AI", None, ["Flow Indicating Transmitter", "FIT"], 24),
        ("FQI", "Flow Quantity Indicator", "field_device", "AI", None, ["Flow Quantity Indicator", "Totalizer", "FQI"], 25),
        ("RO", "Restriction Orifice", "field_device", "None", "flow-element", ["Restriction Orifice", "RO"], 26),
        ("PT", "Pressure Transmitter", "field_device", "AI", None, ["Pressure Transmitter", "PT"], 30),
        ("PIT", "Pressure Indicating Transmitter", "field_device", "AI", None, ["Pressure Indicating Transmitter", "PIT"], 31),
        ("PI", "Pressure Indicator", "field_device", "None", None, ["Pressure Indicator", "Pressure Gauge", "PI", "PG"], 32),
        ("PIC", "Pressure Indicator Controller", "controller", "AI", None, ["Pressure Indicator Controller", "PIC"], 33),
        ("PDT", "Differential Pressure Transmitter", "field_device", "AI", None, ["Differential Pressure Transmitter", "PDT", "DPT"], 34),
        ("PSV", "Pressure Safety Valve", "safety", "None", "relief-valve", ["Pressure Safety Valve", "PSV", "Safety Valve", "Relief Valve"], 35),
        ("PSAH", "Pressure Switch Alarm High", "safety", "DI", None, ["Pressure Switch Alarm High", "PSAH", "PSH"], 36),
        ("PSAL", "Pressure Switch Alarm Low", "safety", "DI", None, ["Pressure Switch Alarm Low", "PSAL", "PSL"], 37),
        ("PY", "Pressure Converter (I/P)", "field_device", "AO", None, ["Pressure Converter", "I/P Converter", "PY"], 38),
        ("TT", "Temperature Transmitter", "field_device", "AI", None, ["Temperature Transmitter", "TT"], 40),
        ("TIT", "Temperature Indicating Transmitter", "field_device", "AI", None, ["Temperature Indicating Transmitter", "TIT"], 41),
        ("TI", "Temperature Indicator", "field_device", "None", None, ["Temperature Indicator", "TI"], 42),
        ("TE", "Temperature Element", "field_device", "AI", None, ["Thermocouple", "RTD", "Temperature Element", "TE"], 43),
        ("TW", "Thermowell", "field_device", "None", None, ["Thermowell", "TW", "Thermopocket"], 44),
        ("LT", "Level Transmitter", "field_device", "AI", None, ["Level Transmitter", "LT"], 50),
        ("LIT", "Level Indicating Transmitter", "field_device", "AI", None, ["Level Indicating Transmitter", "LIT"], 51),
        ("LI", "Level Indicator", "field_device", "None", None, ["Level Indicator", "Level Gauge", "LI", "LG"], 52),
        ("LIC", "Level Indicator Controller", "controller", "AI", None, ["Level Indicator Controller", "LIC"], 53),
        ("AT", "Analyzer Transmitter", "analyzer", "AI", None, ["Analyser Transmitter", "Analyzer Transmitter", "AT"], 60),
        ("VT", "Vibration Transmitter", "field_device", "AI", None, ["Vibration Transmitter", "VT"], 70),
        ("ST", "Speed Transmitter", "field_device", "AI", None, ["Speed Transmitter", "Tachometer", "ST"], 71),
        ("ZI", "Position Indicator", "field_device", "DI", None, ["Position Indicator", "ZI"], 80),
        ("ZIH", "Position Indicator High", "field_device", "DI", None, ["Position Indicator High", "ZIH"], 81),
        ("ZIL", "Position Indicator Low", "field_device", "DI", None, ["Position Indicator Low", "ZIL"], 82),
        ("HS", "Hand Switch", "field_device", "DI", None, ["Hand Switch", "Push Button", "HS"], 90),
        ("SSV", "Safety Shutdown Valve", "final_element", "DO", "control-valve", ["Safety Shutdown Valve", "SSV"], 100),
        ("XGD", "Gas Detector", "analyzer", "AI", None, ["Gas Detector", "Combustible Gas Detector", "XGD"], 110),
        ("XFD", "Flame/Fire Detector", "analyzer", "DI", None, ["Flame Detector", "Fire Detector", "XFD"], 111),
        ("XA", "Miscellaneous Alarm", "safety", "DI", None, ["Miscellaneous Alarm", "XA"], 112),
    ]
    conn.executemany(
        """
        INSERT OR IGNORE INTO instrument_type_catalog
          (code, display_name, category, typical_io_type, flowsizing_type, aliases, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        [(code, name, cat, io, flow, json_text(aliases, []), order) for code, name, cat, io, flow, aliases, order in rows],
    )


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY,
    name TEXT,
    project_no TEXT,
    client_name TEXT,
    contractor_name TEXT,
    location TEXT,
    country TEXT,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_settings (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL UNIQUE REFERENCES projects(project_id) ON DELETE CASCADE,
    auto_upsert_on_extract INTEGER NOT NULL DEFAULT 1,
    protect_manual_fields INTEGER NOT NULL DEFAULT 1,
    min_confidence_threshold REAL NOT NULL DEFAULT 0.60,
    flag_low_confidence_fields INTEGER NOT NULL DEFAULT 1,
    area_class_standard TEXT NOT NULL DEFAULT 'IEC 60079',
    pid_symbol_standard TEXT NOT NULL DEFAULT 'ISA 5.1',
    alarm_standard TEXT NOT NULL DEFAULT 'ISA 18.2',
    sis_standard TEXT NOT NULL DEFAULT 'IEC 61511',
    unit_system TEXT NOT NULL DEFAULT 'metric',
    pressure_unit TEXT NOT NULL DEFAULT 'barg',
    temp_unit TEXT NOT NULL DEFAULT 'C',
    flow_unit_liquid TEXT NOT NULL DEFAULT 'm3/h',
    flow_unit_gas TEXT NOT NULL DEFAULT 'MMSCFD',
    created_by TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS instrument_type_catalog (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    code TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    category TEXT NOT NULL,
    typical_io_type TEXT,
    flowsizing_type TEXT,
    datasheet_template TEXT,
    aliases TEXT NOT NULL DEFAULT '[]',
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_areas (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT REFERENCES project_areas(id) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, code)
);

CREATE TABLE IF NOT EXISTS project_units (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    area_id TEXT REFERENCES project_areas(id) ON DELETE RESTRICT,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, code)
);

CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_number TEXT NOT NULL,
    title TEXT NOT NULL,
    document_type TEXT NOT NULL,
    revision TEXT NOT NULL DEFAULT 'Rev 0',
    revision_date TEXT,
    revision_desc TEXT,
    status TEXT NOT NULL DEFAULT 'Draft',
    file_path TEXT,
    file_size_bytes INTEGER,
    created_by TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, document_number, revision)
);

CREATE TABLE IF NOT EXISTS extraction_sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    job_id TEXT,
    file_name TEXT NOT NULL,
    file_hash TEXT,
    page_count INTEGER,
    model_version TEXT,
    prompt_version TEXT,
    extraction_mode TEXT NOT NULL DEFAULT 'auto',
    tags_found INTEGER NOT NULL DEFAULT 0,
    tags_inserted INTEGER NOT NULL DEFAULT 0,
    tags_updated INTEGER NOT NULL DEFAULT 0,
    tags_skipped INTEGER NOT NULL DEFAULT 0,
    tags_low_confidence INTEGER NOT NULL DEFAULT 0,
    avg_confidence REAL,
    min_confidence REAL,
    status TEXT NOT NULL DEFAULT 'running',
    error_message TEXT,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS loops (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    loop_number TEXT NOT NULL,
    service TEXT,
    loop_type TEXT,
    criticality TEXT,
    sil_level TEXT,
    notes TEXT,
    created_by TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, loop_number)
);

CREATE TABLE IF NOT EXISTS instruments (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    tag_number TEXT NOT NULL,
    suffix TEXT,
    instrument_type TEXT NOT NULL,
    service TEXT,
    category TEXT,
    io_type TEXT,
    signal_type TEXT,
    area_id TEXT REFERENCES project_areas(id) ON DELETE SET NULL,
    unit_id TEXT REFERENCES project_units(id) ON DELETE SET NULL,
    location TEXT,
    elevation_m REAL,
    loop_id TEXT REFERENCES loops(id) ON DELETE SET NULL,
    loop_number TEXT,
    pid_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    pid_number TEXT,
    area_code TEXT,
    unit_code TEXT,
    line_tag TEXT,
    system TEXT,
    flowsizing_type TEXT,
    extraction_session_id TEXT REFERENCES extraction_sessions(id) ON DELETE SET NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    field_confidence TEXT,
    range_min REAL,
    range_max REAL,
    range_unit TEXT,
    calib_min REAL,
    calib_max REAL,
    calib_unit TEXT,
    supply_voltage TEXT,
    hazardous_area INTEGER NOT NULL DEFAULT 0,
    area_class TEXT,
    is_certified INTEGER NOT NULL DEFAULT 0,
    enclosure_class TEXT,
    status TEXT NOT NULL DEFAULT 'Draft',
    review_required INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    active_on_pid INTEGER NOT NULL DEFAULT 1,
    batch_id TEXT,
    created_by TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, tag_number)
);

CREATE TABLE IF NOT EXISTS instrument_field_history (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    field_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    change_source TEXT NOT NULL,
    was_ai_correction INTEGER NOT NULL DEFAULT 0,
    ai_confidence_was REAL,
    extraction_session_id TEXT REFERENCES extraction_sessions(id) ON DELETE SET NULL,
    changed_by TEXT,
    changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    change_note TEXT
);

CREATE TABLE IF NOT EXISTS process_data (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    instrument_id TEXT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    case_name TEXT NOT NULL DEFAULT 'Normal',
    fluid TEXT,
    fluid_state TEXT,
    temp_operating_c REAL,
    temp_design_c REAL,
    temp_min_c REAL,
    press_operating_barg REAL,
    press_design_barg REAL,
    press_min_barg REAL,
    press_atmospheric_bara REAL NOT NULL DEFAULT 1.01325,
    flow_rate REAL,
    flow_rate_unit TEXT,
    flow_normal REAL,
    flow_max REAL,
    flow_min REAL,
    flow_unit TEXT,
    density_liquid_kgm3 REAL,
    density_vapour_kgm3 REAL,
    viscosity_cp REAL,
    molecular_weight REAL,
    specific_gravity REAL,
    vapour_pressure_barg REAL,
    critical_pressure_barg REAL,
    cp_cv_ratio REAL,
    compressibility_factor REAL,
    extended TEXT,
    created_by TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, instrument_id, case_name)
);

CREATE TABLE IF NOT EXISTS sizing_results (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    tag_number TEXT NOT NULL,
    instrument_type TEXT NOT NULL,
    input_snapshot TEXT NOT NULL,
    result_snapshot TEXT NOT NULL,
    sizing_status TEXT,
    governing_case TEXT,
    selected_cv REAL,
    orifice_bore_mm REAL,
    required_area_cm2 REAL,
    selected_api_orifice TEXT,
    tdh_m REAL,
    motor_power_kw REAL,
    heat_area_m2 REAL,
    vessel_diameter_mm REAL,
    vessel_length_mm REAL,
    report_revision TEXT DEFAULT 'Rev 0',
    pdf_path TEXT,
    calculated_by TEXT,
    calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, tag_number, instrument_type)
);

CREATE TABLE IF NOT EXISTS datasheets (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    tag_number TEXT NOT NULL,
    revision TEXT NOT NULL DEFAULT 'Rev 0',
    revision_date TEXT NOT NULL DEFAULT (date('now')),
    revision_description TEXT,
    instrument_snapshot TEXT,
    sizing_snapshot TEXT,
    pdf_path TEXT,
    pdf_size_bytes INTEGER,
    status TEXT DEFAULT 'Draft',
    issued_by TEXT,
    issued_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_grid_preferences (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    user_id TEXT NOT NULL,
    datasource_id TEXT NOT NULL,
    visible_columns TEXT NOT NULL DEFAULT '[]',
    column_order TEXT NOT NULL DEFAULT '[]',
    column_widths TEXT NOT NULL DEFAULT '{}',
    pinned_columns TEXT NOT NULL DEFAULT '[]',
    saved_views TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, datasource_id)
);

CREATE INDEX IF NOT EXISTS idx_instruments_project ON instruments(project_id);
CREATE INDEX IF NOT EXISTS idx_instruments_tag ON instruments(project_id, tag_number);
CREATE INDEX IF NOT EXISTS idx_instruments_loop ON instruments(project_id, loop_number);
CREATE INDEX IF NOT EXISTS idx_instruments_type ON instruments(project_id, instrument_type);
CREATE INDEX IF NOT EXISTS idx_instruments_status ON instruments(project_id, status);
CREATE INDEX IF NOT EXISTS idx_instruments_batch ON instruments(batch_id);
CREATE INDEX IF NOT EXISTS idx_instruments_flowsizing ON instruments(project_id, flowsizing_type);
CREATE INDEX IF NOT EXISTS idx_grid_prefs_user ON user_grid_preferences(user_id);
"""
