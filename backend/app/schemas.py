from enum import Enum
from typing import Any
from pydantic import BaseModel


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


class JobResponse(BaseModel):
    jobId: str
    artworkId: str
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
    isDeleted: bool = False
    deletedAt: str | None = None
    createdAt: str
    updatedAt: str
