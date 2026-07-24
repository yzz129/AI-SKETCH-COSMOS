import base64
import io
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

from dotenv import load_dotenv
from PIL import Image, ImageOps, UnidentifiedImageError


BACKEND_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = BACKEND_ROOT.parent
load_dotenv(BACKEND_ROOT / ".env", override=True)
load_dotenv(PROJECT_ROOT / ".env.local", override=False)

ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
ARK_MODEL = "doubao-seed-2-0-mini-260428"
CONTENT_MODERATION_REJECTED = "CONTENT_MODERATION_REJECTED"
CONTENT_MODERATION_UNAVAILABLE = "CONTENT_MODERATION_UNAVAILABLE"

CHINESE_SENSITIVE_PHRASES = (
    "成人视频",
    "色情视频",
    "色情网站",
    "恐怖袭击",
    "杀人狂",
    "杀人魔",
    "强奸",
    "性侵",
    "乱伦",
    "性虐",
    "裸聊",
    "约炮",
    "援交",
    "卖淫",
    "嫖娼",
    "黄片",
    "黄网",
    "色情",
    "淫秽",
    "虐杀",
    "分尸",
    "碎尸",
    "斩首",
    "屠杀",
    "灭门",
    "爆头",
    "血腥",
)
LATIN_SENSITIVE_PHRASES = ("porn", "porno", "hentai", "rape", "gangbang")

MODERATION_PROMPT = """
你是画作上传的内容安全审核器。只识别下列高风险类别，并只输出一个 JSON 对象：
{
  "decision": "allow" | "block",
  "category": "safe" | "graphic_violence" | "sexual_explicit" | "sexual_minors",
  "confidence": 0.0,
  "reason": "一句简短中文理由"
}

仅在画面有明确证据时拦截：
1. graphic_violence：清晰可见的大量流血、开放性创伤、器官、肢解、断头、严重尸体损伤或以虐杀为主体的血腥场景。
2. sexual_explicit：清晰可见的性行为、性器官特写、色情展示或明显为性刺激而呈现的裸露。
3. sexual_minors：任何涉及未成年人的性化、裸露或性行为内容。

为减少误判，以下应 allow：普通泳装、无性暗示的日常露肤、医学/艺术人体但无露骨性展示、红色颜料/番茄酱、奇幻战斗、持有武器、轻微擦伤、威胁或打斗但没有上述明显血腥伤害。
不要因为题材、颜色或模糊联想拦截。不确定时 decision=allow，confidence 应低于 0.82。
""".strip()


@dataclass(frozen=True)
class ModerationResult:
    allowed: bool
    category: str
    confidence: float
    reason: str = ""


class ContentModerationRejectedError(RuntimeError):
    def __init__(self, result: ModerationResult):
        super().__init__(moderation_message(result.category))
        self.result = result


class ContentModerationUnavailableError(RuntimeError):
    pass


class InvalidArtworkImageError(ValueError):
    pass


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _separated_phrase_pattern(phrase: str) -> str:
    separator = r"[\s._\-·~*]*"
    return separator.join(re.escape(character) for character in phrase)


def mask_sensitive_text(value: str) -> str:
    """Mask explicit phrases without broad single-character matching."""
    masked = value
    for phrase in CHINESE_SENSITIVE_PHRASES:
        masked = re.sub(
            _separated_phrase_pattern(phrase),
            lambda match: "*" * len(match.group(0)),
            masked,
            flags=re.IGNORECASE,
        )
    for phrase in LATIN_SENSITIVE_PHRASES:
        masked = re.sub(
            rf"\b{re.escape(phrase)}\b",
            lambda match: "*" * len(match.group(0)),
            masked,
            flags=re.IGNORECASE,
        )
    return masked


def moderation_message(category: str) -> str:
    if category == "graphic_violence":
        return "检测到图片含有明显血腥或严重暴力内容，请重新上传健康、非血腥的作品。"
    if category in {"sexual_explicit", "sexual_minors"}:
        return "检测到图片含有色情或不适宜内容，请重新上传合适的作品。"
    return "这张图片未通过内容安全检测，请重新上传其他作品。"


def normalise_moderation_result(payload: object, threshold: float = 0.82) -> ModerationResult:
    if not isinstance(payload, dict):
        raise ValueError("moderation response must be an object")

    valid_categories = {"safe", "graphic_violence", "sexual_explicit", "sexual_minors"}
    category = str(payload.get("category", "safe")).strip().lower()
    if category not in valid_categories:
        category = "safe"
    decision = str(payload.get("decision", "allow")).strip().lower()
    try:
        confidence = max(0.0, min(1.0, float(payload.get("confidence", 0.0))))
    except (TypeError, ValueError):
        confidence = 0.0
    reason = str(payload.get("reason", "")).strip()[:240]

    configured_threshold = max(0.5, min(0.99, threshold))
    effective_threshold = min(configured_threshold, 0.65) if category == "sexual_minors" else configured_threshold
    allowed = not (
        decision == "block"
        and category != "safe"
        and confidence >= effective_threshold
    )
    return ModerationResult(
        allowed=allowed,
        category=category,
        confidence=confidence,
        reason=reason,
    )


def _extract_text(value: object) -> str:
    texts: list[str] = []

    def walk(item: object) -> None:
        if isinstance(item, list):
            for child in item:
                walk(child)
            return
        if not isinstance(item, dict):
            return
        if item.get("type") in {"output_text", "text"} and isinstance(item.get("text"), str):
            texts.append(item["text"])
        if isinstance(item.get("output_text"), str):
            texts.append(item["output_text"])
        for child in item.values():
            walk(child)

    walk(value)
    return "\n".join(texts).strip()


def _parse_json(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"```$", "", cleaned).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("moderation response did not contain JSON")
    parsed = json.loads(cleaned[start:end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("moderation response must be an object")
    return parsed


def _response_payload(response: object) -> dict:
    if hasattr(response, "model_dump"):
        payload = response.model_dump()
    elif hasattr(response, "to_dict"):
        payload = response.to_dict()
    else:
        payload = response
    if not isinstance(payload, dict):
        raise ValueError("unsupported Ark response payload")
    return payload


def _image_data_url(file_obj: BinaryIO) -> str:
    original_position = file_obj.tell()
    try:
        file_obj.seek(0)
        with Image.open(file_obj) as opened:
            image = ImageOps.exif_transpose(opened)
            image.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
            if image.mode == "RGBA":
                background = Image.new("RGB", image.size, "white")
                background.paste(image, mask=image.getchannel("A"))
                image = background
            elif image.mode != "RGB":
                image = image.convert("RGB")
            buffer = io.BytesIO()
            image.save(buffer, format="JPEG", quality=86, optimize=True)
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise InvalidArtworkImageError("无法识别这张图片，请重新上传 JPG、PNG 或 WebP 图片。") from exc
    finally:
        file_obj.seek(original_position)

    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:image/jpeg;base64,{encoded}"


def moderate_image_file(file_obj: BinaryIO) -> ModerationResult:
    if not _env_bool("CONTENT_MODERATION_ENABLED", True):
        return ModerationResult(True, "safe", 1.0, "moderation disabled by configuration")

    api_key = os.getenv("ARK_API_KEY", "").strip()
    required = _env_bool("CONTENT_MODERATION_REQUIRED", True)
    if not api_key:
        if not required:
            return ModerationResult(True, "safe", 0.0, "moderation unavailable")
        raise ContentModerationUnavailableError("内容安全检测暂时不可用，请稍后重试。")

    try:
        from volcenginesdkarkruntime import Ark

        client = Ark(
            base_url=os.getenv("ARK_BASE_URL", ARK_BASE_URL),
            api_key=api_key,
            timeout=float(os.getenv("CONTENT_MODERATION_TIMEOUT", "60")),
        )
        response = client.responses.create(
            model=os.getenv("CONTENT_MODERATION_MODEL", ARK_MODEL),
            input=[
                {
                    "role": "user",
                    "content": [
                        {"type": "input_image", "image_url": _image_data_url(file_obj)},
                        {"type": "input_text", "text": MODERATION_PROMPT},
                    ],
                }
            ],
        )
        threshold = float(os.getenv("CONTENT_MODERATION_THRESHOLD", "0.82"))
        result = normalise_moderation_result(
            _parse_json(_extract_text(_response_payload(response))),
            threshold=threshold,
        )
    except InvalidArtworkImageError:
        raise
    except Exception as exc:
        if not required:
            return ModerationResult(True, "safe", 0.0, "moderation unavailable")
        raise ContentModerationUnavailableError("内容安全检测暂时不可用，请稍后重试。") from exc

    if not result.allowed:
        raise ContentModerationRejectedError(result)
    return result
