from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import numpy as np

from app.splat_skinning import (
    _bone_segments,
    _build_connected_part_ownership,
    _build_voxel_proxy,
    _enforce_rigid_core_ownership,
    _parent_facing_boundary_center,
    _quantize_weights,
    _largest_seeded_component,
    _region_influence,
    _rigid_segment_assignments,
    build_gpu_splat_skinning_rig_from_file,
)


class SplatSkinningWeightsTest(unittest.TestCase):
    def test_connected_region_growth_removes_detached_semantic_islands(self) -> None:
        keys = np.asarray(
            [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 0, 0], [20, 0, 0], [21, 0, 0]],
            dtype=np.int32,
        )
        scores = np.asarray([1.0, 0.9, 0.75, 0.5, 0.2, 0.96, 0.8], dtype=np.float32)
        selected, metrics = _largest_seeded_component(keys, scores)

        np.testing.assert_array_equal(selected, np.asarray([True, True, True, True, True, False, False]))
        self.assertEqual(metrics["componentCount"], 2)
        self.assertEqual(metrics["removedIslandCount"], 2)

    def test_connected_ownership_protects_head_from_overlapping_arm(self) -> None:
        keys = np.asarray([[0, 0, 0], [1, 0, 0], [2, 0, 0]], dtype=np.int32)
        scores = np.asarray(
            [
                [0.0, 0.72, 1.0],
                [0.0, 0.1, 0.96],
                [0.0, 0.08, 0.88],
            ],
            dtype=np.float32,
        )
        bones = [
            {"index": 0, "kind": "body"},
            {"index": 1, "kind": "head"},
            {"index": 2, "kind": "arm"},
        ]
        owner, _metrics = _build_connected_part_ownership(keys, scores, bones)

        np.testing.assert_array_equal(owner, np.asarray([1, 2, 2], dtype=np.uint8))

    def test_each_semantic_part_uses_one_rigid_bone(self) -> None:
        for kind in ("arm", "leg", "wing", "fin", "tail", "ear", "head"):
            self.assertEqual(_bone_segments(kind), 1)

    def test_overlapping_rigid_regions_resolve_to_one_bone(self) -> None:
        scores = np.asarray(
            [
                [0.0, 1.0, 1.0, 0.0],
                [0.0, 0.92, 0.96, 0.0],
                [0.0, 0.6, 0.0, 0.0],
            ],
            dtype=np.float32,
        )
        resolved = _enforce_rigid_core_ownership(scores.copy())

        np.testing.assert_array_equal(resolved[0], np.asarray([0.0, 1.0, 0.0, 0.0]))
        np.testing.assert_array_equal(resolved[1], np.asarray([0.0, 0.0, 1.0, 0.0]))
        np.testing.assert_array_equal(resolved[2], scores[2])

    def test_parent_facing_root_uses_contact_center_instead_of_corner(self) -> None:
        polygon = np.asarray(
            [[0.2, 0.7], [0.8, 0.7], [0.8, 1.0], [0.2, 1.0]],
            dtype=np.float32,
        )
        root = _parent_facing_boundary_center(
            np.asarray([0.5, 0.45], dtype=np.float32),
            polygon,
        )

        self.assertAlmostEqual(float(root[0]), 0.5, delta=0.06)
        self.assertLess(float(root[1]), 0.76)

    def test_segment_weights_are_rigid_away_from_narrow_joint_band(self) -> None:
        longitudinal = np.asarray([0.1, 0.3, 0.49, 0.5, 0.51, 0.7, 0.9], dtype=np.float32)
        assignments = _rigid_segment_assignments(longitudinal, 2)

        np.testing.assert_allclose(assignments.sum(axis=1), np.ones(longitudinal.shape[0]))
        np.testing.assert_array_equal(assignments[[0, 1]], np.asarray([[1.0, 0.0], [1.0, 0.0]]))
        np.testing.assert_array_equal(assignments[[5, 6]], np.asarray([[0.0, 1.0], [0.0, 1.0]]))
        self.assertAlmostEqual(float(assignments[3, 0]), 0.5, delta=0.02)
        self.assertAlmostEqual(float(assignments[3, 1]), 0.5, delta=0.02)

    def test_voxel_proxy_preserves_a_source_mapping_for_every_gaussian(self) -> None:
        display = np.asarray(
            [[0.0, 0.0, 0.0], [0.001, 0.001, 0.001], [1.0, 1.0, 1.0]],
            dtype=np.float32,
        )
        uv = np.asarray([[0.1, 0.1], [0.11, 0.11], [0.9, 0.9]], dtype=np.float32)
        alpha = np.asarray([255.0, 200.0, 180.0], dtype=np.float32)
        proxy = _build_voxel_proxy(display, uv, alpha, resolution=16)

        inverse = proxy["inverse"]
        self.assertIsInstance(inverse, np.ndarray)
        assert isinstance(inverse, np.ndarray)
        self.assertEqual(inverse.shape, (3,))
        self.assertEqual(int(inverse[0]), int(inverse[1]))
        self.assertNotEqual(int(inverse[0]), int(inverse[2]))

    def test_semantic_volume_weights_matching_front_and_back_layers(self) -> None:
        u_values = np.linspace(0.56, 0.94, 20, dtype=np.float32)
        v_values = np.linspace(0.24, 0.76, 10, dtype=np.float32)
        uv_plane = np.asarray([(u, v) for v in v_values for u in u_values], dtype=np.float32)
        uv = np.repeat(uv_plane, 2, axis=0)
        depth = np.tile(np.asarray([-0.9, 0.9], dtype=np.float32), uv_plane.shape[0])
        display = np.stack(
            [(uv[:, 0] - 0.5) * 2.0, (0.5 - uv[:, 1]) * 2.0, depth],
            axis=1,
        ).astype(np.float32)
        part_count = display.shape[0]
        body_uv = np.tile(np.asarray([[0.2, 0.5]], dtype=np.float32), (800, 1))
        body_display = np.stack(
            [
                np.full(800, -0.6, dtype=np.float32),
                np.linspace(-0.7, 0.7, 800, dtype=np.float32),
                np.linspace(-0.8, 0.8, 800, dtype=np.float32),
            ],
            axis=1,
        )
        uv = np.concatenate([uv, body_uv], axis=0)
        display = np.concatenate([display, body_display], axis=0)
        alpha = np.full(display.shape[0], 255.0, dtype=np.float32)
        region = {
            "id": "test-arm",
            "kind": "arm",
            "side": "left",
            "confidence": 0.99,
            "root": [0.55, 0.5],
            "tip": [0.95, 0.5],
            "polygon": [
                [0.54, 0.2],
                [0.96, 0.2],
                [0.98, 0.5],
                [0.96, 0.8],
                [0.54, 0.8],
                [0.52, 0.5],
            ],
        }
        fitted = _region_influence(
            display=display,
            uv=uv,
            alpha=alpha,
            proxy_display=display,
            proxy_uv=uv,
            proxy_alpha=alpha,
            proxy_voxel_size=0.04,
            region=region,
            bounds=np.asarray([0.0, 0.0, 1.0, 1.0], dtype=np.float32),
            head_center=None,
        )

        self.assertIsNotNone(fitted)
        assert fitted is not None
        influence = fitted["influence"]
        self.assertIsInstance(influence, np.ndarray)
        assert isinstance(influence, np.ndarray)
        part_influence = influence[:part_count]
        np.testing.assert_allclose(part_influence[0::2], part_influence[1::2], atol=1e-6)
        self.assertGreater(float((part_influence >= 0.9).mean()), 0.7)

    def test_distal_depth_track_keeps_two_limb_shells_and_rejects_torso_layer(self) -> None:
        u_values = np.linspace(0.56, 0.94, 24, dtype=np.float32)
        v_values = np.linspace(0.34, 0.66, 8, dtype=np.float32)
        limb_uv_plane = np.asarray([(u, v) for v in v_values for u in u_values], dtype=np.float32)
        limb_uv = np.repeat(limb_uv_plane, 2, axis=0)
        limb_depth = np.tile(np.asarray([-0.2, 0.2], dtype=np.float32), limb_uv_plane.shape[0])
        limb_display = np.stack(
            [(limb_uv[:, 0] - 0.5) * 2.0, (0.5 - limb_uv[:, 1]) * 2.0, limb_depth],
            axis=1,
        ).astype(np.float32)

        torso_u = np.linspace(0.56, 0.73, 14, dtype=np.float32)
        torso_v = np.linspace(0.35, 0.65, 8, dtype=np.float32)
        torso_uv = np.asarray([(u, v) for v in torso_v for u in torso_u], dtype=np.float32)
        torso_display = np.stack(
            [
                (torso_uv[:, 0] - 0.5) * 2.0,
                (0.5 - torso_uv[:, 1]) * 2.0,
                np.full(torso_uv.shape[0], 0.78, dtype=np.float32),
            ],
            axis=1,
        )

        body_uv = np.tile(np.asarray([[0.2, 0.5]], dtype=np.float32), (800, 1))
        body_display = np.stack(
            [
                np.full(800, -0.6, dtype=np.float32),
                np.linspace(-0.7, 0.7, 800, dtype=np.float32),
                np.linspace(-0.8, 0.8, 800, dtype=np.float32),
            ],
            axis=1,
        )
        uv = np.concatenate([limb_uv, torso_uv, body_uv], axis=0)
        display = np.concatenate([limb_display, torso_display, body_display], axis=0)
        alpha = np.full(display.shape[0], 255.0, dtype=np.float32)
        region = {
            "id": "layered-arm",
            "kind": "arm",
            "side": "left",
            "confidence": 0.99,
            "root": [0.55, 0.5],
            "tip": [0.95, 0.5],
            "polygon": [
                [0.54, 0.3],
                [0.96, 0.3],
                [0.98, 0.5],
                [0.96, 0.7],
                [0.54, 0.7],
                [0.52, 0.5],
            ],
        }
        fitted = _region_influence(
            display=display,
            uv=uv,
            alpha=alpha,
            proxy_display=display,
            proxy_uv=uv,
            proxy_alpha=alpha,
            proxy_voxel_size=0.04,
            region=region,
            bounds=np.asarray([0.0, 0.0, 1.0, 1.0], dtype=np.float32),
            head_center=None,
        )

        self.assertIsNotNone(fitted)
        assert fitted is not None
        influence = fitted["influence"]
        self.assertIsInstance(influence, np.ndarray)
        assert isinstance(influence, np.ndarray)
        limb_count = limb_display.shape[0]
        torso_count = torso_display.shape[0]
        limb_influence = influence[:limb_count]
        torso_influence = influence[limb_count : limb_count + torso_count]
        np.testing.assert_allclose(limb_influence[0::2], limb_influence[1::2], atol=1e-6)
        self.assertGreater(float((limb_influence >= 0.9).mean()), 0.72)
        self.assertLess(float((torso_influence >= 0.24).mean()), 0.08)
        self.assertGreaterEqual(float(fitted["distalRecall"]), 0.9)
        self.assertLessEqual(float(fitted["capsuleLeakRatio"]), 0.1)

        longitudinal = fitted["longitudinal"]
        self.assertIsInstance(longitudinal, np.ndarray)
        assert isinstance(longitudinal, np.ndarray)
        assignments = _rigid_segment_assignments(longitudinal, 2)
        scores = np.concatenate(
            [np.zeros((display.shape[0], 1), dtype=np.float32), influence[:, None] * assignments],
            axis=1,
        )
        packed, _ = _quantize_weights(scores)
        decoded = packed & np.uint16(255)
        rigid_limb = (
            (np.arange(display.shape[0]) < limb_count)
            & (influence >= 0.9)
            & (longitudinal >= 0.14)
            & (np.abs(longitudinal - 0.5) >= 0.03)
        )
        self.assertGreater(int(rigid_limb.sum()), 100)
        np.testing.assert_array_equal(decoded[rigid_limb, 0], np.zeros(int(rigid_limb.sum()), dtype=np.uint16))
        np.testing.assert_array_equal(decoded[rigid_limb, 1], np.full(int(rigid_limb.sum()), 255, dtype=np.uint16))

    def test_quantized_weights_always_sum_to_255_and_keep_body_slot(self) -> None:
        scores = np.asarray(
            [
                [0.0, 0.0, 0.0, 0.0, 0.0],
                [0.0, 0.8, 0.1, 0.05, 0.02],
                [0.0, 0.5, 0.5, 0.5, 0.5],
                [0.0, 1.0, 0.0, 0.0, 0.0],
            ],
            dtype=np.float32,
        )
        packed, metrics = _quantize_weights(scores)
        decoded = packed & np.uint16(255)
        indices = packed >> np.uint16(8)

        np.testing.assert_array_equal(decoded.sum(axis=1), np.asarray([255, 255, 255, 255]))
        np.testing.assert_array_equal(indices[:, 0], np.asarray([0, 0, 0, 0]))
        self.assertEqual(int(decoded[3, 0]), 0)
        self.assertEqual(int(decoded[3, 1]), 255)
        self.assertEqual(metrics["minimumWeightSum"], 1.0)
        self.assertEqual(metrics["maximumWeightSum"], 1.0)

    def test_missing_articulation_falls_back_without_writing_weights(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            splat_path = directory / "model.splat"
            splat_path.write_bytes(bytes(4096 * 32))
            rig = build_gpu_splat_skinning_rig_from_file(
                splat_path=splat_path,
                artwork_dir=directory,
                artwork_id="test",
                features={},
            )

            self.assertFalse(rig["enabled"])
            self.assertEqual(rig["reason"], "missing-articulation")
            self.assertFalse((directory / "rig-weights.bin").exists())


if __name__ == "__main__":
    unittest.main()
