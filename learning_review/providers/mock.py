from __future__ import annotations

import json


class MockProvider:
    name = "mock"

    def review(self, prompt: str, *, model: str = "mock") -> dict:
        payload = json.loads(prompt).get("payload", {})
        rows = payload.get("rows", [])
        comments = []
        for row in rows[:8]:
            deliverable = payload.get("deliverable", "")
            if deliverable == "piping_mto":
                if not row.get("size_inch") and not row.get("Size (Inch)"):
                    comments.append(
                        {
                            "component_id": row.get("component_id", ""),
                            "item_type": row.get("item_type") or row.get("Item Type", ""),
                            "severity": "medium",
                            "field": "size",
                            "issue": "MTO component has no explicit size in the review payload.",
                            "suggested_value": "",
                            "reason": "EPC MTO grouping needs size evidence.",
                            "evidence_needed": "Nearest inch text or line-number size evidence.",
                            "fix_type": "ocr_nearest_text",
                        }
                    )
                for field, label, fix_type in (
                    ("piping_class", "piping class", "mto_grouping"),
                    ("rating", "rating", "mto_grouping"),
                    ("end_connection", "end connection", "mto_grouping"),
                    ("material_description", "material description", "model_prompt"),
                ):
                    if not row.get(field):
                        comments.append(
                            {
                                "component_id": row.get("component_id", ""),
                                "item_type": row.get("item_type") or row.get("Item Type", ""),
                                "severity": "medium",
                                "field": field,
                                "issue": f"MTO row is missing {label}.",
                                "suggested_value": "",
                                "reason": f"EPC MTO grouping and material description need {label} evidence.",
                                "evidence_needed": "Project valve data sheet, class/spec table, legend, or nearby line/class evidence.",
                                "fix_type": fix_type,
                            }
                        )
            else:
                if not row.get("service"):
                    comments.append(
                        {
                            "row_id": row.get("id", ""),
                            "tag_number": row.get("tag_number", ""),
                            "severity": "medium",
                            "field": "service",
                            "issue": "Instrument service is missing.",
                            "suggested_value": "",
                            "reason": "Instrument index should carry concise service text before issue.",
                            "evidence_needed": "Connected line, upstream/downstream equipment, or project context.",
                            "fix_type": "model_prompt",
                        }
                    )
                if not row.get("line_tag") and row.get("instrument_type") in {"FCV", "PCV", "LCV", "TCV", "SDV", "BDV", "SSV", "PSV", "RO", "FE"}:
                    comments.append(
                        {
                            "row_id": row.get("id", ""),
                            "tag_number": row.get("tag_number", ""),
                            "severity": "high",
                            "field": "line_tag",
                            "issue": "Inline/process-facing item is missing connected line context.",
                            "suggested_value": "",
                            "reason": "Line context is needed for EPC handoff, FlowSizing, and MTO cross-checks.",
                            "evidence_needed": "Pipe label nearest the component or connected-line geometry evidence.",
                            "fix_type": "benchmark",
                        }
                    )
                if row.get("review_required"):
                    comments.append(
                        {
                            "row_id": row.get("id", ""),
                            "tag_number": row.get("tag_number", ""),
                            "severity": "medium",
                            "field": "review_required",
                            "issue": "Row is still flagged for engineer review.",
                            "suggested_value": "",
                            "reason": "Review rows should be resolved or explained before client issue.",
                            "evidence_needed": "Reason code and checkprint evidence.",
                            "fix_type": "ui_review_flag",
                        }
                    )
        return {
            "deliverable": payload.get("deliverable", ""),
            "overall_grade": "B",
            "summary": f"Mock review inspected {len(rows)} rows and produced teaching comments.",
            "comments": comments[:25],
        }
