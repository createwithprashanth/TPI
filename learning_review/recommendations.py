from __future__ import annotations

from collections import Counter
from typing import Any

DEFAULT_FIX_TYPE = "manual_review"
VALID_FIX_TYPES = {
    "deterministic_rule",
    "model_prompt",
    "benchmark",
    "project_legend",
    "ui_review_flag",
    "manual_review",
    "symbol_detection",
    "ocr_nearest_text",
    "mto_grouping",
}


def normalize_review(deliverable: str, raw: dict[str, Any]) -> dict[str, Any]:
    comments = raw.get("comments", [])
    if not isinstance(comments, list):
        comments = []
    normalized = []
    for item in comments:
        if not isinstance(item, dict):
            continue
        fix_type = str(item.get("fix_type") or DEFAULT_FIX_TYPE).strip()
        if fix_type not in VALID_FIX_TYPES:
            fix_type = DEFAULT_FIX_TYPE
        severity = str(item.get("severity") or "medium").strip().lower()
        if severity not in {"critical", "high", "medium", "low"}:
            severity = "medium"
        issue = str(item.get("issue") or "").strip()
        if not issue:
            continue
        normalized.append(
            {
                "deliverable": deliverable,
                "row_id": str(item.get("row_id") or "").strip(),
                "tag_number": str(item.get("tag_number") or "").strip(),
                "component_id": str(item.get("component_id") or "").strip(),
                "item_type": str(item.get("item_type") or "").strip(),
                "severity": severity,
                "field": str(item.get("field") or "").strip(),
                "issue": issue,
                "suggested_value": item.get("suggested_value", ""),
                "reason": str(item.get("reason") or "").strip(),
                "evidence_needed": str(item.get("evidence_needed") or "").strip(),
                "fix_type": fix_type,
            }
        )
    return {
        "deliverable": deliverable,
        "overall_grade": raw.get("overall_grade", ""),
        "summary": str(raw.get("summary") or "").strip(),
        "comments": normalized,
    }


def summarize_reviews(reviews: list[dict[str, Any]]) -> dict[str, Any]:
    comments = [comment for review in reviews for comment in review.get("comments", [])]
    return {
        "total_comments": len(comments),
        "by_deliverable": dict(Counter(comment["deliverable"] for comment in comments)),
        "by_severity": dict(Counter(comment["severity"] for comment in comments)),
        "by_fix_type": dict(Counter(comment["fix_type"] for comment in comments)),
    }
