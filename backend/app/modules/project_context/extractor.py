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
_LLM_MODE_FALSE = {"0", "false", "no", "off", "never", "disabled"}
_LLM_MODE_TRUE = {"1", "true", "yes", "on", "always", "enabled"}
_LLM_MODE_AUTO = {"", "auto", "smart", "default"}

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
        r"\brevision\s*(?:no|number|#)\s*[:\-]\s*([A-Z0-9]{1,4})\b",
        r"\brev(?:ision)?\.?\s*[:\-]\s*([A-Z0-9]{1,4})\b",
        r"\brev\.?\s*([A-Z0-9]{1,4})\s+submission\b",
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
    if key == "unit_area":
        match = re.match(r"^(\d{1,4})\)?$", value)
        if match:
            value = match.group(1)
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


def _extract_epc_title_block_fields(ctx: Dict[str, Any], text: str) -> None:
    """Extract common unlabeled EPC/title-block patterns.

    Many legacy P&IDs expose useful context as table text without nearby labels,
    especially CRS cover pages and bottom-right title blocks. Keep this
    conservative: only set values from distinctive project/title-block phrases.
    """
    lines = _candidate_lines(text)
    upper_lines = [line.upper() for line in lines]

    for index, line in enumerate(lines):
        upper = upper_lines[index]

        project_match = re.search(r"(.+?)\s+PROJECT\s+NO\.?\s*([A-Z0-9][A-Z0-9\- ]{2,})\b", line, flags=re.IGNORECASE)
        if project_match:
            _set(ctx, "project_name", project_match.group(1), "EPC title block project line")
            _set(ctx, "project_no", project_match.group(2).replace(" ", ""), "EPC title block project line")
            if index > 0 and not _clean(ctx.get("client_name")):
                previous = lines[index - 1]
                if re.search(r"\b(?:ADNOC|GAS|OIL|COMPANY|INDUSTRIES|LTD|LIMITED)\b", previous, flags=re.IGNORECASE):
                    _set(ctx, "client_name", previous, "EPC title block client line")
                    if "ADNOC" in previous.upper():
                        _set(ctx, "country", "United Arab Emirates", "EPC title block client line")

        if "PIPING" in upper and "INSTRUMENTATION" in upper and "DIAGRAM" in upper:
            title_parts = [line]
            for follow in lines[index + 1:index + 4]:
                follow_upper = follow.upper()
                if re.search(
                    r"\b(?:DOCUMENT|DRAWING|REV|SCALE|PROJECT|JOB|REFERENCE|NOTES?|LEGENDS?|COMPLEX|COMPANY|INDUSTRIES|LTD|LIMITED)\b",
                    follow_upper,
                ):
                    break
                if len(follow) >= 4:
                    title_parts.append(follow)
            _set(ctx, "document_title", " ".join(title_parts), "EPC title block drawing title")
            _set(ctx, "document_type", "P&ID", "EPC title block drawing title")
            _set(ctx, "discipline", "Instrumentation", "EPC title block drawing title")

        if "ABU" in upper and "DHABI" in upper and ("GAS" in upper or "OIL" in upper):
            _set(ctx, "client_name", line, "EPC title block client")
            _set(ctx, "country", "United Arab Emirates", "EPC title block client")

        if re.fullmatch(r"[A-Z ]*HABSHAN[A-Z ]*", upper):
            _set(ctx, "facility", line, "EPC title block facility")
            _set(ctx, "location", "Habshan", "EPC title block facility")
            _set(ctx, "country", "United Arab Emirates", "EPC title block facility")

    joined = "\n".join(lines)
    developed_match = re.search(
        r"THIS\s+DRAWING\s+IS\s+DEVELOPED\s+FROM\s+(.+?)\s+DRAWING\s+NO\.\s*([A-Z0-9\-_/\.]+)",
        joined,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if developed_match:
        _set(ctx, "client_name", developed_match.group(1), "developed-from title block note")


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
        return

    numeric_doc = re.match(r"^(\d{2,4}-\d{2,4}-\d{2,6})(?:-([A-Z0-9]{1,4}))?$", stem.upper())
    if numeric_doc:
        _set(ctx, "document_no", numeric_doc.group(1), "filename")
        if numeric_doc.group(2):
            _set(ctx, "revision", numeric_doc.group(2), "filename")
        if not _clean(ctx.get("unit_area")):
            _set(ctx, "unit_area", numeric_doc.group(1).split("-", 1)[0], "filename")
        return

    stem_upper = stem.upper()
    stem_tokens = stem_upper.split("-")
    if (
        len(stem_tokens) >= 6
        and re.search(r"[A-Z]", stem_tokens[0])
        and re.search(r"\d", stem_tokens[0])
        and all(re.fullmatch(r"[A-Z0-9]{1,8}", token) for token in stem_tokens)
    ):
        document_no = "-".join(stem_tokens[:-1])
        revision = stem_tokens[-1]
        _set(ctx, "document_no", document_no, "filename")
        _set(ctx, "revision", revision, "filename")
        if not _clean(ctx.get("unit_area")):
            for token in stem_tokens[:-1]:
                if re.fullmatch(r"\d{2,4}", token):
                    _set(ctx, "unit_area", token.lstrip("0") or token, "filename")
                    break


def _infer_scope(ctx: Dict[str, Any]) -> None:
    doc_type = _clean(ctx.get("document_type"))
    discipline = _clean(ctx.get("discipline"))
    unit = _clean(ctx.get("unit_area"))
    facility = _clean(ctx.get("facility"))

    if doc_type == "P&ID":
        if facility and unit:
            subject = f"{facility} / Unit {unit}"
        else:
            subject = f"Unit {unit}" if unit else (facility or "uploaded P&ID drawings")
        _set(ctx, "scope", f"Extraction and review of instruments, lines, equipment, and IO points from {subject}.", "document type")
    elif discipline:
        _set(ctx, "scope", f"{discipline} document extraction and review for uploaded drawings.", "discipline")


def _project_context_llm_mode() -> str:
    mode = os.getenv("XYRA_PROJECT_CONTEXT_USE_LLM", "auto").strip().lower()
    if mode in _LLM_MODE_TRUE:
        return "always"
    if mode in _LLM_MODE_FALSE:
        return "never"
    if mode in _LLM_MODE_AUTO:
        return "auto"
    logger.warning("Unknown XYRA_PROJECT_CONTEXT_USE_LLM=%r; using auto mode", mode)
    return "auto"


def _project_context_timeout_seconds() -> int:
    raw = os.getenv("XYRA_PROJECT_CONTEXT_TIMEOUT_SECONDS", "45").strip()
    try:
        return max(5, min(180, int(raw)))
    except ValueError:
        logger.warning("Invalid XYRA_PROJECT_CONTEXT_TIMEOUT_SECONDS=%r; using 45", raw)
        return 45


def _should_run_llm_context(ctx: Dict[str, Any], text: str, enabled: Optional[bool]) -> bool:
    if not text.strip():
        return False
    if enabled is not None:
        return enabled

    mode = _project_context_llm_mode()
    if mode == "never":
        return False
    if mode == "always":
        return True

    important = ["project_name", "project_no", "client_name", "document_no", "document_title", "document_type"]
    missing_important = [key for key in important if not _clean(ctx.get(key))]
    weak_context = _confidence(ctx) != "High"
    suspicious_title = _clean(ctx.get("document_title")).lower() in {
        "piping & instrumentation diagram",
        "piping and instrumentation diagram",
        "p&id",
    }
    return weak_context or bool(missing_important) or suspicious_title


def _run_llm_normalization(
    ctx: Dict[str, Any],
    text: str,
    filename: str,
    enabled: Optional[bool] = None,
) -> Dict[str, Any]:
    if not _should_run_llm_context(ctx, text, enabled):
        return ctx
    try:
        from app.modules.llm.service import generate

        prompt = json.dumps({
            "task": (
                "Normalize engineering project context from drawing text. "
                "Fill only blank, unknown, or obviously weak fields. Do not invent missing values."
            ),
            "filename": filename,
            "current_context": {k: ctx.get(k, "") for k in _CONTEXT_KEYS},
            "current_basis": ctx.get("basis", {}),
            "merge_rules": [
                "Do not replace user supplied, filename, PDF label, or EPC title block values unless the current value is blank.",
                "Use title-block/project text over casual filename guesses.",
                "Return empty string for fields not directly supported by the text.",
                "Keep document_title as the actual drawing title, not the uploaded filename.",
            ],
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
        timeout = _project_context_timeout_seconds()
        result = generate(prompt, model=PROJECT_CONTEXT_MODEL, system=system, timeout=timeout, num_predict=700)
        if not result:
            result = generate(
                prompt,
                model=PROJECT_CONTEXT_MODEL_FALLBACK,
                system=system,
                timeout=timeout,
                num_predict=700,
            )
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
    _extract_epc_title_block_fields(ctx, text)
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


def refresh_current_document_context(
    context: Dict[str, Any],
    detected: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Keep batch/project context, but refresh fields that belong to this file.

    InstruMap processes multi-PDF batches incrementally. Project-level fields
    such as client/project number should carry across the batch, while document
    number/revision/title must follow the current drawing so DB rows and covers
    do not inherit the first file's title block.
    """
    detected = detected or {}
    refreshed = deepcopy(context or blank_project_context())
    document_keys = [
        "document_no",
        "revision",
        "document_title",
        "document_type",
        "discipline",
        "engineering_phase",
        "unit_area",
    ]
    for key in document_keys:
        _set(
            refreshed,
            key,
            detected.get(key),
            detected.get("basis", {}).get(key, "current document context"),
            overwrite=True,
        )
    _infer_scope(refreshed)
    refreshed["confidence"] = _confidence(refreshed)
    refreshed["generated_on"] = date.today().isoformat()
    return refreshed


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
