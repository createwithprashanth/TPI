"""Lightweight page classification for instrument extraction.

The project-context extractor may read cover sheets and CRS/comment pages, but
instrument extraction should only process actual drawing pages. This module is
intentionally deterministic and conservative: it skips a page only when admin
page evidence is strong and CAD/P&ID drawing density is low.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


_ADMIN_PATTERNS = (
    r"\bprepared\s+by\b",
    r"\bchecked\s+by\b",
    r"\bapproved\s+by\b",
    r"\brevision\s+no\b",
    r"\brevise\s+and\s+re-?submit\b",
    r"\bapproved\s+with\s+comments\b",
    r"\bfor\s+information\s+only\b",
    r"\bclause\s+no\b",
    r"\bpage\s+no\b",
    r"\bcomment\s+response\b",
    r"\bcrs\b",
)

_PID_HINT_PATTERNS = (
    r"\bP\s*&\s*ID\b",
    r"\bPIPING\s+AND\s+INSTRUMENT",
    r"\bESD\b",
    r"\bSMART\s+POSITIONER\b",
    r"\b[A-Z]{1,4}\s*\d{3,5}[A-Z]?\b",
)


@dataclass(frozen=True)
class PageClassification:
    kind: str
    should_extract: bool
    reason: str
    admin_score: int
    pid_score: int
    word_count: int
    drawing_count: int


def classify_page_for_instruments(text: str, *, word_count: int, drawing_count: int) -> PageClassification:
    normalized = re.sub(r"\s+", " ", text or "").strip()
    admin_score = sum(1 for pattern in _ADMIN_PATTERNS if re.search(pattern, normalized, re.IGNORECASE))
    pid_score = sum(1 for pattern in _PID_HINT_PATTERNS if re.search(pattern, normalized, re.IGNORECASE))

    # Dense CAD vector pages are almost always real drawing sheets even if the
    # title block contains admin words such as revision/date/approved.
    if drawing_count >= 300 or word_count >= 500 or pid_score >= 2:
        return PageClassification(
            kind="drawing",
            should_extract=True,
            reason="drawing density / P&ID content detected",
            admin_score=admin_score,
            pid_score=pid_score,
            word_count=word_count,
            drawing_count=drawing_count,
        )

    if admin_score >= 3:
        return PageClassification(
            kind="admin",
            should_extract=False,
            reason="cover/CRS/revision page detected",
            admin_score=admin_score,
            pid_score=pid_score,
            word_count=word_count,
            drawing_count=drawing_count,
        )

    return PageClassification(
        kind="unknown",
        should_extract=True,
        reason="insufficient evidence to skip",
        admin_score=admin_score,
        pid_score=pid_score,
        word_count=word_count,
        drawing_count=drawing_count,
    )
