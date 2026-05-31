"""
Piping MTO — business logic layer.
Routes delegate here; this layer owns detection and library orchestration.
"""
import json
import logging
import os
import subprocess
import threading
import uuid
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import HTTPException

from app.modules.instrumap.core.piping_mto import (
    detect_symbol as _detect_symbol,
    detect_all_pages as _detect_all_pages,
    detect_from_template_image_all_pages as _detect_from_template_image_all_pages,
)

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=max(2, (os.cpu_count() or 2) - 1))
_library_lock = threading.Lock()

LIBRARY_FILE = Path(__file__).parent.parent.parent.parent / "data" / "symbol_library.json"
REPO_ROOT = LIBRARY_FILE.parent.parent
MTO_EXPORT_DIR = LIBRARY_FILE.parent / "mto_exports"


def _clean_metadata(value: dict | None) -> dict:
    from app.modules.piping_mto.schemas import MtoMetadata

    if not value:
        return MtoMetadata().model_dump()
    return MtoMetadata(**value).model_dump()


# ── Symbol Library ─────────────────────────────────────────────────────────────

def _read() -> list:
    try:
        return json.loads(LIBRARY_FILE.read_text(encoding="utf-8"))
    except Exception:
        return []


def _write(entries: list) -> None:
    LIBRARY_FILE.parent.mkdir(parents=True, exist_ok=True)
    LIBRARY_FILE.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")


def _git_commit_and_push() -> None:
    try:
        if not (REPO_ROOT / ".git").exists():
            return
        rel = str(LIBRARY_FILE.relative_to(REPO_ROOT))
        subprocess.run(["git", "add", rel], cwd=REPO_ROOT, check=True, capture_output=True)
        result = subprocess.run(
            ["git", "diff", "--cached", "--quiet"], cwd=REPO_ROOT, capture_output=True
        )
        if result.returncode == 0:
            return
        subprocess.run(
            ["git", "commit", "-m", "chore: update symbol library"],
            cwd=REPO_ROOT, check=True, capture_output=True,
        )
        subprocess.run(["git", "push"], cwd=REPO_ROOT, check=True, capture_output=True)
        logger.info("Symbol library committed and pushed.")
    except subprocess.CalledProcessError as e:
        logger.warning("Library push failed: %s", e.stderr.decode(errors="replace").strip())
    except OSError as e:
        logger.warning("Library push unavailable: %s", e)


def read_library() -> list:
    with _library_lock:
        return _read()


def add_symbol(payload: dict) -> dict:
    with _library_lock:
        entries = _read()
        entry = {
            "id": payload.get("id") or str(uuid.uuid4()),
            "name": payload["name"],
            "thumbnail": payload.get("thumbnail", ""),
            "templateImage": payload["templateImage"],
            "createdAt": payload.get("createdAt") or "",
            "metadata": _clean_metadata(payload.get("metadata")),
        }
        entries.append(entry)
        _write(entries)
    threading.Thread(target=_git_commit_and_push, daemon=True).start()
    return entry


def update_symbol(symbol_id: str, payload: dict) -> dict:
    with _library_lock:
        entries = _read()
        for i, e in enumerate(entries):
            if e.get("id") == symbol_id:
                patch = {k: v for k, v in payload.items() if k != "id" and v is not None}
                if "metadata" in patch:
                    patch["metadata"] = _clean_metadata(patch["metadata"])
                entries[i] = {**e, **patch}
                _write(entries)
                return entries[i]
    raise HTTPException(status_code=404, detail="Symbol not found.")


def delete_symbol(symbol_id: str) -> dict:
    with _library_lock:
        entries = [e for e in _read() if e.get("id") != symbol_id]
        _write(entries)
    threading.Thread(target=_git_commit_and_push, daemon=True).start()
    return {"deleted": symbol_id}


# ── Detection ──────────────────────────────────────────────────────────────────

async def detect(
    pdf_bytes: bytes,
    template_box: tuple,
    search_box: tuple | None,
    threshold: float,
    label: str,
    coord_dpi: int,
) -> dict:
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _executor,
            lambda: _detect_symbol(
                pdf_bytes=pdf_bytes,
                template_box=template_box,
                search_box=search_box,
                threshold=threshold,
                label=label,
                coord_dpi=coord_dpi,
            ),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Detection failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


async def detect_all_pages(
    pdf_bytes: bytes,
    template_box: tuple,
    threshold: float,
    label: str,
    coord_dpi: int,
) -> dict:
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _executor,
            lambda: _detect_all_pages(
                pdf_bytes=pdf_bytes,
                template_box=template_box,
                threshold=threshold,
                label=label,
                coord_dpi=coord_dpi,
            ),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("All-pages detection failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


async def detect_from_library(
    pdf_bytes: bytes,
    template_bytes: bytes,
    threshold: float,
    label: str,
    template_dpi: int,
) -> dict:
    import asyncio
    try:
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            _executor,
            lambda: _detect_from_template_image_all_pages(
                pdf_bytes=pdf_bytes,
                template_bytes=template_bytes,
                threshold=threshold,
                label=label,
                template_dpi=template_dpi,
            ),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error("Library detection failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ── Client-grade package export ────────────────────────────────────────────────

def build_export_package(payload: dict) -> Path:
    from app.modules.piping_mto.excel_writer import write_mto_package

    run_id = f"mto_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:8]}"
    output_dir = MTO_EXPORT_DIR / run_id
    output_dir.mkdir(parents=True, exist_ok=True)
    return write_mto_package(output_dir, payload, run_id)
