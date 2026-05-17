"""
InstruMap API — white-label edition.
"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config.redis_client import init_redis
from app.modules.instrumap.routes import router as instrumap_router, PREFIX

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_redis()
    yield


app = FastAPI(
    title="InstruMap API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(instrumap_router, prefix=PREFIX)


@app.get("/health")
async def health():
    return {"status": "ok"}
