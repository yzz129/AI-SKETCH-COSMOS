import uuid

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .jobs import job_to_response, jobs
from .schemas import JobResponse, JobStatus
from .storage import create_artwork_dir, ensure_output_root, save_upload
from .triposplat_worker import triposplat_config_status


app = FastAPI(title="AI Sketch Cosmos TripoSplat Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/assets", StaticFiles(directory=str(ensure_output_root())), name="assets")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/health/triposplat")
def triposplat_health():
    return triposplat_config_status()


@app.post("/api/artworks", response_model=JobResponse)
async def create_artwork_job(
    image: UploadFile = File(...),
    numGaussians: int = Form(131_072),
    format: str = Form("splat"),
):
    triposplat_status = triposplat_config_status()
    if not triposplat_status["ready"]:
        raise HTTPException(status_code=503, detail={"message": "TripoSplat backend is not ready", "status": triposplat_status})

    export_format = format.lower()
    if export_format not in {"splat", "ply", "both"}:
        raise HTTPException(status_code=400, detail="format must be one of: splat, ply, both")

    if numGaussians < 4_096 or numGaussians > 262_144:
        raise HTTPException(status_code=400, detail="numGaussians must be between 4096 and 262144")

    artwork_id, artwork_dir = create_artwork_dir()
    source_path = save_upload(image.file, artwork_dir, image.filename or "source.png")
    job = jobs.create(
        job_id=f"job_{uuid.uuid4().hex}",
        artwork_id=artwork_id,
        artwork_dir=artwork_dir,
        source_path=source_path,
        num_gaussians=numGaussians,
        export_format=export_format,
    )
    return job_to_response(job)


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
