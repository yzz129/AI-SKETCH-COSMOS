import base64
import io
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image, ImageOps

from .ai_model_registry import ai_model_status, ark_image_models, generate_reference_image


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
load_dotenv(BACKEND_ROOT / ".env", override=True)
load_dotenv(PROJECT_ROOT / ".env.local", override=False)

DEFAULT_MODEL = "doubao-seedream-4-5-251128"
DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"

FIDELITY_PROMPT = """
生成适合单图3D重建的完整圆润3D玩具参考图。保持主体身份、颜色、表情、姿势和主要特征，但优先保证结构清楚、体积合理和部件可分辨。

使用正面略三分之二视角，清楚展示主体的正面、侧面和主要连接关系。各主要部件之间必须有清晰轮廓和适当间隙，避免肢体、耳朵、附属物与头部或躯干大面积重叠、粘连或穿插。被遮挡的重要成对部件应适度露出，但不要增加或重复部件。

所有部件具有明确厚度和连续体积。薄片和细长结构适度加粗、缩短并圆润化；过细且不利于3D重建的线状装饰可以简化。附属部件连接在合理位置，根部平滑，前后层次明确。不要生成纸片、空洞、融化、拉伸或漂浮结构。

使用简洁均匀的实体材质和柔和侧前方光照，使部件交界处有清晰明暗变化。白色不透明背景，单主体居中完整，全身入镜，无文字、水印、底座和多余物体。
"""


@dataclass(frozen=True)
class SeedreamPreparation:
    input_path: Path
    enabled: bool
    used: bool
    model: str
    provider: str | None = None
    reference_filename: str | None = None
    fallback_reason: str | None = None
    fidelity_score: float | None = None
    validation_issues: tuple[str, ...] = ()
    generation_size: str | None = None

    def manifest_payload(self) -> dict:
        return {
            "enabled": self.enabled,
            "used": self.used,
            "model": self.model,
            "provider": self.provider,
            "referenceFilename": self.reference_filename,
            "fallbackReason": self.fallback_reason,
            "fidelityScore": self.fidelity_score,
            "validationIssues": list(self.validation_issues),
            "generationSize": self.generation_size,
        }


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def seedream_config_status() -> dict:
    enabled = _env_bool("SEEDREAM_ENABLED", True)
    registry = ai_model_status()
    image_providers = registry["imageGeneration"]
    ark = next(provider for provider in image_providers if provider["provider"] == "volcano-ark")

    return {
        "enabled": enabled,
        "ready": not enabled or any(
            provider["configured"] and provider["sdkAvailable"]
            for provider in image_providers
        ),
        "apiKeyConfigured": ark["configured"],
        "apiKeyEnv": "SEEDREAM_API_KEY or ARK_API_KEY",
        "sdkAvailable": ark["sdkAvailable"],
        "model": ark_image_models()[0],
        "models": ark["models"],
        "providers": image_providers,
        "size": os.getenv("SEEDREAM_SIZE", "2K"),
        "required": _env_bool("SEEDREAM_REQUIRED", True),
        "responseFormat": os.getenv("SEEDREAM_RESPONSE_FORMAT", "b64_json"),
    }


def _image_data_url(image_path: Path) -> str:
    with Image.open(image_path) as opened:
        image = ImageOps.exif_transpose(opened)
        max_size = int(os.getenv("SEEDREAM_INPUT_MAX_SIZE", "2048"))
        image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        if image.mode == "RGBA":
            background = Image.new("RGB", image.size, "white")
            background.paste(image, mask=image.getchannel("A"))
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=90, optimize=True, progressive=True)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def _save_reference(payload: bytes, output_path: Path) -> None:
    with Image.open(io.BytesIO(payload)) as opened:
        image = ImageOps.exif_transpose(opened)
        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
        image.save(output_path, format="PNG", optimize=True)


def prepare_seedream_reference(source_path: Path, artwork_dir: Path) -> SeedreamPreparation:
    enabled = _env_bool("SEEDREAM_ENABLED", True)
    required = _env_bool("SEEDREAM_REQUIRED", True)
    model = ark_image_models()[0]
    if not enabled:
        return SeedreamPreparation(source_path, False, False, model)

    try:
        generation_size = os.getenv("SEEDREAM_SIZE", "2K")
        generated = generate_reference_image(
            _image_data_url(source_path),
            os.getenv("SEEDREAM_3D_PROMPT", FIDELITY_PROMPT),
            generation_size,
        )
        output_path = artwork_dir / "seedream_reference.png"
        _save_reference(generated.payload, output_path)
        return SeedreamPreparation(
            output_path,
            True,
            True,
            generated.model,
            provider=generated.provider,
            reference_filename=output_path.name,
            generation_size=generated.size,
        )
    except Exception as exc:
        if required:
            raise RuntimeError(f"Reference image preprocessing failed: {exc}") from exc
        return SeedreamPreparation(
            source_path,
            True,
            False,
            model,
            fallback_reason=f"{type(exc).__name__}: {exc}"[:800],
        )
