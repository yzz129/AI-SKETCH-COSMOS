from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from .splat_multiview import build_multiview_splat_rig
from .storage import LEGACY_OUTPUT_ROOT, OUTPUT_ROOT, write_manifest


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def rebuild_existing_rigs(
    *,
    artwork_id: str | None = None,
    force: bool = False,
    dry_run: bool = False,
) -> list[dict[str, Any]]:
    """Upgrade completed rigs from generated-Splat multi-view analysis."""
    if artwork_id:
        canonical = OUTPUT_ROOT / artwork_id
        legacy = LEGACY_OUTPUT_ROOT / artwork_id
        candidates = [canonical if canonical.is_dir() or not legacy.is_dir() else legacy]
    else:
        candidates = sorted(OUTPUT_ROOT.glob("artwork_*"))
        if LEGACY_OUTPUT_ROOT != OUTPUT_ROOT and LEGACY_OUTPUT_ROOT.is_dir():
            known = {candidate.name for candidate in candidates}
            candidates.extend(
                candidate for candidate in sorted(LEGACY_OUTPUT_ROOT.glob("artwork_*")) if candidate.name not in known
            )
    results: list[dict[str, Any]] = []
    for artwork_dir in candidates:
        manifest_path = artwork_dir / "manifest.json"
        splat_path = artwork_dir / "model.splat"
        manifest = _read_json(manifest_path)
        current_rig = _read_json(artwork_dir / "rig.json") or {}
        if manifest is None or not splat_path.is_file():
            results.append({"id": artwork_dir.name, "status": "skipped", "reason": "missing-assets"})
            continue
        if current_rig.get("status") == "processing":
            results.append({"id": artwork_dir.name, "status": "skipped", "reason": "rig-still-processing"})
            continue
        if not force and int(current_rig.get("version") or 0) >= 14:
            results.append({"id": artwork_dir.name, "status": "skipped", "reason": "already-current"})
            continue
        if dry_run:
            results.append({"id": artwork_dir.name, "status": "candidate"})
            continue

        rig = build_multiview_splat_rig(
            splat_path=splat_path,
            artwork_dir=artwork_dir,
            artwork_id=artwork_dir.name,
        )
        if not rig.get("enabled"):
            results.append(
                {
                    "id": artwork_dir.name,
                    "status": "failed",
                    "reason": rig.get("reason"),
                    "detail": rig.get("detail"),
                }
            )
            continue
        manifest["rig"] = rig
        write_manifest(artwork_dir, manifest)
        results.append(
            {
                "id": artwork_dir.name,
                "status": "rebuilt",
                "version": rig.get("version"),
                "bones": len(rig.get("bones") or []),
                "quality": rig.get("quality"),
            }
        )
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild v14 Gaussian weights from generated-model multi-view analysis.")
    parser.add_argument("--artwork-id")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    arguments = parser.parse_args()
    results = rebuild_existing_rigs(
        artwork_id=arguments.artwork_id,
        force=arguments.force,
        dry_run=arguments.dry_run,
    )
    print(json.dumps(results, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
