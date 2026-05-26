from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_ROOT = Path(__file__).parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env",),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ENV: str = "production"
    REDIS_URL: str = "redis://redis:6379"

    # PDF rendering
    PDF_DPI: int = 300
    POPPLER_PATH: Optional[str] = None

    # Google Vision credentials — path resolved from env or defaults to file in backend root
    GOOGLE_APPLICATION_CREDENTIALS: Optional[str] = None

    # Debug flag for workers (saves per-page JPEGs — off in production)
    INSTRUMAP_DEBUG: bool = False

    @property
    def google_credentials_path(self) -> str:
        if self.GOOGLE_APPLICATION_CREDENTIALS:
            return self.GOOGLE_APPLICATION_CREDENTIALS
        return str(_BACKEND_ROOT / "instrumap-464410-3cb4dae6350d.json")


settings = Settings()
