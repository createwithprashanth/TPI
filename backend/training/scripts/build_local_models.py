#!/usr/bin/env python3
"""Build local Ollama models from XYRA Modelfiles."""
from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
MODEL_DIR = REPO_ROOT / "backend" / "modelfiles"

MODELFILES = {
    "xyra-pid-engineer": "xyra-pid-engineer.modelfile",
    "xyra-line-mapper": "xyra-line-mapper.modelfile",
    "xyra-project-context": "xyra-project-context.modelfile",
    "xyra-mto-reviewer": "xyra-mto-reviewer.modelfile",
    "xyra-instrumentation-engineer": "xyra-instrumentation-engineer.modelfile",
    "xyra-process-engineer": "xyra-process-engineer.modelfile",
    "xyra-piping-engineer": "xyra-piping-engineer.modelfile",
}


def parse_models(raw: str | None) -> list[str]:
    if not raw:
        return list(MODELFILES)
    models = [part.strip() for part in raw.split(",") if part.strip()]
    unknown = sorted(set(models) - set(MODELFILES))
    if unknown:
        raise ValueError(f"Unknown model(s): {', '.join(unknown)}")
    return models


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", help="Comma-separated model names. Defaults to all XYRA models.")
    parser.add_argument("--dry-run", action="store_true", help="Print build commands without running them.")
    args = parser.parse_args()

    try:
        selected = parse_models(args.models)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    for model in selected:
        modelfile = MODEL_DIR / MODELFILES[model]
        if not modelfile.exists():
            print(f"Missing Modelfile for {model}: {modelfile}", file=sys.stderr)
            return 1
        cmd = ["ollama", "create", model, "-f", str(modelfile)]
        print("+ " + " ".join(cmd))
        if not args.dry_run:
            subprocess.run(cmd, cwd=REPO_ROOT, check=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
