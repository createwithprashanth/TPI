"""Persistent, bounded logging for local TPI troubleshooting."""
from __future__ import annotations

import logging
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
LOG_DIR = REPO_ROOT / "logs"
BACKEND_LOG = LOG_DIR / "tpi-backend.log"
ERROR_LOG = LOG_DIR / "tpi-errors.log"


def configure_logging() -> None:
    """Configure console plus rotating application/error log files once."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger()
    if any(getattr(handler, "_tpi_handler", False) for handler in root.handlers):
        return
    root.setLevel(logging.INFO)
    formatter = logging.Formatter(
        "%(asctime)sZ | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    formatter.converter = time.gmtime
    console = logging.StreamHandler()
    console.setFormatter(formatter)
    application = RotatingFileHandler(
        BACKEND_LOG, maxBytes=5 * 1024 * 1024, backupCount=5, encoding="utf-8"
    )
    application.setFormatter(formatter)
    errors = RotatingFileHandler(
        ERROR_LOG, maxBytes=2 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    errors.setLevel(logging.WARNING)
    errors.setFormatter(formatter)
    for handler in (console, application, errors):
        handler._tpi_handler = True  # type: ignore[attr-defined]
    root.handlers.clear()
    root.addHandler(console)
    root.addHandler(application)
    root.addHandler(errors)

