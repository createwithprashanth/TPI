from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.modules.ai_engineers.contracts import (
    ALL_SUGGESTION_FIELDS,
    ENGINEER_MODELS,
    EngineerRole,
    ROLE_ALLOWED_FIELDS,
    TYPE_DEFAULTS,
)
from app.modules.llm.service import (
    _is_available,
    generate,
)

PREFIX = "/api/v1/engineering-team"
router = APIRouter()
logger = logging.getLogger(__name__)

NOISE_PREFIXES = ("NOTE", "REV", "DWG", "SHT", "TITLE", "AREA", "UNIT", "LINE")
MODEL_ROW_LIMIT = 60
MODEL_TIMEOUT_SECONDS = int(os.getenv("XYRA_ENGINEERING_MODEL_TIMEOUT", "90"))
MODEL_NUM_PREDICT = int(os.getenv("XYRA_ENGINEERING_MODEL_NUM_PREDICT", "1600"))


class ReviewRow(BaseModel):
    model_config = {"extra": "allow"}
    id: str
    tag_number: str | None = None
    instrument_type: str | None = None
    service: str | None = None
    category: str | None = None
    io_type: str | None = None
    signal_type: str | None = None
    line_tag: str | None = None
    pid_number: str | None = None
    status: str | None = None
    review_required: bool | None = None
    flowsizing_type: str | None = None
    source: str | None = None


class ReviewRequest(BaseModel):
    project_id: str
    roles: list[EngineerRole] = Field(default_factory=lambda: ["instrumentation"])
    rows: list[ReviewRow]
    question: str | None = None
    use_models: bool = True


class ReviewSuggestion(BaseModel):
    id: str
    tag_number: str
    engineer: EngineerRole
    field: str
    current_value: Any = None
    suggested_value: Any = None
    confidence: float
    reason: str


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _upper(value: Any) -> str:
    return _text(value).upper()


def _add(
    suggestions: list[ReviewSuggestion],
    row: ReviewRow,
    engineer: EngineerRole,
    field: str,
    suggested_value: Any,
    confidence: float,
    reason: str,
) -> None:
    current = getattr(row, field, None)
    if current == suggested_value:
        return
    suggestions.append(
        ReviewSuggestion(
            id=row.id,
            tag_number=_text(row.tag_number),
            engineer=engineer,
            field=field,
            current_value=current,
            suggested_value=suggested_value,
            confidence=round(confidence, 2),
            reason=reason,
        )
    )


def _instrumentation_review(row: ReviewRow) -> list[ReviewSuggestion]:
    suggestions: list[ReviewSuggestion] = []
    tag = _upper(row.tag_number)
    inst_type = _upper(row.instrument_type)

    if not tag:
        _add(suggestions, row, "instrumentation", "review_required", True, 0.95, "Missing tag number; engineer review required.")
        return suggestions

    if tag.startswith(NOISE_PREFIXES) or tag in {"D", "NO", "MIN", "MAX"}:
        _add(suggestions, row, "instrumentation", "review_required", True, 0.9, "Looks like a drawing note/title-block fragment rather than an instrument tag.")
        _add(suggestions, row, "instrumentation", "status", "For Review", 0.85, "Potential noise tag should not be issued without review.")

    prefix = "".join(ch for ch in tag.split("-")[0] if ch.isalpha())
    inferred_type = prefix if prefix in TYPE_DEFAULTS else ""
    if inferred_type and (not inst_type or inst_type == "UNKNOWN"):
        _add(suggestions, row, "instrumentation", "instrument_type", inferred_type, 0.82, "Instrument type can be inferred from the tag prefix.")
        inst_type = inferred_type

    defaults = TYPE_DEFAULTS.get(inst_type)
    if defaults:
        for field in ("io_type", "signal_type", "category", "flowsizing_type"):
            if field in defaults and not _text(getattr(row, field, None)):
                _add(
                    suggestions,
                    row,
                    "instrumentation",
                    field,
                    defaults[field],
                    0.78,
                    f"{inst_type} normally maps to {field.replace('_', ' ')} `{defaults[field]}`.",
                )

    if not _text(row.status):
        _add(suggestions, row, "instrumentation", "status", "Draft", 0.7, "Rows should carry a lifecycle status.")

    if _text(row.source) == "ai_extracted" and row.review_required is None:
        _add(suggestions, row, "instrumentation", "review_required", True, 0.65, "AI extracted rows should explicitly carry a review flag.")

    return suggestions


def _process_review(row: ReviewRow) -> list[ReviewSuggestion]:
    suggestions: list[ReviewSuggestion] = []
    inst_type = _upper(row.instrument_type)
    tag = _upper(row.tag_number)

    if inst_type in {"FT", "FIT", "FIC", "FCV", "FE", "RO", "PT", "PIT", "PDT", "LT", "LIT", "TT", "TIT", "AT", "FCV", "PCV", "LCV", "TCV"}:
        if not _text(row.line_tag):
            _add(suggestions, row, "process", "review_required", True, 0.84, "Process-facing instrument has no connected line number.")
            _add(suggestions, row, "process", "status", "For Review", 0.76, "Missing process connection must be checked before issue.")

    if not _text(row.service):
        guessed = ""
        if tag.startswith(("F", "FE", "RO")):
            guessed = "Flow measurement / process line service"
        elif tag.startswith("P"):
            guessed = "Pressure measurement / process line service"
        elif tag.startswith("T"):
            guessed = "Temperature measurement / process line service"
        elif tag.startswith("L"):
            guessed = "Level measurement / vessel service"
        elif tag.startswith(("FCV", "PCV", "LCV", "TCV")):
            guessed = "Control valve service"
        if guessed:
            _add(suggestions, row, "process", "service", guessed, 0.55, "Service is missing; this is a conservative placeholder based on tag family.")
            _add(suggestions, row, "process", "review_required", True, 0.7, "AI-generated service placeholder must be confirmed.")

    return suggestions


def _piping_review(row: ReviewRow) -> list[ReviewSuggestion]:
    suggestions: list[ReviewSuggestion] = []
    inst_type = _upper(row.instrument_type)
    tag = _upper(row.tag_number)
    line = _text(row.line_tag)

    if inst_type in {"FCV", "PCV", "LCV", "TCV", "HCV", "BDV", "SDV", "SSV", "MOV", "XV", "PSV", "FE", "RO"}:
        if not line:
            _add(suggestions, row, "piping", "review_required", True, 0.88, "Inline piping item has no line tag.")
            _add(suggestions, row, "piping", "status", "For Review", 0.78, "Inline item needs line context for MTO/sizing handoff.")
        elif line.count("-") < 2:
            _add(suggestions, row, "piping", "review_required", True, 0.72, "Line tag does not look like a complete EPC line number.")

    defaults = TYPE_DEFAULTS.get(inst_type)
    if defaults and defaults.get("flowsizing_type") and not _text(row.flowsizing_type):
        _add(suggestions, row, "piping", "flowsizing_type", defaults["flowsizing_type"], 0.76, "Inline item should be available for FlowSizing handoff.")

    if tag.startswith(("BV", "GV", "CV")) and not inst_type:
        _add(suggestions, row, "piping", "review_required", True, 0.66, "Tag may be a piping valve tag; confirm if it belongs in instrument index or MTO only.")

    return suggestions


def _summarize(rows: list[ReviewRow], suggestions: list[ReviewSuggestion]) -> dict:
    by_engineer: dict[str, int] = {}
    by_field: dict[str, int] = {}
    for item in suggestions:
        by_engineer[item.engineer] = by_engineer.get(item.engineer, 0) + 1
        by_field[item.field] = by_field.get(item.field, 0) + 1
    return {
        "rows_reviewed": len(rows),
        "suggestions": len(suggestions),
        "by_engineer": by_engineer,
        "by_field": by_field,
    }


def _row_payload(row: ReviewRow) -> dict:
    return {
        "id": row.id,
        "tag_number": row.tag_number or "",
        "instrument_type": row.instrument_type or "",
        "service": row.service or "",
        "category": row.category or "",
        "io_type": row.io_type or "",
        "signal_type": row.signal_type or "",
        "line_tag": row.line_tag or "",
        "pid_number": row.pid_number or "",
        "status": row.status or "",
        "review_required": bool(row.review_required) if row.review_required is not None else False,
        "flowsizing_type": row.flowsizing_type or "",
        "source": row.source or "",
    }


def _build_model_prompt(body: ReviewRequest, role: EngineerRole, rows: list[ReviewRow]) -> str:
    return json.dumps(
        {
            "project_id": body.project_id,
            "engineer": role,
            "question": body.question or "",
            "rows": [_row_payload(row) for row in rows[:MODEL_ROW_LIMIT]],
        },
        ensure_ascii=True,
    )


def _coerce_model_suggestions(
    role: EngineerRole,
    rows_by_id: dict[str, ReviewRow],
    payload: dict | None,
) -> list[ReviewSuggestion]:
    if not isinstance(payload, dict):
        return []
    raw_items = payload.get("suggestions", [])
    if not isinstance(raw_items, list):
        return []

    suggestions: list[ReviewSuggestion] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        row_id = _text(raw.get("id"))
        row = rows_by_id.get(row_id)
        if not row:
            continue
        field = _text(raw.get("field"))
        if field not in ALL_SUGGESTION_FIELDS:
            continue
        if field not in ROLE_ALLOWED_FIELDS[role]:
            continue
        suggested_value = raw.get("suggested_value")
        current = getattr(row, field, None)
        if current == suggested_value:
            continue
        try:
            confidence = float(raw.get("confidence", 0))
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = max(0.0, min(confidence, 1.0))
        reason = _text(raw.get("reason"))[:240] or f"{role} model suggested a review update."
        suggestions.append(
            ReviewSuggestion(
                id=row.id,
                tag_number=_text(row.tag_number),
                engineer=role,
                field=field,
                current_value=current,
                suggested_value=suggested_value,
                confidence=round(confidence, 2),
                reason=reason,
            )
        )
    return suggestions


def _call_role_model_sync(body: ReviewRequest, role: EngineerRole, rows: list[ReviewRow]) -> tuple[str, list[ReviewSuggestion]]:
    model = ENGINEER_MODELS[role]
    try:
        if not _is_available(model):
            return "model_unavailable", []
        payload = generate(
            _build_model_prompt(body, role, rows),
            model=model,
            timeout=MODEL_TIMEOUT_SECONDS,
            num_predict=MODEL_NUM_PREDICT,
        )
    except Exception as exc:
        logger.warning("Engineering team model call failed for %s: %s", model, exc)
        return "model_error", []
    return "reviewed" if payload else "model_error", _coerce_model_suggestions(
        role,
        {row.id: row for row in rows},
        payload,
    )


@router.post("/review")
async def review_rows(body: ReviewRequest) -> dict:
    if not body.rows:
        raise HTTPException(status_code=400, detail="Select at least one row for engineering review.")
    if len(body.rows) > 250:
        raise HTTPException(status_code=400, detail="Review up to 250 rows at a time.")

    roles = body.roles or ["instrumentation"]
    suggestions: list[ReviewSuggestion] = []
    model_status: dict[str, dict[str, Any]] = {}
    for row in body.rows:
        if "instrumentation" in roles:
            suggestions.extend(_instrumentation_review(row))
        if "process" in roles:
            suggestions.extend(_process_review(row))
        if "piping" in roles:
            suggestions.extend(_piping_review(row))

    if body.use_models:
        model_rows = body.rows[:MODEL_ROW_LIMIT]
        for role in roles:
            model = ENGINEER_MODELS[role]
            status, model_suggestions = await asyncio.to_thread(_call_role_model_sync, body, role, model_rows)
            suggestions.extend(model_suggestions)
            model_status[role] = {
                "model": model,
                "status": status if len(body.rows) <= MODEL_ROW_LIMIT else f"{status}_limited_to_{MODEL_ROW_LIMIT}",
                "suggestions": len(model_suggestions),
            }
    else:
        for role in roles:
            model_status[role] = {
                "model": ENGINEER_MODELS[role],
                "status": "disabled",
                "suggestions": 0,
            }

    unique: dict[tuple[str, str], ReviewSuggestion] = {}
    for item in suggestions:
        key = (item.id, item.field)
        current = unique.get(key)
        if not current or item.confidence > current.confidence:
            unique[key] = item

    ordered = sorted(
        unique.values(),
        key=lambda item: (-item.confidence, item.tag_number, item.engineer, item.field),
    )
    return {
        "project_id": body.project_id,
        "mode": "rules_plus_models" if body.use_models else "deterministic_rules",
        "summary": _summarize(body.rows, ordered),
        "model_status": model_status,
        "suggestions": [item.model_dump() for item in ordered],
    }
