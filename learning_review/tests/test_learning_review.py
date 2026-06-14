from __future__ import annotations

import json
from pathlib import Path

from learning_review.mto_reader import _rows_from_workbook
from learning_review.db_reader import _decode_json_fields
from learning_review.recommendations import normalize_review, summarize_reviews
from learning_review.report_writer import write_learning_report


def test_normalize_review_filters_invalid_comments():
    raw = {
        "overall_grade": "B",
        "summary": "ok",
        "comments": [
            {"issue": "Missing service", "severity": "HIGH", "fix_type": "model_prompt", "field": "service"},
            {"issue": ""},
            {"issue": "Unknown fix", "fix_type": "strange"},
        ],
    }
    review = normalize_review("instrument_index", raw)
    assert len(review["comments"]) == 2
    assert review["comments"][0]["severity"] == "high"
    assert review["comments"][1]["fix_type"] == "manual_review"


def test_decode_json_fields_parses_geometry_evidence():
    row = _decode_json_fields(
        {
            "tag_number": "SSV-100",
            "geometry_evidence": '{"nearest_line_label":{"tag":"2-PG-100","confidence":0.42}}',
            "line_candidates": '[{"line_number":"2-PG-100"}]',
            "field_confidence": '{"service":0.9}',
        }
    )

    assert row["geometry_evidence"]["nearest_line_label"]["tag"] == "2-PG-100"
    assert row["line_candidates"][0]["line_number"] == "2-PG-100"
    assert row["field_confidence"]["service"] == 0.9


def test_summarize_reviews_counts_comments():
    reviews = [
        {
            "comments": [
                {"deliverable": "instrument_index", "severity": "high", "fix_type": "benchmark"},
                {"deliverable": "piping_mto", "severity": "medium", "fix_type": "mto_grouping"},
            ]
        }
    ]
    summary = summarize_reviews(reviews)
    assert summary["total_comments"] == 2
    assert summary["by_deliverable"]["piping_mto"] == 1


def test_write_learning_report(tmp_path: Path):
    path = tmp_path / "report.md"
    write_learning_report(
        path,
        {"total_comments": 1, "by_deliverable": {"instrument_index": 1}, "by_severity": {"high": 1}, "by_fix_type": {"benchmark": 1}},
        [
            {
                "deliverable": "instrument_index",
                "overall_grade": "B",
                "summary": "Needs review",
                "comments": [
                    {
                        "severity": "high",
                        "tag_number": "101-FCV-001",
                        "field": "line_tag",
                        "issue": "Missing line",
                        "suggested_value": "",
                        "fix_type": "benchmark",
                        "evidence_needed": "Connected line",
                    }
                ],
            }
        ],
        {"run_id": "run", "project_id": "p", "provider": "mock", "model": "mock", "db_path": "db"},
    )
    assert "XYRA Learning Review Report" in path.read_text()
