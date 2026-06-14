from __future__ import annotations

from pathlib import Path

from .config import MAX_MTO_ROWS, MAX_REVIEW_ROWS
from .db_reader import read_instrument_rows, read_line_connected_io_rows, read_project_context
from .mto_reader import read_mto_rows
from .schemas import ReviewPayload


def build_instrument_index_payload(db_path: Path, project_id: str, limit: int = MAX_REVIEW_ROWS) -> ReviewPayload:
    return ReviewPayload(
        deliverable="instrument_index",
        project_id=project_id,
        context=read_project_context(db_path, project_id),
        rows=read_instrument_rows(db_path, project_id, limit),
        instructions=[
            "Review as senior EPC instrumentation checker.",
            "Find wrong/noisy tags, missing service, wrong IO/signal/category, weak line assignment, and missing review flags.",
            "Use geometry_evidence, line_candidates, line_association_method, and line_association_reason to judge whether line/service assignments are supported.",
            "geometry_evidence.nearest_line_label is weak review evidence only; it is not a confirmed line_tag unless supported by pipe graph or project legend.",
            "When geometry_evidence is absent, say whether the issue is missing evidence rather than model knowledge.",
            "Do not invent project-specific values. Use manual_review or project_legend when evidence is missing.",
        ],
    )


def build_io_list_payload(db_path: Path, project_id: str, limit: int = MAX_REVIEW_ROWS) -> ReviewPayload:
    return ReviewPayload(
        deliverable="io_list",
        project_id=project_id,
        context=read_project_context(db_path, project_id),
        rows=read_line_connected_io_rows(db_path, project_id, limit),
        instructions=[
            "Review as senior EPC IO list checker.",
            "Rows are limited to hardwired IO where a process line or equipment tag is normally expected.",
            "Check IO type, signal type, system, supply voltage, and line/equipment assignment.",
            "Use geometry_evidence and line association fields to decide whether missing/suspicious line assignments are supported by drawing evidence.",
            "Treat geometry_evidence.nearest_line_label as a clue for manual review, not as a confirmed connected line.",
            "Flag missing or suspicious IO rows only; do not require process line tags for F&G area devices or hand switches unless explicit evidence exists.",
        ],
    )


def build_piping_mto_payload(mto_export_dir: Path, project_id: str, limit: int = MAX_MTO_ROWS) -> ReviewPayload:
    rows, context = read_mto_rows(mto_export_dir, limit)
    context["project_id"] = project_id
    return ReviewPayload(
        deliverable="piping_mto",
        project_id=project_id,
        context=context,
        rows=rows,
        instructions=[
            "Review as senior EPC piping MTO checker.",
            "Find wrong component type, missing/wrong size, likely false positives, duplicate grouping, missing rating/class/end connection, and weak material description.",
            "For size, prefer explicit inch-mark evidence near the component and line-number size only when appropriate.",
        ],
    )
