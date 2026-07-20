import json
import os
import shutil
import time
import uuid
from pathlib import Path
from typing import BinaryIO


BACKEND_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = (BACKEND_ROOT / "outputs").resolve()
LEGACY_OUTPUT_ROOT = (BACKEND_ROOT.parent / "outputs").resolve()


def output_roots() -> tuple[Path, ...]:
    """Return asset roots in priority order, including the old cwd-relative location."""
    roots = [OUTPUT_ROOT]
    if LEGACY_OUTPUT_ROOT != OUTPUT_ROOT and LEGACY_OUTPUT_ROOT.is_dir():
        roots.append(LEGACY_OUTPUT_ROOT)
    return tuple(roots)


def ensure_output_root() -> Path:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    return OUTPUT_ROOT


def create_artwork_dir() -> tuple[str, Path]:
    artwork_id = f"artwork_{uuid.uuid4().hex}"
    artwork_dir = ensure_output_root() / artwork_id
    artwork_dir.mkdir(parents=True, exist_ok=False)
    return artwork_id, artwork_dir


def save_upload(
    stream: BinaryIO,
    artwork_dir: Path,
    filename: str,
    *,
    max_bytes: int | None = None,
) -> Path:
    suffix = Path(filename).suffix.lower() or ".png"
    source_path = artwork_dir / f"source{suffix}"
    written = 0
    try:
        with source_path.open("wb") as target:
            while chunk := stream.read(1024 * 1024):
                written += len(chunk)
                if max_bytes is not None and written > max_bytes:
                    raise UploadTooLargeError(f"upload exceeds {max_bytes} bytes")
                target.write(chunk)
    except Exception:
        source_path.unlink(missing_ok=True)
        raise
    return source_path


def write_json_atomic(path: Path, payload: dict) -> Path:
    """Publish JSON without exposing a partially-written file to pollers."""
    temporary = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    for attempt in range(8):
        try:
            os.replace(temporary, path)
            break
        except PermissionError:
            if attempt == 7:
                temporary.unlink(missing_ok=True)
                raise
            # Windows static-file readers can briefly hold a deny-write handle
            # while the frontend polls rig.json. Keep atomic publication and
            # retry the rename instead of falling back to an in-place write.
            time.sleep(min(0.025 * (2**attempt), 0.3))
    return path


def write_manifest(artwork_dir: Path, payload: dict) -> Path:
    return write_json_atomic(artwork_dir / "manifest.json", payload)


def asset_url(artwork_id: str, filename: str) -> str:
    return f"/assets/{artwork_id}/{filename}"


class UploadTooLargeError(ValueError):
    pass
