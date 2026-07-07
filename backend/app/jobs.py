from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from threading import Condition, Lock

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
        self._condition = Condition(self._lock)
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
        with self._condition:
            self._jobs[job_id] = job
            self._condition.notify_all()
        self._executor.submit(self._run, job_id)
        return job

    def get(self, job_id: str) -> GenerationJob | None:
        with self._lock:
            return self._jobs.get(job_id)

    def wait_for_change(
        self,
        job_id: str,
        *,
        last_status: JobStatus | None = None,
        last_progress: float | None = None,
        timeout_seconds: float = 0,
    ) -> GenerationJob | None:
        def changed() -> bool:
            job = self._jobs.get(job_id)
            if job is None:
                return True
            if job.status in {JobStatus.ready, JobStatus.failed}:
                return True
            if last_status is not None and job.status != last_status:
                return True
            if last_progress is not None and job.progress != last_progress:
                return True
            return last_status is None and last_progress is None

        with self._condition:
            if timeout_seconds > 0:
                self._condition.wait_for(changed, timeout=timeout_seconds)
            return self._jobs.get(job_id)

    def _update(self, job_id: str, **updates):
        with self._condition:
            job = self._jobs[job_id]
            for key, value in updates.items():
                setattr(job, key, value)
            self._condition.notify_all()

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
