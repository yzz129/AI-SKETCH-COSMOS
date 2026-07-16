from __future__ import annotations

import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

import numpy as np

from app.splat_multiview import (
    _capsule_score,
    _fuse_regions,
    _render_view,
    analyse_multiview_regions,
)


class SplatMultiviewTest(unittest.TestCase):
    def test_front_view_id_buffer_keeps_nearest_gaussian(self) -> None:
        display = np.asarray([[0.0, 0.0, -1.0], [0.0, 0.0, 1.0]], dtype=np.float32)
        rgba = np.asarray([[255, 0, 0, 255], [0, 255, 0, 255]], dtype=np.uint8)
        with tempfile.TemporaryDirectory() as temporary:
            view = _render_view(
                display,
                rgba,
                name="front",
                azimuth=0.0,
                elevation=0.0,
                output_path=Path(temporary) / "front.png",
                size=32,
            )
        self.assertEqual(int(view["idBuffer"][16, 16]), 1)

    def test_two_views_fuse_the_same_complete_part(self) -> None:
        count = 160
        display = np.stack(
            [np.linspace(0.0, 1.0, count), np.zeros(count), np.zeros(count)],
            axis=1,
        ).astype(np.float32)
        columns = (np.arange(32, dtype=np.int32) * 5)[None, :]
        ids = columns + (np.arange(32, dtype=np.int32)[:, None] % 5)
        region = {
            "id": "left-arm",
            "kind": "arm",
            "side": "left",
            "confidence": 0.95,
            "root": [0.05, 0.5],
            "tip": [0.95, 0.5],
            "polygon": [[0.0, 0.0], [1.0, 0.0], [1.0, 1.0], [0.0, 1.0]],
        }
        analyses = [
            {
                "view": {"name": name, "idBuffer": ids},
                "articulation": {"regions": [region]},
            }
            for name in ("front", "left")
        ]

        fused, scores = _fuse_regions(analyses, display)

        self.assertEqual(len(fused), 1)
        self.assertEqual(fused[0]["kind"], "arm")
        self.assertEqual(fused[0]["viewHits"], 2)
        self.assertEqual(int(np.count_nonzero(scores[fused[0]["id"]])), count)

    def test_capsule_completion_rejects_distant_body_points(self) -> None:
        points = np.asarray(
            [[0.0, 0.0, 0.0], [0.5, 0.02, 0.0], [1.0, 0.0, 0.0], [0.5, 2.0, 0.0]],
            dtype=np.float32,
        )
        evidence = np.asarray([1.0, 1.0, 1.0, 0.0], dtype=np.float32)
        scores = _capsule_score(
            points,
            np.asarray([0.0, 0.0, 0.0], dtype=np.float32),
            np.asarray([1.0, 0.0, 0.0], dtype=np.float32),
            evidence,
        )
        self.assertGreater(float(scores[1]), 0.8)
        self.assertEqual(float(scores[3]), 0.0)

    def test_adaptive_analysis_uses_one_primary_batch_when_evidence_repeats(self) -> None:
        calls: list[list[str]] = []

        def fake_batch(entries: list[tuple[str, Path, Path]]) -> dict[str, object]:
            calls.append([name for name, _, _ in entries])
            articulation = {
                "version": 2,
                "coordinateSpace": "source-image-normalized",
                "leftRightConvention": "subject-anatomical",
                "subjectBounds": [0.1, 0.1, 0.9, 0.9],
                "regions": [
                    {
                        "id": "left-arm-1",
                        "kind": "arm",
                        "side": "left",
                        "confidence": 0.95,
                        "root": [0.5, 0.5],
                        "tip": [0.25, 0.4],
                        "polygon": [[0.2, 0.3], [0.4, 0.3], [0.5, 0.4], [0.45, 0.6], [0.3, 0.7], [0.2, 0.5]],
                    }
                ],
            }
            return {
                "articulations": {name: {**articulation, "view": name} for name, _, _ in entries},
                "usage": {"inputTokens": 1200, "outputTokens": 400, "totalTokens": 1600},
                "promptCharacters": 600,
            }

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            views = []
            for name in ("front", "front-left", "left", "back", "right", "front-right"):
                path = root / "rig-multiview" / name / "render.png"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(name.encode("ascii"))
                views.append({"name": name, "path": path})
            with patch("app.splat_multiview.analyse_articulation_multiview_regions", side_effect=fake_batch):
                analyses = analyse_multiview_regions(views, root)

        self.assertEqual(calls, [["front", "left", "back", "right"]])
        self.assertEqual(len(analyses), 4)


if __name__ == "__main__":
    unittest.main()
