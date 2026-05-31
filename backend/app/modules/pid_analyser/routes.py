from typing import Optional

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse

from app.modules.pid_analyser import service
from app.modules.pid_analyser.schemas import (
    JobStatusResponse, PreviewResponse, ProcessResponse,
)

router = APIRouter()
PREFIX = "/api/v1/pid"
TAGS = ["P&ID Analyser"]


@router.post("/preview", response_model=PreviewResponse, tags=TAGS)
async def preview(pid_file: UploadFile = File(...), page: int = Form(1)) -> PreviewResponse:
    content = await pid_file.read()
    return await service.generate_preview(content, page=page)


@router.post("/process", response_model=ProcessResponse, tags=TAGS)
async def process_async(
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
    project_legend_notes: Optional[str] = Form(None),
    # legacy fields — kept for frontend compat
    project_id: Optional[str] = Form(None),
    legend_job_id: Optional[str] = Form(None),
) -> ProcessResponse:
    content = await pid_file.read()
    return await service.enqueue_process(
        pdf_content=content,
        pdf_filename=pid_file.filename or "drawing.pdf",
        calibration_x=calibration_x,
        calibration_y=calibration_y,
        user_selected_radius=user_selected_radius,
        batch_id=batch_id,
        area_code=area_code,
        project_name=project_name,
        project_no=project_no,
        client_name=client_name,
        contractor_name=contractor_name,
        location=location,
        project_legend_notes=project_legend_notes,
    )


@router.get("/job/{job_id}", response_model=JobStatusResponse, tags=TAGS)
async def job_status(job_id: str) -> JobStatusResponse:
    return await service.get_job_status(job_id)


@router.get("/highlighted/{batch_id}", tags=TAGS)
async def highlighted_image(batch_id: str):
    import os
    path = service.get_highlighted_path(batch_id)
    return FileResponse(path, media_type="application/pdf", filename=os.path.basename(path))


@router.get("/download/{batch_id}", tags=TAGS)
async def download_results(batch_id: str):
    path = service.get_download_path(batch_id)
    return FileResponse(path, filename=f"Results_{batch_id}.zip", media_type="application/zip")
