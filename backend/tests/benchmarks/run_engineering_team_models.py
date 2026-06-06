#!/usr/bin/env python3
"""
Smoke-test the three XYRA Engineering Team Ollama models.

Run after building Modelfiles:
    python backend/tests/benchmarks/run_engineering_team_models.py
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
CASES = Path(__file__).with_name("engineering_team_cases.json")
OLLAMA_BASE_URL = os.getenv("OLLAMA_HOST", "http://localhost:11434")


def call_model(model: str, role: str, row: dict[str, Any]) -> dict[str, Any]:
    prompt = json.dumps(
        {
            "project_id": "BENCH",
            "engineer": role,
            "question": "",
            "rows": [row],
        },
        ensure_ascii=True,
    )
    body = json.dumps(
        {
            "model": model,
            "prompt": prompt,
            "format": "json",
            "stream": False,
            "options": {"temperature": 0.03, "num_predict": 650},
        }
    ).encode()
    req = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = json.loads(resp.read())
    return json.loads(raw.get("response", "{}"))


def suggestions_map(payload: dict[str, Any]) -> dict[str, Any]:
    mapped: dict[str, Any] = {}
    for item in payload.get("suggestions", []):
        if isinstance(item, dict):
            mapped[str(item.get("field", ""))] = item.get("suggested_value")
    return mapped


def main() -> int:
    spec = json.loads(CASES.read_text())
    failures = 0
    for case in spec["cases"]:
        model = case["model"]
        role = case["role"]
        try:
            payload = call_model(model, role, case["row"])
            got = suggestions_map(payload)
        except Exception as exc:
            failures += 1
            print(f"FAIL {model} {case['row']['id']}: {exc}")
            continue

        missing = []
        for field, expected_value in case["expected"]:
            if got.get(field) != expected_value:
                missing.append((field, expected_value, got.get(field)))

        if missing:
            failures += 1
            print(f"FAIL {model} {case['row']['id']}: {missing}")
            print(json.dumps(payload, indent=2))
        else:
            print(f"PASS {model} {case['row']['id']}")

    if failures:
        print(f"\n{failures} engineering model smoke case(s) failed.")
        return 1
    print("\nAll engineering model smoke cases passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
