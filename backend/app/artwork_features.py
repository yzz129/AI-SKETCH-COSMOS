import json
import re

from .ai_model_registry import VisionCompletion, complete_vision


ARTWORK_FEATURE_PROMPT = """
你是儿童画行为与结构特征识别助手。
请分析上传图片中的主体。不要只输出具体物种名称，也不要根据文件名猜测；只根据图像内容判断结构特征、行为倾向和视觉气质。

请严格输出 JSON，不要 Markdown，不要解释，不要额外字段。格式必须完全符合：
{
  "subjectCategory": "animal | plant | character | abstract | object",
  "morphology": {
    "hasWings": true,
    "wingCount": 0,
    "hasLegs": true,
    "legCount": 0,
    "hasTail": true,
    "hasFins": true,
    "hasArms": true,
    "hasHead": true,
    "bodyOrientation": "horizontal | vertical | floating | undefined",
    "silhouetteComplexity": "simple | medium | complex"
  },
  "behaviorTraits": {
    "locomotionType": "flying | running | hopping | walking | swimming | floating | crawling | swaying | growing | idle",
    "energyLevel": "calm | gentle | active",
    "personalityFeel": "cute | dreamy | playful | gentle | mysterious"
  },
  "visualTraits": {
    "dominantColors": ["#64D9FF", "#FFD166"],
    "brightness": "low | medium | high",
    "softness": "soft | normal | sharp",
    "textureStyle": "handdrawn | watercolor | crayon | flat | mixed"
  },
  "motionParts": ["head", "leftArm", "rightArm", "tail"]
}

约束：
- wingCount 只能是 0、1、2、4。
- legCount 只能是 0、2、4、6、8。
- motionParts 从 head、ears、leftArm、rightArm、arms、leftLeg、rightLeg、legs、tail、wings、fins、body 中选择 1 到 6 个，不能包含图中不存在的部位；不能判断时输出 ["body"]。
- 如果画面主体不清晰，subjectCategory 使用 abstract，locomotionType 使用 floating 或 idle。
- 不要输出 motionPreset，前端会自行映射。
- dominantColors 必须是十六进制颜色字符串数组。
""".strip()


def parse_model_json(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?\s*", "", text.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"```$", "", cleaned).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("AI response did not contain JSON")
    parsed = json.loads(cleaned[start:end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("AI feature response must be an object")
    return parsed


def analyze_artwork_features(image_data_url: str) -> tuple[dict, VisionCompletion]:
    completion = complete_vision(image_data_url, ARTWORK_FEATURE_PROMPT)
    return parse_model_json(completion.text), completion
