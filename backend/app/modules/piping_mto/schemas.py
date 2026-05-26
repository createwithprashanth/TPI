from typing import Optional
from pydantic import BaseModel


class MatchBox(BaseModel):
    x1: int
    y1: int
    x2: int
    y2: int
    score: float


class DetectResponse(BaseModel):
    status: str
    count: int
    label: str
    threshold: float
    matches: list[MatchBox]
    annotated_image: str
    image_width: int
    image_height: int


class PageResult(BaseModel):
    page: int
    count: int
    matches: list[MatchBox]


class AllPagesDetectResponse(BaseModel):
    status: str
    total_count: int
    pages: list[PageResult]
    annotated_image: str
    image_width: int
    image_height: int


class LibrarySymbol(BaseModel):
    id: str
    name: str
    thumbnail: str
    templateImage: str
    createdAt: str


class CreateSymbolRequest(BaseModel):
    id: str = ""
    name: str
    thumbnail: str = ""
    templateImage: str
    createdAt: str = ""


class UpdateSymbolRequest(BaseModel):
    name: Optional[str] = None
    thumbnail: Optional[str] = None
    templateImage: Optional[str] = None
