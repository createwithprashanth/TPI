# XYRA-BACKEND/app/modules/instrumap/core/text_engine.py

import io
import logging
import math
import numpy as np
from google.cloud import vision
from .standard_library import InstrumentLogicEngine

logger = logging.getLogger(__name__)

# --- TUNING CONSTANTS ---
TEXT_MINING_MAX_X_DIST = 40  # Looser X-tolerance for center-aligned text
TEXT_MINING_MAX_Y_GAP = 90   # Loose Y-tolerance for gaps

# The "Blacklist"
STOPWORDS = {
    "FOR", "AND", "THE", "SEE", "DWG", "REF", "TYP", "MIN", "MAX", 
    "HOT", "COLD", "AIR", "GAS", "OIL", "DRY", "WET", "IN", "OUT",
    "OFF", "ON", "SET", "TAP", "TOP", "BOT", "REV", "NOT", "YES", "NO",
    "ALL", "EQUIPMENT", "INSTRUMENT", "TAG", "NOS", "DRAWING", "SHALL",
    "AREA", "CODE", "PLANT", "SPECIFIED", "OTHER", "WISE", "NOTE", "NOTES",
    "DETAIL", "SECTION", "GENERAL", "LEGEND", "SYMBOL", "PIPING", 
    "AS", "AFTER", "BEFORE", "WITH", "WITHOUT", "FROM", "TO",
    "NC", "NO", "LC", "LO", "FC", "FO", "CS", "SS", "SP", "HL", "LL", "HH",
    "BY", "OF", "OR", "BE", "IS", "AT", "TO", "UP", "DN"
}

def detect_text_full_page(pil_image, vision_client):
    try:
        img_byte_arr = io.BytesIO()
        pil_image.save(img_byte_arr, format='JPEG')
        content = img_byte_arr.getvalue()
        image = vision.Image(content=content)
        
        response = vision_client.document_text_detection(image=image)
        
        full_text_data = []
        for page in response.full_text_annotation.pages:
            for block in page.blocks:
                for paragraph in block.paragraphs:
                    for word in paragraph.words:
                        word_text = "".join([s.text for s in word.symbols])
                        vertices = word.bounding_box.vertices
                        if not vertices: continue
                        
                        x_min = min(v.x for v in vertices)
                        y_min = min(v.y for v in vertices)
                        x_max = max(v.x for v in vertices)
                        y_max = max(v.y for v in vertices)
                        
                        full_text_data.append({
                            'text': word_text,
                            'x': x_min, 'y': y_min, 'w': x_max - x_min, 'h': y_max - y_min,
                            'center_x': (x_min + x_max) / 2, 'center_y': (y_min + y_max) / 2
                        })
        return full_text_data
    except Exception as e:
        logger.warning(f"Error in global text detection: {e}", exc_info=True)
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

def find_text_only_instruments(pil_image, vision_client, existing_circles_indices=None, full_text_data=None):
    if full_text_data is None:
        full_text_data = detect_text_full_page(pil_image, vision_client)
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