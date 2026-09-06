"""Password verification and opaque, server-side admin sessions."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from fastapi import HTTPException, Request, Response


DB_PATH = Path(__file__).resolve().parents[1] / "data" / "cosmos.db"
COOKIE_NAME = "cosmos_admin_session"
SESSION_SECONDS = 30 * 24 * 60 * 60
PASSWORD_SALT = b"ai-sketch-cosmos-admin-v1"
PASSWORD_ITERATIONS = 310_000
# PBKDF2-SHA256 for the configured password. The plaintext password is never
# shipped to the frontend and is not persisted in the database.
PASSWORD_HASH = bytes.fromhex("b22cbd1acfe3bdfcb9acc4261880d3ce7a520f6dfedf41786d113c29a55b2340")
_SCHEMA_LOCK = Lock()
_SCHEMA_READY = False
_FAILED_ATTEMPTS: dict[str, list[float]] = {}


def _connect() -> sqlite3.Connection:
    global _SCHEMA_READY
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=30000")
    if not _SCHEMA_READY:
        with _SCHEMA_LOCK:
            if not _SCHEMA_READY:
                connection.execute(
                    """
                    CREATE TABLE IF NOT EXISTS admin_sessions (
                        token_hash TEXT PRIMARY KEY,
                        expires_at INTEGER NOT NULL,
                        created_at TEXT NOT NULL
                    )
                    """
                )
                connection.execute("CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at)")
                connection.commit()
                _SCHEMA_READY = True
    return connection


def ensure_admin_auth_schema() -> None:
    with _connect():
        pass


def _client_key(request: Request) -> str:
    return request.headers.get("cf-connecting-ip") or (request.client.host if request.client else "unknown")


def _is_rate_limited(request: Request) -> bool:
    key = _client_key(request)
    cutoff = time.time() - 600
    recent = [timestamp for timestamp in _FAILED_ATTEMPTS.get(key, []) if timestamp >= cutoff]
    _FAILED_ATTEMPTS[key] = recent
    return len(recent) >= 5


def verify_password(password: str, request: Request) -> bool:
    if _is_rate_limited(request):
        raise HTTPException(status_code=429, detail="登录尝试过多，请 10 分钟后再试")
    candidate = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        PASSWORD_SALT,
        PASSWORD_ITERATIONS,
    )
    valid = hmac.compare_digest(candidate, PASSWORD_HASH)
    key = _client_key(request)
    if valid:
        _FAILED_ATTEMPTS.pop(key, None)
    else:
        _FAILED_ATTEMPTS.setdefault(key, []).append(time.time())
    return valid


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii", errors="ignore")).hexdigest()


def issue_admin_session(response: Response, request: Request) -> None:
    token = secrets.token_urlsafe(48)
    expires_at = int(time.time()) + SESSION_SECONDS
    with _connect() as connection:
        connection.execute("DELETE FROM admin_sessions WHERE expires_at < ?", (int(time.time()),))
        connection.execute(
            "INSERT INTO admin_sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)",
            (_token_hash(token), expires_at, datetime.now(timezone.utc).isoformat()),
        )
        connection.commit()
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
    forwarded_host = request.headers.get("x-forwarded-host", "").split(",")[0].strip().lower()
    origin = request.headers.get("origin", "").strip().lower()
    referer = request.headers.get("referer", "").strip().lower()
    public_forwarded_host = bool(forwarded_host) and not (
        forwarded_host.startswith("127.0.0.1")
        or forwarded_host.startswith("localhost")
        or forwarded_host.startswith("[::1]")
    )
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=(
            forwarded_proto == "https"
            or request.url.scheme == "https"
            or public_forwarded_host
            or origin.startswith("https://")
            or referer.startswith("https://")
        ),
        samesite="strict",
        path="/",
    )


def is_admin_authenticated(request: Request) -> bool:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return False
    with _connect() as connection:
        row = connection.execute(
            "SELECT expires_at FROM admin_sessions WHERE token_hash=?",
            (_token_hash(token),),
        ).fetchone()
    return bool(row and int(row["expires_at"]) >= int(time.time()))


def require_admin(request: Request) -> None:
    if not is_admin_authenticated(request):
        raise HTTPException(status_code=401, detail="需要后台登录")


def revoke_admin_session(response: Response, request: Request) -> None:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        with _connect() as connection:
            connection.execute("DELETE FROM admin_sessions WHERE token_hash=?", (_token_hash(token),))
            connection.commit()
    response.delete_cookie(COOKIE_NAME, path="/", httponly=True, samesite="strict")
