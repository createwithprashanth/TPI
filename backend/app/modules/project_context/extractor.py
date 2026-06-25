"""
Project context extractor — reads title-block metadata from P&ID PDFs.

Provides load/save/merge helpers plus a PDF-based extraction path.
The extraction falls back gracefully when Ollama is unavailable.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_CONTEXT_KEYS = (
    "project_name",
    "project_no",
    "client_name",
    "contractor_name",
    "location",
    "project_legend_notes",
    "current_document_title",
    "current_document_no",
    "current_document_rev",
)


def _empty_context() -> Dict[str, str]:
    return {k: "" for k in _CONTEXT_KEYS}


def load_project_context(context_path: str) -> Dict[str, str]:
    """Load context from a JSON file; return empty context if file is absent or corrupt."""
    path = Path(context_path)
    if not path.exists():
        return _empty_context()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        ctx = _empty_context()
        ctx.update({k: str(data.get(k, "")) for k in _CONTEXT_KEYS})
        return ctx
    except Exception as exc:
        logger.warning("Could not load project context from %s: %s", context_path, exc)
        return _empty_context()


def save_project_context(context_path: str, context: Dict[str, str]) -> None:
    """Persist context dict to a JSON file."""
    path = Path(context_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.write_text(json.dumps(context, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as exc:
        logger.warning("Could not save project context to %s: %s", context_path, exc)


def extract_project_context_from_pdf(
    pdf_content: bytes,
    pdf_filename: str,
) -> Dict[str, str]:
    """
    Extract title-block metadata from a PDF.

    Attempts deterministic extraction via PyMuPDF first; falls back to an
    empty context when extraction fails or Ollama is unavailable.
    """
    ctx = _empty_context()
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(stream=pdf_content, filetype="pdf")
        if doc.page_count > 0:
            page = doc[0]
            text = page.get_text("text")
            # Naive heuristic: look for common title-block labels
            for line in text.splitlines():
                lower = line.lower().strip()
                if not ctx["current_document_title"] and len(line.strip()) > 3:
                    ctx["current_document_title"] = line.strip()
                if "rev" in lower and not ctx["current_document_rev"]:
                    parts = line.split()
                    if len(parts) >= 2:
                        ctx["current_document_rev"] = parts[-1]
        ctx["current_document_no"] = Path(pdf_filename).stem
    except Exception as exc:
        logger.debug("PDF project context extraction skipped: %s", exc)
    return ctx


def merge_project_context(
    existing: Dict[str, str],
    detected: Dict[str, str],
    user: Dict[str, str],
) -> Dict[str, str]:
    """
    Merge three context layers. Priority: user > detected > existing.
    Empty strings do not override non-empty values.
    """
    merged = _empty_context()
    for ctx in (existing, detected, user):
        for key in _CONTEXT_KEYS:
            val = str(ctx.get(key, "")).strip()
            if val:
                merged[key] = val
    return merged


def refresh_current_document_context(
    project_context: Dict[str, str],
    detected: Dict[str, str],
) -> Dict[str, str]:
    """Overwrite per-document fields with what was detected for the current file."""
    ctx = dict(project_context)
    for key in ("current_document_title", "current_document_no", "current_document_rev"):
        val = str(detected.get(key, "")).strip()
        if val:
            ctx[key] = val
    return ctx


def legacy_project_info(context: Dict[str, str]) -> Dict[str, str]:
    """Return a flat dict compatible with the legacy project_info contract."""
    return {
        "project_name": context.get("project_name", ""),
        "project_no": context.get("project_no", ""),
        "client_name": context.get("client_name", ""),
        "contractor_name": context.get("contractor_name", ""),
        "location": context.get("location", ""),
        "project_legend_notes": context.get("project_legend_notes", ""),
        "document_title": context.get("current_document_title", ""),
        "document_no": context.get("current_document_no", ""),
        "document_rev": context.get("current_document_rev", ""),
    }
