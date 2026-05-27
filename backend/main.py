"""
API server — white-label edition.
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
    allow_origins=["*"],
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
