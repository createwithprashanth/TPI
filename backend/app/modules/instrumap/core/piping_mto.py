"""
Piping MTO symbol detection via OpenCV template matching.
No LLM, no OCR — pure template matching on the rendered PDF page.
"""
import base64
import hashlib
import logging
import re
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
_VALVE_GEOMETRY_LABELS = (
    "VALVE", "BALL", "CHECK", "BUTTERFLY", "PLUG", "NEEDLE",
    "ANGLE", "DIAPHRAGM", "SSV", "SSSV", "HOV", "MOV", "SDV", "BDV",
)

# ── Page cache ────────────────────────────────────────────────────────────────
# Stores preprocessed grayscale arrays keyed by (pdf_hash, dpi, page_num).
# Avoids re-rendering the same PDF page for every symbol search in a session.
_PAGE_CACHE: OrderedDict = OrderedDict()
_PAGE_CACHE_MAX = 60  # ~60 pages; memory scales with page size
_PAGE_COMPONENT_CACHE: OrderedDict = OrderedDict()
_PAGE_COMPONENT_CACHE_MAX = 40
_PAGE_WORD_CACHE: OrderedDict = OrderedDict()
_PAGE_WORD_CACHE_MAX = 80
_PAGE_VALVE_GEOMETRY_CACHE: OrderedDict = OrderedDict()
_PAGE_VALVE_GEOMETRY_CACHE_MAX = 40
_PAGE0_RGB: dict = {}  # (pdf_hash, dpi) -> page-0 img_rgb, kept for annotation
_PAGE0_RGB_MAX = 15
_cache_lock = threading.Lock()  # guards both cache dicts for thread-pool safety
_EXACT_MATCH_DPI_MAX = 150

_INCH_CHARS = '"\u201c\u201d\u2019\u2032\u2033\''
_KNOWN_INCH_SIZES = {
    "0.5", "0.75", "1", "1.25", "1.5", "2", "2.5", "3", "4",
    "6", "8", "10", "12", "14", "16", "18", "20", "24", "30", "36", "42", "48",
}
_SIZE_TOKEN_RE = re.compile(
    rf"^(?P<size>\d{{1,2}}(?:\.\d{{1,2}})?|\d{{1,2}}[-\s]+\d/[24]|\d/[24])\s*[{re.escape(_INCH_CHARS)}]$"
)
_LINE_SIZE_RE = re.compile(
    rf"^(?:DN)?(?P<size>\d{{1,3}}(?:\.\d{{1,2}})?)\s*[{re.escape(_INCH_CHARS)}]?-?[A-Z]{{1,5}}-\d{{3,6}}",
    re.IGNORECASE,
)


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


def _fetch_page_component_binary(doc: "fitz.Document", page_num: int, dpi: int, pdf_hash: str) -> np.ndarray:
    """Return cached cleaned component ink for exact matching."""
    key = (pdf_hash, dpi, page_num)
    with _cache_lock:
        if key in _PAGE_COMPONENT_CACHE:
            _PAGE_COMPONENT_CACHE.move_to_end(key)
            return _PAGE_COMPONENT_CACHE[key]

    gray = _fetch_page_gray(doc, page_num, dpi, pdf_hash)
    binary = _to_component_binary(gray, remove_speckles=False)

    with _cache_lock:
        if key not in _PAGE_COMPONENT_CACHE:
            if len(_PAGE_COMPONENT_CACHE) >= _PAGE_COMPONENT_CACHE_MAX:
                _PAGE_COMPONENT_CACHE.popitem(last=False)
            _PAGE_COMPONENT_CACHE[key] = binary
    return binary


def _normalize_size_text(text: str) -> str:
    text = re.sub(r"[\u201c\u201d\u2019\u2032\u2033']", '"', text or "")
    text = re.sub(r"\s+", " ", text).strip().upper()
    return text


def _display_size(size: str) -> str:
    size = _normalize_size_text(size).replace('"', '').strip()
    size = re.sub(r"[-\s]+", " ", size)
    if size in {"1/2", "2/4"}:
        return "0.5"
    if size == "3/4":
        return "0.75"
    mixed = re.match(r"^(\d{1,2})\s+(\d)/([24])$", size)
    if mixed:
        whole, num, den = mixed.groups()
        value = int(whole) + int(num) / int(den)
        return str(value).rstrip("0").rstrip(".")
    return size.lstrip("0") or size


def _size_from_text(text: str) -> Optional[str]:
    norm = _normalize_size_text(text)
    if not norm:
        return None

    line_match = _LINE_SIZE_RE.match(norm.replace(" ", ""))
    if line_match:
        size = _display_size(line_match.group("size"))
        return size if size in _KNOWN_INCH_SIZES else None

    token_match = _SIZE_TOKEN_RE.match(norm)
    if token_match:
        size = _display_size(token_match.group("size"))
        return size if size in _KNOWN_INCH_SIZES else None

    return None


def _fetch_page_words(doc: "fitz.Document", page_num: int, dpi: int, pdf_hash: str) -> list[dict]:
    """Return PyMuPDF words in detection pixel coordinates."""
    key = (pdf_hash, dpi, page_num)
    with _cache_lock:
        if key in _PAGE_WORD_CACHE:
            _PAGE_WORD_CACHE.move_to_end(key)
            return _PAGE_WORD_CACHE[key]

    scale = dpi / 72
    words = []
    try:
        for x0, y0, x1, y1, text, *_ in doc[page_num].get_text("words"):
            clean = _normalize_size_text(text)
            if not clean:
                continue
            words.append({
                "x0": float(x0) * scale,
                "y0": float(y0) * scale,
                "x1": float(x1) * scale,
                "y1": float(y1) * scale,
                "cx": float(x0 + x1) * scale / 2,
                "cy": float(y0 + y1) * scale / 2,
                "text": clean,
            })
    except Exception as exc:
        logger.debug("Piping MTO: text word extraction failed on page %d: %s", page_num + 1, exc)

    with _cache_lock:
        if key not in _PAGE_WORD_CACHE:
            if len(_PAGE_WORD_CACHE) >= _PAGE_WORD_CACHE_MAX:
                _PAGE_WORD_CACHE.popitem(last=False)
            _PAGE_WORD_CACHE[key] = words
    return words


def _candidate_size_phrases(words: list[dict]) -> list[dict]:
    phrases = []
    by_line: list[list[dict]] = []
    for word in sorted(words, key=lambda w: (w["cy"], w["x0"])):
        for line in by_line:
            if abs(line[0]["cy"] - word["cy"]) <= 8:
                line.append(word)
                break
        else:
            by_line.append([word])

    for line in by_line:
        line.sort(key=lambda w: w["x0"])
        for i, word in enumerate(line):
            for length in (1, 2, 3):
                chunk = line[i:i + length]
                if len(chunk) != length:
                    continue
                if length > 1:
                    gaps = [chunk[j + 1]["x0"] - chunk[j]["x1"] for j in range(len(chunk) - 1)]
                    if any(gap > 22 for gap in gaps):
                        continue
                text = "".join(w["text"] for w in chunk) if length == 1 else " ".join(w["text"] for w in chunk)
                size = _size_from_text(text)
                if not size:
                    continue
                phrases.append({
                    "size": size,
                    "source": text,
                    "sourceType": "line_number" if _LINE_SIZE_RE.match(_normalize_size_text(text).replace(" ", "")) else "standalone",
                    "x0": min(w["x0"] for w in chunk),
                    "y0": min(w["y0"] for w in chunk),
                    "x1": max(w["x1"] for w in chunk),
                    "y1": max(w["y1"] for w in chunk),
                    "cx": sum(w["cx"] for w in chunk) / len(chunk),
                    "cy": sum(w["cy"] for w in chunk) / len(chunk),
                })
    return phrases


def _size_candidate_score(match: list, phrase: dict) -> float | None:
    x1, y1, x2, y2 = match[:4]
    cx = (x1 + x2) / 2
    cy = (y1 + y2) / 2
    width = max(1.0, x2 - x1)
    height = max(1.0, y2 - y1)
    is_horizontal = width > height * 1.2

    horizontal_gap = max(0.0, x1 - phrase["x1"], phrase["x0"] - x2)
    vertical_gap = max(0.0, y1 - phrase["y1"], phrase["y0"] - y2)
    center_dx = abs(phrase["cx"] - cx)
    center_dy = abs(phrase["cy"] - cy)
    x_overlap = max(0.0, min(x2, phrase["x1"]) - max(x1, phrase["x0"]))
    y_overlap = max(0.0, min(y2, phrase["y1"]) - max(y1, phrase["y0"]))
    x_overlap_ratio = x_overlap / width
    y_overlap_ratio = y_overlap / height

    if is_horizontal:
        # Horizontal valves commonly carry size text just above/below the body
        # or immediately beside the pipe connection. Keep the search local.
        if horizontal_gap > max(90.0, width * 1.6):
            return None
        if vertical_gap > max(75.0, height * 2.5):
            return None
        score = horizontal_gap * 1.2 + vertical_gap * 1.8 + center_dx * 0.18 + center_dy * 0.28
        if x_overlap_ratio > 0.15:
            score -= 35
        if y_overlap_ratio > 0.20:
            score -= 15
    else:
        # Vertical valves usually have the size at left/right of the symbol on
        # roughly the same elevation. Text far above/below is often another item.
        if horizontal_gap > max(145.0, width * 4.2):
            return None
        if vertical_gap > max(70.0, height * 1.1):
            return None
        score = horizontal_gap * 1.0 + center_dy * 2.35 + center_dx * 0.08
        if y_overlap_ratio > 0.20:
            score -= 45
        if phrase["x1"] <= x1 or phrase["x0"] >= x2:
            score -= 18

    # A direct size label like 2" should win over a line-number prefix if both
    # are nearby; line-number size is useful fallback evidence, not first choice.
    if phrase.get("sourceType") == "line_number":
        score += 70
    return max(0.0, score)


def _rank_size_candidates_for_match(match: list, words: list[dict]) -> list[dict]:
    """Return ranked nearby pipe-size candidates for a detected component."""
    phrases = _candidate_size_phrases(words)
    if not phrases:
        return []

    candidates = []
    for phrase in phrases:
        score = _size_candidate_score(match, phrase)
        if score is None:
            continue
        confidence = max(0.35, min(0.99, 1.0 - score / 220.0))
        candidates.append({
            "size": phrase["size"],
            "source": phrase["source"],
            "sourceType": phrase.get("sourceType", ""),
            "score": round(float(score), 2),
            "confidence": round(float(confidence), 3),
            "x0": round(float(phrase["x0"]), 1),
            "y0": round(float(phrase["y0"]), 1),
            "x1": round(float(phrase["x1"]), 1),
            "y1": round(float(phrase["y1"]), 1),
        })
    candidates.sort(key=lambda item: item["score"])
    return candidates


def _nearest_size_for_match(match: list, words: list[dict]) -> tuple[str, str, float]:
    """Find the closest pipe-size text beside a detected component."""
    candidates = _rank_size_candidates_for_match(match, words)
    if not candidates:
        return "", "", 0.0
    best = candidates[0]
    confidence = best["confidence"]
    if len(candidates) > 1:
        second = candidates[1]
        if second["size"] != best["size"] and second["score"] - best["score"] <= 22:
            confidence = min(confidence, 0.64)
    return best["size"], best["source"], round(confidence, 3)


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


def _to_ink_binary(gray: np.ndarray) -> np.ndarray:
    """Return a 0/1 black-ink mask for exact component matching."""
    blurred = cv2.GaussianBlur(gray, (3, 3), 0)
    _, binary = cv2.threshold(blurred, 0, 1, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    return binary.astype(np.uint8)


def _remove_small_ink(binary: np.ndarray, min_area: int = 3) -> np.ndarray:
    """Remove isolated scan/JPEG speckles from a binary ink mask."""
    if binary.size == 0:
        return binary
    n, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
    clean = np.zeros_like(binary)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            clean[labels == i] = 1
    return clean


def _suppress_straight_pipe_runs(binary: np.ndarray, line_len: Optional[int] = None) -> np.ndarray:
    """
    Remove long straight pipe-line strokes from an ink mask.

    Piping components are often captured with small pipe stubs. If those stubs remain,
    a plain pixel matcher can lock onto repeated pipe runs instead of the valve/body.
    This keeps the distinctive component geometry while dropping long horizontal and
    vertical line fragments from both the template and the drawing page.
    """
    if binary.size == 0:
        return binary

    h, w = binary.shape
    if line_len is None:
        line_len = max(10, min(26, int(round(min(h, w) * 0.30))))

    horizontal_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (max(3, line_len), 1))
    vertical_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (1, max(3, line_len)))
    horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN, horizontal_kernel)
    vertical = cv2.morphologyEx(binary, cv2.MORPH_OPEN, vertical_kernel)
    straight_runs = cv2.bitwise_or(horizontal, vertical)
    if straight_runs.sum() == 0:
        return binary
    return cv2.bitwise_and(binary, cv2.bitwise_not(straight_runs))


def _to_component_binary(
    gray: np.ndarray,
    remove_speckles: bool = True,
    suppress_pipe_runs: bool = False,
) -> np.ndarray:
    """Return a cleaned component-ink mask for exact MTO matching."""
    binary = _to_ink_binary(gray)
    if remove_speckles:
        binary = _remove_small_ink(binary)
    if suppress_pipe_runs:
        binary = _suppress_straight_pipe_runs(binary)
    if remove_speckles:
        binary = _remove_small_ink(binary)
    return binary


def _trim_to_ink(binary: np.ndarray, pad: int = 2) -> np.ndarray:
    """Trim blank crop margins so accidental whitespace/pipe tails do not dominate matching."""
    ys, xs = np.nonzero(binary)
    if len(xs) == 0 or len(ys) == 0:
        return binary
    y1 = max(0, int(ys.min()) - pad)
    y2 = min(binary.shape[0], int(ys.max()) + pad + 1)
    x1 = max(0, int(xs.min()) - pad)
    x2 = min(binary.shape[1], int(xs.max()) + pad + 1)
    return binary[y1:y2, x1:x2]


def _window_sums(region_binary: np.ndarray, th: int, tw: int) -> np.ndarray:
    integral = cv2.integral(region_binary.astype(np.float32))
    return (
        integral[th:, tw:]
        - integral[:-th, tw:]
        - integral[th:, :-tw]
        + integral[:-th, :-tw]
    )


def _pick_template_anchors(tmpl_binary: np.ndarray, anchor_count: int = 24) -> np.ndarray:
    ys, xs = np.nonzero(tmpl_binary)
    if len(xs) <= anchor_count:
        return np.column_stack([ys, xs])

    # Spread anchors across the ink path so straight-line noise cannot dominate.
    order = np.lexsort((xs, ys))
    indices = np.linspace(0, len(order) - 1, anchor_count, dtype=np.int32)
    selected = order[indices]
    return np.column_stack([ys[selected], xs[selected]])


def _match_template_exact(tmpl_binary: np.ndarray, region_binary: np.ndarray, threshold: float, ox: int = 0, oy: int = 0) -> list:
    """
    Pixel/ink exact matcher.

    This intentionally does not rotate, blur, ORB-fallback, or broad-scale the template.
    It scores each candidate by both:
    - template recall: how much of the captured component ink is present
    - window precision: how much extra ink exists in the target window
    The final score is the stricter of those two, so noisy/partial matches are rejected.
    """
    tmpl_binary = _trim_to_ink(_remove_small_ink(tmpl_binary))
    th, tw = tmpl_binary.shape
    rh, rw = region_binary.shape
    tmpl_ink = float(tmpl_binary.sum())
    if th < 4 or tw < 4 or tmpl_ink < 6:
        raise ValueError("Captured component has too little usable ink. Re-capture tighter around the item.")
    if th >= rh or tw >= rw:
        return []

    out_h = rh - th + 1
    out_w = rw - tw + 1
    votes = np.zeros((out_h, out_w), dtype=np.uint16)
    region_ys, region_xs = np.nonzero(region_binary)
    anchors = _pick_template_anchors(tmpl_binary)
    for ay, ax in anchors:
        cand_y = region_ys - int(ay)
        cand_x = region_xs - int(ax)
        valid = (cand_y >= 0) & (cand_x >= 0) & (cand_y < out_h) & (cand_x < out_w)
        np.add.at(votes, (cand_y[valid], cand_x[valid]), 1)

    min_votes = max(3, int(np.ceil(len(anchors) * max(0.35, min(0.75, threshold - 0.15)))))
    ys, xs = np.nonzero(votes >= min_votes)
    if len(xs) == 0:
        return []
    if len(xs) > 5000:
        flat = votes[ys, xs]
        keep = np.argpartition(flat, -5000)[-5000:]
        ys = ys[keep]
        xs = xs[keep]

    integral = cv2.integral(region_binary.astype(np.float32))
    raw = []
    for y, x in zip(ys, xs):
        overlap = int((region_binary[y:y + th, x:x + tw] & tmpl_binary).sum())
        if overlap == 0:
            continue
        window_ink = float(
            integral[y + th, x + tw]
            - integral[y, x + tw]
            - integral[y + th, x]
            + integral[y, x]
        )
        recall = overlap / max(tmpl_ink, 1.0)
        precision = overlap / max(window_ink, 1.0)
        score = min(recall, precision)
        if score >= threshold:
            raw.append([int(x + ox), int(y + oy), int(x + ox + tw), int(y + oy + th), float(score)])
    if len(raw) > 2000:
        raw.sort(key=lambda b: b[4], reverse=True)
        raw = raw[:2000]
    return raw


def _match_template_exact_with_rotations(
    tmpl_binary: np.ndarray,
    region_binary: np.ndarray,
    threshold: float,
    ox: int = 0,
    oy: int = 0,
) -> list:
    """Exact ink matching with right-angle rotations for horizontal/vertical component reuse."""
    raw = []
    seen_shapes = set()
    for tmpl in (
        tmpl_binary,
        cv2.rotate(tmpl_binary, cv2.ROTATE_90_CLOCKWISE),
        cv2.rotate(tmpl_binary, cv2.ROTATE_90_COUNTERCLOCKWISE),
        cv2.rotate(tmpl_binary, cv2.ROTATE_180),
    ):
        key = (tmpl.shape, int(tmpl.sum()))
        if key in seen_shapes:
            continue
        seen_shapes.add(key)
        raw.extend(_match_template_exact(tmpl, region_binary, threshold, ox, oy))
    return raw


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


def _is_valve_like_label(label: str) -> bool:
    upper = (label or "").upper()
    return any(token in upper for token in _VALVE_GEOMETRY_LABELS)


def _synthetic_valve_templates() -> list[np.ndarray]:
    """Build simple EPC valve-geometry templates used as a recall booster."""
    templates = []

    def add_horizontal_bowtie(w: int, h: int) -> None:
        pad = 10
        img = np.zeros((h + pad * 2, w + pad * 2), dtype=np.uint8)
        x0, y0 = pad, pad
        x1, y1 = pad + w, pad + h
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        thickness = max(1, round(min(w, h) / 12))

        # Horizontal valve on a pipe run: side bars, opposing triangles, center ball,
        # and short pipe stubs. Keep this unboxed; boxed X/DBB components are a
        # different item family and must not inflate ball-valve counts.
        cv2.line(img, (x0 - pad // 2, cy), (x0, cy), 255, thickness)
        cv2.line(img, (x1, cy), (x1 + pad // 2, cy), 255, thickness)
        cv2.line(img, (x0, y0), (x0, y1), 255, thickness)
        cv2.line(img, (x1, y0), (x1, y1), 255, thickness)
        cv2.line(img, (x0, y0), (cx, cy), 255, thickness)
        cv2.line(img, (x0, y1), (cx, cy), 255, thickness)
        cv2.line(img, (x1, y0), (cx, cy), 255, thickness)
        cv2.line(img, (x1, y1), (cx, cy), 255, thickness)
        cv2.circle(img, (cx, cy), max(2, h // 4), 255, thickness)
        templates.append(img)

    for w, h in ((18, 42), (22, 52), (28, 64), (34, 78)):
        pad = 8
        img = np.zeros((h + pad * 2, w + pad * 2), dtype=np.uint8)
        x0, y0 = pad, pad
        x1, y1 = pad + w, pad + h
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        thickness = max(1, round(min(w, h) / 16))

        # Body rectangle and opposing triangles/hourglass.
        cv2.rectangle(img, (x0, y0), (x1, y1), 255, thickness)
        cv2.line(img, (x0, y0), (x1, cy), 255, thickness)
        cv2.line(img, (x1, cy), (x0, y1), 255, thickness)
        cv2.line(img, (x1, y0), (x0, cy), 255, thickness)
        cv2.line(img, (x0, cy), (x1, y1), 255, thickness)
        cv2.line(img, (cx, y0 - pad // 2), (cx, y0), 255, thickness)
        cv2.line(img, (cx, y1), (cx, y1 + pad // 2), 255, thickness)
        cv2.circle(img, (cx, cy), max(2, w // 5), 255, thickness)
        templates.append(img)
        templates.append(cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE))

        bowtie = np.zeros_like(img)
        cv2.line(bowtie, (x0, y0), (x1, cy), 255, thickness)
        cv2.line(bowtie, (x1, cy), (x0, y1), 255, thickness)
        cv2.line(bowtie, (x1, y0), (x0, cy), 255, thickness)
        cv2.line(bowtie, (x0, cy), (x1, y1), 255, thickness)
        cv2.line(bowtie, (cx, y0 - pad // 2), (cx, y0), 255, thickness)
        cv2.line(bowtie, (cx, y1), (cx, y1 + pad // 2), 255, thickness)
        templates.append(bowtie)
        templates.append(cv2.rotate(bowtie, cv2.ROTATE_90_CLOCKWISE))

    return templates


_VALVE_TEMPLATES = _synthetic_valve_templates()


def _geometry_valve_candidates(gray: np.ndarray, label: str, threshold: float = 0.56) -> list:
    """
    Synthetic valve-geometry recall booster.

    It searches for common bow-tie/hourglass valve shapes independent of the
    user's captured template. Scores are capped below high-confidence template
    matches so downstream review can treat them as candidates, not proof.
    """
    if not _is_valve_like_label(label):
        return []

    edges = _to_edges(gray)
    region_soft = _soften_edges(edges)
    raw = []
    for tmpl in _VALVE_TEMPLATES:
        th, tw = tmpl.shape
        if th >= gray.shape[0] or tw >= gray.shape[1]:
            continue
        tmpl_soft = _soften_edges(tmpl)
        result = cv2.matchTemplate(region_soft, tmpl_soft, cv2.TM_CCOEFF_NORMED)
        ys, xs = np.nonzero(result >= threshold)
        for y, x in zip(ys, xs):
            score = min(0.74, 0.55 + float(result[y, x]) * 0.30)
            raw.append([int(x), int(y), int(x + tw), int(y + th), score])

    if len(raw) > 1200:
        raw.sort(key=lambda b: b[4], reverse=True)
        raw = raw[:1200]
    return _nms(raw, iou_threshold=0.18)


def _fetch_page_valve_geometry(gray: np.ndarray, label: str, pdf_hash: str, dpi: int, page_num: int) -> list:
    if not _is_valve_like_label(label):
        return []
    key = (pdf_hash, dpi, page_num)
    with _cache_lock:
        if key in _PAGE_VALVE_GEOMETRY_CACHE:
            _PAGE_VALVE_GEOMETRY_CACHE.move_to_end(key)
            return _PAGE_VALVE_GEOMETRY_CACHE[key]

    geometry = _geometry_valve_candidates(gray, label)
    with _cache_lock:
        if key not in _PAGE_VALVE_GEOMETRY_CACHE:
            if len(_PAGE_VALVE_GEOMETRY_CACHE) >= _PAGE_VALVE_GEOMETRY_CACHE_MAX:
                _PAGE_VALVE_GEOMETRY_CACHE.popitem(last=False)
            _PAGE_VALVE_GEOMETRY_CACHE[key] = geometry
    return geometry


def _merge_geometry_candidates(matches: list, gray: np.ndarray, label: str, pdf_hash: str, dpi: int, page_num: int) -> list:
    geometry = _fetch_page_valve_geometry(gray, label, pdf_hash, dpi, page_num)
    if not geometry:
        return matches
    return _nms([*matches, *geometry], iou_threshold=0.2)


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


def _enrich_matches_with_sizes(matches: list, doc: "fitz.Document", page_num: int, dpi: int, pdf_hash: str) -> list:
    words = _fetch_page_words(doc, page_num, dpi, pdf_hash)
    result = []
    for match in matches:
        item = {"x1": int(match[0]), "y1": int(match[1]), "x2": int(match[2]), "y2": int(match[3]), "score": round(match[4], 3)}
        candidates = _rank_size_candidates_for_match(match, words)
        size, source, confidence = _nearest_size_for_match(match, words)
        if size:
            item["sizeInch"] = size
            item["sizeSource"] = source
            item["sizeConfidence"] = confidence
            item["sizeSourceType"] = candidates[0].get("sourceType", "") if candidates else ""
        if candidates:
            item["sizeCandidates"] = candidates[:5]
            item["nearbyText"] = [candidate["source"] for candidate in candidates[:5]]
            if len(candidates) > 1:
                alternatives = [candidate for candidate in candidates[1:] if candidate["size"] != size]
                if alternatives and alternatives[0]["score"] - candidates[0]["score"] <= 22:
                    item["sizeAmbiguous"] = True
        result.append(item)
    return result


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
    match_mode: str = "tolerant",
) -> dict:
    """
    Find all instances of a template symbol within a P&ID page.

    template_box / search_box are in coord_dpi pixel space (preview DPI).
    Detection renders the page at dpi and scales coordinates accordingly.
    """
    exact_mode = match_mode == "exact"
    if exact_mode:
        dpi = min(coord_dpi, _EXACT_MATCH_DPI_MAX)
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

    tmpl_e = _to_component_binary(tmpl) if exact_mode else _to_edges(tmpl)
    region_e = _to_component_binary(region, remove_speckles=False) if exact_mode else _to_edges(region)

    raw = (
        _match_template_exact_with_rotations(tmpl_e, region_e, threshold, ox, oy)
        if exact_mode
        else _match_template_on_region(tmpl_e, region_e, threshold, ox, oy)
    )
    matches = _nms(raw, iou_threshold=0.2)
    pdf_hash = _pdf_hash(pdf_bytes)
    if search_box is None:
        matches = _merge_geometry_candidates(matches, gray, label, pdf_hash, dpi, 0)
    logger.info("Piping MTO: %d '%s' matches (threshold=%.2f)", len(matches), label, threshold)
    text_doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    match_dicts = _enrich_matches_with_sizes(matches, text_doc, 0, dpi, pdf_hash)
    text_doc.close()

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
        "matches": match_dicts,
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
    match_mode: str = "tolerant",
) -> dict:
    """
    Detect a symbol across every page using a pre-saved template image (PNG/JPEG bytes).
    template_dpi is the DPI at which the template crop was made (always the preview DPI).
    dpi is the rendering DPI for detection — lower = faster.
    Pages are preprocessed (bilateral + CLAHE + deskew) and cached across symbol searches.
    """
    exact_mode = match_mode == "exact"
    if exact_mode:
        dpi = min(template_dpi, _EXACT_MATCH_DPI_MAX)
    arr = np.frombuffer(template_bytes, dtype=np.uint8)
    tmpl = cv2.imdecode(arr, cv2.IMREAD_GRAYSCALE)
    if tmpl is None:
        raise ValueError("Could not decode template image.")

    if template_dpi != dpi:
        scale = dpi / template_dpi
        new_h = max(4, int(round(tmpl.shape[0] * scale)))
        new_w = max(4, int(round(tmpl.shape[1] * scale)))
        tmpl = cv2.resize(tmpl, (new_w, new_h), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)

    tmpl_e = _to_component_binary(tmpl) if exact_mode else _to_edges(tmpl)

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

        region_e = (
            _fetch_page_component_binary(doc, page_num, dpi, pdf_hash)
            if exact_mode
            else _to_edges(gray)
        )
        raw = (
            _match_template_exact_with_rotations(tmpl_e, region_e, threshold)
            if exact_mode
            else _match_template_on_region(tmpl_e, region_e, threshold)
        )
        matches = _nms(raw, iou_threshold=0.2)
        matches = _merge_geometry_candidates(matches, gray, label, pdf_hash, dpi, page_num)

        if not matches and not exact_mode:
            orb_raw = _orb_fallback(tmpl, gray)
            if orb_raw:
                matches = _nms(orb_raw, iou_threshold=0.3)
                logger.info("Page %d: ORB fallback found %d '%s' candidates", page_num + 1, len(matches), label)

        match_dicts = _enrich_matches_with_sizes(matches, doc, page_num, dpi, pdf_hash)
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
    match_mode: str = "tolerant",
) -> dict:
    """
    Detect a symbol across every page of the PDF.
    Template is extracted from page 1. coord_dpi is the preview DPI (always 300).
    Pages are preprocessed (bilateral + CLAHE + deskew) and cached across symbol searches.
    """
    exact_mode = match_mode == "exact"
    if exact_mode:
        dpi = min(coord_dpi, _EXACT_MATCH_DPI_MAX)
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

    tmpl_gray_for_orb = page1_gray[ty1:ty2, tx1:tx2]
    tmpl_e = _to_component_binary(tmpl_gray_for_orb) if exact_mode else _to_edges(tmpl_gray_for_orb)

    pages_data = []
    page1_match_dicts: list = []
    total_count = 0

    for page_num in range(n_pages):
        gray = _fetch_page_gray(doc, page_num, dpi, pdf_hash)
        region_e = (
            _fetch_page_component_binary(doc, page_num, dpi, pdf_hash)
            if exact_mode
            else _to_edges(gray)
        )
        raw = (
            _match_template_exact_with_rotations(tmpl_e, region_e, threshold)
            if exact_mode
            else _match_template_on_region(tmpl_e, region_e, threshold)
        )
        matches = _nms(raw, iou_threshold=0.2)
        matches = _merge_geometry_candidates(matches, gray, label, pdf_hash, dpi, page_num)

        if not matches and not exact_mode:
            orb_raw = _orb_fallback(tmpl_gray_for_orb, gray)
            if orb_raw:
                matches = _nms(orb_raw, iou_threshold=0.3)
                logger.info("Page %d: ORB fallback found %d '%s' candidates", page_num + 1, len(matches), label)

        match_dicts = _enrich_matches_with_sizes(matches, doc, page_num, dpi, pdf_hash)
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
