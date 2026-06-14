from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from collections import Counter, defaultdict


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def write_learning_report(path: Path, summary: dict[str, Any], reviews: list[dict[str, Any]], run_meta: dict[str, Any]) -> None:
    lines = [
        "# XYRA Learning Review Report",
        "",
        f"- Run ID: {run_meta['run_id']}",
        f"- Project ID: {run_meta['project_id']}",
        f"- Provider: {run_meta['provider']}",
        f"- Model: {run_meta['model']}",
        f"- DB: {run_meta['db_path']}",
        "",
        "## Summary",
        "",
        f"- Total comments: {summary.get('total_comments', 0)}",
        f"- By deliverable: `{json.dumps(summary.get('by_deliverable', {}), sort_keys=True)}`",
        f"- By severity: `{json.dumps(summary.get('by_severity', {}), sort_keys=True)}`",
        f"- By fix type: `{json.dumps(summary.get('by_fix_type', {}), sort_keys=True)}`",
        "",
        "## Deliverable Reviews",
        "",
    ]
    for review in reviews:
        lines.extend(
            [
                f"### {review.get('deliverable', '').replace('_', ' ').title()}",
                "",
                f"- Grade: `{review.get('overall_grade', '')}`",
                f"- Summary: {review.get('summary', '')}",
                f"- Comments: {len(review.get('comments', []))}",
                "",
            ]
        )
        for idx, comment in enumerate(review.get("comments", [])[:25], start=1):
            subject = comment.get("tag_number") or comment.get("component_id") or comment.get("row_id") or "-"
            lines.extend(
                [
                    f"{idx}. **{comment.get('severity', '').upper()}** `{subject}` `{comment.get('field', '')}`",
                    f"   - Issue: {comment.get('issue', '')}",
                    f"   - Suggestion: {comment.get('suggested_value', '')}",
                    f"   - Fix type: `{comment.get('fix_type', '')}`",
                    f"   - Evidence needed: {comment.get('evidence_needed', '')}",
                    "",
                ]
            )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def write_teaching_targets(path: Path, reviews: list[dict[str, Any]]) -> None:
    comments = []
    for review in reviews:
        for comment in review.get("comments", []):
            item = dict(comment)
            item["deliverable"] = review.get("deliverable", "")
            comments.append(item)

    by_fix = Counter(c.get("fix_type", "") for c in comments)
    by_field = Counter(c.get("field", "") for c in comments)
    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for comment in comments:
        grouped[(comment.get("fix_type", ""), comment.get("field", ""))].append(comment)

    lines = [
        "# Teaching Targets",
        "",
        "Use this file to decide what becomes deterministic code, project legend work, or model teaching.",
        "",
        "## Counts",
        "",
        f"- By fix type: `{json.dumps(dict(by_fix), sort_keys=True)}`",
        f"- By field: `{json.dumps(dict(by_field), sort_keys=True)}`",
        "",
        "## Top Groups",
        "",
    ]

    for (fix_type, field), group in sorted(grouped.items(), key=lambda item: (-len(item[1]), item[0])):
        lines.extend(
            [
                f"### {fix_type or 'unspecified'} / {field or 'unspecified'} ({len(group)})",
                "",
            ]
        )
        for comment in group[:8]:
            subject = comment.get("tag_number") or comment.get("component_id") or comment.get("row_id") or "-"
            lines.append(
                f"- `{comment.get('deliverable')}` `{subject}` {comment.get('severity', '').upper()}: {comment.get('issue', '')}"
            )
        lines.append("")

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")
