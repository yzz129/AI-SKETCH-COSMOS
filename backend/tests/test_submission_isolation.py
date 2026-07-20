from __future__ import annotations

import io
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor as TestExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import patch

from app.jobs import JobQueueFullError, JobRegistry, job_to_response
from app.schemas import JobStatus
from app.storage import UploadTooLargeError, create_artwork_dir, save_upload


class _DeferredExecutor:
    def __init__(self) -> None:
        self.submissions: list[tuple[object, tuple[object, ...]]] = []

    def submit(self, function, *args):
        self.submissions.append((function, args))
        return None


def _create_job(registry: JobRegistry, base: Path, index: int):
    artwork_id = f"artwork_{index}"
    artwork_dir = base / artwork_id
    artwork_dir.mkdir()
    source_path = artwork_dir / "source.png"
    source_path.write_bytes(b"image")
    return registry.create(
        job_id=f"job_{index}",
        artwork_id=artwork_id,
        submission_id=f"submission_{index}",
        artwork_dir=artwork_dir,
        source_path=source_path,
        num_gaussians=65_536,
        export_format="splat",
    )


class SubmissionIsolationTest(unittest.TestCase):
    def test_concurrent_artwork_directories_are_unique(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            output_root = Path(temporary)
            with patch("app.storage.OUTPUT_ROOT", output_root):
                with TestExecutor(max_workers=16) as executor:
                    created = list(executor.map(lambda _: create_artwork_dir(), range(64)))

            artwork_ids = [artwork_id for artwork_id, _ in created]
            directories = [directory for _, directory in created]
            self.assertEqual(len(set(artwork_ids)), 64)
            self.assertEqual(len(set(directories)), 64)
            self.assertTrue(all(directory.is_dir() for directory in directories))

    def test_upload_limit_removes_partial_file(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            artwork_dir = Path(temporary)
            with self.assertRaises(UploadTooLargeError):
                save_upload(io.BytesIO(b"12345"), artwork_dir, "test.png", max_bytes=4)
            self.assertFalse((artwork_dir / "source.png").exists())

    def test_queue_capacity_is_atomic_under_concurrent_admission(self) -> None:
        deferred = _DeferredExecutor()
        environment = {
            "TRIPOSPLAT_MAX_WORKERS": "1",
            "TRIPOSPLAT_MAX_ACTIVE_JOBS": "4",
        }
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.dict(os.environ, environment, clear=False),
            patch("app.jobs.ThreadPoolExecutor", return_value=deferred),
        ):
            registry = JobRegistry()
            base = Path(temporary)
            barrier = Barrier(16)

            def admit(index: int) -> str:
                barrier.wait()
                try:
                    _create_job(registry, base, index)
                    return "accepted"
                except JobQueueFullError:
                    return "full"

            with TestExecutor(max_workers=16) as executor:
                results = list(executor.map(admit, range(16)))

            self.assertEqual(results.count("accepted"), 4)
            self.assertEqual(results.count("full"), 12)
            self.assertEqual(registry.stats()["active"], 4)
            self.assertEqual(len(deferred.submissions), 4)

    def test_partial_preview_and_submission_id_are_published_while_processing(self) -> None:
        deferred = _DeferredExecutor()
        snapshots = []
        with (
            tempfile.TemporaryDirectory() as temporary,
            patch.dict(
                os.environ,
                {"TRIPOSPLAT_MAX_WORKERS": "1", "TRIPOSPLAT_MAX_ACTIVE_JOBS": "2"},
                clear=False,
            ),
            patch("app.jobs.ThreadPoolExecutor", return_value=deferred),
        ):
            registry = JobRegistry()
            job = _create_job(registry, Path(temporary), 1)

            def generate(**kwargs):
                kwargs["progress_callback"](
                    0.45,
                    "effect ready",
                    {
                        "previewUrl": "/assets/artwork_1/seedream_reference.png",
                        "gaussianCount": 65_536,
                    },
                )
                snapshots.append(job_to_response(registry.get(job.job_id)))
                return {
                    "splatUrl": "/assets/artwork_1/model.splat",
                    "plyUrl": None,
                    "previewUrl": "/assets/artwork_1/preprocessed_image.webp",
                    "manifestUrl": "/assets/artwork_1/manifest.json",
                    "gaussianCount": 65_536,
                    "rigUrl": None,
                    "features": None,
                }

            with (
                patch("app.jobs.generate_triposplat_assets", side_effect=generate),
                patch("app.jobs.upsert_generated_artwork"),
                patch("app.jobs._log_perf"),
            ):
                registry._run(job.job_id)

            partial = snapshots[0]
            self.assertEqual(partial.submissionId, "submission_1")
            self.assertEqual(partial.status, JobStatus.processing)
            self.assertEqual(
                partial.artwork.previewUrl,
                "/assets/artwork_1/seedream_reference.png",
            )
            self.assertEqual(partial.artwork.gaussianCount, 65_536)
            self.assertEqual(registry.get(job.job_id).status, JobStatus.ready)


if __name__ == "__main__":
    unittest.main()
