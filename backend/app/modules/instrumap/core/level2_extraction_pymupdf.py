"""
PyMuPDF-based instrument extractor for vector/digital P&IDs.

Works by reading text and circle geometry directly from the PDF — no image
conversion, no Vision API calls, near-instant results.

Falls back gracefully:
  - Returns (empty DataFrame, empty DataFrame) if the PDF has no embedded text
    (i.e. it is a scanned drawing). The caller then runs the OCR pipeline as normal.

Only called when USE_PYMUPDF = True in config.py.
Existing level2_extraction.py and level2_extraction_fast.py are untouched.
"""
import math
import logging
import pandas as pd
from typing import Optional

logger = logging.getLogger(__name__)

try:
    import fitz  # PyMuPDF
    _PYMUPDF_AVAILABLE = True
except ImportError:
    _PYMUPDF_AVAILABLE = False
    logger.warning("PyMuPDF not installed — pymupdf extraction unavailable")

from .standard_library import InstrumentLogicEngine
from .line_extractor import _try_parse as _try_parse_line

# Minimum ratio of pages with embedded text to treat PDF as vector
_VECTOR_TEXT_RATIO = 0.5
# Minimum characters on a page to consider it has embedded text
_MIN_CHARS_PER_PAGE = 50


def _is_vector_pdf(doc) -> bool:
    """Return True if the majority of pages contain embedded text."""
    if not doc:
        return False
    pages_with_text = sum(
        1 for page in doc
        if len(page.get_text("text").strip()) >= _MIN_CHARS_PER_PAGE
    )
    return (pages_with_text / max(len(doc), 1)) >= _VECTOR_TEXT_RATIO


def _extract_circles(page, min_radius_pt: float, max_radius_pt: float):
    """
    Extract circle centres and radii from PDF vector paths.
    Returns list of (cx, cy, r) in PDF points.
    """
    circles = []
    for path in page.get_drawings():
        rect = path.get("rect")
        if rect is None:
            continue
        w = rect.width
        h = rect.height
        # A circle has equal width and height
        if abs(w - h) > (w * 0.15):
            continue
        r = (w + h) / 4  # average of half-width and half-height
        if not (min_radius_pt <= r <= max_radius_pt):
            continue
        cx = rect.x0 + w / 2
        cy = rect.y0 + h / 2
        circles.append((cx, cy, r))
    return circles


def _words_near_circle(words, cx, cy, r, margin=1.2):
    """Return word dicts whose centres fall within the circle."""
    r2 = (r * margin) ** 2
    result = [
        w for w in words
        if (w['cx'] - cx) ** 2 + (w['cy'] - cy) ** 2 <= r2
    ]
    return sorted(result, key=lambda w: (w['y0'], w['x0']))


def _tag_from_words(words, separator="-", max_rows=3, line_tol_pt=4):
    """Group words into lines and build a tag string."""
    if not words:
        return None

    lines = []
    line_y = None
    line_buf = []

    for w in words:
        if line_y is None or abs(w['y0'] - line_y) > line_tol_pt:
            if line_buf:
                text = "".join(x['text'] for x in sorted(line_buf, key=lambda x: x['x0'])).strip()
                if text:
                    lines.append(text)
            line_buf = [w]
            line_y = w['y0']
        else:
            line_buf.append(w)

    if line_buf:
        text = "".join(x['text'] for x in sorted(line_buf, key=lambda x: x['x0'])).strip()
        if text:
            lines.append(text)

    if not lines or len(lines) > max_rows:
        return None

    return separator.join(lines)


def _pt_to_px(val, dpi=300):
    """Convert PDF points (1/72 inch) to pixels at the given DPI."""
    return val * dpi / 72.0


def extract_from_pdf(
    pdf_path: str,
    filename_base: str,
    calibration_radius_px: Optional[int] = None,
    default_area_code: Optional[str] = None,
    dpi: int = 300,
    radius_tolerance: float = 0.25,
) -> tuple:
    """
    Extract instruments and line numbers directly from a vector PDF.

    Args:
        pdf_path             : path to the PDF file
        filename_base        : e.g. "drawing" (used for P&ID_Filename column)
        calibration_radius_px: circle radius in pixels (from user calibration at `dpi`).
                               If None, uses a wide default range covering typical P&ID
                               instrument circles (~15–83 px at 300 DPI).
        default_area_code    : fallback area code if tag has none
        dpi                  : DPI used for pixel↔point conversion (must match processor DPI)
        radius_tolerance     : fraction around calibrated radius to accept (default 25%)

    Returns:
        (instruments_df, lines_df) — both empty DataFrames if PDF is scanned/not vector
    """
    if not _PYMUPDF_AVAILABLE:
        return pd.DataFrame(), pd.DataFrame(), {"circles_found": 0, "tags_extracted": 0, "fallback_reason": "not_installed"}

    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:
        logger.warning(f"PyMuPDF: could not open {pdf_path}: {exc}")
        return pd.DataFrame(), pd.DataFrame(), {"circles_found": 0, "tags_extracted": 0, "fallback_reason": "exception"}

    if not _is_vector_pdf(doc):
        logger.info("PyMuPDF: scanned PDF detected — skipping, OCR pipeline will handle it")
        doc.close()
        return pd.DataFrame(), pd.DataFrame(), {"circles_found": 0, "tags_extracted": 0, "fallback_reason": "not_vector"}

    logger.info(f"PyMuPDF: vector PDF confirmed — extracting directly from {filename_base}")

    # Radius range in PDF points (1 pt = 1/72 inch)
    if calibration_radius_px is not None:
        calib_r_pt = calibration_radius_px * 72.0 / dpi
        min_r_pt = calib_r_pt * (1 - radius_tolerance)
        max_r_pt = calib_r_pt * (1 + radius_tolerance)
    else:
        # Wide default — covers instrument circles from ~15 px to ~83 px at 300 DPI.
        # Tight enough to exclude page borders and tiny text boxes.
        min_r_pt = 3.5   # ≈ 14.6 px at 300 DPI
        max_r_pt = 20.0  # ≈ 83.3 px at 300 DPI

    all_instruments = []
    all_lines = []
    instrument_counter = 1
    total_circles_found = 0

    for page_idx, page in enumerate(doc):
        page_number = page_idx + 1
        pid_filename = filename_base + ".pdf"
        page_filename_base = f"{filename_base}_p{page_number}"

        # All words on this page with positions
        words_raw = page.get_text("words")  # (x0,y0,x1,y1,text,block,line,word)
        words = [
            {
                'text': w[4],
                'x0': w[0], 'y0': w[1], 'x1': w[2], 'y1': w[3],
                'cx': (w[0] + w[2]) / 2,
                'cy': (w[1] + w[3]) / 2,
            }
            for w in words_raw
            if w[4].strip()
        ]

        # ── Instrument extraction ─────────────────────────────────────────────
        circles = _extract_circles(page, min_r_pt, max_r_pt)
        total_circles_found += len(circles)
        seen_tags = set()

        for cx_pt, cy_pt, r_pt in circles:
            nearby = _words_near_circle(words, cx_pt, cy_pt, r_pt)
            tag = _tag_from_words(nearby)
            if not tag or not tag.strip():
                continue
            if not any(c.isalpha() for c in tag):
                continue  # reject pure-numeric/symbolic text (e.g. hazmat placard "526-6.9")

            epc = InstrumentLogicEngine.get_epc_specs(tag, default_area_code)

            # Typo cleaner
            if epc['Loop_Number']:
                clean = (
                    epc['Loop_Number']
                    .replace('l', '1').replace('I', '1')
                    .replace('O', '0').replace('S', '5')
                )
                if clean != epc['Loop_Number']:
                    epc['Loop_Number'] = clean
                    prefix = f"{epc['Area_Code']}-" if epc['Area_Code'] else ""
                    tag = f"{prefix}{epc['Instrument_Type']}-{clean}{epc['Tag_Suffix'] or ''}"

            tag_key = tag.upper().strip()
            if tag_key in seen_tags:
                continue
            seen_tags.add(tag_key)

            # Convert centre to pixels for coordinate consistency with OCR pipeline
            cx_px = int(_pt_to_px(cx_pt, dpi))
            cy_px = int(_pt_to_px(cy_pt, dpi))
            r_px = int(_pt_to_px(r_pt, dpi))

            ref_id = str(instrument_counter)
            instrument_counter += 1
            all_instruments.append({
                'Ref_ID': ref_id,
                'Verification_Source': f"{page_filename_base} -> PyMuPDF #{ref_id}",
                'Review_Required': (epc['Confidence'] == 'Low'),
                'P&ID_Filename': pid_filename,
                'Tag_Number': tag,
                'Area': epc['Area_Code'], 'Type': epc['Instrument_Type'],
                'Loop': epc['Loop_Number'], 'Suffix': epc['Tag_Suffix'],
                'Instrument_Description': epc['Instrument_Description'],
                'Service': epc['Service'], 'System': epc['System'],
                'IO_Type': epc['IO_Type'], 'Signal_Type': epc['Signal_Type'],
                'Power_Supply': epc['Power_Supply'], 'Mounting': epc['Mounting'],
                'Location_Drawing': 'Field',
                'Coordinates': f"{cx_px},{cy_px}",
                'Radius': r_px,
                'P&ID_Page': page_number,
            })

        # ── Line number extraction ────────────────────────────────────────────
        seen_lines = set()
        for w in words:
            parsed = _try_parse_line(w['text'])
            if parsed:
                ln = parsed['Line_Number']
                if ln not in seen_lines:
                    seen_lines.add(ln)
                    cx_px = int(_pt_to_px(w['cx'], dpi))
                    cy_px = int(_pt_to_px(w['cy'], dpi))
                    all_lines.append({
                        **parsed,
                        'P&ID_Filename': pid_filename,
                        'P&ID_Page': page_number,
                        'Coordinates': f"{cx_px},{cy_px}",
                    })

        logger.info(
            f"PyMuPDF page {page_number}: {len(seen_tags)} instruments, "
            f"{len(seen_lines)} line numbers"
        )

    doc.close()

    instruments_df = pd.DataFrame(all_instruments) if all_instruments else pd.DataFrame()
    lines_df = pd.DataFrame(all_lines) if all_lines else pd.DataFrame()
    stats = {
        "circles_found":  total_circles_found,
        "tags_extracted": len(instruments_df),
    }
    return instruments_df, lines_df, stats
