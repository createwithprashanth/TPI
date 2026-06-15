from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import BaseModel, Field

from app.modules.project_knowledge import service

PREFIX = "/api/v1/project-knowledge"
router = APIRouter()
TAGS = ["Project Knowledge"]


class IndexFolderRequest(BaseModel):
    project_id: str = "default"
    folder_path: str
    force: bool = False
    limit: int = Field(default=300, ge=1, le=2000)


class SearchRequest(BaseModel):
    project_id: str = "default"
    query: str
    limit: int = Field(default=10, ge=1, le=50)
    document_type: str = ""


class ChatRequest(BaseModel):
    project_id: str = "default"
    question: str
    limit: int = Field(default=8, ge=1, le=30)
    use_model: bool = True


class SaveEvidenceRequest(BaseModel):
    project_id: str = "default"
    citation: dict
    question: str = ""
    note: str = ""


@router.post("/index-folder", tags=TAGS)
async def index_folder(body: IndexFolderRequest) -> dict:
    try:
        return service.index_folder(
            body.project_id,
            body.folder_path,
            force=body.force,
            limit=body.limit,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/documents", tags=TAGS)
async def list_documents(project_id: str = Query("default")) -> dict:
    return service.list_documents(project_id)


@router.get("/page-image", tags=TAGS)
async def page_image(
    project_id: str = Query("default"),
    document_id: str = Query(...),
    page_number: int = Query(1, ge=1),
    zoom: float = Query(0.75, ge=0.35, le=2.0),
) -> Response:
    try:
        png = service.render_page_image(project_id, document_id, page_number=page_number, zoom=zoom)
        return Response(content=png, media_type="image/png")
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/search", tags=TAGS)
async def search(body: SearchRequest) -> dict:
    return service.search(
        body.project_id,
        body.query,
        limit=body.limit,
        document_type=body.document_type,
    )


@router.post("/chat", tags=TAGS)
async def chat(body: ChatRequest) -> dict:
    return await service.chat(
        body.project_id,
        body.question,
        limit=body.limit,
        use_model=body.use_model,
    )


@router.get("/saved-evidence", tags=TAGS)
async def saved_evidence(project_id: str = Query("default")) -> dict:
    return service.list_saved_evidence(project_id)


@router.post("/saved-evidence", tags=TAGS)
async def save_evidence(body: SaveEvidenceRequest) -> dict:
    try:
        return service.save_evidence(
            body.project_id,
            body.citation,
            question=body.question,
            note=body.note,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/saved-evidence/{saved_id}", tags=TAGS)
async def delete_saved_evidence(saved_id: str, project_id: str = Query("default")) -> dict:
    return service.delete_saved_evidence(project_id, saved_id)
