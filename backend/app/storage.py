import json
import shutil
import uuid
from pathlib import Path
from typing import BinaryIO


OUTPUT_ROOT = Path("outputs").resolve()


def ensure_output_root() -> Path:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    return OUTPUT_ROOT


def create_artwork_dir() -> tuple[str, Path]:
    artwork_id = f"artwork_{uuid.uuid4().hex}"
    artwork_dir = ensure_output_root() / artwork_id
    artwork_dir.mkdir(parents=True, exist_ok=False)
    return artwork_id, artwork_dir


def save_upload(stream: BinaryIO, artwork_dir: Path, filename: str) -> Path:
    suffix = Path(filename).suffix.lower() or ".png"
    source_path = artwork_dir / f"source{suffix}"
    with source_path.open("wb") as target:
        shutil.copyfileobj(stream, target)
    return source_path


def write_manifest(artwork_dir: Path, payload: dict) -> Path:
    manifest_path = artwork_dir / "manifest.json"
    manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest_path


def asset_url(artwork_id: str, filename: str) -> str:
    return f"/assets/{artwork_id}/{filename}"
