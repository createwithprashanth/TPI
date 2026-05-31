from typing import Optional
from pydantic import BaseModel, Field


class MtoMetadata(BaseModel):
    categoryCode: str = ""
    categoryName: str = ""
    unit: str = "-"
    itemType: str = ""
    pipingClass: str = ""
    sizeInch: str = ""
    rating: str = ""
    valveBore: str = ""
    endConnection: str = ""
    materialDescription: str = ""
    dataSheetDocumentNo: str = ""
    dataSheetReferenceNo: str = ""
    remarks: str = ""


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
    metadata: MtoMetadata = Field(default_factory=MtoMetadata)


class CreateSymbolRequest(BaseModel):
    id: str = ""
    name: str
    thumbnail: str = ""
    templateImage: str
    createdAt: str = ""
    metadata: MtoMetadata = Field(default_factory=MtoMetadata)


class UpdateSymbolRequest(BaseModel):
    name: Optional[str] = None
    thumbnail: Optional[str] = None
    templateImage: Optional[str] = None
    metadata: Optional[MtoMetadata] = None


class ExportMatch(BaseModel):
    page: int = 1
    x1: int
    y1: int
    x2: int
    y2: int
    score: float


class ExportPageCount(BaseModel):
    page: int
    count: int


class ExportFileResult(BaseModel):
    fileName: str
    count: int
    matches: list[ExportMatch] = Field(default_factory=list)
    pageCounts: list[ExportPageCount] = Field(default_factory=list)
    imageWidth: int = 0
    imageHeight: int = 0


class ExportSession(BaseModel):
    id: str
    label: str
    count: int
    metadata: MtoMetadata = Field(default_factory=MtoMetadata)
    fileResults: list[ExportFileResult] = Field(default_factory=list)


class ExportProjectInfo(BaseModel):
    project_name: str = ""
    project_no: str = ""
    client_name: str = ""
    contractor_name: str = ""
    location: str = ""


class ExportPackageRequest(BaseModel):
    project: ExportProjectInfo = Field(default_factory=ExportProjectInfo)
    sessions: list[ExportSession]
    threshold: float = 0.70
