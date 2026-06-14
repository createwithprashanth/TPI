#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from learning_review.config import DB_PATH, DEFAULT_PROJECT_ID, MAX_MTO_ROWS, MAX_REVIEW_ROWS, MTO_EXPORT_DIR, RUNS_DIR
from learning_review.payloads import build_instrument_index_payload, build_io_list_payload, build_piping_mto_payload
from learning_review.prompts import build_teacher_prompt
from learning_review.providers import get_provider
from learning_review.recommendations import normalize_review, summarize_reviews
from learning_review.report_writer import write_json, write_learning_report, write_teaching_targets


def _selected_deliverables(raw: str) -> list[str]:
    if raw == "all":
        return ["instrument_index", "io_list", "piping_mto"]
    selected = [item.strip() for item in raw.split(",") if item.strip()]
    valid = {"instrument_index", "io_list", "piping_mto"}
    unknown = sorted(set(selected) - valid)
    if unknown:
        raise ValueError(f"Unknown deliverable(s): {unknown}")
    return selected


def _build_payload(name: str, project_id: str, db_path: Path, mto_dir: Path, row_limit: int, mto_limit: int):
    if name == "instrument_index":
        return build_instrument_index_payload(db_path, project_id, row_limit)
    if name == "io_list":
        return build_io_list_payload(db_path, project_id, row_limit)
    if name == "piping_mto":
        return build_piping_mto_payload(mto_dir, project_id, mto_limit)
    raise ValueError(name)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run temporary external-teacher learning review.")
    parser.add_argument("--project-id", default=DEFAULT_PROJECT_ID)
    parser.add_argument("--provider", default="mock", choices=["mock", "openai", "gemini"])
    parser.add_argument("--model", default="")
    parser.add_argument("--deliverables", default="all", help="all or comma list: instrument_index,io_list,piping_mto")
    parser.add_argument("--db-path", type=Path, default=DB_PATH)
    parser.add_argument("--mto-export-dir", type=Path, default=MTO_EXPORT_DIR)
    parser.add_argument("--row-limit", type=int, default=MAX_REVIEW_ROWS)
    parser.add_argument("--mto-limit", type=int, default=MAX_MTO_ROWS)
    parser.add_argument("--runs-dir", type=Path, default=RUNS_DIR)
    parser.add_argument("--payload-only", action="store_true", help="Write payloads but do not call provider.")
    args = parser.parse_args()

    started = time.perf_counter()
    run_id = f"learning_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}"
    run_dir = args.runs_dir / run_id
    payload_dir = run_dir / "review_payloads"
    comment_dir = run_dir / "comments"

    provider = get_provider(args.provider)
    model = args.model or {"mock": "mock", "openai": "gpt-4.1", "gemini": "gemini-2.5-flash"}[args.provider]
    deliverables = _selected_deliverables(args.deliverables)

    reviews = []
    for name in deliverables:
        payload = _build_payload(name, args.project_id, args.db_path, args.mto_export_dir, args.row_limit, args.mto_limit)
        payload_data = payload.as_dict()
        write_json(payload_dir / f"{name}.json", payload_data)
        print(f"Payload {name}: {len(payload.rows)} rows")
        if args.payload_only:
            continue
        prompt = build_teacher_prompt(payload)
        raw_review = provider.review(prompt, model=model)
        normalized = normalize_review(name, raw_review)
        write_json(comment_dir / f"{name}_comments.json", normalized)
        reviews.append(normalized)
        print(f"Review {name}: {len(normalized['comments'])} comments")

    summary = summarize_reviews(reviews)
    run_meta = {
        "run_id": run_id,
        "project_id": args.project_id,
        "provider": args.provider,
        "model": model,
        "db_path": str(args.db_path),
        "mto_export_dir": str(args.mto_export_dir),
        "elapsed_s": round(time.perf_counter() - started, 2),
        "payload_only": args.payload_only,
        "summary": summary,
    }
    write_json(run_dir / "run_summary.json", run_meta)
    write_learning_report(run_dir / "learning_report.md", summary, reviews, run_meta)
    write_teaching_targets(run_dir / "teaching_targets.md", reviews)
    print(f"Run: {run_dir}")
    print(f"Summary: {summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
