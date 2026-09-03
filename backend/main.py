"""
API server — white-label edition.
"""
import asyncio
import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from app.config.settings import settings
from app.config.redis_client import init_redis
from app.config.local_db import db_path, init_db
from app.modules.pid_analyser.routes import router as pid_router, PREFIX as PID_PREFIX
from app.modules.instruments.routes import router as instruments_router, PREFIX as INSTRUMENTS_PREFIX
from app.modules.data_editor.routes import router as data_editor_router, PREFIX as DATA_EDITOR_PREFIX
from app.config.logging_config import BACKEND_LOG, ERROR_LOG, configure_logging

configure_logging()
logger = logging.getLogger("tpi.server")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("TPI backend starting | env=%s | backend_log=%s", settings.ENV, BACKEND_LOG)
    init_redis()
    init_db()
    yield
    logger.info("TPI backend stopped")


app = FastAPI(
    title="P&ID Platform API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pid_router, prefix=PID_PREFIX)
app.include_router(instruments_router, prefix=INSTRUMENTS_PREFIX)
app.include_router(data_editor_router, prefix=DATA_EDITOR_PREFIX)


@app.middleware("http")
async def request_logging(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4())[:8])
    started = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - started) * 1000)
        logger.exception(
            "request_failed | id=%s | method=%s | path=%s | duration_ms=%s",
            request_id, request.method, request.url.path, duration_ms,
        )
        raise
    duration_ms = round((time.perf_counter() - started) * 1000)
    response.headers["X-Request-ID"] = request_id
    # Do not fill logs with the three-second job-status polling loop.
    if response.status_code >= 400 or request.method != "GET" or duration_ms >= 2000:
        level = logging.WARNING if response.status_code >= 400 else logging.INFO
        logger.log(
            level,
            "request | id=%s | method=%s | path=%s | status=%s | duration_ms=%s",
            request_id, request.method, request.url.path, response.status_code, duration_ms,
        )
    return response


class ClientLog(BaseModel):
    level: str = "error"
    message: str = Field(max_length=1000)
    stack: str = Field(default="", max_length=4000)
    source: str = Field(default="", max_length=500)
    status: int | None = None
    session_id: str = Field(default="", max_length=100)
    user_agent: str = Field(default="", max_length=500)


@app.post("/api/v1/system/client-log", status_code=204)
async def client_log(entry: ClientLog):
    level = logging.ERROR if entry.level == "error" else logging.WARNING
    logging.getLogger("tpi.frontend").log(
        level,
        "browser_error | session=%s | source=%s | status=%s | message=%s | stack=%s | ua=%s",
        entry.session_id, entry.source, entry.status, entry.message,
        entry.stack.replace("\n", " <- "), entry.user_agent,
    )


@app.get("/health")
async def health():
    return {"status": "ok", "log_file": str(BACKEND_LOG), "error_log": str(ERROR_LOG)}


@app.get("/api/v1/system/health")
async def system_health():
    """System health check — backend, Redis, SQLite, RQ worker."""
    import time
    from app.config.redis_client import get_redis_connection, is_redis_available

    def _check() -> dict:
        services: dict[str, dict] = {}
        queue_depth = 0
        failed_jobs = 0
        active_workers = 0

        def service(label: str, ok: bool, role: str, detail: str, **extra) -> dict:
            return {"label": label, "ok": ok, "role": role, "detail": detail, **extra}

        # 1. Backend
        services["backend"] = service(
            "Backend API", True, "secure API gateway",
            "API is responding to health checks.",
            scope="internal service",
        )

        # 2. Redis
        redis_ok = is_redis_available()
        services["redis"] = service(
            "Redis", redis_ok, "job state and cache",
            "Redis is reachable." if redis_ok else "Redis is not reachable; queued extraction state may be unavailable.",
            scope="internal service",
        )

        # 3. Local project database
        db_ok = False
        db_detail = "SQLite project database is not initialized."
        db_size_mb = 0.0
        try:
            init_db()
            local_path = db_path()
            db_ok = local_path.exists()
            db_size_mb = round(local_path.stat().st_size / 1_000_000, 2) if db_ok else 0.0
            db_detail = (
                f"SQLite project database is online at {local_path.name}."
                if db_ok
                else "SQLite project database file is not available."
            )
        except Exception as exc:
            db_detail = f"SQLite project database is unavailable: {exc}"
        services["project_db"] = service(
            "Project Database", db_ok, "offline instrument grid",
            db_detail, scope="local SQLite", size_mb=db_size_mb,
        )

        # 4. RQ Worker
        conn = get_redis_connection()
        rq_ok = False
        if conn:
            try:
                queue_registered = conn.sismember("rq:queues", "rq:queue:instrumap")
                queue_depth = conn.llen("rq:queue:instrumap")
                failed_jobs = conn.zcard("rq:failed:instrumap")
                if queue_registered:
                    worker_keys = conn.smembers("rq:workers")
                    active_workers = sum(1 for k in worker_keys if conn.ttl(k) > 0)
                    rq_ok = active_workers > 0
            except Exception:
                pass
        services["rq_worker"] = service(
            "RQ Worker", rq_ok, "background extraction engine",
            f"{active_workers} active worker(s), {queue_depth} queued job(s), {failed_jobs} failed job(s)."
            if rq_ok else "No live worker heartbeat found for the instrumap queue.",
            scope="instrumap queue",
            queue_depth=queue_depth,
            active_workers=active_workers,
            failed_jobs=failed_jobs,
        )

        return services, {
            "queue_depth": queue_depth,
            "failed_jobs": failed_jobs,
            "active_workers": active_workers,
            "read_only": True,
            "deployment": "client" if settings.ENV == "production" else settings.ENV,
        }

    services, metrics = await asyncio.to_thread(_check)
    return {"services": services, "metrics": metrics, "ts": time.time()}


@app.post("/api/v1/system/worker/start")
async def start_worker():
    """Spawn a new RQ worker for the instrumap queue."""
    if not settings.ALLOW_SYSTEM_WORKER_START:
        raise HTTPException(status_code=403, detail="Worker start is disabled for this deployment.")
    result = await _start_worker_process()
    return result


@app.post("/api/v1/system/start")
async def start_all_services():
    """
    Boot backend services: Redis → RQ Worker.
    Only active when ALLOW_SYSTEM_WORKER_START=true.
    Safe to call when services are already running.
    """
    from app.config.redis_client import is_redis_available

    if not settings.ALLOW_SYSTEM_WORKER_START:
        raise HTTPException(status_code=403, detail="Service start is disabled for this deployment.")

    results: dict[str, str] = {}

    if is_redis_available():
        results["redis"] = "already_running"
    else:
        results["redis"] = await _brew_start("redis") or "error: could not start"
        await asyncio.sleep(1.5)

    worker_result = await _start_worker_process()
    results["worker"] = (
        f"started (pid {worker_result.get('pid')})"
        if worker_result.get("started")
        else worker_result.get("error", "error")
    )

    return {"results": results}


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _brew_start(service: str) -> str:
    import shutil
    brew = shutil.which("brew")
    if not brew:
        return "error: brew not found"
    try:
        proc = await asyncio.create_subprocess_exec(
            brew, "services", "start", service,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=10)
        return "started"
    except Exception as exc:
        return f"error: {exc}"


async def _start_worker_process() -> dict:
    import os
    import shutil
    from pathlib import Path

    backend_dir = Path(__file__).parent
    env = os.environ.copy()
    env["OBJC_DISABLE_INITIALIZE_FORK_SAFETY"] = "YES"

    rq_candidates = [
        backend_dir / ".venv" / "bin" / "rq",
        Path.home() / "Library" / "Python" / "3.11" / "bin" / "rq",
        Path.home() / "Library" / "Python" / "3.12" / "bin" / "rq",
        Path.home() / "Library" / "Python" / "3.13" / "bin" / "rq",
    ]
    rq_bin = next((str(p) for p in rq_candidates if p.exists()), shutil.which("rq"))

    if not rq_bin:
        return {"started": False, "error": "rq binary not found"}

    try:
        proc = await asyncio.create_subprocess_exec(
            rq_bin, "worker", "instrumap", "--url", "redis://localhost:6379",
            cwd=str(backend_dir),
            env=env,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True,
        )
        return {"started": True, "pid": proc.pid}
    except Exception as exc:
        return {"started": False, "error": str(exc)}
