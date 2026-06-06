from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.modules.ai_engineers.contracts import EngineerRole
from app.modules.project_intelligence import service

PREFIX = "/api/v1/project-intelligence"
router = APIRouter()
TAGS = ["Project Intelligence"]


class ProjectQueryRequest(BaseModel):
    project_id: str
    engineer: EngineerRole = "instrumentation"
    question: str = ""
    limit: int = Field(default=20, ge=1, le=80)
    use_model: bool = True


@router.get("/memory", tags=TAGS)
async def get_memory(
    project_id: str = Query(...),
    sample_limit: int = Query(12, ge=1, le=50),
) -> dict:
    return service.get_project_memory(project_id, sample_limit=sample_limit)


@router.post("/query", tags=TAGS)
async def query_memory(body: ProjectQueryRequest) -> dict:
    return await service.query_project_memory(
        project_id=body.project_id,
        engineer=body.engineer,
        question=body.question,
        limit=body.limit,
        use_model=body.use_model,
    )
