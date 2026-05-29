"""
API server — white-label edition.
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.config.settings import settings
from app.config.redis_client import init_redis
from app.modules.pid_analyser.routes import router as pid_router, PREFIX as PID_PREFIX
from app.modules.piping_mto.routes import router as mto_router, PREFIX as MTO_PREFIX

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_redis()
    yield


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
app.include_router(mto_router, prefix=MTO_PREFIX)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/v1/llm/status")
async def llm_status():
    from app.modules.llm.service import _is_available, DEFAULT_MODEL
    available = await asyncio.to_thread(_is_available)
    return {"available": available, "model": DEFAULT_MODEL}


@app.get("/api/v1/system/health")
async def system_health():
    """Full system health check — backend, Redis, RQ worker, Ollama, models."""
    import time
    import json as _json
    import urllib.request
    from app.config.redis_client import get_redis_connection, is_redis_available
    from app.modules.llm.service import (
        _is_available, OLLAMA_BASE_URL,
        INSTRUMENT_MODEL, LINE_MAPPER_MODEL,
    )
    from app.modules.project_context.extractor import PROJECT_CONTEXT_MODEL

    def _check() -> dict:
        services: dict[str, dict] = {}
        queue_depth = 0
        failed_jobs = 0
        active_workers = 0

        def service(label: str, ok: bool, role: str, detail: str, **extra) -> dict:
            return {
                "label": label,
                "ok": ok,
                "role": role,
                "detail": detail,
                **extra,
            }

        # 1. Backend (we're responding, so always OK)
        services["backend"] = service(
            "Backend API",
            True,
            "secure API gateway",
            "API is responding to health checks.",
            scope="internal service",
        )

        # 2. Redis
        redis_ok = is_redis_available()
        services["redis"] = service(
            "Redis",
            redis_ok,
            "job state and cache",
            "Redis is reachable." if redis_ok else "Redis is not reachable; queued extraction state may be unavailable.",
            scope="internal service",
        )

        # 3. RQ Worker — instrumap queue registered and at least one live worker
        # RQ 2.x stores only last_heartbeat in worker hashes (no pid/queues fields).
        # Queue registration lives in the rq:queues set; worker liveness via TTL.
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
            "RQ Worker",
            rq_ok,
            "background extraction engine",
            f"{active_workers} active worker(s), {queue_depth} queued job(s), {failed_jobs} failed job(s)."
            if rq_ok
            else "No live worker heartbeat found for the instrumap queue.",
            scope="instrumap queue",
            queue_depth=queue_depth,
            active_workers=active_workers,
            failed_jobs=failed_jobs,
        )

        # 4. Ollama reachability + model metadata from /api/tags
        ollama_ok = False
        models_meta: dict[str, dict] = {}
        try:
            with urllib.request.urlopen(
                f"{OLLAMA_BASE_URL}/api/tags", timeout=3
            ) as resp:
                ollama_ok = True
                tags = _json.loads(resp.read())
                for m in tags.get("models", []):
                    base = m["name"].split(":")[0]
                    d = m.get("details", {})
                    models_meta[base] = {
                        "params": d.get("parameter_size", ""),
                        "quant":  d.get("quantization_level", ""),
                        "size_gb": round(m.get("size", 0) / 1e9, 2),
                        "family": d.get("family", ""),
                    }
        except Exception:
            pass
        services["ollama"] = service(
            "Ollama",
            ollama_ok,
            "local LLM runtime",
            "Local LLM runtime is reachable." if ollama_ok else "Ollama is not reachable; model-backed reasoning is unavailable.",
            scope="internal service",
        )

        # 5. xyra-pid-engineer model
        meta = models_meta.get(INSTRUMENT_MODEL, {})
        pid_ok = _is_available(INSTRUMENT_MODEL)
        services["pid_model"] = service(
            INSTRUMENT_MODEL,
            pid_ok,
            "instrument intelligence",
            "Instrument classification model is loaded." if pid_ok else f"{INSTRUMENT_MODEL} is not available in Ollama.",
            **meta,
        )

        # 6. xyra-line-mapper model
        meta = models_meta.get(LINE_MAPPER_MODEL, {})
        line_ok = _is_available(LINE_MAPPER_MODEL)
        services["line_model"] = service(
            LINE_MAPPER_MODEL,
            line_ok,
            "line connection reasoning",
            "Line mapper model is loaded." if line_ok else f"{LINE_MAPPER_MODEL} is not available in Ollama.",
            **meta,
        )

        # 7. Project/document context model
        meta = models_meta.get(PROJECT_CONTEXT_MODEL, {})
        project_context_ok = _is_available(PROJECT_CONTEXT_MODEL)
        services["project_context_model"] = service(
            PROJECT_CONTEXT_MODEL,
            project_context_ok,
            "project context normalizer",
            "Project context model is loaded." if project_context_ok else f"{PROJECT_CONTEXT_MODEL} is not available in Ollama.",
            **meta,
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
    """Spawn a new RQ worker for the instrumap queue (legacy single-service endpoint)."""
    if not settings.ALLOW_SYSTEM_WORKER_START:
        raise HTTPException(status_code=403, detail="Worker start is disabled for this deployment.")
    result = await _start_worker_process()
    return result


@app.post("/api/v1/system/start")
async def start_all_services():
    """
    Boot all backend services: Redis → Ollama → RQ Worker.
    Only active when ALLOW_SYSTEM_WORKER_START=true.
    Safe to call when services are already running — skips anything already live.
    """
    import os
    import urllib.request
    from pathlib import Path
    from app.config.redis_client import is_redis_available

    if not settings.ALLOW_SYSTEM_WORKER_START:
        raise HTTPException(status_code=403, detail="Service start is disabled for this deployment.")

    results: dict[str, str] = {}

    # ── Redis ────────────────────────────────────────────────────────────────
    if is_redis_available():
        results["redis"] = "already_running"
    else:
        results["redis"] = await _brew_start("redis") or "error: could not start"
        # Give Redis a moment to come up before worker tries to connect
        await asyncio.sleep(1.5)

    # ── Ollama ───────────────────────────────────────────────────────────────
    ollama_live = False
    try:
        with urllib.request.urlopen("http://localhost:11434/api/tags", timeout=2):
            ollama_live = True
    except Exception:
        pass

    if ollama_live:
        results["ollama"] = "already_running"
    else:
        results["ollama"] = await _brew_start("ollama") or "error: could not start"

    # ── RQ Worker ────────────────────────────────────────────────────────────
    worker_result = await _start_worker_process()
    results["worker"] = (
        f"started (pid {worker_result.get('pid')})"
        if worker_result.get("started")
        else worker_result.get("error", "error")
    )

    return {"results": results}


# ── Internal helpers ──────────────────────────────────────────────────────────

async def _brew_start(service: str) -> str:
    """Try `brew services start <service>`, return status string."""
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
    """Find the rq binary and spawn a worker. Returns {started, pid/error}."""
    import os
    import shutil
    from pathlib import Path

    backend_dir = Path(__file__).parent
    env = os.environ.copy()
    env["OBJC_DISABLE_INITIALIZE_FORK_SAFETY"] = "YES"

    # Search order: project venv → user site-packages → system PATH
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
