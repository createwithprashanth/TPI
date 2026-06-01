from __future__ import annotations

import copy
import json
import logging
import os
from typing import Any

from app.modules.llm.service import (
    MTO_REVIEWER_MODEL,
    MTO_REVIEWER_MODEL_FALLBACK,
    _is_available,
    generate,
)

logger = logging.getLogger(__name__)

_ENABLED = os.getenv("XYRA_MTO_REVIEW_USE_LLM", "1").strip().lower() in {"1", "true", "yes", "on"}
_MAX_NEARBY = 12


def is_enabled() -> bool:
    return _ENABLED


def _s(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _resolve_model() -> str | None:
    if _is_available(MTO_REVIEWER_MODEL):
        return MTO_REVIEWER_MODEL
    if _is_available(MTO_REVIEWER_MODEL_FALLBACK):
        return MTO_REVIEWER_MODEL_FALLBACK
    return None


def _nearby_text(match: dict, metadata: dict) -> list[str]:
    values = [
        match.get("sizeSource"),
        match.get("sizeInch"),
        metadata.get("pipingClass"),
        metadata.get("rating"),
        metadata.get("valveBore"),
        metadata.get("endConnection"),
        metadata.get("dataSheetDocumentNo"),
        metadata.get("dataSheetReferenceNo"),
    ]
    seen = set()
    result = []
    for value in values:
        text = _s(value)
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
        if len(result) >= _MAX_NEARBY:
            break
    return result


def _normalize_review(raw: dict | None) -> dict:
    if not isinstance(raw, dict):
        return {
            "decision": "REVIEW",
            "confidence": 0.0,
            "normalized_size_inch": "",
            "item_type": "",
            "piping_class": "",
            "rating": "",
            "valve_bore": "",
            "end_connection": "",
            "line_number": "",
            "datasheet_document_no": "",
            "datasheet_reference_no": "",
            "material_description_hint": "",
            "evidence": [],
            "review_flags": ["LLM_NO_RESPONSE"],
            "reason": "AI reviewer did not return a usable response.",
        }

    decision = _s(raw.get("decision")).upper()
    if decision not in {"ACCEPT", "REVIEW", "REJECT"}:
        decision = "REVIEW"
    try:
        confidence = max(0.0, min(1.0, float(raw.get("confidence") or 0)))
    except (TypeError, ValueError):
        confidence = 0.0

    flags = raw.get("review_flags")
    if not isinstance(flags, list):
        flags = []

    return {
        "decision": decision,
        "confidence": confidence,
        "normalized_size_inch": _s(raw.get("normalized_size_inch")),
        "item_type": _s(raw.get("item_type")),
        "piping_class": _s(raw.get("piping_class")),
        "rating": _s(raw.get("rating")),
        "valve_bore": _s(raw.get("valve_bore")),
        "end_connection": _s(raw.get("end_connection")),
        "line_number": _s(raw.get("line_number")),
        "datasheet_document_no": _s(raw.get("datasheet_document_no")),
        "datasheet_reference_no": _s(raw.get("datasheet_reference_no")),
        "material_description_hint": _s(raw.get("material_description_hint")),
        "evidence": [str(v).strip() for v in raw.get("evidence", []) if _s(v)],
        "review_flags": [str(v).strip() for v in flags if _s(v)],
        "reason": _s(raw.get("reason")),
    }


def _build_prompt(session: dict, file_result: dict, match: dict, metadata: dict) -> str:
    payload = {
        "component_label": _s(session.get("label")),
        "drawing": _s(file_result.get("fileName")),
        "page": int(match.get("page") or 1),
        "score": float(match.get("score") or 0),
        "detected_size_inch": _s(match.get("sizeInch")),
        "size_source": _s(match.get("sizeSource")),
        "nearby_text": _nearby_text(match, metadata),
        "metadata": {
            "itemType": _s(metadata.get("itemType")),
            "pipingClass": _s(metadata.get("pipingClass")),
            "rating": _s(metadata.get("rating")),
            "valveBore": _s(metadata.get("valveBore")),
            "endConnection": _s(metadata.get("endConnection")),
            "dataSheetDocumentNo": _s(metadata.get("dataSheetDocumentNo")),
            "dataSheetReferenceNo": _s(metadata.get("dataSheetReferenceNo")),
            "materialDescription": _s(metadata.get("materialDescription")),
        },
    }
    return json.dumps(payload, ensure_ascii=False)


def review_payload(payload: dict) -> dict:
    """
    Add optional AI review fields to each match in an export payload.

    This function is intentionally export-scoped, so routine detection remains fast
    and deterministic. If the model is unavailable, the payload is returned with
    a metadata note and no hard failure.
    """
    reviewed = copy.deepcopy(payload)
    reviewed.setdefault("aiReview", {})
    if not is_enabled():
        reviewed["aiReview"] = {"enabled": False, "model": MTO_REVIEWER_MODEL, "status": "disabled"}
        return reviewed

    model = _resolve_model()
    if not model:
        reviewed["aiReview"] = {"enabled": True, "model": MTO_REVIEWER_MODEL, "status": "model_unavailable"}
        return reviewed

    total = 0
    errors = 0
    for session in reviewed.get("sessions", []):
        metadata = session.get("metadata") or {}
        for file_result in session.get("fileResults", []):
            for match in file_result.get("matches", []):
                if _s(match.get("aiDecision")):
                    total += 1
                    continue
                prompt = _build_prompt(session, file_result, match, metadata)
                try:
                    raw = generate(prompt, model=model, timeout=45)
                    review = _normalize_review(raw)
                except Exception as exc:
                    logger.warning("Piping MTO AI review failed: %s", exc)
                    errors += 1
                    review = _normalize_review(None)
                match["aiDecision"] = review["decision"]
                match["aiConfidence"] = review["confidence"]
                match["aiReason"] = review["reason"]
                normalized_size = review["normalized_size_inch"] or _s(match.get("sizeInch"))
                flags = review["review_flags"]
                if normalized_size:
                    flags = [flag for flag in flags if flag != "SIZE_NOT_READ"]
                match["aiFlags"] = flags
                match["aiNormalizedSizeInch"] = normalized_size
                match["aiLineNumber"] = review.get("line_number", "")
                match["aiMaterialDescriptionHint"] = review.get("material_description_hint", "")
                total += 1

    reviewed["aiReview"] = {
        "enabled": True,
        "model": model,
        "status": "complete",
        "reviewed_matches": total,
        "errors": errors,
    }
    return reviewed
