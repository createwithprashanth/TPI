"""
Optional project tag-convention context for InstruMap.

This module is deliberately small and side-effect free. It lets a client or
engineer provide project-specific legend notes without changing the base
xyra-pid-engineer model or the extraction pipeline.
"""

from __future__ import annotations

import re

MAX_LEGEND_CHARS = 4_000


def normalize_legend_notes(notes: str | None) -> str:
    """Return compact legend notes safe to inject into an LLM prompt."""
    if not notes:
        return ""

    text = str(notes).replace("\r\n", "\n").replace("\r", "\n")
    lines = []
    for raw in text.splitlines():
        line = re.sub(r"\s+", " ", raw).strip()
        if line:
            lines.append(line)

    return "\n".join(lines)[:MAX_LEGEND_CHARS]


def build_legend_prompt_block(notes: str | None) -> str:
    """Format optional notes as a project-specific classification hint."""
    normalized = normalize_legend_notes(notes)
    if not normalized:
        return ""

    return (
        "PROJECT / CLIENT TAG CONVENTIONS\n"
        "Use these notes only when they clarify ambiguous project-specific codes. "
        "Do not override clear ISA-5.1 rules or non-instrument/noise rules.\n"
        f"{normalized}\n\n"
    )
