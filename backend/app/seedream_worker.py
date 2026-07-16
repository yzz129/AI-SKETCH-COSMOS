import base64
import io
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from PIL import Image, ImageOps


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
    api_key_configured = bool(os.getenv("SEEDREAM_API_KEY", "").strip())
    try:
        import volcenginesdkarkruntime  # noqa: F401

        sdk_available = True
    except ImportError:
        sdk_available = False

    return {
        "enabled": enabled,
        "ready": not enabled or (api_key_configured and sdk_available),
        "apiKeyConfigured": api_key_configured,
        "apiKeyEnv": "SEEDREAM_API_KEY",
        "sdkAvailable": sdk_available,
        "model": os.getenv("SEEDREAM_MODEL", DEFAULT_MODEL),
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


def _download_generated_image(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "AI-Sketch-Cosmos/1.0"})
    with urlopen(request, timeout=120) as response:
        payload = response.read(32 * 1024 * 1024 + 1)
    if len(payload) > 32 * 1024 * 1024:
        raise RuntimeError("Seedream output exceeded the 32 MiB download limit.")
    return payload


def _response_image_bytes(response) -> bytes:
    data = getattr(response, "data", None)
    if not data:
        raise RuntimeError("Seedream returned no image data.")
    first = data[0]
    b64_json = getattr(first, "b64_json", None)
    if b64_json:
        return base64.b64decode(b64_json)
    url = getattr(first, "url", None)
    if not url:
        raise RuntimeError("Seedream response did not contain an image URL.")
    return _download_generated_image(url)


def _save_reference(payload: bytes, output_path: Path) -> None:
    with Image.open(io.BytesIO(payload)) as opened:
        image = ImageOps.exif_transpose(opened)
        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
        image.save(output_path, format="PNG", optimize=True)


def prepare_seedream_reference(source_path: Path, artwork_dir: Path) -> SeedreamPreparation:
    enabled = _env_bool("SEEDREAM_ENABLED", True)
    required = _env_bool("SEEDREAM_REQUIRED", True)
    model = os.getenv("SEEDREAM_MODEL", DEFAULT_MODEL)
    if not enabled:
        return SeedreamPreparation(source_path, False, False, model)

    try:
        from volcenginesdkarkruntime import Ark

        api_key = os.getenv("SEEDREAM_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("SEEDREAM_API_KEY is not configured for the backend process.")

        client = Ark(
            base_url=os.getenv("SEEDREAM_BASE_URL", DEFAULT_BASE_URL),
            api_key=api_key,
        )
        generation_size = os.getenv("SEEDREAM_SIZE", "2K")
        request_params = {
            "model": model,
            "prompt": os.getenv("SEEDREAM_3D_PROMPT", FIDELITY_PROMPT),
            "image": [_image_data_url(source_path)],
            "response_format": os.getenv("SEEDREAM_RESPONSE_FORMAT", "b64_json"),
        }
        try:
            response = client.images.generate(size=generation_size, **request_params)
        except Exception as exc:
            fallback_size = os.getenv("SEEDREAM_FALLBACK_SIZE", "2K")
            size_error = "InvalidParameter" in str(exc) and "size" in str(exc)
            format_error = "response_format" in str(exc) or "b64_json" in str(exc)
            if format_error and request_params["response_format"] != "url":
                request_params["response_format"] = "url"
                response = client.images.generate(size=generation_size, **request_params)
            elif size_error and fallback_size != generation_size:
                generation_size = fallback_size
                response = client.images.generate(size=generation_size, **request_params)
            else:
                raise
        output_path = artwork_dir / "seedream_reference.png"
        _save_reference(_response_image_bytes(response), output_path)
        return SeedreamPreparation(
            output_path,
            True,
            True,
            model,
            reference_filename=output_path.name,
            generation_size=generation_size,
        )
    except Exception as exc:
        if required:
            raise RuntimeError(f"Seedream preprocessing failed: {exc}") from exc
        return SeedreamPreparation(
            source_path,
            True,
            False,
            model,
            fallback_reason=f"{type(exc).__name__}: {exc}"[:800],
        )
