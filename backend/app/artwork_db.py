import json
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .storage import output_roots


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_ROOT / "data"
DB_PATH = DATA_DIR / "cosmos.db"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    _init_schema(conn)
    return conn


def _init_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS artworks (
            id TEXT PRIMARY KEY,
            name TEXT,
            source_path TEXT,
            source_url TEXT,
            preview_url TEXT,
            splat_url TEXT,
            ply_url TEXT,
            manifest_url TEXT,
            gaussian_count INTEGER,
            width INTEGER,
            height INTEGER,
            aspect REAL,
            features_json TEXT,
            gaussian_json TEXT,
            evolution_level INTEGER NOT NULL DEFAULT 0,
            evolution_experience REAL NOT NULL DEFAULT 0,
            evolution_victories INTEGER NOT NULL DEFAULT 0,
            evolution_defeats INTEGER NOT NULL DEFAULT 0,
            evolution_planet_traps INTEGER NOT NULL DEFAULT 0,
            evolution_revision INTEGER NOT NULL DEFAULT 0,
            evolution_updated_at TEXT,
            is_deleted INTEGER NOT NULL DEFAULT 0,
            deleted_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(artworks)").fetchall()}
    if "is_deleted" not in columns:
        conn.execute("ALTER TABLE artworks ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0")
    if "deleted_at" not in columns:
        conn.execute("ALTER TABLE artworks ADD COLUMN deleted_at TEXT")
    evolution_columns = {
        "evolution_level": "INTEGER NOT NULL DEFAULT 0",
        "evolution_experience": "REAL NOT NULL DEFAULT 0",
        "evolution_victories": "INTEGER NOT NULL DEFAULT 0",
        "evolution_defeats": "INTEGER NOT NULL DEFAULT 0",
        "evolution_planet_traps": "INTEGER NOT NULL DEFAULT 0",
        "evolution_revision": "INTEGER NOT NULL DEFAULT 0",
        "evolution_updated_at": "TEXT",
    }
    for column_name, column_definition in evolution_columns.items():
        if column_name not in columns:
            conn.execute(f"ALTER TABLE artworks ADD COLUMN {column_name} {column_definition}")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_artworks_created_at ON artworks(created_at DESC)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_artworks_deleted_created_at ON artworks(is_deleted, created_at DESC)")
    conn.commit()


def _json_dumps(value: Any) -> str | None:
    if value is None:
        return None
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_loads(value: str | None) -> Any:
    if not value:
        return None
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return None


def upsert_generated_artwork(
    *,
    artwork_id: str,
    source_path: Path,
    source_url: str,
    preview_url: str | None,
    splat_url: str | None,
    ply_url: str | None,
    manifest_url: str | None,
    gaussian_count: int,
    features: dict[str, Any] | None = None,
    rig_url: str | None = None,
    job_id: str | None = None,
) -> None:
    now = _now_iso()
    name = source_path.name
    gaussian_model = {
        "jobId": job_id or "",
        "sourceArtworkId": artwork_id,
        "source": "triposplat",
        "status": "ready",
        "format": "both" if splat_url and ply_url else ("splat" if splat_url else "ply"),
        "splatUrl": splat_url,
        "plyUrl": ply_url,
        "previewUrl": preview_url,
        "manifestUrl": manifest_url,
        "rigUrl": rig_url,
        "gaussianCount": gaussian_count,
        "createdAt": int(datetime.now(timezone.utc).timestamp() * 1000),
    }
    with _connect() as conn:
        existing = conn.execute("SELECT created_at FROM artworks WHERE id = ?", (artwork_id,)).fetchone()
        created_at = existing["created_at"] if existing else now
        conn.execute(
            """
            INSERT INTO artworks (
                id, name, source_path, source_url, preview_url, splat_url, ply_url,
                manifest_url, gaussian_count, features_json, gaussian_json, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                source_path = excluded.source_path,
                source_url = excluded.source_url,
                preview_url = excluded.preview_url,
                splat_url = excluded.splat_url,
                ply_url = excluded.ply_url,
                manifest_url = excluded.manifest_url,
                gaussian_count = excluded.gaussian_count,
                features_json = COALESCE(excluded.features_json, artworks.features_json),
                gaussian_json = excluded.gaussian_json,
                is_deleted = 0,
                deleted_at = NULL,
                updated_at = excluded.updated_at
            """,
            (
                artwork_id,
                name,
                str(source_path),
                source_url,
                preview_url,
                splat_url,
                ply_url,
                manifest_url,
                gaussian_count,
                _json_dumps(features),
                _json_dumps(gaussian_model),
                created_at,
                now,
            ),
        )
        conn.commit()


def update_artwork_metadata(
    artwork_id: str,
    *,
    name: str | None = None,
    width: int | None = None,
    height: int | None = None,
    aspect: float | None = None,
    features: dict[str, Any] | None = None,
    gaussian_model: dict[str, Any] | None = None,
) -> bool:
    with _connect() as conn:
        row = conn.execute("SELECT id FROM artworks WHERE id = ?", (artwork_id,)).fetchone()
        if row is None:
            return False

        conn.execute(
            """
            UPDATE artworks
            SET
                name = COALESCE(?, name),
                width = COALESCE(?, width),
                height = COALESCE(?, height),
                aspect = COALESCE(?, aspect),
                features_json = COALESCE(?, features_json),
                gaussian_json = COALESCE(?, gaussian_json),
                updated_at = ?
            WHERE id = ?
            """,
            (
                name,
                width,
                height,
                aspect,
                _json_dumps(features),
                _json_dumps(gaussian_model),
                _now_iso(),
                artwork_id,
            ),
        )
        conn.commit()
        return True


def update_artwork_evolution(records: list[dict[str, Any]]) -> int:
    if not records:
        return 0

    updated = 0
    now = _now_iso()
    with _connect() as conn:
        for record in records:
            cursor = conn.execute(
                """
                UPDATE artworks
                SET
                    evolution_level = ?,
                    evolution_experience = ?,
                    evolution_victories = ?,
                    evolution_defeats = ?,
                    evolution_planet_traps = ?,
                    evolution_revision = ?,
                    evolution_updated_at = ?,
                    updated_at = ?
                WHERE id = ? AND evolution_revision <= ?
                """,
                (
                    record["level"],
                    record["experience"],
                    record["victories"],
                    record["defeats"],
                    record["planetTraps"],
                    record["revision"],
                    now,
                    now,
                    record["artworkId"],
                    record["revision"],
                ),
            )
            updated += cursor.rowcount
        conn.commit()
    return updated


def _row_to_artwork(row: sqlite3.Row) -> dict[str, Any]:
    gaussian_model = _json_loads(row["gaussian_json"]) or {
        "jobId": "",
        "sourceArtworkId": row["id"],
        "source": "triposplat",
        "status": "ready",
        "format": "splat" if row["splat_url"] else "ply",
        "splatUrl": row["splat_url"],
        "plyUrl": row["ply_url"],
        "previewUrl": row["preview_url"],
        "manifestUrl": row["manifest_url"],
        "gaussianCount": row["gaussian_count"] or 0,
        "createdAt": 0,
    }

    return {
        "id": row["id"],
        "name": row["name"],
        "sourceUrl": row["source_url"],
        "previewUrl": row["preview_url"],
        "splatUrl": row["splat_url"],
        "plyUrl": row["ply_url"],
        "manifestUrl": row["manifest_url"],
        "gaussianCount": row["gaussian_count"],
        "width": row["width"],
        "height": row["height"],
        "aspect": row["aspect"],
        "features": _json_loads(row["features_json"]),
        "gaussianModel": gaussian_model,
        "evolution": {
            "level": row["evolution_level"],
            "experience": row["evolution_experience"],
            "victories": row["evolution_victories"],
            "defeats": row["evolution_defeats"],
            "planetTraps": row["evolution_planet_traps"],
            "revision": row["evolution_revision"],
            "updatedAt": row["evolution_updated_at"],
        },
        "isDeleted": bool(row["is_deleted"]),
        "deletedAt": row["deleted_at"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def _status_filter(status: str) -> str:
    if status == "deleted":
        return "AND is_deleted = 1"
    if status == "all":
        return ""
    return "AND is_deleted = 0"


def list_artworks(*, limit: int = 50, offset: int = 0, status: str = "active") -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            f"""
            SELECT *
            FROM artworks
            WHERE (splat_url IS NOT NULL OR ply_url IS NOT NULL)
            {_status_filter(status)}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
            """,
            (limit, offset),
        ).fetchall()
    return [_row_to_artwork(row) for row in rows]


def count_artworks(*, status: str = "active") -> int:
    with _connect() as conn:
        row = conn.execute(
            f"""
            SELECT COUNT(*) AS total
            FROM artworks
            WHERE (splat_url IS NOT NULL OR ply_url IS NOT NULL)
            {_status_filter(status)}
            """
        ).fetchone()
    return int(row["total"] if row else 0)


def get_artwork(artwork_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute("SELECT * FROM artworks WHERE id = ?", (artwork_id,)).fetchone()
    return _row_to_artwork(row) if row else None


def soft_delete_artwork(artwork_id: str) -> bool:
    with _connect() as conn:
        row = conn.execute("SELECT id FROM artworks WHERE id = ?", (artwork_id,)).fetchone()
        if row is None:
            return False
        now = _now_iso()
        conn.execute(
            """
            UPDATE artworks
            SET is_deleted = 1, deleted_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (now, now, artwork_id),
        )
        conn.commit()
    return True


def restore_artwork(artwork_id: str) -> bool:
    with _connect() as conn:
        row = conn.execute("SELECT id FROM artworks WHERE id = ?", (artwork_id,)).fetchone()
        if row is None:
            return False
        conn.execute(
            """
            UPDATE artworks
            SET is_deleted = 0, deleted_at = NULL, updated_at = ?
            WHERE id = ?
            """,
            (_now_iso(), artwork_id),
        )
        conn.commit()
    return True


def delete_artwork_permanently(artwork_id: str, *, delete_files: bool = True) -> bool:
    with _connect() as conn:
        row = conn.execute("SELECT id FROM artworks WHERE id = ?", (artwork_id,)).fetchone()
        if row is None:
            return False
        conn.execute("DELETE FROM artworks WHERE id = ?", (artwork_id,))
        conn.commit()

    if delete_files:
        for output_root in output_roots():
            artwork_dir = output_root / artwork_id
            if artwork_dir.is_dir() and artwork_dir.resolve().parent == output_root.resolve():
                shutil.rmtree(artwork_dir, ignore_errors=True)

    return True


def backfill_existing_outputs() -> int:
    roots = output_roots()
    if not roots:
        return 0

    imported = 0
    with _connect() as conn:
        for output_root in roots:
            for artwork_dir in output_root.iterdir():
                if not artwork_dir.is_dir():
                    continue
                artwork_id = artwork_dir.name
                splat_path = artwork_dir / "model.splat"
                ply_path = artwork_dir / "model.ply"
                if not splat_path.is_file() and not ply_path.is_file():
                    continue

                exists = conn.execute("SELECT id FROM artworks WHERE id = ?", (artwork_id,)).fetchone()
                if exists:
                    continue

                source_path = next(artwork_dir.glob("source.*"), None)
                preview_path = artwork_dir / "preprocessed_image.webp"
                manifest_path = artwork_dir / "manifest.json"
                gaussian_count = None

                if manifest_path.is_file():
                    try:
                        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                        gaussian_count = manifest.get("gaussianCount")
                    except Exception:
                        gaussian_count = None

                created_at = datetime.fromtimestamp(artwork_dir.stat().st_mtime, timezone.utc).isoformat()
                conn.execute(
                    """
                    INSERT INTO artworks (
                        id, name, source_path, source_url, preview_url, splat_url, ply_url,
                        manifest_url, gaussian_count, is_deleted, deleted_at, created_at, updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)
                    """,
                    (
                        artwork_id,
                        source_path.name if source_path else artwork_id,
                        str(source_path) if source_path else None,
                        f"/assets/{artwork_id}/{source_path.name}" if source_path else None,
                        f"/assets/{artwork_id}/preprocessed_image.webp" if preview_path.is_file() else None,
                        f"/assets/{artwork_id}/model.splat" if splat_path.is_file() else None,
                        f"/assets/{artwork_id}/model.ply" if ply_path.is_file() else None,
                        f"/assets/{artwork_id}/manifest.json" if manifest_path.is_file() else None,
                        gaussian_count,
                        created_at,
                        _now_iso(),
                    ),
                )
                imported += 1
        conn.commit()

    return imported
