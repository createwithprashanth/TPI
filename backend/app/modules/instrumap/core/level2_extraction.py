# XYRA-BACKEND/app/modules/instrumap/core/level2_extraction.py

import cv2
import logging
import pandas as pd
import numpy as np
from google.cloud import vision
from PIL import Image, ImageDraw, ImageFont
import io
import os
import math

logger = logging.getLogger(__name__)

# Import the Logic Brain
from .standard_library import InstrumentLogicEngine

# Import the New Text Scavenger
from .text_engine import find_text_only_instruments, detect_text_full_page
from .line_extractor import extract_line_numbers

# --- HELPER FUNCTIONS ---

def _is_separator_line(text):
    """
    Heuristically checks if a given text string represents a separator line.
    """
    if not text:
        return False
    separator_chars = {'-', '_'}
    separator_count = sum(1 for char in text if char in separator_chars)
    if separator_count >= 2 and (separator_count / len(text)) >= 0.8:
        return True
    return False

def _extract_tag_from_ocr_results_level2(
    ocr_results_for_roi, 
    text_concat_separator, 
    ocr_y_tolerance, 
    debug_mode,
    ocr_min_chars_per_row, 
    ocr_max_chars_per_row, 
    ocr_max_tag_rows 
):
    """
    Extracts a tag from OCR results (for cropped circles).
    """
    if not ocr_results_for_roi:
        return None

    text_fragments_with_coords = []
    for item in ocr_results_for_roi:
        text = str(item.get('Text', '')).strip()
        bbox = item.get('BoundingBox')
        if not isinstance(bbox, list) or len(bbox) < 1:
            continue
        try:
            x_left = bbox[0][0]
            y_top = bbox[0][1]
            if text:
                text_fragments_with_coords.append({'text': text, 'y': y_top, 'x': x_left})
        except (IndexError, TypeError):
            continue

    if not text_fragments_with_coords:
        return None

    # Sort by Y then X
    text_fragments_with_coords.sort(key=lambda item: (item['y'], item['x']))

    current_line_y = -1
    current_line_fragments = []
    lines_of_text = []

    for fragment in text_fragments_with_coords:
        if not fragment['text']:
            continue

        if current_line_y == -1 or abs(fragment['y'] - current_line_y) > ocr_y_tolerance:
            if current_line_fragments:
                lines_of_text.append(sorted(current_line_fragments, key=lambda item: item['x']))
            current_line_fragments = [fragment]
            current_line_y = fragment['y']
        else:
            current_line_fragments.append(fragment)

    if current_line_fragments:
        lines_of_text.append(sorted(current_line_fragments, key=lambda item: item['x']))

    if not lines_of_text:
        return None

    extracted_lines = []
    for line_data in lines_of_text:
        line_text = "".join([f['text'] for f in line_data if f['text']]).strip()
        if _is_separator_line(line_text):
            continue
        if line_text:
            extracted_lines.append(line_text)

    if not extracted_lines:
        return None
    
    if len(extracted_lines) > ocr_max_tag_rows:
        return None

    return text_concat_separator.join(extracted_lines)


def _detect_rectangles(image):
    """
    Detects square-like rectangles for 'System' location logic.
    """
    rectangles = []
    edges = cv2.Canny(image, 30, 90)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    for contour in contours:
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.05 * perimeter, True)

        if len(approx) == 4:
            x, y, w, h = cv2.boundingRect(approx)
            aspect_ratio = float(w) / h
            if 0.7 <= aspect_ratio <= 1.3:
                if w > 10 and h > 10:
                    rectangles.append({
                        'center_x': x + w / 2,
                        'center_y': y + h / 2,
                        'width': w,
                        'height': h,
                        'bbox': (x, y, x + w, y + h)
                    })
    return rectangles

def _merge_circles(circles_list, overlap_threshold=0.3):
    """
    Merges multiple lists of circles, removing duplicates based on overlap.
    """
    merged_circles = []
    
    # Flatten list
    all_candidates = []
    for source in circles_list:
        if source is not None:
            source = np.uint16(np.around(source))
            for c in source[0]:
                all_candidates.append(c) # [x, y, r]
                
    if not all_candidates:
        return None

    # Sort by radius (preference to larger, cleaner circles?) 
    # Or just keep them as is. Let's process one by one.
    
    final_list = []
    
    for cand in all_candidates:
        cx, cy, cr = cand[0], cand[1], cand[2]
        is_duplicate = False
        
        for existing in final_list:
            ex, ey, er = existing[0], existing[1], existing[2]
            
            # Calculate distance between centers
            dist = math.sqrt((cx - ex)**2 + (cy - ey)**2)
            
            # Check overlap. If distance < sum of radii * threshold, it's a dupe.
            # Using strict check: if centers are within 50% of the radius of the existing circle
            if dist < (er * 0.8): 
                is_duplicate = True
                break
        
        if not is_duplicate:
            final_list.append(cand)
            
    if not final_list:
        return None
        
    # Format back to numpy shape expected by main loop (1, N, 3)
    return np.array([final_list])


# --- MAIN ORCHESTRATOR ---
def extract_instruments(
    pil_image, 
    blurred_image, 
    vision_client, 
    dynamic_min_radius, 
    dynamic_max_radius, 
    legend_df, 
    legend_types, 
    filename_base, 
    config_params, 
    debug_params, 
    font, 
    status_update_fn=None,
    output_folder=None,
    default_area_code=None 
):
    """
    The Master Function.
    Runs Phase 1 (Dual-Pass Shapes) + Phase 2 (Text) and merges results.
    """
    debug_mode = debug_params['DEBUG_MODE']
    text_concat_separator = config_params['TEXT_CONCAT_SEPARATOR']
    ocr_roi_margin_factor = config_params['OCR_ROI_MARGIN_FACTOR']
    ocr_y_tolerance = config_params['OCR_Y_TOLERANCE']

    # 1. Setup Drawing Canvas
    output_draw = None
    output_image = None
    if output_folder and pil_image:
        output_image = pil_image.copy()
        output_draw = ImageDraw.Draw(output_image)

    final_instruments_data = []
    instrument_counter = 1

    # =========================================================
    # PHASE 1: SHAPE ENGINE (Single-Pass Strategy - Like Old App)
    # =========================================================
    
    # Single pass with tuned parameters from config
    circles_final = cv2.HoughCircles(
        blurred_image,
        cv2.HOUGH_GRADIENT,
        dp=config_params['HOUGH_DP'],
        minDist=config_params['HOUGH_MIN_DIST'],
        param1=config_params['HOUGH_PARAM1'],
        param2=config_params['HOUGH_PARAM2'],
        minRadius=dynamic_min_radius,
        maxRadius=dynamic_max_radius
    )
    
    potential_squares = _detect_rectangles(blurred_image)
    
    # We keep a reference to found circles to pass to the Text Engine later
    found_circles_indices = circles_final 

    if circles_final is not None:
        # circles_final is already numpy array from _merge_circles or raw Hough
        
        for i, c in enumerate(circles_final[0]):
            center_x, center_y, radius = int(c[0]), int(c[1]), int(c[2])

            # A. Crop & OCR
            margin = int(radius * ocr_roi_margin_factor)
            x1 = max(0, center_x - margin)
            y1 = max(0, center_y - margin)
            x2 = min(pil_image.width, center_x + margin)
            y2 = min(pil_image.height, center_y + margin)

            roi_image = pil_image.crop((x1, y1, x2, y2))
            
            # --- CIRCULAR MASKING (Tunnel Vision) ---
            # Prevents reading neighbor tags when circles are close
            mask = Image.new('L', roi_image.size, 0)
            mask_draw = ImageDraw.Draw(mask)
            rel_cx = center_x - x1
            rel_cy = center_y - y1
            
            # Draw white circle (-2px to avoid border noise)
            mask_draw.ellipse(
                (rel_cx - radius + 2, rel_cy - radius + 2, rel_cx + radius - 2, rel_cy + radius - 2), 
                fill=255
            )
            
            black_bg = Image.new('RGB', roi_image.size, (0, 0, 0))
            roi_masked = Image.composite(roi_image, black_bg, mask)
            
            img_byte_arr = io.BytesIO()
            roi_masked.save(img_byte_arr, format='JPEG')
            image = vision.Image(content=img_byte_arr.getvalue())
            # ----------------------------------------

            # Use standard detection for crops
            resp = vision_client.text_detection(image=image)
            texts = resp.text_annotations

            ocr_results = []
            if texts:
                for text_annotation in texts[1:]:
                    bbox_coords_list = [(v.x, v.y) for v in text_annotation.bounding_poly.vertices]
                    ocr_results.append({
                        'Text': text_annotation.description,
                        'BoundingBox': bbox_coords_list
                    })

            # B. Extract Tag
            extracted_tag = _extract_tag_from_ocr_results_level2(
                ocr_results, 
                text_concat_separator, 
                ocr_y_tolerance, 
                debug_mode,
                config_params['OCR_MIN_CHARS_PER_ROW'],
                config_params['OCR_MAX_CHARS_PER_ROW'],
                config_params['OCR_MAX_TAG_ROWS']
            )
            
            if extracted_tag is None or extracted_tag.strip() == "":
                continue
            if not any(c.isalpha() for c in extracted_tag):
                continue  # reject pure-numeric/symbolic text (e.g. hazmat placard "526-6.9")

            # C. Logic Engine
            epc_data = InstrumentLogicEngine.get_epc_specs(extracted_tag, default_area_code)

            # D. Typo Cleaner
            if epc_data['Loop_Number']:
                clean_loop = epc_data['Loop_Number'].replace('l', '1').replace('I', '1').replace('O', '0').replace('S', '5')
                if clean_loop != epc_data['Loop_Number']:
                    epc_data['Loop_Number'] = clean_loop
                    prefix = f"{epc_data['Area_Code']}-" if epc_data['Area_Code'] else ""
                    suffix = epc_data['Tag_Suffix'] or ""
                    extracted_tag = f"{prefix}{epc_data['Instrument_Type']}-{clean_loop}{suffix}"

            # E. Location Logic (System vs Field)
            location = 'Field'
            circle_diameter = 2 * radius
            
            for sq in potential_squares:
                sq_side = (sq['width'] + sq['height']) / 2
                if abs(sq_side - circle_diameter) < (circle_diameter * 0.20):
                    distance_to_center = math.sqrt((sq['center_x'] - center_x)**2 + (sq['center_y'] - center_y)**2)
                    if distance_to_center < (radius * 0.5):
                        location = 'System' 
                        break

            # F. Save Result
            ref_id = str(instrument_counter)
            instrument_counter += 1
            
            final_instruments_data.append({
                'Ref_ID': ref_id,
                'Verification_Source': f"{filename_base} -> Item #{ref_id}",
                'Review_Required': (epc_data['Confidence'] == "Low"),
                'P&ID_Filename': filename_base.rsplit('_p', 1)[0] + ".pdf",
                'Tag_Number': extracted_tag,
                'Area': epc_data['Area_Code'], 'Type': epc_data['Instrument_Type'],
                'Loop': epc_data['Loop_Number'], 'Suffix': epc_data['Tag_Suffix'],
                'Instrument_Description': epc_data['Instrument_Description'],
                'Service': epc_data['Service'], 'System': epc_data['System'],
                'IO_Type': epc_data['IO_Type'], 'Signal_Type': epc_data['Signal_Type'],
                'Power_Supply': epc_data['Power_Supply'], 'Mounting': epc_data['Mounting'],
                'Location_Drawing': location,
                'Coordinates': f"{center_x},{center_y}",
                'Radius': radius
            })

            # G. Draw Debug
            if output_draw:
                # Green for Pass 1/Pass 2 merged
                output_draw.ellipse(
                    (center_x - radius, center_y - radius, center_x + radius, center_y + radius),
                    outline=(50, 205, 50), width=5
                )
                text_pos = (center_x + radius, center_y - radius)
                left, top, right, bottom = output_draw.textbbox(text_pos, ref_id, font=font)
                output_draw.rectangle((left-2, top-2, right+2, bottom+2), fill="black")
                output_draw.text(text_pos, ref_id, fill=(255, 0, 0), font=font)


    # =========================================================
    # PHASE 2: TEXT ENGINE (The "Ruthless" Scavenger - 10%)
    # =========================================================
    lines_df = pd.DataFrame()
    if pil_image:
        # Single OCR call — reused by both instrument text engine and line extractor
        full_text_data = detect_text_full_page(pil_image, vision_client)
        text_only_results = find_text_only_instruments(
            pil_image, vision_client, found_circles_indices,
            full_text_data=full_text_data,
        )
        lines_df = extract_line_numbers(full_text_data, filename_base)
        
        for item in text_only_results:
            epc = item['Specs']
            ref_id = str(instrument_counter)
            instrument_counter += 1
            
            final_instruments_data.append({
                'Ref_ID': ref_id,
                'Verification_Source': f"{filename_base} -> Text Scan #{ref_id}",
                'Review_Required': True, 
                'P&ID_Filename': filename_base.rsplit('_p', 1)[0] + ".pdf",
                'Tag_Number': item['Tag_Number'],
                'Area': epc['Area_Code'], 'Type': epc['Instrument_Type'],
                'Loop': epc['Loop_Number'], 'Suffix': epc['Tag_Suffix'],
                'Instrument_Description': epc['Instrument_Description'],
                'Service': epc['Service'], 'System': epc['System'],
                'IO_Type': epc['IO_Type'], 'Signal_Type': epc['Signal_Type'],
                'Power_Supply': epc['Power_Supply'], 'Mounting': epc['Mounting'],
                'Location_Drawing': item['Location'],
                'Coordinates': item['Coordinates'],
                'Radius': item['Radius']
            })
            
            if output_draw:
                coords = list(map(int, item['Coordinates'].split(',')))
                cx, cy = coords[0], coords[1]
                box_size = 30
                output_draw.rectangle(
                    (cx - box_size, cy - box_size, cx + box_size, cy + box_size),
                    outline=(255, 165, 0), 
                    width=4
                )
                text_pos = (cx + box_size, cy - box_size)
                output_draw.text(text_pos, ref_id, fill=(255, 0, 0), font=font)


    # --- SAVE HIGHLIGHTED IMAGE ---
    if output_folder and output_image:
        highlight_filename = f"{filename_base}_highlighted.jpg"
        save_path = os.path.join(output_folder, highlight_filename)
        try:
            output_image.save(save_path, "JPEG", quality=85)
            if status_update_fn: status_update_fn(f"Generated highlighted map: {highlight_filename}")
        except Exception as e:
            logger.warning(f"Error saving highlighted image: {e}")

    return pd.DataFrame(final_instruments_data), lines_df