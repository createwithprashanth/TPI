"""
InstruMap API routes — white-label edition.
No authentication, no Supabase, local file serving.
"""
import base64
import io
import logging
import os
import uuid
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pdf2image import convert_from_bytes

from app.modules.instrumap.core import config as instrumap_config
from app.config.redis_client import get_instrumap_queue, get_redis_connection, is_redis_available
from app.workers.instrumap_tasks import process_pid_task, BATCH_OUTPUT_BASE
from app.modules.instrumap.core.piping_mto import detect_symbol as _detect_piping_symbol, detect_all_pages as _detect_all_pages

logger = logging.getLogger(__name__)

router = APIRouter()

PREFIX = "/api/v1/instrumap"
TAGS = ["InstruMap"]


@router.post("/preview", response_model=dict, tags=TAGS)
async def generate_preview(pid_file: UploadFile = File(...)) -> dict:
    pid_temp_path = None
    try:
        content = await pid_file.read()
        suffix = Path(pid_file.filename or "pid.pdf").suffix
        with NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(content)
            pid_temp_path = tmp.name

        images = convert_from_bytes(
            content,
            dpi=instrumap_config.PDF_DPI,
            poppler_path=instrumap_config.POPPLER_PATH,
            first_page=1,
            last_page=1,
        )
        if not images:
            raise HTTPException(status_code=400, detail="PDF conversion failed.")

        buf = io.BytesIO()
        images[0].save(buf, format="JPEG", quality=85)
        b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
        import fitz as _fitz
        _doc = _fitz.open(stream=content, filetype="pdf")
        page_count = len(_doc)
        _doc.close()
        return {"status": "SUCCESS", "base64_image": b64, "page_count": page_count}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if pid_temp_path and os.path.exists(pid_temp_path):
            os.remove(pid_temp_path)


@router.post("/process-async", response_model=dict, tags=TAGS)
async def process_instrumap_async(
    pid_file: UploadFile = File(...),
    calibration_x: Optional[int] = Form(None),
    calibration_y: Optional[int] = Form(None),
    user_selected_radius: Optional[float] = Form(None),
    batch_id: Optional[str] = Form(None),
    area_code: Optional[str] = Form(None),
    project_name: Optional[str] = Form(None),
    project_no: Optional[str] = Form(None),
    client_name: Optional[str] = Form(None),
    contractor_name: Optional[str] = Form(None),
    location: Optional[str] = Form(None),
    # Ignored in white-label edition (kept for frontend compat)
    project_id: Optional[str] = Form(None),
    legend_job_id: Optional[str] = Form(None),
) -> dict:
    if not is_redis_available():
        raise HTTPException(status_code=503, detail="Background processing unavailable. Redis not connected.")

    try:
        job_id = str(uuid.uuid4())
        final_batch_id = batch_id or f"batch_{job_id[:8]}"
        pdf_content = await pid_file.read()
        pdf_filename = pid_file.filename or "drawing.pdf"

        queue = get_instrumap_queue()
        queue.enqueue(
            process_pid_task,
            kwargs={
                "job_id": job_id,
                "pdf_content": pdf_content,
                "pdf_filename": pdf_filename,
                "batch_id": final_batch_id,
                "calibration_x": calibration_x,
                "calibration_y": calibration_y,
                "user_selected_radius": user_selected_radius,
                "area_code": area_code,
                "project_name": project_name,
                "project_no": project_no,
                "client_name": client_name,
                "contractor_name": contractor_name,
                "location": location,
            },
            job_timeout=3600,
            job_id=job_id,
        )

        logger.info(f"Job {job_id} queued for batch {final_batch_id}")
        return {
            "status": "queued",
            "job_id": job_id,
            "batch_id": final_batch_id,
            "message": f"Job queued. Poll GET /api/v1/instrumap/job/{job_id} for status.",
        }
    except Exception as e:
        logger.error(f"Failed to enqueue job: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/job/{job_id}", response_model=dict, tags=TAGS)
async def get_job_status(job_id: str) -> dict:
    if not is_redis_available():
        raise HTTPException(status_code=503, detail="Redis not connected.")

    try:
        import json as _json
        from rq.job import Job

        redis_conn = get_redis_connection()
        job = Job.fetch(job_id, connection=redis_conn)
        status = job.get_status()

        response: dict = {
            "job_id": job_id,
            "status": status,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "ended_at": job.ended_at.isoformat() if job.ended_at else None,
        }

        if job.is_queued:
            response["position_in_queue"] = job.get_position()

        if status in ("queued", "started"):
            raw = redis_conn.get(f"instrumap:progress:{job_id}") if redis_conn else None
            if raw:
                progress = _json.loads(raw)
                response["progress"] = {
                    "stage": progress.get("stage"),
                    "message": progress.get("message"),
                    "estimated_seconds_remaining": progress.get("estimated_seconds_remaining"),
                }

        if job.is_finished:
            result = job.result or {}
            response["result"] = result
            batch_id_done = result.get("batch_id")
            if batch_id_done and result.get("status") not in ("needs_calibration", "failed"):
                response["download_ready"] = True
                response["download_endpoint"] = f"/api/v1/instrumap/download/{batch_id_done}"

        if job.is_failed:
            response["error"] = str(job.exc_info) if job.exc_info else "Unknown error"

        return response

    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Job not found: {str(e)}")


@router.post("/piping-mto/detect", tags=TAGS)
async def detect_piping_symbol(
    pid_file: UploadFile = File(...),
    template_x1: int = Form(...),
    template_y1: int = Form(...),
    template_x2: int = Form(...),
    template_y2: int = Form(...),
    search_x1: Optional[int] = Form(None),
    search_y1: Optional[int] = Form(None),
    search_x2: Optional[int] = Form(None),
    search_y2: Optional[int] = Form(None),
    threshold: float = Form(0.70),
    label: str = Form("Symbol"),
) -> dict:
    try:
        content = await pid_file.read()
        search_box = (
            (search_x1, search_y1, search_x2, search_y2)
            if all(v is not None for v in [search_x1, search_y1, search_x2, search_y2])
            else None
        )
        result = _detect_piping_symbol(
            pdf_bytes=content,
            template_box=(template_x1, template_y1, template_x2, template_y2),
            search_box=search_box,
            threshold=threshold,
            label=label,
        )
        return {"status": "SUCCESS", **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Piping MTO detection failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/piping-mto/detect-all-pages", tags=TAGS)
async def detect_piping_all_pages(
    pid_file: UploadFile = File(...),
    template_x1: int = Form(...),
    template_y1: int = Form(...),
    template_x2: int = Form(...),
    template_y2: int = Form(...),
    threshold: float = Form(0.70),
    label: str = Form("Symbol"),
) -> dict:
    try:
        content = await pid_file.read()
        result = _detect_all_pages(
            pdf_bytes=content,
            template_box=(template_x1, template_y1, template_x2, template_y2),
            threshold=threshold,
            label=label,
        )
        return {"status": "SUCCESS", **result}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"All-pages piping MTO failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/highlighted/{batch_id}", tags=TAGS)
async def download_highlighted_image(batch_id: str):
    import glob
    batch_dir = os.path.join(BATCH_OUTPUT_BASE, batch_id)
    if not os.path.isdir(batch_dir):
        raise HTTPException(status_code=404, detail="Batch not found.")
    matches = glob.glob(os.path.join(batch_dir, "*_p1_highlighted.jpg"))
    if not matches:
        raise HTTPException(status_code=404, detail="Highlighted image not available.")
    return FileResponse(matches[0], media_type="image/jpeg", filename=os.path.basename(matches[0]))


@router.get("/download/{batch_id}", tags=TAGS)
async def download_batch_results(batch_id: str):
    batch_dir = os.path.join(BATCH_OUTPUT_BASE, batch_id)
    zip_filename = f"InstruMap_Results_{batch_id}.zip"
    zip_path = os.path.join(batch_dir, zip_filename)

    if not os.path.exists(zip_path):
        raise HTTPException(status_code=404, detail="Results not found or still processing.")

    return FileResponse(
        zip_path,
        filename=zip_filename,
        media_type="application/zip",
    )
