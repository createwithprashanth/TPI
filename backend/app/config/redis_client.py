import os
import logging
from redis import Redis
from rq import Queue

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

redis_conn = None
instrumap_queue = None


def init_redis():
    global redis_conn, instrumap_queue
    try:
        redis_conn = Redis.from_url(REDIS_URL, decode_responses=False)
        redis_conn.ping()
        logger.info("Redis connected")
        instrumap_queue = Queue(
            "instrumap",
            connection=redis_conn,
            default_timeout=3600,
        )
    except Exception as e:
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
