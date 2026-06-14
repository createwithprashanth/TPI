#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import requests

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE_DIR = ROOT / "learning_review" / "pids_for_learning"
DEFAULT_OUTPUT_DIR = ROOT / "learning_review" / "knowledge_distilled"

KEYWORDS = (
    "instrument",
    "isa",
    "tag",
    "loop",
    "p&id",
    "pid",
    "symbol",
    "legend",
    "valve",
    "line",
    "service",
    "flow",
    "pressure",
    "temperature",
    "level",
    "control",
    "signal",
    "analyzer",
    "equipment",
    "noise",
    "drawing",
    "mto",
)


def _run_pdftotext(path: Path) -> str:
    proc = subprocess.run(
        ["pdftotext", "-layout", "-enc", "UTF-8", str(path), "-"],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    if proc.returncode != 0:
        return ""
    return proc.stdout


def _clean_text(value: str) -> str:
    value = value.replace("\x00", " ")
    value = re.sub(r"[ \t]+", " ", value)
    value = re.sub(r"\n{4,}", "\n\n", value)
    return value.strip()


def _interesting_lines(text: str, limit: int) -> str:
    cleaned = _clean_text(text)
    if not cleaned:
        return ""

    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    selected: list[str] = []
    seen: set[str] = set()

    for line in lines[:80]:
      key = line.lower()
      if key not in seen:
          selected.append(line)
          seen.add(key)

    for line in lines:
        lower = line.lower()
        if any(keyword in lower for keyword in KEYWORDS):
            key = lower[:240]
            if key not in seen:
                selected.append(line)
                seen.add(key)
        if sum(len(item) + 1 for item in selected) >= limit:
            break

    snippet = "\n".join(selected)
    return snippet[:limit]


def build_corpus(source_dir: Path, max_chars_per_pdf: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    pdfs = sorted(source_dir.glob("*.pdf"))
    documents: list[dict[str, Any]] = []
    manifest: list[dict[str, Any]] = []

    for pdf in pdfs:
        text = _run_pdftotext(pdf)
        snippet = _interesting_lines(text, max_chars_per_pdf)
        documents.append(
            {
                "file": pdf.name,
                "text_excerpt_for_distillation": snippet,
            }
        )
        manifest.append(
            {
                "file": pdf.name,
                "text_chars": len(text),
                "snippet_chars": len(snippet),
                "status": "text_extracted" if snippet else "no_text_or_extraction_failed",
            }
        )

    return documents, manifest


def build_prompt(documents: list[dict[str, Any]]) -> str:
    payload = {
        "role": "Senior EPC P&ID, instrumentation, and piping MTO teacher for XYRA Studio local models.",
        "task": "Create a compact, high-value Markdown teaching document for local LLM Modelfiles. Distill the attached PDF excerpts into rules, examples, review checks, and benchmark ideas. Make it specific enough that XYRA can use it to improve instrument extraction, noise rejection, service writing, line mapping, and piping MTO review. Do not quote long source text.",
        "strict_rules": [
            "Return Markdown only.",
            "Do not wrap the whole response in a markdown code fence.",
            "Do not include copyrighted long passages or page-sized reproductions.",
            "Use filename references only for traceability.",
            "Focus on rules XYRA can actually use for P&ID extraction, instrument index, IO list, line/service inference, and piping MTO.",
            "Separate deterministic rules from model prompt guidance.",
            "Include negative examples and review-required triggers.",
            "Do not invent client-specific tag meanings; mark such cases as project legend required.",
            "Prefer concrete examples over generic advice.",
            "Include exact wording suitable for Modelfile SYSTEM blocks.",
        ],
        "required_sections": [
            "Executive Teaching Summary",
            "Common P&ID Reading Rules For All XYRA Models",
            "Teach xyra-pid-engineer",
            "Teach xyra-instrumentation-engineer",
            "Teach xyra-line-mapper",
            "Teach xyra-piping-engineer And xyra-mto-reviewer",
            "Instrument Service Writing Rules",
            "Noise Rejection Rules",
            "Instrument Tag Acceptance And Rejection Patterns",
            "Nearest Text Rules For Valve Size And Line Context",
            "Project Legend Rules",
            "Benchmark Cases To Add",
            "Modelfile Insert Blocks",
            "Open Questions For Human EPC Review",
            "Source Traceability",
        ],
        "xyra_known_failure_modes_to_address": [
            "Noise/incomplete tags entering instrument index, such as BLEED-10, FROM-12330-FROM, WELL-102-OF, title block fragments, note text, drawing numbers, revision marks, and line numbers.",
            "Instrument service needs to be written from instrument type plus nearby line/equipment context, including upstream/downstream/inlet/outlet/process/fluid wording when supported.",
            "Piping MTO needs nearest inch-size text for valves/components, but must not steal size text from a different nearby component.",
            "Horizontal and vertical components can be real; orientation alone must not decide acceptance.",
            "Project legends may override generic ISA or P&ID symbol interpretation.",
        ],
        "documents": documents,
    }
    return json.dumps(payload, ensure_ascii=True)


def call_openai(prompt: str, model: str) -> str:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not set")

    response = requests.post(
        "https://api.openai.com/v1/responses",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "input": prompt,
            "temperature": 0.1,
            "max_output_tokens": 12000,
        },
        timeout=600,
    )
    response.raise_for_status()
    data = response.json()
    text = data.get("output_text", "")
    if text:
        return text
    parts: list[str] = []
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"}:
                parts.append(content.get("text", ""))
    return "".join(parts).strip()


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=True), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a GPT-4.1 distilled teaching document from PID learning PDFs.")
    parser.add_argument("--source-dir", type=Path, default=DEFAULT_SOURCE_DIR)
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--model", default="gpt-4.1")
    parser.add_argument("--max-chars-per-pdf", type=int, default=4500)
    parser.add_argument("--payload-only", action="store_true")
    args = parser.parse_args()

    run_id = f"pid_knowledge_{dt.datetime.now().strftime('%Y%m%d_%H%M%S')}"
    run_dir = args.output_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    documents, manifest = build_corpus(args.source_dir, args.max_chars_per_pdf)
    prompt = build_prompt(documents)

    write_json(run_dir / "source_manifest.json", manifest)
    write_json(run_dir / "teacher_prompt_payload.json", json.loads(prompt))

    if args.payload_only:
        print(f"Payload ready: {run_dir}")
        return 0

    teaching_doc = call_openai(prompt, args.model)
    if not teaching_doc:
        raise RuntimeError("Teacher model returned an empty response")

    output_file = run_dir / "xyra_pid_model_teaching_doc.md"
    output_file.write_text(teaching_doc, encoding="utf-8")
    latest_file = args.output_dir / "xyra_pid_model_teaching_doc.latest.md"
    latest_file.write_text(teaching_doc, encoding="utf-8")

    summary = {
        "run_id": run_id,
        "model": args.model,
        "source_dir": str(args.source_dir),
        "output_file": str(output_file),
        "latest_file": str(latest_file),
        "documents": len(documents),
        "extractable_documents": sum(1 for item in manifest if item["snippet_chars"] > 0),
    }
    write_json(run_dir / "run_summary.json", summary)
    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
