import os
import subprocess
import sys
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image

from .storage import asset_url, write_manifest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(BACKEND_ROOT / ".env")

REQUIRED_TRIPOSPLAT_PATHS = {
    "TRIPOSPLAT_REPO_ROOT": "directory",
    "TRIPOSPLAT_CKPT_PATH": "file",
    "TRIPOSPLAT_DECODER_PATH": "file",
    "TRIPOSPLAT_DINOV3_PATH": "file",
    "TRIPOSPLAT_FLUX2_VAE_ENCODER_PATH": "file",
    "TRIPOSPLAT_RMBG_PATH": "file",
}


def _optional_path(name: str) -> str | None:
    value = os.getenv(name)
    return value if value and value.strip() else None


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
        "settings": {
            "steps": int(os.getenv("TRIPOSPLAT_STEPS", "20")),
            "guidanceScale": float(os.getenv("TRIPOSPLAT_GUIDANCE_SCALE", "1.0")),
            "shift": float(os.getenv("TRIPOSPLAT_SHIFT", "3.0")),
            "cpuDtype": os.getenv("TRIPOSPLAT_CPU_DTYPE", "float32"),
            "cpuNumGaussiansCap": int(os.getenv("TRIPOSPLAT_CPU_NUM_GAUSSIANS_CAP", "32768")),
            "cpuSubprocess": os.getenv("TRIPOSPLAT_CPU_SUBPROCESS", "true").lower() == "true",
            "cpuTimeoutSeconds": int(os.getenv("TRIPOSPLAT_CPU_TIMEOUT_SECONDS", "900")),
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

    return {
        "splatUrl": asset_url(artwork_id, "model.splat") if (artwork_dir / "model.splat").is_file() else None,
        "plyUrl": asset_url(artwork_id, "model.ply") if (artwork_dir / "model.ply").is_file() else None,
        "previewUrl": asset_url(artwork_id, "preprocessed_image.webp") if (artwork_dir / "preprocessed_image.webp").is_file() else None,
        "manifestUrl": asset_url(artwork_id, "manifest.json"),
        "gaussianCount": num_gaussians,
    }


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
) -> dict:
    effective_num_gaussians = num_gaussians
    if os.getenv("TRIPOSPLAT_DEVICE", "cuda").startswith("cpu"):
        cpu_cap = int(os.getenv("TRIPOSPLAT_CPU_NUM_GAUSSIANS_CAP", "32768"))
        effective_num_gaussians = min(num_gaussians, cpu_cap)
        if os.getenv("TRIPOSPLAT_CPU_SUBPROCESS", "true").lower() == "true" and not os.getenv("TRIPOSPLAT_IN_SUBPROCESS"):
            return _generate_with_subprocess(
                artwork_id=artwork_id,
                artwork_dir=artwork_dir,
                source_path=source_path,
                num_gaussians=effective_num_gaussians,
                export_format=export_format,
            )

    pipeline = load_pipeline()

    gaussian, prepared = pipeline.run(
        str(source_path),
        seed=int(os.getenv("TRIPOSPLAT_SEED", "42")),
        steps=int(os.getenv("TRIPOSPLAT_STEPS", "20")),
        guidance_scale=float(os.getenv("TRIPOSPLAT_GUIDANCE_SCALE", "1.0")),
        shift=float(os.getenv("TRIPOSPLAT_SHIFT", "3.0")),
        num_gaussians=effective_num_gaussians,
        show_progress=True,
    )

    preview_path = artwork_dir / "preprocessed_image.webp"
    if isinstance(prepared, Image.Image):
        prepared.save(preview_path)
    elif hasattr(prepared, "save"):
        prepared.save(preview_path)

    splat_path = artwork_dir / "model.splat"
    ply_path = artwork_dir / "model.ply"
    write_splat = export_format in {"splat", "both"}
    write_ply = export_format in {"ply", "both"}

    if write_splat:
        gaussian.save_splat(splat_path)
    if write_ply:
        gaussian.save_ply(ply_path)

    manifest = {
        "id": artwork_id,
        "source": "triposplat",
        "gaussianCount": effective_num_gaussians,
        "assets": {
            "splat": asset_url(artwork_id, "model.splat") if write_splat else None,
            "ply": asset_url(artwork_id, "model.ply") if write_ply else None,
            "preview": asset_url(artwork_id, "preprocessed_image.webp"),
        },
        "transform": {
            "scale": 1,
            "rotation": [1, 0, 0, 0],
            "center": [0, 0, 0],
        },
    }
    write_manifest(artwork_dir, manifest)

    return {
        "splatUrl": manifest["assets"]["splat"],
        "plyUrl": manifest["assets"]["ply"],
        "previewUrl": manifest["assets"]["preview"],
        "manifestUrl": asset_url(artwork_id, "manifest.json"),
        "gaussianCount": effective_num_gaussians,
    }
