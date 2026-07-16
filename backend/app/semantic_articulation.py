from __future__ import annotations

import base64
import io
import json
import os
import re
from concurrent.futures import Future, ThreadPoolExecutor
from copy import deepcopy
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from PIL import Image, ImageDraw, ImageOps


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(REPOSITORY_ROOT / ".env.local", override=False)
load_dotenv(BACKEND_ROOT / ".env", override=False)

ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3"
ARK_MODEL = "doubao-seed-2-0-mini-260428"
ALLOWED_KINDS = {"arm", "leg", "wing", "fin", "tail", "ear", "head"}
ALLOWED_SIDES = {"left", "right", "center"}
MIN_REGION_CONFIDENCE = 0.72
_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="articulation-vision")


ARTICULATION_PROMPT = """分析图中唯一主体，为单一完整高斯模型的三维骨骼蒙皮精确定位关节和可运动部位。

输出严格 JSON，不要 Markdown、解释或额外字段。所有坐标均为整张图宽高归一化到 0..1：
{
  "subjectBounds": [left, top, right, bottom],
  "view": "front | threeQuarterLeft | threeQuarterRight | side | back",
  "regions": [
    {
      "id": "left-arm-1",
      "kind": "arm | leg | wing | fin | tail | ear | head",
      "side": "left | right | center",
      "confidence": 0.95,
      "root": [0.2, 0.4],
      "tip": [0.08, 0.24],
      "polygon": [[0.1,0.2],[0.2,0.2],[0.22,0.35],[0.18,0.45],[0.1,0.4],[0.08,0.3]]
    }
  ]
}

必须遵守：
1. subjectBounds 紧贴完整主体的可见外轮廓，不包含阴影和背景。
2. 每个独立部位单独一项；同侧存在多个手臂、腿、翅膀或鱼鳍时必须分别列出，id 必须唯一。
3. side 使用主体自身的解剖左右。主体正视观众时，画面左侧通常是主体的 right，不能按观众左右标反。
4. polygon 使用 6 到 20 个点紧贴该部位的完整外轮廓。只包含该部位，不能包含大块躯干、胸腹、头部、阴影或背景。
5. 在连接处，polygon 仅向父级内部多覆盖约该部位长度的 3% 到 5%；子部位轮廓不能大面积覆盖父级，耳朵轮廓不能覆盖整块头部，手臂轮廓不能覆盖胸腹。
6. root 必须落在 polygon 朝向父级的内侧边界线上，是部位与父级连接面的中心；严禁把 root 放在手掌、脚掌、耳朵、鱼鳍或尾巴自身中心。tip 是该部位离 root 最远的末端中心。
7. 不要把整块上半身或下半身误认为手臂或腿。只列出边界清晰且 confidence >= 0.72 的部位。
8. 头部只有在颈部连接边界明确、可作为整体转动时才列出；head 的 root 必须位于颈部连接面，不能放在嘴、鼻子或脸中心。
9. root 到 tip 的方向必须沿部位骨轴：手臂为肩到手，腿为髋到脚，翅膀/鱼鳍为根部到尖端，尾巴为尾根到尾尖。"""


MULTIVIEW_ARTICULATION_PROMPT = """以下图片是同一个三维主体的不同视角，图片顺序和 VIEW_ID 已给出。请跨视角一致地识别完整可运动部位。

只输出严格 JSON：
{"views":[{"name":"VIEW_ID","subjectBounds":[l,t,r,b],"regions":[{"id":"left-arm-1","kind":"arm|leg|wing|fin|tail|ear|head","side":"left|right|center","confidence":0.95,"root":[x,y],"tip":[x,y],"polygon":[[x,y],...] }]}]}

规则：
1. 坐标均按各自图片宽高归一化到 0..1；每个输入 VIEW_ID 必须且只能返回一次。
2. 同一解剖部位在所有视角使用相同 id、kind 和主体自身的左右 side；正视图画面左侧通常是主体右侧。
3. polygon 用 6 到 12 个点紧贴完整部位，只覆盖连接处内侧约部位长度的 3% 到 5%，不得包含大块躯干、头部、阴影或背景。
4. root 是部位与父级连接面的中心，tip 是沿骨轴最远端；手臂必须从肩到手、腿从髋到脚、尾巴从尾根到尾尖。
5. 不要把上半身、下半身、脸或装饰误判为肢体；仅返回 confidence >= 0.72 的部位。
6. 头部仅在颈部连接明确时返回；耳朵不能覆盖整块头部。被遮挡的部位不要凭空补轮廓。"""


def _image_data_url(image_path: Path) -> str:
    with Image.open(image_path) as opened:
        image = ImageOps.exif_transpose(opened)
        image.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
        if image.mode == "RGBA":
            background = Image.new("RGB", image.size, "white")
            background.paste(image, mask=image.getchannel("A"))
            image = background
        elif image.mode != "RGB":
            image = image.convert("RGB")
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=90, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _extract_text(payload: Any) -> str:
    texts: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, list):
            for entry in value:
                walk(entry)
            return
        if not isinstance(value, dict):
            return
        if value.get("type") in {"output_text", "text"} and isinstance(value.get("text"), str):
            texts.append(value["text"])
        if isinstance(value.get("output_text"), str):
            texts.append(value["output_text"])
        for entry in value.values():
            walk(entry)

    walk(payload)
    return "\n".join(dict.fromkeys(texts)).strip()


def _response_payload(response: Any) -> dict[str, Any]:
    if hasattr(response, "model_dump"):
        payload = response.model_dump()
    elif hasattr(response, "to_dict"):
        payload = response.to_dict()
    elif isinstance(response, dict):
        payload = response
    else:
        payload = json.loads(str(response))
    if not isinstance(payload, dict):
        raise RuntimeError("Articulation response payload was not an object.")
    return payload


def _usage_summary(payload: dict[str, Any]) -> dict[str, int]:
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        return {}

    def token_value(*names: str) -> int:
        for name in names:
            value = usage.get(name)
            if isinstance(value, (int, float)):
                return max(0, int(value))
        return 0

    input_tokens = token_value("input_tokens", "prompt_tokens")
    output_tokens = token_value("output_tokens", "completion_tokens")
    total_tokens = token_value("total_tokens") or input_tokens + output_tokens
    return {
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "totalTokens": total_tokens,
    }


def _parse_json(text: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"```\s*$", "", cleaned).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("Articulation response did not contain JSON.")
    parsed = json.loads(cleaned[start : end + 1])
    if not isinstance(parsed, dict):
        raise RuntimeError("Articulation response was not an object.")
    return parsed


def _point(value: Any) -> list[float] | None:
    if not isinstance(value, list) or len(value) != 2:
        return None
    if not all(isinstance(item, (int, float)) for item in value):
        return None
    return [round(max(0.0, min(1.0, float(item))), 5) for item in value]


def _normalise_articulation(raw: dict[str, Any]) -> dict[str, Any]:
    bounds = raw.get("subjectBounds")
    if not isinstance(bounds, list) or len(bounds) != 4 or not all(isinstance(v, (int, float)) for v in bounds):
        raise RuntimeError("Articulation response omitted subjectBounds.")
    left, top, right, bottom = [max(0.0, min(1.0, float(v))) for v in bounds]
    if right - left < 0.1 or bottom - top < 0.1:
        raise RuntimeError("Articulation subjectBounds were invalid.")

    regions: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for index, raw_region in enumerate(raw.get("regions") or []):
        if not isinstance(raw_region, dict):
            continue
        kind = str(raw_region.get("kind") or "").lower()
        side = str(raw_region.get("side") or "center").lower()
        confidence = float(raw_region.get("confidence") or 0)
        root = _point(raw_region.get("root"))
        tip = _point(raw_region.get("tip"))
        polygon = [_point(value) for value in raw_region.get("polygon") or []]
        polygon = [value for value in polygon if value is not None]
        if kind not in ALLOWED_KINDS or side not in ALLOWED_SIDES:
            continue
        if confidence < MIN_REGION_CONFIDENCE or root is None or len(polygon) < 6:
            continue
        if tip is None:
            tip = max(polygon, key=lambda point: (point[0] - root[0]) ** 2 + (point[1] - root[1]) ** 2)
        raw_id = re.sub(r"[^a-z0-9-]+", "-", str(raw_region.get("id") or "").lower()).strip("-")
        region_id = raw_id or f"{side}-{kind}-{index + 1}"
        suffix = 2
        unique_id = region_id
        while unique_id in used_ids:
            unique_id = f"{region_id}-{suffix}"
            suffix += 1
        used_ids.add(unique_id)
        regions.append(
            {
                "id": unique_id,
                "kind": kind,
                "side": side,
                "confidence": round(confidence, 4),
                "root": root,
                "tip": tip,
                "polygon": polygon[:20],
            }
        )

    if not regions:
        raise RuntimeError("Articulation response contained no confident regions.")
    return {
        "version": 2,
        "coordinateSpace": "source-image-normalized",
        "leftRightConvention": "subject-anatomical",
        "subjectBounds": [round(left, 5), round(top, 5), round(right, 5), round(bottom, 5)],
        "view": str(raw.get("view") or "front"),
        "regions": regions,
    }


def _normalise_multiview_articulation(
    raw: dict[str, Any],
    expected_names: list[str],
) -> dict[str, dict[str, Any]]:
    raw_views = raw.get("views")
    if not isinstance(raw_views, list):
        raise RuntimeError("Multi-view articulation response omitted views.")
    expected = set(expected_names)
    normalised: dict[str, dict[str, Any]] = {}
    for raw_view in raw_views:
        if not isinstance(raw_view, dict):
            continue
        name = str(raw_view.get("name") or "").strip().lower()
        if name not in expected or name in normalised:
            continue
        view = _normalise_articulation(raw_view)
        view["view"] = name
        normalised[name] = view
    if not normalised:
        raise RuntimeError("Multi-view articulation response contained no requested views.")
    return normalised


def _save_debug_overlay(image_path: Path, output_dir: Path, articulation: dict[str, Any]) -> None:
    with Image.open(image_path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    draw = ImageDraw.Draw(image, "RGBA")
    width, height = image.size
    colors = {
        "arm": (51, 204, 255, 90),
        "leg": (255, 193, 7, 90),
        "wing": (177, 102, 255, 90),
        "fin": (47, 224, 160, 90),
        "tail": (255, 112, 166, 90),
        "ear": (255, 128, 80, 90),
        "head": (130, 160, 255, 72),
    }
    for region in articulation["regions"]:
        points = [(int(point[0] * width), int(point[1] * height)) for point in region["polygon"]]
        color = colors[region["kind"]]
        draw.polygon(points, fill=color, outline=(*color[:3], 235), width=max(2, width // 700))
        root_x = int(region["root"][0] * width)
        root_y = int(region["root"][1] * height)
        radius = max(4, width // 220)
        draw.ellipse((root_x - radius, root_y - radius, root_x + radius, root_y + radius), fill=(255, 40, 40, 245))
    image.thumbnail((1400, 1400), Image.Resampling.LANCZOS)
    image.save(output_dir / "rig-segmentation-preview.webp", format="WEBP", quality=90, method=4)


def analyse_articulation_regions(image_path: Path, output_dir: Path) -> dict[str, Any]:
    api_key = os.getenv("ARK_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ARK_API_KEY is not configured for articulation analysis.")
    from volcenginesdkarkruntime import Ark

    client = Ark(
        base_url=os.getenv("ARK_BASE_URL", ARK_BASE_URL),
        api_key=api_key,
        timeout=float(os.getenv("ARK_ARTICULATION_TIMEOUT", "120")),
    )
    response = client.responses.create(
        model=os.getenv("ARK_ARTICULATION_MODEL", ARK_MODEL),
        input=[
            {
                "role": "user",
                "content": [
                    {"type": "input_image", "image_url": _image_data_url(image_path)},
                    {"type": "input_text", "text": ARTICULATION_PROMPT},
                ],
            }
        ],
    )
    response_payload = _response_payload(response)
    articulation = _normalise_articulation(_parse_json(_extract_text(response_payload)))
    articulation["sourceImage"] = image_path.name
    articulation["usage"] = _usage_summary(response_payload)
    _save_debug_overlay(image_path, output_dir, articulation)
    return articulation


def analyse_articulation_multiview_regions(
    views: list[tuple[str, Path, Path]],
) -> dict[str, Any]:
    """Analyse several labelled renders in one Ark request.

    Combining views removes repeated prompt tokens and, more importantly,
    changes six network/model round trips into one adaptive batch while still
    preserving per-view masks for the 3D visibility fusion stage.
    """
    if not views:
        raise ValueError("At least one articulation view is required.")
    api_key = os.getenv("ARK_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("ARK_API_KEY is not configured for articulation analysis.")
    from volcenginesdkarkruntime import Ark

    names = [name for name, _, _ in views]
    if len(names) != len(set(names)):
        raise ValueError("Articulation VIEW_ID values must be unique.")
    order = ", ".join(names)
    content: list[dict[str, str]] = [
        {
            "type": "input_text",
            "text": f"VIEW_ID 顺序：{order}\n{MULTIVIEW_ARTICULATION_PROMPT}",
        }
    ]
    content.extend(
        {"type": "input_image", "image_url": _image_data_url(image_path)}
        for _, image_path, _ in views
    )
    client = Ark(
        base_url=os.getenv("ARK_BASE_URL", ARK_BASE_URL),
        api_key=api_key,
        timeout=float(os.getenv("ARK_MULTIVIEW_TIMEOUT", os.getenv("ARK_ARTICULATION_TIMEOUT", "180"))),
    )
    response = client.responses.create(
        model=os.getenv("ARK_ARTICULATION_MODEL", ARK_MODEL),
        input=[{"role": "user", "content": content}],
        max_output_tokens=max(1200, int(os.getenv("ARK_MULTIVIEW_MAX_OUTPUT_TOKENS", "5000"))),
    )
    payload = _response_payload(response)
    articulations = _normalise_multiview_articulation(
        _parse_json(_extract_text(payload)),
        names,
    )
    for name, image_path, output_dir in views:
        articulation = articulations.get(name)
        if articulation is None:
            continue
        articulation["sourceImage"] = image_path.name
        _save_debug_overlay(image_path, output_dir, articulation)
    return {
        "articulations": articulations,
        "usage": _usage_summary(payload),
        "viewCount": len(views),
        "promptCharacters": len(MULTIVIEW_ARTICULATION_PROMPT),
    }


def start_articulation_analysis(
    image_path: Path,
    output_dir: Path,
    features: dict[str, Any] | None,
) -> Future[dict[str, Any]] | None:
    # Vision only supplies joint seeds and silhouettes. The production path
    # fits a 3D proxy cage and generates smooth GPU skinning weights; it never
    # cuts the reconstructed Gaussian field into independent objects.
    if not features or os.getenv("SPLAT_GPU_SKINNING_ENABLED", "true").lower() not in {"1", "true", "yes", "on"}:
        return None

    def work() -> dict[str, Any]:
        enriched = deepcopy(features)
        enriched["articulation"] = analyse_articulation_regions(image_path, output_dir)
        return enriched

    return _EXECUTOR.submit(work)


def resolve_articulation_analysis(
    future: Future[dict[str, Any]] | None,
    fallback: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if future is None:
        return fallback
    try:
        return future.result(timeout=float(os.getenv("ARK_ARTICULATION_RESOLVE_TIMEOUT", "150")))
    except Exception as exc:
        enriched = deepcopy(fallback) if fallback else {}
        enriched["articulationError"] = f"{type(exc).__name__}: {exc}"[:800]
        return enriched
