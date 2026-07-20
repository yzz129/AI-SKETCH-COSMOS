import json
import os
import re
import shutil
import uuid
from pathlib import Path
from time import perf_counter

from fastapi import FastAPI, File, Form, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .artwork_db import (
    backfill_existing_outputs,
    count_artworks,
    delete_artwork_permanently,
    get_artwork,
    list_artworks,
    restore_artwork,
    soft_delete_artwork,
    update_artwork_evolution,
    update_artwork_metadata,
)
from .jobs import JobQueueFullError, job_to_response, jobs
from .perf_logger import log_perf
from .schemas import (
    ArtworkEvolutionBatchUpdate,
    ArtworkMetadataUpdate,
    JobResponse,
    JobStatus,
    PersistedArtwork,
)
from .storage import UploadTooLargeError, create_artwork_dir, ensure_output_root, output_roots, save_upload
from .triposplat_worker import triposplat_config_status


app = FastAPI(title="AI Sketch Cosmos TripoSplat Backend")
MAX_UPLOAD_BYTES = int(os.getenv("TRIPOSPLAT_MAX_UPLOAD_BYTES", str(15 * 1024 * 1024)))
SUBMISSION_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


class MultiRootStaticFiles(StaticFiles):
    """Serve the canonical asset directory plus any legacy cwd-relative directory."""

    def __init__(self, directories: tuple[Path, ...]) -> None:
        super().__init__(directory=str(directories[0]))
        self.all_directories = [str(directory) for directory in directories]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"],
)

ensure_output_root()
app.mount("/assets", MultiRootStaticFiles(output_roots()), name="assets")


@app.on_event("startup")
def hydrate_artwork_database():
    imported = backfill_existing_outputs()
    if imported:
        print(f"[artwork-db] imported {imported} existing artwork outputs")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/health/triposplat")
def triposplat_health():
    return {**triposplat_config_status(), "queue": jobs.stats()}


@app.get("/api/artworks", response_model=list[PersistedArtwork])
def get_artworks(
    response: Response,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    status: str = Query("active", pattern="^(active|deleted|all)$"),
):
    response.headers["X-Total-Count"] = str(count_artworks(status=status))
    return list_artworks(limit=limit, offset=offset, status=status)


@app.get("/api/artworks/{artwork_id}", response_model=PersistedArtwork)
def get_artwork_by_id(artwork_id: str):
    artwork = get_artwork(artwork_id)
    if artwork is None:
        raise HTTPException(status_code=404, detail="artwork not found")
    return artwork


@app.post("/api/artworks", response_model=JobResponse)
def create_artwork_job(
    image: UploadFile = File(...),
    numGaussians: int = Form(65_536),
    format: str = Form("splat"),
    features: str | None = Form(None),
    submissionId: str | None = Form(None),
):
    request_start = perf_counter()
    triposplat_status = triposplat_config_status()
    if not triposplat_status["ready"]:
        raise HTTPException(status_code=503, detail={"message": "TripoSplat backend is not ready", "status": triposplat_status})

    export_format = format.lower()
    if export_format not in {"splat", "ply", "both"}:
        raise HTTPException(status_code=400, detail="format must be one of: splat, ply, both")

    if numGaussians < 4_096 or numGaussians > 262_144:
        raise HTTPException(status_code=400, detail="numGaussians must be between 4096 and 262144")

    client_submission_id = submissionId.strip() if submissionId else None
    if client_submission_id and not SUBMISSION_ID_PATTERN.fullmatch(client_submission_id):
        raise HTTPException(status_code=400, detail="submissionId contains invalid characters")

    queue = jobs.stats()
    if queue["active"] >= queue["capacity"]:
        raise HTTPException(
            status_code=429,
            detail="generation queue is full; retry later",
            headers={"Retry-After": "10"},
        )

    create_dir_start = perf_counter()
    artwork_id, artwork_dir = create_artwork_dir()
    log_perf(artwork_id, "request", "create_artwork_dir", f"elapsed={perf_counter() - create_dir_start:.3f}s")
    try:
        save_start = perf_counter()
        source_path = save_upload(
            image.file,
            artwork_dir,
            image.filename or "source.png",
            max_bytes=MAX_UPLOAD_BYTES,
        )
        log_perf(
            artwork_id,
            "request",
            "save_upload",
            (
                f"elapsed={perf_counter() - save_start:.3f}s "
                f"filename={image.filename or 'source.png'} bytes={source_path.stat().st_size}"
            ),
        )
        parsed_features = None
        if features:
            try:
                parsed_features = json.loads(features)
                if not isinstance(parsed_features, dict):
                    raise ValueError("features must decode to an object")
            except (json.JSONDecodeError, ValueError) as exc:
                raise HTTPException(status_code=400, detail=f"invalid features JSON: {exc}") from exc

        job = jobs.create(
            job_id=f"job_{uuid.uuid4().hex}",
            artwork_id=artwork_id,
            submission_id=client_submission_id,
            artwork_dir=artwork_dir,
            source_path=source_path,
            num_gaussians=numGaussians,
            export_format=export_format,
            features=parsed_features,
        )
    except UploadTooLargeError as exc:
        shutil.rmtree(artwork_dir, ignore_errors=True)
        raise HTTPException(status_code=413, detail=f"image exceeds {MAX_UPLOAD_BYTES} bytes") from exc
    except JobQueueFullError as exc:
        shutil.rmtree(artwork_dir, ignore_errors=True)
        raise HTTPException(
            status_code=429,
            detail="generation queue is full; retry later",
            headers={"Retry-After": "10"},
        ) from exc
    except Exception:
        shutil.rmtree(artwork_dir, ignore_errors=True)
        raise
    log_perf(
        artwork_id,
        job.job_id,
        "request:end",
        (
            f"elapsed={perf_counter() - request_start:.3f}s gaussians={numGaussians} format={export_format}"
        ),
    )
    return job_to_response(job)


@app.patch("/api/artworks/{artwork_id}/metadata")
def patch_artwork_metadata(artwork_id: str, payload: ArtworkMetadataUpdate):
    updated = update_artwork_metadata(
        artwork_id,
        name=payload.name,
        width=payload.width,
        height=payload.height,
        aspect=payload.aspect,
        features=payload.features,
        gaussian_model=payload.gaussianModel,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="artwork not found")
    return {"ok": True}


@app.patch("/api/artworks/evolution")
def patch_artwork_evolution(payload: ArtworkEvolutionBatchUpdate):
    records = [record.model_dump() for record in payload.records]
    updated = update_artwork_evolution(records)
    return {"ok": True, "updated": updated}


@app.delete("/api/artworks/{artwork_id}")
def remove_artwork(artwork_id: str):
    deleted = soft_delete_artwork(artwork_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="artwork not found")
    return {"ok": True}


@app.post("/api/artworks/{artwork_id}/restore")
def restore_removed_artwork(artwork_id: str):
    restored = restore_artwork(artwork_id)
    if not restored:
        raise HTTPException(status_code=404, detail="artwork not found")
    return {"ok": True}


@app.delete("/api/artworks/{artwork_id}/permanent")
def remove_artwork_permanently(artwork_id: str):
    deleted = delete_artwork_permanently(artwork_id, delete_files=True)
    if not deleted:
        raise HTTPException(status_code=404, detail="artwork not found")
    return {"ok": True}


@app.get("/api/jobs/{job_id}", response_model=JobResponse)
def get_job(
    job_id: str,
    waitMs: int = Query(0, ge=0, le=30_000),
    lastStatus: JobStatus | None = None,
    lastProgress: float | None = None,
):
    job = jobs.wait_for_change(
        job_id,
        last_status=lastStatus,
        last_progress=lastProgress,
        timeout_seconds=waitMs / 1000,
    ) if waitMs > 0 else jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job not found")
    return job_to_response(job)
