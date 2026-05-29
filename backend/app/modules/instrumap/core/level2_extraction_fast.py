"""
Fast extraction — single Vision API call per page.

Key difference from level2_extraction.py (original):
  - ONE full-page document_text_detection per page (no per-circle API calls)
  - Phase 1: Hough finds circle positions, text looked up from the word list
  - Phase 2: text-only instruments reuse the same word list
  - Result: O(1) Vision API calls per page regardless of instrument count

Switch via USE_FAST_OCR in config.py. Original file untouched.
"""
import cv2
import logging
import math
import os
import io
import pandas as pd
import numpy as np
from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)

from .standard_library import InstrumentLogicEngine
from .text_engine import find_text_only_instruments, detect_text_full_page
from .line_extractor import extract_line_numbers
from .equipment_extractor import extract_equipment_from_ocr_words

# Y-tolerance (px) for grouping words into the same text line within a circle.
# Slightly larger than per-circle crop value because coordinates are full-page scale.
_LINE_Y_TOL = 15


def _words_in_circle(full_text_data, cx, cy, radius, margin=1.15):
    """Return full-page OCR words whose centres fall inside the circle."""
    r2 = (radius * margin) ** 2
    result = [
        w for w in full_text_data
        if (w['center_x'] - cx) ** 2 + (w['center_y'] - cy) ** 2 <= r2
    ]
    return sorted(result, key=lambda w: (w['y'], w['x']))


def _tag_from_words(words, separator, max_rows):
    """
    Group words into text lines by y-proximity and join into a tag string.
    Returns None if no text or too many lines.
    """
    if not words:
        return None

    lines = []
    line_y = None
    line_buf = []

    for w in words:
        if line_y is None or abs(w['y'] - line_y) > _LINE_Y_TOL:
            if line_buf:
                text = "".join(
                    x['text'] for x in sorted(line_buf, key=lambda x: x['x'])
                ).strip()
                if text:
                    lines.append(text)
            line_buf = [w]
            line_y = w['y']
        else:
            line_buf.append(w)

    if line_buf:
        text = "".join(
            x['text'] for x in sorted(line_buf, key=lambda x: x['x'])
        ).strip()
        if text:
            lines.append(text)

    if not lines or len(lines) > max_rows:
        return None

    return separator.join(lines)


def _detect_rectangles(image):
    """Detect square-like rectangles for System/Field location logic."""
    rectangles = []
    edges = cv2.Canny(image, 30, 90)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in contours:
        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.05 * perimeter, True)
        if len(approx) == 4:
            x, y, w, h = cv2.boundingRect(approx)
            aspect_ratio = float(w) / h
            if 0.7 <= aspect_ratio <= 1.3 and w > 10 and h > 10:
                rectangles.append({
                    'center_x': x + w / 2, 'center_y': y + h / 2,
                    'width': w, 'height': h,
                })
    return rectangles


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
    default_area_code=None,
):
    debug_mode = debug_params['DEBUG_MODE']
    separator = config_params['TEXT_CONCAT_SEPARATOR']
    max_rows = config_params['OCR_MAX_TAG_ROWS']

    output_image = None
    output_draw = None
    if output_folder and pil_image:
        output_image = pil_image.copy()
        output_draw = ImageDraw.Draw(output_image)

    final_instruments_data = []
    instrument_counter = 1

    # ── ONE full-page OCR call — shared by Phase 1 and Phase 2 ───────────────
    if status_update_fn:
        status_update_fn("Fast mode: single full-page OCR...")
    full_text_data = detect_text_full_page(pil_image, vision_client)

    # ── Phase 1: Hough positions + word lookup (no extra API calls) ───────────
    # Use lower param1 (60) for better sensitivity on thin-line vector PDFs.
    # Original used 100 which misses clean vector circles (e.g. ADNOC drawings).
    circles_final = cv2.HoughCircles(
        blurred_image,
        cv2.HOUGH_GRADIENT,
        dp=config_params['HOUGH_DP'],
        minDist=config_params['HOUGH_MIN_DIST'],
        param1=config_params.get('HOUGH_PARAM1_FAST', 60),
        param2=config_params['HOUGH_PARAM2'],
        minRadius=dynamic_min_radius,
        maxRadius=dynamic_max_radius,
    )

    potential_squares = _detect_rectangles(blurred_image)
    found_circles_indices = circles_final

    if circles_final is not None:
        for c in circles_final[0]:
            cx, cy, radius = int(c[0]), int(c[1]), int(c[2])

            # Look up words inside this circle from the single OCR result
            words = _words_in_circle(full_text_data, cx, cy, radius)
            extracted_tag = _tag_from_words(words, separator, max_rows)

            if not extracted_tag or not extracted_tag.strip():
                continue
            if not any(c.isalpha() for c in extracted_tag):
                continue  # reject pure-numeric/symbolic text (e.g. hazmat placard "526-6.9")

            epc_data = InstrumentLogicEngine.get_epc_specs(extracted_tag, default_area_code)

            # Typo cleaner (same as original)
            if epc_data['Loop_Number']:
                clean_loop = (
                    epc_data['Loop_Number']
                    .replace('l', '1').replace('I', '1')
                    .replace('O', '0').replace('S', '5')
                )
                if clean_loop != epc_data['Loop_Number']:
                    epc_data['Loop_Number'] = clean_loop
                    prefix = f"{epc_data['Area_Code']}-" if epc_data['Area_Code'] else ""
                    extracted_tag = f"{prefix}{epc_data['Instrument_Type']}-{clean_loop}{epc_data['Tag_Suffix'] or ''}"

            # Location logic (same as original)
            location = 'Field'
            for sq in potential_squares:
                sq_side = (sq['width'] + sq['height']) / 2
                if abs(sq_side - 2 * radius) < (2 * radius * 0.20):
                    if math.sqrt((sq['center_x'] - cx) ** 2 + (sq['center_y'] - cy) ** 2) < radius * 0.5:
                        location = 'System'
                        break

            ref_id = str(instrument_counter)
            instrument_counter += 1
            final_instruments_data.append({
                'Ref_ID': ref_id,
                'Verification_Source': f"{filename_base} -> Item #{ref_id}",
                'Review_Required': (epc_data['Confidence'] == 'Low'),
                'P&ID_Filename': filename_base.rsplit('_p', 1)[0] + '.pdf',
                'Tag_Number': extracted_tag,
                'Area': epc_data['Area_Code'], 'Type': epc_data['Instrument_Type'],
                'Loop': epc_data['Loop_Number'], 'Suffix': epc_data['Tag_Suffix'],
                'Instrument_Description': epc_data['Instrument_Description'],
                'Service': epc_data['Service'], 'System': epc_data['System'],
                'IO_Type': epc_data['IO_Type'], 'Signal_Type': epc_data['Signal_Type'],
                'Power_Supply': epc_data['Power_Supply'], 'Mounting': epc_data['Mounting'],
                'Location_Drawing': location,
                'Coordinates': f"{cx},{cy}",
                'Radius': radius,
            })

            if output_draw:
                output_draw.ellipse(
                    (cx - radius, cy - radius, cx + radius, cy + radius),
                    outline=(255, 215, 0), width=5,
                )
                text_pos = (cx + radius, cy - radius)
                left, top, right, bottom = output_draw.textbbox(text_pos, ref_id, font=font)
                output_draw.rectangle((left - 2, top - 2, right + 2, bottom + 2), fill='black')
                output_draw.text(text_pos, ref_id, fill=(50, 205, 50), font=font)

    # ── Phase 2: text-only instruments (same OCR data, zero extra calls) ──────
    text_only_results = find_text_only_instruments(
        pil_image, vision_client, found_circles_indices,
        full_text_data=full_text_data,
    )
    lines_df = extract_line_numbers(full_text_data, filename_base)
    equipment_df = extract_equipment_from_ocr_words(full_text_data, filename_base)

    for item in text_only_results:
        epc = item['Specs']
        ref_id = str(instrument_counter)
        instrument_counter += 1
        final_instruments_data.append({
            'Ref_ID': ref_id,
            'Verification_Source': f"{filename_base} -> Text Scan #{ref_id}",
            'Review_Required': True,
            'P&ID_Filename': filename_base.rsplit('_p', 1)[0] + '.pdf',
            'Tag_Number': item['Tag_Number'],
            'Area': epc['Area_Code'], 'Type': epc['Instrument_Type'],
            'Loop': epc['Loop_Number'], 'Suffix': epc['Tag_Suffix'],
            'Instrument_Description': epc['Instrument_Description'],
            'Service': epc['Service'], 'System': epc['System'],
            'IO_Type': epc['IO_Type'], 'Signal_Type': epc['Signal_Type'],
            'Power_Supply': epc['Power_Supply'], 'Mounting': epc['Mounting'],
            'Location_Drawing': item['Location'],
            'Coordinates': item['Coordinates'],
            'Radius': item['Radius'],
        })

        if output_draw:
            coords = list(map(int, item['Coordinates'].split(',')))
            cx2, cy2 = coords[0], coords[1]
            box_size = 30
            output_draw.rectangle(
                (cx2 - box_size, cy2 - box_size, cx2 + box_size, cy2 + box_size),
                outline=(255, 165, 0), width=4,
            )
            output_draw.text((cx2 + box_size, cy2 - box_size), ref_id, fill=(255, 0, 0), font=font)

    # ── Save highlighted image ────────────────────────────────────────────────
    if output_folder and output_image:
        save_path = os.path.join(output_folder, f"{filename_base}_highlighted.jpg")
        try:
            output_image.save(save_path, 'JPEG', quality=85)
            if status_update_fn:
                status_update_fn(f"Highlighted map saved: {filename_base}_highlighted.jpg")
        except Exception as e:
            logger.warning(f"Error saving highlighted image: {e}")

    return pd.DataFrame(final_instruments_data), lines_df, equipment_df
