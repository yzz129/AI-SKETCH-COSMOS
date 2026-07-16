from __future__ import annotations

import math
import time
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageOps

from .storage import write_json_atomic


MIN_REGION_GAUSSIANS = 180
MIN_PROXY_REGION_VOXELS = 36
MAX_BONES = 64
WEIGHT_SLOTS = 4
WEIGHTS_FILENAME = "rig-weights.bin"
PART_MAP_FILENAME = "part-map.bin"
PROXY_PREVIEW_FILENAME = "rig-proxy-preview.webp"
PROXY_RESOLUTION = 52
DEPTH_TRACK_BINS = 12
MIN_DISTAL_RECALL = 0.82
MIN_TRACK_COVERAGE = 0.28
MAX_CAPSULE_LEAK_RATIO = 0.1
MIN_RIGID_CORE_RATIO = 0.9


def _smoothstep(edge0: float, edge1: float, value: np.ndarray) -> np.ndarray:
    progress = np.clip((value - edge0) / max(edge1 - edge0, 1e-6), 0.0, 1.0)
    return progress * progress * (3.0 - 2.0 * progress)


def _decode_splat(path: Path) -> dict[str, np.ndarray]:
    raw = np.frombuffer(path.read_bytes(), dtype=np.uint8)
    if raw.size == 0 or raw.size % 32:
        raise ValueError("invalid .splat record buffer")
    records = raw.reshape(-1, 32)
    return {
        "xyz": records[:, :12].copy().view(np.float32).reshape(-1, 3),
        "scale": records[:, 12:24].copy().view(np.float32).reshape(-1, 3),
        "rgba": records[:, 24:28].copy(),
    }


def _points_in_polygon(u: np.ndarray, v: np.ndarray, polygon: np.ndarray) -> np.ndarray:
    inside = np.zeros(u.shape[0], dtype=bool)
    previous = polygon[-1]
    for current in polygon:
        x1, y1 = previous
        x2, y2 = current
        crosses = ((y1 > v) != (y2 > v)) & (
            u < (x2 - x1) * (v - y1) / ((y2 - y1) + 1e-12) + x1
        )
        inside ^= crosses
        previous = current
    return inside


def _distance_to_polygon(u: np.ndarray, v: np.ndarray, polygon: np.ndarray) -> np.ndarray:
    points = np.stack([u, v], axis=1)
    distance = np.full(u.shape[0], np.inf, dtype=np.float32)
    previous = polygon[-1]
    for current in polygon:
        edge = current - previous
        length_squared = max(float(np.dot(edge, edge)), 1e-8)
        progress = np.clip(
            np.sum((points - previous[None, :]) * edge[None, :], axis=1) / length_squared,
            0.0,
            1.0,
        )
        closest = previous[None, :] + progress[:, None] * edge[None, :]
        distance = np.minimum(distance, np.linalg.norm(points - closest, axis=1))
        previous = current
    return distance


def _closest_polygon_point(target: np.ndarray, polygon: np.ndarray) -> np.ndarray:
    """Return the nearest point on the polygon boundary, not its interior."""
    closest = polygon[0].astype(np.float32, copy=True)
    best_distance = float("inf")
    previous = polygon[-1]
    for current in polygon:
        edge = current - previous
        length_squared = max(float(np.dot(edge, edge)), 1e-8)
        progress = float(np.clip(np.dot(target - previous, edge) / length_squared, 0.0, 1.0))
        candidate = previous + edge * progress
        distance = float(np.dot(candidate - target, candidate - target))
        if distance < best_distance:
            best_distance = distance
            closest = candidate.astype(np.float32)
        previous = current
    return closest


def _parent_facing_boundary_center(target: np.ndarray, polygon: np.ndarray) -> np.ndarray:
    """Average the parent-facing contact patch instead of choosing a corner."""
    samples: list[np.ndarray] = []
    previous = polygon[-1]
    for current in polygon:
        for progress in np.linspace(0.0, 1.0, 9, endpoint=False, dtype=np.float32):
            samples.append(previous + (current - previous) * progress)
        previous = current
    boundary = np.stack(samples, axis=0).astype(np.float32)
    distances = np.linalg.norm(boundary - target[None, :], axis=1)
    diagonal = float(np.linalg.norm(np.ptp(polygon, axis=0)))
    band = max(0.022, diagonal * 0.14)
    minimum = float(distances.min())
    contact = distances <= minimum + band
    selected = boundary[contact]
    selected_distances = distances[contact]
    weights = np.exp(-2.0 * (selected_distances - minimum) / max(band, 1e-6))
    weights /= max(float(weights.sum()), 1e-6)
    return np.sum(selected * weights[:, None], axis=0).astype(np.float32)


def _polygon_centroid(polygon: np.ndarray) -> np.ndarray:
    return np.mean(polygon, axis=0).astype(np.float32)


def _parent_anchor(kind: str, head_center: np.ndarray | None) -> np.ndarray:
    # Coordinates are normalized inside subjectBounds. These are only targets
    # for finding the innermost polygon boundary; the actual 3D joint is fitted
    # from the Gaussian density afterwards.
    if kind == "head":
        return np.asarray([0.5, 0.72], dtype=np.float32)
    if kind == "ear" and head_center is not None:
        return head_center
    if kind == "leg":
        return np.asarray([0.5, 0.62], dtype=np.float32)
    return np.asarray([0.5, 0.54], dtype=np.float32)


def _correct_region_axis(
    region: dict[str, Any],
    polygon: np.ndarray,
    bounds: np.ndarray,
    head_center: np.ndarray | None,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Fit an attachment root on the inner boundary and a distal tip.

    Vision roots are useful hints but often land in the middle of a hand, foot
    or ear. A skeletal joint must sit on the parent-facing boundary, otherwise
    a perfectly valid rigid transform still looks like rubber deformation.
    """
    kind = str(region.get("kind") or "")
    try:
        ai_root = _subject_point(region.get("root"), bounds)
    except (TypeError, ValueError):
        ai_root = _polygon_centroid(polygon)
    root = _parent_facing_boundary_center(_parent_anchor(kind, head_center), polygon)

    farthest = polygon[int(np.argmax(np.linalg.norm(polygon - root[None, :], axis=1)))]
    try:
        ai_tip = _subject_point(region.get("tip"), bounds)
    except (TypeError, ValueError):
        ai_tip = farthest
    maximum_length = max(float(np.linalg.norm(farthest - root)), 1e-6)
    if float(np.linalg.norm(ai_tip - root)) < maximum_length * 0.68:
        tip = farthest
    else:
        # Keep the semantic endpoint direction, but clamp it to the part's
        # boundary so a floating prompt point cannot lengthen the skeleton.
        tip = _closest_polygon_point(ai_tip, polygon)
    return root.astype(np.float32), tip.astype(np.float32), ai_root.astype(np.float32)


def _build_voxel_proxy(
    display: np.ndarray,
    uv: np.ndarray,
    alpha: np.ndarray,
    resolution: int = PROXY_RESOLUTION,
) -> dict[str, np.ndarray | float | int]:
    """Build an invisible density proxy and a lossless point-to-voxel map."""
    low = np.percentile(display, 0.5, axis=0).astype(np.float32)
    high = np.percentile(display, 99.5, axis=0).astype(np.float32)
    extent = np.maximum(high - low, 1e-5)
    voxel_size = float(np.max(extent) / max(resolution, 8))
    clipped = np.clip(display, low[None, :], high[None, :])
    keys = np.floor((clipped - low[None, :]) / max(voxel_size, 1e-6)).astype(np.int32)
    voxel_keys, inverse = np.unique(keys, axis=0, return_inverse=True)
    voxel_count = int(inverse.max()) + 1
    counts = np.bincount(inverse, minlength=voxel_count).astype(np.float32)

    proxy_display = np.stack(
        [np.bincount(inverse, weights=display[:, axis], minlength=voxel_count) for axis in range(3)],
        axis=1,
    ).astype(np.float32)
    proxy_uv = np.stack(
        [np.bincount(inverse, weights=uv[:, axis], minlength=voxel_count) for axis in range(2)],
        axis=1,
    ).astype(np.float32)
    proxy_display /= counts[:, None]
    proxy_uv /= counts[:, None]
    proxy_alpha = np.zeros(voxel_count, dtype=np.float32)
    np.maximum.at(proxy_alpha, inverse, alpha)
    return {
        "display": proxy_display,
        "uv": proxy_uv,
        "alpha": proxy_alpha,
        "counts": counts,
        "keys": voxel_keys.astype(np.int32),
        "inverse": inverse.astype(np.int32),
        "voxelSize": voxel_size,
        "resolution": int(resolution),
    }


def _subject_point(value: Any, bounds: np.ndarray) -> np.ndarray:
    if not isinstance(value, list) or len(value) != 2:
        raise ValueError("invalid image point")
    width = max(float(bounds[2] - bounds[0]), 1e-5)
    height = max(float(bounds[3] - bounds[1]), 1e-5)
    return np.asarray(
        [(float(value[0]) - bounds[0]) / width, (float(value[1]) - bounds[1]) / height],
        dtype=np.float32,
    )


def _normalized_display_coordinates(xyz: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict[str, list[float]]]:
    # The frontend displays generated splats with Euler(0, PI, PI).
    display = xyz * np.asarray([1.0, -1.0, -1.0], dtype=np.float32)
    low = np.percentile(display, 1.0, axis=0).astype(np.float32)
    high = np.percentile(display, 99.0, axis=0).astype(np.float32)
    center = (low + high) * 0.5
    half = np.maximum((high - low) * 0.5, 1e-5)
    normalized = np.clip((display - center) / half, -1.4, 1.4)
    raw_low = xyz.min(axis=0)
    raw_high = xyz.max(axis=0)
    return display, normalized, {
        "min": raw_low.astype(float).tolist(),
        "max": raw_high.astype(float).tolist(),
        "center": ((raw_low + raw_high) * 0.5).astype(float).tolist(),
    }


def _tip_from_region(region: dict[str, Any], root: np.ndarray, polygon: np.ndarray, bounds: np.ndarray) -> np.ndarray:
    try:
        tip = _subject_point(region.get("tip"), bounds)
        if float(np.linalg.norm(tip - root)) >= 0.045:
            return tip
    except (TypeError, ValueError):
        pass
    distances = np.linalg.norm(polygon - root[None, :], axis=1)
    return polygon[int(np.argmax(distances))]


def _robust_display_point(
    display: np.ndarray,
    uv: np.ndarray,
    target: np.ndarray,
    alpha: np.ndarray,
    preferred: np.ndarray,
) -> np.ndarray:
    metric = np.linalg.norm(uv - target[None, :], axis=1)
    metric = metric + np.where(preferred, 0.0, 0.045)
    usable = alpha >= max(8.0, float(np.percentile(alpha, 12.0)))
    candidates = np.flatnonzero(usable)
    if candidates.size < 32:
        candidates = np.arange(display.shape[0])
    sample_count = min(max(72, display.shape[0] // 700), 220, candidates.size)
    local_metric = metric[candidates]
    selected = candidates[np.argpartition(local_metric, sample_count - 1)[:sample_count]]
    selected_metric = metric[selected]
    spatial = display[selected]
    median = np.median(spatial, axis=0)
    deviation = np.linalg.norm(spatial - median[None, :], axis=1)
    keep = deviation <= np.percentile(deviation, 78.0)
    if int(keep.sum()) >= 16:
        selected = selected[keep]
        selected_metric = selected_metric[keep]
    weights = (alpha[selected] / 255.0 + 0.08) / np.maximum(selected_metric, 0.008)
    weights /= max(float(weights.sum()), 1e-6)
    return np.sum(display[selected] * weights[:, None], axis=0).astype(np.float32)


def _safe_axis(value: np.ndarray, fallback: np.ndarray) -> np.ndarray:
    length = float(np.linalg.norm(value))
    if length < 1e-6:
        return fallback.astype(np.float32, copy=True)
    return (value / length).astype(np.float32)


def _animation(
    kind: str,
    side: str,
    segment: int,
    segments: int,
    direction_display: np.ndarray,
) -> dict[str, Any]:
    # Opposite limbs alternate for a readable gait. Paired wings flap
    # together; their mirrored rest axes already produce mirrored motion.
    phase = 0.0 if kind == "wing" else (math.pi if side == "left" else 0.0)
    presets: dict[str, tuple[float, float]] = {
        "arm": (0.46, 1.45),
        "leg": (0.36, 1.9),
        "wing": (0.55, 2.35),
        "fin": (0.4, 1.9),
        "tail": (0.48, 1.65),
        "ear": (0.2, 1.7),
        "head": (0.2, 1.15),
    }
    amplitude, frequency = presets[kind]
    direction = _safe_axis(direction_display, np.asarray([0.0, 1.0, 0.0], dtype=np.float32))
    if kind == "head":
        axis_display = np.asarray([0.0, 1.0, 0.0], dtype=np.float32)
    elif kind in {"arm", "ear"}:
        # Make raised hands and ears wave laterally in the image plane.
        axis_display = np.cross(direction, np.asarray([1.0, 0.0, 0.0], dtype=np.float32))
    else:
        # Legs swing and wings/fins/tails flap through depth around an axis
        # derived from their rest direction, rather than a global canned axis.
        axis_display = np.cross(direction, np.asarray([0.0, 0.0, 1.0], dtype=np.float32))
    axis_display = _safe_axis(axis_display, np.asarray([0.0, 1.0, 0.0], dtype=np.float32))
    axis_model = axis_display * np.asarray([1.0, -1.0, -1.0], dtype=np.float32)
    if segments > 1:
        progress = segment / max(segments - 1, 1)
        amplitude *= 0.8 + progress * 0.48
        phase -= segment * (0.42 if kind in {"tail", "wing", "fin"} else 0.22)
    return {
        "axis": [round(float(value), 6) for value in axis_model],
        "amplitude": round(amplitude, 5),
        "frequency": round(frequency, 5),
        "phase": round(phase, 5),
    }


def _bone_segments(kind: str) -> int:
    # One semantic region is one rigid anatomical part. Splitting a detected
    # arm, leg, tail or wing into procedural sub-bones makes nearby Gaussians
    # follow different transforms and produces a scattered/frayed silhouette.
    # More articulation requires genuinely separate vision regions.
    return 1


def _rigid_segment_assignments(longitudinal: np.ndarray, segments: int) -> np.ndarray:
    """Rigid per-segment ownership with narrow blends around real joints."""
    assignments = np.zeros((longitudinal.shape[0], segments), dtype=np.float32)
    if segments == 1:
        assignments[:, 0] = 1.0
        return assignments
    coordinate = np.clip(longitudinal, 0.0, 0.999999) * segments
    owner = np.minimum(np.floor(coordinate).astype(np.int32), segments - 1)
    assignments[np.arange(longitudinal.shape[0]), owner] = 1.0
    # With four tail bones, the previous 0.055 half-band made roughly one
    # quarter of the appendage soft.  A one-percent band leaves only the joint
    # cross-section blended; the rest of each anatomical segment stays rigid.
    half_band = 0.01
    for joint in range(1, segments):
        position = joint / segments
        delta = longitudinal - position
        blend = np.abs(delta) < half_band
        if not np.any(blend):
            continue
        child_share = _smoothstep(-half_band, half_band, delta[blend])
        assignments[blend, joint - 1] = 1.0 - child_share
        assignments[blend, joint] = child_share
    return assignments


def _interval_support(
    values: np.ndarray,
    low: np.ndarray,
    high: np.ndarray,
    feather: float,
) -> np.ndarray:
    lower = _smoothstep(0.0, feather, values - (low - feather))
    upper = 1.0 - _smoothstep(0.0, feather, values - high)
    return np.clip(lower * upper, 0.0, 1.0).astype(np.float32)


def _fit_distal_depth_track(
    *,
    proxy_display: np.ndarray,
    inside: np.ndarray,
    longitudinal: np.ndarray,
    voxel_size: float,
    kind: str,
) -> dict[str, Any] | None:
    """Track the appendage's front/back depth envelope from its clean tip.

    A source-view polygon cannot distinguish an appendage from torso surfaces
    hidden behind it.  The distal part of an arm, leg, tail, wing or fin is much
    less likely to overlap the torso, so its complete front/back depth envelope
    is used as a seed and propagated towards the joint with bounded growth.
    """
    valid = inside & (longitudinal >= -0.02) & (longitudinal <= 1.08)
    valid_count = int(valid.sum())
    if valid_count < MIN_PROXY_REGION_VOXELS:
        return None

    if kind == "head":
        seed_low, seed_high = 0.45, 0.9
        fallback_low, fallback_high = 0.32, 0.96
        growth_per_bin = voxel_size * 2.0
        maximum_span_ratio = 2.4
    else:
        seed_low, seed_high = 0.65, 0.96
        fallback_low, fallback_high = 0.5, 0.98
        growth_per_bin = voxel_size * (1.75 if kind in {"tail", "wing"} else 1.25)
        maximum_span_ratio = 2.2 if kind in {"tail", "wing"} else 1.8

    minimum_seed_count = max(24, int(math.ceil(valid_count * 0.08)))
    seed = valid & (longitudinal >= seed_low) & (longitudinal <= seed_high)
    if int(seed.sum()) < minimum_seed_count:
        seed_low, seed_high = fallback_low, fallback_high
        seed = valid & (longitudinal >= seed_low) & (longitudinal <= seed_high)
    if int(seed.sum()) < minimum_seed_count:
        return None

    depth = proxy_display[:, 2]
    seed_depth = depth[seed]
    seed_bounds = np.percentile(seed_depth, [3.0, 97.0]).astype(np.float32)
    margin = voxel_size * 1.5
    seed_bounds[0] -= margin
    seed_bounds[1] += margin
    seed_span = max(float(seed_bounds[1] - seed_bounds[0]), voxel_size * 4.0)
    maximum_span = seed_span * maximum_span_ratio
    minimum_span = max(seed_span * 0.35, voxel_size * 3.0)

    edges = np.linspace(-0.02, 1.1, DEPTH_TRACK_BINS + 1, dtype=np.float32)
    centers = (edges[:-1] + edges[1:]) * 0.5
    low_bounds = np.full(DEPTH_TRACK_BINS, np.nan, dtype=np.float32)
    high_bounds = np.full(DEPTH_TRACK_BINS, np.nan, dtype=np.float32)
    seed_bins = np.flatnonzero((centers >= seed_low) & (centers <= seed_high))
    if seed_bins.size == 0:
        return None
    low_bounds[seed_bins] = seed_bounds[0]
    high_bounds[seed_bins] = seed_bounds[1]

    def propagate(indices: range, previous_index: int) -> None:
        previous_low = float(low_bounds[previous_index])
        previous_high = float(high_bounds[previous_index])
        for index in indices:
            in_bin = valid & (longitudinal >= edges[index]) & (longitudinal < edges[index + 1])
            reachable = in_bin & (depth >= previous_low - growth_per_bin) & (
                depth <= previous_high + growth_per_bin
            )
            if int(reachable.sum()) >= 6:
                observed_low, observed_high = np.percentile(depth[reachable], [3.0, 97.0])
                target_low = float(observed_low) - margin
                target_high = float(observed_high) + margin
                current_low = float(np.clip(target_low, previous_low - growth_per_bin, previous_low + growth_per_bin))
                current_high = float(
                    np.clip(target_high, previous_high - growth_per_bin, previous_high + growth_per_bin)
                )
            else:
                current_low = previous_low
                current_high = previous_high

            span = current_high - current_low
            midpoint = (current_low + current_high) * 0.5
            if span > maximum_span:
                current_low = midpoint - maximum_span * 0.5
                current_high = midpoint + maximum_span * 0.5
            elif span < minimum_span:
                current_low = midpoint - minimum_span * 0.5
                current_high = midpoint + minimum_span * 0.5
            low_bounds[index] = current_low
            high_bounds[index] = current_high
            previous_low = current_low
            previous_high = current_high

    first_seed_bin = int(seed_bins[0])
    last_seed_bin = int(seed_bins[-1])
    propagate(range(first_seed_bin - 1, -1, -1), first_seed_bin)
    propagate(range(last_seed_bin + 1, DEPTH_TRACK_BINS), last_seed_bin)

    # Seed bins share the same complete p03/p97 envelope.  This intentionally
    # keeps both front and back surfaces instead of selecting one median sheet.
    bin_index = np.clip(np.searchsorted(edges, longitudinal, side="right") - 1, 0, DEPTH_TRACK_BINS - 1)
    point_low = low_bounds[bin_index]
    point_high = high_bounds[bin_index]
    support = _interval_support(depth, point_low, point_high, voxel_size)
    distal_recall = float((support[seed] >= 0.5).mean())
    track_coverage = float((support[valid] >= 0.5).mean())

    root_bins = np.flatnonzero((centers >= 0.02) & (centers <= 0.24))
    root_span = float(np.median(high_bounds[root_bins] - low_bounds[root_bins])) if root_bins.size else seed_span
    root_span_ratio = root_span / max(seed_span, voxel_size * 4.0)
    return {
        "support": support,
        "seedMask": seed,
        "distalRecall": distal_recall,
        "trackCoverage": track_coverage,
        "rootDepthSpanRatio": root_span_ratio,
        "seedDepthSpan": seed_span,
    }


def _region_influence(
    *,
    display: np.ndarray,
    uv: np.ndarray,
    alpha: np.ndarray,
    proxy_display: np.ndarray,
    proxy_uv: np.ndarray,
    proxy_alpha: np.ndarray,
    proxy_voxel_size: float | None,
    region: dict[str, Any],
    bounds: np.ndarray,
    head_center: np.ndarray | None,
) -> dict[str, Any] | None:
    polygon_values = region.get("polygon")
    if not isinstance(polygon_values, list) or len(polygon_values) < 6:
        return None
    try:
        polygon = np.stack([_subject_point(point, bounds) for point in polygon_values], axis=0)
    except (TypeError, ValueError):
        return None
    root_2d, tip_2d, ai_root_2d = _correct_region_axis(region, polygon, bounds, head_center)
    image_axis = tip_2d - root_2d
    image_length = float(np.linalg.norm(image_axis))
    if image_length < 0.055:
        return None

    gaussian_inside = _points_in_polygon(uv[:, 0], uv[:, 1], polygon)
    if int(gaussian_inside.sum()) < MIN_REGION_GAUSSIANS:
        return None
    inside = _points_in_polygon(proxy_uv[:, 0], proxy_uv[:, 1], polygon)
    if int(inside.sum()) < MIN_PROXY_REGION_VOXELS:
        return None
    edge_distance = _distance_to_polygon(proxy_uv[:, 0], proxy_uv[:, 1], polygon)
    support = np.where(inside, 1.0, np.exp(-0.5 * (edge_distance / 0.014) ** 2)).astype(np.float32)

    kind = str(region.get("kind") or "")
    model_extent = float(np.max(np.ptp(display, axis=0)))
    voxel_size = float(proxy_voxel_size or (model_extent / max(PROXY_RESOLUTION, 8)))
    depth_track = _fit_distal_depth_track(
        proxy_display=proxy_display,
        inside=inside,
        longitudinal=np.sum(
            (proxy_uv - root_2d[None, :]) * ((image_axis / image_length)[None, :]),
            axis=1,
        )
        / image_length,
        voxel_size=voxel_size,
        kind=kind,
    )
    if depth_track is None:
        return None
    depth_support = depth_track["support"]
    seed_mask = depth_track["seedMask"]
    assert isinstance(depth_support, np.ndarray)
    assert isinstance(seed_mask, np.ndarray)

    root_display = _robust_display_point(display, uv, root_2d, alpha, gaussian_inside)
    tip_display = _robust_display_point(display, uv, tip_2d, alpha, gaussian_inside)
    image_axis_unit = image_axis / image_length
    longitudinal = np.sum((proxy_uv - root_2d[None, :]) * image_axis_unit[None, :], axis=1) / image_length
    root_depth_points = inside & (longitudinal >= 0.03) & (longitudinal <= 0.2) & (depth_support >= 0.5)
    if int(root_depth_points.sum()) < 8:
        root_depth_points = (
            inside
            & (longitudinal >= -0.05)
            & (longitudinal <= 0.5)
            & (depth_support >= 0.5)
        )
    tip_depth_points = seed_mask & (depth_support >= 0.5)
    if int(root_depth_points.sum()) < 8 or int(tip_depth_points.sum()) < 8:
        return None
    root_display[2] = float(np.median(proxy_display[root_depth_points, 2]))
    tip_display[2] = float(np.median(proxy_display[tip_depth_points, 2]))
    axis = tip_display - root_display
    length = float(np.linalg.norm(axis))
    if length < max(model_extent * 0.045, 1e-5) or length > model_extent * 1.1:
        return None

    root_blend = _smoothstep(0.01, 0.05, longitudinal)
    tip_falloff = 1.0 - _smoothstep(1.01, 1.14, longitudinal)
    confidence = float(np.clip(float(region.get("confidence") or 0.0), 0.0, 1.0))
    confidence_scale = 0.86 + confidence * 0.14
    interior_depth_support = depth_support
    if kind == "head":
        # Preserve the head's multiple front/back shells and small facial
        # components away from the neck.  The root band still uses the tracked
        # envelope so the torso behind the chin is not captured.
        interior_depth_support = np.maximum(
            interior_depth_support,
            _smoothstep(0.14, 0.22, longitudinal),
        )
    # Never invent ownership outside the recognized anatomical silhouette.
    # The former capsule continuation was responsible for detached fragments:
    # small nearby torso/tail clusters inherited a limb bone despite not being
    # part of its semantic mask. Front and back shells are already retained by
    # the depth track for every projected point inside the polygon.
    volume_support = np.where(inside, interior_depth_support, 0.0).astype(np.float32)
    raw_membership = support * volume_support * tip_falloff * confidence_scale
    raw_membership *= np.clip(proxy_alpha / 80.0, 0.55, 1.0)
    # Classify the tracked volume instead of fading it into the body.  A point
    # is either owned by the anatomical part or remains body-owned; fractional
    # weights are reserved for the root joint and explicit inter-bone bands.
    membership = (raw_membership >= 0.24).astype(np.float32)
    influence = membership * root_blend
    influence = np.clip(influence, 0.0, 1.0).astype(np.float32)

    confident = influence >= 0.24
    confident_count = int(confident.sum())
    hard_maximum_ratios = {
        "head": 0.5,
        "arm": 0.4,
        "leg": 0.4,
        "wing": 0.4,
        "tail": 0.4,
        "ear": 0.2,
        "fin": 0.2,
    }
    # Scale the cap from the region's actual projected occupancy.  A fixed 18%
    # cap rejects legitimate close-ups, while the former 40% blanket cap lets a
    # tiny hand polygon flood the torso.  This permits a small hidden-surface
    # margin without allowing the active 3D volume to dwarf its 2D evidence.
    projected_ratio = float(inside.mean())
    max_ratio = min(
        hard_maximum_ratios.get(kind, 0.4),
        max(0.08, projected_ratio * 1.65 + 0.025),
    )
    if confident_count < MIN_PROXY_REGION_VOXELS or confident_count / proxy_display.shape[0] > max_ratio:
        return None
    capsule_leak_ratio = float(influence[~inside].sum()) / max(float(influence.sum()), 1e-6)
    if capsule_leak_ratio > MAX_CAPSULE_LEAK_RATIO:
        return None

    return {
        "influence": influence,
        "membership": np.clip(membership, 0.0, 1.0).astype(np.float32),
        "rootBlend": root_blend.astype(np.float32),
        "longitudinal": longitudinal.astype(np.float32),
        "rootDisplay": root_display,
        "tipDisplay": tip_display,
        "root2d": root_2d,
        "tip2d": tip_2d,
        "aiRoot2d": ai_root_2d,
        "polygon": polygon,
        "gaussianInside": gaussian_inside,
        "gaussianInsideCount": int(gaussian_inside.sum()),
        "distalRecall": float(depth_track["distalRecall"]),
        "trackCoverage": float(depth_track["trackCoverage"]),
        "rootDepthSpanRatio": float(depth_track["rootDepthSpanRatio"]),
        "capsuleLeakRatio": capsule_leak_ratio,
    }


def _quantize_weights(scores: np.ndarray) -> tuple[np.ndarray, dict[str, float]]:
    count, bone_count = scores.shape
    non_root = scores[:, 1:]
    take = min(WEIGHT_SLOTS - 1, non_root.shape[1])
    selected = np.zeros((count, WEIGHT_SLOTS - 1), dtype=np.int32)
    selected_scores = np.zeros((count, WEIGHT_SLOTS - 1), dtype=np.float32)
    if take:
        chosen = np.argpartition(non_root, -take, axis=1)[:, -take:]
        chosen_scores = np.take_along_axis(non_root, chosen, axis=1)
        order = np.argsort(-chosen_scores, axis=1)
        chosen = np.take_along_axis(chosen, order, axis=1)
        chosen_scores = np.take_along_axis(chosen_scores, order, axis=1)
        selected[:, :take] = chosen + 1
        selected_scores[:, :take] = np.where(chosen_scores > 0.002, chosen_scores, 0.0)

    raw_total = selected_scores.sum(axis=1)
    total = np.minimum(raw_total, 1.0).astype(np.float32)
    scale = np.divide(total, raw_total, out=np.zeros_like(total), where=raw_total > 1e-8)
    selected_scores *= scale[:, None]
    weights = np.concatenate([(1.0 - total)[:, None], selected_scores], axis=1)
    indices = np.concatenate([np.zeros((count, 1), dtype=np.int32), selected], axis=1)

    scaled = weights * 255.0
    quantized = np.floor(scaled).astype(np.int32)
    remaining = 255 - quantized.sum(axis=1)
    fraction_order = np.argsort(-(scaled - quantized), axis=1)
    rows = np.arange(count)
    for cursor in range(WEIGHT_SLOTS):
        active = remaining > cursor
        quantized[rows[active], fraction_order[active, cursor]] += 1
    packed = (
        (indices.astype(np.uint16) << np.uint16(8))
        | quantized.astype(np.uint16)
    )
    decoded_weight = (packed & np.uint16(255)).astype(np.float32) / 255.0
    return packed, {
        "averageBodyWeight": round(float(decoded_weight[:, 0].mean()), 5),
        "minimumWeightSum": round(float(decoded_weight.sum(axis=1).min()), 5),
        "maximumWeightSum": round(float(decoded_weight.sum(axis=1).max()), 5),
        "boneCount": int(bone_count),
    }


def _enforce_rigid_core_ownership(scores: np.ndarray) -> np.ndarray:
    """Resolve overlapping rigid regions to exactly one moving bone."""
    if scores.shape[1] <= 1:
        return scores
    non_root = scores[:, 1:]
    winners = np.argmax(non_root, axis=1)
    winner_scores = non_root[np.arange(non_root.shape[0]), winners]
    rigid = winner_scores >= 0.9
    if not np.any(rigid):
        return scores
    non_root[rigid] = 0.0
    rigid_rows = np.flatnonzero(rigid)
    non_root[rigid_rows, winners[rigid]] = 1.0
    return scores


def _largest_seeded_component(
    voxel_keys: np.ndarray,
    scores: np.ndarray,
    *,
    support_floor: float = 0.12,
    seed_floor: float = 0.82,
    neighbor_radius: int = 2,
) -> tuple[np.ndarray, dict[str, float | int]]:
    """Grow one anatomical part through connected occupied 3D voxels.

    AI polygons provide semantic evidence, but never define the final boundary.
    Only the connected component containing a strong semantic seed survives;
    detached islands on the torso, head, or opposite depth layer are discarded.
    """
    active_indices = np.flatnonzero(scores >= support_floor)
    selected = np.zeros(scores.shape[0], dtype=bool)
    if active_indices.size == 0:
        return selected, {"candidateVoxelCount": 0, "connectedVoxelCount": 0, "removedIslandCount": 0}

    active_lookup = {tuple(int(value) for value in voxel_keys[index]): int(index) for index in active_indices}
    active_set = set(int(index) for index in active_indices)
    strong_seed = scores >= seed_floor
    if not np.any(strong_seed & (scores >= support_floor)):
        strong_seed = scores >= max(float(scores.max()) * 0.92, support_floor)

    offsets = [
        (dx, dy, dz)
        for dx in range(-neighbor_radius, neighbor_radius + 1)
        for dy in range(-neighbor_radius, neighbor_radius + 1)
        for dz in range(-neighbor_radius, neighbor_radius + 1)
        if (dx != 0 or dy != 0 or dz != 0)
        and dx * dx + dy * dy + dz * dz <= neighbor_radius * neighbor_radius + 1
    ]
    components: list[list[int]] = []
    while active_set:
        start = active_set.pop()
        component = [start]
        cursor = 0
        while cursor < len(component):
            current = component[cursor]
            cursor += 1
            x, y, z = (int(value) for value in voxel_keys[current])
            for dx, dy, dz in offsets:
                neighbor = active_lookup.get((x + dx, y + dy, z + dz))
                if neighbor is None or neighbor not in active_set:
                    continue
                active_set.remove(neighbor)
                component.append(neighbor)
        components.append(component)

    def rank(component: list[int]) -> tuple[int, float, float, int]:
        indices = np.asarray(component, dtype=np.int32)
        seed_scores = scores[indices][strong_seed[indices]]
        return (
            int(seed_scores.size > 0),
            float(seed_scores.sum()),
            float(scores[indices].sum()),
            len(component),
        )

    winner = max(components, key=rank)
    selected[np.asarray(winner, dtype=np.int32)] = True
    return selected, {
        "candidateVoxelCount": int(active_indices.size),
        "connectedVoxelCount": int(len(winner)),
        "removedIslandCount": int(active_indices.size - len(winner)),
        "componentCount": int(len(components)),
    }


def _build_connected_part_ownership(
    voxel_keys: np.ndarray,
    scores: np.ndarray,
    bones: list[dict[str, Any]],
) -> tuple[np.ndarray, dict[int, dict[str, float | int]]]:
    """Resolve semantic evidence to one connected, rigid part ID per voxel."""
    owner = np.zeros(scores.shape[0], dtype=np.uint8)
    winning_score = np.zeros(scores.shape[0], dtype=np.float32)
    metrics: dict[int, dict[str, float | int]] = {}
    masks: dict[int, np.ndarray] = {}
    for bone in bones[1:]:
        bone_index = int(bone["index"])
        if bone_index >= scores.shape[1] or bone_index > np.iinfo(np.uint8).max:
            continue
        kind = str(bone.get("kind") or "")
        mask, component_metrics = _largest_seeded_component(
            voxel_keys,
            scores[:, bone_index],
            support_floor=0.16 if kind == "head" else 0.12,
            seed_floor=0.86 if kind == "head" else 0.82,
        )
        masks[bone_index] = mask
        metrics[bone_index] = component_metrics

    protected_head = np.zeros(scores.shape[0], dtype=bool)
    for bone in bones[1:]:
        if bone.get("kind") != "head":
            continue
        head_mask = masks.get(int(bone["index"]))
        if head_mask is not None:
            protected_head |= head_mask

    # Head ownership is absolute. A 2D arm polygon is allowed to overlap the
    # face in the source image, but it may never take ownership of a voxel that
    # belongs to the connected head component.
    ordered_bones = sorted(bones[1:], key=lambda bone: 0 if bone.get("kind") == "head" else 1)
    for bone in ordered_bones:
        bone_index = int(bone["index"])
        mask = masks.get(bone_index)
        if mask is None or not np.any(mask):
            continue
        evidence = scores[:, bone_index].copy()
        if bone.get("kind") == "head":
            replace = mask
        else:
            replace = mask & ~protected_head & (evidence > winning_score + 0.035)
        owner[replace] = np.uint8(bone_index)
        winning_score[replace] = evidence[replace]

    # Remove fragments created only by overlap arbitration. A final component
    # pass guarantees that every exported part ID is spatially coherent.
    for bone in bones[1:]:
        bone_index = int(bone["index"])
        assigned = owner == bone_index
        if not np.any(assigned):
            continue
        final_scores = np.where(assigned, np.maximum(scores[:, bone_index], 1.0), 0.0).astype(np.float32)
        connected, final_metrics = _largest_seeded_component(
            voxel_keys,
            final_scores,
            support_floor=0.5,
            seed_floor=0.9,
        )
        owner[assigned & ~connected] = 0
        metrics.setdefault(bone_index, {}).update(
            {
                "finalVoxelCount": int(connected.sum()),
                "overlapFragmentCount": int((assigned & ~connected).sum()),
                "finalComponentCount": int(final_metrics.get("componentCount", 0)),
            }
        )
    return owner, metrics


def _joint_fractions(segments: int) -> np.ndarray:
    presets = {
        1: [0.0],
        2: [0.0, 0.52],
        3: [0.0, 0.38, 0.7],
        4: [0.0, 0.28, 0.52, 0.76],
    }
    values = presets.get(segments)
    if values is None:
        return np.arange(segments, dtype=np.float32) / max(segments, 1)
    return np.asarray(values, dtype=np.float32)


def _save_proxy_preview(
    artwork_dir: Path,
    articulation: dict[str, Any],
    subject_bounds: np.ndarray,
    accepted_regions: list[dict[str, Any]],
) -> Path | None:
    source_name = articulation.get("sourceImage")
    source_path = artwork_dir / str(source_name) if source_name else None
    if source_path is None or not source_path.is_file():
        return None
    try:
        with Image.open(source_path) as opened:
            image = ImageOps.exif_transpose(opened).convert("RGB")
    except OSError:
        return None
    draw = ImageDraw.Draw(image, "RGBA")
    width, height = image.size
    left, top, right, bottom = [float(value) for value in subject_bounds]

    def image_point(point: list[float]) -> tuple[int, int]:
        return (
            int((left + float(point[0]) * (right - left)) * width),
            int((top + float(point[1]) * (bottom - top)) * height),
        )

    radius = max(4, width // 260)
    line_width = max(2, width // 520)
    for region in accepted_regions:
        ai_root = image_point(region["aiRoot2d"])
        corrected_root = image_point(region["correctedRoot2d"])
        joints = [image_point(point) for point in region["jointPoints2d"]]
        tip = image_point(region["tip2d"])
        draw.line([ai_root, corrected_root], fill=(255, 70, 70, 205), width=line_width)
        draw.ellipse(
            (ai_root[0] - radius, ai_root[1] - radius, ai_root[0] + radius, ai_root[1] + radius),
            fill=(255, 70, 70, 225),
        )
        draw.line([*joints, tip], fill=(30, 220, 125, 235), width=line_width * 2)
        for joint in joints:
            draw.ellipse(
                (joint[0] - radius, joint[1] - radius, joint[0] + radius, joint[1] + radius),
                fill=(40, 235, 135, 245),
            )
        draw.ellipse(
            (tip[0] - radius, tip[1] - radius, tip[0] + radius, tip[1] + radius),
            fill=(55, 135, 255, 245),
        )
    image.thumbnail((1400, 1400), Image.Resampling.LANCZOS)
    output_path = artwork_dir / PROXY_PREVIEW_FILENAME
    image.save(output_path, format="WEBP", quality=90, method=4)
    return output_path


def build_gpu_splat_skinning_rig_from_file(
    *,
    splat_path: Path,
    artwork_dir: Path,
    artwork_id: str,
    features: dict[str, Any] | None,
) -> dict[str, Any]:
    """Fit AI-guided rigid part ownership for CPU rest-pose animation.

    The visible Gaussian field is never split. A low-resolution, invisible
    voxel cage stabilizes region ownership and joint placement; a single part
    owner is then mapped back to each source Gaussian for rigid CPU transforms.
    """
    disabled = lambda reason, detail=None: {
        "version": 13,
        "enabled": False,
        "strategy": "cpu-splat-bone-mapping",
        "reason": reason,
        **({"detail": detail} if detail else {}),
    }
    if not splat_path.is_file():
        return disabled("missing-monolithic-splat")
    articulation = (features or {}).get("articulation")
    if not isinstance(articulation, dict):
        return disabled("missing-articulation", (features or {}).get("articulationError"))
    regions = articulation.get("regions")
    bounds_value = articulation.get("subjectBounds")
    if not isinstance(regions, list) or not regions:
        return disabled("empty-articulation-regions")
    if not isinstance(bounds_value, list) or len(bounds_value) != 4:
        return disabled("invalid-subject-bounds")

    try:
        arrays = _decode_splat(splat_path)
    except (OSError, ValueError) as exc:
        return disabled("invalid-splat", str(exc))
    xyz = arrays["xyz"]
    total = int(xyz.shape[0])
    if total < 4096:
        return disabled("insufficient-gaussians")
    display, normalized, model_bounds = _normalized_display_coordinates(xyz)
    uv = np.stack([(normalized[:, 0] + 1.0) * 0.5, (1.0 - normalized[:, 1]) * 0.5], axis=1)
    alpha = arrays["rgba"][:, 3].astype(np.float32)
    subject_bounds = np.asarray(bounds_value, dtype=np.float32)
    proxy = _build_voxel_proxy(display, uv, alpha)
    proxy_display = proxy["display"]
    proxy_uv = proxy["uv"]
    proxy_alpha = proxy["alpha"]
    proxy_keys = proxy["keys"]
    inverse = proxy["inverse"]
    assert isinstance(proxy_display, np.ndarray)
    assert isinstance(proxy_uv, np.ndarray)
    assert isinstance(proxy_alpha, np.ndarray)
    assert isinstance(proxy_keys, np.ndarray)
    assert isinstance(inverse, np.ndarray)
    proxy_count = int(proxy_display.shape[0])

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
    accepted_regions: list[dict[str, Any]] = []
    rejected_regions: list[dict[str, Any]] = []
    display_to_model = np.asarray([1.0, -1.0, -1.0], dtype=np.float32)

    head_center: np.ndarray | None = None
    for candidate in regions:
        if not isinstance(candidate, dict) or str(candidate.get("kind") or "").lower() != "head":
            continue
        try:
            polygon = np.stack(
                [_subject_point(point, subject_bounds) for point in candidate.get("polygon") or []],
                axis=0,
            )
            if polygon.shape[0] >= 3:
                head_center = _polygon_centroid(polygon)
                break
        except (TypeError, ValueError):
            continue

    priority = {"head": 0, "arm": 1, "leg": 2, "wing": 3, "fin": 4, "tail": 5, "ear": 6}
    ordered = sorted(
        (region for region in regions if isinstance(region, dict)),
        key=lambda region: (
            priority.get(str(region.get("kind") or "").lower(), 99),
            -float(region.get("confidence") or 0.0),
            str(region.get("id") or ""),
        ),
    )
    head_bone_index: int | None = None
    for region in ordered:
        kind = str(region.get("kind") or "").lower()
        side = str(region.get("side") or "center").lower()
        if kind not in priority:
            continue
        fitted = _region_influence(
            display=display,
            uv=uv,
            alpha=alpha,
            proxy_display=proxy_display,
            proxy_uv=proxy_uv,
            proxy_alpha=proxy_alpha,
            proxy_voxel_size=float(proxy["voxelSize"]),
            region=region,
            bounds=subject_bounds,
            head_center=head_center,
        )
        if fitted is None:
            continue

        influence = fitted["influence"]
        membership = fitted["membership"]
        root_blend = fitted["rootBlend"]
        longitudinal = fitted["longitudinal"]
        root_display = fitted["rootDisplay"]
        tip_display = fitted["tipDisplay"]
        assert isinstance(influence, np.ndarray)
        assert isinstance(membership, np.ndarray)
        assert isinstance(root_blend, np.ndarray)
        assert isinstance(longitudinal, np.ndarray)
        assert isinstance(root_display, np.ndarray)
        assert isinstance(tip_display, np.ndarray)

        distal_recall = float(fitted["distalRecall"])
        track_coverage = float(fitted["trackCoverage"])
        root_depth_span_ratio = float(fitted["rootDepthSpanRatio"])
        capsule_leak_ratio = float(fitted["capsuleLeakRatio"])
        maximum_root_span_ratio = 2.4 if kind == "head" else (2.2 if kind in {"tail", "wing"} else 1.8)
        if (
            distal_recall < MIN_DISTAL_RECALL
            or track_coverage < MIN_TRACK_COVERAGE
            or root_depth_span_ratio > maximum_root_span_ratio + 1e-4
            or capsule_leak_ratio > MAX_CAPSULE_LEAK_RATIO
        ):
            rejected_regions.append(
                {
                    "id": str(region.get("id") or f"{side}-{kind}"),
                    "kind": kind,
                    "side": side,
                    "reason": "unstable-depth-track",
                    "distalRecall": round(distal_recall, 5),
                    "trackCoverageRatio": round(track_coverage, 5),
                    "rootDepthSpanRatio": round(root_depth_span_ratio, 5),
                    "capsuleLeakRatio": round(capsule_leak_ratio, 5),
                }
            )
            continue

        segments = _bone_segments(kind)
        assignments = _rigid_segment_assignments(longitudinal, segments)
        region_proxy_strength = (influence[:, None] * assignments).max(axis=1)
        gaussian_region_strength = region_proxy_strength[inverse]
        weighted_gaussian_count = int((gaussian_region_strength >= 0.24).sum())
        rigid_gaussian_count = int((gaussian_region_strength >= 0.9).sum())
        region_rigid_core_ratio = rigid_gaussian_count / max(weighted_gaussian_count, 1)
        if region_rigid_core_ratio < MIN_RIGID_CORE_RATIO:
            rejected_regions.append(
                {
                    "id": str(region.get("id") or f"{side}-{kind}"),
                    "kind": kind,
                    "side": side,
                    "reason": "insufficient-rigid-core",
                    "rigidCoreRatio": round(region_rigid_core_ratio, 5),
                }
            )
            continue

        gaussian_inside = fitted["gaussianInside"]
        assert isinstance(gaussian_inside, np.ndarray)
        semantic_gaussian_count = int(fitted["gaussianInsideCount"])
        semantic_weighted_count = int((gaussian_inside & (gaussian_region_strength >= 0.24)).sum())
        semantic_track_coverage = semantic_weighted_count / max(semantic_gaussian_count, 1)

        parent_index = head_bone_index if kind == "ear" and head_bone_index is not None else 0
        region_bones: list[int] = []
        axis_display = tip_display - root_display
        direction_display = _safe_axis(axis_display, np.asarray([0.0, 1.0, 0.0], dtype=np.float32))
        fractions = _joint_fractions(segments)
        for segment, fraction in enumerate(fractions):
            if len(bones) >= MAX_BONES:
                break
            pivot_display = root_display + axis_display * float(fraction)
            pivot = pivot_display * display_to_model
            bone_index = len(bones)
            bone_id = str(region.get("id") or f"{side}-{kind}")
            if segments > 1:
                bone_id = f"{bone_id}-{segment + 1}"
            bones.append(
                {
                    "index": bone_index,
                    "id": bone_id,
                    "parentIndex": parent_index,
                    "kind": kind,
                    "side": side,
                    "pivot": [round(float(value), 7) for value in pivot],
                    "animation": _animation(kind, side, segment, segments, direction_display),
                }
            )
            region_bones.append(bone_index)
            parent_index = bone_index
            score_columns.append(np.zeros(proxy_count, dtype=np.float32))
        if not region_bones:
            continue
        if kind == "head" and head_bone_index is None:
            head_bone_index = region_bones[0]

        if len(region_bones) != assignments.shape[1]:
            assignments = _rigid_segment_assignments(longitudinal, len(region_bones))
            region_proxy_strength = (influence[:, None] * assignments).max(axis=1)
        if parent_index > 0 and kind == "ear" and head_bone_index is not None:
            # Outside the narrow ear base, remove the broad head polygon's
            # ownership so the whole ear follows its own rigid child bone.
            child_gate = np.clip(influence, 0.0, 1.0)
            score_columns[head_bone_index] *= 1.0 - child_gate * 0.98
            parent_transition = membership * (1.0 - root_blend)
            score_columns[head_bone_index] = np.maximum(
                score_columns[head_bone_index],
                parent_transition.astype(np.float32),
            )
        for segment, bone_index in enumerate(region_bones):
            score_columns[bone_index] = np.maximum(
                score_columns[bone_index],
                influence * assignments[:, segment],
            )

        active_proxy = region_proxy_strength >= 0.24
        blended_proxy = active_proxy & (region_proxy_strength < 0.9)
        root_2d = fitted["root2d"]
        tip_2d = fitted["tip2d"]
        ai_root_2d = fitted["aiRoot2d"]
        assert isinstance(root_2d, np.ndarray)
        assert isinstance(tip_2d, np.ndarray)
        assert isinstance(ai_root_2d, np.ndarray)
        joint_points = [root_2d + (tip_2d - root_2d) * float(fraction) for fraction in fractions]
        accepted_regions.append(
            {
                "id": str(region.get("id") or f"{side}-{kind}"),
                "kind": kind,
                "side": side,
                "confidence": round(float(region.get("confidence") or 0.0), 4),
                "boneIndices": region_bones,
                "parentBoneIndex": head_bone_index if kind == "ear" and head_bone_index is not None else 0,
                "weightedGaussianCount": weighted_gaussian_count,
                "semanticGaussianCount": semantic_gaussian_count,
                "semanticTrackCoverageRatio": round(semantic_track_coverage, 5),
                "distalRecall": round(distal_recall, 5),
                "trackCoverageRatio": round(track_coverage, 5),
                "rootDepthSpanRatio": round(root_depth_span_ratio, 5),
                "capsuleLeakRatio": round(capsule_leak_ratio, 5),
                "proxyVoxelCount": int(active_proxy.sum()),
                "rigidCoreRatio": round(region_rigid_core_ratio, 5),
                "jointBlendRatio": round(float(blended_proxy.sum()) / max(int(active_proxy.sum()), 1), 5),
                "rootCorrectionDistance": round(float(np.linalg.norm(root_2d - ai_root_2d)), 5),
                "aiRoot2d": [round(float(value), 6) for value in ai_root_2d],
                "correctedRoot2d": [round(float(value), 6) for value in root_2d],
                "tip2d": [round(float(value), 6) for value in tip_2d],
                "jointPoints2d": [
                    [round(float(value), 6) for value in point]
                    for point in joint_points
                ],
            }
        )

    if len(bones) <= 1:
        return disabled("no-valid-proxy-bones")

    proxy_scores = np.stack(score_columns, axis=1)
    proxy_owner, connectivity_metrics = _build_connected_part_ownership(proxy_keys, proxy_scores, bones)
    source_owner = proxy_owner[inverse]
    moving_indices = np.asarray(
        [int(bone["index"]) for bone in bones if bone.get("kind") not in {"body", "head"}],
        dtype=np.uint8,
    )
    animated = np.isin(source_owner, moving_indices) if moving_indices.size else np.zeros(total, dtype=bool)
    coverage_ratio = float(animated.mean())
    rigid_core_ratio = 1.0 if np.any(animated) else 0.0
    for region in accepted_regions:
        bone_indices = region.get("boneIndices") or []
        if bone_indices:
            region["connectivity"] = connectivity_metrics.get(int(bone_indices[0]), {})
    minimum_distal_recall = min(float(region["distalRecall"]) for region in accepted_regions)
    minimum_track_coverage = min(float(region["trackCoverageRatio"]) for region in accepted_regions)
    maximum_root_depth_span = max(float(region["rootDepthSpanRatio"]) for region in accepted_regions)
    maximum_capsule_leak = max(float(region["capsuleLeakRatio"]) for region in accepted_regions)
    if (
        coverage_ratio < 0.01
        or rigid_core_ratio < MIN_RIGID_CORE_RATIO
        or minimum_distal_recall < MIN_DISTAL_RECALL
        or minimum_track_coverage < MIN_TRACK_COVERAGE
        or maximum_capsule_leak > MAX_CAPSULE_LEAK_RATIO
    ):
        return disabled(
            "proxy-rig-quality-gate-failed",
            (
                f"coverage={coverage_ratio:.5f} rigidCore={rigid_core_ratio:.5f} "
                f"distalRecall={minimum_distal_recall:.5f} "
                f"trackCoverage={minimum_track_coverage:.5f} "
                f"capsuleLeak={maximum_capsule_leak:.5f}"
            ),
        )

    # Version 13 keeps each connected appendage on a single bone, while adding
    # a geometric joint falloff only inside that appendage. Unlike the removed
    # semantic-score blend, no body/head Gaussian can ever receive limb weight.
    weight_scores = np.zeros_like(proxy_scores)
    moving_bone_indices = np.asarray(
        [
            int(bone["index"])
            for bone in bones
            if bone.get("kind") in {"arm", "leg", "wing", "fin", "tail"}
        ],
        dtype=np.int32,
    )
    joint_band_ratios: list[float] = []
    for bone_index in moving_bone_indices:
        owned = proxy_owner == bone_index
        if not np.any(owned):
            continue
        pivot_model = np.asarray(bones[int(bone_index)]["pivot"], dtype=np.float32)
        pivot_display = pivot_model * display_to_model
        distances = np.linalg.norm(proxy_display - pivot_display[None, :], axis=1)
        owned_distances = distances[owned]
        # The closest 18% of the connected part is the joint collar. Its
        # points interpolate from the stationary rest pose to the rigid limb;
        # the remaining 82% moves as one piece with weight 1.
        joint_band = max(float(np.quantile(owned_distances, 0.18)), float(proxy["voxelSize"]) * 2.25)
        normalized_distance = np.clip(distances[owned] / max(joint_band, 1e-6), 0.0, 1.0)
        joint_weight = normalized_distance * normalized_distance * (3.0 - 2.0 * normalized_distance)
        weight_scores[owned, bone_index] = joint_weight.astype(np.float32)
        joint_band_ratios.append(float((owned_distances < joint_band).mean()))
    source_weight_scores = weight_scores[inverse]
    packed_weights, weight_metrics = _quantize_weights(source_weight_scores)
    weights_path = artwork_dir / WEIGHTS_FILENAME
    weights_path.write_bytes(packed_weights.astype("<u2", copy=False).tobytes(order="C"))

    part_map_path = artwork_dir / PART_MAP_FILENAME
    if part_map_path.exists():
        part_map_path.unlink()

    revision = time.time_ns()
    preview_path = _save_proxy_preview(artwork_dir, articulation, subject_bounds, accepted_regions)
    rig = {
        "version": 13,
        "revision": revision,
        "enabled": True,
        "status": "ready",
        "strategy": "cpu-splat-bone-mapping",
        "motionMethod": "cpu-rest-pose-bone-remapping",
        "skinningMethod": "cpu-linear-blend",
        "segmentationMethod": "ai-region-bone-weights-v1",
        "sourceGaussianCount": total,
        "bounds": model_bounds,
        "weightsUrl": f"/assets/{artwork_id}/{WEIGHTS_FILENAME}?v={revision}",
        "weightsFormat": "spark-rgba16ui-little-endian",
        "weightsByteLength": int(packed_weights.nbytes),
        "maxInfluences": WEIGHT_SLOTS,
        "bones": bones,
        "quality": {
            "boneCount": len(bones),
            "bodyGaussianCount": int((source_owner == 0).sum()),
            "mappedGaussianCount": int((source_owner > 0).sum()),
            "acceptedRegionCount": len(accepted_regions),
            "animatedCoverageRatio": round(coverage_ratio, 5),
            "rigidCoreRatio": round(rigid_core_ratio, 5),
            "minimumDistalRecall": round(minimum_distal_recall, 5),
            "minimumTrackCoverageRatio": round(minimum_track_coverage, 5),
            "maximumRootDepthSpanRatio": round(maximum_root_depth_span, 5),
            "maximumCapsuleLeakRatio": round(maximum_capsule_leak, 5),
            "usesHardSegmentation": True,
            "usesProxyVoxelCage": True,
            "usesNarrowJointBands": True,
            "usesDepthExtrudedSilhouettes": False,
            "usesDistalDepthTracks": True,
            "usesSinglePartOwnership": True,
            "usesConnectedComponents": True,
            "removesDetachedIslands": True,
            "locksHeadOwnership": True,
            "stationaryKinds": ["body", "head", "ear"],
            "rigidCoreThreshold": 1.0,
            "jointBandQuantile": 0.18,
            "averageJointBandRatio": round(float(np.mean(joint_band_ratios)), 5) if joint_band_ratios else 0.0,
            **weight_metrics,
            "usesRestPoseRecalculation": True,
            "segmentationMethod": "ai-region-bone-weights-v1",
            "proxyVoxelCount": proxy_count,
            "proxyResolution": int(proxy["resolution"]),
            "proxyVoxelSize": round(float(proxy["voxelSize"]), 7),
        },
        "articulation": {
            "sourceImage": articulation.get("sourceImage"),
            "view": articulation.get("view"),
            "leftRightConvention": articulation.get("leftRightConvention"),
            "subjectBounds": bounds_value,
            "acceptedRegions": accepted_regions,
            "rejectedRegions": rejected_regions,
        },
    }
    if preview_path is not None:
        rig["proxyPreviewUrl"] = f"/assets/{artwork_id}/{preview_path.name}?v={revision}"
    write_json_atomic(artwork_dir / "rig.json", rig)
    return rig
