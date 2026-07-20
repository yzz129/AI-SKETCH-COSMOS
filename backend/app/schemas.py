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
    submissionId: str | None = None
    status: JobStatus
    progress: float | None = None
    message: str | None = None
    artwork: ArtworkAssets | None = None
    error: str | None = None


class ArtworkMetadataUpdate(BaseModel):
    name: str | None = None
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
