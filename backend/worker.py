"""RQ worker entry point."""
import logging
import os
import platform

from rq import SimpleWorker, Worker
from app.config.redis_client import init_redis, get_redis_connection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)


def _worker_class():
    """Use a non-forking worker for local macOS runs.

    PyMuPDF, OpenCV, pdf2image, and Objective-C initialized libraries can abort
    inside RQ's forked work-horse on macOS. Docker/Linux keeps the normal Worker.
    """
    configured = os.getenv("XYRA_RQ_WORKER_MODE", "").strip().lower()
    if configured in {"simple", "nofork", "no-fork"}:
        return SimpleWorker
    if configured in {"fork", "worker"}:
        return Worker
    if platform.system() == "Darwin":
        return SimpleWorker
    return Worker

if __name__ == "__main__":
    init_redis()
    redis_conn = get_redis_connection()
    if not redis_conn:
        raise RuntimeError("Could not connect to Redis.")
    worker_cls = _worker_class()
    logging.info("Starting %s for instrumap queue", worker_cls.__name__)
    worker = worker_cls(["instrumap"], connection=redis_conn)
    worker.work()
