from __future__ import annotations

import argparse
import sys
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.ai_model_registry import PROBE_RESULT_PATH, probe_all_models


def main() -> int:
    parser = argparse.ArgumentParser(description="探测火山方舟和腾讯混元的视觉/生图能力。")
    parser.add_argument(
        "--vision-only",
        action="store_true",
        help="只检测识图模型，不触发生图计费。",
    )
    args = parser.parse_args()
    result = probe_all_models(include_generation=not args.vision_only)
    for item in result["results"]:
        state = "可用" if item["available"] else "不可用"
        suffix = "" if item["available"] else f" ({item.get('error', 'unknown')})"
        print(
            f"[{state}] {item['provider']} / {item['capability']} / "
            f"{item['model']} / {item['latencyMs']}ms{suffix}"
        )
    summary = result["summary"]
    print(
        f"合计：{summary['available']} 可用，{summary['unavailable']} 不可用，"
        f"共 {summary['total']} 项。"
    )
    print(f"结果：{PROBE_RESULT_PATH}")
    return 0 if summary["available"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
