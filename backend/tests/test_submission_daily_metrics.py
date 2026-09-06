from __future__ import annotations

import sqlite3

from app import submission_telemetry


def _insert_submission(
    connection: sqlite3.Connection,
    *,
    job_id: str,
    submitted_at: str,
    user_id: str,
) -> None:
    connection.execute(
        """
        INSERT INTO submission_telemetry (
            job_id, submission_id, client_key, artwork_id, source_filename,
            status, success, submitted_at, input_bytes, output_bytes, user_id
        ) VALUES (?, ?, ?, ?, 'source.png', 'ready', 1, ?, 1, 1, ?)
        """,
        (job_id, job_id, user_id, f"artwork-{job_id}", submitted_at, user_id),
    )


def test_daily_minute_series_covers_full_shanghai_day_and_persists_history(tmp_path, monkeypatch):
    database_path = tmp_path / "cosmos.db"
    monkeypatch.setattr(submission_telemetry, "DB_PATH", database_path)
    submission_telemetry.ensure_submission_telemetry_schema()

    with sqlite3.connect(database_path) as connection:
        _insert_submission(
            connection,
            job_id="midnight-a",
            submitted_at="2026-08-13T16:00:10+00:00",
            user_id="user-a",
        )
        _insert_submission(
            connection,
            job_id="midnight-a-repeat",
            submitted_at="2026-08-13T16:00:40+00:00",
            user_id="user-a",
        )
        _insert_submission(
            connection,
            job_id="noon-b",
            submitted_at="2026-08-14T04:30:00+00:00",
            user_id="user-b",
        )
        _insert_submission(
            connection,
            job_id="next-day",
            submitted_at="2026-08-14T16:00:00+00:00",
            user_id="user-c",
        )
        connection.commit()

    metrics = submission_telemetry.get_submission_metrics(
        chart_date="2026-08-14",
        timezone_offset_minutes=480,
        limit=1,
    )

    assert len(metrics["minuteUsers"]) == 24 * 60
    assert metrics["minuteUsers"][0]["timestamp"] == "2026-08-14T00:00:00+08:00"
    assert metrics["minuteUsers"][-1]["timestamp"] == "2026-08-14T23:59:00+08:00"
    assert metrics["minuteUsers"][0]["count"] == 1
    assert metrics["minuteUsers"][12 * 60 + 30]["count"] == 1
    assert metrics["daily"]["totalUploads"] == 3
    assert metrics["daily"]["uniqueUsers"] == 2
    assert metrics["daily"]["availableDates"][-1] == "2026-08-14"
    assert "2026-08-15" in metrics["daily"]["availableDates"]
    assert metrics["summary"]["totalUploadedModels"] == 4

    historical = submission_telemetry.get_submission_metrics(
        chart_date="2026-08-15",
        timezone_offset_minutes=480,
        limit=1,
    )
    assert historical["minuteUsers"][0]["count"] == 1
    assert historical["summary"]["totalUploadedModels"] == 4
