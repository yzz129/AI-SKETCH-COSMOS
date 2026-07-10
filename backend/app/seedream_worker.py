import base64
import io
import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from PIL import Image, ImageOps


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
load_dotenv(PROJECT_ROOT / ".env.local", override=False)

DEFAULT_MODEL = "doubao-seedream-4-5-251128"
DEFAULT_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"

FIDELITY_PROMPT = """将输入图片转为3D建模用的单主体参考图。增强立体感、柔和体积和一致光照，使形象饱满突出。

严格保留原始设计：
- 主体轮廓、姿态、朝向、头身比例不变
- 五官、肢体、角、翅膀、尾、鳍、尖刺等数量/位置/形状/大小不变
- 原始纹理、手绘线条、斑点和黑色描边全部保留
- 不增删任何部件，不改变物种

如主体大面积偏白或浅色，赋予适合角色特征的自然颜色（如暖灰、淡棕、浅粉等），避免苍白。
主体居中完整，纯白背景，无场景、道具、文字、边框、水印。"""


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
    api_key_configured = bool(os.getenv("ARK_API_KEY", "").strip())
    try:
        import volcenginesdkarkruntime  # noqa: F401

        sdk_available = True
    except ImportError:
        sdk_available = False

    return {
        "enabled": enabled,
        "ready": not enabled or (api_key_configured and sdk_available),
        "apiKeyConfigured": api_key_configured,
        "sdkAvailable": sdk_available,
        "model": os.getenv("SEEDREAM_MODEL", DEFAULT_MODEL),
        "size": os.getenv("SEEDREAM_SIZE", "2K"),
        "watermark": _env_bool("SEEDREAM_WATERMARK", False),
        "required": _env_bool("SEEDREAM_REQUIRED", True),
        "validationEnabled": _env_bool("SEEDREAM_VALIDATION_ENABLED", True),
        "validationModel": os.getenv("SEEDREAM_VALIDATION_MODEL", "doubao-seed-2-0-lite-260428"),
        "minimumFidelity": float(os.getenv("SEEDREAM_MIN_FIDELITY", "0.85")),
    }


def _image_data_url(image_path: Path) -> str:
    with Image.open(image_path) as opened:
        image = ImageOps.exif_transpose(opened)
        max_size = int(os.getenv("SEEDREAM_INPUT_MAX_SIZE", "2048"))
        image.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)
        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGBA" if "A" in image.getbands() else "RGB")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG", optimize=True)
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


def _extract_response_text(response) -> str:
    direct = getattr(response, "output_text", None)
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    payload = response.model_dump(mode="json") if hasattr(response, "model_dump") else response
    texts: list[str] = []

    def walk(value) -> None:
        if isinstance(value, list):
            for entry in value:
                walk(entry)
            return
        if not isinstance(value, dict):
            return
        text = value.get("text")
        if value.get("type") in {"output_text", "text"} and isinstance(text, str):
            texts.append(text)
        output_text = value.get("output_text")
        if isinstance(output_text, str):
            texts.append(output_text)
        for entry in value.values():
            walk(entry)

    walk(payload)
    return "\n".join(texts).strip()


def _parse_json_object(text: str) -> dict:
    cleaned = text.replace("```json", "").replace("```", "").strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("Seedream fidelity validation did not return JSON.")
    return json.loads(cleaned[start:end + 1])


def _validate_reference_fidelity(client, source_path: Path, reference_path: Path) -> tuple[bool, float, tuple[str, ...]]:
    if not _env_bool("SEEDREAM_VALIDATION_ENABLED", True):
        return True, 1.0, ()

    prompt = """比较图一原始儿童画与图二 3D 建模参考图。只判断主体设计是否被忠实保留。
逐项核对主体类别、轮廓、头身比例、姿态、朝向，以及眼睛、五官、耳朵、角、翅膀、手臂、腿、脚、尾巴、鳍、背刺、装饰物、斑点和色块的数量、位置、形状与颜色。
允许图二增加柔和体积、光照和极轻微透视；不允许增加、删除、复制、错位、合并任何结构或改变手绘纹理身份。
严格输出 JSON，不要 Markdown：
{"preserved": true, "fidelityScore": 0.0, "issues": []}
fidelityScore 范围 0 到 1。存在任何结构增删、数量错误或明显错位时 preserved 必须为 false，并在 issues 中用中文列出。"""
    response = client.responses.create(
        model=os.getenv("SEEDREAM_VALIDATION_MODEL", "doubao-seed-2-0-lite-260428"),
        input=[{
            "role": "user",
            "content": [
                {"type": "input_image", "image_url": _image_data_url(source_path)},
                {"type": "input_image", "image_url": _image_data_url(reference_path)},
                {"type": "input_text", "text": prompt},
            ],
        }],
    )
    result = _parse_json_object(_extract_response_text(response))
    score = max(0.0, min(1.0, float(result.get("fidelityScore", 0))))
    issues = tuple(str(issue)[:240] for issue in result.get("issues", []) if str(issue).strip())
    threshold = float(os.getenv("SEEDREAM_MIN_FIDELITY", "0.85"))
    return bool(result.get("preserved")) and score >= threshold and not issues, score, issues


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

        api_key = os.getenv("ARK_API_KEY", "").strip()
        if not api_key:
            raise RuntimeError("ARK_API_KEY is not configured for the backend process.")

        client = Ark(
            base_url=os.getenv("SEEDREAM_BASE_URL", DEFAULT_BASE_URL),
            api_key=api_key,
        )
        generation_size = os.getenv("SEEDREAM_SIZE", "2K")
        request_params = {
            "model": model,
            "prompt": os.getenv("SEEDREAM_3D_PROMPT", FIDELITY_PROMPT),
            "image": [_image_data_url(source_path)],
            "sequential_image_generation": "disabled",
            "response_format": "url",
            "stream": False,
            "watermark": _env_bool("SEEDREAM_WATERMARK", False),
        }
        try:
            response = client.images.generate(size=generation_size, **request_params)
        except Exception as exc:
            fallback_size = os.getenv("SEEDREAM_FALLBACK_SIZE", "2K")
            size_error = "InvalidParameter" in str(exc) and "size" in str(exc)
            if not size_error or fallback_size == generation_size:
                raise
            generation_size = fallback_size
            response = client.images.generate(size=generation_size, **request_params)
        output_path = artwork_dir / "seedream_reference.png"
        _save_reference(_response_image_bytes(response), output_path)
        preserved, fidelity_score, validation_issues = _validate_reference_fidelity(
            client,
            source_path,
            output_path,
        )
        if not preserved:
            issue_summary = "；".join(validation_issues) or "保真度未达到阈值"
            if required:
                raise RuntimeError(
                    f"Seedream reference failed structural fidelity validation: {issue_summary}"
                )
            return SeedreamPreparation(
                source_path,
                True,
                False,
                model,
                reference_filename=output_path.name,
                fallback_reason="Seedream reference failed structural fidelity validation.",
                fidelity_score=fidelity_score,
                validation_issues=validation_issues,
                generation_size=generation_size,
            )
        return SeedreamPreparation(
            output_path,
            True,
            True,
            model,
            reference_filename=output_path.name,
            fidelity_score=fidelity_score,
            validation_issues=validation_issues,
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
