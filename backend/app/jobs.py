from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

from .schemas import ArtworkAssets, JobResponse, JobStatus
from .triposplat_worker import generate_triposplat_assets


@dataclass
class GenerationJob:
    job_id: str
    artwork_id: str
    artwork_dir: Path
    source_path: Path
    num_gaussians: int
    export_format: str
    status: JobStatus = JobStatus.queued
    progress: float | None = 0
    message: str | None = "queued"
    artwork: ArtworkAssets | None = None
    error: str | None = None


class JobRegistry:
    def __init__(self):
        self._jobs: dict[str, GenerationJob] = {}
        self._lock = Lock()
        self._executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="triposplat")

    def create(
        self,
        *,
        job_id: str,
        artwork_id: str,
        artwork_dir: Path,
        source_path: Path,
        num_gaussians: int,
        export_format: str,
    ) -> GenerationJob:
        job = GenerationJob(
            job_id=job_id,
            artwork_id=artwork_id,
            artwork_dir=artwork_dir,
            source_path=source_path,
            num_gaussians=num_gaussians,
            export_format=export_format,
        )
        with self._lock:
            self._jobs[job_id] = job
        self._executor.submit(self._run, job_id)
        return job

    def get(self, job_id: str) -> GenerationJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def _update(self, job_id: str, **updates):
        with self._lock:
            job = self._jobs[job_id]
            for key, value in updates.items():
                setattr(job, key, value)

    def _run(self, job_id: str):
        job = self.get(job_id)
        if job is None:
            return

        try:
            self._update(job_id, status=JobStatus.processing, progress=0.08, message="processing")
            assets = generate_triposplat_assets(
                artwork_id=job.artwork_id,
                artwork_dir=job.artwork_dir,
                source_path=job.source_path,
                num_gaussians=job.num_gaussians,
                export_format=job.export_format,
            )
            self._update(
                job_id,
                status=JobStatus.ready,
                progress=1,
                message="ready",
                artwork=ArtworkAssets(**assets),
            )
        except Exception as exc:
            self._update(
                job_id,
                status=JobStatus.failed,
                progress=1,
                message="failed",
                error=str(exc),
            )


def job_to_response(job: GenerationJob) -> JobResponse:
    return JobResponse(
        jobId=job.job_id,
        artworkId=job.artwork_id,
        status=job.status,
        progress=job.progress,
        message=job.message,
        artwork=job.artwork,
        error=job.error,
    )


jobs = JobRegistry()
