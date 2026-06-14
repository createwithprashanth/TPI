from __future__ import annotations

import json

from .schemas import ReviewPayload


def build_teacher_prompt(payload: ReviewPayload) -> str:
    schema = {
        "deliverable": payload.deliverable,
        "overall_grade": "A|B|C|D",
        "summary": "short review summary",
        "comments": [
            {
                "row_id": "instrument row id when available",
                "tag_number": "instrument tag when available",
                "component_id": "MTO component id when available",
                "item_type": "MTO item type when available",
                "severity": "critical|high|medium|low",
                "field": "field being commented",
                "issue": "what is wrong or risky",
                "suggested_value": "suggested correction if evidence supports it",
                "reason": "why this matters",
                "evidence_needed": "what evidence would confirm it",
                "fix_type": "deterministic_rule|model_prompt|benchmark|project_legend|ui_review_flag|manual_review|symbol_detection|ocr_nearest_text|mto_grouping",
            }
        ],
    }
    body = {
        "role": "Senior EPC checker reviewing XYRA Studio generated deliverables.",
        "strict_rules": [
            "Return JSON only.",
            "Do not rewrite the deliverable.",
            "Do not invent client-specific values.",
            "Prioritize high-impact comments that can teach XYRA.",
            "If evidence is insufficient, use manual_review or project_legend.",
            "Do not flag blank signal_type or supply fields when io_type is None or Soft Link.",
            "Treat TE, TW, FE, and RO with io_type None as acceptable passive/mechanical rows unless another field is clearly wrong.",
            "Limit to the most important 25 comments.",
        ],
        "expected_schema": schema,
        "payload": payload.as_dict(),
    }
    return json.dumps(body, ensure_ascii=True)
