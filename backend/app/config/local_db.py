"""Offline SQLite database for TPI.

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
    if settings.TPI_DB_BACKEND != "sqlite":
        raise RuntimeError(
            f"TPI_DB_BACKEND={settings.TPI_DB_BACKEND!r} is not enabled in this build. "
            "Set TPI_DB_BACKEND=sqlite or implement the enterprise storage adapter."
        )
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
        "line_candidates",
        "geometry_evidence",
        "evidence_snapshot",
        "metadata_snapshot",
        "session_snapshot",
        # calculation_data
        "calc_input",
        "calc_result",
        # spec_sheet_data
        "applicable_standards",
        "extended",
        "process_conditions",
        # spec_form_templates
        "field_definitions",
        "keywords",
        "metadata",
        "citations",
        "citation_snapshot",
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
    """Add columns / tables introduced after the first local DB release."""

    # ── Ensure tables added in later releases exist ───────────────────────────
    existing_tables = {
        row[0]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }
    if "calculation_data" not in existing_tables or "spec_sheet_data" not in existing_tables:
        conn.executescript(_SCHEMA_SQL)
        # Refresh table list after potential creation
        existing_tables = {
            row[0]
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        }

    if "mto_items" not in existing_tables or "mto_detection_evidence" not in existing_tables:
        conn.executescript(_MTO_SCHEMA_SQL)

    if (
        "project_knowledge_documents" not in existing_tables
        or "project_knowledge_chunks" not in existing_tables
        or "project_knowledge_saved_evidence" not in existing_tables
    ):
        conn.executescript(_PROJECT_KNOWLEDGE_SCHEMA_SQL)

    # ── spec_form_templates (new table) ──────────────────────────────────────
    if "ce_matrix" not in existing_tables:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS ce_matrix (
                id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                project_id    TEXT NOT NULL,
                initiator_tag TEXT NOT NULL,
                effect_tag    TEXT NOT NULL,
                action        TEXT NOT NULL DEFAULT 'X',
                voting        TEXT,
                notes         TEXT,
                created_by    TEXT,
                updated_by    TEXT,
                created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(project_id, initiator_tag, effect_tag)
            );
            CREATE INDEX IF NOT EXISTS idx_ce_project ON ce_matrix(project_id);
        """)

    if "spec_form_templates" not in existing_tables:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS spec_form_templates (
                id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                template_name     TEXT NOT NULL UNIQUE,
                instrument_type   TEXT,
                description       TEXT,
                is_default        INTEGER NOT NULL DEFAULT 0,
                field_definitions TEXT NOT NULL DEFAULT '[]',
                created_by        TEXT,
                updated_by        TEXT,
                created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_template_type ON spec_form_templates(instrument_type);
        """)

    # ── Missing project_id indexes on tables added without them ──────────────
    conn.executescript("""
        CREATE INDEX IF NOT EXISTS idx_extraction_sessions_project
            ON extraction_sessions(project_id);
        CREATE INDEX IF NOT EXISTS idx_field_history_project
            ON instrument_field_history(project_id);
        CREATE INDEX IF NOT EXISTS idx_datasheets_project
            ON datasheets(project_id);
        CREATE INDEX IF NOT EXISTS idx_pk_chat_project
            ON project_knowledge_chat(project_id);
    """)

    # ── udf_01 … udf_100 on spec_sheet_data ─────────────────────────────────
    if "spec_sheet_data" in existing_tables:
        spec_cols = {
            row[1]
            for row in conn.execute("PRAGMA table_info(spec_sheet_data)").fetchall()
        }
        for i in range(1, 101):
            col = f"udf_{i:02d}"
            if col not in spec_cols:
                conn.execute(f"ALTER TABLE spec_sheet_data ADD COLUMN {col} TEXT")

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

    instrument_columns_existing = {
        row["name"]
        for row in conn.execute("PRAGMA table_info(instruments)").fetchall()
    }
    instrument_columns = {
        "line_confidence": "REAL",
        "line_association_method": "TEXT",
        "line_association_reason": "TEXT",
        "line_candidates": "TEXT",
        "geometry_evidence": "TEXT",
    }
    for column, definition in instrument_columns.items():
        if column not in instrument_columns_existing:
            conn.execute(f"ALTER TABLE instruments ADD COLUMN {column} {definition}")


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
        ("FE", "Flow Element", "passive", "None", "flow-element", ["Flow Element", "Orifice Plate", "FE"], 21),
        ("TP", "Test Point", "passive", "None", None, ["Test Point", "TP"], 27),
        ("FI", "Flow Indicator", "field_device", "None", None, ["Flow Indicator", "FI"], 22),
        ("FIC", "Flow Indicator Controller", "controller", "Soft Link", None, ["Flow Indicator Controller", "FIC"], 23),
        ("FIT", "Flow Indicating Transmitter", "field_device", "AI", None, ["Flow Indicating Transmitter", "FIT"], 24),
        ("FQI", "Flow Quantity Indicator", "field_device", "AI", None, ["Flow Quantity Indicator", "Totalizer", "FQI"], 25),
        ("RO", "Restriction Orifice", "passive", "None", "flow-element", ["Restriction Orifice", "RO"], 26),
        ("PT", "Pressure Transmitter", "field_device", "AI", None, ["Pressure Transmitter", "PT"], 30),
        ("PIT", "Pressure Indicating Transmitter", "field_device", "AI", None, ["Pressure Indicating Transmitter", "PIT"], 31),
        ("PI", "Pressure Indicator", "field_device", "None", None, ["Pressure Indicator", "Pressure Gauge", "PI", "PG"], 32),
        ("PIC", "Pressure Indicator Controller", "controller", "Soft Link", None, ["Pressure Indicator Controller", "PIC"], 33),
        ("PDT", "Differential Pressure Transmitter", "field_device", "AI", None, ["Differential Pressure Transmitter", "PDT", "DPT"], 34),
        ("PSV", "Pressure Safety Valve", "safety", "None", "relief-valve", ["Pressure Safety Valve", "PSV", "Safety Valve", "Relief Valve"], 35),
        ("PSAH", "Pressure Switch Alarm High", "safety", "DI", None, ["Pressure Switch Alarm High", "PSAH", "PSH"], 36),
        ("PSAL", "Pressure Switch Alarm Low", "safety", "DI", None, ["Pressure Switch Alarm Low", "PSAL", "PSL"], 37),
        ("PY", "Pressure Converter (I/P)", "field_device", "AO", None, ["Pressure Converter", "I/P Converter", "PY"], 38),
        ("TT", "Temperature Transmitter", "field_device", "AI", None, ["Temperature Transmitter", "TT"], 40),
        ("TIT", "Temperature Indicating Transmitter", "field_device", "AI", None, ["Temperature Indicating Transmitter", "TIT"], 41),
        ("TI", "Temperature Indicator", "field_device", "None", None, ["Temperature Indicator", "TI"], 42),
        ("TE", "Temperature Element", "passive", "None", None, ["Thermocouple", "RTD", "Temperature Element", "TE"], 43),
        ("TW", "Thermowell", "passive", "None", None, ["Thermowell", "TW", "Thermopocket"], 44),
        ("LT", "Level Transmitter", "field_device", "AI", None, ["Level Transmitter", "LT"], 50),
        ("LIT", "Level Indicating Transmitter", "field_device", "AI", None, ["Level Indicating Transmitter", "LIT"], 51),
        ("LI", "Level Indicator", "field_device", "None", None, ["Level Indicator", "Level Gauge", "LI", "LG"], 52),
        ("LIC", "Level Indicator Controller", "controller", "Soft Link", None, ["Level Indicator Controller", "LIC"], 53),
        ("AT", "Analyzer Transmitter", "analyzer", "AI", None, ["Analyser Transmitter", "Analyzer Transmitter", "AT"], 60),
        ("VT", "Vibration Transmitter", "field_device", "AI", None, ["Vibration Transmitter", "VT"], 70),
        ("ST", "Speed Transmitter", "field_device", "AI", None, ["Speed Transmitter", "Tachometer", "ST"], 71),
        ("ZI", "Position Indicator", "field_device", "DI", None, ["Position Indicator", "ZI"], 80),
        ("ZIH", "Position Indicator High", "field_device", "DI", None, ["Position Indicator High", "ZIH"], 81),
        ("ZIL", "Position Indicator Low", "field_device", "DI", None, ["Position Indicator Low", "ZIL"], 82),
        ("CVZI", "Control Valve Position Indication", "field_device", "DI", None, ["Control Valve Position Indication", "CVZI"], 83),
        ("CVZT", "Control Valve Position Transmitter", "field_device", "AI", None, ["Control Valve Position Transmitter", "CVZT"], 84),
        ("FZT", "Valve Position Transmitter", "field_device", "AI", None, ["Valve Position Transmitter", "FZT"], 85),
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
    conn.executemany(
        """
        UPDATE instrument_type_catalog
        SET category=?, typical_io_type=?, flowsizing_type=?, updated_at=CURRENT_TIMESTAMP
        WHERE code=?
        """,
        [
            ("passive", "None", "flow-element", "FE"),
            ("passive", "None", "flow-element", "RO"),
            ("passive", "None", None, "TE"),
            ("passive", "None", None, "TP"),
            ("passive", "None", None, "TW"),
            ("controller", "Soft Link", None, "FIC"),
            ("controller", "Soft Link", None, "PIC"),
            ("controller", "Soft Link", None, "LIC"),
            ("field_device", "DI", None, "CVZI"),
            ("field_device", "AI", None, "CVZT"),
            ("field_device", "AI", None, "FZT"),
        ],
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
    line_confidence REAL,
    line_association_method TEXT,
    line_association_reason TEXT,
    line_candidates TEXT,
    geometry_evidence TEXT,
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
CREATE INDEX IF NOT EXISTS idx_instruments_line ON instruments(project_id, line_tag);
CREATE INDEX IF NOT EXISTS idx_instruments_batch ON instruments(batch_id);
CREATE INDEX IF NOT EXISTS idx_instruments_flowsizing ON instruments(project_id, flowsizing_type);
CREATE INDEX IF NOT EXISTS idx_grid_prefs_user ON user_grid_preferences(user_id);
"""

_MTO_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS mto_items (
    id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id               TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    mto_run_id               TEXT,
    component_key            TEXT NOT NULL,
    category_code            TEXT,
    category_name            TEXT,
    unit                     TEXT NOT NULL DEFAULT '-',
    item_type                TEXT NOT NULL,
    piping_class             TEXT,
    size_inch                TEXT,
    rating                   TEXT,
    valve_bore               TEXT,
    end_connection           TEXT,
    material_description     TEXT,
    datasheet_document_no    TEXT,
    datasheet_reference_no   TEXT,
    quantity                 INTEGER NOT NULL DEFAULT 0,
    drawing_count            INTEGER NOT NULL DEFAULT 0,
    min_detection_score      REAL,
    avg_detection_score      REAL,
    min_size_confidence      REAL,
    review_status            TEXT NOT NULL DEFAULT 'Draft',
    review_required          INTEGER NOT NULL DEFAULT 0,
    ai_decision              TEXT,
    ai_confidence            REAL,
    ai_reason                TEXT,
    remarks                  TEXT,
    metadata_snapshot        TEXT NOT NULL DEFAULT '{}',
    session_snapshot         TEXT NOT NULL DEFAULT '{}',
    source                   TEXT NOT NULL DEFAULT 'piping_mto',
    created_by               TEXT,
    updated_by               TEXT,
    created_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at               TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, component_key)
);

CREATE TABLE IF NOT EXISTS mto_detection_evidence (
    id                    TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id            TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    mto_item_id           TEXT NOT NULL REFERENCES mto_items(id) ON DELETE CASCADE,
    mto_run_id            TEXT,
    component_key         TEXT NOT NULL,
    component_label       TEXT NOT NULL,
    drawing               TEXT,
    page                  INTEGER NOT NULL DEFAULT 1,
    x1                    INTEGER,
    y1                    INTEGER,
    x2                    INTEGER,
    y2                    INTEGER,
    detection_score       REAL,
    size_inch             TEXT,
    size_source           TEXT,
    size_source_type      TEXT,
    size_confidence       REAL,
    size_ambiguous        INTEGER NOT NULL DEFAULT 0,
    ai_decision           TEXT,
    ai_confidence         REAL,
    ai_reason             TEXT,
    ai_flags              TEXT NOT NULL DEFAULT '[]',
    ai_line_number        TEXT,
    evidence_snapshot     TEXT NOT NULL DEFAULT '{}',
    accepted              INTEGER NOT NULL DEFAULT 1,
    review_required       INTEGER NOT NULL DEFAULT 0,
    created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mto_items_project ON mto_items(project_id);
CREATE INDEX IF NOT EXISTS idx_mto_items_type ON mto_items(project_id, item_type);
CREATE INDEX IF NOT EXISTS idx_mto_items_review ON mto_items(project_id, review_required, review_status);
CREATE INDEX IF NOT EXISTS idx_mto_items_run ON mto_items(mto_run_id);
CREATE INDEX IF NOT EXISTS idx_mto_evidence_item ON mto_detection_evidence(mto_item_id);
CREATE INDEX IF NOT EXISTS idx_mto_evidence_project ON mto_detection_evidence(project_id);
CREATE INDEX IF NOT EXISTS idx_mto_evidence_run ON mto_detection_evidence(mto_run_id);
"""

_PROJECT_KNOWLEDGE_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS project_knowledge_documents (
    id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id         TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    folder_path        TEXT,
    file_path          TEXT NOT NULL,
    file_name          TEXT NOT NULL,
    file_hash          TEXT NOT NULL,
    file_size_bytes    INTEGER,
    extension          TEXT,
    document_type      TEXT NOT NULL DEFAULT 'Project document',
    title              TEXT,
    revision           TEXT,
    status             TEXT NOT NULL DEFAULT 'indexed',
    error_message      TEXT,
    chunk_count        INTEGER NOT NULL DEFAULT 0,
    metadata           TEXT NOT NULL DEFAULT '{}',
    indexed_at         TEXT,
    created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, file_path)
);

CREATE TABLE IF NOT EXISTS project_knowledge_chunks (
    id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id     TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    document_id    TEXT NOT NULL REFERENCES project_knowledge_documents(id) ON DELETE CASCADE,
    chunk_index    INTEGER NOT NULL DEFAULT 0,
    page_number    INTEGER,
    section_title  TEXT,
    content        TEXT NOT NULL,
    token_count    INTEGER NOT NULL DEFAULT 0,
    keywords       TEXT NOT NULL DEFAULT '[]',
    embedding      BLOB,
    created_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(document_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS project_knowledge_chat (
    id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id  TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    citations   TEXT NOT NULL DEFAULT '[]',
    model       TEXT,
    status      TEXT,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_knowledge_saved_evidence (
    id                 TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id         TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    chunk_id           TEXT REFERENCES project_knowledge_chunks(id) ON DELETE SET NULL,
    document_id        TEXT REFERENCES project_knowledge_documents(id) ON DELETE SET NULL,
    question           TEXT,
    note               TEXT,
    citation_snapshot  TEXT NOT NULL DEFAULT '{}',
    created_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS idx_pk_docs_project ON project_knowledge_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_pk_docs_type ON project_knowledge_documents(project_id, document_type);
CREATE INDEX IF NOT EXISTS idx_pk_chunks_project ON project_knowledge_chunks(project_id);
CREATE INDEX IF NOT EXISTS idx_pk_chunks_doc ON project_knowledge_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_pk_saved_project ON project_knowledge_saved_evidence(project_id, created_at);
"""

_SCHEMA_SQL = _SCHEMA_SQL + _MTO_SCHEMA_SQL + _PROJECT_KNOWLEDGE_SCHEMA_SQL + """

-- ── calculation_data ─────────────────────────────────────────────────────────
-- Generic engineering calculation results, one row per instrument + calc type
-- + case. Sits alongside sizing_results (which is FlowSizing-specific); this
-- table is the normalised store for ALL calculation types used by datasheets.

CREATE TABLE IF NOT EXISTS calculation_data (
    id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id              TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    instrument_id           TEXT NOT NULL REFERENCES instruments(id)      ON DELETE CASCADE,
    tag_number              TEXT NOT NULL,

    -- What kind of calculation this is
    calc_type               TEXT NOT NULL,
    -- e.g. valve_cv | orifice_bore | relief_area | level_span |
    --      thermowell_wf | pump_head | heat_duty | dp_transmitter | generic

    case_name               TEXT NOT NULL DEFAULT 'Normal',
    -- Normal / Min / Max / Shut-off / etc.

    -- Primary result (the headline number for this calc type)
    result_value            REAL,
    result_unit             TEXT,
    result_label            TEXT,
    -- e.g. 42.3, 'US gpm / psi^0.5', 'Cv required'

    -- Secondary result (selected/derated value or governing check)
    selected_value          REAL,
    selected_unit           TEXT,
    selected_label          TEXT,
    -- e.g. 50.0, 'US gpm / psi^0.5', 'Cv selected'

    sizing_margin_pct       REAL,          -- (selected / required - 1) × 100
    governing_case          TEXT,          -- which case drove the sizing

    -- Full reproducible I/O snapshots (JSON objects)
    calc_input              TEXT NOT NULL DEFAULT '{}',
    calc_result             TEXT NOT NULL DEFAULT '{}',

    -- Workflow
    calc_status             TEXT NOT NULL DEFAULT 'Draft',
    -- Draft | For-Check | Checked | For-Approval | Approved | Superseded

    revision                TEXT NOT NULL DEFAULT 'A',
    revision_date           TEXT NOT NULL DEFAULT (date('now')),
    revision_description    TEXT,

    -- Audit trail
    calculated_by           TEXT,
    checked_by              TEXT,
    approved_by             TEXT,
    created_by              TEXT,
    updated_by              TEXT,
    created_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(project_id, instrument_id, calc_type, case_name, revision)
);

CREATE INDEX IF NOT EXISTS idx_calc_project      ON calculation_data(project_id);
CREATE INDEX IF NOT EXISTS idx_calc_instrument   ON calculation_data(project_id, instrument_id);
CREATE INDEX IF NOT EXISTS idx_calc_tag          ON calculation_data(project_id, tag_number);
CREATE INDEX IF NOT EXISTS idx_calc_type         ON calculation_data(project_id, calc_type);
CREATE INDEX IF NOT EXISTS idx_calc_status       ON calculation_data(project_id, calc_status);

-- ── spec_sheet_data ──────────────────────────────────────────────────────────
-- ISA-aligned instrument specification sheet store.
-- One row per instrument + revision. Links to process_data and
-- calculation_data so the datasheet generator can pull live values.
-- Extended JSON carries type-specific fields (orifice plate bore, valve Cv,
-- thermowell insertion, analyser range gas composition, etc.).

CREATE TABLE IF NOT EXISTS spec_sheet_data (
    id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id              TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    instrument_id           TEXT NOT NULL REFERENCES instruments(id)      ON DELETE CASCADE,
    tag_number              TEXT NOT NULL,

    -- Linked source rows (nullable — populated once data exists)
    process_data_id         TEXT REFERENCES process_data(id)      ON DELETE SET NULL,
    calculation_data_id     TEXT REFERENCES calculation_data(id)   ON DELETE SET NULL,

    -- ── Identification ───────────────────────────────────────────────────────
    service_description     TEXT,
    pid_number              TEXT,
    line_tag                TEXT,
    area_code               TEXT,
    unit_code               TEXT,
    plant_code              TEXT,

    -- ── Instrument Body ──────────────────────────────────────────────────────
    instrument_type         TEXT,               -- FT, PT, FCV, PSV, ...
    manufacturer            TEXT,
    model_number            TEXT,
    serial_number           TEXT,

    body_material           TEXT,               -- CS, SS316, Hastelloy, ...
    body_size_inch          TEXT,               -- '2"', '4"', DN50, ...
    pressure_rating         TEXT,               -- ANSI 300, ANSI 600, ...
    process_connection      TEXT,               -- Flanged RF, Screwed NPT, ...
    face_to_face_mm         REAL,

    -- ── Sensing Element / Trim ───────────────────────────────────────────────
    element_type            TEXT,
    -- orifice | vortex | coriolis | DP-cell | thermocouple | RTD | capacitance
    element_material        TEXT,
    trim_material           TEXT,               -- for valves: seat, plug, stem

    -- ── Electrical / Signal ──────────────────────────────────────────────────
    power_supply            TEXT,               -- 24 VDC loop, 110 VAC, ...
    output_signal           TEXT,               -- 4-20 mA, HART, FF H1, ...
    output_range            TEXT,               -- e.g. '4–20 mA = 0–100 barg'
    communication_protocol  TEXT,               -- HART | Foundation Fieldbus | Profibus | Modbus
    enclosure_ip_rating     TEXT,               -- IP65, IP67, ...

    -- ── Calibration / Range ──────────────────────────────────────────────────
    range_min               REAL,
    range_max               REAL,
    range_unit              TEXT,
    set_point               REAL,
    set_point_unit          TEXT,
    alarm_high              REAL,
    alarm_high_unit         TEXT,
    alarm_low               REAL,
    alarm_low_unit          TEXT,
    trip_high               REAL,
    trip_low                REAL,
    deadband                REAL,
    accuracy_pct            REAL,

    -- ── Process Conditions Summary (convenience copy from process_data) ───────
    -- Kept denormalised so a standalone spec sheet row is self-contained.
    process_conditions      TEXT NOT NULL DEFAULT '{}',
    -- JSON: { fluid, fluid_state, temp_op_c, press_op_barg, flow_normal, flow_unit, ... }

    -- ── Hazardous Area ───────────────────────────────────────────────────────
    area_classification     TEXT,               -- Zone 1, Division 2, Safe Area
    gas_group               TEXT,               -- IIA, IIB, IIC
    temp_class              TEXT,               -- T1–T6
    protection_method       TEXT,               -- Ex d, Ex ia, Ex e, Ex n
    certification_body      TEXT,               -- ATEX, IECEx, CSA, FM
    certificate_number      TEXT,

    -- ── Installation ─────────────────────────────────────────────────────────
    mounting_type           TEXT,               -- direct, remote, yoke, bracket
    orientation             TEXT,               -- vertical, horizontal, any
    inlet_straight_run      TEXT,               -- e.g. '20D upstream'
    outlet_straight_run     TEXT,               -- e.g. '5D downstream'
    insulation_required     INTEGER NOT NULL DEFAULT 0,
    heat_tracing_required   INTEGER NOT NULL DEFAULT 0,

    -- ── Applicable Standards ─────────────────────────────────────────────────
    applicable_standards    TEXT NOT NULL DEFAULT '[]',
    -- JSON array: ['ISA 5.1', 'IEC 61511', 'ASME B16.5', ...]

    -- ── Type-Specific Extended Fields ────────────────────────────────────────
    extended                TEXT NOT NULL DEFAULT '{}',
    -- JSON object for fields that only apply to certain instrument types:
    --   valves:       { cv_required, cv_selected, valve_action, fail_position, actuator_type }
    --   orifice:      { bore_mm, beta_ratio, orifice_type, tap_type }
    --   thermowell:   { insertion_mm, shank_type, wake_freq_hz, material }
    --   analyser:     { sample_conditioning, response_time_s, span_gas }
    --   relief_valve: { set_pressure_barg, back_pressure_barg, orifice_area_cm2, api_orifice }

    -- ── Document / Approval ──────────────────────────────────────────────────
    status                  TEXT NOT NULL DEFAULT 'Draft',
    -- Draft | For-Review | For-Approval | Approved | Issued-For-Construction | As-Built

    revision                TEXT NOT NULL DEFAULT 'Rev 0',
    revision_date           TEXT NOT NULL DEFAULT (date('now')),
    revision_description    TEXT,

    prepared_by             TEXT,
    checked_by              TEXT,
    approved_by             TEXT,
    issued_by               TEXT,
    issued_at               TEXT,

    pdf_path                TEXT,
    pdf_size_bytes          INTEGER,

    -- ── User-Defined Fields (SPI-style UDFs) ─────────────────────────────────
    -- 100 generic TEXT slots; labels/types/options defined in spec_form_templates
    udf_01  TEXT, udf_02  TEXT, udf_03  TEXT, udf_04  TEXT, udf_05  TEXT,
    udf_06  TEXT, udf_07  TEXT, udf_08  TEXT, udf_09  TEXT, udf_10  TEXT,
    udf_11  TEXT, udf_12  TEXT, udf_13  TEXT, udf_14  TEXT, udf_15  TEXT,
    udf_16  TEXT, udf_17  TEXT, udf_18  TEXT, udf_19  TEXT, udf_20  TEXT,
    udf_21  TEXT, udf_22  TEXT, udf_23  TEXT, udf_24  TEXT, udf_25  TEXT,
    udf_26  TEXT, udf_27  TEXT, udf_28  TEXT, udf_29  TEXT, udf_30  TEXT,
    udf_31  TEXT, udf_32  TEXT, udf_33  TEXT, udf_34  TEXT, udf_35  TEXT,
    udf_36  TEXT, udf_37  TEXT, udf_38  TEXT, udf_39  TEXT, udf_40  TEXT,
    udf_41  TEXT, udf_42  TEXT, udf_43  TEXT, udf_44  TEXT, udf_45  TEXT,
    udf_46  TEXT, udf_47  TEXT, udf_48  TEXT, udf_49  TEXT, udf_50  TEXT,
    udf_51  TEXT, udf_52  TEXT, udf_53  TEXT, udf_54  TEXT, udf_55  TEXT,
    udf_56  TEXT, udf_57  TEXT, udf_58  TEXT, udf_59  TEXT, udf_60  TEXT,
    udf_61  TEXT, udf_62  TEXT, udf_63  TEXT, udf_64  TEXT, udf_65  TEXT,
    udf_66  TEXT, udf_67  TEXT, udf_68  TEXT, udf_69  TEXT, udf_70  TEXT,
    udf_71  TEXT, udf_72  TEXT, udf_73  TEXT, udf_74  TEXT, udf_75  TEXT,
    udf_76  TEXT, udf_77  TEXT, udf_78  TEXT, udf_79  TEXT, udf_80  TEXT,
    udf_81  TEXT, udf_82  TEXT, udf_83  TEXT, udf_84  TEXT, udf_85  TEXT,
    udf_86  TEXT, udf_87  TEXT, udf_88  TEXT, udf_89  TEXT, udf_90  TEXT,
    udf_91  TEXT, udf_92  TEXT, udf_93  TEXT, udf_94  TEXT, udf_95  TEXT,
    udf_96  TEXT, udf_97  TEXT, udf_98  TEXT, udf_99  TEXT, udf_100 TEXT,

    -- ── Audit ────────────────────────────────────────────────────────────────
    created_by              TEXT,
    updated_by              TEXT,
    created_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(project_id, tag_number, revision)
);

CREATE INDEX IF NOT EXISTS idx_spec_project      ON spec_sheet_data(project_id);
CREATE INDEX IF NOT EXISTS idx_spec_instrument   ON spec_sheet_data(project_id, instrument_id);
CREATE INDEX IF NOT EXISTS idx_spec_tag          ON spec_sheet_data(project_id, tag_number);
CREATE INDEX IF NOT EXISTS idx_spec_status       ON spec_sheet_data(project_id, status);
CREATE INDEX IF NOT EXISTS idx_spec_type         ON spec_sheet_data(project_id, instrument_type);

-- ── spec_form_templates ───────────────────────────────────────────────────────
-- Defines the field layout for each instrument type's UDF spec sheet.
-- field_definitions JSON array:
--   [{ "udf":"udf_01", "label":"Body Material", "section":"Body",
--      "type":"select|text|number|textarea|checkbox",
--      "options":["CS","SS316"], "placeholder":"", "required":false }, ...]

CREATE TABLE IF NOT EXISTS spec_form_templates (
    id                TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    template_name     TEXT NOT NULL UNIQUE,
    instrument_type   TEXT,
    description       TEXT,
    is_default        INTEGER NOT NULL DEFAULT 0,
    field_definitions TEXT NOT NULL DEFAULT '[]',
    created_by        TEXT,
    updated_by        TEXT,
    created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_template_type ON spec_form_templates(instrument_type);
"""
