"""
DataDiff routes — two-step compare/download.

POST /parse           → sheet names + columns per sheet
POST /compare         → run comparison, return job_id + stats
GET  /download/{job_id} → stream .xlsx report (valid 10 min)
"""
import json
import tempfile
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.modules.datadiff.compare_engine import compare, parse_file

PREFIX = "/api/v1/datadiff"

router = APIRouter()

# ---------------------------------------------------------------------------
# Disk-based job store (survives across workers, no in-memory leaks)
# ---------------------------------------------------------------------------
_JOBS_DIR = Path(tempfile.gettempdir()) / "xyra_datadiff_jobs"
_JOBS_DIR.mkdir(exist_ok=True)
_JOB_TTL_S = 600  # 10 minutes


def _job_path(job_id: str) -> Path:
    return _JOBS_DIR / f"{job_id}.xlsx"


def _meta_path(job_id: str) -> Path:
    return _JOBS_DIR / f"{job_id}.meta"


def _save_job(job_id: str, excel_bytes: bytes, filename: str) -> None:
    _job_path(job_id).write_bytes(excel_bytes)
    _meta_path(job_id).write_text(json.dumps({"filename": filename, "ts": time.time()}))


def _load_job(job_id: str) -> tuple[Path, str]:
    p = _job_path(job_id)
    m = _meta_path(job_id)
    if not p.exists() or not m.exists():
        raise HTTPException(
            status_code=404,
            detail="Result not found or expired. Please re-run the comparison.",
        )
    meta = json.loads(m.read_text())
    if time.time() - meta["ts"] > _JOB_TTL_S:
        p.unlink(missing_ok=True)
        m.unlink(missing_ok=True)
        raise HTTPException(
            status_code=410,
            detail="Result has expired (10-min limit). Please re-run the comparison.",
        )
    return p, meta["filename"]


def _cleanup_old_jobs() -> None:
    cutoff = time.time() - _JOB_TTL_S
    for f in _JOBS_DIR.glob("*.meta"):
        try:
            if json.loads(f.read_text()).get("ts", 0) < cutoff:
                f.unlink(missing_ok=True)
                _job_path(f.stem).unlink(missing_ok=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/parse")
async def parse(file: UploadFile = File(...)):
    """Parse an Excel file → sheet names + columns per sheet."""
    try:
        return parse_file(await file.read())
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/compare")
async def run_compare(
    file1: UploadFile = File(...),
    file2: UploadFile = File(...),
    config: str = Form(...),
):
    """
    Run comparison. Returns JSON with job_id and stats.
    The Excel report is fetched separately via GET /download/{job_id}.
    """
    _cleanup_old_jobs()
    try:
        cfg = json.loads(config)
        b1  = await file1.read()
        b2  = await file2.read()

        excel_bio, stats = compare(
            file1_bytes      = b1,
            file2_bytes      = b2,
            sheet1           = cfg["sheet1"],
            sheet2           = cfg["sheet2"],
            lookup_col1      = cfg["lookup_col1"],
            lookup_col2      = cfg.get("lookup_col2", cfg["lookup_col1"]),
            file1_name       = cfg.get("file1_name", "File1"),
            file2_name       = cfg.get("file2_name", "File2"),
            column_map       = cfg.get("column_map", {}),
            ignore_spaces    = cfg.get("ignore_spaces", True),
            ignore_hyphens   = cfg.get("ignore_hyphens", False),
            case_insensitive = cfg.get("case_insensitive", False),
            ignore_special   = cfg.get("ignore_special", False),
        )

        f1       = cfg.get("file1_name", "File1")
        f2       = cfg.get("file2_name", "File2")
        filename = f"datadiff_{f1}_vs_{f2}.xlsx"
        job_id   = str(uuid.uuid4())
        _save_job(job_id, excel_bio.read(), filename)

        return {"job_id": job_id, "filename": filename, "stats": stats}

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/download/{job_id}")
def download(job_id: str):
    """Stream the Excel result for a completed comparison job."""
    job_path, filename = _load_job(job_id)
    return FileResponse(
        path=str(job_path),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=filename,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
