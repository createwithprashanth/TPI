import logging
from pathlib import Path
import json
from typing import Literal, Optional

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).parent.parent.parent
_log = logging.getLogger(__name__)

# Safe defaults — restrictive on purpose. Override via CORS_ORIGINS in .env.
_DEFAULT_CORS = ["http://localhost", "http://127.0.0.1"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env",),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ENV: str = "production"
    REDIS_URL: str = "redis://redis:6379"
    CORS_ORIGINS: list[str] = _DEFAULT_CORS

    # PDF rendering
    PDF_DPI: int = 300
    POPPLER_PATH: Optional[str] = None

    # Google Vision credentials — path resolved from env or defaults to file in backend root
    GOOGLE_APPLICATION_CREDENTIALS: Optional[str] = None

    # Debug flag for workers (saves per-page JPEGs — off in production)
    INSTRUMAP_DEBUG: bool = False

    # Dev-only system monitor action. Keep false in client deployments.
    ALLOW_SYSTEM_WORKER_START: bool = False

    # Offline project database. SQLite keeps XYRA Studio self-contained for
    # client LAN deployments. Keep backend/url explicit so enterprise DBs can
    # be introduced later without changing frontend contracts.
    XYRA_DB_BACKEND: Literal["sqlite", "postgresql", "mssql", "oracle"] = "sqlite"
    XYRA_DB_PATH: Optional[str] = None
    XYRA_DATABASE_URL: Optional[str] = None
    XYRA_DEFAULT_PROJECT_ID: str = "default"

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, value):
        if isinstance(value, str):
            value = value.strip()
            if not value:
                return []
            if value.startswith("["):
                return json.loads(value)
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @model_validator(mode="after")
    def warn_default_cors_in_production(self) -> "Settings":
        if self.ENV == "production" and self.CORS_ORIGINS == _DEFAULT_CORS:
            _log.warning(
                "CORS_ORIGINS is using the default localhost value in production. "
                "Set CORS_ORIGINS in .env to the server's actual URL."
            )
        if self.XYRA_DB_BACKEND != "sqlite":
            _log.warning(
                "XYRA_DB_BACKEND=%s is reserved for enterprise deployments but is not enabled in this build. "
                "Use sqlite unless the backend storage adapter has been implemented.",
                self.XYRA_DB_BACKEND,
            )
        return self

    @property
    def google_credentials_path(self) -> str:
        if self.GOOGLE_APPLICATION_CREDENTIALS:
            return self.GOOGLE_APPLICATION_CREDENTIALS
        return str(_BACKEND_ROOT / "instrumap-464410-3cb4dae6350d.json")

    @property
    def local_db_path(self) -> str:
        if self.XYRA_DB_PATH:
            return self.XYRA_DB_PATH
        return str(_BACKEND_ROOT / "data" / "xyra_studio.db")


settings = Settings()
