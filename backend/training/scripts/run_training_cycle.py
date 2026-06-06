#!/usr/bin/env python3
"""Run a repeatable XYRA local model training/test cycle."""
from __future__ import annotations

import argparse
import datetime as dt
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
TRAINING_DIR = REPO_ROOT / "backend" / "training"
REPORT_DIR = TRAINING_DIR / "reports"


def run_step(name: str, cmd: list[str], cwd: Path = REPO_ROOT) -> tuple[int, str]:
    print(f"\n== {name} ==")
    print("+ " + " ".join(cmd))
    proc = subprocess.run(
        cmd,
        cwd=cwd,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    print(proc.stdout)
    return proc.returncode, proc.stdout


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build", action="store_true", help="Rebuild local Ollama models before benchmarks.")
    parser.add_argument("--skip-pytest", action="store_true", help="Skip backend pytest regression.")
    parser.add_argument("--skip-frontend", action="store_true", help="Skip frontend build regression.")
    args = parser.parse_args()

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    started = dt.datetime.now().astimezone()
    stamp = started.strftime("%Y%m%d_%H%M%S")
    report_path = REPORT_DIR / f"training_run_{stamp}.md"

    steps: list[tuple[str, list[str], Path]] = [
        ("Corpus validation", [sys.executable, "backend/training/scripts/validate_training_corpus.py"], REPO_ROOT),
    ]
    if args.build:
        steps.append(("Local Ollama model build", [sys.executable, "backend/training/scripts/build_local_models.py"], REPO_ROOT))
    steps.extend(
        [
            ("PID/line benchmark", [sys.executable, "backend/tests/benchmarks/run_benchmark.py", "--category", "all"], REPO_ROOT),
            ("Engineering team benchmark", [sys.executable, "backend/tests/benchmarks/run_engineering_team_models.py"], REPO_ROOT),
        ]
    )
    if not args.skip_pytest:
        steps.append(("Backend pytest regression", [sys.executable, "-m", "pytest", "backend/tests", "-q"], REPO_ROOT))
    if not args.skip_frontend:
        steps.append(("Frontend production build", ["npm", "run", "build"], REPO_ROOT / "frontend"))

    failures = 0
    sections = [
        "# XYRA Model Training Run",
        "",
        f"- Started: {started.isoformat()}",
        f"- Build models: {args.build}",
        "",
    ]

    for name, cmd, cwd in steps:
        code, output = run_step(name, cmd, cwd)
        if code != 0:
            failures += 1
        sections.extend(
            [
                f"## {name}",
                "",
                f"- Exit code: {code}",
                "",
                "```text",
                output.strip(),
                "```",
                "",
            ]
        )

    finished = dt.datetime.now().astimezone()
    sections.insert(4, f"- Finished: {finished.isoformat()}")
    sections.insert(5, f"- Result: {'FAILED' if failures else 'PASSED'}")
    report_path.write_text("\n".join(sections), encoding="utf-8")
    print(f"\nReport written: {report_path}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
