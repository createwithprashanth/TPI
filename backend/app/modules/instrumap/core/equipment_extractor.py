"""
Equipment tag extractor for vector/digital P&IDs.

This is intentionally additive: it produces an equipment context table for
service wording, but does not alter instrument extraction.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

import pandas as pd

logger = logging.getLogger(__name__)

try:
    import fitz  # PyMuPDF
    _PYMUPDF_AVAILABLE = True
except ImportError:
    _PYMUPDF_AVAILABLE = False


_EQUIPMENT_RE = re.compile(
    r"^(?P<prefix>"
    r"P|PU|C|K|V|E|F|FL|TK|T|D|R|M|A|B|H"
    r")[-_](?P<number>\d{2,6})(?P<suffix>[A-Z0-9-]*)$",
    re.IGNORECASE,
)

_TYPE_NAMES = {
    "A": "Agitator",
    "B": "Burner",
    "C": "Compressor",
    "D": "Drum",
    "E": "Heat Exchanger",
    "F": "Filter",
    "FL": "Filter",
    "H": "Heater",
    "K": "Compressor",
    "M": "Motor",
    "P": "Pump",
    "PU": "Pump",
    "R": "Reactor",
    "T": "Tank",
    "TK": "Tank",
    "V": "Vessel",
}


def _pt_to_px(val: float, dpi: int = 300) -> float:
    return val * dpi / 72.0


def _normalise_tag(text: str) -> str:
    return (
        text.strip()
        .upper()
        .replace("_", "-")
        .replace(" ", "")
    )


def _parse_equipment_tag(text: str) -> Optional[dict]:
    tag = _normalise_tag(text)
    match = _EQUIPMENT_RE.match(tag)
    if not match:
        return None

    prefix = match.group("prefix").upper()
    number = match.group("number")
    suffix = match.group("suffix") or ""

    # Avoid obvious instrument false positives such as P-573P-01 fragments.
    if re.search(r"[A-Z].*-", suffix):
        return None

    return {
        "Equipment_Tag": tag,
        "Equipment_Type": _TYPE_NAMES.get(prefix, prefix),
        "Equipment_Code": prefix,
        "Equipment_Number": number,
    }


def extract_equipment_from_pdf(
    pdf_path: str,
    filename_base: str,
    dpi: int = 300,
) -> pd.DataFrame:
    """Extract equipment-looking text tags and their coordinates from a vector PDF."""
    if not _PYMUPDF_AVAILABLE:
        return pd.DataFrame()

    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:
        logger.warning("EquipmentExtractor: could not open PDF: %s", exc)
        return pd.DataFrame()

    records = []
    seen = set()
    pid_filename = f"{filename_base}.pdf"

    for page_idx, page in enumerate(doc):
        page_number = page_idx + 1
        for word in page.get_text("words"):
            text = str(word[4] or "").strip()
            parsed = _parse_equipment_tag(text)
            if not parsed:
                continue

            key = (parsed["Equipment_Tag"], page_number)
            if key in seen:
                continue
            seen.add(key)

            cx = (word[0] + word[2]) / 2
            cy = (word[1] + word[3]) / 2
            records.append({
                **parsed,
                "P&ID_Filename": pid_filename,
                "P&ID_Page": page_number,
                "Coordinates": f"{int(_pt_to_px(cx, dpi))},{int(_pt_to_px(cy, dpi))}",
            })

    doc.close()

    df = pd.DataFrame(records)
    if not df.empty:
        df.sort_values(["P&ID_Page", "Equipment_Tag"], inplace=True)
    return df


def extract_equipment_from_ocr_words(
    full_text_data: list[dict],
    filename_base: str,
) -> pd.DataFrame:
    """
    Extract equipment tags from full-page OCR word data.

    Expects the same word schema used by line_extractor:
    text, center_x, center_y.
    """
    if not full_text_data:
        return pd.DataFrame()

    pid_filename = filename_base.rsplit("_p", 1)[0] + ".pdf"
    try:
        page_number = int(filename_base.rsplit("_p", 1)[1])
    except (IndexError, ValueError):
        page_number = 1

    records = []
    seen = set()

    for word in full_text_data:
        text = str(word.get("text", "") or "").strip()
        parsed = _parse_equipment_tag(text)
        if not parsed:
            continue

        key = (parsed["Equipment_Tag"], page_number)
        if key in seen:
            continue
        seen.add(key)

        records.append({
            **parsed,
            "P&ID_Filename": pid_filename,
            "P&ID_Page": page_number,
            "Coordinates": f"{int(word.get('center_x', 0))},{int(word.get('center_y', 0))}",
        })

    df = pd.DataFrame(records)
    if not df.empty:
        df.sort_values(["P&ID_Page", "Equipment_Tag"], inplace=True)
    return df
