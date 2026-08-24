from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict

from app.modules.instruments import service

router = APIRouter()
PREFIX = "/api/v1/instruments"
TAGS = ["Instruments"]


def _user_id(request: Request) -> str:
    user = getattr(request.state, "user", None)
    return str(getattr(user, "id", "local-user"))


class InstrumentCreate(BaseModel):
    model_config = ConfigDict(extra="allow")
    project_id: str
    tag_number: str
    instrument_type: Optional[str] = None


class InstrumentUpdate(BaseModel):
    model_config = ConfigDict(extra="allow")


@router.get("", tags=TAGS)
async def list_instruments(
    project_id: str = Query(...),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=5000),
    sort_by: str = Query("tag_number"),
    sort_dir: str = Query("asc"),
    status: Optional[str] = Query(None),
    review_required: Optional[bool] = Query(None),
    active_on_pid: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
) -> dict:
    return service.list_instruments(
        project_id=project_id,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_dir=sort_dir,
        status=status,
        review_required=review_required,
        active_on_pid=active_on_pid,
        search=search,
    )


@router.get("/lookups", tags=TAGS)
async def get_lookups(project_id: str = Query(...)) -> dict:
    return service.get_lookups(project_id)


@router.get("/projects", tags=TAGS)
async def list_projects() -> list[dict]:
    return service.list_projects()


@router.get("/{instrument_id}", tags=TAGS)
async def get_instrument(instrument_id: str) -> dict:
    row = service.get_instrument(instrument_id)
    if not row:
        raise HTTPException(status_code=404, detail="Instrument not found")
    return row


@router.post("", tags=TAGS, status_code=201)
async def create_instrument(request: Request, body: InstrumentCreate) -> dict:
    return service.create_instrument(body.model_dump(exclude_none=True), _user_id(request))


@router.patch("/{instrument_id}", tags=TAGS)
async def update_instrument(request: Request, instrument_id: str, body: InstrumentUpdate) -> dict:
    row = service.update_instrument(instrument_id, body.model_dump(exclude_none=True), _user_id(request))
    if not row:
        raise HTTPException(status_code=404, detail="Instrument not found")
    return row


@router.delete("/{instrument_id}", tags=TAGS, status_code=204)
async def delete_instrument(instrument_id: str):
    if not service.delete_instrument(instrument_id):
        raise HTTPException(status_code=404, detail="Instrument not found")
