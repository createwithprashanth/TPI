import logging
import os

from app.config.settings import settings
from redis import Redis
from rq import Queue

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", settings.REDIS_URL)
REDIS_SOCKET_TIMEOUT_SECONDS = float(os.getenv("REDIS_SOCKET_TIMEOUT_SECONDS", "1.5"))

redis_conn = None
instrumap_queue = None


def init_redis():
    global redis_conn, instrumap_queue
    try:
        candidate = Redis.from_url(
            REDIS_URL,
            decode_responses=False,
            socket_connect_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
            socket_timeout=REDIS_SOCKET_TIMEOUT_SECONDS,
            retry_on_timeout=False,
        )
        candidate.ping()
        redis_conn = candidate
        logger.info("Redis connected")
        instrumap_queue = Queue(
            "instrumap",
            connection=redis_conn,
            default_timeout=3600,
        )
    except Exception as e:
        redis_conn = None
        instrumap_queue = None
        logger.warning(f"Redis unavailable: {e}")


def get_redis_connection():
    return redis_conn


def get_instrumap_queue():
    return instrumap_queue


def is_redis_available() -> bool:
    try:
        return redis_conn is not None and redis_conn.ping()
    except Exception:
        return False
