from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from app.config.local_db import connection, row_to_dict
from app.modules.ai_engineers.contracts import ENGINEER_MODELS, EngineerRole
from app.modules.instruments.service import ensure_project
from app.modules.llm.service import (
    _is_available,
    generate,
)

INLINE_TYPES = {"FCV", "PCV", "LCV", "TCV", "HCV", "BDV", "SDV", "SSV", "MOV", "XV", "PSV", "PRV", "FE", "RO"}
PROCESS_TYPES = INLINE_TYPES | {"FT", "FIT", "FIC", "PT", "PIT", "PDT", "LT", "LIT", "TT", "TIT", "AT"}
logger = logging.getLogger(__name__)


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _rowdicts(rows: list[Any]) -> list[dict]:
    return [row_to_dict(row) or {} for row in rows]


def _count(conn, sql: str, params: tuple[Any, ...]) -> int:
    return int(conn.execute(sql, params).fetchone()[0] or 0)


def _group_counts(conn, sql: str, params: tuple[Any, ...]) -> list[dict]:
    return _rowdicts(conn.execute(sql, params).fetchall())


def _evidence_row(row: dict, reason: str) -> dict:
    return {
        "table": "instruments",
        "id": _text(row.get("id")),
        "tag_number": _text(row.get("tag_number")),
        "instrument_type": _text(row.get("instrument_type")),
        "service": _text(row.get("service")),
        "line_tag": _text(row.get("line_tag")),
        "pid_number": _text(row.get("pid_number")),
        "status": _text(row.get("status")),
        "review_required": bool(row.get("review_required")),
        "reason": reason,
    }


def get_project_memory(project_id: str, sample_limit: int = 12) -> dict:
    ensure_project(project_id)
    project_id = _text(project_id) or "default"
    with connection() as conn:
        project = row_to_dict(conn.execute("SELECT * FROM projects WHERE project_id=?", (project_id,)).fetchone()) or {
            "project_id": project_id
        }
        counts = {
            "instruments": _count(conn, "SELECT COUNT(*) FROM instruments WHERE project_id=?", (project_id,)),
            "documents": _count(conn, "SELECT COUNT(*) FROM documents WHERE project_id=?", (project_id,)),
            "extraction_sessions": _count(conn, "SELECT COUNT(*) FROM extraction_sessions WHERE project_id=?", (project_id,)),
            "loops": _count(conn, "SELECT COUNT(*) FROM loops WHERE project_id=?", (project_id,)),
            "process_cases": _count(conn, "SELECT COUNT(*) FROM process_data WHERE project_id=?", (project_id,)),
            "sizing_results": _count(conn, "SELECT COUNT(*) FROM sizing_results WHERE project_id=?", (project_id,)),
        }
        breakdown = {
            "by_type": _group_counts(
                conn,
                """
                SELECT COALESCE(NULLIF(instrument_type, ''), 'UNKNOWN') AS key, COUNT(*) AS count
                FROM instruments WHERE project_id=?
                GROUP BY key ORDER BY count DESC, key LIMIT 30
                """,
                (project_id,),
            ),
            "by_io_type": _group_counts(
                conn,
                """
                SELECT COALESCE(NULLIF(io_type, ''), 'missing') AS key, COUNT(*) AS count
                FROM instruments WHERE project_id=?
                GROUP BY key ORDER BY count DESC, key
                """,
                (project_id,),
            ),
            "by_status": _group_counts(
                conn,
                """
                SELECT COALESCE(NULLIF(status, ''), 'missing') AS key, COUNT(*) AS count
                FROM instruments WHERE project_id=?
                GROUP BY key ORDER BY count DESC, key
                """,
                (project_id,),
            ),
            "by_flowsizing_type": _group_counts(
                conn,
                """
                SELECT COALESCE(NULLIF(flowsizing_type, ''), 'not_set') AS key, COUNT(*) AS count
                FROM instruments WHERE project_id=?
                GROUP BY key ORDER BY count DESC, key
                """,
                (project_id,),
            ),
            "by_source": _group_counts(
                conn,
                """
                SELECT COALESCE(NULLIF(source, ''), 'unknown') AS key, COUNT(*) AS count
                FROM instruments WHERE project_id=?
                GROUP BY key ORDER BY count DESC, key
                """,
                (project_id,),
            ),
        }
        quality_gaps = {
            "missing_service": _count(conn, "SELECT COUNT(*) FROM instruments WHERE project_id=? AND COALESCE(service, '')=''", (project_id,)),
            "missing_line_tag": _count(conn, "SELECT COUNT(*) FROM instruments WHERE project_id=? AND COALESCE(line_tag, '')=''", (project_id,)),
            "missing_io_type": _count(conn, "SELECT COUNT(*) FROM instruments WHERE project_id=? AND COALESCE(io_type, '')=''", (project_id,)),
            "missing_signal_type": _count(conn, "SELECT COUNT(*) FROM instruments WHERE project_id=? AND COALESCE(signal_type, '')=''", (project_id,)),
            "review_required": _count(conn, "SELECT COUNT(*) FROM instruments WHERE project_id=? AND review_required=1", (project_id,)),
            "flowsizing_ready": _count(conn, "SELECT COUNT(*) FROM instruments WHERE project_id=? AND COALESCE(flowsizing_type, '')<>''", (project_id,)),
            "flowsizing_missing_results": _count(
                conn,
                """
                SELECT COUNT(*)
                FROM instruments i
                LEFT JOIN sizing_results s
                  ON s.project_id=i.project_id AND s.tag_number=i.tag_number
                WHERE i.project_id=? AND COALESCE(i.flowsizing_type, '')<>'' AND s.id IS NULL
                """,
                (project_id,),
            ),
        }
        recent_sessions = _rowdicts(
            conn.execute(
                """
                SELECT id, file_name, status, tags_found, tags_inserted, tags_updated,
                       tags_low_confidence, avg_confidence, started_at, completed_at
                FROM extraction_sessions
                WHERE project_id=?
                ORDER BY started_at DESC
                LIMIT 8
                """,
                (project_id,),
            ).fetchall()
        )
        gap_samples = _rowdicts(
            conn.execute(
                """
                SELECT id, tag_number, instrument_type, service, io_type, signal_type,
                       line_tag, pid_number, status, review_required, flowsizing_type
                FROM instruments
                WHERE project_id=?
                  AND (
                    review_required=1
                    OR COALESCE(service, '')=''
                    OR COALESCE(io_type, '')=''
                    OR COALESCE(signal_type, '')=''
                    OR COALESCE(line_tag, '')=''
                  )
                ORDER BY review_required DESC, updated_at DESC, tag_number
                LIMIT ?
                """,
                (project_id, max(1, min(sample_limit, 50))),
            ).fetchall()
        )

    return {
        "project": project,
        "counts": counts,
        "breakdown": breakdown,
        "quality_gaps": quality_gaps,
        "recent_sessions": recent_sessions,
        "evidence_samples": [_evidence_row(row, _sample_reason(row)) for row in gap_samples],
    }


def _sample_reason(row: dict) -> str:
    if row.get("review_required"):
        return "Row is flagged for engineer review."
    if not _text(row.get("service")):
        return "Service is missing."
    if not _text(row.get("io_type")):
        return "IO type is missing."
    if not _text(row.get("signal_type")):
        return "Signal type is missing."
    if not _text(row.get("line_tag")):
        return "Connected line is missing."
    return "Project memory evidence row."


def _pick_evidence(project_id: str, engineer: EngineerRole, question: str, limit: int) -> list[dict]:
    limit = max(1, min(limit, 80))
    question_l = question.lower()
    with connection() as conn:
        if engineer == "instrumentation":
            rows = conn.execute(
                """
                SELECT id, tag_number, instrument_type, service, category, io_type, signal_type,
                       line_tag, pid_number, status, review_required, source
                FROM instruments
                WHERE project_id=?
                  AND (
                    review_required=1 OR COALESCE(io_type, '')='' OR COALESCE(signal_type, '')=''
                    OR COALESCE(category, '')='' OR instrument_type IN ('UNKNOWN', '')
                  )
                ORDER BY review_required DESC, updated_at DESC, tag_number
                LIMIT ?
                """,
                (project_id, limit),
            ).fetchall()
            reason = "Instrumentation evidence: IO, signal, type, category, or review gap."
        elif engineer == "process":
            rows = conn.execute(
                """
                SELECT id, tag_number, instrument_type, service, category, io_type, signal_type,
                       line_tag, pid_number, status, review_required, source
                FROM instruments
                WHERE project_id=?
                  AND (
                    COALESCE(service, '')='' OR COALESCE(line_tag, '')='' OR review_required=1
                    OR instrument_type IN ({placeholders})
                  )
                ORDER BY review_required DESC, updated_at DESC, tag_number
                LIMIT ?
                """.format(placeholders=",".join("?" for _ in PROCESS_TYPES)),
                (project_id, *sorted(PROCESS_TYPES), limit),
            ).fetchall()
            reason = "Process evidence: service, line context, or process-facing instrument."
        else:
            rows = conn.execute(
                """
                SELECT id, tag_number, instrument_type, service, category, io_type, signal_type,
                       line_tag, pid_number, status, review_required, source, flowsizing_type
                FROM instruments
                WHERE project_id=?
                  AND (
                    instrument_type IN ({placeholders}) OR COALESCE(flowsizing_type, '')<>'' OR COALESCE(line_tag, '')=''
                  )
                ORDER BY review_required DESC, updated_at DESC, tag_number
                LIMIT ?
                """.format(placeholders=",".join("?" for _ in INLINE_TYPES)),
                (project_id, *sorted(INLINE_TYPES), limit),
            ).fetchall()
            reason = "Piping evidence: inline item, line context, MTO or FlowSizing handoff."
    evidence = [_evidence_row(row_to_dict(row) or {}, reason) for row in rows]
    if not evidence and "review" in question_l:
        memory = get_project_memory(project_id, sample_limit=limit)
        return memory["evidence_samples"][:limit]
    return evidence


def _rules_answer(memory: dict, engineer: EngineerRole, evidence: list[dict]) -> tuple[str, list[dict]]:
    gaps = memory["quality_gaps"]
    counts = memory["counts"]
    actions: list[dict] = []

    if engineer == "instrumentation":
        actions.extend(
            [
                {"label": "Complete missing IO types", "count": gaps["missing_io_type"], "severity": "high" if gaps["missing_io_type"] else "ok"},
                {"label": "Complete missing signal types", "count": gaps["missing_signal_type"], "severity": "high" if gaps["missing_signal_type"] else "ok"},
                {"label": "Clear review-required rows", "count": gaps["review_required"], "severity": "medium" if gaps["review_required"] else "ok"},
            ]
        )
        answer = (
            f"Instrumentation memory has {counts['instruments']} instruments. "
            f"Focus first on {gaps['missing_io_type']} missing IO types, {gaps['missing_signal_type']} missing signal types, "
            f"and {gaps['review_required']} review rows."
        )
    elif engineer == "process":
        actions.extend(
            [
                {"label": "Write instrument service", "count": gaps["missing_service"], "severity": "high" if gaps["missing_service"] else "ok"},
                {"label": "Connect process line tags", "count": gaps["missing_line_tag"], "severity": "medium" if gaps["missing_line_tag"] else "ok"},
                {"label": "Add process cases", "count": max(counts["instruments"] - counts["process_cases"], 0), "severity": "medium"},
            ]
        )
        answer = (
            f"Process memory shows {gaps['missing_service']} instruments without service text and "
            f"{gaps['missing_line_tag']} without connected line context. These are the highest-value fixes before sizing."
        )
    else:
        actions.extend(
            [
                {"label": "Prepare FlowSizing inputs", "count": gaps["flowsizing_ready"], "severity": "ok" if gaps["flowsizing_ready"] else "medium"},
                {"label": "Run missing sizing results", "count": gaps["flowsizing_missing_results"], "severity": "high" if gaps["flowsizing_missing_results"] else "ok"},
                {"label": "Resolve missing line tags", "count": gaps["missing_line_tag"], "severity": "medium" if gaps["missing_line_tag"] else "ok"},
            ]
        )
        answer = (
            f"Piping memory has {gaps['flowsizing_ready']} items classified for FlowSizing and "
            f"{gaps['flowsizing_missing_results']} still missing sizing results."
        )

    if evidence:
        answer += f" The evidence list includes {len(evidence)} rows to inspect first."
    return answer, actions


def _model_prompt(project_id: str, engineer: EngineerRole, question: str, memory: dict, evidence: list[dict]) -> str:
    payload = {
        "project_id": project_id,
        "engineer": engineer,
        "question": question,
        "project_memory": {
            "counts": memory["counts"],
            "quality_gaps": memory["quality_gaps"],
            "breakdown": memory["breakdown"],
        },
        "evidence": evidence[:40],
        "required_json": {
            "answer": "short EPC engineering answer grounded in project memory",
            "actions": [{"label": "action", "count": 0, "severity": "ok|medium|high"}],
        },
    }
    return json.dumps(payload, ensure_ascii=True)


def _call_model_sync(project_id: str, engineer: EngineerRole, question: str, memory: dict, evidence: list[dict]) -> tuple[dict | None, dict]:
    model = ENGINEER_MODELS[engineer]
    try:
        if not _is_available(model):
            return None, {"model": model, "status": "model_unavailable"}
        payload = generate(_model_prompt(project_id, engineer, question, memory, evidence), model=model, timeout=45, num_predict=700)
    except Exception as exc:
        logger.warning("Project intelligence model call failed for %s: %s", model, exc)
        return None, {"model": model, "status": "model_error"}
    if not isinstance(payload, dict):
        return None, {"model": model, "status": "model_error"}
    return payload, {"model": model, "status": "reviewed"}


def _coerce_actions(raw_actions: Any, fallback: list[dict]) -> list[dict]:
    if not isinstance(raw_actions, list):
        return fallback
    actions: list[dict] = []
    for raw in raw_actions:
        if not isinstance(raw, dict):
            continue
        label = _text(raw.get("label"))[:120]
        if not label:
            continue
        try:
            count = int(raw.get("count", 0))
        except (TypeError, ValueError):
            count = 0
        severity = _text(raw.get("severity")).lower()
        if severity not in {"ok", "medium", "high"}:
            severity = "medium" if count else "ok"
        actions.append({"label": label, "count": max(0, count), "severity": severity})
        if len(actions) >= 8:
            break
    return actions or fallback


async def query_project_memory(
    project_id: str,
    engineer: EngineerRole,
    question: str,
    limit: int = 20,
    use_model: bool = True,
) -> dict:
    memory = get_project_memory(project_id, sample_limit=limit)
    evidence = _pick_evidence(project_id, engineer, question, limit)
    rules_answer, actions = _rules_answer(memory, engineer, evidence)
    model_status = {"model": ENGINEER_MODELS[engineer], "status": "disabled"}
    mode = "rules_only"
    answer = rules_answer

    if use_model:
        model_payload, model_status = await asyncio.to_thread(_call_model_sync, project_id, engineer, question, memory, evidence)
        if model_payload:
            model_answer = _text(model_payload.get("answer"))
            model_actions = model_payload.get("actions")
            if model_answer:
                answer = model_answer
            actions = _coerce_actions(model_actions, actions)
            mode = "rules_plus_model"
        else:
            mode = "rules_only_model_fallback"

    return {
        "project_id": project_id,
        "engineer": engineer,
        "mode": mode,
        "answer": answer,
        "actions": actions,
        "evidence": evidence,
        "memory": memory,
        "model_status": model_status,
    }
