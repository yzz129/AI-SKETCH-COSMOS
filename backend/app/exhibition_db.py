"""Persistence for the permanent star-galaxy exhibition models.

These records are intentionally separate from ``artworks`` so they never
inherit artwork levels, victories, queue rotation, or evolution state.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_ROOT / "data"
DB_PATH = DATA_DIR / "cosmos.db"
SEED_PATH = DATA_DIR / "exhibition_models_seed.json"
_SCHEMA_LOCK = Lock()
_SCHEMA_READY = False
_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,79}$")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    global _SCHEMA_READY
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    timeout = max(1, int(os.getenv("COSMOS_DB_BUSY_TIMEOUT_SECONDS", "30")))
    conn = sqlite3.connect(DB_PATH, timeout=timeout)
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout={timeout * 1000}")
    conn.execute("PRAGMA synchronous=NORMAL")
    if not _SCHEMA_READY:
        with _SCHEMA_LOCK:
            if not _SCHEMA_READY:
                conn.execute("PRAGMA journal_mode=WAL")
                conn.execute(
                    """
                    CREATE TABLE IF NOT EXISTS exhibition_models (
                        id TEXT PRIMARY KEY,
                        name TEXT NOT NULL,
                        model_url TEXT NOT NULL,
                        preview_url TEXT,
                        color TEXT NOT NULL DEFAULT '#7ee7ff',
                        position_x REAL NOT NULL DEFAULT 0,
                        position_y REAL NOT NULL DEFAULT 0,
                        position_z REAL NOT NULL DEFAULT 0,
                        scale REAL NOT NULL DEFAULT 0.55,
                        source_folder TEXT,
                        source_image TEXT,
                        reference_mode TEXT NOT NULL DEFAULT 'single',
                        entry_type TEXT NOT NULL DEFAULT 'award',
                        always_floating INTEGER NOT NULL DEFAULT 1,
                        participates_in_level INTEGER NOT NULL DEFAULT 0,
                        is_deleted INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                columns = {row["name"] for row in conn.execute("PRAGMA table_info(exhibition_models)").fetchall()}
                if "entry_type" not in columns:
                    conn.execute("ALTER TABLE exhibition_models ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'award'")
                conn.execute(
                    "UPDATE exhibition_models SET entry_type='contest' "
                    "WHERE source_folder='设计师生成' OR id LIKE 'designer-%'"
                )
                conn.execute("CREATE INDEX IF NOT EXISTS idx_exhibition_deleted_updated ON exhibition_models(is_deleted, updated_at DESC)")
                conn.commit()
                _SCHEMA_READY = True
    return conn


def _validate_id(value: str) -> str:
    cleaned = value.strip().lower()
    if not _ID_PATTERN.fullmatch(cleaned):
        raise ValueError("展品 id 只能包含小写字母、数字、短横线和下划线")
    return cleaned


def _normalise_name(value: str) -> str:
    cleaned = " ".join(value.split()).strip()
    if not cleaned:
        raise ValueError("展品名称不能为空")
    return cleaned[:64]


def _normalise_color(value: str) -> str:
    cleaned = value.strip()
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", cleaned):
        raise ValueError("展品颜色必须是 6 位十六进制颜色")
    return cleaned.lower()


def _row_to_record(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "modelUrl": row["model_url"],
        "previewUrl": row["preview_url"],
        "color": row["color"],
        "position": [row["position_x"], row["position_y"], row["position_z"]],
        "scale": row["scale"],
        "sourceFolder": row["source_folder"],
        "sourceImage": row["source_image"],
        "referenceMode": row["reference_mode"],
        "entryType": row["entry_type"] if "entry_type" in row.keys() else "award",
        "alwaysFloating": bool(row["always_floating"]),
        "participatesInLevel": bool(row["participates_in_level"]),
        "isDeleted": bool(row["is_deleted"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def ensure_exhibition_schema() -> None:
    with _connect() as conn:
        pass


def seed_exhibition_models() -> int:
    if not SEED_PATH.is_file():
        return 0
    try:
        payload = json.loads(SEED_PATH.read_text(encoding="utf-8-sig"))
        records = payload.get("items", payload) if isinstance(payload, dict) else payload
        if not isinstance(records, list):
            return 0
    except (OSError, json.JSONDecodeError):
        return 0

    inserted = 0
    with _connect() as conn:
        for raw in records:
            if not isinstance(raw, dict):
                continue
            try:
                item_id = _validate_id(str(raw.get("id", "")))
                name = _normalise_name(str(raw.get("name", "")))
                model_url = str(raw.get("modelUrl", raw.get("modelFile", ""))).strip()
                if not model_url:
                    continue
                position = raw.get("position") or [0, 0, 0]
                if not isinstance(position, list) or len(position) != 3:
                    position = [0, 0, 0]
                now = _now_iso()
                cursor = conn.execute(
                    """
                    INSERT OR IGNORE INTO exhibition_models (
                        id, name, model_url, preview_url, color,
                        position_x, position_y, position_z, scale,
                        source_folder, source_image, reference_mode, entry_type,
                        always_floating, participates_in_level,
                        is_deleted, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)
                    """,
                    (
                        item_id,
                        name,
                        model_url,
                        raw.get("previewUrl"),
                        _normalise_color(str(raw.get("color", "#7ee7ff"))),
                        float(position[0]),
                        float(position[1]),
                        float(position[2]),
                        max(0.1, min(3.0, float(raw.get("scale", 0.55)))),
                        raw.get("sourceFolder"),
                        raw.get("sourceImage"),
                        str(raw.get("referenceMode", "single")),
                        "contest" if raw.get("entryType") == "contest" else "award",
                        now,
                        now,
                    ),
                )
                inserted += cursor.rowcount
            except (TypeError, ValueError):
                continue
        conn.commit()
    return inserted


def list_exhibition_models(*, include_deleted: bool = False) -> list[dict[str, Any]]:
    with _connect() as conn:
        where = "" if include_deleted else "WHERE is_deleted = 0"
        rows = conn.execute(f"SELECT * FROM exhibition_models {where} ORDER BY created_at ASC, id ASC").fetchall()
    return [_row_to_record(row) for row in rows]


def get_exhibition_model(model_id: str, *, include_deleted: bool = False) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM exhibition_models WHERE id = ?", (model_id,)).fetchone()
    if row is None or (not include_deleted and row["is_deleted"]):
        return None
    return _row_to_record(row)


def create_exhibition_model(payload: dict[str, Any]) -> dict[str, Any]:
    item_id = _validate_id(str(payload.get("id", "")))
    name = _normalise_name(str(payload.get("name", "")))
    model_url = str(payload.get("modelUrl", "")).strip()
    if not model_url:
        raise ValueError("modelUrl 不能为空")
    position = payload.get("position") or [0, 0, 0]
    if not isinstance(position, list) or len(position) != 3:
        raise ValueError("position 必须是三个数字")
    now = _now_iso()
    with _connect() as conn:
        try:
            conn.execute(
                """
                INSERT INTO exhibition_models (
                    id, name, model_url, preview_url, color,
                    position_x, position_y, position_z, scale,
                    source_folder, source_image, reference_mode, entry_type,
                    always_floating, participates_in_level, is_deleted,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?, ?)
                """,
                (
                    item_id,
                    name,
                    model_url,
                    payload.get("previewUrl"),
                    _normalise_color(str(payload.get("color", "#7ee7ff"))),
                    float(position[0]),
                    float(position[1]),
                    float(position[2]),
                    max(0.1, min(3.0, float(payload.get("scale", 0.55)))),
                    payload.get("sourceFolder"),
                    payload.get("sourceImage"),
                    str(payload.get("referenceMode", "single")),
                    "contest" if payload.get("entryType") == "contest" else "award",
                    now,
                    now,
                ),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise ValueError("展品 id 已存在") from exc
    return get_exhibition_model(item_id, include_deleted=True) or {}


def update_exhibition_model(model_id: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    current = get_exhibition_model(model_id, include_deleted=True)
    if current is None:
        return None
    name = _normalise_name(str(payload.get("name", current["name"])))
    model_url = str(payload.get("modelUrl", current["modelUrl"])).strip()
    color = _normalise_color(str(payload.get("color", current["color"])))
    position = payload.get("position", current["position"])
    if not isinstance(position, list) or len(position) != 3:
        raise ValueError("position 必须是三个数字")
    with _connect() as conn:
        conn.execute(
            """
            UPDATE exhibition_models SET
                name = ?, model_url = ?, preview_url = ?, color = ?,
                position_x = ?, position_y = ?, position_z = ?, scale = ?,
                source_folder = ?, source_image = ?, reference_mode = ?, entry_type = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                name,
                model_url,
                payload.get("previewUrl", current["previewUrl"]),
                color,
                float(position[0]),
                float(position[1]),
                float(position[2]),
                max(0.1, min(3.0, float(payload.get("scale", current["scale"]))),),
                payload.get("sourceFolder", current["sourceFolder"]),
                payload.get("sourceImage", current["sourceImage"]),
                str(payload.get("referenceMode", current["referenceMode"])),
                "contest" if payload.get("entryType", current["entryType"]) == "contest" else "award",
                _now_iso(),
                model_id,
            ),
        )
        conn.commit()
    return get_exhibition_model(model_id, include_deleted=True)


def delete_exhibition_model(model_id: str) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "UPDATE exhibition_models SET is_deleted = 1, updated_at = ? WHERE id = ?",
            (_now_iso(), model_id),
        )
        conn.commit()
    return cursor.rowcount > 0


def restore_exhibition_model(model_id: str) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "UPDATE exhibition_models SET is_deleted = 0, updated_at = ? WHERE id = ?",
            (_now_iso(), model_id),
        )
        conn.commit()
    return cursor.rowcount > 0
