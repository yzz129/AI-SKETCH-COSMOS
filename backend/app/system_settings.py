"""Small persisted feature flags controlled from the Cosmos admin console."""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock


DB_PATH = Path(__file__).resolve().parents[1] / "data" / "cosmos.db"
_SCHEMA_LOCK = Lock()
_SCHEMA_READY = False
SUBMIT_TEST_ENTRY_KEY = "submit_test_entry_enabled"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    global _SCHEMA_READY
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    timeout = max(1, int(os.getenv("COSMOS_DB_BUSY_TIMEOUT_SECONDS", "30")))
    connection = sqlite3.connect(DB_PATH, timeout=timeout)
    connection.row_factory = sqlite3.Row
    connection.execute(f"PRAGMA busy_timeout={timeout * 1000}")
    if not _SCHEMA_READY:
        with _SCHEMA_LOCK:
            if not _SCHEMA_READY:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS system_settings (
                        key TEXT PRIMARY KEY,
                        value TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                    """
                )
                connection.execute(
                    "INSERT OR IGNORE INTO system_settings (key, value, updated_at) VALUES (?, '1', ?)",
                    (SUBMIT_TEST_ENTRY_KEY, _now_iso()),
                )
                connection.commit()
                _SCHEMA_READY = True
    return connection


def ensure_system_settings_schema() -> None:
    with _connect():
        pass


def get_submit_test_entry_setting() -> dict[str, object]:
    with _connect() as connection:
        row = connection.execute(
            "SELECT value, updated_at FROM system_settings WHERE key=?",
            (SUBMIT_TEST_ENTRY_KEY,),
        ).fetchone()
    return {
        "enabled": bool(row and row["value"] == "1"),
        "updatedAt": row["updated_at"] if row else None,
    }


def set_submit_test_entry_setting(enabled: bool) -> dict[str, object]:
    updated_at = _now_iso()
    with _connect() as connection:
        connection.execute(
            """
            INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
            """,
            (SUBMIT_TEST_ENTRY_KEY, "1" if enabled else "0", updated_at),
        )
        connection.commit()
    return {"enabled": enabled, "updatedAt": updated_at}
