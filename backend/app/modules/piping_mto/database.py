from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any

from app.config.local_db import connection, json_text, row_to_dict
from app.config.settings import settings
from app.modules.instruments.service import ensure_project
from app.modules.piping_mto.excel_writer import _aggregate_rows, _material_description


MTO_ITEM_COLUMNS = {
    "category_code",
    "category_name",
    "unit",
    "item_type",
    "piping_class",
    "size_inch",
    "rating",
    "valve_bore",
    "end_connection",
    "material_description",
    "datasheet_document_no",
    "datasheet_reference_no",
    "quantity",
    "review_status",
    "review_required",
    "remarks",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _s(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _project_id(payload: dict) -> str:
    explicit = _s(payload.get("project_id"))
    if explicit:
        return explicit
    project = payload.get("project") or {}
    return _s(project.get("project_no")) or settings.XYRA_DEFAULT_PROJECT_ID or "default"


def _component_key(row: dict) -> str:
    parts = [
        row.get("categoryCode"),
        row.get("categoryName"),
        row.get("unit"),
        row.get("itemType"),
        row.get("pipingClass"),
        row.get("sizeInch"),
        row.get("rating"),
        row.get("valveBore"),
        row.get("endConnection"),
        row.get("materialDescription"),
        row.get("dataSheetDocumentNo"),
        row.get("dataSheetReferenceNo"),
    ]
    raw = "|".join(_s(part).upper() for part in parts)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


def _run_id(payload: dict) -> str:
    existing = _s(payload.get("mto_run_id"))
    if existing:
        return existing
    return f"mto_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"


def _review_status_for_row(row: dict) -> tuple[str, bool]:
    review_required = bool(
        row.get("missingSizeCount")
        or row.get("lowSizeConfidenceCount")
        or row.get("ambiguousSizeCount")
        or row.get("aiReviewCount")
    )
    if review_required:
        return "For Review", True
    return "Draft", False


def _session_metadata(session: dict) -> dict:
    return session.get("metadata") or {}


def _session_rows_by_key(payload: dict) -> dict[str, dict]:
    rows: dict[str, dict] = {}
    for row in _aggregate_rows(payload):
        rows[_component_key(row)] = row
    return rows


def _find_session_for_row(payload: dict, row: dict) -> dict:
    for session in payload.get("sessions", []):
        metadata = _session_metadata(session)
        if (
            _s(metadata.get("itemType")) == _s(row.get("itemType"))
            and _s(metadata.get("pipingClass")) == _s(row.get("pipingClass"))
            and _s(metadata.get("rating")) == _s(row.get("rating"))
        ):
            return session
    return {}


def save_mto_payload(payload: dict, user_id: str | None = None) -> dict:
    """Persist current prepared MTO sessions as editable grid rows."""
    project = payload.get("project") or {}
    project_id = _project_id(payload)
    run_id = _run_id(payload)
    ensure_project(project_id, **project)

    rows_by_key = _session_rows_by_key(payload)
    saved_ids: dict[str, str] = {}

    with connection() as conn:
        for key, row in rows_by_key.items():
            review_status, review_required = _review_status_for_row(row)
            scores = [
                float(match.get("score") or 0)
                for session in payload.get("sessions", [])
                for file_result in session.get("fileResults", [])
                for match in file_result.get("matches", [])
                if match.get("accepted", True)
                if _s(match.get("aiDecision")).upper() != "REJECT"
            ]
            size_confidences = [
                float(match.get("sizeConfidence") or 0)
                for session in payload.get("sessions", [])
                for file_result in session.get("fileResults", [])
                for match in file_result.get("matches", [])
                if match.get("accepted", True)
                if match.get("sizeConfidence")
            ]
            session = _find_session_for_row(payload, row)
            metadata = _session_metadata(session)
            params = {
                "project_id": project_id,
                "mto_run_id": run_id,
                "component_key": key,
                "category_code": _s(row.get("categoryCode")),
                "category_name": _s(row.get("categoryName")),
                "unit": _s(row.get("unit")) or "-",
                "item_type": _s(row.get("itemType")) or _s(session.get("label")) or "Piping component",
                "piping_class": _s(row.get("pipingClass")),
                "size_inch": _s(row.get("sizeInch")),
                "rating": _s(row.get("rating")),
                "valve_bore": _s(row.get("valveBore")),
                "end_connection": _s(row.get("endConnection")),
                "material_description": _s(row.get("materialDescription")),
                "datasheet_document_no": _s(row.get("dataSheetDocumentNo")),
                "datasheet_reference_no": _s(row.get("dataSheetReferenceNo")),
                "quantity": int(row.get("quantity") or 0),
                "drawing_count": len(row.get("drawings") or []),
                "min_detection_score": min(scores) if scores else None,
                "avg_detection_score": sum(scores) / len(scores) if scores else None,
                "min_size_confidence": min(size_confidences) if size_confidences else None,
                "review_status": review_status,
                "review_required": 1 if review_required else 0,
                "remarks": _s(row.get("remarks")),
                "metadata_snapshot": json_text(metadata, {}),
                "session_snapshot": json_text(session, {}),
                "updated_by": user_id or "local-user",
                "updated_at": _now(),
            }
            conn.execute(
                """
                INSERT INTO mto_items (
                    project_id, mto_run_id, component_key, category_code, category_name, unit,
                    item_type, piping_class, size_inch, rating, valve_bore, end_connection,
                    material_description, datasheet_document_no, datasheet_reference_no,
                    quantity, drawing_count, min_detection_score, avg_detection_score,
                    min_size_confidence, review_status, review_required, remarks,
                    metadata_snapshot, session_snapshot, created_by, updated_by, updated_at
                )
                VALUES (
                    :project_id, :mto_run_id, :component_key, :category_code, :category_name, :unit,
                    :item_type, :piping_class, :size_inch, :rating, :valve_bore, :end_connection,
                    :material_description, :datasheet_document_no, :datasheet_reference_no,
                    :quantity, :drawing_count, :min_detection_score, :avg_detection_score,
                    :min_size_confidence, :review_status, :review_required, :remarks,
                    :metadata_snapshot, :session_snapshot, :updated_by, :updated_by, :updated_at
                )
                ON CONFLICT(project_id, component_key) DO UPDATE SET
                    mto_run_id=excluded.mto_run_id,
                    quantity=excluded.quantity,
                    drawing_count=excluded.drawing_count,
                    min_detection_score=excluded.min_detection_score,
                    avg_detection_score=excluded.avg_detection_score,
                    min_size_confidence=excluded.min_size_confidence,
                    review_status=excluded.review_status,
                    review_required=excluded.review_required,
                    remarks=excluded.remarks,
                    metadata_snapshot=excluded.metadata_snapshot,
                    session_snapshot=excluded.session_snapshot,
                    updated_by=excluded.updated_by,
                    updated_at=excluded.updated_at
                """,
                params,
            )
            item = conn.execute(
                "SELECT id FROM mto_items WHERE project_id=? AND component_key=?",
                (project_id, key),
            ).fetchone()
            saved_ids[key] = item["id"]

        conn.execute("DELETE FROM mto_detection_evidence WHERE project_id=? AND mto_run_id=?", (project_id, run_id))
        for session in payload.get("sessions", []):
            metadata = _session_metadata(session)
            for file_result in session.get("fileResults", []):
                for match in file_result.get("matches", []):
                    if not match.get("accepted", True):
                        continue
                    if _s(match.get("aiDecision")).upper() == "REJECT":
                        continue
                    row_seed = {
                        "categoryCode": metadata.get("categoryCode"),
                        "categoryName": metadata.get("categoryName"),
                        "unit": metadata.get("unit") or "-",
                        "itemType": metadata.get("itemType") or session.get("label"),
                        "pipingClass": metadata.get("pipingClass"),
                        "sizeInch": _s(match.get("sizeInch")) or _s(match.get("aiNormalizedSizeInch")) or metadata.get("sizeInch"),
                        "rating": metadata.get("rating"),
                        "valveBore": metadata.get("valveBore"),
                        "endConnection": metadata.get("endConnection"),
                        "materialDescription": _material_description(
                            {
                                "itemType": metadata.get("itemType") or session.get("label"),
                                "sizeInch": metadata.get("sizeInch"),
                                "materialDescription": metadata.get("materialDescription"),
                            },
                            match,
                        ),
                        "dataSheetDocumentNo": metadata.get("dataSheetDocumentNo"),
                        "dataSheetReferenceNo": metadata.get("dataSheetReferenceNo"),
                    }
                    key = _component_key(row_seed)
                    item_id = saved_ids.get(key)
                    if not item_id:
                        continue
                    review_required = bool(match.get("sizeAmbiguous") or _s(match.get("aiDecision")).upper() == "REVIEW" or not _s(match.get("sizeInch")))
                    conn.execute(
                        """
                        INSERT INTO mto_detection_evidence (
                            project_id, mto_item_id, mto_run_id, component_key, component_label,
                            drawing, page, x1, y1, x2, y2, detection_score, size_inch,
                            size_source, size_source_type, size_confidence, size_ambiguous,
                            ai_decision, ai_confidence, ai_reason, ai_flags, ai_line_number,
                            evidence_snapshot, accepted, review_required
                        )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
                        """,
                        (
                            project_id,
                            item_id,
                            run_id,
                            key,
                            _s(session.get("label")),
                            _s(file_result.get("fileName")),
                            int(match.get("page") or 1),
                            int(match.get("x1") or 0),
                            int(match.get("y1") or 0),
                            int(match.get("x2") or 0),
                            int(match.get("y2") or 0),
                            float(match.get("score") or 0),
                            _s(match.get("sizeInch")),
                            _s(match.get("sizeSource")),
                            _s(match.get("sizeSourceType")),
                            float(match.get("sizeConfidence") or 0) if match.get("sizeConfidence") else None,
                            1 if match.get("sizeAmbiguous") else 0,
                            _s(match.get("aiDecision")),
                            float(match.get("aiConfidence") or 0) if match.get("aiConfidence") else None,
                            _s(match.get("aiReason")),
                            json_text(match.get("aiFlags"), []),
                            _s(match.get("aiLineNumber")),
                            json_text(match, {}),
                            1 if review_required else 0,
                        ),
                    )

    return {
        "status": "saved",
        "project_id": project_id,
        "mto_run_id": run_id,
        "rows_saved": len(rows_by_key),
        "detections_saved": sum(
            1
            for session in payload.get("sessions", [])
            for file_result in session.get("fileResults", [])
            for match in file_result.get("matches", [])
            if match.get("accepted", True)
            if _s(match.get("aiDecision")).upper() != "REJECT"
        ),
    }


def list_mto_items(
    project_id: str | None = None,
    search: str | None = None,
    review_required: bool | None = None,
    sort_by: str = "item_type",
    sort_dir: str = "asc",
    page: int = 1,
    page_size: int = 500,
) -> dict:
    project_id = project_id or settings.XYRA_DEFAULT_PROJECT_ID or "default"
    allowed_sort = {
        "item_type", "category_name", "piping_class", "size_inch", "rating",
        "quantity", "review_status", "updated_at", "min_detection_score",
        "min_size_confidence",
    }
    if sort_by not in allowed_sort:
        sort_by = "item_type"
    direction = "DESC" if sort_dir.lower() == "desc" else "ASC"
    where = ["project_id = ?"]
    params: list[Any] = [project_id]
    if search:
        where.append(
            "(item_type LIKE ? OR category_name LIKE ? OR piping_class LIKE ? OR size_inch LIKE ? OR datasheet_reference_no LIKE ?)"
        )
        needle = f"%{search}%"
        params.extend([needle, needle, needle, needle, needle])
    if review_required is not None:
        where.append("review_required = ?")
        params.append(1 if review_required else 0)
    where_sql = " AND ".join(where)
    offset = (page - 1) * page_size

    with connection() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM mto_items WHERE {where_sql}", params).fetchone()[0]
        rows = conn.execute(
            f"""
            SELECT * FROM mto_items
            WHERE {where_sql}
            ORDER BY {sort_by} {direction}
            LIMIT ? OFFSET ?
            """,
            [*params, page_size, offset],
        ).fetchall()
    data = [row_to_dict(row) or {} for row in rows]
    for row in data:
        row["review_required"] = bool(row.get("review_required"))
    return {"data": data, "total": total, "page": page, "page_size": page_size}


def update_mto_item(item_id: str, changes: dict, user_id: str | None = None) -> dict | None:
    updates = {k: v for k, v in changes.items() if k in MTO_ITEM_COLUMNS}
    if not updates:
        return get_mto_item(item_id)
    if "review_required" in updates:
        updates["review_required"] = 1 if updates["review_required"] else 0
    updates["updated_by"] = user_id or "local-user"
    updates["updated_at"] = _now()
    with connection() as conn:
        current = conn.execute("SELECT * FROM mto_items WHERE id=?", (item_id,)).fetchone()
        if not current:
            return None
        set_sql = ", ".join(f"{key}=?" for key in updates)
        conn.execute(f"UPDATE mto_items SET {set_sql} WHERE id=?", [*updates.values(), item_id])
        row = conn.execute("SELECT * FROM mto_items WHERE id=?", (item_id,)).fetchone()
    out = row_to_dict(row) or {}
    out["review_required"] = bool(out.get("review_required"))
    return out


def get_mto_item(item_id: str) -> dict | None:
    with connection() as conn:
        row = conn.execute("SELECT * FROM mto_items WHERE id=?", (item_id,)).fetchone()
    out = row_to_dict(row) if row else None
    if out:
        out["review_required"] = bool(out.get("review_required"))
    return out


def get_mto_evidence(item_id: str) -> list[dict]:
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT * FROM mto_detection_evidence
            WHERE mto_item_id=?
            ORDER BY drawing, page, detection_score DESC
            """,
            (item_id,),
        ).fetchall()
    data = [row_to_dict(row) or {} for row in rows]
    for row in data:
        row["size_ambiguous"] = bool(row.get("size_ambiguous"))
        row["accepted"] = bool(row.get("accepted"))
        row["review_required"] = bool(row.get("review_required"))
    return data


def normalize_project_id_from_project(project: dict | None) -> str:
    text = _s((project or {}).get("project_no")) or _s((project or {}).get("project_name")) or "default"
    text = re.sub(r"[^A-Za-z0-9_.-]+", "-", text).strip("-")
    return text or "default"
