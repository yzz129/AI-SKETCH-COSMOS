from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.storage import write_json_atomic, write_manifest
from app.triposplat_worker import (
    _finalize_gpu_splat_skinning,
    _pending_rig,
    generate_triposplat_assets,
)


class _FakeGaussian:
    def save_splat(self, path: Path) -> None:
        path.write_bytes(b"base-splat")


class _FakePrepared:
    def save(self, path: Path) -> None:
        path.write_bytes(b"preview")


class AsyncRigPublishTest(unittest.TestCase):
    def test_pending_rig_is_replaced_without_republishing_base_splat(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            splat_path = directory / "model.splat"
            splat_path.write_bytes(b"base-splat-remains-intact")
            original_splat = splat_path.read_bytes()
            fallback = {"motionPreset": "spiritFloat"}
            pending = _pending_rig(65536)
            write_json_atomic(directory / "rig.json", pending)
            write_manifest(
                directory,
                {
                    "id": "artwork_test",
                    "rig": pending,
                    "features": fallback,
                    "performance": {"timingsSeconds": {"pipeline_run": 20.0}},
                },
            )
            ready_rig = {
                "version": 14,
                "revision": 2,
                "enabled": True,
                "status": "ready",
                "strategy": "cpu-splat-bone-mapping",
                "bones": [{"index": 0}, {"index": 1}],
            }

            with (
                patch("app.triposplat_worker._log_perf"),
                patch("app.triposplat_worker.build_multiview_splat_rig", return_value=ready_rig),
            ):
                _finalize_gpu_splat_skinning(
                    artwork_id="artwork_test",
                    artwork_dir=directory,
                    splat_path=splat_path,
                    articulation_future=None,
                    fallback_features=fallback,
                )

            published_rig = json.loads((directory / "rig.json").read_text(encoding="utf-8"))
            manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
            self.assertTrue(published_rig["enabled"])
            self.assertEqual(published_rig["status"], "ready")
            self.assertEqual(manifest["rig"], published_rig)
            self.assertEqual(manifest["features"], fallback)
            self.assertIn("background_rig_build", manifest["performance"]["timingsSeconds"])
            self.assertEqual(splat_path.read_bytes(), original_splat)
            self.assertFalse(list(directory.glob(".*.tmp")))

    def test_base_generation_returns_pending_rig_without_waiting_for_builder(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            source = directory / "source.png"
            source.write_bytes(b"source")
            preparation = SimpleNamespace(
                input_path=source,
                enabled=False,
                used=False,
                model="disabled",
                reference_filename=None,
                fallback_reason=None,
                manifest_payload=lambda: {"enabled": False, "used": False},
            )
            pipeline = MagicMock()
            pipeline.run.return_value = (_FakeGaussian(), _FakePrepared())
            schedule = MagicMock()
            build = MagicMock()

            with (
                patch.dict(
                    os.environ,
                    {
                        "TRIPOSPLAT_DEVICE": "cuda",
                        "TRIPOSPLAT_IN_SUBPROCESS": "",
                        "SPLAT_GPU_SKINNING_ENABLED": "true",
                    },
                    clear=False,
                ),
                patch("app.triposplat_worker._log_perf"),
                patch("app.triposplat_worker._gpu_snapshot", return_value=""),
                patch("app.triposplat_worker.prepare_seedream_reference", return_value=preparation),
                patch("app.triposplat_worker.load_pipeline", return_value=pipeline),
                patch("app.triposplat_worker._schedule_gpu_splat_skinning", schedule),
                patch("app.triposplat_worker.build_multiview_splat_rig", build),
            ):
                assets = generate_triposplat_assets(
                    artwork_id="artwork_fast",
                    artwork_dir=directory,
                    source_path=source,
                    num_gaussians=65536,
                    export_format="splat",
                    features={"motionPreset": "spiritFloat"},
                )

            pending = json.loads((directory / "rig.json").read_text(encoding="utf-8"))
            manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(assets["splatUrl"], "/assets/artwork_fast/model.splat")
            self.assertEqual(assets["rigUrl"], "/assets/artwork_fast/rig.json")
            self.assertEqual(pending["status"], "processing")
            self.assertEqual(manifest["rig"]["status"], "processing")
            schedule.assert_called_once()
            build.assert_not_called()


if __name__ == "__main__":
    unittest.main()
