from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _rows(conn: sqlite3.Connection, sql: str, params: tuple[Any, ...]) -> list[dict[str, Any]]:
    return [_decode_json_fields(dict(row)) for row in conn.execute(sql, params).fetchall()]


def _decode_json_fields(row: dict[str, Any]) -> dict[str, Any]:
    for key in ("line_candidates", "geometry_evidence", "field_confidence"):
        value = row.get(key)
        if not isinstance(value, str) or not value.strip():
            continue
        try:
            row[key] = json.loads(value)
        except Exception:
            pass
    return row


def _columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row["name"]) for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _optional_column(existing: set[str], column: str) -> str:
    return column if column in existing else f"NULL AS {column}"


def read_project_context(db_path: Path, project_id: str) -> dict[str, Any]:
    with _connect(db_path) as conn:
        project = conn.execute("SELECT * FROM projects WHERE project_id=?", (project_id,)).fetchone()
        counts = {
            "instruments": conn.execute("SELECT COUNT(*) FROM instruments WHERE project_id=?", (project_id,)).fetchone()[0],
            "active_instruments": conn.execute(
                "SELECT COUNT(*) FROM instruments WHERE project_id=? AND active_on_pid=1", (project_id,)
            ).fetchone()[0],
            "rejected_noise": conn.execute(
                "SELECT COUNT(*) FROM instruments WHERE project_id=? AND status='Rejected - Noise'", (project_id,)
            ).fetchone()[0],
            "sessions": conn.execute("SELECT COUNT(*) FROM extraction_sessions WHERE project_id=?", (project_id,)).fetchone()[0],
            "review_required": conn.execute(
                "SELECT COUNT(*) FROM instruments WHERE project_id=? AND review_required=1 AND active_on_pid=1", (project_id,)
            ).fetchone()[0],
            "missing_service": conn.execute(
                "SELECT COUNT(*) FROM instruments WHERE project_id=? AND COALESCE(service,'')='' AND active_on_pid=1", (project_id,)
            ).fetchone()[0],
            "missing_line_tag": conn.execute(
                "SELECT COUNT(*) FROM instruments WHERE project_id=? AND COALESCE(line_tag,'')='' AND active_on_pid=1", (project_id,)
            ).fetchone()[0],
        }
        by_type = _rows(
            conn,
            """
            SELECT COALESCE(NULLIF(instrument_type,''),'UNKNOWN') AS key, COUNT(*) AS count
            FROM instruments WHERE project_id=? AND active_on_pid=1
            GROUP BY key ORDER BY count DESC, key LIMIT 25
            """,
            (project_id,),
        )
    return {"project": dict(project) if project else {"project_id": project_id}, "counts": counts, "by_type": by_type}


def read_instrument_rows(db_path: Path, project_id: str, limit: int) -> list[dict[str, Any]]:
    with _connect(db_path) as conn:
        existing = _columns(conn, "instruments")
        return _rows(
            conn,
            f"""
            SELECT id, tag_number, suffix, instrument_type, service, category, io_type,
                   signal_type, loop_number, area_code, line_tag, line_confidence,
                   line_association_method, line_association_reason, line_candidates,
                   {_optional_column(existing, "geometry_evidence")}, pid_number, location, system, flowsizing_type,
                   source, status, review_required, notes, field_confidence, updated_at
            FROM instruments
            WHERE project_id=?
              AND active_on_pid=1
            ORDER BY review_required DESC,
                     CASE WHEN COALESCE(service,'')='' THEN 0 ELSE 1 END,
                     CASE WHEN COALESCE(line_tag,'')='' THEN 0 ELSE 1 END,
                     tag_number
            LIMIT ?
            """,
            (project_id, limit),
        )


def read_io_rows(db_path: Path, project_id: str, limit: int) -> list[dict[str, Any]]:
    with _connect(db_path) as conn:
        existing = _columns(conn, "instruments")
        return _rows(
            conn,
            f"""
            SELECT id, tag_number, instrument_type, service, category, io_type,
                   signal_type, system, supply_voltage, pid_number, line_tag,
                   line_confidence, line_association_method, line_association_reason,
                   line_candidates, {_optional_column(existing, "geometry_evidence")},
                   status, review_required, notes
            FROM instruments
            WHERE project_id=?
              AND active_on_pid=1
              AND COALESCE(io_type,'') IN ('AI', 'AO', 'DI', 'DO')
            ORDER BY review_required DESC, tag_number
            LIMIT ?
            """,
            (project_id, limit),
        )


def read_line_connected_io_rows(db_path: Path, project_id: str, limit: int) -> list[dict[str, Any]]:
    """Hardwired IO rows where a process line/equipment tag is normally expected."""
    with _connect(db_path) as conn:
        existing = _columns(conn, "instruments")
        return _rows(
            conn,
            f"""
            SELECT id, tag_number, instrument_type, service, category, io_type,
                   signal_type, system, supply_voltage, pid_number, line_tag,
                   line_confidence, line_association_method, line_association_reason,
                   line_candidates, {_optional_column(existing, "geometry_evidence")},
                   status, review_required, notes
            FROM instruments
            WHERE project_id=?
              AND active_on_pid=1
              AND COALESCE(io_type,'') IN ('AI', 'AO', 'DI', 'DO')
              AND COALESCE(system,'') NOT IN ('F&GS')
              AND COALESCE(instrument_type,'') NOT IN ('HS', 'HSD', 'GAS', 'XFD', 'XGD', 'XTGD', 'XHMD', 'XA')
            ORDER BY review_required DESC,
                     CASE WHEN COALESCE(line_tag,'')='' THEN 0 ELSE 1 END,
                     tag_number
            LIMIT ?
            """,
            (project_id, limit),
        )
