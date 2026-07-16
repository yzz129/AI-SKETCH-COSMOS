import os
import json
import subprocess
import sys
import time
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Iterator

from dotenv import load_dotenv
from PIL import Image

from .perf_logger import log_perf
from .seedream_worker import SeedreamPreparation, prepare_seedream_reference, seedream_config_status
from .splat_multiview import build_multiview_splat_rig
from .storage import asset_url, write_json_atomic, write_manifest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_ROOT / ".env", override=True)
_RIG_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="splat-rig")

REQUIRED_TRIPOSPLAT_PATHS = {
    "TRIPOSPLAT_REPO_ROOT": "directory",
    "TRIPOSPLAT_CKPT_PATH": "file",
    "TRIPOSPLAT_DECODER_PATH": "file",
    "TRIPOSPLAT_DINOV3_PATH": "file",
    "TRIPOSPLAT_FLUX2_VAE_ENCODER_PATH": "file",
    "TRIPOSPLAT_RMBG_PATH": "file",
}


def _log_perf(artwork_id: str, stage: str, message: str = "") -> None:
    log_perf(artwork_id, "triposplat", stage, message)


def _gpu_snapshot() -> str:
    try:
        import torch

        if not torch.cuda.is_available():
            return "cuda=unavailable"
        allocated = torch.cuda.memory_allocated() / 1024 / 1024
        reserved = torch.cuda.memory_reserved() / 1024 / 1024
        return f"cuda_allocated={allocated:.0f}MiB cuda_reserved={reserved:.0f}MiB"
    except Exception as exc:
        return f"cuda_snapshot_error={type(exc).__name__}"


@contextmanager
def _timed_stage(
    artwork_id: str,
    stage: str,
    timings: dict[str, float] | None = None,
    **fields: object,
) -> Iterator[None]:
    detail = " ".join(f"{key}={value}" for key, value in fields.items() if value is not None)
    start = time.perf_counter()
    _log_perf(artwork_id, f"{stage}:start", detail)
    try:
        yield
    finally:
        elapsed = time.perf_counter() - start
        if timings is not None:
            timings[stage] = elapsed
        gpu = _gpu_snapshot()
        _log_perf(artwork_id, f"{stage}:end", f"elapsed={elapsed:.3f}s {gpu}")


def _optional_path(name: str) -> str | None:
    value = os.getenv(name)
    return value if value and value.strip() else None


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def triposplat_config_status() -> dict:
    paths = {}
    ready = True
    device = os.getenv("TRIPOSPLAT_DEVICE", "cuda")

    for name, expected_type in REQUIRED_TRIPOSPLAT_PATHS.items():
        raw_value = _optional_path(name)
        path = Path(raw_value) if raw_value else None
        exists = path.is_dir() if path and expected_type == "directory" else path.is_file() if path else False
        ready = ready and exists
        paths[name] = {
            "value": raw_value,
            "expected": expected_type,
            "exists": exists,
        }

    runtime = {
        "torchAvailable": False,
        "cudaAvailable": False,
        "torchVersion": None,
        "cudaVersion": None,
    }
    try:
        import torch

        runtime = {
            "torchAvailable": True,
            "cudaAvailable": torch.cuda.is_available(),
            "torchVersion": torch.__version__,
            "cudaVersion": torch.version.cuda,
        }
    except Exception as exc:
        runtime["error"] = str(exc)

    if device.startswith("cuda") and not runtime["cudaAvailable"]:
        ready = False

    return {
        "ready": ready,
        "device": device,
        "seedream": seedream_config_status(),
        "settings": {
            "steps": int(os.getenv("TRIPOSPLAT_STEPS", "20")),
            "guidanceScale": float(os.getenv("TRIPOSPLAT_GUIDANCE_SCALE", "1.0")),
            "shift": float(os.getenv("TRIPOSPLAT_SHIFT", "3.0")),
            "erodeRadius": int(os.getenv("TRIPOSPLAT_ERODE_RADIUS", "1")),
            "trustSourceAlpha": _env_bool("TRIPOSPLAT_TRUST_SOURCE_ALPHA", False),
            "cpuDtype": os.getenv("TRIPOSPLAT_CPU_DTYPE", "float32"),
            "cpuNumGaussiansCap": int(os.getenv("TRIPOSPLAT_CPU_NUM_GAUSSIANS_CAP", "32768")),
            "cpuSubprocess": os.getenv("TRIPOSPLAT_CPU_SUBPROCESS", "true").lower() == "true",
            "cpuTimeoutSeconds": int(os.getenv("TRIPOSPLAT_CPU_TIMEOUT_SECONDS", "900")),
            "gpuSplatSkinning": _env_bool("SPLAT_GPU_SKINNING_ENABLED", True),
            "articulationModel": os.getenv("ARK_ARTICULATION_MODEL", "doubao-seed-2-0-mini-260428"),
        },
        "runtime": runtime,
        "paths": paths,
    }


def _generate_with_subprocess(
    *,
    artwork_id: str,
    artwork_dir: Path,
    source_path: Path,
    num_gaussians: int,
    export_format: str,
    features: dict | None,
) -> dict:
    env = os.environ.copy()
    env["TRIPOSPLAT_IN_SUBPROCESS"] = "1"
    timeout = int(os.getenv("TRIPOSPLAT_CPU_TIMEOUT_SECONDS", "900"))
    command = [
        sys.executable,
        "-m",
        "app.triposplat_cli",
        "--artwork-id",
        artwork_id,
        "--artwork-dir",
        str(artwork_dir),
        "--source-path",
        str(source_path),
        "--num-gaussians",
        str(num_gaussians),
        "--format",
        export_format,
        "--features-json",
        json.dumps(features or {}, ensure_ascii=False, separators=(",", ":")),
    ]

    try:
        subprocess.run(
            command,
            cwd=str(BACKEND_ROOT),
            env=env,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"TripoSplat CPU generation timed out after {timeout}s.") from exc
    except subprocess.CalledProcessError as exc:
        output = "\n".join(part for part in [exc.stdout, exc.stderr] if part).strip()
        raise RuntimeError(output[-4000:] or f"TripoSplat subprocess failed with exit code {exc.returncode}.") from exc

    manifest_path = artwork_dir / "manifest.json"
    if not manifest_path.is_file():
        raise RuntimeError("TripoSplat subprocess finished without writing manifest.json.")
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"TripoSplat subprocess wrote an invalid manifest: {exc}") from exc

    return {
        "splatUrl": asset_url(artwork_id, "model.splat") if (artwork_dir / "model.splat").is_file() else None,
        "plyUrl": asset_url(artwork_id, "model.ply") if (artwork_dir / "model.ply").is_file() else None,
        "previewUrl": asset_url(artwork_id, "preprocessed_image.webp") if (artwork_dir / "preprocessed_image.webp").is_file() else None,
        "manifestUrl": asset_url(artwork_id, "manifest.json"),
        "gaussianCount": num_gaussians,
        "rigUrl": asset_url(artwork_id, "rig.json") if (artwork_dir / "rig.json").is_file() else None,
        "features": manifest.get("features") or features,
    }


def _pending_rig(gaussian_count: int) -> dict[str, Any]:
    return {
        "version": 14,
        "revision": time.time_ns(),
        "enabled": False,
        "status": "processing",
        "strategy": "cpu-splat-bone-mapping",
        "sourceGaussianCount": gaussian_count,
        "reason": "background-multiview-processing",
    }


def _failed_rig(reason: str, detail: str | None = None) -> dict[str, Any]:
    return {
        "version": 14,
        "revision": time.time_ns(),
        "enabled": False,
        "status": "failed",
        "strategy": "cpu-splat-bone-mapping",
        "reason": reason,
        **({"detail": detail[:800]} if detail else {}),
    }


def _finalize_gpu_splat_skinning(
    *,
    artwork_id: str,
    artwork_dir: Path,
    splat_path: Path,
    articulation_future: Future[dict[str, Any]] | None,
    fallback_features: dict[str, Any] | None,
) -> None:
    """Finish the optional rig after the monolithic Splat is already public."""
    total_start = time.perf_counter()
    rig_features = fallback_features
    wait_start = time.perf_counter()
    try:
        # Build from rendered views of the generated 3D Gaussian model. The
        # monolithic .splat is already public, so this background job must not
        # wait for the legacy source-image articulation result.
        articulation_wait = 0.0
        build_start = time.perf_counter()
        rig = build_multiview_splat_rig(
            splat_path=splat_path,
            artwork_dir=artwork_dir,
            artwork_id=artwork_id,
        )
        rig_build = time.perf_counter() - build_start
        if not rig.get("enabled"):
            rig = {
                **rig,
                "revision": time.time_ns(),
                "status": "failed",
            }
        write_json_atomic(artwork_dir / "rig.json", rig)
        _log_perf(
            artwork_id,
            "background_rig_build:end",
            f"elapsed={rig_build:.3f}s enabled={bool(rig.get('enabled'))}",
        )
    except Exception as exc:
        articulation_wait = 0.0
        rig_build = 0.0
        rig = _failed_rig("background-rig-build-failed", f"{type(exc).__name__}: {exc}")
        write_json_atomic(artwork_dir / "rig.json", rig)
        _log_perf(artwork_id, "background_rig:failed", rig["detail"])

    manifest_path = artwork_dir / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        manifest = {}
    manifest["rig"] = rig
    if rig_features:
        manifest["features"] = rig_features
    performance = manifest.setdefault("performance", {})
    timings = performance.setdefault("timingsSeconds", {})
    timings["background_articulation_wait"] = round(articulation_wait, 3)
    timings["background_rig_build"] = round(rig_build, 3)
    performance["rigPublishedAfterBaseSeconds"] = round(time.perf_counter() - total_start, 3)
    write_manifest(artwork_dir, manifest)
    _log_perf(
        artwork_id,
        "background_rig:published",
        (
            f"elapsed={time.perf_counter() - total_start:.3f}s "
            f"enabled={bool(rig.get('enabled'))} status={rig.get('status')}"
        ),
    )


def _schedule_gpu_splat_skinning(
    *,
    artwork_id: str,
    artwork_dir: Path,
    splat_path: Path,
    articulation_future: Future[dict[str, Any]] | None,
    fallback_features: dict[str, Any] | None,
) -> None:
    _log_perf(artwork_id, "background_rig:scheduled")
    _RIG_EXECUTOR.submit(
        _finalize_gpu_splat_skinning,
        artwork_id=artwork_id,
        artwork_dir=artwork_dir,
        splat_path=splat_path,
        articulation_future=articulation_future,
        fallback_features=fallback_features,
    )


@lru_cache(maxsize=1)
def load_pipeline():
    repo_root = _optional_path("TRIPOSPLAT_REPO_ROOT")
    if repo_root and repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    try:
        from triposplat import TripoSplatPipeline
    except Exception as exc:
        raise RuntimeError(
            "TripoSplat is not importable. Set TRIPOSPLAT_REPO_ROOT or install "
            "the TripoSplat package in this Python environment."
        ) from exc

    return TripoSplatPipeline(
        ckpt_path=os.environ["TRIPOSPLAT_CKPT_PATH"],
        decoder_path=os.environ["TRIPOSPLAT_DECODER_PATH"],
        dinov3_path=os.environ["TRIPOSPLAT_DINOV3_PATH"],
        flux2_vae_encoder_path=os.environ["TRIPOSPLAT_FLUX2_VAE_ENCODER_PATH"],
        rmbg_path=os.environ["TRIPOSPLAT_RMBG_PATH"],
        device=os.getenv("TRIPOSPLAT_DEVICE", "cuda"),
    )


def generate_triposplat_assets(
    *,
    artwork_id: str,
    artwork_dir: Path,
    source_path: Path,
    num_gaussians: int,
    export_format: str,
    features: dict | None = None,
    progress_callback: Callable[[float, str], None] | None = None,
) -> dict:
    total_start = time.perf_counter()
    timings: dict[str, float] = {}
    effective_num_gaussians = num_gaussians
    steps = int(os.getenv("TRIPOSPLAT_STEPS", "20"))
    guidance_scale = float(os.getenv("TRIPOSPLAT_GUIDANCE_SCALE", "1.0"))
    shift = float(os.getenv("TRIPOSPLAT_SHIFT", "3.0"))
    seed = int(os.getenv("TRIPOSPLAT_SEED", "42"))
    erode_radius = int(os.getenv("TRIPOSPLAT_ERODE_RADIUS", "1"))
    trust_source_alpha = _env_bool("TRIPOSPLAT_TRUST_SOURCE_ALPHA", False)
    _log_perf(
        artwork_id,
        "generate:start",
        (
            f"source={source_path.name} requested_gaussians={num_gaussians} "
            f"format={export_format} steps={steps} guidanceScale={guidance_scale} "
            f"shift={shift} seed={seed} erodeRadius={erode_radius} "
            f"trustSourceAlpha={trust_source_alpha}"
        ),
    )
    if progress_callback:
        progress_callback(0.12, "正在生成 Seedream 3D 参考图")

    if os.getenv("TRIPOSPLAT_IN_SUBPROCESS"):
        seedream_preparation = SeedreamPreparation(
            input_path=source_path,
            enabled=_env_bool("SEEDREAM_ENABLED", True),
            used=source_path.name == "seedream_reference.png",
            model=os.getenv("SEEDREAM_MODEL", "doubao-seedream-4-5-251128"),
            reference_filename=source_path.name if source_path.name == "seedream_reference.png" else None,
        )
    else:
        with _timed_stage(artwork_id, "seedream_reference", timings):
            seedream_preparation = prepare_seedream_reference(source_path, artwork_dir)
    triposplat_source_path = seedream_preparation.input_path
    _log_perf(
        artwork_id,
        "seedream_reference:result",
        (
            f"enabled={seedream_preparation.enabled} used={seedream_preparation.used} "
            f"model={seedream_preparation.model} input={triposplat_source_path.name} "
            f"fallback={seedream_preparation.fallback_reason or 'none'}"
        ),
    )
    if progress_callback:
        progress_callback(
            0.45 if seedream_preparation.used else 0.28,
            "Seedream 参考图已生成，正在加载 TripoSplat 管线"
            if seedream_preparation.used
            else "正在使用原图加载 TripoSplat 管线",
        )

    # Part analysis now runs against views rendered from the completed 3D
    # Gaussian model. Do not spend an Ark request on the source image here.
    running_in_subprocess = bool(os.getenv("TRIPOSPLAT_IN_SUBPROCESS"))
    articulation_future: Future[dict[str, Any]] | None = None

    if os.getenv("TRIPOSPLAT_DEVICE", "cuda").startswith("cpu"):
        cpu_cap = int(os.getenv("TRIPOSPLAT_CPU_NUM_GAUSSIANS_CAP", "32768"))
        effective_num_gaussians = min(num_gaussians, cpu_cap)
        if os.getenv("TRIPOSPLAT_CPU_SUBPROCESS", "true").lower() == "true" and not os.getenv("TRIPOSPLAT_IN_SUBPROCESS"):
            with _timed_stage(artwork_id, "cpu_subprocess", timings, gaussians=effective_num_gaussians):
                assets = _generate_with_subprocess(
                    artwork_id=artwork_id,
                    artwork_dir=artwork_dir,
                    source_path=triposplat_source_path,
                    num_gaussians=effective_num_gaussians,
                    export_format=export_format,
                    features=features,
                )
            if assets.get("rigUrl"):
                _schedule_gpu_splat_skinning(
                    artwork_id=artwork_id,
                    artwork_dir=artwork_dir,
                    splat_path=artwork_dir / "model.splat",
                    articulation_future=articulation_future,
                    fallback_features=features,
                )
            return assets

    with _timed_stage(artwork_id, "load_pipeline", timings):
        pipeline = load_pipeline()
    if progress_callback:
        progress_callback(0.5, "TripoSplat 管线已就绪，正在生成 Gaussian Splat")

    with _timed_stage(
        artwork_id,
        "pipeline_run",
        timings,
        gaussians=effective_num_gaussians,
        steps=steps,
        guidanceScale=guidance_scale,
        erodeRadius=erode_radius,
        trustSourceAlpha=trust_source_alpha,
        format=export_format,
    ):
        gaussian, prepared = pipeline.run(
            str(triposplat_source_path),
            seed=seed,
            steps=steps,
            guidance_scale=guidance_scale,
            shift=shift,
            num_gaussians=effective_num_gaussians,
            erode_radius=erode_radius,
            trust_source_alpha=trust_source_alpha,
            show_progress=True,
        )
    if progress_callback:
        progress_callback(0.9, "Gaussian Splat 已生成，正在保存预览和模型")

    preview_path = artwork_dir / "preprocessed_image.webp"
    with _timed_stage(artwork_id, "save_preview", timings):
        if isinstance(prepared, Image.Image):
            prepared.save(preview_path)
        elif hasattr(prepared, "save"):
            prepared.save(preview_path)
    if progress_callback:
        progress_callback(0.94, "预览图已保存，正在导出模型")

    splat_path = artwork_dir / "model.splat"
    ply_path = artwork_dir / "model.ply"
    write_splat = export_format in {"splat", "both"}
    write_ply = export_format in {"ply", "both"}

    if write_splat:
        with _timed_stage(artwork_id, "save_splat", timings, path=splat_path.name):
            gaussian.save_splat(splat_path)
    if write_ply:
        with _timed_stage(artwork_id, "save_ply", timings, path=ply_path.name):
            gaussian.save_ply(ply_path)
    rig_requested = (
        write_splat
        and _env_bool("SPLAT_GPU_SKINNING_ENABLED", True)
    )
    rig = _pending_rig(effective_num_gaussians) if rig_requested else {
        "version": 14,
        "revision": time.time_ns(),
        "enabled": False,
        "status": "unavailable",
        "strategy": "cpu-splat-bone-mapping",
        "reason": "splat-export-required",
    }
    if rig_requested:
        write_json_atomic(artwork_dir / "rig.json", rig)
    if progress_callback:
        progress_callback(0.97, "基础 .splat 已生成，正在立即发布；骨骼将在后台加载")

    manifest = {
        "id": artwork_id,
        "source": "triposplat",
        "gaussianCount": effective_num_gaussians,
        "assets": {
            "splat": asset_url(artwork_id, "model.splat") if write_splat else None,
            "ply": asset_url(artwork_id, "model.ply") if write_ply else None,
            "preview": asset_url(artwork_id, "preprocessed_image.webp"),
            "seedreamReference": (
                asset_url(artwork_id, seedream_preparation.reference_filename)
                if seedream_preparation.reference_filename
                else None
            ),
        },
        "transform": {
            "scale": 1,
            "rotation": [1, 0, 0, 0],
            "center": [0, 0, 0],
        },
        "rig": rig,
        "features": features,
        "performance": {
            "steps": steps,
            "guidanceScale": guidance_scale,
            "shift": shift,
            "seed": seed,
            "erodeRadius": erode_radius,
            "trustSourceAlpha": trust_source_alpha,
            "requestedGaussianCount": num_gaussians,
            "effectiveGaussianCount": effective_num_gaussians,
            "format": export_format,
            "seedream": seedream_preparation.manifest_payload(),
            "timingsSeconds": {key: round(value, 3) for key, value in timings.items()},
        },
    }
    with _timed_stage(artwork_id, "write_manifest", timings):
        write_manifest(artwork_dir, manifest)

    if rig_requested and not running_in_subprocess:
        _schedule_gpu_splat_skinning(
            artwork_id=artwork_id,
            artwork_dir=artwork_dir,
            splat_path=splat_path,
            articulation_future=articulation_future,
            fallback_features=features,
        )

    total_elapsed = time.perf_counter() - total_start
    _log_perf(
        artwork_id,
        "generate:end",
        f"elapsed={total_elapsed:.3f}s effective_gaussians={effective_num_gaussians}",
    )

    return {
        "splatUrl": manifest["assets"]["splat"],
        "plyUrl": manifest["assets"]["ply"],
        "previewUrl": manifest["assets"]["preview"],
        "manifestUrl": asset_url(artwork_id, "manifest.json"),
        "gaussianCount": effective_num_gaussians,
        "rigUrl": asset_url(artwork_id, "rig.json") if rig_requested else None,
        "features": features,
    }
