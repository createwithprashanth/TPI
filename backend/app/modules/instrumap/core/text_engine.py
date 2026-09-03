# TPI/app/modules/instrumap/core/text_engine.py

import logging
import math
import importlib.util
import os
import shutil
from collections import Counter
import numpy as np
from PIL import Image as _PILImage, ImageEnhance as _PILImageEnhance, ImageOps as _ImageOps
from .standard_library import InstrumentLogicEngine

# Tile size for large-image OCR.  Images wider/taller than this threshold are
# split into overlapping tiles so PaddleOCR runs at full resolution on each
# tile (no internal downscaling).  Each tile must be ≤ PaddleOCR's 4000 px cap.
_OCR_TILE_THRESHOLD = 4000   # trigger tiling above this px
_OCR_TILE_SIZE      = 3800   # tile dimensions (px) — just under the 4000 cap
_OCR_TILE_OVERLAP   = 380    # overlap (px) so text at tile edges is captured

logger = logging.getLogger(__name__)

# Lazy-initialised PaddleOCR reader — loaded once per worker process.
_ocr_reader = None
_recognition_reader = None

def _get_reader():
    global _ocr_reader
    if _ocr_reader is None:
        import ssl
        ssl._create_default_https_context = ssl._create_unverified_context
        from paddleocr import PaddleOCR
        logger.info("Initialising PaddleOCR reader (first call)...")
        _ocr_reader = PaddleOCR(
            enable_mkldnn=False,
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            text_detection_model_name='PP-OCRv5_mobile_det',
            text_recognition_model_name='en_PP-OCRv5_mobile_rec',
            lang='en',
        )
        logger.info("PaddleOCR reader ready.")
    return _ocr_reader


def _get_recognizer():
    global _recognition_reader
    if _recognition_reader is None:
        from paddleocr import TextRecognition
        logger.info("Initialising lightweight text recognizer...")
        _recognition_reader = TextRecognition(
            model_name="en_PP-OCRv5_mobile_rec",
            enable_mkldnn=False,
        )
    return _recognition_reader

# --- TUNING CONSTANTS ---
TEXT_MINING_MAX_X_DIST = 40  # Looser X-tolerance for center-aligned text
TEXT_MINING_MAX_Y_GAP = 90   # Loose Y-tolerance for gaps

# The "Blacklist"
STOPWORDS = {
    "FOR", "AND", "THE", "SEE", "DWG", "REF", "TYP", "MIN", "MAX",
    "HOT", "COLD", "AIR", "GAS", "OIL", "DRY", "WET", "IN", "OUT",
    "OFF", "ON", "SET", "TAP", "TOP", "BOT", "REV", "NOT", "YES",
    "ALL", "EQUIPMENT", "INSTRUMENT", "TAG", "NOS", "DRAWING", "SHALL",
    "AREA", "CODE", "PLANT", "SPECIFIED", "OTHER", "WISE", "NOTE", "NOTES",
    "DETAIL", "SECTION", "GENERAL", "LEGEND", "SYMBOL", "PIPING",
    "AS", "AFTER", "BEFORE", "WITH", "WITHOUT", "FROM",
    "NC", "NO", "LC", "LO", "FC", "FO", "CS", "SS", "SP", "HL", "LL", "HH",
    "BY", "OF", "OR", "BE", "IS", "AT", "TO", "UP", "DN",
}

def _ocr_tile(reader, tile_img, x_offset, y_offset):
    """Run PaddleOCR on one tile and return words in page coordinate space."""
    import warnings
    img_array = np.array(tile_img.convert('RGB'))
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        results = reader.predict(img_array)
    words = []
    if not results:
        return words
    for page_result in results:
        texts = page_result.get('rec_texts', [])
        polys = page_result.get('rec_polys', [])
        for text, poly in zip(texts, polys):
            text = str(text).strip()
            if not text:
                continue
            xs = poly[:, 0].astype(float) + x_offset
            ys = poly[:, 1].astype(float) + y_offset
            x_min, x_max = xs.min(), xs.max()
            y_min, y_max = ys.min(), ys.max()
            words.append({
                'text': text,
                'x': x_min, 'y': y_min,
                'w': x_max - x_min, 'h': y_max - y_min,
                'center_x': (x_min + x_max) / 2,
                'center_y': (y_min + y_max) / 2,
            })
    return words


def _dedup_words(words, proximity=25):
    """Remove duplicate detections from overlapping tile regions."""
    unique = []
    for w in words:
        cx, cy, t = w['center_x'], w['center_y'], w['text'].lower()
        if not any(
            abs(cx - u['center_x']) < proximity
            and abs(cy - u['center_y']) < proximity
            and t == u['text'].lower()
            for u in unique
        ):
            unique.append(w)
    return unique


def _tesseract_command():
    """Resolve Tesseract without requiring a shell or VM restart."""
    discovered = shutil.which("tesseract")
    if discovered:
        return discovered
    candidates = [
        os.path.join(os.environ.get("LOCALAPPDATA", ""), "Programs", "Tesseract-OCR", "tesseract.exe"),
        os.path.join(os.environ.get("ProgramFiles", ""), "Tesseract-OCR", "tesseract.exe"),
    ]
    return next((path for path in candidates if path and os.path.isfile(path)), None)


def _tesseract_tile(tile_img, x_offset, y_offset, ocr_scale=2.0, page_mode=11):
    import pytesseract
    from pytesseract import Output

    command = _tesseract_command()
    if not command:
        raise RuntimeError("Tesseract executable was not found")
    pytesseract.pytesseract.tesseract_cmd = command
    # P&ID bubble text is extremely small relative to an A1/A0 sheet. Upscale
    # and normalize each tile for OCR, then map boxes back to page coordinates.
    rgb = np.asarray(tile_img.convert("RGB"), dtype=np.uint8)
    # Revision clouds/markup are strongly coloured while original CAD text is
    # neutral gray. Removing chromatic pixels prevents red cloud arcs from
    # dominating contrast normalization on otherwise very pale drawings.
    chroma = rgb.max(axis=2).astype(np.int16) - rgb.min(axis=2).astype(np.int16)
    gray = rgb.mean(axis=2).astype(np.uint8)
    gray[chroma > 24] = 255
    prepared = _ImageOps.autocontrast(_PILImage.fromarray(gray), cutoff=1)
    prepared = prepared.resize(
        (round(prepared.width * ocr_scale), round(prepared.height * ocr_scale)),
        _PILImage.Resampling.LANCZOS,
    )
    data = pytesseract.image_to_data(
        prepared,
        lang="eng",
        config=f"--oem 1 --psm {page_mode} -c preserve_interword_spaces=1",
        output_type=Output.DICT,
    )
    words = []
    for i, text in enumerate(data.get("text", [])):
        text = str(text).strip()
        try:
            confidence = float(data["conf"][i])
        except (TypeError, ValueError, KeyError, IndexError):
            confidence = -1
        if not text or confidence < 20:
            continue
        x = float(data["left"][i]) / ocr_scale + x_offset
        y = float(data["top"][i]) / ocr_scale + y_offset
        width = float(data["width"][i]) / ocr_scale
        height = float(data["height"][i]) / ocr_scale
        words.append({
            "text": text,
            "x": x,
            "y": y,
            "w": width,
            "h": height,
            "center_x": x + width / 2,
            "center_y": y + height / 2,
        })
    return words


def detect_text_region(pil_image, left, top, right, bottom):
    """Read one small instrument bubble at high magnification."""
    left = max(0, int(left))
    top = max(0, int(top))
    right = min(pil_image.width, int(right))
    bottom = min(pil_image.height, int(bottom))
    if right <= left or bottom <= top:
        return []
    crop = pil_image.crop((left, top, right, bottom))
    if importlib.util.find_spec("paddleocr") is not None:
        # Full-sheet Paddle detection is too memory-heavy for the shared VM.
        # A padded 4x bubble crop gives the recognizer enough pixels for all
        # stacked rows while keeping memory bounded.
        border = 20
        scale = 4.0
        prepared = _ImageOps.expand(crop.convert("RGB"), border=border, fill="white")
        prepared = prepared.resize(
            (round(prepared.width * scale), round(prepared.height * scale)),
            _PILImage.Resampling.LANCZOS,
        )
        focused = _ocr_tile(_get_reader(), prepared, 0, 0)
        for word in focused:
            word["x"] = word["x"] / scale - border + left
            word["y"] = word["y"] / scale - border + top
            word["w"] /= scale
            word["h"] /= scale
            word["center_x"] = word["x"] + word["w"] / 2
            word["center_y"] = word["y"] + word["h"] / 2
            word["focused_bubble_ocr"] = True
        return focused
    return _tesseract_tile(crop, left, top, ocr_scale=6.0, page_mode=6)


def detect_text_regions(pil_image, regions):
    """Read multiple bubble crops in a few bounded Paddle contact sheets."""
    if not regions:
        return []
    if importlib.util.find_spec("paddleocr") is None:
        return [detect_text_region(pil_image, *region) for region in regions]

    scale, border, columns, batch_size = 2.5, 16, 4, 12
    outputs = [[] for _ in regions]
    for batch_start in range(0, len(regions), batch_size):
        batch = regions[batch_start:batch_start + batch_size]
        prepared = []
        cell_w = cell_h = 0
        for left, top, right, bottom in batch:
            left, top = max(0, int(left)), max(0, int(top))
            right, bottom = min(pil_image.width, int(right)), min(pil_image.height, int(bottom))
            crop = pil_image.crop((left, top, right, bottom)).convert("RGB")
            crop = _ImageOps.expand(crop, border=border, fill="white")
            crop = crop.resize((round(crop.width * scale), round(crop.height * scale)), _PILImage.Resampling.LANCZOS)
            prepared.append((crop, left, top))
            cell_w, cell_h = max(cell_w, crop.width), max(cell_h, crop.height)
        rows = math.ceil(len(prepared) / columns)
        sheet = _PILImage.new("RGB", (cell_w * columns, cell_h * rows), "white")
        for index, (crop, _, _) in enumerate(prepared):
            sheet.paste(crop, ((index % columns) * cell_w, (index // columns) * cell_h))
        for word in _ocr_tile(_get_reader(), sheet, 0, 0):
            col, row = int(word["center_x"] // cell_w), int(word["center_y"] // cell_h)
            local_index = row * columns + col
            if local_index >= len(prepared):
                continue
            _, left, top = prepared[local_index]
            ox, oy = col * cell_w, row * cell_h
            word["x"] = (word["x"] - ox) / scale - border + left
            word["y"] = (word["y"] - oy) / scale - border + top
            word["w"], word["h"] = word["w"] / scale, word["h"] / scale
            word["center_x"] = word["x"] + word["w"] / 2
            word["center_y"] = word["y"] + word["h"] / 2
            word["focused_bubble_ocr"] = True
            outputs[batch_start + local_index].append(word)
    return outputs


def detect_text_region_discovery(pil_image, left, top, right, bottom):
    """Quick, bounded-memory OCR used to decide whether a circle contains a tag."""
    left = max(0, int(left))
    top = max(0, int(top))
    right = min(pil_image.width, int(right))
    bottom = min(pil_image.height, int(bottom))
    if right <= left or bottom <= top or not _tesseract_command():
        return []
    crop = pil_image.crop((left, top, right, bottom))
    focused = _tesseract_tile(crop, left, top, ocr_scale=8.0, page_mode=11)
    for word in focused:
        word["focused_bubble_ocr"] = True
    return focused


def detect_numeric_bubble_rows(pil_image, center_x, center_y, radius):
    """Read the numeric loop and suffix from fixed bands in a round ISA bubble."""
    import pytesseract

    command = _tesseract_command()
    if not command:
        return "", ""
    pytesseract.pytesseract.tesseract_cmd = command

    def read_band(y_low, y_high, half_width):
        left = max(0, int(center_x - radius * half_width))
        right = min(pil_image.width, int(center_x + radius * half_width))
        top = max(0, int(center_y + radius * y_low))
        bottom = min(pil_image.height, int(center_y + radius * y_high))
        if right <= left or bottom <= top:
            return ""
        crop = pil_image.crop((left, top, right, bottom)).convert("RGB")
        rgb = np.asarray(crop, dtype=np.uint8)
        chroma = rgb.max(axis=2).astype(np.int16) - rgb.min(axis=2).astype(np.int16)
        gray = rgb.mean(axis=2).astype(np.uint8)
        gray[chroma > 24] = 255
        prepared = _ImageOps.autocontrast(_PILImage.fromarray(gray), cutoff=1)
        prepared = prepared.resize(
            (prepared.width * 10, prepared.height * 10),
            _PILImage.Resampling.LANCZOS,
        )
        text = pytesseract.image_to_string(
            prepared,
            lang="eng",
            config="--oem 1 --psm 7 -c tessedit_char_whitelist=0123456789",
        )
        return "".join(char for char in text if char.isdigit())

    readings = []
    original_radius = radius
    for factor in (0.95, 1.0, 1.20):
        radius = original_radius * factor
        readings.append((
            read_band(-0.28, 0.35, 0.70),
            read_band(0.18, 0.90, 0.55),
        ))
    loop_candidates = [value for value, _ in readings if 3 <= len(value) <= 6]
    suffix_candidates = [value for _, value in readings if 1 <= len(value) <= 3]
    # Prefer agreement, then the structurally strongest loop/suffix length.
    loop = max(Counter(loop_candidates), key=lambda value: (Counter(loop_candidates)[value], len(value))) if loop_candidates else ""
    suffix = max(Counter(suffix_candidates), key=lambda value: (Counter(suffix_candidates)[value], len(value) == 2)) if suffix_candidates else ""
    return loop, suffix


def recognize_structured_bubbles(pil_image, circles):
    """Batch-recognize type, loop and suffix rows from known circle geometry."""
    if not circles or importlib.util.find_spec("paddleocr") is None:
        return [{} for _ in circles]
    rows, row_meta = [], []
    bands = (
        ("type", -0.95, -0.12, 0.85),
        ("loop", -0.30, 0.35, 0.78),
        ("suffix", 0.18, 0.95, 0.65),
    )
    for circle_index, (center_x, center_y, radius) in enumerate(circles):
        for field, y_low, y_high, half_width in bands:
            left = max(0, int(center_x - radius * half_width))
            right = min(pil_image.width, int(center_x + radius * half_width))
            top = max(0, int(center_y + radius * y_low))
            bottom = min(pil_image.height, int(center_y + radius * y_high))
            if right <= left or bottom <= top:
                continue
            crop = _ImageOps.autocontrast(
                pil_image.crop((left, top, right, bottom)).convert("RGB")
            )
            rows.append(np.asarray(crop))
            row_meta.append((circle_index, field))
    outputs = [{} for _ in circles]
    if not rows:
        return outputs
    predictions = _get_recognizer().predict(rows, batch_size=8)
    for (circle_index, field), prediction in zip(row_meta, predictions):
        text = str(prediction.get("rec_text", "")).upper().strip()
        score = float(prediction.get("rec_score", 0) or 0)
        if score < 0.60:
            continue
        if field == "type":
            text = "".join(char for char in text if char.isalpha())
            if not 2 <= len(text) <= 5:
                continue
        else:
            text = "".join(char for char in text if char.isdigit())
            if field == "loop" and not 3 <= len(text) <= 6:
                continue
            if field == "suffix" and not 1 <= len(text) <= 3:
                continue
        outputs[circle_index][field] = text
        outputs[circle_index][f"{field}_score"] = score

    # The bottom row is the smallest text in an ISA bubble.  If the normal
    # suffix crop was rejected, retry only those circles with a tighter band
    # that excludes the loop row and lower circle arc.  Keeping this as a
    # second, missing-only batch avoids slowing every extraction materially.
    retry_rows, retry_indices = [], []
    for circle_index, (center_x, center_y, radius) in enumerate(circles):
        if outputs[circle_index].get("suffix"):
            continue
        left = max(0, int(center_x - radius * 0.50))
        right = min(pil_image.width, int(center_x + radius * 0.50))
        top = max(0, int(center_y + radius * 0.25))
        bottom = min(pil_image.height, int(center_y + radius * 0.72))
        if right <= left or bottom <= top:
            continue
        crop = _ImageOps.autocontrast(
            pil_image.crop((left, top, right, bottom)).convert("RGB")
        )
        crop = _PILImageEnhance.Contrast(crop).enhance(2.0)
        retry_rows.append(np.asarray(crop))
        retry_indices.append(circle_index)
    if retry_rows:
        retry_predictions = _get_recognizer().predict(retry_rows, batch_size=8)
        for circle_index, prediction in zip(retry_indices, retry_predictions):
            text = "".join(
                char for char in str(prediction.get("rec_text", "")) if char.isdigit()
            )
            score = float(prediction.get("rec_score", 0) or 0)
            if 1 <= len(text) <= 3 and score >= 0.75:
                outputs[circle_index]["suffix"] = text
                outputs[circle_index]["suffix_score"] = score
                outputs[circle_index]["suffix_recovered"] = True
    return outputs


def _detect_text_tesseract(pil_image):
    """Tiled Tesseract fallback for scanned or text-flattened drawings."""
    orig_w, orig_h = pil_image.size
    if max(orig_w, orig_h) <= _OCR_TILE_THRESHOLD:
        return _tesseract_tile(pil_image, 0, 0)

    step = _OCR_TILE_SIZE - _OCR_TILE_OVERLAP

    def tile_starts(total):
        starts = list(range(0, total, step))
        if not starts or starts[-1] + _OCR_TILE_SIZE < total:
            starts.append(max(0, total - _OCR_TILE_SIZE))
        return starts

    words = []
    for y0 in tile_starts(orig_h):
        for x0 in tile_starts(orig_w):
            tile = pil_image.crop((
                x0,
                y0,
                min(x0 + _OCR_TILE_SIZE, orig_w),
                min(y0 + _OCR_TILE_SIZE, orig_h),
            ))
            words.extend(_tesseract_tile(tile, x0, y0))
    return _dedup_words(words)


def detect_text_full_page(pil_image, vision_client=None):
    """Run PaddleOCR on a full page and return word-level bounding boxes.

    Large images (> _OCR_TILE_THRESHOLD px) are split into overlapping tiles
    so PaddleOCR runs at full resolution on each tile — no internal downscaling,
    full accuracy on small circle text in high-DPI scanned P&IDs.

    vision_client parameter is kept for call-site compatibility but ignored.
    """
    try:
        # Use Tesseract for bounded-memory full-page word discovery. Paddle is
        # applied later only to magnified instrument-bubble crops.
        if _tesseract_command():
            logger.info("Using Tesseract for full-page OCR discovery")
            return _detect_text_tesseract(pil_image)
        reader = _get_reader()
        orig_w, orig_h = pil_image.size

        if max(orig_w, orig_h) <= _OCR_TILE_THRESHOLD:
            # Small image — run OCR directly (no tiling needed)
            return _ocr_tile(reader, pil_image, 0, 0)

        # Large image — tile and merge
        step = _OCR_TILE_SIZE - _OCR_TILE_OVERLAP
        all_words = []

        def _tile_starts(total):
            starts = list(range(0, total, step))
            # Ensure last tile always reaches the image edge
            if not starts or starts[-1] + _OCR_TILE_SIZE < total:
                starts.append(max(0, total - _OCR_TILE_SIZE))
            return starts

        xs_starts = _tile_starts(orig_w)
        ys_starts = _tile_starts(orig_h)
        n_tiles = len(xs_starts) * len(ys_starts)
        logger.info(f"OCR tiling: {orig_w}×{orig_h}px → {n_tiles} tiles of {_OCR_TILE_SIZE}px")

        for y0 in ys_starts:
            for x0 in xs_starts:
                x1 = min(x0 + _OCR_TILE_SIZE, orig_w)
                y1 = min(y0 + _OCR_TILE_SIZE, orig_h)
                tile = pil_image.crop((x0, y0, x1, y1))
                tile_words = _ocr_tile(reader, tile, x0, y0)
                all_words.extend(tile_words)

        return _dedup_words(all_words)

    except Exception as e:
        logger.warning(f"PaddleOCR text detection failed: {e}", exc_info=True)
        return []

def _cluster_vertically(full_text_data):
    """
    Robust 'Bucket' Clustering:
    1. Sort all words by Y (Top -> Bottom).
    2. Try to attach each word to an existing open cluster above it.
    """
    if not full_text_data: return []
    
    # Sort by Y (Top to Bottom), then X (Left to Right)
    sorted_words = sorted(full_text_data, key=lambda k: (k['y'], k['center_x']))
    
    clusters = [] # List of lists (each list is a cluster of words)
    
    for word in sorted_words:
        # Try to find a cluster this word belongs to
        best_cluster_idx = -1
        min_dist = float('inf')
        
        for idx, cluster in enumerate(clusters):
            last_word = cluster[-1]
            
            # Check Horizontal Alignment (Are they in the same 'column'?)
            x_diff = abs(word['center_x'] - last_word['center_x'])
            
            # Check Vertical Gap (Is it directly below?)
            # Gap = (Current Top) - (Previous Bottom)
            y_gap = word['y'] - (last_word['y'] + last_word['h'])
            
            if x_diff < TEXT_MINING_MAX_X_DIST and 0 <= y_gap < TEXT_MINING_MAX_Y_GAP:
                # Found a candidate! Pick the closest one in X alignment.
                if x_diff < min_dist:
                    min_dist = x_diff
                    best_cluster_idx = idx
        
        if best_cluster_idx != -1:
            # Attach to the best matching cluster
            clusters[best_cluster_idx].append(word)
        else:
            # Start a new cluster
            clusters.append([word])
            
    return clusters

def _is_duplicate_of_shape(cluster_center_x, cluster_center_y, existing_circles_indices):
    if existing_circles_indices is None: return False
    for c in existing_circles_indices[0]:
        cx, cy, cr = c[0], c[1], c[2]
        dist = math.sqrt((cluster_center_x - cx)**2 + (cluster_center_y - cy)**2)
        if dist < (cr * 1.2): return True
    return False

def find_text_only_instruments(pil_image, vision_client=None, existing_circles_indices=None, full_text_data=None):
    if full_text_data is None:
        full_text_data = detect_text_full_page(pil_image)
    clusters = _cluster_vertically(full_text_data)
    
    text_instruments = []
    
    for cluster in clusters:
        # 1. Reject single words (Noise) - Tags are usually stacked (Type/Loop)
        # Exception: "PIT-101" might be 1 line. So check length.
        # But for your case (3-row tag), cluster size must be > 1? 
        # No, let's allow size 1 if it contains a dash.
        if len(cluster) > 4: continue 
        
        raw_text_parts = [w['text'] for w in cluster]
        candidate_tag = "-".join(raw_text_parts)
        
        # --- FILTERS ---
        if len(candidate_tag) < 3: continue
        
        # Stopword Check (First part)
        first_part = raw_text_parts[0]
        if first_part.upper() in STOPWORDS: continue
        
        # Type Check: Must start with Letter (Kills "11-11-08")
        if not first_part[0].isalpha(): continue
        
        # Digit Check: Must have number
        if not any(char.isdigit() for char in candidate_tag): continue
        
        # Logic Engine
        specs = InstrumentLogicEngine.get_epc_specs(candidate_tag)
        
        # Loop Check: Real tags have Loop Numbers.
        loop_num = specs.get('Loop_Number', '')
        if not loop_num: continue
        # Valid loop must have a digit (e.g. "298P" is ok, "NOTE" is not)
        if not any(char.isdigit() for char in loop_num): continue
        
        # Drawing Number Killer: Loop shouldn't be massive (>4 chars)
        if len(loop_num) > 4: continue

        # Confidence
        if specs['Confidence'] == 'Low': continue
        
        # Deduplication
        cluster_center_x = sum(w['center_x'] for w in cluster) / len(cluster)
        cluster_center_y = sum(w['center_y'] for w in cluster) / len(cluster)
        
        if _is_duplicate_of_shape(cluster_center_x, cluster_center_y, existing_circles_indices):
            continue
        
        text_instruments.append({
            'Tag_Number': candidate_tag,
            'Specs': specs,
            'Coordinates': f"{int(cluster_center_x)},{int(cluster_center_y)}",
            'Radius': 0, 'Location': 'Field'
        })
            
    return text_instruments
