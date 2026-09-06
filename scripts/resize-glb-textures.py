"""Create display-friendly GLB copies without changing the original assets.

The Hunyuan exports contain three 4096px PBR textures per model. That is more
than the starfield needs at 1080p and loading all exhibits at once can exhaust
WebGL memory. This utility keeps geometry and material assignments intact,
downscales embedded images to a bounded maximum dimension, and preserves the
original GLB files outside the website's public directory.
"""

from __future__ import annotations

import json
import struct
import sys
from pathlib import Path

from PIL import Image


GLB_HEADER = struct.Struct("<4sII")
GLB_CHUNK = struct.Struct("<II")
JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def pad4(data: bytes, fill: bytes = b" ") -> bytes:
    return data + fill * ((4 - len(data) % 4) % 4)


def resize_image(data: bytes, max_dimension: int) -> bytes | None:
    try:
        from io import BytesIO

        with Image.open(BytesIO(data)) as image:
            if max(image.size) <= max_dimension:
                return None
            image.load()
            image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
            output = BytesIO()
            # PNG keeps the original material appearance and alpha channel.
            image.save(output, format="PNG", optimize=True)
            return output.getvalue()
    except Exception as error:  # noqa: BLE001 - leave an individual texture untouched
        print(f"skip texture: {error}", file=sys.stderr)
        return None


def optimize_glb(source: Path, destination: Path, max_dimension: int = 2048) -> tuple[int, int]:
    raw = source.read_bytes()
    magic, version, declared_length = GLB_HEADER.unpack_from(raw, 0)
    if magic != b"glTF" or version != 2:
        raise ValueError(f"unsupported GLB: {source}")
    cursor = GLB_HEADER.size
    json_bytes = None
    bin_bytes = b""
    while cursor < declared_length:
        chunk_length, chunk_type = GLB_CHUNK.unpack_from(raw, cursor)
        cursor += GLB_CHUNK.size
        chunk = raw[cursor : cursor + chunk_length]
        cursor += chunk_length
        if chunk_type == JSON_CHUNK:
            json_bytes = chunk.rstrip(b" \t\r\n\x00")
        elif chunk_type == BIN_CHUNK:
            bin_bytes = chunk
    if json_bytes is None:
        raise ValueError(f"missing JSON chunk: {source}")

    document = json.loads(json_bytes.decode("utf-8"))
    views = document.get("bufferViews", [])
    images = document.get("images", [])
    image_view_by_index = {
        int(image["bufferView"]): image
        for image in images
        if "bufferView" in image
    }
    updated = 0
    saved_bytes = 0
    compact_bin = bytearray()
    for view_index, view in enumerate(views):
        old_start = int(view.get("byteOffset", 0))
        old_length = int(view.get("byteLength", 0))
        view_data = bytes(bin_bytes[old_start : old_start + old_length])
        image = image_view_by_index.get(view_index)
        if image is not None:
            resized = resize_image(view_data, max_dimension)
            if resized and len(resized) <= old_length:
                saved_bytes += old_length - len(resized)
                view_data = resized
                image["mimeType"] = "image/png"
                updated += 1

        # Buffer views are 4-byte aligned in a GLB. Repacking them removes the
        # unused tail left by a downscaled embedded image, reducing both the
        # first-load network cost and the browser's ArrayBuffer footprint.
        padding = (-len(compact_bin)) % 4
        if padding:
            compact_bin.extend(b"\x00" * padding)
        view["byteOffset"] = len(compact_bin)
        view["byteLength"] = len(view_data)
        compact_bin.extend(view_data)

    encoded_bin = pad4(bytes(compact_bin), fill=b"\x00")
    # Keep the glTF buffer declaration in sync with the compacted BIN chunk.
    # Some loaders tolerate the stale value, but strict GLB validators do not.
    buffers = document.get("buffers", [])
    if buffers:
        buffers[0]["byteLength"] = len(encoded_bin)
    encoded_json = pad4(json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    total_length = GLB_HEADER.size + GLB_CHUNK.size + len(encoded_json) + GLB_CHUNK.size + len(encoded_bin)
    output = bytearray(GLB_HEADER.pack(b"glTF", 2, total_length))
    output += GLB_CHUNK.pack(len(encoded_json), JSON_CHUNK) + encoded_json
    output += GLB_CHUNK.pack(len(encoded_bin), BIN_CHUNK) + encoded_bin
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(output)
    return updated, saved_bytes


def main() -> None:
    if len(sys.argv) not in {3, 4}:
        raise SystemExit("usage: resize-glb-textures.py <input-dir> <output-dir> [max-dimension]")
    source_dir = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    max_dimension = int(sys.argv[3]) if len(sys.argv) == 4 else 2048
    for source in sorted(source_dir.glob("award-*.glb")):
        destination = output_dir / source.name
        updated, saved = optimize_glb(source, destination, max_dimension)
        print(f"{source.name}: textures={updated}, saved={saved / 1024 / 1024:.1f} MB")


if __name__ == "__main__":
    main()
