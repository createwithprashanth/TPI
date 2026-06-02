# XYRA-BACKEND/app/modules/instrumap/core/text_engine.py

import logging
import math
import numpy as np
from PIL import Image as _PILImage
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

def _get_reader():
    global _ocr_reader
    if _ocr_reader is None:
        import ssl
        ssl._create_default_https_context = ssl._create_unverified_context
        from paddleocr import PaddleOCR
        logger.info("Initialising PaddleOCR reader (first call)...")
        _ocr_reader = PaddleOCR(
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            text_detection_model_name='PP-OCRv5_mobile_det',
            text_recognition_model_name='en_PP-OCRv5_mobile_rec',
            lang='en',
        )
        logger.info("PaddleOCR reader ready.")
    return _ocr_reader

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


def detect_text_full_page(pil_image, vision_client=None):
    """Run PaddleOCR on a full page and return word-level bounding boxes.

    Large images (> _OCR_TILE_THRESHOLD px) are split into overlapping tiles
    so PaddleOCR runs at full resolution on each tile — no internal downscaling,
    full accuracy on small circle text in high-DPI scanned P&IDs.

    vision_client parameter is kept for call-site compatibility but ignored.
    """
    try:
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