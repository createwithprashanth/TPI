#!/usr/bin/env python3
"""Run real P&ID extraction, AI Grid model review, and SQLite save checks."""
from __future__ import annotations

import argparse
import asyncio
import json
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_ROOT = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_ROOT))

from app.config.local_db import connection, db_path, init_db  # noqa: E402
from app.modules.engineering_team.routes import ReviewRequest, ReviewRow, review_rows  # noqa: E402
from app.modules.instruments import service as instrument_service  # noqa: E402
from app.workers.instrumap_tasks import process_pid_task  # noqa: E402

DEFAULT_PID_DIR = Path("/Users/prashanththipparthi/Downloads/Zoho WorkDrive")
DEFAULT_PROJECT_ID = "XYRA_E2E_PID_GRID_TEST_20260607"
AI_ROLES = ["instrumentation", "process", "piping"]
APPLY_FIELDS = {
    "instrument_type",
    "category",
    "io_type",
    "signal_type",
    "service",
    "line_tag",
    "status",
    "review_required",
    "flowsizing_type",
}


def _pdfs(pid_dir: Path, limit: int | None) -> list[Path]:
    files = sorted(pid_dir.glob("*.pdf"), key=lambda p: p.name)
    if limit:
        files = files[:limit]
    return files


def _count_project(project_id: str) -> dict[str, int]:
    with connection() as conn:
        return {
            "instruments": int(conn.execute("SELECT COUNT(*) FROM instruments WHERE project_id=?", (project_id,)).fetchone()[0] or 0),
            "sessions": int(conn.execute("SELECT COUNT(*) FROM extraction_sessions WHERE project_id=?", (project_id,)).fetchone()[0] or 0),
            "history": int(
                conn.execute(
                    """
                    SELECT COUNT(*)
                    FROM instrument_field_history h
                    JOIN instruments i ON i.id=h.instrument_id
                    WHERE i.project_id=?
                    """,
                    (project_id,),
                ).fetchone()[0] or 0
            ),
        }


def _reset_project(project_id: str) -> None:
    init_db()
    with connection() as conn:
        conn.execute("DELETE FROM projects WHERE project_id=?", (project_id,))


def _process_pids(files: list[Path], project_id: str, batch_id: str) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for index, pdf in enumerate(files, start=1):
        started = time.perf_counter()
        result = process_pid_task(
            job_id=f"accept-{index:02d}",
            pdf_content=pdf.read_bytes(),
            pdf_filename=pdf.name,
            batch_id=batch_id,
            project_name="XYRA Acceptance Test",
            project_no=project_id,
            client_name="Internal QA",
            contractor_name="XYRA Studio",
            location="Local",
        )
        result["elapsed_s"] = round(time.perf_counter() - started, 2)
        result["file"] = pdf.name
        results.append(result)
        status = result.get("status")
        count = result.get("instrument_count", 0)
        db_result = result.get("project_database") or {}
        print(
            f"{pdf.name}: status={status} instruments={count} "
            f"db={db_result} elapsed={result['elapsed_s']}s",
            flush=True,
        )
    return results


def _load_review_rows(project_id: str, limit: int) -> list[ReviewRow]:
    listed = instrument_service.list_instruments(
        project_id=project_id,
        page=1,
        page_size=limit,
        sort_by="updated_at",
        sort_dir="desc",
    )
    rows = []
    for item in listed["data"]:
        rows.append(
            ReviewRow(
                id=str(item.get("id") or ""),
                tag_number=item.get("tag_number"),
                instrument_type=item.get("instrument_type"),
                service=item.get("service"),
                category=item.get("category"),
                io_type=item.get("io_type"),
                signal_type=item.get("signal_type"),
                line_tag=item.get("line_tag"),
                pid_number=item.get("pid_number"),
                status=item.get("status"),
                review_required=item.get("review_required"),
                flowsizing_type=item.get("flowsizing_type"),
                source=item.get("source"),
            )
        )
    return rows


async def _review_and_apply(project_id: str, limit: int, min_confidence: float) -> dict[str, Any]:
    rows = _load_review_rows(project_id, limit)
    if not rows:
        raise RuntimeError("No instruments available for AI Grid review")
    body = ReviewRequest(
        project_id=project_id,
        roles=AI_ROLES,
        rows=rows,
        question="Review extracted P&ID instruments before EPC issue. Fill safe grid fields only.",
        use_models=True,
    )
    payload = await review_rows(body)
    applied = 0
    skipped = 0
    for suggestion in payload.get("suggestions", []):
        field = suggestion.get("field")
        if field not in APPLY_FIELDS:
            skipped += 1
            continue
        try:
            confidence = float(suggestion.get("confidence") or 0)
        except (TypeError, ValueError):
            confidence = 0.0
        if confidence < min_confidence:
            skipped += 1
            continue
        updated = instrument_service.update_instrument(
            str(suggestion["id"]),
            {field: suggestion.get("suggested_value")},
            user_id="acceptance-ai-grid",
        )
        applied += 1 if updated else 0
    return {
        "rows_reviewed": len(rows),
        "summary": payload.get("summary", {}),
        "model_status": payload.get("model_status", {}),
        "suggestions": len(payload.get("suggestions", [])),
        "applied": applied,
        "skipped": skipped,
    }


def _sample_db_rows(project_id: str, limit: int = 8) -> list[dict[str, Any]]:
    listed = instrument_service.list_instruments(project_id=project_id, page=1, page_size=limit)
    return [
        {
            "tag_number": row.get("tag_number"),
            "instrument_type": row.get("instrument_type"),
            "service": row.get("service"),
            "io_type": row.get("io_type"),
            "line_tag": row.get("line_tag"),
            "status": row.get("status"),
            "review_required": row.get("review_required"),
        }
        for row in listed["data"]
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pid-dir", type=Path, default=DEFAULT_PID_DIR)
    parser.add_argument("--project-id", default=DEFAULT_PROJECT_ID)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--review-limit", type=int, default=60)
    parser.add_argument("--min-confidence", type=float, default=0.70)
    parser.add_argument("--reset-project", action="store_true")
    parser.add_argument("--report", type=Path, default=BACKEND_ROOT / "training" / "reports" / "pid_grid_acceptance_20260607.json")
    args = parser.parse_args()

    files = _pdfs(args.pid_dir, args.limit)
    if not files:
        print(f"No PDFs found in {args.pid_dir}", file=sys.stderr)
        return 2

    if args.reset_project:
        _reset_project(args.project_id)

    before = _count_project(args.project_id)
    batch_id = f"pid_grid_acceptance_{int(time.time())}"
    print(f"DB: {db_path()}")
    print(f"Project: {args.project_id}")
    print(f"PIDs: {len(files)}")
    print(f"Before: {before}")

    started = time.perf_counter()
    pid_results = _process_pids(files, args.project_id, batch_id)
    failed = [item for item in pid_results if item.get("status") != "finished"]
    after_extract = _count_project(args.project_id)
    if failed:
        print(f"Extraction failed for {[item.get('file') for item in failed]}", file=sys.stderr)
        return 1
    if after_extract["instruments"] <= before["instruments"]:
        print("No new/updated instruments were visible in SQLite after extraction", file=sys.stderr)
        return 1

    ai_result = asyncio.run(_review_and_apply(args.project_id, args.review_limit, args.min_confidence))
    after_ai = _count_project(args.project_id)
    if ai_result["rows_reviewed"] == 0:
        print("AI Grid review did not review any rows", file=sys.stderr)
        return 1
    if not ai_result["model_status"]:
        print("AI Grid model status missing", file=sys.stderr)
        return 1

    report = {
        "project_id": args.project_id,
        "db_path": str(db_path()),
        "pid_dir": str(args.pid_dir),
        "batch_id": batch_id,
        "elapsed_s": round(time.perf_counter() - started, 2),
        "before": before,
        "after_extract": after_extract,
        "after_ai": after_ai,
        "pid_results": [
            {
                "file": item.get("file"),
                "status": item.get("status"),
                "instrument_count": item.get("instrument_count"),
                "project_database": item.get("project_database"),
                "elapsed_s": item.get("elapsed_s"),
            }
            for item in pid_results
        ],
        "ai_grid": ai_result,
        "sample_rows": _sample_db_rows(args.project_id),
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"After extraction: {after_extract}")
    print(f"AI Grid: {ai_result}")
    print(f"After AI: {after_ai}")
    print(f"Report: {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
