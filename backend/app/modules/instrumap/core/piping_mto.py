"""
Piping MTO symbol detection via OpenCV template matching.
No LLM, no OCR — pure template matching on the rendered PDF page.
"""
import base64
import hashlib
import logging
import threading
from collections import OrderedDict
from typing import Optional

import cv2
import fitz  # PyMuPDF
import numpy as np

logger = logging.getLogger(__name__)

_ROT_CODES = [None, cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_180, cv2.ROTATE_90_COUNTERCLOCKWISE]

# Scale factors to try — covers ±12% size variation common in P&ID symbol sets
_SCALES = [0.88, 0.94, 1.00, 1.06, 1.12]

# Fine-angle rotations applied at base scale only (±5°/10°/15° — handles diagonal symbols)
_FINE_ANGLES = [-15.0, -10.0, -5.0, 5.0, 10.0, 15.0]

# ── Page cache ────────────────────────────────────────────────────────────────
# Stores preprocessed grayscale arrays keyed by (pdf_hash, dpi, page_num).
# Avoids re-rendering the same PDF page for every symbol search in a session.
_PAGE_CACHE: OrderedDict = OrderedDict()
_PAGE_CACHE_MAX = 60  # ~60 pages; memory scales with page size
_PAGE0_RGB: dict = {}  # (pdf_hash, dpi) -> page-0 img_rgb, kept for annotation
_PAGE0_RGB_MAX = 15
_cache_lock = threading.Lock()  # guards both cache dicts for thread-pool safety


def _pdf_hash(pdf_bytes: bytes) -> str:
    """Fast but stable hash — samples first 64 KB + total length."""
    sample = pdf_bytes[:65536] + len(pdf_bytes).to_bytes(8, "big")
    return hashlib.md5(sample).hexdigest()


def _preprocess(gray: np.ndarray) -> np.ndarray:
    """Bilateral denoise + CLAHE contrast — improves match quality on scanned PDFs."""
    denoised = cv2.bilateralFilter(gray, d=5, sigmaColor=30, sigmaSpace=30)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(denoised)


def _deskew(gray: np.ndarray) -> np.ndarray:
    """Detect and correct scan skew up to ±10° via probabilistic Hough lines."""
    edges = cv2.Canny(gray, 50, 150, apertureSize=3)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=100,
                             minLineLength=100, maxLineGap=10)
    if lines is None:
        return gray
    angles = []
    for line in lines[:200]:
        x1, y1, x2, y2 = line[0]
        if x2 == x1:
            continue
        a = np.degrees(np.arctan2(y2 - y1, x2 - x1))
        if abs(a) < 10:
            angles.append(a)
        elif abs(abs(a) - 90) < 10:
            angles.append(a - (90 if a > 0 else -90))
    if not angles:
        return gray
    skew = float(np.median(angles))
    if abs(skew) < 0.3:
        return gray
    h, w = gray.shape
    M = cv2.getRotationMatrix2D((w / 2, h / 2), skew, 1.0)
    corrected = cv2.warpAffine(gray, M, (w, h),
                               flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    logger.debug("Deskew applied: %.2f°", skew)
    return corrected


def _fetch_page_gray(doc: "fitz.Document", page_num: int, dpi: int, pdf_hash: str) -> np.ndarray:
    """Return preprocessed+deskewed grayscale for a page; render and cache on first access."""
    key = (pdf_hash, dpi, page_num)
    with _cache_lock:
        if key in _PAGE_CACHE:
            _PAGE_CACHE.move_to_end(key)
            return _PAGE_CACHE[key]

    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = doc[page_num].get_pixmap(matrix=mat, colorspace=fitz.csRGB, alpha=False)
    img_rgb = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)

    if page_num == 0:
        rgb_key = (pdf_hash, dpi)
        with _cache_lock:
            _PAGE0_RGB[rgb_key] = img_rgb
            if len(_PAGE0_RGB) > _PAGE0_RGB_MAX:
                del _PAGE0_RGB[next(iter(_PAGE0_RGB))]

    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    gray = _preprocess(gray)
    gray = _deskew(gray)

    with _cache_lock:
        if key not in _PAGE_CACHE:  # double-check after expensive render
            if len(_PAGE_CACHE) >= _PAGE_CACHE_MAX:
                _PAGE_CACHE.popitem(last=False)
            _PAGE_CACHE[key] = gray
    return gray


def _rotate_fine(img: np.ndarray, angle: float) -> np.ndarray:
    """Rotate a float32 image by `angle` degrees in-place (same dimensions, zero-padded)."""
    h, w = img.shape[:2]
    M = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(img, M, (w, h),
                          flags=cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_CONSTANT, borderValue=0.0)


def _to_edges(gray: np.ndarray) -> np.ndarray:
    """Canny edge map — captures exact line structure, ignores fill/shading differences."""
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    return cv2.Canny(blurred, 30, 120)


def _soften_edges(edges: np.ndarray) -> np.ndarray:
    """Light Gaussian blur on edge map — makes matching more tolerant of line noise in dense areas."""
    return cv2.GaussianBlur(edges.astype(np.float32), (3, 3), 0.8)


def _render_page(pdf_bytes: bytes, dpi: int = 300, page_num: int = 0) -> np.ndarray:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    page = doc[page_num]
    mat = fitz.Matrix(dpi / 72, dpi / 72)
    pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
    doc.close()
    return img


def _match_template_on_region(tmpl_e: np.ndarray, region_e: np.ndarray, threshold: float, ox: int = 0, oy: int = 0) -> list:
    """
    Multi-scale + multi-rotation template matching.
    - 5 scales (±12%) × 4 cardinal rotations across all scales
    - 6 fine angles (±5°/10°/15°) at base scale only — handles diagonal symbols
    - Softened edge maps improve recall in dense line areas
    """
    th, tw = tmpl_e.shape
    rh, rw = region_e.shape

    region_soft = _soften_edges(region_e)

    raw = []
    for scale in _SCALES:
        s_h = max(4, int(round(th * scale)))
        s_w = max(4, int(round(tw * scale)))
        if s_h >= rh or s_w >= rw:
            continue

        if abs(scale - 1.0) < 1e-9:
            scaled_e = tmpl_e.astype(np.float32)
        else:
            resized = cv2.resize(tmpl_e, (s_w, s_h), interpolation=cv2.INTER_LINEAR)
            scaled_e = (resized > 30).astype(np.float32) * 255.0
        tmpl_soft = cv2.GaussianBlur(scaled_e, (3, 3), 0.8)

        # Cardinal rotations at every scale
        for rot_code in _ROT_CODES:
            rot = cv2.rotate(tmpl_soft, rot_code) if rot_code is not None else tmpl_soft
            rth, rtw = rot.shape
            if rth >= rh or rtw >= rw:
                continue
            result = cv2.matchTemplate(region_soft, rot, cv2.TM_CCOEFF_NORMED)
            ys, xs = np.nonzero(result >= threshold)
            for y, x in zip(ys, xs):
                raw.append([x + ox, y + oy, x + ox + rtw, y + oy + rth, float(result[y, x])])

        # Fine-angle rotations at base scale only (minimal extra cost, catches diagonal placement)
        if abs(scale - 1.0) < 1e-9:
            for angle in _FINE_ANGLES:
                rot = _rotate_fine(tmpl_soft, angle)
                rth, rtw = rot.shape
                if rth >= rh or rtw >= rw:
                    continue
                result = cv2.matchTemplate(region_soft, rot, cv2.TM_CCOEFF_NORMED)
                ys, xs = np.nonzero(result >= threshold)
                for y, x in zip(ys, xs):
                    raw.append([x + ox, y + oy, x + ox + rtw, y + oy + rth, float(result[y, x])])

    # Cap raw candidates before O(n²) NMS — protects against sparse-image false-positive floods.
    if len(raw) > 2000:
        raw.sort(key=lambda b: b[4], reverse=True)
        raw = raw[:2000]
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


def _orb_fallback(tmpl_gray: np.ndarray, page_gray: np.ndarray) -> list:
    """
    ORB keypoint fallback — activated when edge template matching finds 0 matches on a page.
    Clusters matched scene keypoints by template-size proximity; each cluster becomes a candidate box.
    Scores are capped at 0.89 to mark them as lower-confidence than standard matches.
    """
    th, tw = tmpl_gray.shape
    orb = cv2.ORB_create(nfeatures=600)
    kp1, des1 = orb.detectAndCompute(tmpl_gray, None)
    kp2, des2 = orb.detectAndCompute(page_gray, None)
    if des1 is None or des2 is None or len(kp1) < 4 or len(kp2) < 4:
        return []
    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    try:
        raw_knn = matcher.knnMatch(des1, des2, k=2)
    except cv2.error:
        return []
    good = [pair[0] for pair in raw_knn
            if len(pair) == 2 and pair[0].distance < 0.75 * pair[1].distance]
    if len(good) < 4:
        return []

    scene_pts = np.array([kp2[m.trainIdx].pt for m in good])  # shape (N, 2)
    used = np.zeros(len(scene_pts), dtype=bool)
    boxes = []
    for i in range(len(scene_pts)):
        if used[i]:
            continue
        cx, cy = scene_pts[i]
        mask = (np.abs(scene_pts[:, 0] - cx) < tw) & (np.abs(scene_pts[:, 1] - cy) < th) & ~used
        count = int(mask.sum())
        if count < 3:
            continue
        used |= mask
        cx_c, cy_c = float(scene_pts[mask, 0].mean()), float(scene_pts[mask, 1].mean())
        x1 = max(0, int(cx_c - tw / 2))
        y1 = max(0, int(cy_c - th / 2))
        x2 = min(page_gray.shape[1], x1 + tw)
        y2 = min(page_gray.shape[0], y1 + th)
        if x2 > x1 and y2 > y1:
            score = round(min(0.89, float(count) / max(1, len(kp1))), 3)
            boxes.append([x1, y1, x2, y2, score])
    return boxes


def detect_symbol(
    pdf_bytes: bytes,
    template_box: tuple,
    search_box: Optional[tuple],
    threshold: float = 0.70,
    label: str = "Symbol",
    dpi: int = 150,
    coord_dpi: int = 300,
) -> dict:
    """
    Find all instances of a template symbol within a P&ID page.

    template_box / search_box are in coord_dpi pixel space (preview DPI).
    Detection renders the page at dpi and scales coordinates accordingly.
    """
    img_rgb = _render_page(pdf_bytes, dpi=dpi, page_num=0)
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    gray = _preprocess(gray)
    gray = _deskew(gray)
    h, w = gray.shape

    coord_scale = dpi / coord_dpi
    tx1 = max(0, int(template_box[0] * coord_scale))
    ty1 = max(0, int(template_box[1] * coord_scale))
    tx2 = min(w, int(template_box[2] * coord_scale))
    ty2 = min(h, int(template_box[3] * coord_scale))

    if tx2 <= tx1 or ty2 <= ty1:
        raise ValueError("Template box is empty or out of bounds.")

    tmpl = gray[ty1:ty2, tx1:tx2]

    if search_box is not None:
        sx1 = max(0, int(search_box[0] * coord_scale))
        sy1 = max(0, int(search_box[1] * coord_scale))
        sx2 = min(w, int(search_box[2] * coord_scale))
        sy2 = min(h, int(search_box[3] * coord_scale))
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


def detect_from_template_image_all_pages(
    pdf_bytes: bytes,
    template_bytes: bytes,
    threshold: float = 0.70,
    label: str = "Symbol",
    dpi: int = 150,
    template_dpi: int = 300,
) -> dict:
    """
    Detect a symbol across every page using a pre-saved template image (PNG/JPEG bytes).
    template_dpi is the DPI at which the template crop was made (always the preview DPI).
    dpi is the rendering DPI for detection — lower = faster.
    Pages are preprocessed (bilateral + CLAHE + deskew) and cached across symbol searches.
    """
    arr = np.frombuffer(template_bytes, dtype=np.uint8)
    tmpl = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if tmpl is None:
        raise ValueError("Could not decode template image.")

    if template_dpi != dpi:
        scale = dpi / template_dpi
        new_h = max(4, int(round(tmpl.shape[0] * scale)))
        new_w = max(4, int(round(tmpl.shape[1] * scale)))
        tmpl = cv2.resize(tmpl, (new_w, new_h), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)

    tmpl_e = _to_edges(tmpl)

    pdf_hash = _pdf_hash(pdf_bytes)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    n_pages = len(doc)

    pages_data = []
    page1_match_dicts: list = []
    pw = ph = 0
    total_count = 0

    for page_num in range(n_pages):
        gray = _fetch_page_gray(doc, page_num, dpi, pdf_hash)
        if page_num == 0:
            ph, pw = gray.shape

        region_e = _to_edges(gray)
        raw = _match_template_on_region(tmpl_e, region_e, threshold)
        matches = _nms(raw, iou_threshold=0.2)

        if not matches:
            orb_raw = _orb_fallback(tmpl, gray)
            if orb_raw:
                matches = _nms(orb_raw, iou_threshold=0.3)
                logger.info("Page %d: ORB fallback found %d '%s' candidates", page_num + 1, len(matches), label)

        match_dicts = _matches_to_dicts(matches)
        if page_num == 0:
            page1_match_dicts = match_dicts

        pages_data.append({"page": page_num + 1, "count": len(matches), "matches": match_dicts})
        total_count += len(matches)
        logger.info("Page %d: %d '%s' (library template) matches", page_num + 1, len(matches), label)

    doc.close()

    page1_rgb = _PAGE0_RGB.get((pdf_hash, dpi))
    if page1_rgb is None:
        page1_rgb = _render_page(pdf_bytes, dpi=dpi, page_num=0)
    annotated = cv2.cvtColor(page1_rgb, cv2.COLOR_RGB2BGR)
    for m in page1_match_dicts:
        cv2.rectangle(annotated, (m["x1"], m["y1"]), (m["x2"], m["y2"]), (30, 30, 210), 3)
    _, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 85])
    b64 = base64.b64encode(buf.tobytes()).decode("utf-8")

    return {
        "count": total_count,
        "label": label,
        "threshold": threshold,
        "matches": page1_match_dicts,
        "total_count": total_count,
        "pages": pages_data,
        "annotated_image": b64,
        "image_width": pw,
        "image_height": ph,
    }


def detect_all_pages(
    pdf_bytes: bytes,
    template_box: tuple,
    threshold: float = 0.70,
    label: str = "Symbol",
    dpi: int = 150,
    coord_dpi: int = 300,
) -> dict:
    """
    Detect a symbol across every page of the PDF.
    Template is extracted from page 1. coord_dpi is the preview DPI (always 300).
    Pages are preprocessed (bilateral + CLAHE + deskew) and cached across symbol searches.
    """
    pdf_hash = _pdf_hash(pdf_bytes)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    n_pages = len(doc)

    # Fetch page 1 (already preprocessed + deskewed) and extract template from it
    page1_gray = _fetch_page_gray(doc, 0, dpi, pdf_hash)
    ph, pw = page1_gray.shape

    coord_scale = dpi / coord_dpi
    tx1 = max(0, int(template_box[0] * coord_scale))
    ty1 = max(0, int(template_box[1] * coord_scale))
    tx2 = min(pw, int(template_box[2] * coord_scale))
    ty2 = min(ph, int(template_box[3] * coord_scale))
    if tx2 <= tx1 or ty2 <= ty1:
        doc.close()
        raise ValueError("Template box is empty or out of bounds.")

    tmpl_e = _to_edges(page1_gray[ty1:ty2, tx1:tx2])

    pages_data = []
    page1_match_dicts: list = []
    total_count = 0

    tmpl_gray_for_orb = page1_gray[ty1:ty2, tx1:tx2]

    for page_num in range(n_pages):
        gray = _fetch_page_gray(doc, page_num, dpi, pdf_hash)
        region_e = _to_edges(gray)
        raw = _match_template_on_region(tmpl_e, region_e, threshold)
        matches = _nms(raw, iou_threshold=0.2)

        if not matches:
            orb_raw = _orb_fallback(tmpl_gray_for_orb, gray)
            if orb_raw:
                matches = _nms(orb_raw, iou_threshold=0.3)
                logger.info("Page %d: ORB fallback found %d '%s' candidates", page_num + 1, len(matches), label)

        match_dicts = _matches_to_dicts(matches)
        if page_num == 0:
            page1_match_dicts = match_dicts

        pages_data.append({"page": page_num + 1, "count": len(matches), "matches": match_dicts})
        total_count += len(matches)
        logger.info("Page %d: %d '%s' matches", page_num + 1, len(matches), label)

    doc.close()
    logger.info("All-pages total: %d '%s' matches across %d pages", total_count, label, n_pages)

    page1_rgb = _PAGE0_RGB.get((pdf_hash, dpi))
    if page1_rgb is None:
        page1_rgb = _render_page(pdf_bytes, dpi=dpi, page_num=0)
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
        "matches": page1_match_dicts,
        "total_count": total_count,
        "pages": pages_data,
        "annotated_image": b64,
        "image_width": pw,
        "image_height": ph,
    }
