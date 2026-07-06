from enum import Enum
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
