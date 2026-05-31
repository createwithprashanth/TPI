from typing import Optional

from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import FileResponse

from app.modules.piping_mto import service
from app.modules.piping_mto.schemas import CreateSymbolRequest, ExportPackageRequest, UpdateSymbolRequest

router = APIRouter()
PREFIX = "/api/v1/mto"
TAGS = ["Piping MTO"]


# ── Symbol Library ─────────────────────────────────────────────────────────────

@router.get("/library", tags=TAGS)
async def get_library() -> list:
    return service.read_library()


@router.post("/library", tags=TAGS)
async def add_library_symbol(payload: CreateSymbolRequest) -> dict:
    return service.add_symbol(payload.model_dump())


@router.put("/library/{symbol_id}", tags=TAGS)
async def update_library_symbol(symbol_id: str, payload: UpdateSymbolRequest) -> dict:
    return service.update_symbol(symbol_id, payload.model_dump(exclude_none=True))


@router.delete("/library/{symbol_id}", tags=TAGS)
async def delete_library_symbol(symbol_id: str) -> dict:
    return service.delete_symbol(symbol_id)


@router.post("/export-package", tags=TAGS)
async def export_package(payload: ExportPackageRequest):
    path = service.build_export_package(payload.model_dump())
    return FileResponse(
        path,
        filename=path.name,
        media_type="application/zip",
    )


# ── Detection ──────────────────────────────────────────────────────────────────

@router.post("/detect", tags=TAGS)
async def detect_symbol(
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
    coord_dpi: int = Form(300),
) -> dict:
    content = await pid_file.read()
    search_box = (
        (search_x1, search_y1, search_x2, search_y2)
        if all(v is not None for v in [search_x1, search_y1, search_x2, search_y2])
        else None
    )
    result = await service.detect(
        pdf_bytes=content,
        template_box=(template_x1, template_y1, template_x2, template_y2),
        search_box=search_box,
        threshold=threshold,
        label=label,
        coord_dpi=coord_dpi,
    )
    return {"status": "SUCCESS", **result}


@router.post("/detect-all-pages", tags=TAGS)
async def detect_all_pages(
    pid_file: UploadFile = File(...),
    template_x1: int = Form(...),
    template_y1: int = Form(...),
    template_x2: int = Form(...),
    template_y2: int = Form(...),
    threshold: float = Form(0.70),
    label: str = Form("Symbol"),
    coord_dpi: int = Form(300),
) -> dict:
    content = await pid_file.read()
    result = await service.detect_all_pages(
        pdf_bytes=content,
        template_box=(template_x1, template_y1, template_x2, template_y2),
        threshold=threshold,
        label=label,
        coord_dpi=coord_dpi,
    )
    return {"status": "SUCCESS", **result}


@router.post("/detect-from-library", tags=TAGS)
async def detect_from_library(
    pid_file: UploadFile = File(...),
    template_image: UploadFile = File(...),
    threshold: float = Form(0.70),
    label: str = Form("Symbol"),
    template_dpi: int = Form(300),
) -> dict:
    pdf_content = await pid_file.read()
    tmpl_content = await template_image.read()
    result = await service.detect_from_library(
        pdf_bytes=pdf_content,
        template_bytes=tmpl_content,
        threshold=threshold,
        label=label,
        template_dpi=template_dpi,
    )
    return {"status": "SUCCESS", **result}
