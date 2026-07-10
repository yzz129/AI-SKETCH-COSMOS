from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from threading import Condition, Lock
from time import perf_counter

from .artwork_db import upsert_generated_artwork
from .perf_logger import log_perf
from .schemas import ArtworkAssets, JobResponse, JobStatus
from .storage import asset_url
from .triposplat_worker import generate_triposplat_assets


def _log_perf(job_id: str, artwork_id: str, stage: str, message: str = "") -> None:
    log_perf(artwork_id, job_id, stage, message)


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
    created_at_perf: float = 0
    processing_started_at_perf: float = 0


class JobRegistry:
    def __init__(self):
        self._jobs: dict[str, GenerationJob] = {}
        self._lock = Lock()
        self._condition = Condition(self._lock)
        self._executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="triposplat")

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
            created_at_perf=perf_counter(),
        )
        with self._condition:
            self._jobs[job_id] = job
            self._condition.notify_all()
        _log_perf(
            job_id,
            artwork_id,
            "queued",
            f"gaussians={num_gaussians} format={export_format} source={source_path.name}",
        )
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
            start = perf_counter()
            queue_elapsed = start - job.created_at_perf if job.created_at_perf else 0
            job.processing_started_at_perf = start
            _log_perf(job.job_id, job.artwork_id, "processing:start", f"queue_elapsed={queue_elapsed:.3f}s")
            self._update(
                job_id,
                status=JobStatus.processing,
                progress=0.08,
                message="任务已开始，正在准备生成流程",
            )
            generate_start = perf_counter()

            def report_progress(progress: float, message: str) -> None:
                self._update(
                    job_id,
                    status=JobStatus.processing,
                    progress=progress,
                    message=message,
                )

            assets = generate_triposplat_assets(
                artwork_id=job.artwork_id,
                artwork_dir=job.artwork_dir,
                source_path=job.source_path,
                num_gaussians=job.num_gaussians,
                export_format=job.export_format,
                progress_callback=report_progress,
            )
            _log_perf(
                job.job_id,
                job.artwork_id,
                "generate_assets:end",
                f"elapsed={perf_counter() - generate_start:.3f}s",
            )
            db_start = perf_counter()
            upsert_generated_artwork(
                artwork_id=job.artwork_id,
                source_path=job.source_path,
                source_url=asset_url(job.artwork_id, job.source_path.name),
                preview_url=assets.get("previewUrl"),
                splat_url=assets.get("splatUrl"),
                ply_url=assets.get("plyUrl"),
                manifest_url=assets.get("manifestUrl"),
                gaussian_count=assets["gaussianCount"],
            )
            _log_perf(job.job_id, job.artwork_id, "db_upsert:end", f"elapsed={perf_counter() - db_start:.3f}s")
            self._update(
                job_id,
                status=JobStatus.ready,
                progress=1,
                message="ready",
                artwork=ArtworkAssets(**assets),
            )
            _log_perf(
                job.job_id,
                job.artwork_id,
                "ready",
                f"total_elapsed={perf_counter() - start:.3f}s",
            )
        except Exception as exc:
            _log_perf(job.job_id, job.artwork_id, "failed", str(exc).replace("\n", " ")[:800])
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
