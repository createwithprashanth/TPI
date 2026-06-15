"""
Datasheet Generator API routes.
"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Any

from app.modules.instruments.service import list_projects
from app.modules.datasheet import service as ds
from app.modules.datasheet.pdf_report import build_datasheet_pdf

PREFIX = "/api/v1/datasheet"
router = APIRouter()


# ── Projects ──────────────────────────────────────────────────────────────────

@router.get("/projects")
def get_projects():
    return {"projects": list_projects()}


# ── Instruments with datasheet status ────────────────────────────────────────

@router.get("/grid")
def get_grid(
    project_id:      str = Query(...),
    instrument_type: str | None = Query(None),
    search:          str | None = Query(None),
    process_case:    str = Query("Normal"),
    page:            int = Query(1, ge=1),
    page_size:       int = Query(500, ge=1, le=1000),
):
    return ds.get_grid_data(
        project_id=project_id,
        instrument_type=instrument_type,
        search=search,
        process_case=process_case,
        page=page,
        page_size=page_size,
    )


@router.get("/instruments")
def list_instruments(
    project_id: str = Query(...),
    search:     str | None = Query(None),
    ds_status:  str | None = Query(None),
    page:       int = Query(1, ge=1),
    page_size:  int = Query(100, ge=1, le=500),
):
    return ds.list_instruments_ds(
        project_id=project_id,
        search=search,
        ds_status=ds_status,
        page=page,
        page_size=page_size,
    )


@router.get("/instruments/{instrument_id}/bundle")
def get_bundle(instrument_id: str):
    bundle = ds.get_instrument_bundle(instrument_id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Instrument not found")
    return bundle


@router.get("/instruments/{instrument_id}/pdf")
def get_pdf(
    instrument_id: str,
    template_id: str | None = Query(None),
    project_name: str = Query(''),
):
    bundle = ds.get_instrument_bundle(instrument_id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Instrument not found")

    # Resolve template fields: prefer explicit template_id, else match by instrument type
    instr_type = (bundle["instrument"].get("instrument_type") or "").upper()
    if template_id:
        templates = ds.list_templates(instrument_type=None)
        tmpl = next((t for t in templates if t["id"] == template_id), None)
    else:
        templates = ds.list_templates(instrument_type=instr_type)
        tmpl = templates[0] if templates else None

    template_fields = tmpl["field_definitions"] if tmpl else []

    pdf_bytes = build_datasheet_pdf(
        instrument=bundle["instrument"],
        spec_sheets=bundle["spec_sheets"],
        process_data=bundle["process_data"],
        calculations=bundle["calculations"],
        template_fields=template_fields,
        project_name=project_name,
    )

    tag = bundle["instrument"].get("tag_number", "datasheet")
    filename = f"Datasheet_{tag}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


# ── Process data ──────────────────────────────────────────────────────────────

class ProcessDataBody(BaseModel):
    project_id:  str
    case_name:   str = "Normal"
    data:        dict[str, Any]
    user_id:     str = "local-user"


@router.get("/instruments/{instrument_id}/process-data")
def get_process_data(instrument_id: str):
    return {"cases": ds.get_process_data(instrument_id)}


@router.post("/instruments/{instrument_id}/process-data")
def upsert_process_data(instrument_id: str, body: ProcessDataBody):
    row = ds.upsert_process_data(
        project_id=body.project_id,
        instrument_id=instrument_id,
        case_name=body.case_name,
        data=body.data,
        user_id=body.user_id,
    )
    return row


@router.delete("/instruments/{instrument_id}/process-data/{case_name}")
def delete_process_data(instrument_id: str, case_name: str):
    deleted = ds.delete_process_case(instrument_id, case_name)
    if not deleted:
        raise HTTPException(status_code=404, detail="Case not found")
    return {"deleted": True}


# ── Spec sheet ────────────────────────────────────────────────────────────────

class SpecSheetBody(BaseModel):
    project_id: str
    revision:   str = "Rev 0"
    data:       dict[str, Any]
    user_id:    str = "local-user"


@router.get("/instruments/{instrument_id}/spec-sheets")
def get_spec_sheets(instrument_id: str):
    return {"spec_sheets": ds.get_spec_sheets(instrument_id)}


@router.post("/instruments/{instrument_id}/spec-sheet")
def upsert_spec_sheet(instrument_id: str, body: SpecSheetBody):
    row = ds.upsert_spec_sheet(
        project_id=body.project_id,
        instrument_id=instrument_id,
        revision=body.revision,
        data=body.data,
        user_id=body.user_id,
    )
    return row


# ── Calculations (read-only) ──────────────────────────────────────────────────

@router.get("/instruments/{instrument_id}/calculations")
def get_calculations(instrument_id: str):
    return {"calculations": ds.get_calculations(instrument_id)}


# ── Spec form templates ───────────────────────────────────────────────────────

class TemplateBody(BaseModel):
    id:                str | None = None
    template_name:     str
    instrument_type:   str | None = None
    description:       str | None = None
    is_default:        bool = False
    field_definitions: list[dict[str, Any]] = []
    user_id:           str = "local-user"


@router.get("/templates")
def list_templates(instrument_type: str | None = Query(None)):
    return {"templates": ds.list_templates(instrument_type)}


@router.post("/templates")
def save_template(body: TemplateBody):
    row = ds.save_template(
        template_id=body.id,
        template_name=body.template_name,
        instrument_type=body.instrument_type,
        description=body.description,
        is_default=body.is_default,
        field_definitions=body.field_definitions,
        user_id=body.user_id,
    )
    return row


@router.delete("/templates/{template_id}")
def delete_template(template_id: str):
    deleted = ds.delete_template(template_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Template not found")
    return {"deleted": True}


@router.post("/templates/seed")
def seed_templates(overwrite: bool = False):
    result = ds.seed_default_templates(overwrite=overwrite)
    return result
