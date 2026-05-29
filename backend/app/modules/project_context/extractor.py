"""
Project context extraction and normalization.

This module is intentionally shared-tool friendly: it reads uploaded documents
and returns a structured project profile that can be reused by InstruMap, MTO,
PrecisionPDF, and future database records.
"""
from __future__ import annotations

import json
import logging
import os
import re
from copy import deepcopy
from datetime import date
from pathlib import Path
from typing import Any, Dict, Iterable, Optional

logger = logging.getLogger(__name__)

PROJECT_CONTEXT_MODEL = os.getenv("XYRA_PROJECT_CONTEXT_MODEL", "xyra-project-context")
PROJECT_CONTEXT_MODEL_FALLBACK = os.getenv("XYRA_PROJECT_CONTEXT_MODEL_FALLBACK", "qwen2.5:7b")
USE_LLM_CONTEXT = os.getenv("XYRA_PROJECT_CONTEXT_USE_LLM", "0").strip().lower() in {"1", "true", "yes"}

_CONTEXT_KEYS = [
    "project_name",
    "project_no",
    "client_name",
    "contractor_name",
    "location",
    "country",
    "facility",
    "unit_area",
    "discipline",
    "document_type",
    "document_title",
    "document_no",
    "revision",
    "engineering_phase",
    "scope",
]

_LABEL_PATTERNS = {
    "project_name": [
        r"\bproject\s*(?:name|title)?\s*[:\-]\s*(.+)",
        r"\bproject\s*[:\-]\s*(.+)",
    ],
    "project_no": [
        r"\bproject\s*(?:no|number|#)\s*[:\-]\s*([A-Z0-9][A-Z0-9\-_/\.]+)",
        r"\bjob\s*(?:no|number|#)\s*[:\-]\s*([A-Z0-9][A-Z0-9\-_/\.]+)",
    ],
    "client_name": [
        r"\bclient\s*(?:name)?\s*[:\-]\s*(.+)",
        r"\bowner\s*(?:name)?\s*[:\-]\s*(.+)",
    ],
    "contractor_name": [
        r"\bcontractor\s*(?:name)?\s*[:\-]\s*(.+)",
        r"\bepc\s*(?:contractor)?\s*[:\-]\s*(.+)",
    ],
    "location": [
        r"\blocation\s*[:\-]\s*(.+)",
        r"\bsite\s*[:\-]\s*(.+)",
    ],
    "unit_area": [
        r"\bunit\s*(?:area)?\s*[:\-]\s*(.+)",
        r"\barea\s*[:\-]\s*(.+)",
    ],
    "document_title": [
        r"\bdrawing\s*title\s*[:\-]\s*(.+)",
        r"\btitle\s*[:\-]\s*(.+)",
        r"\bdocument\s*title\s*[:\-]\s*(.+)",
    ],
    "document_no": [
        r"\bdrawing\s*(?:no|number|#)\s*[:\-]\s*([A-Z0-9][A-Z0-9\-_/\.]+)",
        r"\bdocument\s*(?:no|number|#)\s*[:\-]\s*([A-Z0-9][A-Z0-9\-_/\.]+)",
        r"\bdwg\s*(?:no|number|#)?\s*[:\-]\s*([A-Z0-9][A-Z0-9\-_/\.]+)",
    ],
    "revision": [
        r"\brev(?:ision)?\.?\s*[:\-]\s*([A-Z0-9]{1,4})\b",
    ],
}

_DISCIPLINE_HINTS = [
    ("Instrumentation", ("p&id", "piping and instrumentation", "process and instrumentation")),
    ("Piping", ("piping", "isometric", "pipe support")),
    ("Instrumentation", ("instrument", "io list", "instrument index")),
    ("Electrical", ("electrical", "single line", "sld")),
    ("Mechanical", ("mechanical", "equipment layout")),
]

_DOC_TYPE_HINTS = [
    ("P&ID", ("p&id", "piping and instrumentation", "process and instrumentation")),
    ("Instrument Index", ("instrument index",)),
    ("IO List", ("io list", "i/o list")),
    ("MTO", ("material take off", "mto")),
    ("Datasheet", ("datasheet", "data sheet")),
    ("General Arrangement", ("general arrangement", "ga drawing")),
]

_PHASE_HINTS = [
    ("As-Built", ("as-built", "as built")),
    ("IFC", ("issued for construction", "ifc")),
    ("IFR", ("issued for review", "ifr")),
    ("FEED", ("feed", "front end engineering")),
    ("Detailed Engineering", ("detailed engineering", "detail engineering")),
]

_STANDARD_HINTS = [
    "ISA-5.1", "ISA 5.1", "IEC 61511", "IEC 61508", "IEC 61131",
    "ASME B31.3", "API 14C", "API 520", "API 521",
]


def blank_project_context() -> Dict[str, Any]:
    ctx = {key: "" for key in _CONTEXT_KEYS}
    ctx.update({
        "standards": [],
        "source_files": [],
        "confidence": "Low",
        "basis": {},
        "generated_on": date.today().isoformat(),
    })
    return ctx


def _clean(value: Any) -> str:
    text = str(value or "").replace("\x00", " ").strip()
    text = re.sub(r"\s+", " ", text)
    text = text.strip(" \t\r\n:-|")
    if text.lower() in {"nan", "none", "null"}:
        return ""
    return text[:180]


def _set(ctx: Dict[str, Any], key: str, value: Any, basis: str, overwrite: bool = False) -> None:
    value = _clean(value)
    if not value:
        return
    if overwrite or not _clean(ctx.get(key)):
        ctx[key] = value
        ctx.setdefault("basis", {})[key] = basis


def _extract_pdf_text(pdf_content: bytes, max_pages: int = 3) -> str:
    try:
        import fitz

        doc = fitz.open(stream=pdf_content, filetype="pdf")
        chunks: list[str] = []
        for page_index in range(min(len(doc), max_pages)):
            page = doc[page_index]
            chunks.append(page.get_text("text") or "")

            # Title blocks are often vector text at the bottom/right. Blocks keep
            # local adjacency better than full-page text for label extraction.
            page_rect = page.rect
            for block in page.get_text("blocks") or []:
                if len(block) < 5:
                    continue
                x0, y0, x1, y1, text = block[:5]
                if x0 > page_rect.width * 0.45 or y0 > page_rect.height * 0.58:
                    chunks.append(str(text))
        doc.close()
        return "\n".join(chunks)
    except Exception as exc:
        logger.warning("Project context PDF text extraction failed: %s", exc)
        return ""


def _candidate_lines(text: str) -> list[str]:
    lines = []
    for raw in text.splitlines():
        cleaned = _clean(raw)
        if 2 <= len(cleaned) <= 180:
            lines.append(cleaned)
    return lines


def _extract_labeled_fields(ctx: Dict[str, Any], text: str) -> None:
    lines = _candidate_lines(text)
    joined = "\n".join(lines)
    for key, patterns in _LABEL_PATTERNS.items():
        for pattern in patterns:
            match = re.search(pattern, joined, flags=re.IGNORECASE)
            if match:
                _set(ctx, key, match.group(1), f"PDF label: {key}")
                break


def _infer_from_hints(ctx: Dict[str, Any], text: str, filename: str) -> None:
    haystack = f"{filename}\n{text}".lower()
    for value, hints in _DISCIPLINE_HINTS:
        if any(h in haystack for h in hints):
            _set(ctx, "discipline", value, "document text/filename hint")
            break
    for value, hints in _DOC_TYPE_HINTS:
        if any(h in haystack for h in hints):
            _set(ctx, "document_type", value, "document text/filename hint")
            break
    for value, hints in _PHASE_HINTS:
        if any(h in haystack for h in hints):
            _set(ctx, "engineering_phase", value, "document text/filename hint")
            break

    standards = []
    upper_text = f"{filename}\n{text}".upper()
    for standard in _STANDARD_HINTS:
        if standard.upper() in upper_text:
            standards.append(standard.replace("ISA 5.1", "ISA-5.1"))
    if standards:
        ctx["standards"] = sorted(set(standards))
        ctx.setdefault("basis", {})["standards"] = "standards mentioned in document text"


def _infer_document_no(ctx: Dict[str, Any], filename: str) -> None:
    stem = Path(filename or "").stem
    if not stem:
        return
    # Prefer proper engineering document numbers over casual names such as pid (2).
    candidates = re.findall(r"\b[A-Z]{1,5}[-_][A-Z0-9][A-Z0-9\-_/\.]{4,}\b", stem.upper())
    if candidates:
        _set(ctx, "document_no", candidates[0], "filename")


def _infer_scope(ctx: Dict[str, Any]) -> None:
    doc_type = _clean(ctx.get("document_type"))
    discipline = _clean(ctx.get("discipline"))
    unit = _clean(ctx.get("unit_area"))
    facility = _clean(ctx.get("facility"))

    if doc_type == "P&ID":
        subject = unit or facility or "uploaded P&ID drawings"
        _set(ctx, "scope", f"Extraction and review of instruments, lines, equipment, and IO points from {subject}.", "document type")
    elif discipline:
        _set(ctx, "scope", f"{discipline} document extraction and review for uploaded drawings.", "discipline")


def _run_llm_normalization(
    ctx: Dict[str, Any],
    text: str,
    filename: str,
    enabled: Optional[bool] = None,
) -> Dict[str, Any]:
    if enabled is None:
        enabled = USE_LLM_CONTEXT
    if not enabled or not text.strip():
        return ctx
    try:
        from app.modules.llm.service import generate

        prompt = json.dumps({
            "task": "Normalize engineering project context from drawing text. Do not invent missing values.",
            "filename": filename,
            "current_context": {k: ctx.get(k, "") for k in _CONTEXT_KEYS},
            "text_excerpt": text[:6000],
            "output_schema": {
                **{key: "string or blank" for key in _CONTEXT_KEYS},
                "standards": ["standard names"],
            },
        })
        system = (
            "You are xyra-project-context. Extract project/document metadata from EPC drawings. "
            "Return strict JSON only. Preserve blanks for unknown values. Never guess."
        )
        result = generate(prompt, model=PROJECT_CONTEXT_MODEL, system=system, timeout=12)
        if not result:
            result = generate(prompt, model=PROJECT_CONTEXT_MODEL_FALLBACK, system=system, timeout=12)
        if isinstance(result, dict):
            for key in _CONTEXT_KEYS:
                _set(ctx, key, result.get(key), f"{PROJECT_CONTEXT_MODEL} normalization")
            if isinstance(result.get("standards"), list):
                standards = [_clean(s) for s in result["standards"] if _clean(s)]
                if standards:
                    ctx["standards"] = sorted(set((ctx.get("standards") or []) + standards))
                    ctx.setdefault("basis", {})["standards"] = f"{PROJECT_CONTEXT_MODEL} normalization"
    except Exception as exc:
        logger.warning("Project context LLM normalization skipped: %s", exc)
    return ctx


def extract_project_context_from_pdf(
    pdf_content: bytes,
    pdf_filename: str,
    *,
    use_llm: Optional[bool] = None,
) -> Dict[str, Any]:
    ctx = blank_project_context()
    filename = pdf_filename or "drawing.pdf"
    ctx["source_files"] = [filename]
    text = _extract_pdf_text(pdf_content)
    _extract_labeled_fields(ctx, text)
    _infer_from_hints(ctx, text, filename)
    _infer_document_no(ctx, filename)
    _infer_scope(ctx)

    ctx = _run_llm_normalization(ctx, text, filename, enabled=use_llm)

    _infer_scope(ctx)
    ctx["confidence"] = _confidence(ctx)
    return ctx


def _confidence(ctx: Dict[str, Any]) -> str:
    important = ["project_name", "project_no", "client_name", "document_no", "document_title", "document_type"]
    count = sum(1 for key in important if _clean(ctx.get(key)))
    if count >= 4:
        return "High"
    if count >= 2:
        return "Medium"
    return "Low"


def _merge_standards(existing: Iterable[Any], incoming: Iterable[Any]) -> list[str]:
    values = [_clean(v) for v in list(existing or []) + list(incoming or [])]
    return sorted({v for v in values if v})


def merge_project_context(
    existing: Optional[Dict[str, Any]] = None,
    incoming: Optional[Dict[str, Any]] = None,
    user_overrides: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    merged = blank_project_context()
    for source in (existing or {}, incoming or {}):
        for key in _CONTEXT_KEYS:
            _set(merged, key, source.get(key), source.get("basis", {}).get(key, "merged context"))
        merged["standards"] = _merge_standards(merged.get("standards"), source.get("standards"))
        merged["source_files"] = sorted(set((merged.get("source_files") or []) + (source.get("source_files") or [])))
        merged.setdefault("basis", {}).update(source.get("basis", {}))

    for key, value in (user_overrides or {}).items():
        if key in _CONTEXT_KEYS:
            _set(merged, key, value, "user supplied", overwrite=True)

    _infer_scope(merged)
    merged["confidence"] = _confidence(merged)
    merged["generated_on"] = date.today().isoformat()
    return merged


def load_project_context(path: str | os.PathLike[str]) -> Dict[str, Any]:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            return merge_project_context(data)
    except FileNotFoundError:
        pass
    except Exception as exc:
        logger.warning("Could not load project context %s: %s", path, exc)
    return blank_project_context()


def save_project_context(path: str | os.PathLike[str], context: Dict[str, Any]) -> None:
    serializable = deepcopy(context)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(serializable, handle, indent=2, sort_keys=True)


def legacy_project_info(context: Dict[str, Any]) -> Dict[str, Any]:
    """Return keys used by existing UI/forms and cover-sheet code."""
    return {
        "project_name": _clean(context.get("project_name")),
        "project_no": _clean(context.get("project_no")),
        "client_name": _clean(context.get("client_name")),
        "contractor_name": _clean(context.get("contractor_name")),
        "location": _clean(context.get("location")),
        "country": _clean(context.get("country")),
        "facility": _clean(context.get("facility")),
        "unit_area": _clean(context.get("unit_area")),
        "discipline": _clean(context.get("discipline")),
        "document_type": _clean(context.get("document_type")),
        "document_title": _clean(context.get("document_title")),
        "document_no": _clean(context.get("document_no")),
        "revision": _clean(context.get("revision")),
        "engineering_phase": _clean(context.get("engineering_phase")),
        "scope": _clean(context.get("scope")),
        "standards": context.get("standards") or [],
        "source_files": context.get("source_files") or [],
        "confidence": _clean(context.get("confidence")),
    }
