from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

DeliverableName = Literal["instrument_index", "io_list", "piping_mto"]
FixType = Literal[
    "deterministic_rule",
    "model_prompt",
    "benchmark",
    "project_legend",
    "ui_review_flag",
    "manual_review",
    "symbol_detection",
    "ocr_nearest_text",
    "mto_grouping",
]


@dataclass
class ReviewPayload:
    deliverable: DeliverableName
    project_id: str
    rows: list[dict[str, Any]]
    context: dict[str, Any] = field(default_factory=dict)
    instructions: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "deliverable": self.deliverable,
            "project_id": self.project_id,
            "context": self.context,
            "instructions": self.instructions,
            "rows": self.rows,
        }


@dataclass
class ReviewComment:
    deliverable: str
    severity: str
    field: str
    issue: str
    suggestion: str = ""
    row_id: str = ""
    tag_number: str = ""
    component_id: str = ""
    item_type: str = ""
    reason: str = ""
    evidence_needed: str = ""
    fix_type: str = "manual_review"

    def as_dict(self) -> dict[str, Any]:
        return self.__dict__.copy()
