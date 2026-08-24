from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from app.config.local_db import connection, json_text, row_to_dict, write_connection
from app.config.settings import settings
from app.modules.instrumap.core.standard_library import instrument_tag_quality


INSTRUMENT_COLUMNS = {
    "project_id", "tag_number", "suffix", "instrument_type", "service",
    "category", "io_type", "signal_type", "area_id", "unit_id", "location",
    "elevation_m", "loop_id", "loop_number", "pid_document_id", "pid_number",
    "area_code", "unit_code", "line_tag", "system", "flowsizing_type",
    "line_confidence", "line_association_method", "line_association_reason", "line_candidates",
    "geometry_evidence",
    "extraction_session_id", "source", "field_confidence", "range_min",
    "range_max", "range_unit", "calib_min", "calib_max", "calib_unit",
    "supply_voltage", "hazardous_area", "area_class", "is_certified",
    "enclosure_class", "status", "review_required", "notes", "active_on_pid",
    "batch_id", "created_by", "updated_by",
}

INSTRUMENT_LIST_SELECT = """
    id, project_id, tag_number, suffix, instrument_type, service,
    category, io_type, signal_type, area_id, unit_id, location,
    elevation_m, loop_id, loop_number, pid_document_id, pid_number,
    area_code, unit_code, line_tag, system, flowsizing_type,
    line_confidence, line_association_method, line_association_reason,
    COALESCE(NULLIF(line_association_reason, ''), NULLIF(line_tag, ''), '') AS geometry_evidence,
    extraction_session_id, source, range_min, range_max, range_unit,
    calib_min, calib_max, calib_unit, supply_voltage, hazardous_area,
    area_class, is_certified, enclosure_class, status, review_required,
    notes, active_on_pid, batch_id, created_by, updated_by, created_at, updated_at
"""

MANUAL_PROTECTED_FIELDS = {
    "tag_number", "instrument_type", "service", "category", "io_type",
    "signal_type", "loop_number", "area_code", "unit_code", "line_tag",
    "line_confidence", "line_association_method", "line_association_reason", "line_candidates",
    "geometry_evidence",
    "pid_number", "location", "status", "notes",
}

_LINE_OPTIONAL_TYPES = {
    "GAS",
    "HS",
    "HSD",
    "HSS",
    "XA",
    "XFD",
    "XGD",
    "XHMD",
    "XTGD",
}
_HARDWIRED_IO_TYPES = {"AI", "AO", "DI", "DO"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_id(user_id: str | None = None) -> str:
    return user_id or "local-user"


def _normalize_project_id(project_id: str | None) -> str:
    return (project_id or settings.TPI_DEFAULT_PROJECT_ID or "default").strip() or "default"


def ensure_project(project_id: str, **metadata) -> None:
    project_id = _normalize_project_id(project_id)
    with write_connection() as conn:
        conn.execute(
            """
            INSERT INTO projects(project_id, name, project_no, client_name, contractor_name, location)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id) DO UPDATE SET
                name=COALESCE(excluded.name, projects.name),
                project_no=COALESCE(excluded.project_no, projects.project_no),
                client_name=COALESCE(excluded.client_name, projects.client_name),
                contractor_name=COALESCE(excluded.contractor_name, projects.contractor_name),
                location=COALESCE(excluded.location, projects.location),
                updated_at=CURRENT_TIMESTAMP
            """,
            (
                project_id,
                metadata.get("project_name") or metadata.get("name"),
                metadata.get("project_no"),
                metadata.get("client_name"),
                metadata.get("contractor_name"),
                metadata.get("location"),
            ),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO project_settings(id, project_id)
            VALUES (lower(hex(randomblob(16))), ?)
            """,
            (project_id,),
        )


def _decode_row(row: dict) -> dict:
    out = dict(row)
    for key in ("hazardous_area", "is_certified", "review_required", "active_on_pid"):
        if key in out and out[key] is not None:
            out[key] = bool(out[key])
    return out


def list_instruments(
    project_id: str,
    page: int = 1,
    page_size: int = 100,
    sort_by: str = "tag_number",
    sort_dir: str = "asc",
    status: str | None = None,
    review_required: bool | None = None,
    active_on_pid: bool | None = None,
    search: str | None = None,
) -> dict:
    allowed_sort = INSTRUMENT_COLUMNS | {"created_at", "updated_at", "id"}
    if sort_by not in allowed_sort:
        sort_by = "tag_number"
    direction = "DESC" if sort_dir.lower() == "desc" else "ASC"
    where = ["project_id = ?"]
    params: list[Any] = [_normalize_project_id(project_id)]
    if status:
        where.append("status = ?")
        params.append(status)
    if review_required is not None:
        where.append("review_required = ?")
        params.append(1 if review_required else 0)
    if active_on_pid is not None:
        where.append("active_on_pid = ?")
        params.append(1 if active_on_pid else 0)
    if search:
        where.append("tag_number LIKE ?")
        params.append(f"{search}%")
    where_sql = " AND ".join(where)
    offset = (page - 1) * page_size

    with connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM instruments WHERE {where_sql}", params).fetchone()[0]
        rows = conn.execute(
            f"""
            SELECT {INSTRUMENT_LIST_SELECT}
            FROM instruments
            WHERE {where_sql}
            ORDER BY {sort_by} {direction}
            LIMIT ? OFFSET ?
            """,
            [*params, page_size, offset],
        ).fetchall()
    data = [_decode_row(row_to_dict(row) or {}) for row in rows]
    return {
        "data": data,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": max(1, -(-total // page_size)),
    }


def get_lookups(project_id: str) -> dict:
    with connection() as conn:
        types = [row_to_dict(r) for r in conn.execute(
            "SELECT code, display_name, category FROM instrument_type_catalog WHERE is_active=1 ORDER BY sort_order, code"
        ).fetchall()]
        areas = [row_to_dict(r) for r in conn.execute(
            "SELECT code, name FROM project_areas WHERE project_id=? ORDER BY sort_order, code",
            (_normalize_project_id(project_id),),
        ).fetchall()]
        units = [row_to_dict(r) for r in conn.execute(
            "SELECT code, name FROM project_units WHERE project_id=? ORDER BY sort_order, code",
            (_normalize_project_id(project_id),),
        ).fetchall()]
    return {
        "instrument_types": [
            {"value": r["code"], "label": f"{r['code']} - {r.get('display_name', '')}"}
            for r in types if r
        ],
        "areas": [{"value": r["code"], "label": f"{r['code']} - {r.get('name', '')}"} for r in areas if r],
        "units": [{"value": r["code"], "label": f"{r['code']} - {r.get('name', '')}"} for r in units if r],
        "status_options": ["Draft", "For Review", "Suppressed - Incomplete", "Rejected - Noise", "Issued for Design", "Issued for Construction", "As-Built", "On Hold"],
        "category_options": ["field_device", "final_element", "controller", "analyzer", "safety", "passive", "other"],
        "io_type_options": ["AI", "AO", "DI", "DO", "Pulse", "Bus", "None", "Soft Link"],
        "signal_type_options": ["4-20mA", "4-20mA + HART", "24VDC", "Profibus", "FF", "Relay", "Pulse", "RTD", "TC"],
    }


def list_projects() -> list[dict]:
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT
              p.project_id,
              COALESCE(p.name, '') AS name,
              COALESCE(p.project_no, '') AS project_no,
              COUNT(i.id) AS instrument_count
            FROM projects p
            LEFT JOIN instruments i ON i.project_id = p.project_id
            GROUP BY p.project_id, p.name, p.project_no
            ORDER BY instrument_count DESC, p.project_id
            """
        ).fetchall()
    return [row_to_dict(row) or {} for row in rows]


def get_instrument(instrument_id: str) -> dict | None:
    with connection() as conn:
        row = conn.execute("SELECT * FROM instruments WHERE id=?", (instrument_id,)).fetchone()
    return _decode_row(row_to_dict(row) or {}) if row else None


def create_instrument(payload: dict, user_id: str | None = None) -> dict:
    project_id = _normalize_project_id(payload.get("project_id"))
    ensure_project(project_id)
    row = {k: v for k, v in payload.items() if k in INSTRUMENT_COLUMNS and v is not None}
    row["project_id"] = project_id
    row["source"] = row.get("source") or "manual"
    row["instrument_type"] = row.get("instrument_type") or "UNKNOWN"
    row["loop_number"] = row.get("loop_number") or _derive_loop_number(
        str(row.get("tag_number") or ""),
        str(row.get("instrument_type") or ""),
    )
    row["created_by"] = _user_id(user_id)
    row["updated_by"] = _user_id(user_id)
    if isinstance(row.get("field_confidence"), dict):
        row["field_confidence"] = json_text(row["field_confidence"], {})
    if isinstance(row.get("line_candidates"), (list, dict)):
        row["line_candidates"] = json_text(row["line_candidates"], [])
    if isinstance(row.get("geometry_evidence"), (list, dict)):
        row["geometry_evidence"] = json_text(row["geometry_evidence"], {})
    for key in ("hazardous_area", "is_certified", "review_required", "active_on_pid"):
        if key in row:
            row[key] = 1 if row[key] else 0

    cols = list(row.keys())
    placeholders = ", ".join("?" for _ in cols)
    with write_connection() as conn:
        cur = conn.execute(
            f"INSERT INTO instruments ({', '.join(cols)}) VALUES ({placeholders})",
            [row[c] for c in cols],
        )
        instrument_id = cur.lastrowid
        created = conn.execute("SELECT * FROM instruments WHERE rowid=?", (instrument_id,)).fetchone()
    return _decode_row(row_to_dict(created) or {})


def update_instrument(instrument_id: str, changes: dict, user_id: str | None = None) -> dict | None:
    updates = {k: v for k, v in changes.items() if k in INSTRUMENT_COLUMNS and k != "project_id"}
    if not updates:
        return get_instrument(instrument_id)
    if isinstance(updates.get("field_confidence"), dict):
        updates["field_confidence"] = json_text(updates["field_confidence"], {})
    if isinstance(updates.get("line_candidates"), (list, dict)):
        updates["line_candidates"] = json_text(updates["line_candidates"], [])
    if isinstance(updates.get("geometry_evidence"), (list, dict)):
        updates["geometry_evidence"] = json_text(updates["geometry_evidence"], {})
    for key in ("hazardous_area", "is_certified", "review_required", "active_on_pid"):
        if key in updates:
            updates[key] = 1 if updates[key] else 0

    with write_connection() as conn:
        current = conn.execute("SELECT * FROM instruments WHERE id=?", (instrument_id,)).fetchone()
        if not current:
            return None
        current_data = row_to_dict(current) or {}
        updates["updated_by"] = _user_id(user_id)
        updates["updated_at"] = _now()
        set_sql = ", ".join(f"{k}=?" for k in updates)
        conn.execute(f"UPDATE instruments SET {set_sql} WHERE id=?", [*updates.values(), instrument_id])
        for field, new_val in updates.items():
            if field in {"updated_by", "updated_at"}:
                continue
            old_val = current_data.get(field)
            if old_val != new_val:
                conn.execute(
                    """
                    INSERT INTO instrument_field_history
                      (instrument_id, project_id, field_name, old_value, new_value, change_source, changed_by)
                    VALUES (?, ?, ?, ?, ?, 'manual', ?)
                    """,
                    (
                        instrument_id,
                        current_data["project_id"],
                        field,
                        None if old_val is None else str(old_val),
                        None if new_val is None else str(new_val),
                        _user_id(user_id),
                    ),
                )
        updated = conn.execute("SELECT * FROM instruments WHERE id=?", (instrument_id,)).fetchone()
    return _decode_row(row_to_dict(updated) or {})


def delete_instrument(instrument_id: str) -> bool:
    with write_connection() as conn:
        cur = conn.execute("DELETE FROM instruments WHERE id=?", (instrument_id,))
    return cur.rowcount > 0


def upsert_instrumap_dataframe(
    df: pd.DataFrame,
    *,
    project_id: str | None,
    batch_id: str,
    pdf_filename: str,
    project_metadata: dict | None = None,
) -> dict:
    project_id = _normalize_project_id(project_id)
    ensure_project(project_id, **(project_metadata or {}))
    if df is None or df.empty:
        return {"inserted": 0, "updated": 0, "skipped": 0}

    inserted = updated = skipped = 0
    with write_connection() as conn:
        session_id = conn.execute(
            """
            INSERT INTO extraction_sessions
              (project_id, job_id, file_name, tags_found, status, completed_at)
            VALUES (?, ?, ?, ?, 'complete', CURRENT_TIMESTAMP)
            """,
            (project_id, batch_id, pdf_filename, int(len(df))),
        ).lastrowid
        session_row = conn.execute("SELECT id FROM extraction_sessions WHERE rowid=?", (session_id,)).fetchone()
        extraction_session_id = session_row["id"] if session_row else None

        for raw in df.to_dict(orient="records"):
            tag = str(raw.get("Tag_Number") or raw.get("tag_number") or "").strip()
            if not tag:
                skipped += 1
                continue
            mapped = _map_instrumap_row(raw, project_id, batch_id, pdf_filename, extraction_session_id)
            existing = conn.execute(
                "SELECT * FROM instruments WHERE project_id=? AND tag_number=?",
                (project_id, tag),
            ).fetchone()
            if existing:
                existing_data = row_to_dict(existing) or {}
                if existing_data.get("source") == "manual":
                    mutable = {k: v for k, v in mapped.items() if k not in MANUAL_PROTECTED_FIELDS}
                else:
                    mutable = mapped
                if mutable:
                    mutable["updated_at"] = _now()
                    set_sql = ", ".join(f"{k}=?" for k in mutable if k not in {"project_id", "tag_number"})
                    vals = [v for k, v in mutable.items() if k not in {"project_id", "tag_number"}]
                    if set_sql:
                        conn.execute(
                            f"UPDATE instruments SET {set_sql} WHERE project_id=? AND tag_number=?",
                            [*vals, project_id, tag],
                        )
                updated += 1
            else:
                cols = list(mapped.keys())
                conn.execute(
                    f"INSERT INTO instruments ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
                    [mapped[c] for c in cols],
                )
                inserted += 1

        if extraction_session_id:
            conn.execute(
                """
                UPDATE extraction_sessions
                SET tags_inserted=?, tags_updated=?, tags_skipped=?
                WHERE id=?
                """,
                (inserted, updated, skipped, extraction_session_id),
            )
    return {"inserted": inserted, "updated": updated, "skipped": skipped}


def _map_instrumap_row(raw: dict, project_id: str, batch_id: str, pdf_filename: str, extraction_session_id: str | None) -> dict:
    tag_number = str(raw.get("Tag_Number") or "").strip()
    instrument_type = str(
        raw.get("Instrument_Type")
        or raw.get("Type")
        or raw.get("instrument_type")
        or "UNKNOWN"
    ).strip() or "UNKNOWN"
    category, flowsizing_type = _catalog_mapping(instrument_type)
    review_required = bool(raw.get("Review_Required")) if raw.get("Review_Required") is not None else False
    tag_quality, noise_reason = instrument_tag_quality(raw)
    rejected_as_noise = bool(raw.get("Rejected_As_Noise")) or tag_quality == "rejected_noise"
    suppressed = tag_quality == "suppressed"
    connected_line = _clean(raw.get("Connected_Line"))
    service_confidence = _service_confidence(raw.get("Service_Confidence"))
    hardwired_without_line = (
        _clean(raw.get("IO_Type")) in _HARDWIRED_IO_TYPES
        and not connected_line
        and instrument_type.upper() not in _LINE_OPTIONAL_TYPES
        and _clean(raw.get("System")) != "F&GS"
    )
    weak_service = service_confidence is not None and service_confidence <= 0.35
    review_required = review_required or rejected_as_noise or suppressed or hardwired_without_line or weak_service
    confidence = {
        "tag_number": 0.95,
        "line_tag": _float_or_none(raw.get("Line_Confidence")),
        "service": service_confidence,
    }
    review_reasons: list[str] = []
    if noise_reason:
        review_reasons.append(noise_reason)
    if hardwired_without_line:
        review_reasons.append("Review required: hardwired IO has no connected line/equipment tag")
    if weak_service:
        review_reasons.append("Review required: service description has low confidence")
    notes = _clean(raw.get("Service_Basis"))
    if review_reasons:
        notes = "; ".join(review_reasons + ([notes] if notes else []))
    return {
        "project_id": project_id,
        "tag_number": tag_number,
        "suffix": _clean(raw.get("Suffix")),
        "instrument_type": instrument_type,
        "service": _clean(raw.get("Instrument_Service")) or _clean(raw.get("Service")) or _clean(raw.get("Instrument_Description")),
        "category": category or _category_from_io(raw.get("IO_Type")),
        "io_type": _clean(raw.get("IO_Type")),
        "signal_type": _clean(raw.get("Signal_Type")),
        "loop_number": _derive_loop_number(tag_number, instrument_type, _clean(raw.get("Loop"))),
        "area_code": _clean(raw.get("Area")),
        "line_tag": connected_line,
        "line_confidence": _float_or_none(raw.get("Line_Confidence")),
        "line_association_method": _clean(raw.get("Line_Association_Method")),
        "line_association_reason": _clean(raw.get("Line_Association_Reason")),
        "line_candidates": _clean(raw.get("Line_Candidates")) or "[]",
        "geometry_evidence": _clean(raw.get("Geometry_Evidence")) or "{}",
        "pid_number": _clean(raw.get("P&ID_Filename")) or pdf_filename,
        "location": _clean(raw.get("Location_Drawing")),
        "system": _clean(raw.get("System")),
        "flowsizing_type": flowsizing_type,
        "extraction_session_id": extraction_session_id,
        "source": "ai_extracted",
        "field_confidence": json.dumps(confidence, separators=(",", ":")),
        "supply_voltage": _clean(raw.get("Power_Supply")),
        "status": "Rejected - Noise" if rejected_as_noise else ("Suppressed - Incomplete" if suppressed else ("For Review" if review_required else "Draft")),
        "review_required": 1 if review_required else 0,
        "notes": notes,
        "active_on_pid": 0 if (rejected_as_noise or suppressed) else 1,
        "batch_id": batch_id,
        "created_by": "instrumap",
        "updated_by": "instrumap",
    }


def _derive_loop_number(tag_number: str, instrument_type: str, fallback: str | None = None) -> str | None:
    tag = (tag_number or "").strip()
    inst_type = (instrument_type or "").strip()
    if tag and inst_type and tag.upper() == inst_type.upper():
        return fallback
    if tag and inst_type and tag.upper().startswith(inst_type.upper()):
        return f"{inst_type[0].upper()}{tag[len(inst_type):]}"
    if tag and inst_type:
        separator = "" if tag.startswith("-") else "-"
        return f"{inst_type[0].upper()}{separator}{tag}"
    return fallback


def _catalog_mapping(code: str) -> tuple[str | None, str | None]:
    with connection() as conn:
        row = conn.execute(
            "SELECT category, flowsizing_type FROM instrument_type_catalog WHERE code=?",
            (code,),
        ).fetchone()
    if row:
        return row["category"], row["flowsizing_type"]
    return None, None


def _category_from_io(io_type) -> str | None:
    if not io_type:
        return None
    value = str(io_type).upper()
    if value == "NONE":
        return "passive"
    if value in {"AO", "DO"}:
        return "final_element"
    if value in {"AI", "DI", "PULSE", "BUS"}:
        return "field_device"
    return None


def _clean(value) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and pd.isna(value):
        return None
    text = str(value).strip()
    return text if text and text.lower() != "nan" else None


def _float_or_none(value) -> float | None:
    try:
        if value is None or pd.isna(value):
            return None
        return float(value)
    except Exception:
        return None


def _service_confidence(value) -> float | None:
    if not value:
        return None
    lookup = {"high": 0.9, "medium": 0.65, "low": 0.35}
    return lookup.get(str(value).strip().lower())
