"""
Piping MTO symbol detection via OpenCV template matching.
No LLM, no OCR — pure template matching on the rendered PDF page.
"""
import base64
import logging
from typing import Optional

import cv2
import fitz  # PyMuPDF
import numpy as np

logger = logging.getLogger(__name__)

_ROT_CODES = [None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180, cv2.ROTATE_90_COUNTERCLOCKWISE]


def _to_edges(gray: np.ndarray) -> np.ndarray:
    """Canny edge map — captures exact line structure, ignores fill/shading differences."""
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    return cv2.Canny(blurred, 30, 120)


def _render_page(pdf_bytes: bytes, dpi: int = 300, page_num: int = 0) -> np.ndarray:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[page_num]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    doc.close()
    return img


def _match_template_on_region(tmpl_e: np.ndarray, region_e: np.ndarray, threshold: float, ox: int = 0, oy: int = 0) -> list:
    raw = []
    for rot_code in _ROT_CODES:
        rot_tmpl_e = cv2.rotate(tmpl_e, rot_code) if rot_code is not None else tmpl_e
        rth, rtw = rot_tmpl_e.shape
        if rth > region_e.shape[0] or rtw > region_e.shape[1]:
            continue
        result = cv2.matchTemplate(region_e, rot_tmpl_e, cv2.TM_CCOEFF_NORMED)
        ys, xs = np.nonzero(result >= threshold)
        for y, x in zip(ys, xs):
            raw.append([x + ox, y + oy, x + ox + rtw, y + oy + rth, float(result[y, x])])
    return raw


def _nms(boxes: list, iou_threshold: float = 0.3) -> list:
    if not boxes:
        return []
    boxes = sorted(boxes, key=lambda b: b[4], reverse=True)
    keep = []
    while boxes:
        best = boxes.pop(0)
        keep.append(best)
        remaining = []
        for b in boxes:
            ix1 = max(best[0], b[0])
            iy1 = max(best[1], b[1])
            ix2 = min(best[2], b[2])
            iy2 = min(best[3], b[3])
            inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
            area_a = (best[2] - best[0]) * (best[3] - best[1])
            area_b = (b[2] - b[0]) * (b[3] - b[1])
            union = area_a + area_b - inter
            iou = inter / union if union > 0 else 0
            if iou < iou_threshold:
                remaining.append(b)
        boxes = remaining
    return keep


def _matches_to_dicts(matches: list) -> list:
    return [
        {"x1": int(b[0]), "y1": int(b[1]), "x2": int(b[2]), "y2": int(b[3]), "score": round(b[4], 3)}
        for b in matches
    ]


def detect_symbol(
    pdf_bytes: bytes,
    template_box: tuple,
    search_box: Optional[tuple],
    threshold: float = 0.70,
    label: str = "Symbol",
    dpi: int = 300,
) -> dict:
    """
    Find all instances of a template symbol within a P&ID page.

    template_box / search_box: (x1, y1, x2, y2) in rendered image pixels.
    Coordinates must match the DPI used to generate the preview shown to the user.
    """
    img_rgb = _render_page(pdf_bytes, dpi=dpi, page_num=0)
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape

    tx1, ty1, tx2, ty2 = template_box
    tx1, ty1 = max(0, int(tx1)), max(0, int(ty1))
    tx2, ty2 = min(w, int(tx2)), min(h, int(ty2))

    if tx2 <= tx1 or ty2 <= ty1:
        raise ValueError("Template box is empty or out of bounds.")

    tmpl = gray[ty1:ty2, tx1:tx2]

    if search_box is not None:
        sx1, sy1, sx2, sy2 = search_box
        sx1, sy1 = max(0, int(sx1)), max(0, int(sy1))
        sx2, sy2 = min(w, int(sx2)), min(h, int(sy2))
        region = gray[sy1:sy2, sx1:sx2]
        ox, oy = sx1, sy1
    else:
        region = gray
        ox, oy = 0, 0
        sx1, sy1, sx2, sy2 = 0, 0, w, h

    tmpl_e = _to_edges(tmpl)
    region_e = _to_edges(region)

    raw = _match_template_on_region(tmpl_e, region_e, threshold, ox, oy)
    matches = _nms(raw, iou_threshold=0.2)
    logger.info("Piping MTO: %d '%s' matches (threshold=%.2f)", len(matches), label, threshold)

    annotated = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)
    if search_box is not None:
        cv2.rectangle(annotated, (sx1, sy1), (sx2, sy2), (50, 160, 230), 3)
    for box in matches:
        cv2.rectangle(annotated, (int(box[0]), int(box[1])), (int(box[2]), int(box[3])), (30, 30, 210), 3)
    cv2.rectangle(annotated, (tx1, ty1), (tx2, ty2), (40, 200, 40), 4)

    _, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
    b64 = base64.b64encode(buf.tobytes()).decode("utf-8")

    return {
        "count": len(matches),
        "label": label,
        "threshold": threshold,
        "matches": _matches_to_dicts(matches),
        "annotated_image": b64,
        "image_width": w,
        "image_height": h,
    }


def detect_all_pages(
    pdf_bytes: bytes,
    template_box: tuple,
    threshold: float = 0.70,
    label: str = "Symbol",
    dpi: int = 300,
) -> dict:
    """
    Detect a symbol across every page of the PDF.
    Template is extracted from page 1. Returns per-page counts plus total.
    """
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    n_pages = len(doc)
    mat = fitz.Matrix(dpi / 72, dpi / 72)

    # Render page 1 and extract template
    pix = doc[0].get_pixmap(matrix=mat, colorspace=fitz.csRGB, alpha=False)
    page1_rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    page1_gray = cv2.cvtColor(page1_rgb, cv2.COLOR_RGB2GRAY)
    ph, pw = page1_gray.shape

    tx1, ty1, tx2, ty2 = (max(0, int(v)) for v in template_box)
    tx2, ty2 = min(pw, tx2), min(ph, ty2)
    if tx2 <= tx1 or ty2 <= ty1:
        raise ValueError("Template box is empty or out of bounds.")

    tmpl_e = _to_edges(page1_gray[ty1:ty2, tx1:tx2])

    pages_data = []
    page1_match_dicts = []
    total_count = 0

    for page_num in range(n_pages):
        if page_num == 0:
            img_rgb = page1_rgb
        else:
            pix = doc[page_num].get_pixmap(matrix=mat, colorspace=fitz.csRGB, alpha=False)
            img_rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)

        gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
        region_e = _to_edges(gray)
        rh, rw = region_e.shape

        raw = _match_template_on_region(tmpl_e, region_e, threshold)
        matches = _nms(raw, iou_threshold=0.2)
        match_dicts = _matches_to_dicts(matches)

        if page_num == 0:
            page1_match_dicts = match_dicts

        pages_data.append({"page": page_num + 1, "count": len(matches), "matches": match_dicts})
        total_count += len(matches)
        logger.info("Page %d: %d '%s' matches", page_num + 1, len(matches), label)

    doc.close()
    logger.info("All-pages total: %d '%s' matches across %d pages", total_count, label, n_pages)

    # Annotate page 1 for preview
    annotated = cv2.cvtColor(page1_rgb, cv2.COLOR_RGB2BGR)
    cv2.rectangle(annotated, (tx1, ty1), (tx2, ty2), (40, 200, 40), 4)
    for m in page1_match_dicts:
        cv2.rectangle(annotated, (m["x1"], m["y1"]), (m["x2"], m["y2"]), (30, 30, 210), 3)
    _, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
    b64 = base64.b64encode(buf.tobytes()).decode("utf-8")

    return {
        "count": total_count,
        "label": label,
        "threshold": threshold,
        "matches": page1_match_dicts,   # page 1 matches for SVG overlay
        "total_count": total_count,
        "pages": pages_data,
        "annotated_image": b64,
        "image_width": pw,
        "image_height": ph,
    }
