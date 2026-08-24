"""
P&ID Analyser — business logic layer.
Routes delegate here; this layer owns all orchestration.
"""
import asyncio
import base64
import io
import json
import logging
import os
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import HTTPException

from app.config.redis_client import get_instrumap_queue, get_redis_connection, is_redis_available
from app.config.settings import settings
from app.workers.instrumap_tasks import process_pid_task, BATCH_OUTPUT_BASE
from app.modules.pid_analyser.schemas import (
    PreviewResponse, ProcessResponse, JobStatusResponse, JobProgress,
)

logger = logging.getLogger(__name__)

_preview_executor = ThreadPoolExecutor(max_workers=max(2, (os.cpu_count() or 2) - 1))

# ── In-memory job store (used when Redis is unavailable) ──────────────────────
_inmem_jobs: dict[str, dict] = {}
_inmem_lock = threading.Lock()
_inmem_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="inmem-worker")


def _run_inmem_job(job_id: str, kwargs: dict) -> None:
    with _inmem_lock:
        _inmem_jobs[job_id]["status"] = "started"
    try:
        result = process_pid_task(**kwargs)
        with _inmem_lock:
            _inmem_jobs[job_id]["status"] = "finished"
            _inmem_jobs[job_id]["result"] = result
    except Exception as exc:
        logger.error("In-memory job %s failed: %s", job_id, exc, exc_info=True)
        with _inmem_lock:
            _inmem_jobs[job_id]["status"] = "failed"
            _inmem_jobs[job_id]["error"] = str(exc)


def _do_preview(content: bytes, page: int = 1) -> PreviewResponse:
    import fitz
    doc = fitz.open(stream=content, filetype="pdf")
    page_count = len(doc)
    preview_page = max(1, min(page, page_count or 1))
    mat = fitz.Matrix(settings.PDF_DPI / 72, settings.PDF_DPI / 72)
    pix = doc[preview_page - 1].get_pixmap(matrix=mat, alpha=False)
    doc.close()
    buf = io.BytesIO(pix.tobytes("jpeg"))
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
    return PreviewResponse(status="SUCCESS", base64_image=b64, page_count=page_count)


async def generate_preview(content: bytes, page: int = 1) -> PreviewResponse:
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(_preview_executor, _do_preview, content, page)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


async def enqueue_process(
    pdf_content: bytes,
    pdf_filename: str,
    calibration_x: int | None,
    calibration_y: int | None,
    user_selected_radius: float | None,
    batch_id: str | None,
    area_code: str | None,
    german_pid: bool = False,
    project_name: str | None = None,
    project_no: str | None = None,
    client_name: str | None = None,
    contractor_name: str | None = None,
    location: str | None = None,
    project_legend_notes: str | None = None,
) -> ProcessResponse:
    job_id = str(uuid.uuid4())
    final_batch_id = batch_id or f"batch_{job_id[:8]}"
    kwargs = dict(
        job_id=job_id,
        pdf_content=pdf_content,
        pdf_filename=pdf_filename,
        batch_id=final_batch_id,
        calibration_x=calibration_x,
        calibration_y=calibration_y,
        user_selected_radius=user_selected_radius,
        area_code=area_code,
        german_pid=german_pid,
        project_name=project_name,
        project_no=project_no,
        client_name=client_name,
        contractor_name=contractor_name,
        location=location,
        project_legend_notes=project_legend_notes,
    )

    if not is_redis_available():
        # Run in-process using a thread pool — no Redis or external worker needed.
        with _inmem_lock:
            _inmem_jobs[job_id] = {"status": "queued", "result": None, "error": None}
        _inmem_executor.submit(_run_inmem_job, job_id, kwargs)
        logger.info("Job %s submitted to in-memory executor (Redis unavailable)", job_id)
        return ProcessResponse(
            status="queued",
            job_id=job_id,
            batch_id=final_batch_id,
            message=f"Job queued (in-process). Poll GET /api/v1/pid/job/{job_id} for status.",
        )

    try:
        queue = get_instrumap_queue()
        queue.enqueue(process_pid_task, kwargs=kwargs, job_timeout=3600, job_id=job_id)
        logger.info("Job %s queued for batch %s", job_id, final_batch_id)
        return ProcessResponse(
            status="queued",
            job_id=job_id,
            batch_id=final_batch_id,
            message=f"Job queued. Poll GET /api/v1/pid/job/{job_id} for status.",
        )
    except Exception as e:
        logger.error("Failed to enqueue job: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


async def get_job_status(job_id: str) -> JobStatusResponse:
    if not is_redis_available():
        with _inmem_lock:
            job = _inmem_jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found.")
        response = JobStatusResponse(job_id=job_id, status=job["status"])
        if job["status"] == "finished":
            response.result = job["result"]
            bid = (job["result"] or {}).get("batch_id")
            if bid:
                response.download_ready = True
                response.download_endpoint = f"/api/v1/pid/download/{bid}"
        elif job["status"] == "failed":
            response.error = job.get("error", "Processing failed.")
        return response

    try:
        from rq.job import Job

        redis_conn = get_redis_connection()
        job = Job.fetch(job_id, connection=redis_conn)
        status = job.get_status()

        response = JobStatusResponse(
            job_id=job_id,
            status=status,
            created_at=job.created_at.isoformat() if job.created_at else None,
            started_at=job.started_at.isoformat() if job.started_at else None,
            ended_at=job.ended_at.isoformat() if job.ended_at else None,
        )

        if job.is_queued:
            response.position_in_queue = job.get_position()

        if status in ("queued", "started"):
            raw = redis_conn.get(f"instrumap:progress:{job_id}") if redis_conn else None
            if raw:
                p = json.loads(raw)
                response.progress = JobProgress(
                    stage=p.get("stage", ""),
                    message=p.get("message", ""),
                    estimated_seconds_remaining=p.get("estimated_seconds_remaining"),
                )

        if job.is_finished:
            result = job.result or {}
            response.result = result
            batch_id_done = result.get("batch_id")
            if batch_id_done and result.get("status") not in ("needs_calibration", "failed"):
                response.download_ready = True
                response.download_endpoint = f"/api/v1/pid/download/{batch_id_done}"

        if job.is_failed:
            response.error = str(job.exc_info) if job.exc_info else "Unknown error"

        return response
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Job not found: {e}")


def get_highlighted_path(batch_id: str) -> str:
    import glob
    batch_dir = os.path.join(BATCH_OUTPUT_BASE, batch_id)
    if not os.path.isdir(batch_dir):
        raise HTTPException(status_code=404, detail="Batch not found.")
    matches = glob.glob(os.path.join(batch_dir, "*_checkprint.pdf"))
    if not matches:
        raise HTTPException(status_code=404, detail="Checkprint PDF not available.")
    return matches[0]


def get_download_path(batch_id: str) -> str:
    batch_dir = os.path.join(BATCH_OUTPUT_BASE, batch_id)
    zip_path = os.path.join(batch_dir, f"InstruMap_Results_{batch_id}.zip")
    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="Results not found or still processing.")
    return zip_path
