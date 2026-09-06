from enum import Enum
from typing import Any
from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    queued = "queued"
    processing = "processing"
    ready = "ready"
    failed = "failed"


class ArtworkAssets(BaseModel):
    splatUrl: str | None = None
    plyUrl: str | None = None
    previewUrl: str | None = None
    manifestUrl: str | None = None
    gaussianCount: int
    rigUrl: str | None = None


class JobResponse(BaseModel):
    jobId: str
    artworkId: str
    name: str | None = None
    submissionId: str | None = None
    status: JobStatus
    progress: float | None = None
    message: str | None = None
    artwork: ArtworkAssets | None = None
    error: str | None = None
    queuePosition: int | None = None
    estimatedWaitSeconds: int | None = None
    queueCapacity: int | None = None


class ArtworkMetadataUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=18)
    width: int | None = None
    height: int | None = None
    aspect: float | None = None
    features: dict[str, Any] | None = None
    gaussianModel: dict[str, Any] | None = None


class ArtworkEvolutionState(BaseModel):
    level: int = Field(0, ge=0)
    experience: float = Field(0, ge=0)
    victories: int = Field(0, ge=0)
    defeats: int = Field(0, ge=0)
    planetTraps: int = Field(0, ge=0)
    revision: int = Field(0, ge=0)
    updatedAt: str | None = None


class ArtworkEvolutionUpdate(BaseModel):
    artworkId: str = Field(min_length=1)
    level: int = Field(0, ge=0)
    experience: float = Field(0, ge=0)
    victories: int = Field(0, ge=0)
    defeats: int = Field(0, ge=0)
    planetTraps: int = Field(0, ge=0)
    revision: int = Field(0, ge=0)


class ArtworkEvolutionBatchUpdate(BaseModel):
    records: list[ArtworkEvolutionUpdate]


class PersistedArtwork(BaseModel):
    id: str
    name: str | None = None
    sourceUrl: str | None = None
    previewUrl: str | None = None
    splatUrl: str | None = None
    plyUrl: str | None = None
    manifestUrl: str | None = None
    gaussianCount: int | None = None
    width: int | None = None
    height: int | None = None
    aspect: float | None = None
    features: dict[str, Any] | None = None
    gaussianModel: dict[str, Any] | None = None
    evolution: ArtworkEvolutionState
    isDeleted: bool = False
    deletedAt: str | None = None
    createdAt: str
    updatedAt: str


class ExhibitionModel(BaseModel):
    id: str
    name: str
    modelUrl: str
    previewUrl: str | None = None
    color: str
    position: list[float]
    scale: float
    sourceFolder: str | None = None
    sourceImage: str | None = None
    referenceMode: str = "single"
    entryType: str = "award"
    alwaysFloating: bool = True
    participatesInLevel: bool = False
    isDeleted: bool = False
    createdAt: str
    updatedAt: str


class ExhibitionModelCreate(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=64)
    modelUrl: str = Field(min_length=1, max_length=1024)
    previewUrl: str | None = Field(default=None, max_length=1024)
    color: str = Field(default="#7ee7ff", pattern=r"^#[0-9a-fA-F]{6}$")
    position: list[float] = Field(default_factory=lambda: [0, 0, 0], min_length=3, max_length=3)
    scale: float = Field(default=0.55, ge=0.1, le=3.0)
    sourceFolder: str | None = Field(default=None, max_length=512)
    sourceImage: str | None = Field(default=None, max_length=256)
    referenceMode: str = Field(default="single", max_length=32)
    entryType: str = Field(default="award", pattern=r"^(award|contest)$")


class ExhibitionModelUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=64)
    modelUrl: str | None = Field(default=None, min_length=1, max_length=1024)
    previewUrl: str | None = Field(default=None, max_length=1024)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    position: list[float] | None = Field(default=None, min_length=3, max_length=3)
    scale: float | None = Field(default=None, ge=0.1, le=3.0)
    sourceFolder: str | None = Field(default=None, max_length=512)
    sourceImage: str | None = Field(default=None, max_length=256)
    referenceMode: str | None = Field(default=None, max_length=32)
    entryType: str | None = Field(default=None, pattern=r"^(award|contest)$")
