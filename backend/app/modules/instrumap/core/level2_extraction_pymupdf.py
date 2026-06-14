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
import logging
import re
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
from .line_extractor import extract_line_numbers as _extract_line_numbers
from .page_classifier import classify_page_for_instruments

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
    Returns list of (cx, cy, r, is_panel) in PDF points.

    is_panel=True means the circle sits inside a square (ISA "behind panel" notation).
    """
    # First pass: collect all square-ish rects that are likely panel indicator borders.
    # A panel indicator outer square has width ≈ height and is ~10-30% larger than
    # the inner circle it contains.
    panel_rects = []
    for path in page.get_drawings():
        rect = path.get("rect")
        if rect is None:
            continue
        w = rect.width
        h = rect.height
        if w < 1 or h < 1:
            continue
        # Square (strict: 5% tolerance) in the expected panel-indicator size range
        if abs(w - h) > (w * 0.05) and abs(w - h) > (h * 0.05):
            continue
        r_approx = (w + h) / 4
        # Panel border squares are typically 10-40% bigger than the inner circle radius
        if min_radius_pt * 1.05 <= r_approx <= max_radius_pt * 1.55:
            panel_rects.append(rect)

    circles = []
    seen: set = set()
    for path in page.get_drawings():
        rect = path.get("rect")
        if rect is None:
            continue
        w = rect.width
        h = rect.height
        if w < 1 or h < 1:
            continue
        # A circle has approximately equal width and height (15% tolerance)
        if abs(w - h) > (w * 0.15):
            continue
        r = (w + h) / 4
        if not (min_radius_pt <= r <= max_radius_pt):
            continue
        cx = rect.x0 + w / 2
        cy = rect.y0 + h / 2

        # Deduplicate: skip circles whose centre is within 2pt of an already-added one
        key = (round(cx, 1), round(cy, 1))
        if key in seen:
            continue
        seen.add(key)

        # Check if this circle is enclosed in a panel-indicator square
        is_panel = any(
            pr.x0 <= rect.x0 and pr.y0 <= rect.y0
            and pr.x1 >= rect.x1 and pr.y1 >= rect.y1
            for pr in panel_rects
        )
        circles.append((cx, cy, r, is_panel))

    # Second pass: panel indicator squares that have NO inner circle path.
    # Some CAD tools draw only the rectangle — the "circle" is just a visual
    # artefact of the block definition and never appears as a PDF path.
    detected_centers = {(round(cx, 0), round(cy, 0)) for cx, cy, *_ in circles}
    for pr in panel_rects:
        pr_cx = pr.x0 + pr.width / 2
        pr_cy = pr.y0 + pr.height / 2
        pr_key = (round(pr_cx, 0), round(pr_cy, 0))
        # Skip if a circle was already found at (approximately) this centre
        if pr_key in detected_centers:
            continue
        # Also skip if any detected circle centre is inside this panel rect
        already_covered = any(
            pr.x0 <= cx <= pr.x1 and pr.y0 <= cy <= pr.y1
            for cx, cy, *_ in circles
        )
        if already_covered:
            continue
        r_pr = (pr.width + pr.height) / 4
        circles.append((pr_cx, pr_cy, r_pr, True))

    return circles


def _words_near_circle(words, cx, cy, r, margin=0.85):
    """Return word dicts whose centres fall within the circle.

    margin < 1.0 keeps only text clearly inside — prevents adjacent service
    annotations (TYPE 13, TEMPERATURE UPSTREAM…) from bleeding into the word
    set and triggering the max_rows guard in _tag_from_words.
    """
    r2 = (r * margin) ** 2
    result = [
        w for w in words
        if (w['cx'] - cx) ** 2 + (w['cy'] - cy) ** 2 <= r2
    ]
    return sorted(result, key=lambda w: (w['y0'], w['x0']))


def _tag_from_words(words, separator="-", max_rows=4, line_tol_pt=4):
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


def _measure_tag_shape(words, line_tol_pt=4):
    """Return (n_rows, col_width) for a word cluster.

    col_width is the full x-span; n_rows is the number of distinct text lines.
    Used to calibrate _find_tags_without_circles to match the tag geometry
    already seen on this page.
    """
    if not words:
        return 0, 0.0
    line_y = None
    n_rows = 0
    for w in sorted(words, key=lambda x: (x['y0'], x['x0'])):
        if line_y is None or abs(w['y0'] - line_y) > line_tol_pt:
            n_rows += 1
            line_y = w['y0']
    col_width = max(w['x1'] for w in words) - min(w['x0'] for w in words)
    return n_rows, col_width


# ── Panel indicator detection: tag-shaped text with no surrounding circle ─────

_TYPE_CODE_RE = re.compile(r'^[A-Z]{2,5}$')
# Non-instrument codes that start with a valid ISA letter but are not ISA type codes
_SKIP_CODES = frozenset({
    'SP', 'NC', 'NO', 'NA', 'TYPE', 'TYP', 'API', 'NPS',
    'ANSI', 'CHOKE', 'AND', 'NOTE', 'NOTES', 'SHT', 'DWG', 'REV',
    'MIN', 'MAX', 'NOM', 'STD', 'TAG', 'REF', 'SEE', 'PER',
    'HH', 'LL', 'LO', 'HI',   # ISA alarm-level markers beside instrument symbols
    'DBB', 'NB',               # valve type / drawing annotations
})


def _find_tags_without_circles(
    words: list,
    seen_tags: set,
    default_area_code=None,
    max_rows: int = 4,
    col_half_width: float = 18.0,
) -> list:
    """
    Panel indicator detection: find instrument-shaped text clusters that have
    NO circle path around them.

    max_rows and col_half_width are calibrated from tags already found via
    circles on this page — so the search matches the exact tag geometry used
    in this drawing, rather than guessing.

    Logic:
      1. Anchor on every 2-5 letter ISA type code on the page
      2. Collect a narrow vertical column (width = col_half_width, height = max_rows lines)
      3. Validate: must parse to a tag with a loop number containing digits
      4. Check: is the cluster centre inside any circle path on this page?
         YES → circle pass already handles it → skip
         NO  → panel indicator → add it
    """
    results = []
    used_anchors: set = set()

    for w in sorted(words, key=lambda x: (x['y0'], x['x0'])):
        text = w['text'].strip()

        if not _TYPE_CODE_RE.match(text):
            continue
        if text in _SKIP_CODES:
            continue
        if text[0] not in InstrumentLogicEngine.FIRST_LETTER:
            continue

        wx, wy = w['cx'], w['cy']
        anchor_key = (round(wx), round(wy))
        if anchor_key in used_anchors:
            continue

        line_h = max(w['y1'] - w['y0'], 6.0)
        col = [
            w2 for w2 in words
            if abs(w2['cx'] - wx) < col_half_width
            and wy - 2 <= w2['cy'] <= wy + (max_rows + 1) * line_h
            and len(w2['text'].strip()) > 1                                          # skip H/L alarm markers
            and w2['text'].strip() not in _SKIP_CODES                                # skip annotation words
            and not (w2['text'].strip().isalpha() and len(w2['text'].strip()) > 5)   # skip service descriptions
            and re.match(r'^[A-Za-z0-9-]+$', w2['text'].strip())                    # skip pipe-size "2\"", setpoints "33,38", etc.
        ]
        col.sort(key=lambda x: (x['y0'], x['x0']))

        tag = _tag_from_words(col, max_rows=max_rows)
        if not tag or not any(c.isalpha() for c in tag):
            continue

        epc = InstrumentLogicEngine.get_epc_specs(tag, default_area_code)
        loop = epc.get('Loop_Number', '')

        # Loop must have ≥2 digits (filters single-digit sheet refs like "BAB-2-SHT")
        # and be ≤10 chars (filters drawing numbers like "AND-1128082663")
        if not loop or sum(c.isdigit() for c in loop) < 2 or len(loop) > 10:
            continue

        tag_key = tag.upper().strip()
        if tag_key in seen_tags:
            continue

        n = min(len(col), max_rows)
        est_cx = sum(x['cx'] for x in col[:n]) / n
        est_cy = sum(x['cy'] for x in col[:n]) / n

        # seen_tags already deduplicates: if the circle pass captured this tag it is
        # already in seen_tags and was skipped above. We only reach here when the
        # circle pass either found no circle OR found the circle but failed to extract
        # the full tag (e.g. dividing line cuts the symbol in half so text below the
        # line falls outside the circle radius). In both cases, add the tag.

        used_anchors.add(anchor_key)
        seen_tags.add(tag_key)
        results.append((est_cx, est_cy, tag, epc))

    return results


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
        # Wide default — covers instrument circles from ~15 px to ~117 px at 300 DPI.
        # Upper bound raised to 28 pt to capture CVA / actuator symbols which are
        # sometimes drawn larger than standard field-instrument bubbles.
        min_r_pt = 3.5   # ≈ 14.6 px at 300 DPI
        max_r_pt = 28.0  # ≈ 116.7 px at 300 DPI

    all_instruments = []
    all_lines = []
    instrument_counter = 1
    total_circles_found = 0
    skipped_pages = []

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
        page_text = page.get_text("text") or ""
        drawing_count = len(page.get_drawings())
        page_class = classify_page_for_instruments(
            page_text,
            word_count=len(words_raw),
            drawing_count=drawing_count,
        )
        if not page_class.should_extract:
            skipped_pages.append({
                "page": page_number,
                "kind": page_class.kind,
                "reason": page_class.reason,
                "admin_score": page_class.admin_score,
                "pid_score": page_class.pid_score,
                "word_count": page_class.word_count,
                "drawing_count": page_class.drawing_count,
            })
            logger.info(
                "PyMuPDF page %s: skipped %s page (%s, words=%s, drawings=%s)",
                page_number,
                page_class.kind,
                page_class.reason,
                page_class.word_count,
                page_class.drawing_count,
            )
            continue

        # ── Instrument extraction ─────────────────────────────────────────────
        circles = _extract_circles(page, min_r_pt, max_r_pt)
        total_circles_found += len(circles)
        seen_tags = set()
        tag_shapes = []   # (n_rows, col_width) — used to calibrate panel-text search

        for cx_pt, cy_pt, r_pt, is_panel in circles:
            # Panel indicators have text spanning the full square, not just the inner circle.
            # Expand search radius so words below the horizontal dividing line are captured.
            search_r = r_pt * 1.4 if is_panel else r_pt
            nearby = _words_near_circle(words, cx_pt, cy_pt, search_r)
            nearby = [
                w for w in nearby
                if len(w['text'].strip()) > 1
                and w['text'].strip() not in _SKIP_CODES
                and not (w['text'].strip().isalpha() and len(w['text'].strip()) > 5)
                and re.match(r'^[A-Za-z0-9-]+$', w['text'].strip())
            ]
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

            # Record tag shape for panel-text calibration
            shape_n, shape_w = _measure_tag_shape(nearby)
            if shape_n >= 1:
                tag_shapes.append((shape_n, shape_w))

            # Convert centre to pixels for coordinate consistency with OCR pipeline
            cx_px = int(_pt_to_px(cx_pt, dpi))
            cy_px = int(_pt_to_px(cy_pt, dpi))
            r_px = int(_pt_to_px(r_pt, dpi))

            # Panel-indicator circles (ISA circle-in-square) → panel-mounted soft display
            if is_panel:
                epc['Mounting'] = 'Panel Mounted'
                if epc['IO_Type'] not in ('AI', 'AO', 'DI', 'DO'):
                    epc['IO_Type'] = 'Soft Link'
                if not epc['System'] or epc['System'] == 'REVIEW':
                    epc['System'] = 'DCS'

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
                'Location_Drawing': 'Panel' if is_panel else 'Field',
                'Coordinates': f"{cx_px},{cy_px}",
                'Radius': r_px,
                'P&ID_Page': page_number,
            })

        # ── Panel indicators: tag-shaped text with no surrounding circle ────
        # Calibrate search shape from tags already found via circles on this page.
        if tag_shapes:
            rows_s = sorted(n for n, _ in tag_shapes)
            widths_s = sorted(w for _, w in tag_shapes)
            mid_r = len(rows_s) // 2
            mid_w = len(widths_s) // 2
            typical_rows = max(3, rows_s[mid_r] + 1)  # +1 tolerance; floor 3 for std tags
            # half-width + 4 pt buffer so text at the column edge isn't clipped
            typical_col_half_width = widths_s[mid_w] / 2 + 4
        else:
            typical_rows = 3
            typical_col_half_width = 18.0

        panel_tags = _find_tags_without_circles(
            words, seen_tags, default_area_code,
            max_rows=typical_rows,
            col_half_width=typical_col_half_width,
        )
        for est_cx, est_cy, tag, epc in panel_tags:
            cx_px = int(_pt_to_px(est_cx, dpi))
            cy_px = int(_pt_to_px(est_cy, dpi))
            epc['Mounting'] = 'Panel Mounted'
            if epc['IO_Type'] not in ('AI', 'AO', 'DI', 'DO'):
                epc['IO_Type'] = 'Soft Link'
            if not epc['System'] or epc['System'] == 'REVIEW':
                epc['System'] = 'DCS'
            ref_id = str(instrument_counter)
            instrument_counter += 1
            all_instruments.append({
                'Ref_ID': ref_id,
                'Verification_Source': f"{page_filename_base} -> PyMuPDF #{ref_id} (panel-text)",
                'Review_Required': (epc['Confidence'] == 'Low'),
                'P&ID_Filename': pid_filename,
                'Tag_Number': tag,
                'Area': epc['Area_Code'], 'Type': epc['Instrument_Type'],
                'Loop': epc['Loop_Number'], 'Suffix': epc['Tag_Suffix'],
                'Instrument_Description': epc['Instrument_Description'],
                'Service': epc['Service'], 'System': epc['System'],
                'IO_Type': epc['IO_Type'], 'Signal_Type': epc['Signal_Type'],
                'Power_Supply': epc['Power_Supply'], 'Mounting': epc['Mounting'],
                'Location_Drawing': 'Panel',
                'Coordinates': f"{cx_px},{cy_px}",
                'Radius': 0,
                'P&ID_Page': page_number,
            })

        # ── Line number extraction (multi-word grouping) ──────────────────────
        # Convert PyMuPDF words (PDF points) to the format expected by
        # extract_line_numbers (pixels at full DPI).
        scale_px = dpi / 72.0
        words_for_lines = []
        for w in words:
            w_px = w['x1'] - w['x0']
            h_px = w['y1'] - w['y0']
            words_for_lines.append({
                'text':     w['text'],
                'x':        w['x0'] * scale_px,
                'y':        w['y0'] * scale_px,
                'w':        w_px * scale_px,
                'center_x': w['cx'] * scale_px,
                'center_y': w['cy'] * scale_px,
                'orientation': 'V' if h_px > w_px * 1.5 else 'H',
            })

        page_lines_df = _extract_line_numbers(
            words_for_lines, page_filename_base,
        )

        if not page_lines_df.empty:
            # Attach orientation: find nearest original word to each line centre
            for idx, row in page_lines_df.iterrows():
                try:
                    cx, cy = (float(v) for v in str(row['Coordinates']).split(','))
                    nearest = min(
                        words_for_lines,
                        key=lambda w: (w['center_x'] - cx) ** 2 + (w['center_y'] - cy) ** 2
                    )
                    page_lines_df.at[idx, 'Orientation'] = nearest['orientation']
                except Exception:
                    page_lines_df.at[idx, 'Orientation'] = 'H'
            all_lines.append(page_lines_df)
        seen_lines = set(page_lines_df['Line_Number']) if not page_lines_df.empty else set()

        logger.info(
            f"PyMuPDF page {page_number}: {len(seen_tags)} circle instruments, "
            f"{len(panel_tags)} panel-text instruments, {len(seen_lines)} line numbers"
        )

    doc.close()

    instruments_df = pd.DataFrame(all_instruments) if all_instruments else pd.DataFrame()
    lines_df = (
        pd.concat(all_lines, ignore_index=True).drop_duplicates(subset=['Line_Number'])
        if all_lines else pd.DataFrame()
    )
    stats = {
        "circles_found":  total_circles_found,
        "tags_extracted": len(instruments_df),
        "skipped_pages": skipped_pages,
    }
    return instruments_df, lines_df, stats
