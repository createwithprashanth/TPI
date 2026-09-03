"""
Fast extraction — single Vision API call per page.

Key difference from level2_extraction.py (original):
  - ONE full-page document_text_detection per page (no per-circle API calls)
  - Phase 1: Hough finds circle positions, text looked up from the word list
  - Phase 2: text-only instruments reuse the same word list
  - Result: O(1) Vision API calls per page regardless of instrument count

Switch via USE_FAST_OCR in config.py. Original file untouched.
"""
import re
import cv2
import logging
import math
import os
import io
from collections import Counter
import pandas as pd
import numpy as np
from PIL import Image, ImageDraw, ImageEnhance

logger = logging.getLogger(__name__)

from .standard_library import InstrumentLogicEngine, instrument_tag_quality
from .text_engine import (
    find_text_only_instruments,
    detect_text_full_page,
    detect_text_region_discovery,
    detect_numeric_bubble_rows,
    recognize_structured_bubbles,
)
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


_ISA_CODE_RE = re.compile(r'^[A-Z]{2,5}$')
_OCR_SKIP = frozenset({
    'SP', 'NC', 'NO', 'NA', 'TYPE', 'TYP', 'API', 'NPS',
    'ANSI', 'NOTE', 'NOTES', 'SHT', 'DWG', 'REV',
    'MIN', 'MAX', 'NOM', 'STD', 'TAG', 'REF', 'SEE', 'PER',
    'HH', 'LL', 'LO', 'HI', 'DBB', 'NB', 'AND', 'CHOKE',
})


def _find_tags_by_anchor(full_text_data, seen_tags, default_area_code=None):
    """
    Phase 3 fallback: scan OCR words for ISA type-code anchors and collect
    the vertical text column below each one.  Catches instruments whose
    Hough circle was never detected (faded scan, broken arc, etc.).

    Mirrors _find_tags_without_circles from level2_extraction_pymupdf.py.
    """
    results = []
    used_anchors: set = set()

    for w in sorted(full_text_data, key=lambda x: (x['y'], x['x'])):
        text = w['text'].strip()
        if not _ISA_CODE_RE.match(text):
            continue
        if text in _OCR_SKIP:
            continue
        if text[0] not in InstrumentLogicEngine.FIRST_LETTER:
            continue

        ax, ay = w['center_x'], w['center_y']
        anchor_key = (round(ax), round(ay))
        if anchor_key in used_anchors:
            continue

        line_h = max(w.get('h', 10), 8.0)
        col_hw = max(w.get('w', 20) * 0.75, 20.0)
        max_rows = 4

        col = [
            w2 for w2 in full_text_data
            if abs(w2['center_x'] - ax) < col_hw
            and ay - 2 <= w2['center_y'] <= ay + (max_rows + 1) * line_h
            and len(w2['text'].strip()) > 1
            and w2['text'].strip() not in _OCR_SKIP
            and not (w2['text'].strip().isalpha() and len(w2['text'].strip()) > 5)
            and re.match(r'^[A-Za-z0-9-]+$', w2['text'].strip())
        ]
        col.sort(key=lambda x: (x['y'], x['x']))

        tag = _tag_from_words(col, '-', max_rows)
        if not tag or not any(c.isalpha() for c in tag):
            continue

        epc = InstrumentLogicEngine.get_epc_specs(tag, default_area_code)
        loop = epc.get('Loop_Number', '')
        if not loop or sum(c.isdigit() for c in loop) < 2 or len(loop) > 10:
            continue

        tag_key = tag.upper().strip()
        if tag_key in seen_tags:
            continue

        n = min(len(col), max_rows)
        est_cx = sum(x['center_x'] for x in col[:n]) / n
        est_cy = sum(x['center_y'] for x in col[:n]) / n

        used_anchors.add(anchor_key)
        seen_tags.add(tag_key)
        results.append((int(est_cx), int(est_cy), tag, epc))

    return results


def _tag_from_words(words, separator, max_rows):
    """
    Group words into text lines by y-proximity and join into a tag string.
    Returns None if no text or too many lines.
    """
    if not words:
        return None

    # Magnified bubble OCR has tightly spaced stacked rows. The full-page
    # tolerance would merge loop and suffix (for example 09 + 6206).
    line_tolerance = 5 if any(w.get("focused_bubble_ocr") for w in words) else _LINE_Y_TOL
    lines = []
    line_y = None
    line_buf = []

    for w in words:
        if line_y is None or abs(w['y'] - line_y) > line_tolerance:
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

    if not lines:
        return None

    if len(lines) > max_rows:
        # A crop can include a nearby note or line label. Select the compact
        # ISA-like stack (type followed by a numeric loop) instead of rejecting
        # the complete bubble because of that surrounding text.
        cleaned_lines = [re.sub(r"[^A-Z0-9]+", "", line.upper()) for line in lines]
        selected = None
        for start, first in enumerate(cleaned_lines):
            if not re.fullmatch(r"[A-Z]{2,5}", first):
                continue
            for length in range(min(max_rows, len(cleaned_lines) - start), 1, -1):
                window = cleaned_lines[start:start + length]
                if sum(char.isdigit() for part in window[1:] for char in part) >= 2:
                    selected = window
                    break
            if selected:
                break
        if not selected:
            return None
        lines = selected

    tag = separator.join(lines).upper()
    tag = re.sub(r"[^A-Z0-9-]+", "", tag)
    tag = re.sub(r"-{2,}", "-", tag).strip("-")
    parts = tag.split("-")
    for index in range(1, len(parts)):
        if any(char.isdigit() for char in parts[index]):
            parts[index] = parts[index].replace("O", "0")
    return "-".join(parts) or None


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


def _aligned_missing_circle_candidates(circles, image_width, image_height):
    """Extrapolate one missing bubble at the ends of a repeated instrument row."""
    if len(circles) < 3:
        return []
    remaining = sorted(circles, key=lambda c: (float(c[1]), float(c[0])))
    rows = []
    for circle in remaining:
        cy, radius = float(circle[1]), float(circle[2])
        target = next(
            (row for row in rows
             if abs(cy - row["y"]) <= max(12.0, radius * 0.35)),
            None,
        )
        if target is None:
            rows.append({"y": cy, "circles": [circle]})
        else:
            target["circles"].append(circle)
            target["y"] = sum(float(c[1]) for c in target["circles"]) / len(target["circles"])

    candidates = []
    for row in rows:
        members = sorted(row["circles"], key=lambda c: float(c[0]))
        if len(members) < 3:
            continue
        radii = [float(c[2]) for c in members]
        median_radius = float(np.median(radii))
        xs = [float(c[0]) for c in members]
        gaps = [b - a for a, b in zip(xs, xs[1:])]
        plausible = [g for g in gaps if 1.8 * median_radius <= g <= 4.0 * median_radius]
        if len(plausible) < 2:
            continue
        spacing = float(np.median(plausible))
        probe_xs = [xs[0] - spacing, xs[-1] + spacing]
        for left_x, right_x in zip(xs, xs[1:]):
            if right_x - left_x > spacing * 1.5:
                # Separate panel groups often add extra whitespace. Probe from
                # both populated sides rather than assuming an exact multiple.
                probe_xs.extend((left_x + spacing, right_x - spacing))
        for candidate_x in probe_xs:
            candidate_y = float(row["y"])
            if not (median_radius < candidate_x < image_width - median_radius
                    and median_radius < candidate_y < image_height - median_radius):
                continue
            if any(math.hypot(candidate_x - float(c[0]), candidate_y - float(c[1]))
                   < median_radius * 0.75 for c in circles):
                continue
            if any(math.hypot(candidate_x - float(c[0]), candidate_y - float(c[1]))
                   < median_radius * 0.75 for c in candidates):
                continue
            candidates.append(np.array([candidate_x, candidate_y, median_radius], dtype=np.float32))
    return candidates


def _detect_local_circle(pil_image, center_x, center_y, expected_radius, min_radius, max_radius):
    """Recover a thin circle at full resolution around an OCR text anchor."""
    margin = int(max_radius * 1.5)
    left, top = max(0, int(center_x - margin)), max(0, int(center_y - margin))
    right = min(pil_image.width, int(center_x + margin))
    bottom = min(pil_image.height, int(center_y + margin))
    crop = pil_image.crop((left, top, right, bottom)).convert("L")
    enhanced = ImageEnhance.Contrast(crop).enhance(10.0)
    local = cv2.GaussianBlur(np.asarray(enhanced, dtype=np.uint8), (3, 3), 0)
    circles = cv2.HoughCircles(
        local, cv2.HOUGH_GRADIENT, dp=1, minDist=30,
        param1=60, param2=16,
        minRadius=max(20, int(min_radius * 0.75)),
        maxRadius=max_radius,
    )
    if circles is None:
        return None
    candidates = []
    for x, y, radius in circles[0]:
        page_x, page_y = x + left, y + top
        distance = math.hypot(page_x - center_x, page_y - center_y)
        if distance <= max_radius:
            # OCR anchors estimate the bubble centre accurately. Prefer centre
            # alignment over radius similarity when concentric arcs are present.
            score = distance + 0.20 * abs(radius - expected_radius)
            candidates.append((score, int(page_x), int(page_y), int(radius)))
    if not candidates:
        return None
    _, page_x, page_y, radius = min(candidates)
    return page_x, page_y, radius


def _detect_tiled_circles(image, min_radius, max_radius):
    """Detect thin bubbles at full resolution without a page-sized accumulator."""
    tile_size, overlap = 1800, 240
    step = tile_size - overlap
    calibrated_radius = (min_radius + max_radius) / 2
    tile_min_radius = max(8, int(min_radius * 0.90))
    tile_max_radius = max(tile_min_radius + 5, int(calibrated_radius * 1.05))
    raw = []
    height, width = image.shape[:2]
    for top in range(0, height, step):
        for left in range(0, width, step):
            tile = image[top:min(top + tile_size, height), left:min(left + tile_size, width)]
            if min(tile.shape[:2]) < tile_max_radius * 2 + 20:
                continue
            circles = cv2.HoughCircles(
                tile, cv2.HOUGH_GRADIENT, dp=1, minDist=max(40, tile_min_radius),
                # Slightly below the strict global threshold so isolated thin
                # bubbles survive. Every candidate still requires structured
                # type + loop OCR and the normal tag-quality gate.
                param1=60, param2=27,
                minRadius=tile_min_radius, maxRadius=tile_max_radius,
            )
            if circles is not None:
                raw.extend(
                    (float(x + left), float(y + top), float(radius))
                    for x, y, radius in circles[0]
                )
    unique = []
    for circle in sorted(raw, key=lambda value: value[2], reverse=True):
        if not any(
            math.hypot(circle[0] - existing[0], circle[1] - existing[1])
            < max(30, min(circle[2], existing[2]) * 0.45)
            for existing in unique
        ):
            unique.append(circle)
    return np.asarray([unique], dtype=np.float32) if unique else None


def extract_instruments(
    pil_image,
    blurred_image,
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

    final_instruments_data = []
    instrument_counter = 1
    seen_tags: set = set()  # tracks all found tags for Phase 3 deduplication

    # ── ONE full-page OCR call — shared by Phase 1 and Phase 2 ───────────────
    if status_update_fn:
        status_update_fn("Fast mode: single full-page OCR...")
    full_text_data = detect_text_full_page(pil_image)

    # ── Phase 1: Dual-pass Hough — strict then sensitive ──────────────────────
    # Pass 1 (param2=30): clean full circles.
    # Pass 2 (param2=18): catches circles with horizontal dividing lines whose
    #   broken arc doesn't accumulate enough votes in the strict pass.
    # Keep OpenCV's accumulator comfortably within the shared VM's memory.
    # Circle coordinates are scaled back before full-resolution OCR.
    max_hough_dimension = 3000
    hough_scale = min(
        1.0,
        max_hough_dimension / max(blurred_image.shape[0], blurred_image.shape[1]),
    )
    if hough_scale < 1.0:
        hough_image = cv2.resize(
            blurred_image,
            None,
            fx=hough_scale,
            fy=hough_scale,
            interpolation=cv2.INTER_AREA,
        )
    else:
        hough_image = blurred_image

    def _hough(p2):
        detected = cv2.HoughCircles(
            hough_image, cv2.HOUGH_GRADIENT,
            dp=config_params['HOUGH_DP'],
            minDist=max(5, config_params['HOUGH_MIN_DIST'] * hough_scale),
            param1=config_params.get('HOUGH_PARAM1_FAST', 60),
            param2=p2,
            minRadius=max(2, round(dynamic_min_radius * hough_scale)),
            maxRadius=max(3, round(dynamic_max_radius * hough_scale)),
        )
        if detected is not None and hough_scale < 1.0:
            detected = detected / hough_scale
        return detected

    c1 = _hough(config_params['HOUGH_PARAM2'])
    # Large sheets lose their thin bubbles when reduced for a global Hough
    # accumulator. Scan them in overlapping full-resolution tiles instead.
    if hough_scale < 0.60:
        c2 = _detect_tiled_circles(
            blurred_image, dynamic_min_radius, dynamic_max_radius,
        )
    else:
        c2 = _hough(config_params.get('HOUGH_PARAM2_SENSITIVE', 18))

    # Merge: add circles from the sensitive pass not already in the strict pass
    if c1 is not None and c2 is not None:
        existing = [(int(c[0]), int(c[1])) for c in c1[0]]
        extras = [c for c in c2[0]
                  if not any(abs(int(c[0]) - ex) < dynamic_min_radius * 0.5
                             and abs(int(c[1]) - ey) < dynamic_min_radius * 0.5
                             for ex, ey in existing)]
        if extras:
            circles_final = np.array([list(c1[0]) + extras])
        else:
            circles_final = c1
    else:
        circles_final = c1 if c1 is not None else c2

    potential_squares = _detect_rectangles(blurred_image)
    found_circles_indices = circles_final

    if circles_final is not None:
        circle_list = list(circles_final[0])
        # Repeated control-panel bubbles are laid out on a regular pitch. Thin
        # arcs combined with square/diamond enclosures can make Hough omit only
        # the first member (for example LI/LSDL and ES). Probe the immediately
        # adjacent row positions; structured OCR below still has to validate a
        # real type + loop, so extrapolated empty positions are discarded.
        inferred_candidates = _aligned_missing_circle_candidates(
            circle_list, pil_image.width, pil_image.height,
        )
        for candidate in inferred_candidates:
            refined = _detect_local_circle(
                pil_image, float(candidate[0]), float(candidate[1]), float(candidate[2]),
                dynamic_min_radius, dynamic_max_radius,
            )
            if refined and float(refined[2]) >= float(candidate[2]) * 0.75:
                circle_list.append(np.asarray(refined, dtype=np.float32))
            else:
                circle_list.append(np.asarray(candidate, dtype=np.float32))
        structured_results = recognize_structured_bubbles(
            pil_image,
            [(float(c[0]), float(c[1]), float(c[2])) for c in circle_list],
        )
        for circle_index, c in enumerate(circle_list):
            cx, cy, radius = int(c[0]), int(c[1]), int(c[2])

            structured = structured_results[circle_index]
            if structured.get("type") and structured.get("loop"):
                parts = [structured["type"], structured["loop"]]
                if structured.get("suffix"):
                    parts.append(structured["suffix"])
                extracted_tag = separator.join(parts)
            else:
                words = detect_text_region_discovery(
                    pil_image,
                    cx - radius * 1.25,
                    cy - radius * 1.25,
                    cx + radius * 1.25,
                    cy + radius * 1.25,
                )
                extracted_tag = _tag_from_words(words, separator, max_rows)

            if not extracted_tag or not extracted_tag.strip():
                continue
            if not any(c.isalpha() for c in extracted_tag):
                continue  # reject pure-numeric/symbolic text (e.g. hazmat placard "526-6.9")

            epc_data = InstrumentLogicEngine.get_epc_specs(extracted_tag, default_area_code)

            quality, _ = instrument_tag_quality({
                "Tag_Number": extracted_tag,
                "Type": epc_data.get("Instrument_Type", ""),
                "Loop": epc_data.get("Loop_Number", ""),
                "Suffix": epc_data.get("Tag_Suffix", ""),
            })
            if quality != "accepted":
                continue

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

            seen_tags.add(extracted_tag.upper().strip())
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

    # ── Phase 2: text-cluster scan (proximity-based, no circle needed) ──────────
    text_only_results = find_text_only_instruments(
        pil_image, existing_circles_indices=found_circles_indices,
        full_text_data=full_text_data,
    )
    lines_df = extract_line_numbers(full_text_data, filename_base)
    equipment_df = extract_equipment_from_ocr_words(full_text_data, filename_base)

    for item in text_only_results:
        epc = item['Specs']
        quality, _ = instrument_tag_quality({
            "Tag_Number": item['Tag_Number'],
            "Type": epc.get('Instrument_Type', ''),
            "Loop": epc.get('Loop_Number', ''),
            "Suffix": epc.get('Tag_Suffix', ''),
        })
        if quality != "accepted":
            continue
        raw_coords = list(map(int, item['Coordinates'].split(',')))
        text_cx, text_cy = raw_coords[0], raw_coords[1]
        expected_radius = max(55, int(dynamic_min_radius * 1.3))
        local_circle = _detect_local_circle(
            pil_image, text_cx, text_cy, expected_radius,
            dynamic_min_radius, dynamic_max_radius,
        )
        mark_cx, mark_cy, mark_radius = (
            local_circle if local_circle else (text_cx, text_cy, int(item.get('Radius', 0) or 0))
        )
        seen_tags.add(item['Tag_Number'].upper().strip())
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
            'Coordinates': f"{mark_cx},{mark_cy}",
            'Radius': mark_radius,
        })

        if output_draw:
            if mark_radius:
                output_draw.ellipse(
                    (mark_cx - mark_radius, mark_cy - mark_radius,
                     mark_cx + mark_radius, mark_cy + mark_radius),
                    outline=(255, 215, 0), width=5,
                )
                output_draw.text(
                    (mark_cx + mark_radius, mark_cy - mark_radius),
                    ref_id, fill=(50, 205, 50), font=font,
                )
            else:
                box_size = 30
                output_draw.rectangle(
                    (mark_cx - box_size, mark_cy - box_size,
                     mark_cx + box_size, mark_cy + box_size),
                    outline=(255, 165, 0), width=4,
                )
                output_draw.text(
                    (mark_cx + box_size, mark_cy - box_size),
                    ref_id, fill=(255, 0, 0), font=font,
                )

    # ── Phase 3: ISA text-anchor scan — catches circles Hough never found ───────
    anchor_results = _find_tags_by_anchor(full_text_data, seen_tags, default_area_code)
    for est_cx, est_cy, tag, epc in anchor_results:
        structured_radius = max(55, int(dynamic_min_radius * 1.3))
        structured_loop, structured_suffix = detect_numeric_bubble_rows(
            pil_image, est_cx, est_cy, structured_radius,
        )
        existing_loop = str(epc.get('Loop_Number', ''))
        existing_suffix = str(epc.get('Tag_Suffix', ''))
        if structured_loop and (
            not existing_loop.isdigit() or len(structured_loop) > len(existing_loop)
        ):
            epc['Loop_Number'] = structured_loop
        if structured_suffix and not existing_suffix.isdigit():
            epc['Tag_Suffix'] = structured_suffix
        final_loop = str(epc.get('Loop_Number', ''))
        final_suffix = str(epc.get('Tag_Suffix', ''))
        if final_loop:
            tag_parts = [epc.get('Instrument_Type', ''), final_loop]
            if final_suffix:
                tag_parts.append(final_suffix)
            tag = separator.join(part for part in tag_parts if part)
        quality, _ = instrument_tag_quality({
            "Tag_Number": tag,
            "Type": epc.get('Instrument_Type', ''),
            "Loop": epc.get('Loop_Number', ''),
            "Suffix": epc.get('Tag_Suffix', ''),
        })
        if quality != "accepted":
            continue
        local_circle = _detect_local_circle(
            pil_image, est_cx, est_cy, structured_radius,
            dynamic_min_radius, dynamic_max_radius,
        )
        mark_cx, mark_cy, mark_radius = (
            local_circle if local_circle else (est_cx, est_cy, 0)
        )
        ref_id = str(instrument_counter)
        instrument_counter += 1
        final_instruments_data.append({
            'Ref_ID': ref_id,
            'Verification_Source': f"{filename_base} -> Anchor #{ref_id}",
            'Review_Required': True,
            'P&ID_Filename': filename_base.rsplit('_p', 1)[0] + '.pdf',
            'Tag_Number': tag,
            'Area': epc['Area_Code'], 'Type': epc['Instrument_Type'],
            'Loop': epc['Loop_Number'], 'Suffix': epc['Tag_Suffix'],
            'Instrument_Description': epc['Instrument_Description'],
            'Service': epc['Service'], 'System': epc['System'],
            'IO_Type': epc['IO_Type'], 'Signal_Type': epc['Signal_Type'],
            'Power_Supply': epc['Power_Supply'], 'Mounting': epc['Mounting'],
            'Location_Drawing': 'Field',
            'Coordinates': f"{mark_cx},{mark_cy}",
            'Radius': mark_radius,
        })
        if output_draw:
            if mark_radius:
                output_draw.ellipse(
                    (mark_cx - mark_radius, mark_cy - mark_radius,
                     mark_cx + mark_radius, mark_cy + mark_radius),
                    outline=(255, 215, 0), width=5,
                )
                output_draw.text(
                    (mark_cx + mark_radius, mark_cy - mark_radius),
                    ref_id, fill=(50, 205, 50), font=font,
                )
            else:
                output_draw.rectangle(
                    (est_cx - 25, est_cy - 25, est_cx + 25, est_cy + 25),
                    outline=(0, 200, 255), width=3,
                )
                output_draw.text((est_cx + 27, est_cy - 10), ref_id, fill=(0, 200, 255), font=font)

    # ── Save highlighted image ────────────────────────────────────────────────
    # Repair a faint final loop digit only when this page establishes the same
    # dominant four-digit loop repeatedly (for example 620 -> 6201).
    four_digit_loops = [
        str(item.get('Loop', '')) for item in final_instruments_data
        if re.fullmatch(r"\d{4}", str(item.get('Loop', '')))
    ]
    if four_digit_loops:
        dominant_loop, dominant_count = Counter(four_digit_loops).most_common(1)[0]
        if dominant_count >= 2:
            for item in final_instruments_data:
                loop = str(item.get('Loop', ''))
                if re.fullmatch(r"\d{3}", loop) and dominant_loop.startswith(loop):
                    item['Loop'] = dominant_loop
                    parts = [str(item.get('Type', '')), dominant_loop]
                    if item.get('Suffix'):
                        parts.append(str(item['Suffix']))
                    item['Tag_Number'] = separator.join(part for part in parts if part)

    # When the page consistently uses two-digit numeric suffixes, preserve a
    # faint leading zero that recognition can drop (5 -> 05, 6 -> 06).
    numeric_suffixes = [
        str(item.get('Suffix', '')) for item in final_instruments_data
        if str(item.get('Suffix', '')).isdigit()
    ]
    if sum(len(value) == 2 for value in numeric_suffixes) >= 3:
        for item in final_instruments_data:
            suffix = str(item.get('Suffix', ''))
            if len(suffix) == 1 and suffix.isdigit():
                item['Suffix'] = suffix.zfill(2)
                parts = [str(item.get('Type', '')), str(item.get('Loop', '')), item['Suffix']]
                item['Tag_Number'] = separator.join(part for part in parts if part)

    if output_folder and pil_image:
        # Build the checkprint only after OCR and at screen/print-review
        # resolution. Keeping a full 300-DPI copy alive during recognition can
        # exceed the shared VM's memory limit.
        checkprint_scale = 0.5
        output_image = pil_image.resize(
            (round(pil_image.width * checkprint_scale), round(pil_image.height * checkprint_scale)),
            Image.Resampling.LANCZOS,
        ).convert("RGB")
        output_image = ImageEnhance.Contrast(output_image).enhance(10.0)
        output_draw = ImageDraw.Draw(output_image)
        for item in final_instruments_data:
            try:
                item_cx, item_cy = map(int, str(item.get('Coordinates', '')).split(','))
                item_radius = int(item.get('Radius', 0) or 0)
            except (TypeError, ValueError):
                continue
            item_cx = round(item_cx * checkprint_scale)
            item_cy = round(item_cy * checkprint_scale)
            item_radius = round(item_radius * checkprint_scale)
            ref_id = str(item.get('Ref_ID', ''))
            if item_radius:
                output_draw.ellipse(
                    (item_cx - item_radius, item_cy - item_radius,
                     item_cx + item_radius, item_cy + item_radius),
                    outline=(255, 215, 0), width=3,
                )
                label_pos = (item_cx + item_radius, item_cy - item_radius)
            else:
                box_size = 15
                output_draw.rectangle(
                    (item_cx - box_size, item_cy - box_size,
                     item_cx + box_size, item_cy + box_size),
                    outline=(255, 165, 0), width=3,
                )
                label_pos = (item_cx + box_size, item_cy - box_size)
            output_draw.text(label_pos, ref_id, fill=(0, 140, 0), font=font)
        save_path = os.path.join(output_folder, f"{filename_base}_checkprint.pdf")
        try:
            output_image.save(save_path, 'PDF')
            if status_update_fn:
                status_update_fn(f"Checkprint saved: {filename_base}_checkprint.pdf")
        except Exception as e:
            logger.warning(f"Error saving checkprint PDF: {e}")

    return pd.DataFrame(final_instruments_data), lines_df, equipment_df
