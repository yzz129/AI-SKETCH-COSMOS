from __future__ import annotations

import json
import hashlib
import math
import os
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw

from .semantic_articulation import analyse_articulation_multiview_regions, analyse_articulation_regions
from .splat_skinning import (
    WEIGHT_SLOTS,
    WEIGHTS_FILENAME,
    _animation,
    _build_connected_part_ownership,
    _build_voxel_proxy,
    _decode_splat,
    _normalized_display_coordinates,
    _quantize_weights,
    _safe_axis,
)
from .storage import write_json_atomic


MULTIVIEW_FILENAME = "rig-multiview.json"
PROXY_MESH_FILENAME = "rig-proxy.obj"
VIEW_ROOT_NAME = "rig-multiview"
AI_USAGE_FILENAME = "rig-ai-usage.json"
VIEW_SIZE = 448
MIN_VIEW_HITS = 2
MIN_VISIBLE_GAUSSIANS = 120
ALLOWED_KINDS = {"arm", "leg", "wing", "fin", "tail", "ear", "head"}
MOVING_KINDS = {"arm", "leg", "wing", "fin", "tail"}
STATIC_KINDS = {"body", "head", "ear"}


VIEW_SPECS: tuple[tuple[str, float, float], ...] = (
    ("front", 0.0, 0.0),
    ("front-left", 45.0, 0.0),
    ("left", 90.0, 0.0),
    ("back", 180.0, 0.0),
    ("right", 270.0, 0.0),
    ("front-right", 315.0, 0.0),
)
PRIMARY_VIEW_NAMES = ("front", "left", "back", "right")
SUPPLEMENTAL_VIEW_NAMES = ("front-left", "front-right")


def _camera_basis(azimuth_degrees: float, elevation_degrees: float) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    azimuth = math.radians(azimuth_degrees)
    elevation = math.radians(elevation_degrees)
    camera_direction = np.asarray(
        [
            math.sin(azimuth) * math.cos(elevation),
            math.sin(elevation),
            math.cos(azimuth) * math.cos(elevation),
        ],
        dtype=np.float32,
    )
    forward = -camera_direction
    world_up = np.asarray([0.0, 1.0, 0.0], dtype=np.float32)
    right = np.cross(forward, world_up)
    if float(np.linalg.norm(right)) < 1e-6:
        right = np.asarray([1.0, 0.0, 0.0], dtype=np.float32)
    right /= max(float(np.linalg.norm(right)), 1e-6)
    up = np.cross(right, forward)
    up /= max(float(np.linalg.norm(up)), 1e-6)
    return right, up, forward


def _render_view(
    display: np.ndarray,
    rgba: np.ndarray,
    *,
    name: str,
    azimuth: float,
    elevation: float,
    output_path: Path,
    size: int = VIEW_SIZE,
) -> dict[str, Any]:
    low = np.percentile(display, 0.5, axis=0).astype(np.float32)
    high = np.percentile(display, 99.5, axis=0).astype(np.float32)
    center = (low + high) * 0.5
    centered = display - center[None, :]
    right, up, forward = _camera_basis(azimuth, elevation)
    x = centered @ right
    y = centered @ up
    depth = centered @ forward
    half_extent = max(float(np.percentile(np.abs(x), 99.5)), float(np.percentile(np.abs(y), 99.5)), 1e-5)
    scale = half_extent * 1.12
    u = 0.5 + x / (2.0 * scale)
    v = 0.5 - y / (2.0 * scale)
    px = np.rint(u * (size - 1)).astype(np.int32)
    py = np.rint(v * (size - 1)).astype(np.int32)
    valid = (px >= 0) & (px < size) & (py >= 0) & (py < size) & (rgba[:, 3] >= 6)
    ids = np.flatnonzero(valid).astype(np.int32)

    winner_rank = np.full(size * size, -1, dtype=np.int32)
    disk_offsets = [(dx, dy) for dy in range(-2, 3) for dx in range(-2, 3) if dx * dx + dy * dy <= 5]
    # The camera lies opposite `forward`, so smaller forward values are nearer.
    # Draw large (far) values first and let the nearest Gaussian win last.
    order = np.argsort(-depth[ids])
    ordered_ids = ids[order]
    rank_by_id = np.full(display.shape[0], -1, dtype=np.int32)
    rank_by_id[ordered_ids] = np.arange(ordered_ids.size, dtype=np.int32)
    for dx, dy in disk_offsets:
        ox = px[ordered_ids] + dx
        oy = py[ordered_ids] + dy
        inside = (ox >= 0) & (ox < size) & (oy >= 0) & (oy < size)
        selected = ordered_ids[inside]
        flat = oy[inside] * size + ox[inside]
        np.maximum.at(winner_rank, flat, rank_by_id[selected])

    id_buffer = np.full(size * size, -1, dtype=np.int32)
    occupied_flat = winner_rank >= 0
    id_buffer[occupied_flat] = ordered_ids[winner_rank[occupied_flat]]
    depth_buffer = np.full(size * size, -np.inf, dtype=np.float32)
    depth_buffer[occupied_flat] = depth[id_buffer[occupied_flat]]
    id_buffer = id_buffer.reshape(size, size)
    depth_buffer = depth_buffer.reshape(size, size)
    image = np.zeros((size, size, 3), dtype=np.uint8)
    image[:, :] = np.asarray([10, 15, 36], dtype=np.uint8)
    occupied = id_buffer >= 0
    image[occupied] = rgba[id_buffer[occupied], :3]
    # A subtle neutral outline makes white characters legible to the vision
    # model without introducing colored background objects.
    Image.fromarray(image, mode="RGB").save(output_path, format="PNG", optimize=True)
    return {
        "name": name,
        "azimuth": azimuth,
        "elevation": elevation,
        "path": output_path,
        "idBuffer": id_buffer,
        "depthBuffer": depth_buffer,
        "u": u.astype(np.float32),
        "v": v.astype(np.float32),
        "center": center,
        "scale": scale,
        "right": right,
        "up": up,
        "forward": forward,
    }


def render_multiview_splats(splat_path: Path, artwork_dir: Path) -> tuple[dict[str, np.ndarray], np.ndarray, list[dict[str, Any]]]:
    arrays = _decode_splat(splat_path)
    display, _, _ = _normalized_display_coordinates(arrays["xyz"])
    view_root = artwork_dir / VIEW_ROOT_NAME
    view_root.mkdir(parents=True, exist_ok=True)
    views: list[dict[str, Any]] = []
    for name, azimuth, elevation in VIEW_SPECS:
        view_dir = view_root / name
        view_dir.mkdir(parents=True, exist_ok=True)
        views.append(
            _render_view(
                display,
                arrays["rgba"],
                name=name,
                azimuth=azimuth,
                elevation=elevation,
                output_path=view_dir / "render.png",
            )
        )
    return arrays, display, views


def _polygon_mask(size: int, polygon: list[list[float]]) -> np.ndarray:
    mask = Image.new("L", (size, size), 0)
    points = [(round(float(point[0]) * (size - 1)), round(float(point[1]) * (size - 1))) for point in polygon]
    ImageDraw.Draw(mask).polygon(points, fill=255)
    return np.asarray(mask, dtype=np.uint8) > 0


def _nearest_visible_id(id_buffer: np.ndarray, point: list[float], radius: int = 14) -> int | None:
    size = id_buffer.shape[0]
    x = int(round(float(point[0]) * (size - 1)))
    y = int(round(float(point[1]) * (size - 1)))
    low_x, high_x = max(0, x - radius), min(size, x + radius + 1)
    low_y, high_y = max(0, y - radius), min(size, y + radius + 1)
    local = id_buffer[low_y:high_y, low_x:high_x]
    ys, xs = np.nonzero(local >= 0)
    if not xs.size:
        return None
    distances = (xs + low_x - x) ** 2 + (ys + low_y - y) ** 2
    chosen = int(np.argmin(distances))
    return int(local[ys[chosen], xs[chosen]])


def _part_axis_endpoints(
    points: np.ndarray,
    object_center: np.ndarray,
    root_hint: np.ndarray | None,
) -> tuple[np.ndarray, np.ndarray]:
    local_center = np.median(points, axis=0)
    covariance = np.cov((points - local_center[None, :]).T)
    values, vectors = np.linalg.eigh(covariance)
    principal = vectors[:, int(np.argmax(values))].astype(np.float32)
    projection = (points - local_center[None, :]) @ principal
    anchor_count = min(points.shape[0], max(24, min(256, points.shape[0] // 14)))
    ordered = np.argsort(projection)
    first = np.median(points[ordered[:anchor_count]], axis=0).astype(np.float32)
    second = np.median(points[ordered[-anchor_count:]], axis=0).astype(np.float32)
    first_distance = float(np.linalg.norm(first - object_center))
    second_distance = float(np.linalg.norm(second - object_center))
    tolerance = max(float(np.linalg.norm(second - first)) * 0.06, 1e-5)
    if abs(first_distance - second_distance) <= tolerance and root_hint is not None:
        choose_first = np.linalg.norm(first - root_hint) <= np.linalg.norm(second - root_hint)
    else:
        choose_first = first_distance <= second_distance
    return (first, second) if choose_first else (second, first)


def analyse_multiview_regions(views: list[dict[str, Any]], artwork_dir: Path) -> list[dict[str, Any]]:
    analyses_by_name: dict[str, dict[str, Any]] = {}
    usage_batches: list[dict[str, Any]] = []

    def read_cached(view: dict[str, Any]) -> dict[str, Any] | None:
        output_dir = artwork_dir / VIEW_ROOT_NAME / str(view["name"])
        analysis_path = output_dir / "articulation.json"
        render_hash = hashlib.sha256(Path(view["path"]).read_bytes()).hexdigest()
        try:
            cached = json.loads(analysis_path.read_text(encoding="utf-8-sig"))
        except (OSError, json.JSONDecodeError):
            cached = None
        if isinstance(cached, dict) and cached.get("renderSha256") == render_hash:
            return {"view": view, "articulation": cached}
        return None

    def save_analysis(view: dict[str, Any], articulation: dict[str, Any], mode: str) -> None:
        output_dir = artwork_dir / VIEW_ROOT_NAME / str(view["name"])
        articulation["renderSha256"] = hashlib.sha256(Path(view["path"]).read_bytes()).hexdigest()
        articulation["analysisMode"] = mode
        articulation.pop("usage", None)
        write_json_atomic(output_dir / "articulation.json", articulation)
        analyses_by_name[str(view["name"])] = {"view": view, "articulation": articulation}

    def analyse_batch(batch: list[dict[str, Any]], label: str) -> None:
        if not batch:
            return
        started = time.perf_counter()
        request_views = [
            (
                str(view["name"]),
                Path(view["path"]),
                artwork_dir / VIEW_ROOT_NAME / str(view["name"]),
            )
            for view in batch
        ]
        result = analyse_articulation_multiview_regions(request_views)
        articulations = result.get("articulations") or {}
        for view in batch:
            name = str(view["name"])
            articulation = articulations.get(name)
            if isinstance(articulation, dict):
                save_analysis(view, articulation, "adaptive-multiview-batch")
            else:
                error_path = artwork_dir / VIEW_ROOT_NAME / name / "analysis-error.txt"
                error_path.write_text(f"RuntimeError: batch response omitted {name}", encoding="utf-8")
        usage_batches.append(
            {
                "label": label,
                "views": [str(view["name"]) for view in batch],
                "durationSeconds": round(time.perf_counter() - started, 4),
                "usage": result.get("usage") or {},
                "promptCharacters": int(result.get("promptCharacters") or 0),
            }
        )

    def has_repeated_moving_evidence() -> bool:
        signatures: Counter[tuple[str, str]] = Counter()
        for entry in analyses_by_name.values():
            seen: set[tuple[str, str]] = set()
            for region in entry["articulation"].get("regions") or []:
                kind = str(region.get("kind") or "")
                side = str(region.get("side") or "center")
                if kind in MOVING_KINDS:
                    seen.add((kind, side))
            signatures.update(seen)
        return any(hits >= MIN_VIEW_HITS for hits in signatures.values())

    views_by_name = {str(view["name"]): view for view in views}
    cached_view_count = 0
    for view in views:
        cached = read_cached(view)
        if cached is not None:
            analyses_by_name[str(view["name"])] = cached
            cached_view_count += 1

    primary_missing = [views_by_name[name] for name in PRIMARY_VIEW_NAMES if name not in analyses_by_name]
    try:
        analyse_batch(primary_missing, "primary-cardinal")
    except Exception as exc:
        (artwork_dir / VIEW_ROOT_NAME / "primary-analysis-error.txt").write_text(
            f"{type(exc).__name__}: {exc}",
            encoding="utf-8",
        )

    force_all = os.getenv("SPLAT_MULTIVIEW_FORCE_ALL", "false").lower() in {"1", "true", "yes", "on"}
    if force_all or not has_repeated_moving_evidence():
        supplemental_missing = [
            views_by_name[name]
            for name in SUPPLEMENTAL_VIEW_NAMES
            if name not in analyses_by_name
        ]
        try:
            analyse_batch(supplemental_missing, "supplemental-diagonal")
        except Exception as exc:
            (artwork_dir / VIEW_ROOT_NAME / "supplemental-analysis-error.txt").write_text(
                f"{type(exc).__name__}: {exc}",
                encoding="utf-8",
            )

    # Compatibility fallback: only used when a grouped response failed to
    # return enough labelled views. Normal jobs never pay these extra tokens.
    if len(analyses_by_name) < MIN_VIEW_HITS:
        workers = max(1, min(int(os.getenv("SPLAT_MULTIVIEW_AI_WORKERS", "2")), 2))

        def analyse_single(view: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
            output_dir = artwork_dir / VIEW_ROOT_NAME / str(view["name"])
            return view, analyse_articulation_regions(Path(view["path"]), output_dir)

        pending = [view for view in views if str(view["name"]) not in analyses_by_name]
        with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="splat-multiview-fallback") as executor:
            futures = {executor.submit(analyse_single, view): view for view in pending[:2]}
            for future in as_completed(futures):
                view = futures[future]
                try:
                    completed_view, articulation = future.result()
                    usage = articulation.pop("usage", {})
                    save_analysis(completed_view, articulation, "single-view-fallback")
                    usage_batches.append({"label": "single-view-fallback", "views": [str(view["name"])], "usage": usage})
                except Exception as exc:
                    error_path = artwork_dir / VIEW_ROOT_NAME / str(view["name"]) / "analysis-error.txt"
                    error_path.write_text(f"{type(exc).__name__}: {exc}", encoding="utf-8")

    if len(analyses_by_name) < MIN_VIEW_HITS:
        raise RuntimeError(
            f"multi-view articulation needs at least {MIN_VIEW_HITS} successful views; got {len(analyses_by_name)}"
        )

    total_usage = {
        key: sum(int((batch.get("usage") or {}).get(key) or 0) for batch in usage_batches)
        for key in ("inputTokens", "outputTokens", "totalTokens")
    }
    usage_path = artwork_dir / VIEW_ROOT_NAME / AI_USAGE_FILENAME
    # A cache-only rebuild must not erase the billable usage captured when the
    # model was first analysed.
    if usage_batches or not usage_path.exists():
        write_json_atomic(
            usage_path,
            {
                "version": 1,
                "strategy": "adaptive-cardinal-then-diagonal",
                "renderSize": VIEW_SIZE,
                "cachedViewCount": cached_view_count,
                "requestCount": len(usage_batches),
                "totals": total_usage,
                "batches": usage_batches,
            },
        )
    analyses = list(analyses_by_name.values())
    analyses.sort(key=lambda entry: next(i for i, spec in enumerate(VIEW_SPECS) if spec[0] == entry["view"]["name"]))
    return analyses


def _fuse_regions(
    analyses: list[dict[str, Any]],
    display: np.ndarray,
) -> tuple[list[dict[str, Any]], dict[str, np.ndarray]]:
    observations: list[dict[str, Any]] = []
    object_center = np.median(display, axis=0).astype(np.float32)
    object_extent = np.percentile(display, 99.0, axis=0) - np.percentile(display, 1.0, axis=0)
    object_diagonal = max(float(np.linalg.norm(object_extent)), 1e-5)
    for entry in analyses:
        view = entry["view"]
        articulation = entry["articulation"]
        id_buffer = np.asarray(view["idBuffer"], dtype=np.int32)
        for region in articulation.get("regions") or []:
            kind = str(region.get("kind") or "").lower()
            side = str(region.get("side") or "center").lower()
            polygon = region.get("polygon") or []
            if kind not in ALLOWED_KINDS or len(polygon) < 3:
                continue
            mask = _polygon_mask(id_buffer.shape[0], polygon)
            visible_ids = np.unique(id_buffer[mask & (id_buffer >= 0)])
            if visible_ids.size < MIN_VISIBLE_GAUSSIANS:
                continue
            confidence = float(region.get("confidence") or 0.0)
            visible_points = display[visible_ids]
            root_id = _nearest_visible_id(id_buffer, region.get("root") or [0.5, 0.5])
            root_hint = display[root_id] if root_id is not None else None
            # Fit the complete part's principal 3D axis and use Ark's point
            # only to disambiguate its two ends. This retains whole-limb
            # motion even when the reported point lies in the limb's middle.
            root, tip = _part_axis_endpoints(visible_points, object_center, root_hint)
            if float(np.linalg.norm(tip - root)) < object_diagonal * 0.015:
                continue
            observations.append(
                {
                    "view": str(view["name"]),
                    "sourceId": region.get("id"),
                    "kind": kind,
                    "reportedSide": side,
                    "confidence": confidence,
                    "visibleIds": visible_ids,
                    "root": root,
                    "tip": tip,
                }
            )

    def part_family(kind: str) -> str:
        return "appendage" if kind in {"arm", "leg", "wing", "fin"} else kind

    # Associate observations in 3D. Image-relative left/right labels are not
    # used for matching because they reverse between front and back cameras.
    clusters: list[dict[str, Any]] = []
    for observation in sorted(observations, key=lambda item: float(item["confidence"]), reverse=True):
        best: tuple[float, dict[str, Any]] | None = None
        for cluster in clusters:
            if cluster["family"] != part_family(str(observation["kind"])) or observation["view"] in cluster["views"]:
                continue
            root = np.median(np.stack(cluster["roots"]), axis=0)
            tip = np.median(np.stack(cluster["tips"]), axis=0)
            root_distance = float(np.linalg.norm(observation["root"] - root)) / object_diagonal
            tip_distance = float(np.linalg.norm(observation["tip"] - tip)) / object_diagonal
            overlaps = [
                np.intersect1d(observation["visibleIds"], ids, assume_unique=True).size
                / max(1, min(observation["visibleIds"].size, ids.size))
                for ids in cluster["visibleSets"]
            ]
            overlap = max(overlaps, default=0.0)
            root_limit = 0.34 if observation["kind"] in {"head", "tail"} else 0.22
            compatible = root_distance <= root_limit and (tip_distance <= 0.36 or overlap >= 0.035)
            if not compatible:
                continue
            cost = root_distance + tip_distance * 0.42 - overlap * 0.75
            if best is None or cost < best[0]:
                best = (cost, cluster)
        if best is None:
            clusters.append(
                {
                    "family": part_family(str(observation["kind"])),
                    "views": {observation["view"]},
                    "observations": [observation],
                    "roots": [observation["root"]],
                    "tips": [observation["tip"]],
                    "visibleSets": [observation["visibleIds"]],
                }
            )
        else:
            cluster = best[1]
            cluster["views"].add(observation["view"])
            cluster["observations"].append(observation)
            cluster["roots"].append(observation["root"])
            cluster["tips"].append(observation["tip"])
            cluster["visibleSets"].append(observation["visibleIds"])

    fused: list[dict[str, Any]] = []
    accepted_scores: dict[str, np.ndarray] = {}
    appendage_view_counts: dict[str, int] = {}
    for observation in observations:
        if part_family(str(observation["kind"])) == "appendage":
            view_name = str(observation["view"])
            appendage_view_counts[view_name] = appendage_view_counts.get(view_name, 0) + 1
    appendage_anchor_view = max(appendage_view_counts, key=appendage_view_counts.get) if appendage_view_counts else None
    accepted_clusters = []
    for cluster in clusters:
        observations_in_cluster = cluster["observations"]
        multi_view = len(cluster["views"]) >= MIN_VIEW_HITS
        high_confidence_visible_fallback = (
            cluster["family"] == "appendage"
            and len(cluster["views"]) == 1
            and next(iter(cluster["views"])) == appendage_anchor_view
            and max(float(item["confidence"]) for item in observations_in_cluster) >= 0.95
            and max(int(item["visibleIds"].size) for item in observations_in_cluster) >= MIN_VISIBLE_GAUSSIANS * 3
        )
        if multi_view or high_confidence_visible_fallback:
            cluster["singleViewFallback"] = not multi_view
            accepted_clusters.append(cluster)
    # A single character has one rigid head mass and, for the supported
    # presets, one tail chain. Front/back surface observations can otherwise
    # form duplicate clusters because they share few visible Gaussian IDs.
    for singleton_family in ("head", "tail"):
        matching = [cluster for cluster in accepted_clusters if cluster["family"] == singleton_family]
        if len(matching) <= 1:
            continue
        merged = matching[0]
        for cluster in matching[1:]:
            merged["views"].update(cluster["views"])
            merged["observations"].extend(cluster["observations"])
            merged["roots"].extend(cluster["roots"])
            merged["tips"].extend(cluster["tips"])
            merged["visibleSets"].extend(cluster["visibleSets"])
            merged["singleViewFallback"] = bool(merged.get("singleViewFallback")) and bool(cluster.get("singleViewFallback"))
        accepted_clusters = [
            cluster for cluster in accepted_clusters if cluster["family"] != singleton_family or cluster is merged
        ]
    grouped: dict[str, list[dict[str, Any]]] = {}
    for cluster in accepted_clusters:
        kind_votes: dict[str, float] = {}
        for observation in cluster["observations"]:
            observed_kind = str(observation["kind"])
            kind_votes[observed_kind] = kind_votes.get(observed_kind, 0.0) + max(float(observation["confidence"]), 0.1)
        resolved_kind = max(kind_votes, key=lambda candidate: (kind_votes[candidate], candidate))
        cluster["resolvedKind"] = resolved_kind
        cluster["kindVotes"] = kind_votes
        grouped.setdefault(resolved_kind, []).append(cluster)
    for kind, kind_clusters in grouped.items():
        kind_clusters.sort(key=lambda cluster: tuple(np.median(np.stack(cluster["roots"]), axis=0).tolist()))
        for ordinal, cluster in enumerate(kind_clusters, start=1):
            if len(kind_clusters) == 1:
                side = "center" if kind in {"head", "tail"} else "left"
            else:
                side = "left" if ordinal % 2 else "right"
            region_id = f"{side}-{kind}-{(ordinal + 1) // 2}"
            part_scores = np.zeros(display.shape[0], dtype=np.float32)
            for observation in cluster["observations"]:
                part_scores[observation["visibleIds"]] += max(float(observation["confidence"]), 0.1)
            evidence = part_scores > 0
            if int(evidence.sum()) < MIN_VISIBLE_GAUSSIANS:
                continue
            root = np.median(np.stack(cluster["roots"]), axis=0)
            tip = np.median(np.stack(cluster["tips"]), axis=0)
            if float(np.linalg.norm(tip - root)) < 1e-4:
                continue
            summary = {
                "id": region_id,
                "kind": kind,
                "side": side,
                "viewHits": len(cluster["views"]),
                "singleViewFallback": bool(cluster.get("singleViewFallback")),
                "confidence": round(float(np.mean([item["confidence"] for item in cluster["observations"]])), 5),
                "visibleGaussianCount": int(evidence.sum()),
                "visibleCounts": [int(item["visibleIds"].size) for item in cluster["observations"]],
                "root3d": root.astype(float).tolist(),
                "tip3d": tip.astype(float).tolist(),
                "sourceRegions": [
                    {
                        "view": item["view"],
                        "id": item["sourceId"],
                        "reportedSide": item["reportedSide"],
                        "reportedKind": item["kind"],
                    }
                    for item in cluster["observations"]
                ],
                "kindVotes": {key: round(float(value), 5) for key, value in cluster["kindVotes"].items()},
            }
            fused.append(summary)
            accepted_scores[region_id] = part_scores
    priority = {"head": 0, "arm": 1, "leg": 2, "wing": 3, "fin": 4, "tail": 5, "ear": 6}
    fused.sort(key=lambda item: (priority.get(item["kind"], 99), item["side"], item["id"]))
    return fused, accepted_scores


def _capsule_score(points: np.ndarray, root: np.ndarray, tip: np.ndarray, evidence: np.ndarray) -> np.ndarray:
    axis = tip - root
    length_squared = max(float(np.dot(axis, axis)), 1e-8)
    longitudinal = np.clip(((points - root[None, :]) @ axis) / length_squared, -0.08, 1.12)
    closest = root[None, :] + longitudinal[:, None] * axis[None, :]
    radial = np.linalg.norm(points - closest, axis=1)
    evidence_radial = radial[evidence > 0]
    radius = float(np.percentile(evidence_radial, 92.0)) if evidence_radial.size else math.sqrt(length_squared) * 0.16
    radius = max(radius * 1.18, math.sqrt(length_squared) * 0.075, 1e-5)
    radial_score = np.clip(1.0 - radial / radius, 0.0, 1.0)
    axial_gate = (longitudinal >= -0.035) & (longitudinal <= 1.06)
    score = radial_score * axial_gate.astype(np.float32)
    score = np.maximum(score * 0.72, np.clip(evidence, 0.0, 1.0))
    return score.astype(np.float32)


def _save_proxy_obj(path: Path, centers: np.ndarray, keys: np.ndarray, owners: np.ndarray, bones: list[dict[str, Any]], voxel_size: float) -> None:
    key_to_index = {tuple(int(value) for value in key): index for index, key in enumerate(keys)}
    directions = (
        ((1, 0, 0), (1, 2, 6, 5)),
        ((-1, 0, 0), (0, 4, 7, 3)),
        ((0, 1, 0), (3, 7, 6, 2)),
        ((0, -1, 0), (0, 1, 5, 4)),
        ((0, 0, 1), (4, 5, 6, 7)),
        ((0, 0, -1), (0, 3, 2, 1)),
    )
    corners = np.asarray(
        [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]],
        dtype=np.float32,
    ) * (voxel_size * 0.5)
    vertices: list[np.ndarray] = []
    faces_by_owner: dict[int, list[tuple[int, int, int, int]]] = {}
    for voxel_index, (center, key) in enumerate(zip(centers, keys, strict=True)):
        owner = int(owners[voxel_index])
        base = len(vertices) + 1
        vertices.extend(center[None, :] + corners)
        key_tuple = tuple(int(value) for value in key)
        for direction, face in directions:
            neighbor = tuple(key_tuple[axis] + direction[axis] for axis in range(3))
            if neighbor not in key_to_index:
                faces_by_owner.setdefault(owner, []).append(tuple(base + corner for corner in face))
    with path.open("w", encoding="utf-8", newline="\n") as output:
        output.write("# Multi-view semantic proxy mesh\n")
        for vertex in vertices:
            output.write(f"v {vertex[0]:.7f} {vertex[1]:.7f} {vertex[2]:.7f}\n")
        for owner, faces in sorted(faces_by_owner.items()):
            name = str(bones[owner]["id"]) if 0 <= owner < len(bones) else "body"
            output.write(f"g {name}\n")
            for face in faces:
                output.write(f"f {face[0]} {face[1]} {face[2]} {face[3]}\n")


def build_multiview_splat_rig(
    *,
    splat_path: Path,
    artwork_dir: Path,
    artwork_id: str,
) -> dict[str, Any]:
    arrays, display, views = render_multiview_splats(splat_path, artwork_dir)
    analyses = analyse_multiview_regions(views, artwork_dir)
    fused_regions, source_evidence = _fuse_regions(analyses, display)
    if not fused_regions:
        raise RuntimeError("Multi-view analysis found no part in at least two generated views.")

    proxy = _build_voxel_proxy(display, np.zeros((display.shape[0], 2), dtype=np.float32), arrays["rgba"][:, 3])
    proxy_display = np.asarray(proxy["display"], dtype=np.float32)
    inverse = np.asarray(proxy["inverse"], dtype=np.int32)
    proxy_keys = np.asarray(proxy["keys"], dtype=np.int32)
    proxy_count = proxy_display.shape[0]
    display_to_model = np.asarray([1.0, -1.0, -1.0], dtype=np.float32)
    bones: list[dict[str, Any]] = [
        {
            "index": 0,
            "id": "body",
            "parentIndex": -1,
            "kind": "body",
            "side": "center",
            "pivot": [0.0, 0.0, 0.0],
            "animation": {"axis": [0.0, 1.0, 0.0], "amplitude": 0.0, "frequency": 1.0, "phase": 0.0},
        }
    ]
    score_columns: list[np.ndarray] = [np.zeros(proxy_count, dtype=np.float32)]
    accepted: list[dict[str, Any]] = []

    for region in fused_regions:
        root_display = np.asarray(region["root3d"], dtype=np.float32)
        tip_display = np.asarray(region["tip3d"], dtype=np.float32)
        source_score = source_evidence[region["id"]]
        proxy_evidence = np.zeros(proxy_count, dtype=np.float32)
        np.maximum.at(proxy_evidence, inverse, np.clip(source_score, 0.0, 1.0))
        capsule = _capsule_score(proxy_display, root_display, tip_display, proxy_evidence)
        if int((capsule >= 0.24).sum()) < 36:
            continue
        bone_index = len(bones)
        kind = str(region["kind"])
        side = str(region["side"])
        direction_display = _safe_axis(tip_display - root_display, np.asarray([0.0, 1.0, 0.0], dtype=np.float32))
        bones.append(
            {
                "index": bone_index,
                "id": region["id"],
                "parentIndex": 0,
                "kind": kind,
                "side": side,
                "pivot": (root_display * display_to_model).astype(float).tolist(),
                "animation": _animation(kind, side, 0, 1, direction_display),
            }
        )
        score_columns.append(capsule)
        accepted.append({**region, "boneIndices": [bone_index], "proxyVoxelCount": int((capsule >= 0.24).sum())})

    if len(bones) <= 1:
        raise RuntimeError("Multi-view regions did not produce a valid 3D proxy bone.")
    proxy_scores = np.stack(score_columns, axis=1)
    proxy_owner, connectivity = _build_connected_part_ownership(proxy_keys, proxy_scores, bones)

    weight_scores = np.zeros_like(proxy_scores)
    joint_ratios: list[float] = []
    for bone in bones[1:]:
        if bone["kind"] not in MOVING_KINDS:
            continue
        bone_index = int(bone["index"])
        owned = proxy_owner == bone_index
        if not np.any(owned):
            continue
        pivot_display = np.asarray(bone["pivot"], dtype=np.float32) * display_to_model
        distances = np.linalg.norm(proxy_display - pivot_display[None, :], axis=1)
        # A broad collar plus quaternion interpolation keeps the joint volume
        # closed under the requested large motion amplitudes.
        joint_band = max(float(np.quantile(distances[owned], 0.28)), float(proxy["voxelSize"]) * 3.0)
        progress = np.clip(distances[owned] / max(joint_band, 1e-6), 0.0, 1.0)
        weights = progress * progress * (3.0 - 2.0 * progress)
        weight_scores[owned, bone_index] = weights.astype(np.float32)
        joint_ratios.append(float((distances[owned] < joint_band).mean()))

    source_weights = weight_scores[inverse]
    packed_weights, weight_metrics = _quantize_weights(source_weights)
    weights_path = artwork_dir / WEIGHTS_FILENAME
    weights_path.write_bytes(packed_weights.astype("<u2", copy=False).tobytes(order="C"))
    _save_proxy_obj(
        artwork_dir / PROXY_MESH_FILENAME,
        proxy_display,
        proxy_keys,
        proxy_owner,
        bones,
        float(proxy["voxelSize"]),
    )

    view_summaries = []
    for entry in analyses:
        view = entry["view"]
        view_summaries.append(
            {
                "name": view["name"],
                "azimuth": view["azimuth"],
                "elevation": view["elevation"],
                "renderUrl": f"/assets/{artwork_id}/{VIEW_ROOT_NAME}/{view['name']}/render.png",
                "previewUrl": f"/assets/{artwork_id}/{VIEW_ROOT_NAME}/{view['name']}/rig-segmentation-preview.webp",
                "regions": len(entry["articulation"].get("regions") or []),
            }
        )
    multiview_summary = {
        "version": 1,
        "method": "adaptive-splat-multiview-semantic-fusion-v2",
        "views": view_summaries,
        "acceptedRegions": accepted,
        "rejectedRegions": [region for region in fused_regions if region["id"] not in {entry["id"] for entry in accepted}],
    }
    write_json_atomic(artwork_dir / MULTIVIEW_FILENAME, multiview_summary)
    revision = time.time_ns()
    moving_indices = np.asarray(
        [int(bone["index"]) for bone in bones if bone["kind"] in MOVING_KINDS],
        dtype=np.uint16,
    )
    source_owner = proxy_owner[inverse]
    animated = np.isin(source_owner, moving_indices) if moving_indices.size else np.zeros(display.shape[0], dtype=bool)
    rig = {
        "version": 14,
        "revision": revision,
        "enabled": bool(np.any(animated)),
        "status": "ready" if np.any(animated) else "failed",
        "strategy": "cpu-splat-bone-mapping",
        "motionMethod": "cpu-rest-pose-bone-remapping",
        "skinningMethod": "cpu-linear-blend",
        "segmentationMethod": "generated-splat-multiview-fusion-v1",
        "sourceGaussianCount": int(display.shape[0]),
        "weightsUrl": f"/assets/{artwork_id}/{WEIGHTS_FILENAME}?v={revision}",
        "weightsFormat": "spark-rgba16ui-little-endian",
        "weightsByteLength": int(packed_weights.nbytes),
        "maxInfluences": WEIGHT_SLOTS,
        "bones": bones,
        "proxyMeshUrl": f"/assets/{artwork_id}/{PROXY_MESH_FILENAME}?v={revision}",
        "multiviewUrl": f"/assets/{artwork_id}/{MULTIVIEW_FILENAME}?v={revision}",
        "quality": {
            "boneCount": len(bones),
            "viewCount": len(analyses),
            "acceptedRegionCount": len(accepted),
            "animatedCoverageRatio": round(float(animated.mean()), 5),
            "bodyGaussianCount": int((source_owner == 0).sum()),
            "mappedGaussianCount": int((source_owner > 0).sum()),
            "usesGeneratedModelViews": True,
            "usesVisibilityIdBuffer": True,
            "uses3dCapsuleCompletion": True,
            "usesProxyVoxelMesh": True,
            "usesOriginalImageExtrusion": False,
            "locksHeadOwnership": True,
            "stationaryKinds": sorted(STATIC_KINDS),
            "averageJointBandRatio": round(float(np.mean(joint_ratios)), 5) if joint_ratios else 0.0,
            **weight_metrics,
            **connectivity,
        },
        "multiview": multiview_summary,
    }
    if not rig["enabled"]:
        rig["reason"] = "no-moving-multiview-regions"
    write_json_atomic(artwork_dir / "rig.json", rig)
    return rig
