"""Durable submission and traffic telemetry for the admin dashboard.

The generation queue already keeps a short-lived in-memory job registry. This
module stores a compact, privacy-conscious record beside the artwork database
so an admin can still inspect success rate, elapsed time, and traffic after a
worker has finished or the service has restarted.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DB_PATH = Path(__file__).resolve().parents[1] / "data" / "cosmos.db"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


def ensure_submission_telemetry_schema() -> None:
    with _connect() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS submission_telemetry (
                job_id TEXT PRIMARY KEY,
                submission_id TEXT,
                client_key TEXT NOT NULL DEFAULT 'anonymous',
                artwork_id TEXT NOT NULL,
                source_filename TEXT,
                status TEXT NOT NULL DEFAULT 'queued',
                success INTEGER NOT NULL DEFAULT 0,
                submitted_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                input_bytes INTEGER NOT NULL DEFAULT 0,
                output_bytes INTEGER NOT NULL DEFAULT 0,
                queue_ms REAL,
                generation_ms REAL,
                total_ms REAL,
                error_message TEXT
            )
            """
        )
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(submission_telemetry)").fetchall()}
        profile_columns = {
            "channel": "TEXT NOT NULL DEFAULT 'submit'",
            "reference_mode": "TEXT",
            "model_id": "TEXT",
            "published_at": "TEXT",
            "user_id": "TEXT",
            "user_name": "TEXT",
            "user_avatar_url": "TEXT",
            "user_mobile": "TEXT",
            "user_snapshot_json": "TEXT",
            "booking_id": "TEXT",
            "booking_code": "TEXT",
            "booking_project_id": "TEXT",
            "booking_slot_id": "TEXT",
            "booking_slot_label": "TEXT",
            "booking_status": "TEXT",
            "booking_snapshot_json": "TEXT",
            "client_ip": "TEXT",
            "user_agent": "TEXT",
        }
        for column_name, column_type in profile_columns.items():
            if column_name not in columns:
                connection.execute(f"ALTER TABLE submission_telemetry ADD COLUMN {column_name} {column_type}")
        connection.execute("UPDATE submission_telemetry SET channel='submit' WHERE channel IS NULL OR channel='' ")
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_submission_telemetry_submitted_at "
            "ON submission_telemetry(submitted_at DESC)"
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_submission_telemetry_client_key "
            "ON submission_telemetry(client_key)"
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS submission_opportunity_claims (
                identity_key TEXT PRIMARY KEY,
                user_id TEXT,
                booking_id TEXT,
                booking_code TEXT,
                job_id TEXT NOT NULL,
                submission_id TEXT,
                artwork_id TEXT,
                status TEXT NOT NULL DEFAULT 'queued',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            "CREATE INDEX IF NOT EXISTS idx_submission_claims_job_id "
            "ON submission_opportunity_claims(job_id)"
        )


def _submission_identity(user_context: dict[str, Any] | None) -> dict[str, str | bool | None]:
    context = user_context if isinstance(user_context, dict) else {}
    user = context.get("user") if isinstance(context.get("user"), dict) else {}
    booking = context.get("booking") if isinstance(context.get("booking"), dict) else {}
    user_raw = user.get("raw") if isinstance(user.get("raw"), dict) else {}
    booking_raw = booking.get("raw") if isinstance(booking.get("raw"), dict) else {}
    is_test = bool(user_raw.get("testMode") or booking_raw.get("testMode"))
    user_id = str(user.get("id") or "").strip()[:160] or None
    booking_id = str(booking.get("id") or "").strip()[:160] or None
    booking_code = str(booking.get("code") or "").strip()[:60] or None
    identity_key = (
        f"user:{user_id}" if user_id
        else f"booking:{booking_id}" if booking_id
        else f"booking-code:{booking_code}" if booking_code
        else None
    )
    return {
        "identity_key": identity_key,
        "user_id": user_id,
        "booking_id": booking_id,
        "booking_code": booking_code,
        "is_test": is_test,
    }


def _existing_submission(
    connection: sqlite3.Connection,
    *,
    identity_key: str,
    user_id: str | None,
    booking_id: str | None,
    booking_code: str | None,
) -> sqlite3.Row | None:
    claim = connection.execute(
        """
        SELECT job_id, artwork_id, status
        FROM submission_opportunity_claims
        WHERE identity_key=? AND status IN ('queued', 'processing', 'ready')
        LIMIT 1
        """,
        (identity_key,),
    ).fetchone()
    if claim is not None:
        return claim

    conditions: list[str] = []
    params: list[str] = []
    for column, value in (
        ("user_id", user_id),
        ("booking_id", booking_id),
        ("booking_code", booking_code),
    ):
        if value:
            conditions.append(f"{column}=?")
            params.append(value)
    if not conditions:
        return None
    return connection.execute(
        f"""
        SELECT job_id, artwork_id, status
        FROM submission_telemetry
        WHERE channel='submit'
          AND status IN ('queued', 'processing', 'ready')
          AND ({' OR '.join(conditions)})
        ORDER BY submitted_at DESC
        LIMIT 1
        """,
        params,
    ).fetchone()


def get_submission_eligibility(user_context: dict[str, Any] | None) -> dict[str, Any]:
    ensure_submission_telemetry_schema()
    identity = _submission_identity(user_context)
    if identity["is_test"]:
        return {"eligible": True, "testMode": True}
    identity_key = identity["identity_key"]
    if not isinstance(identity_key, str):
        return {"eligible": True, "unidentified": True}
    with _connect() as connection:
        existing = _existing_submission(
            connection,
            identity_key=identity_key,
            user_id=identity["user_id"] if isinstance(identity["user_id"], str) else None,
            booking_id=identity["booking_id"] if isinstance(identity["booking_id"], str) else None,
            booking_code=identity["booking_code"] if isinstance(identity["booking_code"], str) else None,
        )
    return {
        "eligible": existing is None,
        "jobId": str(existing["job_id"]) if existing else None,
        "artworkId": str(existing["artwork_id"]) if existing and existing["artwork_id"] else None,
        "status": str(existing["status"]) if existing else None,
    }


def claim_submission_opportunity(
    *,
    user_context: dict[str, Any] | None,
    job_id: str,
    submission_id: str | None,
    artwork_id: str,
) -> dict[str, Any]:
    ensure_submission_telemetry_schema()
    identity = _submission_identity(user_context)
    if identity["is_test"]:
        return {"eligible": True, "testMode": True, "identityKey": None}
    identity_key = identity["identity_key"]
    if not isinstance(identity_key, str):
        return {"eligible": True, "unidentified": True, "identityKey": None}
    now = _now_iso()
    with _connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        existing = _existing_submission(
            connection,
            identity_key=identity_key,
            user_id=identity["user_id"] if isinstance(identity["user_id"], str) else None,
            booking_id=identity["booking_id"] if isinstance(identity["booking_id"], str) else None,
            booking_code=identity["booking_code"] if isinstance(identity["booking_code"], str) else None,
        )
        if existing is not None:
            connection.rollback()
            return {
                "eligible": False,
                "identityKey": identity_key,
                "jobId": str(existing["job_id"]),
                "artworkId": str(existing["artwork_id"]) if existing["artwork_id"] else None,
                "status": str(existing["status"]),
            }
        connection.execute(
            """
            INSERT OR REPLACE INTO submission_opportunity_claims
            (identity_key, user_id, booking_id, booking_code, job_id,
             submission_id, artwork_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)
            """,
            (
                identity_key,
                identity["user_id"],
                identity["booking_id"],
                identity["booking_code"],
                job_id,
                submission_id,
                artwork_id,
                now,
                now,
            ),
        )
        connection.commit()
    return {"eligible": True, "identityKey": identity_key}


def release_submission_opportunity(*, identity_key: str | None, job_id: str) -> None:
    if not identity_key:
        return
    with _connect() as connection:
        connection.execute(
            "DELETE FROM submission_opportunity_claims WHERE identity_key=? AND job_id=?",
            (identity_key, job_id),
        )
        connection.commit()


def mark_interrupted_submissions_failed() -> int:
    """Close jobs that cannot survive a service restart.

    Generation jobs live in memory, while telemetry is durable. If the process
    restarts, any persisted queued/processing row no longer has a worker behind
    it and must not be shown as actively running forever.
    """
    ensure_submission_telemetry_schema()
    finished_at = _now_iso()
    with _connect() as connection:
        cursor = connection.execute(
            """
            UPDATE submission_telemetry
            SET status='failed', success=0, finished_at=?,
                error_message=COALESCE(error_message, '服务重启，任务已中断')
            WHERE status IN ('queued', 'processing')
            """,
            (finished_at,),
        )
        connection.execute(
            """
            UPDATE submission_opportunity_claims
            SET status='failed', updated_at=?
            WHERE status IN ('queued', 'processing')
            """,
            (finished_at,),
        )
        connection.commit()
        return max(0, int(cursor.rowcount))


def _safe_write(callback) -> None:
    try:
        with _connect() as connection:
            callback(connection)
    except sqlite3.Error:
        # Telemetry must never make a user generation fail.
        return


def record_submission_created(
    *,
    job_id: str,
    submission_id: str | None,
    artwork_id: str,
    source_filename: str,
    input_bytes: int,
    channel: str = "submit",
    reference_mode: str | None = None,
    user_context: dict[str, Any] | None = None,
    client_ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    submitted_at = _now_iso()
    context = user_context if isinstance(user_context, dict) else {}
    user = context.get("user") if isinstance(context.get("user"), dict) else {}
    booking = context.get("booking") if isinstance(context.get("booking"), dict) else {}
    user_id = str(user.get("id") or "").strip()[:160] or None
    client_key = user_id or submission_id or "anonymous"

    def compact_json(value: object) -> str | None:
        if not isinstance(value, dict) or not value:
            return None
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

    def write(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            INSERT OR REPLACE INTO submission_telemetry
            (job_id, submission_id, client_key, artwork_id, source_filename,
             channel, reference_mode, status, submitted_at, input_bytes, user_id, user_name,
             user_avatar_url, user_mobile, user_snapshot_json, booking_id,
             booking_code, booking_project_id, booking_slot_id,
             booking_slot_label, booking_status, booking_snapshot_json,
             client_ip, user_agent)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                job_id, submission_id, client_key, artwork_id, source_filename,
                channel if channel in {"submit", "designer"} else "submit",
                (reference_mode or "")[:32] or None,
                submitted_at, max(0, input_bytes), user_id,
                str(user.get("name") or "").strip()[:120] or None,
                str(user.get("avatarUrl") or "").strip()[:1000] or None,
                str(user.get("mobile") or "").strip()[:60] or None,
                compact_json(user.get("raw")),
                str(booking.get("id") or "").strip()[:160] or None,
                str(booking.get("code") or "").strip()[:60] or None,
                str(booking.get("projectId") or "").strip()[:160] or None,
                str(booking.get("slotId") or "").strip()[:160] or None,
                str(booking.get("slotLabel") or "").strip()[:240] or None,
                str(booking.get("status") or "").strip()[:80] or None,
                compact_json(booking.get("raw")),
                (client_ip or "").strip()[:80] or None,
                (user_agent or "").strip()[:500] or None,
            ),
        )
        if channel == "submit":
            connection.execute(
                """
                UPDATE submission_opportunity_claims
                SET artwork_id=?, status='queued', updated_at=?
                WHERE job_id=?
                """,
                (artwork_id, submitted_at, job_id),
            )
        connection.commit()

    _safe_write(write)


def find_latest_designer_job_id(submission_id: str) -> str | None:
    normalized = submission_id.strip()[:128]
    if not normalized:
        return None
    ensure_submission_telemetry_schema()
    try:
        with _connect() as connection:
            row = connection.execute(
                """
                SELECT job_id
                FROM submission_telemetry
                WHERE channel='designer' AND submission_id=?
                ORDER BY submitted_at DESC
                LIMIT 1
                """,
                (normalized,),
            ).fetchone()
        return str(row["job_id"]) if row else None
    except sqlite3.Error:
        return None


def record_submission_published(*, job_id: str, model_id: str) -> None:
    """Link a confirmed designer result to the GLB exhibition library."""
    published_at = _now_iso()

    def write(connection: sqlite3.Connection) -> None:
        connection.execute(
            "UPDATE submission_telemetry SET status='ready', model_id=?, published_at=? WHERE job_id=?",
            ((model_id or "")[:160] or None, published_at, job_id),
        )
        connection.commit()

    _safe_write(write)


def record_submission_cancelled(*, job_id: str) -> None:
    """Record an operator rejection or withdrawal from the exhibition queue."""
    cancelled_at = _now_iso()

    def write(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            UPDATE submission_telemetry
            SET status='cancelled', success=0, finished_at=?, published_at=NULL
            WHERE job_id=?
            """,
            (cancelled_at, job_id),
        )
        connection.execute(
            """
            UPDATE submission_opportunity_claims
            SET status='cancelled', updated_at=? WHERE job_id=?
            """,
            (cancelled_at, job_id),
        )
        connection.commit()

    _safe_write(write)


def record_submission_started(*, job_id: str, queue_ms: float) -> None:
    started_at = _now_iso()

    def write(connection: sqlite3.Connection) -> None:
        connection.execute(
            "UPDATE submission_telemetry SET status='processing', started_at=?, queue_ms=? WHERE job_id=?",
            (started_at, max(0.0, queue_ms), job_id),
        )
        connection.execute(
            """
            UPDATE submission_opportunity_claims
            SET status='processing', updated_at=? WHERE job_id=?
            """,
            (started_at, job_id),
        )
        connection.commit()

    _safe_write(write)


def record_submission_finished(
    *,
    job_id: str,
    status: str,
    success: bool,
    total_ms: float,
    generation_ms: float | None = None,
    output_bytes: int = 0,
    error_message: str | None = None,
) -> None:
    finished_at = _now_iso()

    def write(connection: sqlite3.Connection) -> None:
        connection.execute(
            """
            UPDATE submission_telemetry
            SET status=?, success=?, finished_at=?, total_ms=?, generation_ms=?,
                output_bytes=?, error_message=?
            WHERE job_id=?
            """,
            (
                status,
                int(success),
                finished_at,
                max(0.0, total_ms),
                max(0.0, generation_ms) if generation_ms is not None else None,
                max(0, output_bytes),
                (error_message or "")[:800] or None,
                job_id,
            ),
        )
        connection.execute(
            """
            UPDATE submission_opportunity_claims
            SET status=?, updated_at=? WHERE job_id=?
            """,
            ("ready" if success else "failed", finished_at, job_id),
        )
        connection.commit()

    _safe_write(write)


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round((len(ordered) - 1) * percentile)))
    return ordered[index]


def _row_to_dict(row: sqlite3.Row) -> dict[str, Any]:
    keys = set(row.keys())
    def field(name: str, default=None):
        return row[name] if name in keys else default

    def parsed_snapshot(name: str):
        raw = field(name)
        if not raw:
            return None
        try:
            return json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return None

    return {
        "jobId": row["job_id"],
        "submissionId": row["submission_id"],
        "clientKey": row["client_key"],
        "artworkId": row["artwork_id"],
        "sourceFilename": row["source_filename"],
        "channel": field("channel", "submit") or "submit",
        "referenceMode": field("reference_mode"),
        "modelId": field("model_id"),
        "publishedAt": field("published_at"),
        "status": row["status"],
        "success": bool(row["success"]),
        "submittedAt": row["submitted_at"],
        "startedAt": row["started_at"],
        "finishedAt": row["finished_at"],
        "inputBytes": row["input_bytes"] or 0,
        "outputBytes": row["output_bytes"] or 0,
        "queueMs": row["queue_ms"],
        "generationMs": row["generation_ms"],
        "totalMs": row["total_ms"],
        "errorMessage": row["error_message"],
        "user": {
            "id": field("user_id"),
            "name": field("user_name"),
            "avatarUrl": field("user_avatar_url"),
            "mobile": field("user_mobile"),
            "raw": parsed_snapshot("user_snapshot_json"),
        } if field("user_id") or field("user_name") else None,
        "booking": {
            "id": field("booking_id"),
            "code": field("booking_code"),
            "projectId": field("booking_project_id"),
            "slotId": field("booking_slot_id"),
            "slotLabel": field("booking_slot_label"),
            "status": field("booking_status"),
            "raw": parsed_snapshot("booking_snapshot_json"),
        } if field("booking_id") or field("booking_code") else None,
        "clientIp": field("client_ip"),
        "userAgent": field("user_agent"),
    }


def get_submission_users(*, query: str = "", limit: int = 40, offset: int = 0) -> dict[str, Any]:
    ensure_submission_telemetry_schema()
    safe_limit = max(1, min(100, int(limit)))
    safe_offset = max(0, int(offset))
    search = query.strip()[:100]
    where = "WHERE COALESCE(user_id, '') <> ''"
    params: list[Any] = []
    if search:
        where += " AND (user_name LIKE ? OR user_mobile LIKE ? OR user_id LIKE ? OR booking_code LIKE ?)"
        term = f"%{search}%"
        params.extend([term, term, term, term])

    with _connect() as connection:
        total = connection.execute(
            f"SELECT COUNT(DISTINCT user_id) AS count FROM submission_telemetry {where}", params
        ).fetchone()["count"]
        user_ids = connection.execute(
            f"""
            SELECT user_id, MAX(submitted_at) AS last_submitted_at
            FROM submission_telemetry {where}
            GROUP BY user_id ORDER BY last_submitted_at DESC LIMIT ? OFFSET ?
            """,
            [*params, safe_limit, safe_offset],
        ).fetchall()
        users: list[dict[str, Any]] = []
        for item in user_ids:
            user_id = item["user_id"]
            latest = connection.execute(
                "SELECT * FROM submission_telemetry WHERE user_id=? ORDER BY submitted_at DESC LIMIT 1",
                (user_id,),
            ).fetchone()
            stats = connection.execute(
                """
                SELECT COUNT(*) AS submissions, SUM(success) AS successes,
                       SUM(input_bytes + output_bytes) AS traffic_bytes,
                       AVG(CASE WHEN total_ms IS NOT NULL THEN total_ms END) AS average_total_ms,
                       MIN(submitted_at) AS first_submitted_at, MAX(submitted_at) AS last_submitted_at
                FROM submission_telemetry WHERE user_id=?
                """,
                (user_id,),
            ).fetchone()
            users.append({
                "userKey": user_id,
                "profile": _row_to_dict(latest)["user"],
                "latestBooking": _row_to_dict(latest)["booking"],
                "submissions": stats["submissions"] or 0,
                "successes": stats["successes"] or 0,
                "trafficBytes": stats["traffic_bytes"] or 0,
                "averageTotalMs": stats["average_total_ms"],
                "firstSubmittedAt": stats["first_submitted_at"],
                "lastSubmittedAt": stats["last_submitted_at"],
            })
    return {"total": total or 0, "users": users}


def get_submission_user_detail(user_id: str) -> dict[str, Any] | None:
    ensure_submission_telemetry_schema()
    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM submission_telemetry WHERE user_id=? ORDER BY submitted_at DESC LIMIT 500",
            (user_id,),
        ).fetchall()
    if not rows:
        return None
    submissions = [_row_to_dict(row) for row in rows]
    latest = submissions[0]
    return {
        "userKey": user_id,
        "profile": latest["user"],
        "latestBooking": latest["booking"],
        "clientIp": latest["clientIp"],
        "userAgent": latest["userAgent"],
        "submissions": submissions,
    }


def get_submission_metrics(
    *,
    window_hours: int = 24,
    limit: int = 16,
    chart_date: str | None = None,
    timezone_offset_minutes: int = 480,
) -> dict[str, Any]:
    ensure_submission_telemetry_schema()
    safe_hours = max(1, min(168, int(window_hours)))
    safe_limit = max(1, min(100, int(limit)))
    safe_timezone_offset = max(-720, min(840, int(timezone_offset_minutes)))
    chart_timezone = timezone(timedelta(minutes=safe_timezone_offset))
    today_in_chart_timezone = datetime.now(chart_timezone).date()
    try:
        selected_chart_date = datetime.strptime(chart_date or "", "%Y-%m-%d").date()
    except ValueError:
        selected_chart_date = today_in_chart_timezone
    chart_start = datetime.combine(selected_chart_date, datetime.min.time(), tzinfo=chart_timezone)
    chart_end = chart_start + timedelta(days=1)
    chart_start_utc = chart_start.astimezone(timezone.utc)
    chart_end_utc = chart_end.astimezone(timezone.utc)
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=safe_hours)).isoformat()

    with _connect() as connection:
        rows = connection.execute(
            "SELECT * FROM submission_telemetry WHERE submitted_at >= ? ORDER BY submitted_at DESC LIMIT ?",
            (cutoff, safe_limit),
        ).fetchall()
        total_uploaded_models = connection.execute(
            "SELECT COUNT(*) AS count FROM submission_telemetry",
        ).fetchone()["count"]
        now_utc = datetime.now(timezone.utc)
        minute_cutoff = (now_utc - timedelta(minutes=1)).isoformat()
        minute_rows = connection.execute(
            """
            SELECT user_id, client_key
            FROM submission_telemetry
            WHERE submitted_at >= ?
            """,
            (minute_cutoff,),
        ).fetchall()
        minute_chart_rows = connection.execute(
            """
            SELECT submitted_at, user_id, client_key
            FROM submission_telemetry
            WHERE submitted_at >= ? AND submitted_at < ?
            """,
            (chart_start_utc.isoformat(), chart_end_utc.isoformat()),
        ).fetchall()
        chart_date_bounds = connection.execute(
            "SELECT MIN(submitted_at) AS first_at, MAX(submitted_at) AS last_at FROM submission_telemetry",
        ).fetchone()
        all_rows = connection.execute(
            """
            SELECT client_key, user_id, channel, status, success, input_bytes, output_bytes, queue_ms, generation_ms, total_ms
            FROM submission_telemetry
            WHERE submitted_at >= ?
            """,
            (cutoff,),
        ).fetchall()
        hourly_rows = connection.execute(
            """
            SELECT substr(submitted_at, 1, 13) AS bucket, COUNT(*) AS count
            FROM submission_telemetry
            WHERE submitted_at >= ?
            GROUP BY bucket
            ORDER BY bucket ASC
            """,
            (cutoff,),
        ).fetchall()

    completed = [row for row in all_rows if row["status"] in {"ready", "review", "failed", "cancelled"}]
    total = len(all_rows)
    successes = sum(bool(row["success"]) for row in completed)
    failures = len(completed) - successes
    pending = sum(row["status"] in {"queued", "processing"} for row in all_rows)
    elapsed_values = [float(row["total_ms"]) for row in completed if row["total_ms"] is not None]
    queue_values = [float(row["queue_ms"]) for row in all_rows if row["queue_ms"] is not None]
    generation_values = [float(row["generation_ms"]) for row in completed if row["generation_ms"] is not None]
    users_last_minute = len({
        str(row["user_id"] or row["client_key"] or "anonymous")
        for row in minute_rows
    })
    minute_users: dict[datetime, set[str]] = {
        chart_start + timedelta(minutes=index): set()
        for index in range(24 * 60)
    }
    daily_users: set[str] = set()
    for row in minute_chart_rows:
        try:
            submitted_at = datetime.fromisoformat(str(row["submitted_at"]).replace("Z", "+00:00"))
            bucket = submitted_at.astimezone(chart_timezone).replace(second=0, microsecond=0)
        except (TypeError, ValueError):
            continue
        if bucket not in minute_users:
            continue
        user_key = str(row["user_id"] or row["client_key"] or "anonymous")
        minute_users[bucket].add(user_key)
        daily_users.add(user_key)
    minute_user_series = [
        {
            "timestamp": bucket.isoformat(),
            "count": len(users),
        }
        for bucket, users in minute_users.items()
    ]
    available_dates: list[str] = []
    if chart_date_bounds and chart_date_bounds["first_at"]:
        try:
            first_chart_date = datetime.fromisoformat(
                str(chart_date_bounds["first_at"]).replace("Z", "+00:00")
            ).astimezone(chart_timezone).date()
            last_record_date = datetime.fromisoformat(
                str(chart_date_bounds["last_at"]).replace("Z", "+00:00")
            ).astimezone(chart_timezone).date()
            last_chart_date = max(today_in_chart_timezone, last_record_date)
            available_dates = [
                (last_chart_date - timedelta(days=index)).isoformat()
                for index in range((last_chart_date - first_chart_date).days + 1)
            ]
        except (TypeError, ValueError):
            available_dates = []

    channels: dict[str, dict[str, Any]] = {}
    for channel in ("submit", "designer"):
        channel_rows = [row for row in all_rows if (row["channel"] or "submit") == channel]
        channel_completed = [row for row in channel_rows if row["status"] in {"ready", "review", "failed", "cancelled"}]
        channel_elapsed = [float(row["total_ms"]) for row in channel_completed if row["total_ms"] is not None]
        channel_successes = sum(bool(row["success"]) for row in channel_completed)
        channels[channel] = {
            "submissions": len(channel_rows),
            "uniqueClients": len({str(row["user_id"] or row["client_key"] or "anonymous") for row in channel_rows}),
            "successes": channel_successes,
            "failures": len(channel_completed) - channel_successes,
            "pending": sum(row["status"] in {"queued", "processing"} for row in channel_rows),
            "successRate": round(channel_successes / len(channel_completed), 4) if channel_completed else None,
            "averageTotalMs": round(sum(channel_elapsed) / len(channel_elapsed), 1) if channel_elapsed else None,
            "inputBytes": sum(int(row["input_bytes"] or 0) for row in channel_rows),
            "outputBytes": sum(int(row["output_bytes"] or 0) for row in channel_completed),
        }
    return {
        "windowHours": safe_hours,
        "daily": {
            "date": selected_chart_date.isoformat(),
            "timezoneOffsetMinutes": safe_timezone_offset,
            "availableDates": available_dates,
            "totalUploads": len(minute_chart_rows),
            "uniqueUsers": len(daily_users),
        },
        "summary": {
            "submissions": total,
            "uniqueClients": len({str(row["user_id"] or row["client_key"] or "anonymous") for row in all_rows}),
            "identifiedUsers": len({str(row["user_id"]) for row in all_rows if row["user_id"]}),
            "identifiedSubmissions": sum(bool(row["user_id"]) for row in all_rows),
            "successes": successes,
            "failures": failures,
            "pending": pending,
            "successRate": round(successes / len(completed), 4) if completed else None,
            "averageTotalMs": round(sum(elapsed_values) / len(elapsed_values), 1) if elapsed_values else None,
            "p50TotalMs": round(_percentile(elapsed_values, 0.5), 1) if _percentile(elapsed_values, 0.5) is not None else None,
            "p95TotalMs": round(_percentile(elapsed_values, 0.95), 1) if _percentile(elapsed_values, 0.95) is not None else None,
            "averageQueueMs": round(sum(queue_values) / len(queue_values), 1) if queue_values else None,
            "averageGenerationMs": round(sum(generation_values) / len(generation_values), 1) if generation_values else None,
            "inputBytes": sum(int(row["input_bytes"] or 0) for row in all_rows),
            "outputBytes": sum(int(row["output_bytes"] or 0) for row in completed),
            "totalUploadedModels": int(total_uploaded_models or 0),
            "usersLastMinute": users_last_minute,
        },
        "minuteUsers": minute_user_series,
        "channels": channels,
        "hourly": [{"bucket": row["bucket"], "count": row["count"]} for row in hourly_rows],
        "recent": [_row_to_dict(row) for row in rows],
    }
