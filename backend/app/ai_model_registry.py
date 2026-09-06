from __future__ import annotations

import base64
import io
import json
import os
import re
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable
from urllib.request import Request, urlopen

from dotenv import load_dotenv
from PIL import Image, ImageDraw


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
PROBE_RESULT_PATH = BACKEND_ROOT / "data" / "ai-model-probe.json"

load_dotenv(BACKEND_ROOT / ".env", override=True)
load_dotenv(PROJECT_ROOT / ".env.local", override=False)

ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
ARK_VISION_DEFAULTS = (
    "doubao-seed-2-0-pro-260215",
    "doubao-seed-2-0-mini-260428",
    "doubao-seed-2-0-lite-260428",
)
ARK_IMAGE_DEFAULTS = (
    "doubao-seedream-4-5-251128",
    "doubao-seedream-5-0-260128",
    "doubao-seedream-5-0-lite-260128",
    "doubao-seedream-4-0-250828",
)
HUNYUAN_VISION_DEFAULTS = (
    "hunyuan-vision-1.5-instruct",
    "hunyuan-t1-vision-20250916",
    "hunyuan-large-vision",
    "hunyuan-lite-vision",
    "hunyuan-turbos-vision",
    "hunyuan-vision",
)
HUNYUAN_IMAGE_CAPABILITIES = (
    "SubmitHunyuanImageJob",
    "SubmitHunyuanImageChatJob",
    "TextToImageLite",
)

_preferred_models: dict[str, str] = {}
_preferred_lock = threading.Lock()
_image_model_cursor = 0


@dataclass(frozen=True)
class VisionCompletion:
    text: str
    provider: str
    model: str


@dataclass(frozen=True)
class ImageGeneration:
    payload: bytes
    provider: str
    model: str
    size: str


class AIProviderUnavailableError(RuntimeError):
    pass


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _candidate_models(name: str, defaults: Iterable[str], legacy_name: str | None = None) -> tuple[str, ...]:
    configured = os.getenv(name, "").strip()
    values = [item.strip() for item in configured.split(",") if item.strip()]
    if legacy_name:
        legacy = os.getenv(legacy_name, "").strip()
        if legacy:
            values.insert(0, legacy)
    values.extend(defaults)
    return tuple(dict.fromkeys(values))


def ark_vision_models() -> tuple[str, ...]:
    return _candidate_models("ARK_VISION_MODELS", ARK_VISION_DEFAULTS, "CONTENT_MODERATION_MODEL")


def ark_image_models() -> tuple[str, ...]:
    return _candidate_models("ARK_IMAGE_MODELS", ARK_IMAGE_DEFAULTS, "SEEDREAM_MODEL")


def hunyuan_vision_models() -> tuple[str, ...]:
    return _candidate_models("HUNYUAN_VISION_MODELS", HUNYUAN_VISION_DEFAULTS)


def _ordered_models(cache_key: str, models: Iterable[str]) -> tuple[str, ...]:
    candidates = tuple(models)
    with _preferred_lock:
        preferred = _preferred_models.get(cache_key)
    if preferred not in candidates:
        return candidates
    return (preferred, *(model for model in candidates if model != preferred))


def _remember_model(cache_key: str, model: str) -> None:
    with _preferred_lock:
        _preferred_models[cache_key] = model


def _rotating_image_models(models: Iterable[str]) -> tuple[str, ...]:
    """Spread concurrent image jobs across every configured Ark model."""
    global _image_model_cursor
    candidates = tuple(models)
    if len(candidates) < 2:
        return candidates
    with _preferred_lock:
        start = _image_model_cursor % len(candidates)
        _image_model_cursor += 1
    return candidates[start:] + candidates[:start]


def _sdk_available(module_name: str) -> bool:
    try:
        __import__(module_name)
        return True
    except ImportError:
        return False


def _safe_error(exc: Exception) -> str:
    code = None
    getter = getattr(exc, "get_code", None)
    if callable(getter):
        try:
            code = getter()
        except Exception:
            code = None
    if not code:
        match = re.search(
            r"(?:code|Code)[\s\"':=]+([A-Za-z][A-Za-z0-9_.-]+)",
            str(exc),
        )
        code = match.group(1) if match else None
    return f"{type(exc).__name__}{':' + str(code) if code else ''}"[:160]


def _response_payload(response: object) -> dict:
    if hasattr(response, "model_dump"):
        payload = response.model_dump()
    elif hasattr(response, "to_dict"):
        payload = response.to_dict()
    elif hasattr(response, "to_json_string"):
        payload = json.loads(response.to_json_string())
    else:
        payload = response
    if not isinstance(payload, dict):
        raise ValueError("unsupported AI response payload")
    return payload


def extract_response_text(payload: object) -> str:
    if not isinstance(payload, (dict, list)):
        return ""
    if isinstance(payload, dict):
        choices = payload.get("Choices") or payload.get("choices")
        if isinstance(choices, list) and choices:
            first = choices[0]
            if isinstance(first, dict):
                message = first.get("Message") or first.get("message") or first.get("Delta") or first.get("delta")
                if isinstance(message, dict):
                    content = message.get("Content") or message.get("content")
                    if isinstance(content, str) and content.strip():
                        return content.strip()
    texts: list[str] = []

    def walk(item: object) -> None:
        if isinstance(item, list):
            for child in item:
                walk(child)
            return
        if not isinstance(item, dict):
            return
        item_type = item.get("type") or item.get("Type")
        text_value = item.get("text") or item.get("Text")
        if item_type in {"output_text", "text"} and isinstance(text_value, str):
            texts.append(text_value)
        output_text = item.get("output_text")
        if isinstance(output_text, str):
            texts.append(output_text)
        for value in item.values():
            if isinstance(value, (dict, list)):
                walk(value)

    walk(payload)
    return "\n".join(dict.fromkeys(text.strip() for text in texts if text.strip())).strip()


def _ark_vision_completion(model: str, image_data_urls: str | Iterable[str], prompt: str) -> str:
    from volcenginesdkarkruntime import Ark

    api_key = os.getenv("ARK_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Ark API key is not configured")
    client = Ark(
        base_url=os.getenv("ARK_BASE_URL", ARK_BASE_URL),
        api_key=api_key,
        timeout=float(os.getenv("AI_VISION_TIMEOUT", "60")),
    )
    image_urls = [image_data_urls] if isinstance(image_data_urls, str) else list(image_data_urls)
    response = client.responses.create(
        model=model,
        input=[
            {
                "role": "user",
                "content": [
                    *({"type": "input_image", "image_url": url} for url in image_urls),
                    {"type": "input_text", "text": prompt},
                ],
            }
        ],
    )
    text = extract_response_text(_response_payload(response))
    if not text:
        raise RuntimeError("Ark returned no text")
    return text


def _tencent_client():
    from tencentcloud.common import credential
    from tencentcloud.common.profile.client_profile import ClientProfile
    from tencentcloud.common.profile.http_profile import HttpProfile
    from tencentcloud.hunyuan.v20230901 import hunyuan_client

    secret_id = os.getenv("TENCENT_SECRET_ID", "").strip()
    secret_key = os.getenv("TENCENT_SECRET_KEY", "").strip()
    if not secret_id or not secret_key:
        raise RuntimeError("Tencent Cloud credentials are not configured")
    cred = credential.Credential(secret_id, secret_key)
    http_profile = HttpProfile()
    http_profile.endpoint = os.getenv("TENCENT_HUNYUAN_ENDPOINT", "hunyuan.tencentcloudapi.com")
    http_profile.reqTimeout = int(float(os.getenv("AI_VISION_TIMEOUT", "60")))
    client_profile = ClientProfile(httpProfile=http_profile)
    return hunyuan_client.HunyuanClient(
        cred,
        os.getenv("TENCENT_REGION", "ap-guangzhou"),
        client_profile,
    )


def _hunyuan_vision_completion(model: str, image_data_urls: str | Iterable[str], prompt: str) -> str:
    from tencentcloud.hunyuan.v20230901 import models

    request = models.ChatCompletionsRequest()
    image_urls = [image_data_urls] if isinstance(image_data_urls, str) else list(image_data_urls)
    request.from_json_string(json.dumps({
        "Model": model,
        "Messages": [
            {
                "Role": "user",
                "Contents": [
                    *({"Type": "image_url", "ImageUrl": {"Url": url}} for url in image_urls),
                    {"Type": "text", "Text": prompt},
                ],
            }
        ],
        "Stream": False,
    }, ensure_ascii=False))
    response = _tencent_client().ChatCompletions(request)
    text = extract_response_text(_response_payload(response))
    if not text:
        raise RuntimeError("Hunyuan returned no text")
    return text


def complete_vision_images(image_data_urls: Iterable[str], prompt: str) -> VisionCompletion:
    image_urls = tuple(image_data_urls)
    if not image_urls:
        raise ValueError("At least one image is required")
    errors: list[str] = []
    if os.getenv("ARK_API_KEY", "").strip():
        for model in _ordered_models("ark-vision", ark_vision_models()):
            try:
                text = _ark_vision_completion(model, image_urls, prompt)
                _remember_model("ark-vision", model)
                return VisionCompletion(text, "volcano-ark", model)
            except Exception as exc:
                errors.append(f"volcano-ark/{model}={_safe_error(exc)}")

    if os.getenv("TENCENT_SECRET_ID", "").strip() and os.getenv("TENCENT_SECRET_KEY", "").strip():
        for model in _ordered_models("hunyuan-vision", hunyuan_vision_models()):
            try:
                text = _hunyuan_vision_completion(model, image_urls, prompt)
                _remember_model("hunyuan-vision", model)
                return VisionCompletion(text, "tencent-hunyuan", model)
            except Exception as exc:
                errors.append(f"tencent-hunyuan/{model}={_safe_error(exc)}")

    summary = "; ".join(errors[-6:]) if errors else "no configured provider"
    raise AIProviderUnavailableError(f"No vision model is available ({summary})")


def complete_vision(image_data_url: str, prompt: str) -> VisionCompletion:
    return complete_vision_images((image_data_url,), prompt)


def _download_image(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "AI-Sketch-Cosmos/1.0"})
    with urlopen(request, timeout=120) as response:
        payload = response.read(32 * 1024 * 1024 + 1)
    if len(payload) > 32 * 1024 * 1024:
        raise RuntimeError("generated image exceeded 32 MiB")
    return payload


def _ark_image_bytes(response: object) -> bytes:
    data = getattr(response, "data", None)
    if not data:
        payload = _response_payload(response)
        data = payload.get("data") or payload.get("Data")
    if not data:
        raise RuntimeError("Ark returned no image data")
    first = data[0]
    if isinstance(first, dict):
        b64_json = first.get("b64_json") or first.get("B64Json")
        url = first.get("url") or first.get("Url")
    else:
        b64_json = getattr(first, "b64_json", None)
        url = getattr(first, "url", None)
    if b64_json:
        return base64.b64decode(b64_json)
    if url:
        return _download_image(url)
    raise RuntimeError("Ark image response contained neither Base64 nor URL")


def _generate_ark_image(model: str, image_data_url: str, prompt: str, size: str) -> bytes:
    from volcenginesdkarkruntime import Ark

    api_key = os.getenv("SEEDREAM_API_KEY", "").strip() or os.getenv("ARK_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Seedream API key is not configured")
    client = Ark(
        base_url=os.getenv("SEEDREAM_BASE_URL", os.getenv("ARK_BASE_URL", ARK_BASE_URL)),
        api_key=api_key,
        timeout=float(os.getenv("AI_IMAGE_TIMEOUT", "180")),
    )
    params = {
        "model": model,
        "prompt": prompt,
        "image": [image_data_url],
        "response_format": os.getenv("SEEDREAM_RESPONSE_FORMAT", "b64_json"),
        "size": size,
    }
    try:
        response = client.images.generate(**params)
    except Exception as first_error:
        if params["response_format"] != "url" and (
            "response_format" in str(first_error) or "b64_json" in str(first_error)
        ):
            params["response_format"] = "url"
            response = client.images.generate(**params)
        else:
            raise
    return _ark_image_bytes(response)


def _strip_data_url(image_data_url: str) -> str:
    if "," not in image_data_url:
        return image_data_url
    return image_data_url.split(",", 1)[1]


def _generate_hunyuan_image(image_data_url: str, prompt: str) -> bytes:
    from tencentcloud.hunyuan.v20230901 import models

    client = _tencent_client()
    request = models.SubmitHunyuanImageJobRequest()
    request.from_json_string(json.dumps({
        "Prompt": prompt[:1024],
        "NegativePrompt": os.getenv(
            "HUNYUAN_IMAGE_NEGATIVE_PROMPT",
            "文字，水印，底座，多余物体，重复部件，畸形，融化结构",
        ),
        "Num": 1,
        "ContentImage": {"ImageBase64": _strip_data_url(image_data_url)},
        "Revise": 1,
        "LogoAdd": int(os.getenv("HUNYUAN_IMAGE_LOGO_ADD", "0")),
    }, ensure_ascii=False))
    submitted = client.SubmitHunyuanImageJob(request)
    job_id = getattr(submitted, "JobId", None)
    if not job_id:
        raise RuntimeError("Hunyuan image submission returned no job id")

    deadline = time.monotonic() + float(os.getenv("HUNYUAN_IMAGE_TIMEOUT", "300"))
    interval = max(1.0, float(os.getenv("HUNYUAN_IMAGE_POLL_INTERVAL", "2")))
    while time.monotonic() < deadline:
        query = models.QueryHunyuanImageJobRequest()
        query.JobId = job_id
        result = client.QueryHunyuanImageJob(query)
        status = str(getattr(result, "JobStatusCode", ""))
        if status == "5":
            urls = getattr(result, "ResultImage", None) or []
            if not urls:
                raise RuntimeError("Hunyuan image job completed without output")
            return _download_image(urls[0])
        if status == "4":
            code = getattr(result, "JobErrorCode", "FailedOperation")
            raise RuntimeError(f"Hunyuan image job failed ({code})")
        time.sleep(interval)
    raise TimeoutError("Hunyuan image job timed out")


def _generate_hunyuan_lite_image(prompt: str) -> bytes:
    from tencentcloud.hunyuan.v20230901 import models

    request = models.TextToImageLiteRequest()
    request.from_json_string(json.dumps({
        "Prompt": prompt[:256],
        "NegativePrompt": os.getenv(
            "HUNYUAN_IMAGE_NEGATIVE_PROMPT",
            "文字，水印，多余物体，畸形",
        )[:256],
        "Resolution": "768:768",
        "LogoAdd": int(os.getenv("HUNYUAN_IMAGE_LOGO_ADD", "0")),
        "RspImgType": "base64",
    }, ensure_ascii=False))
    response = _tencent_client().TextToImageLite(request)
    result = getattr(response, "ResultImage", None)
    if not result:
        raise RuntimeError("Hunyuan lite image returned no output")
    return base64.b64decode(result)


def _submit_hunyuan_image_chat(prompt: str) -> str:
    from tencentcloud.hunyuan.v20230901 import models

    request = models.SubmitHunyuanImageChatJobRequest()
    request.from_json_string(json.dumps({
        "Prompt": prompt[:1024],
        "LogoAdd": int(os.getenv("HUNYUAN_IMAGE_LOGO_ADD", "0")),
    }, ensure_ascii=False))
    response = _tencent_client().SubmitHunyuanImageChatJob(request)
    job_id = getattr(response, "JobId", None)
    if not job_id:
        raise RuntimeError("Hunyuan image chat returned no job id")
    return str(job_id)


def generate_reference_image(image_data_url: str, prompt: str, size: str = "2K") -> ImageGeneration:
    errors: list[str] = []
    if (os.getenv("SEEDREAM_API_KEY", "").strip() or os.getenv("ARK_API_KEY", "").strip()):
        for model in _rotating_image_models(ark_image_models()):
            try:
                payload = _generate_ark_image(model, image_data_url, prompt, size)
                _remember_model("ark-image", model)
                return ImageGeneration(payload, "volcano-ark", model, size)
            except Exception as exc:
                errors.append(f"volcano-ark/{model}={_safe_error(exc)}")

    if os.getenv("TENCENT_SECRET_ID", "").strip() and os.getenv("TENCENT_SECRET_KEY", "").strip():
        try:
            payload = _generate_hunyuan_image(image_data_url, prompt)
            return ImageGeneration(payload, "tencent-hunyuan", "SubmitHunyuanImageJob", "auto")
        except Exception as exc:
            errors.append(f"tencent-hunyuan/SubmitHunyuanImageJob={_safe_error(exc)}")

    summary = "; ".join(errors[-6:]) if errors else "no configured provider"
    raise AIProviderUnavailableError(f"No image generation model is available ({summary})")


def _load_probe_result() -> dict | None:
    try:
        payload = json.loads(PROBE_RESULT_PATH.read_text(encoding="utf-8"))
        return payload if isinstance(payload, dict) else None
    except (OSError, ValueError):
        return None


def ai_model_status() -> dict:
    ark_key = bool(os.getenv("ARK_API_KEY", "").strip())
    seedream_key = bool(os.getenv("SEEDREAM_API_KEY", "").strip() or ark_key)
    tencent_credentials = bool(
        os.getenv("TENCENT_SECRET_ID", "").strip()
        and os.getenv("TENCENT_SECRET_KEY", "").strip()
    )
    ark_sdk = _sdk_available("volcenginesdkarkruntime")
    tencent_sdk = _sdk_available("tencentcloud")
    return {
        "ready": (ark_key and ark_sdk) or (tencent_credentials and tencent_sdk),
        "vision": [
            {
                "provider": "volcano-ark",
                "configured": ark_key,
                "sdkAvailable": ark_sdk,
                "models": list(ark_vision_models()),
            },
            {
                "provider": "tencent-hunyuan",
                "configured": tencent_credentials,
                "sdkAvailable": tencent_sdk,
                "models": list(hunyuan_vision_models()),
            },
        ],
        "imageGeneration": [
            {
                "provider": "volcano-ark",
                "configured": seedream_key,
                "sdkAvailable": ark_sdk,
                "models": list(ark_image_models()),
            },
            {
                "provider": "tencent-hunyuan",
                "configured": tencent_credentials,
                "sdkAvailable": tencent_sdk,
                "models": list(HUNYUAN_IMAGE_CAPABILITIES),
                "referenceImageCapability": "SubmitHunyuanImageJob",
            },
        ],
        "lastProbe": _load_probe_result(),
    }


def _probe_image_data_url() -> str:
    image = Image.new("RGB", (512, 512), "white")
    draw = ImageDraw.Draw(image)
    draw.ellipse((120, 100, 392, 372), fill="#62C4F2", outline="#2B4C7E", width=12)
    draw.ellipse((180, 180, 220, 220), fill="#1D3557")
    draw.ellipse((292, 180, 332, 220), fill="#1D3557")
    draw.arc((190, 210, 322, 305), 10, 170, fill="#1D3557", width=10)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=88)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _timed_probe(provider: str, capability: str, model: str, callback: Callable[[], object]) -> dict:
    started = time.perf_counter()
    try:
        callback()
        return {
            "provider": provider,
            "capability": capability,
            "model": model,
            "available": True,
            "latencyMs": round((time.perf_counter() - started) * 1000),
        }
    except Exception as exc:
        return {
            "provider": provider,
            "capability": capability,
            "model": model,
            "available": False,
            "latencyMs": round((time.perf_counter() - started) * 1000),
            "error": _safe_error(exc),
        }


def probe_all_models(include_generation: bool = True) -> dict:
    image_data_url = _probe_image_data_url()
    prompt = "只回答 OK，用于模型连通性检测。"
    results: list[dict] = []

    if os.getenv("ARK_API_KEY", "").strip():
        for model in ark_vision_models():
            results.append(_timed_probe(
                "volcano-ark",
                "vision",
                model,
                lambda model=model: _ark_vision_completion(model, image_data_url, prompt),
            ))

    if os.getenv("TENCENT_SECRET_ID", "").strip() and os.getenv("TENCENT_SECRET_KEY", "").strip():
        for model in hunyuan_vision_models():
            results.append(_timed_probe(
                "tencent-hunyuan",
                "vision",
                model,
                lambda model=model: _hunyuan_vision_completion(model, image_data_url, prompt),
            ))

    if include_generation:
        generation_prompt = "圆润的蓝色微笑玩具，白色背景，单主体，无文字。"
        if os.getenv("SEEDREAM_API_KEY", "").strip() or os.getenv("ARK_API_KEY", "").strip():
            for model in ark_image_models():
                results.append(_timed_probe(
                    "volcano-ark",
                    "image-generation",
                    model,
                    lambda model=model: _generate_ark_image(model, image_data_url, generation_prompt, "2K"),
                ))
        if os.getenv("TENCENT_SECRET_ID", "").strip() and os.getenv("TENCENT_SECRET_KEY", "").strip():
            results.append(_timed_probe(
                "tencent-hunyuan",
                "image-generation",
                "SubmitHunyuanImageJob",
                lambda: _generate_hunyuan_image(image_data_url, generation_prompt),
            ))
            results.append(_timed_probe(
                "tencent-hunyuan",
                "image-generation-chat",
                "SubmitHunyuanImageChatJob",
                lambda: _submit_hunyuan_image_chat(generation_prompt),
            ))
            results.append(_timed_probe(
                "tencent-hunyuan",
                "image-generation-lite",
                "TextToImageLite",
                lambda: _generate_hunyuan_lite_image(generation_prompt),
            ))

    payload = {
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "includeGeneration": include_generation,
        "summary": {
            "available": sum(1 for result in results if result["available"]),
            "unavailable": sum(1 for result in results if not result["available"]),
            "total": len(results),
        },
        "results": results,
    }
    PROBE_RESULT_PATH.parent.mkdir(parents=True, exist_ok=True)
    PROBE_RESULT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return payload
