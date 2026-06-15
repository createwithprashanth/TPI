"""
Cause & Effect Matrix API routes.
"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel

from app.modules.cause_effect import service as ce

PREFIX = "/api/v1/cause-effect"
router = APIRouter()


@router.get("/matrix")
def get_matrix(
    project_id:    str = Query(...),
    system_filter: str | None = Query(None, description="SIS/ESD | F&GS | None for all"),
):
    return ce.get_matrix(project_id, system_filter=system_filter)


class CellBody(BaseModel):
    project_id:    str
    initiator_tag: str
    effect_tag:    str
    action:        str          # "X" | "A" | "I" | "" (empty = delete)
    voting:        str = ""
    notes:         str = ""
    user_id:       str = "local-user"


@router.post("/cell")
def upsert_cell(body: CellBody):
    return ce.upsert_cell(
        project_id    = body.project_id,
        initiator_tag = body.initiator_tag,
        effect_tag    = body.effect_tag,
        action        = body.action,
        voting        = body.voting,
        notes         = body.notes,
        user_id       = body.user_id,
    )


class BulkBody(BaseModel):
    project_id: str
    cells:      list[dict]
    user_id:    str = "local-user"


@router.post("/cells/bulk")
def bulk_upsert(body: BulkBody):
    return ce.bulk_upsert_cells(body.project_id, body.cells, body.user_id)


@router.get("/suggest")
def suggest(project_id: str = Query(...)):
    return {"suggestions": ce.suggest_cells(project_id)}


@router.get("/export")
def export_excel(project_id: str = Query(...)):
    data = ce.export_excel(project_id)
    return Response(
        content     = data,
        media_type  = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers     = {"Content-Disposition": f'attachment; filename="CE_Matrix_{project_id}.xlsx"'},
    )
