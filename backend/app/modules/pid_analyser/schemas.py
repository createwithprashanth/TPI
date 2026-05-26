from typing import Any, Optional
from pydantic import BaseModel


class PreviewResponse(BaseModel):
    status: str
    base64_image: str
    page_count: int


class ProcessResponse(BaseModel):
    status: str
    job_id: str
    batch_id: str
    message: str


class JobProgress(BaseModel):
    stage: str
    message: str
    estimated_seconds_remaining: Optional[int] = None


class JobStatusResponse(BaseModel):
    job_id: str
    status: str
    created_at: Optional[str] = None
    started_at: Optional[str] = None
    ended_at: Optional[str] = None
    position_in_queue: Optional[int] = None
    progress: Optional[JobProgress] = None
    result: Optional[dict[str, Any]] = None
    download_ready: Optional[bool] = None
    download_endpoint: Optional[str] = None
    error: Optional[str] = None
