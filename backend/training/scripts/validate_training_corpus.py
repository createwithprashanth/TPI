#!/usr/bin/env python3
"""Validate XYRA model training corpus packs."""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

KNOWN_MODELS = {
    "xyra-pid-engineer",
    "xyra-line-mapper",
    "xyra-project-context",
    "xyra-mto-reviewer",
    "xyra-instrumentation-engineer",
    "xyra-process-engineer",
    "xyra-piping-engineer",
}

SCRIPT_DIR = Path(__file__).resolve().parent
TRAINING_DIR = SCRIPT_DIR.parent
SOURCE_REGISTRY = TRAINING_DIR / "source_registry.json"
CORPUS_DIR = TRAINING_DIR / "corpus"


@dataclass
class ValidationResult:
    ok: bool
    errors: list[str]
    source_count: int
    pack_count: int
    example_count: int
    benchmark_count: int


def _load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def _word_count(value: str) -> int:
    return len([part for part in value.strip().split() if part])


def _validate_model_targets(errors: list[str], owner: str, targets: Any) -> None:
    if not isinstance(targets, list) or not targets:
        errors.append(f"{owner}: model_targets must be a non-empty list")
        return
    unknown = sorted(set(targets) - KNOWN_MODELS)
    if unknown:
        errors.append(f"{owner}: unknown model_targets {unknown}")


def _walk_strings(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        out: list[str] = []
        for item in value:
            out.extend(_walk_strings(item))
        return out
    if isinstance(value, dict):
        out = []
        for item in value.values():
            out.extend(_walk_strings(item))
        return out
    return []


def validate() -> ValidationResult:
    errors: list[str] = []
    registry = _load_json(SOURCE_REGISTRY)
    source_ids: set[str] = set()

    sources = registry.get("sources", [])
    if not isinstance(sources, list) or not sources:
        errors.append("source_registry.json: sources must be a non-empty list")
        sources = []

    for source in sources:
        sid = str(source.get("id", "")).strip()
        if not sid:
            errors.append("source_registry.json: source missing id")
            continue
        if sid in source_ids:
            errors.append(f"source_registry.json: duplicate source id {sid}")
        source_ids.add(sid)
        for field in ("title", "url", "publisher", "discipline", "status", "usage_note"):
            if not str(source.get(field, "")).strip():
                errors.append(f"source {sid}: missing {field}")
        if not str(source.get("url", "")).startswith(("https://", "http://")):
            errors.append(f"source {sid}: url must be http(s)")
        _validate_model_targets(errors, f"source {sid}", source.get("model_targets"))

    pack_count = example_count = benchmark_count = 0
    for path in sorted(CORPUS_DIR.glob("*.json")):
        pack_count += 1
        pack = _load_json(path)
        pack_id = str(pack.get("pack_id", "")).strip() or path.name
        if not isinstance(pack.get("version"), int):
            errors.append(f"{pack_id}: version must be an integer")
        _validate_model_targets(errors, pack_id, pack.get("model_targets"))

        refs = pack.get("sources", [])
        if not isinstance(refs, list) or not refs:
            errors.append(f"{pack_id}: sources must be a non-empty list")
        else:
            unknown_refs = sorted(set(refs) - source_ids)
            if unknown_refs:
                errors.append(f"{pack_id}: unknown source references {unknown_refs}")

        rules = pack.get("rules", [])
        if not isinstance(rules, list) or not rules:
            errors.append(f"{pack_id}: rules must be a non-empty list")
        for idx, rule in enumerate(rules):
            if not isinstance(rule, str) or _word_count(rule) < 5:
                errors.append(f"{pack_id}: rule {idx + 1} is too short")

        examples = pack.get("examples", [])
        if not isinstance(examples, list):
            errors.append(f"{pack_id}: examples must be a list")
            examples = []
        for example in examples:
            example_count += 1
            eid = str(example.get("id", "")).strip()
            if not eid:
                errors.append(f"{pack_id}: example missing id")
            _validate_model_targets(errors, f"{pack_id}/{eid}", example.get("model_targets"))
            if "input" not in example or "expected" not in example:
                errors.append(f"{pack_id}/{eid}: example must contain input and expected")

        benchmark_cases = pack.get("benchmark_cases", [])
        if not isinstance(benchmark_cases, list):
            errors.append(f"{pack_id}: benchmark_cases must be a list")
            benchmark_cases = []
        for case in benchmark_cases:
            benchmark_count += 1
            if not str(case.get("id", "")).strip():
                errors.append(f"{pack_id}: benchmark case missing id")
            if not str(case.get("suite", "")).strip():
                errors.append(f"{pack_id}/{case.get('id', '?')}: benchmark case missing suite")

        for text in _walk_strings(pack):
            if "verbatim_quote" in text.lower():
                errors.append(f"{pack_id}: avoid verbatim_quote fields/text")
            if _word_count(text) > 120:
                errors.append(f"{pack_id}: unusually long text block detected; keep corpus distilled")

    if pack_count == 0:
        errors.append("No corpus packs found")

    return ValidationResult(
        ok=not errors,
        errors=errors,
        source_count=len(source_ids),
        pack_count=pack_count,
        example_count=example_count,
        benchmark_count=benchmark_count,
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", help="Print machine-readable validation result")
    args = parser.parse_args()

    result = validate()
    payload = {
        "ok": result.ok,
        "source_count": result.source_count,
        "pack_count": result.pack_count,
        "example_count": result.example_count,
        "benchmark_count": result.benchmark_count,
        "errors": result.errors,
    }
    if args.json:
        print(json.dumps(payload, indent=2))
    else:
        print(
            "Training corpus: "
            f"{result.source_count} sources, {result.pack_count} packs, "
            f"{result.example_count} examples, {result.benchmark_count} benchmark additions"
        )
        if result.errors:
            print("\nErrors:")
            for error in result.errors:
                print(f"- {error}")
    return 0 if result.ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
