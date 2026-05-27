"""
InstruMap background worker — white-label edition.
No LLM enrichment. No Supabase. Results stored locally.
"""
import json
import logging
import os
import shutil
import time
import zipfile
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any, Dict, Optional

import pandas as pd
from pdf2image import convert_from_bytes

from app.modules.instrumap.core.instrument_processor import InstrumentProcessor
from app.modules.instrumap.core import config as instrumap_config
from app.modules.instrumap.core.excel_writer import write_engineering_excel
from app.modules.instrumap.core.standard_library import (
    refine_descriptions_by_loop_context,
    compute_programmatic_fields,
)
from app.modules.instrumap.core.tag_validator import validate_tag_formats

logger = logging.getLogger(__name__)


BATCH_OUTPUT_BASE = os.path.join(os.getcwd(), "batch_outputs")
os.makedirs(BATCH_OUTPUT_BASE, exist_ok=True)

_STAGE_ESTIMATES = {
    "calibration": 10,
    "extraction": 90,
    "excel": 10,
    "zip": 5,
}
_STAGES_ORDER = list(_STAGE_ESTIMATES.keys())


class _Timer:
    def __init__(self):
        self.elapsed: float = 0.0

    def __enter__(self):
        self._start = time.perf_counter()
        return self

    def __exit__(self, *_):
        self.elapsed = time.perf_counter() - self._start


def _progress_key(job_id: str) -> str:
    return f"instrumap:progress:{job_id}"


def _report_progress(job_id: str, stage: str, message: str, override_remaining: Optional[int] = None) -> None:
    try:
        from app.config.redis_client import get_redis_connection
        redis = get_redis_connection()
        if not redis:
            return
        stage_idx = _STAGES_ORDER.index(stage) if stage in _STAGES_ORDER else 0
        remaining = override_remaining if override_remaining is not None else sum(
            _STAGE_ESTIMATES.get(s, 0) for s in _STAGES_ORDER[stage_idx:]
        )
        redis.setex(
            _progress_key(job_id),
            3600,
            json.dumps({
                "stage": stage,
                "message": message,
                "updated_at": time.time(),
                "estimated_seconds_remaining": remaining,
            }),
        )
    except Exception:
        pass


def _auto_detect_radius(pdf_content: bytes, poppler_path, target_dpi: int = 300) -> Optional[int]:
    try:
        import cv2
        import numpy as np
        from collections import Counter

        pages = convert_from_bytes(pdf_content, dpi=150, poppler_path=poppler_path, first_page=1, last_page=1)
        if not pages:
            return None
        img = np.array(pages[0])
        gray = cv2.cvtColor(img[:, :, ::-1].copy(), cv2.COLOR_BGR2GRAY)
        blurred = cv2.medianBlur(gray, 5)
        circles = cv2.HoughCircles(
            blurred, cv2.HOUGH_GRADIENT, dp=1, minDist=10,
            param1=60, param2=22, minRadius=5, maxRadius=80,
        )
        if circles is None:
            return None
        rounded = [round(int(c[2]) / 2) * 2 for c in circles[0]]
        if not rounded:
            return None
        modal_r = Counter(rounded).most_common(1)[0][0]
        return max(1, round(modal_r * target_dpi / 150))
    except Exception as exc:
        logger.warning(f"Auto-calibration failed: {exc}")
        return None


def process_pid_task(
    job_id: str,
    pdf_content: bytes,
    pdf_filename: str,
    batch_id: str,
    calibration_x: Optional[int] = None,
    calibration_y: Optional[int] = None,
    user_selected_radius: Optional[float] = None,
    area_code: Optional[str] = None,
    project_name: Optional[str] = None,
    project_no: Optional[str] = None,
    client_name: Optional[str] = None,
    contractor_name: Optional[str] = None,
    location: Optional[str] = None,
) -> Dict[str, Any]:
    pid_temp_path = None
    _rl = None  # telemetry logger — flushed in finally

    try:
        logger.info(f"[Job {job_id}] Starting P&ID processing for batch {batch_id}")

        batch_dir = os.path.join(BATCH_OUTPUT_BASE, batch_id)
        os.makedirs(batch_dir, exist_ok=True)

        processor = InstrumentProcessor()

        pid_filename_base = Path(pdf_filename).stem if pdf_filename else "pid"
        suffix = Path(pdf_filename).suffix if pdf_filename else ".pdf"

        try:
            from app.modules.telemetry import RunLogger
            _rl = RunLogger(pid_filename_base)
        except Exception:
            pass

        with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(pdf_content)
            pid_temp_path = tmp.name

        # ── PyMuPDF first pass (vector PDFs, no calibration needed) ─────────
        results_df = pd.DataFrame()
        lines_df = pd.DataFrame()
        _pymupdf_succeeded = False
        final_calibration_radius = None

        if instrumap_config.USE_PYMUPDF:
            try:
                from app.modules.instrumap.core.level2_extraction_pymupdf import extract_from_pdf as _pymupdf_extract
                _report_progress(job_id, "extraction", "Extracting instruments from P&ID…")
                results_df, lines_df, _stats = _pymupdf_extract(
                    pdf_path=pid_temp_path,
                    filename_base=pid_filename_base,
                    calibration_radius_px=None,
                    default_area_code=area_code,
                    dpi=instrumap_config.PDF_DPI,
                )
                if not results_df.empty:
                    _pymupdf_succeeded = True
                    if _rl:
                        _rl.log_path("pymupdf")
                    logger.info(f"[Job {job_id}] PyMuPDF: {len(results_df)} instruments found")

                    # Geometry-based line mapping (vector path)
                    if not lines_df.empty:
                        try:
                            from app.modules.instrumap.core.line_mapper import map_instruments_to_lines
                            results_df = map_instruments_to_lines(
                                results_df, lines_df, pid_temp_path, instrumap_config.PDF_DPI,
                            )
                            matched = (results_df.get("Connected_Line", pd.Series()) != "").sum()
                            logger.info(f"[Job {job_id}] Line mapper: {matched}/{len(results_df)} matched")
                        except Exception as lm_exc:
                            logger.warning(f"[Job {job_id}] Line mapping failed (non-fatal): {lm_exc}")

                    if _rl:
                        if not lines_df.empty and "Line_Number" in lines_df.columns:
                            _rl.log_lines(1, list(lines_df["Line_Number"].astype(str)))
                        _rl.log_instruments(1, list(results_df["Tag_Number"].astype(str)))


                    try:
                        processor._render_pymupdf_highlights(
                            pdf_content, results_df, batch_dir,
                            pid_filename_base, instrumap_config.PDF_DPI,
                        )
                    except Exception as he:
                        logger.warning(f"[Job {job_id}] Highlight generation failed: {he}")
                else:
                    logger.info(f"[Job {job_id}] PyMuPDF found 0 tags — trying OCR")
            except Exception as exc:
                logger.warning(f"[Job {job_id}] PyMuPDF failed: {exc}")

        # ── OCR fallback ─────────────────────────────────────────────────────
        if not _pymupdf_succeeded:
            if _rl:
                _rl.log_path("ocr")
            final_calibration_radius = user_selected_radius

            _report_progress(job_id, "calibration", "Calibrating instrument circle size…")
            if final_calibration_radius is None and calibration_x is not None:
                measured = processor.find_radius_from_point(
                    pid_temp_path, calibration_x, calibration_y, instrumap_config.POPPLER_PATH,
                )
                if measured:
                    final_calibration_radius = measured
                else:
                    return {
                        "status": "failed",
                        "job_id": job_id,
                        "batch_id": batch_id,
                        "error": "Calibration failed. Could not detect radius from the selected point.",
                    }

            if final_calibration_radius is None:
                final_calibration_radius = _auto_detect_radius(pdf_content, instrumap_config.POPPLER_PATH)

            if final_calibration_radius is None:
                return {
                    "status": "needs_calibration",
                    "job_id": job_id,
                    "batch_id": batch_id,
                    "message": "Could not detect instrument circles automatically. Click an instrument symbol.",
                }

            _report_progress(job_id, "extraction", "Extracting instruments from P&ID…")
            results_df, lines_df, _ = processor.process_pid_file(
                pid_temp_path,
                pid_filename_base,
                lambda m: logger.info(f"[STATUS] {m}"),
                final_calibration_radius,
                batch_dir,
                area_code,
                pd.DataFrame(),
            )

        # Save CSVs
        instruments_count = 0
        results_table = []
        if not results_df.empty:
            instruments_count = len(results_df)
            results_df.to_csv(os.path.join(batch_dir, f"{pid_filename_base}_data.csv"), index=False)
            results_table = results_df.to_dict(orient="records")

        if not lines_df.empty:
            lines_df.to_csv(os.path.join(batch_dir, f"{pid_filename_base}_lines.csv"), index=False)

        # Save batch meta (project details for Excel cover)
        project_info = {
            "project_name": project_name or "",
            "project_no": project_no or "",
            "client_name": client_name or "",
            "contractor_name": contractor_name or "",
            "location": location or "",
        }
        with open(os.path.join(batch_dir, "batch_meta.json"), "w") as f:
            json.dump(project_info, f)

        _report_progress(job_id, "excel", "Building deliverables…")

        # ── Build Excel ───────────────────────────────────────────────────────
        try:
            all_dfs = []
            for fname in sorted(os.listdir(batch_dir)):
                if fname.endswith("_data.csv"):
                    try:
                        all_dfs.append(pd.read_csv(os.path.join(batch_dir, fname)))
                    except Exception:
                        pass

            all_lines = []
            for fname in sorted(os.listdir(batch_dir)):
                if fname.endswith("_lines.csv"):
                    try:
                        all_lines.append(pd.read_csv(os.path.join(batch_dir, fname)))
                    except Exception:
                        pass
            all_lines_df = (
                pd.concat(all_lines, ignore_index=True).drop_duplicates(subset=["Line_Number"])
                if all_lines else pd.DataFrame()
            )

            if all_dfs:
                full_df = pd.concat(all_dfs, ignore_index=True)
                if "Loop" in full_df.columns:
                    full_df["_loop_sort"] = pd.to_numeric(full_df["Loop"], errors="coerce").fillna(0)
                    full_df.sort_values(by=["Area", "_loop_sort", "Type"], inplace=True)
                    full_df.drop(columns=["_loop_sort"], inplace=True)
                master_df = full_df.drop_duplicates(subset=["Tag_Number"]).copy()
                master_df = refine_descriptions_by_loop_context(master_df)
                master_df = compute_programmatic_fields(master_df)

                write_engineering_excel(
                    batch_dir, master_df, full_df,
                    enrichment={},
                    lines_df=all_lines_df,
                    project_info=project_info if any(project_info.values()) else None,
                )
        except Exception as exc:
            logger.error(f"[Job {job_id}] Excel generation failed: {exc}", exc_info=True)

        # ── Create ZIP ────────────────────────────────────────────────────────
        _report_progress(job_id, "zip", "Packaging results…")
        zip_filename = f"InstruMap_Results_{batch_id}.zip"
        zip_path = os.path.join(batch_dir, zip_filename)

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for root, _, files in os.walk(batch_dir):
                for file in files:
                    if file.endswith(".zip") or file == "batch_meta.json":
                        continue
                    fp = os.path.join(root, file)
                    zf.write(fp, os.path.relpath(fp, batch_dir))

        logger.info(f"[Job {job_id}] ZIP created: {zip_path}")

        return {
            "status": "finished",
            "job_id": job_id,
            "batch_id": batch_id,
            "instrument_count": instruments_count,
            "detected_radius": final_calibration_radius,
            "results_table": results_table,
        }

    except Exception as exc:
        logger.error(f"[Job {job_id}] Failed: {exc}", exc_info=True)
        return {
            "status": "failed",
            "job_id": job_id,
            "batch_id": batch_id,
            "error": str(exc),
        }
    finally:
        if _rl:
            try:
                _rl.flush()
            except Exception:
                pass
        if pid_temp_path and os.path.exists(pid_temp_path):
            os.remove(pid_temp_path)
