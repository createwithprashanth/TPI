# TPI/app/modules/instrumap/core/instrument_processor.py

import logging
import os

logger = logging.getLogger(__name__)
import pandas as pd
import numpy as np
from pdf2image import convert_from_bytes
from PIL import Image, ImageDraw, ImageFont
import math
import cv2
Image.MAX_IMAGE_PIXELS = None

# Import configuration settings
from .config import (
    POPPLER_PATH, PDF_DPI,
    HOUGH_DP, HOUGH_MIN_DIST, HOUGH_PARAM1, HOUGH_PARAM1_FAST, HOUGH_PARAM2,
    HOUGH_MIN_RADIUS, HOUGH_MAX_RADIUS,
    OCR_ROI_MARGIN_FACTOR, TEXT_CONCAT_SEPARATOR,
    DEBUG_MODE, DEBUG_OUTPUT_FOLDER,
    ANCHOR_MIN_COUNT, RADIUS_TOLERANCE_PERCENT,
    PID_GRID_ROWS, PID_GRID_COLS, PID_SEARCH_ORDER,
    OCR_MIN_CHARS_PER_ROW, OCR_MAX_CHARS_PER_ROW, OCR_MAX_TAG_ROWS, OCR_Y_TOLERANCE,
)

from .level2_extraction_fast import extract_instruments

try:
    from ...llm.line_mapper import map_instruments_to_lines_llm as _llm_map
    _LLM_AVAILABLE = True
except ImportError:
    _LLM_AVAILABLE = False
    _llm_map = None

try:
    from ...telemetry import RunLogger as _RunLogger
except ImportError:
    _RunLogger = None

# --- UTILITY FUNCTIONS ---
def _calculate_dynamic_radius(calibration_radius, config_params):
    """
    Calculates the dynamic min/max radius range based on a single calibrated radius.
    """
    radius_tolerance = calibration_radius * config_params['RADIUS_TOLERANCE_PERCENT']
    dynamic_min_radius = max(1, int(calibration_radius - radius_tolerance))
    dynamic_max_radius = int(calibration_radius + radius_tolerance)
    return dynamic_min_radius, dynamic_max_radius
# -----------------------------------------------------------


class InstrumentProcessor:
    def __init__(self):
        self.poppler_path = POPPLER_PATH
        self.debug_mode = DEBUG_MODE
        self.debug_output_folder = DEBUG_OUTPUT_FOLDER
        if self.debug_mode and not os.path.exists(self.debug_output_folder):
            os.makedirs(self.debug_output_folder)

        # Bundle ALL config parameters (as defaults)
        self.config_defaults = {
            'PDF_DPI': PDF_DPI,
            'HOUGH_DP': HOUGH_DP,
            'HOUGH_MIN_DIST': HOUGH_MIN_DIST,
            'HOUGH_PARAM1': HOUGH_PARAM1,
            'HOUGH_PARAM1_FAST': HOUGH_PARAM1_FAST,
            'HOUGH_PARAM2': HOUGH_PARAM2,
            'HOUGH_MIN_RADIUS': HOUGH_MIN_RADIUS,
            'HOUGH_MAX_RADIUS': HOUGH_MAX_RADIUS,
            'OCR_ROI_MARGIN_FACTOR': OCR_ROI_MARGIN_FACTOR,
            'TEXT_CONCAT_SEPARATOR': TEXT_CONCAT_SEPARATOR,
            'ANCHOR_MIN_COUNT': ANCHOR_MIN_COUNT,
            'RADIUS_TOLERANCE_PERCENT': RADIUS_TOLERANCE_PERCENT,
            'PID_GRID_ROWS': PID_GRID_ROWS,
            'PID_GRID_COLS': PID_GRID_COLS,
            'PID_SEARCH_ORDER': PID_SEARCH_ORDER,
            'OCR_MIN_CHARS_PER_ROW': OCR_MIN_CHARS_PER_ROW,
            'OCR_MAX_CHARS_PER_ROW': OCR_MAX_CHARS_PER_ROW,
            'OCR_MAX_TAG_ROWS': OCR_MAX_TAG_ROWS,
            'OCR_Y_TOLERANCE': OCR_Y_TOLERANCE
        }

        # Bundle debug parameters
        self.debug_params = {
            'DEBUG_MODE': DEBUG_MODE,
            'DEBUG_OUTPUT_FOLDER': DEBUG_OUTPUT_FOLDER
        }

    @staticmethod
    def _parse_legend(legend_df: pd.DataFrame):
        """Return (legend_df, legend_types) for a given legend DataFrame. Pure, no side-effects."""
        if not legend_df.empty:
            key_col = legend_df.columns[0]
            legend_types = set(legend_df[key_col].astype(str).str.upper())
        else:
            legend_types = set()
        return legend_df, legend_types


    def _save_debug_snapshot(
        self,
        pdf_path: str,
        instruments_df,
        lines_df,
    ) -> None:
        """
        Save a debug snapshot of the last processed batch to debug_output/line_mapper_debug/.
        Previous snapshot is deleted first — only one batch kept at a time.
        Only runs when DEBUG_MODE = True.
        """
        import shutil
        debug_dir = os.path.join(self.debug_output_folder, "line_mapper_debug")
        # Clear previous snapshot
        if os.path.exists(debug_dir):
            shutil.rmtree(debug_dir, ignore_errors=True)
        os.makedirs(debug_dir, exist_ok=True)

        try:
            # Copy the PDF
            shutil.copy2(pdf_path, os.path.join(debug_dir, "input.pdf"))
            # Save DataFrames
            instruments_df.to_csv(os.path.join(debug_dir, "instruments.csv"), index=False)
            lines_df.to_csv(os.path.join(debug_dir, "lines.csv"), index=False)
            logger.info(f"Debug snapshot saved to {debug_dir}")
        except Exception as exc:
            logger.warning(f"Debug snapshot failed (non-fatal): {exc}")

    def _render_pymupdf_highlights(
        self,
        pdf_content: bytes,
        instruments_df,
        output_folder: str,
        filename_base: str,
        full_dpi: int,
        lines_df=None,
    ) -> None:
        """Render PDF pages at reduced DPI, draw detected instrument circles, save checkprint PDF."""
        HIGHLIGHT_DPI = 150  # fast enough for visual checking
        scale = HIGHLIGHT_DPI / full_dpi  # instrument coords are at full_dpi

        try:
            if self.poppler_path:
                pages = convert_from_bytes(pdf_content, dpi=HIGHLIGHT_DPI, poppler_path=self.poppler_path)
            else:
                pages = convert_from_bytes(pdf_content, dpi=HIGHLIGHT_DPI)
        except Exception as exc:
            logger.warning(f"PyMuPDF highlight render: PDF conversion failed: {exc}")
            return

        try:
            font = ImageFont.truetype("arial.ttf", 18)
        except Exception:
            font = ImageFont.load_default()

        page_groups = {}
        for _, row in instruments_df.iterrows():
            pg = int(row.get("P&ID_Page", 1))
            page_groups.setdefault(pg, []).append(row)

        line_groups = {}
        if lines_df is not None and not lines_df.empty:
            for _, row in lines_df.iterrows():
                pg = int(row.get("P&ID_Page", 1))
                line_groups.setdefault(pg, []).append(row)

        annotated_pages = []
        for page_idx, pil_image in enumerate(pages):
            page_number = page_idx + 1
            page_instr = page_groups.get(page_number, [])
            page_lines = line_groups.get(page_number, [])
            if not page_instr and not page_lines:
                annotated_pages.append(pil_image.convert('RGB'))
                continue

            overlay = Image.new('RGBA', pil_image.size, (0, 0, 0, 0))
            overlay_draw = ImageDraw.Draw(overlay)

            # Instruments: semi-transparent yellow circles
            for row in page_instr:
                try:
                    coords = str(row.get("Coordinates", "")).split(",")
                    cx = int(float(coords[0]) * scale)
                    cy = int(float(coords[1]) * scale)
                    r = max(10, int(float(row.get("Radius", 20)) * scale))
                except Exception:
                    continue
                overlay_draw.ellipse(
                    (cx - r, cy - r, cx + r, cy + r),
                    fill=(255, 215, 0, 55),
                    outline=(255, 215, 0, 255),
                    width=3,
                )

            # Line numbers: semi-transparent cyan bar aligned to text orientation
            for row in page_lines:
                try:
                    coords = str(row.get("Coordinates", "")).split(",")
                    cx = int(float(coords[0]) * scale)
                    cy = int(float(coords[1]) * scale)
                except Exception:
                    continue
                vertical = str(row.get("Orientation", "H")) == "V"
                if vertical:
                    overlay_draw.rectangle(
                        (cx - 6, cy - 40, cx + 6, cy + 40),
                        fill=(0, 200, 255, 60),
                        outline=(0, 200, 255, 220),
                        width=2,
                    )
                else:
                    overlay_draw.rectangle(
                        (cx - 40, cy - 6, cx + 40, cy + 6),
                        fill=(0, 200, 255, 60),
                        outline=(0, 200, 255, 220),
                        width=2,
                    )

            composited = Image.alpha_composite(pil_image.convert('RGBA'), overlay).convert('RGB')
            draw = ImageDraw.Draw(composited)

            # Instrument tag labels — lime green
            for row in page_instr:
                try:
                    coords = str(row.get("Coordinates", "")).split(",")
                    cx = int(float(coords[0]) * scale)
                    cy = int(float(coords[1]) * scale)
                    r = max(10, int(float(row.get("Radius", 20)) * scale))
                except Exception:
                    continue
                draw.text((cx + r + 2, cy - 10), str(row.get("Tag_Number", "")), fill=(50, 205, 50), font=font)

            # Line number labels — cyan
            for row in page_lines:
                try:
                    coords = str(row.get("Coordinates", "")).split(",")
                    cx = int(float(coords[0]) * scale)
                    cy = int(float(coords[1]) * scale)
                except Exception:
                    continue
                draw.text((cx + 42, cy - 8), str(row.get("Line_Number", "")), fill=(0, 200, 255), font=font)

            annotated_pages.append(composited)

        if annotated_pages:
            save_path = os.path.join(output_folder, f"{filename_base}_checkprint.pdf")
            try:
                annotated_pages[0].save(
                    save_path, "PDF", save_all=True, append_images=annotated_pages[1:]
                )
            except Exception as exc:
                logger.warning(f"Checkprint PDF save failed: {exc}")

    def find_radius_from_point(self, pid_file_path, x_center, y_center, poppler_path):
        """
        Locates the nearest circle to the clicked (x, y) coordinate on the 300 DPI image
        and returns its measured radius.
        """
        # Search area size in pixels
        SEARCH_RADIUS_PX = 100 

        try:
            images = convert_from_bytes(
                open(pid_file_path, 'rb').read(),
                dpi=self.config_defaults['PDF_DPI'],
                poppler_path=self.poppler_path,
                first_page=1,
                last_page=1,
            )
            if not images:
                logger.warning("No images converted from PDF during calibration.")
                return None

            pil_image = images[0]
            cv_image = np.array(pil_image)
            cv_image_rgb = cv_image[:, :, ::-1].copy()
            gray_image = cv2.cvtColor(cv_image_rgb, cv2.COLOR_BGR2GRAY)
            blurred_image = cv2.medianBlur(gray_image, 5)

            # Define cropped ROI
            x1 = max(0, int(x_center - SEARCH_RADIUS_PX))
            y1 = max(0, int(y_center - SEARCH_RADIUS_PX))
            x2 = min(pil_image.width, int(x_center + SEARCH_RADIUS_PX))
            y2 = min(pil_image.height, int(y_center + SEARCH_RADIUS_PX))
            
            cropped_image = blurred_image[y1:y2, x1:x2]
            
            # Search for circles in ROI
            circles_in_roi = cv2.HoughCircles(
                cropped_image,
                cv2.HOUGH_GRADIENT,
                dp=1,                  
                minDist=15,             
                param1=80,              
                param2=30,              
                minRadius=30,           
                maxRadius=80            
            )

            if circles_in_roi is not None:
                circles_in_roi = np.uint16(np.around(circles_in_roi))[0]
                
                min_distance = float('inf')
                best_radius = None
                
                target_center_x_rel = x_center - x1
                target_center_y_rel = y_center - y1
                
                for x_rel, y_rel, radius in circles_in_roi:
                    # FIX: Cast to float to prevent uint16 overflow during subtraction
                    distance = math.sqrt((float(x_rel) - target_center_x_rel)**2 + (float(y_rel) - target_center_y_rel)**2)
                    
                    if distance < min_distance:
                        min_distance = distance
                        best_radius = radius
                
                if best_radius is not None:
                    # FIX: Cast to standard Python int to avoid JSON serialization errors
                    return int(best_radius)
            
            return None 

        except Exception as e:
            logger.warning(f"Error during calibration point search: {e}", exc_info=True)
            return None


    def process_pid_file(self, pid_file_path, filename_base, status_update_fn, calibration_radius, output_folder=None, default_area_code=None, legend_df=None):
        """
        Main method to process a single P&ID file.
        Accepts 'default_area_code' to handle tags without area prefix.
        """
        logger.info(f"Starting processing for P&ID: {filename_base}.pdf with Calibrated R={calibration_radius}")

        # Resolve legend per-request — never touch shared state
        _legend_df, _legend_types = self._parse_legend(legend_df if legend_df is not None else pd.DataFrame())

        config_params = self.config_defaults.copy()
        
        all_instruments_data = []
        all_lines_data = []
        all_equipment_data = []
        debug_output_images = []
        _rl = _RunLogger(filename_base) if _RunLogger else None

        try:
            # --- Dynamic Radius Determination ---
            if calibration_radius is None:
                status_update_fn("ERROR: Calibration radius is missing.")
                if _rl:
                    _rl.flush()
                return pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), []
            
            dynamic_min_radius, dynamic_max_radius = _calculate_dynamic_radius(
                calibration_radius, config_params
            )
            status_update_fn(f"Calculated search range: {dynamic_min_radius}-{dynamic_max_radius}px.")

            with open(pid_file_path, 'rb') as f:
                pdf_content = f.read()

            # --- OCR Pipeline (Vision API) ---
            # process_pid_file is only called by the task when PyMuPDF already
            # failed or found nothing — so we go straight to OCR here.
            if _rl:
                _rl.log_path("ocr")
            status_update_fn("Starting PDF conversion (DPI 300)...")
            if self.poppler_path:
                images = convert_from_bytes(pdf_content, dpi=config_params['PDF_DPI'], poppler_path=self.poppler_path)
            else:
                images = convert_from_bytes(pdf_content, dpi=config_params['PDF_DPI'])

            if not images:
                status_update_fn("ERROR: No images converted from PDF.")
                if _rl:
                    _rl.flush()
                return pd.DataFrame(), pd.DataFrame(), pd.DataFrame(), []

            status_update_fn(f"PDF converted to {len(images)} page(s).")

            try:
                font = ImageFont.truetype("arial.ttf", 30 if self.debug_mode else 24)
            except Exception:
                font = ImageFont.load_default()

            for page_idx, pil_image in enumerate(images):
                page_number = page_idx + 1
                page_filename_base = f"{filename_base}_p{page_number}"

                cv_image = np.array(pil_image)
                cv_image_rgb = cv_image[:, :, ::-1].copy()
                gray_image = cv2.cvtColor(cv_image_rgb, cv2.COLOR_BGR2GRAY)
                blurred_image_page = cv2.medianBlur(gray_image, 5)

                extraction_result = extract_instruments(
                    pil_image=pil_image,
                    blurred_image=blurred_image_page,
                    dynamic_min_radius=dynamic_min_radius,
                    dynamic_max_radius=dynamic_max_radius,
                    legend_df=_legend_df,
                    legend_types=_legend_types,
                    filename_base=page_filename_base,
                    config_params=config_params,
                    debug_params=self.debug_params,
                    font=font,
                    status_update_fn=lambda msg: status_update_fn(f"L2 P{page_number}: {msg}"),
                    output_folder=output_folder,
                    default_area_code=default_area_code,
                )
                if len(extraction_result) == 3:
                    final_instruments_df_page, page_lines_df, page_equipment_df = extraction_result
                else:
                    final_instruments_df_page, page_lines_df = extraction_result
                    page_equipment_df = pd.DataFrame()

                if _rl:
                    _rl.log_lines(page_number, list(page_lines_df["Line_Number"].astype(str)) if not page_lines_df.empty else [])
                    _tag_col_ocr = "Tag_Number" if "Tag_Number" in final_instruments_df_page.columns else "Instrument_Tag"
                    _rl.log_instruments(page_number, list(final_instruments_df_page[_tag_col_ocr].astype(str)) if not final_instruments_df_page.empty else [])

                if not final_instruments_df_page.empty:
                    final_instruments_df_page['P&ID_Page'] = page_number

                    if _LLM_AVAILABLE and not page_lines_df.empty:
                        try:
                            final_instruments_df_page = _llm_map(
                                final_instruments_df_page,
                                page_lines_df,
                                status_fn=lambda msg: status_update_fn(f"LLM P{page_number}: {msg}"),
                                run_logger=_rl,
                                page=page_number,
                            )
                        except Exception as _llm_exc:
                            status_update_fn(f"LLM mapping skipped (non-fatal): {_llm_exc}")

                    all_instruments_data.append(final_instruments_df_page)

                if not page_lines_df.empty:
                    all_lines_data.append(page_lines_df)
                if not page_equipment_df.empty:
                    all_equipment_data.append(page_equipment_df)

                if self.debug_mode:
                    debug_img_path = os.path.join(
                        self.debug_output_folder,
                        f"{page_filename_base}_circles_detected.jpg"
                    )
                    pil_image.save(debug_img_path, "JPEG")
                    debug_output_images.append(f"{page_filename_base}_circles_detected.jpg")

                count = len(final_instruments_df_page) if not final_instruments_df_page.empty else 0
                status_update_fn(f"Page {page_number}: {count} instruments extracted.")

            # --- Final Combination and Deduplication ---

            final_lines_df = (
                pd.concat(all_lines_data, ignore_index=True)
                .drop_duplicates(subset=['Line_Number'])
                if all_lines_data else pd.DataFrame()
            )
            final_equipment_df = (
                pd.concat(all_equipment_data, ignore_index=True)
                .drop_duplicates(subset=['Equipment_Tag', 'P&ID_Page'])
                if all_equipment_data else pd.DataFrame()
            )

            if all_instruments_data:
                final_instruments_df = pd.concat(all_instruments_data, ignore_index=True)

                dedup_subset = []
                if 'Tag_Number' in final_instruments_df.columns:
                    dedup_subset = ['Tag_Number', 'Coordinates', 'P&ID_Page']
                else:
                    dedup_subset = ['Instrument_Tag', 'P&ID_Page']

                if dedup_subset:
                    final_instruments_df.drop_duplicates(
                        subset=dedup_subset,
                        keep='first',
                        inplace=True
                    )

                cols = final_instruments_df.columns.tolist()
                if 'P&ID_Page' in cols:
                    cols.remove('P&ID_Page')
                    if 'P&ID_Filename' in cols:
                        file_idx = cols.index('P&ID_Filename')
                        cols.insert(file_idx + 1, 'P&ID_Page')
                    else:
                        cols.insert(0, 'P&ID_Page')
                    final_instruments_df = final_instruments_df[cols]

                status_update_fn(
                    f"Finished processing. Total instruments: {len(final_instruments_df)}, "
                    f"line numbers: {len(final_lines_df)}."
                )
                if _rl:
                    _rl.flush()
                return final_instruments_df, final_lines_df, final_equipment_df, debug_output_images
            else:
                status_update_fn("Finished processing. No instruments found.")
                if _rl:
                    _rl.flush()
                return pd.DataFrame(), final_lines_df, final_equipment_df, debug_output_images

        except Exception as e:
            status_update_fn(f"CRITICAL ERROR: {e.__class__.__name__}. See console for details.")
            logger.error(f"Error processing {filename_base}.pdf: {e}", exc_info=True)
            if _rl:
                _rl.flush()
            return pd.DataFrame(), pd.DataFrame(), debug_output_images
