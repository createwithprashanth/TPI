"""RQ worker entry point."""
import logging
from rq import Worker
from app.config.redis_client import init_redis, get_redis_connection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)

if __name__ == "__main__":
    init_redis()
    redis_conn = get_redis_connection()
    if not redis_conn:
        raise RuntimeError("Could not connect to Redis.")
    worker = Worker(["instrumap"], connection=redis_conn)
    worker.work()
