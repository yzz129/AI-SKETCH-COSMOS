from app import submission_telemetry


def _context(user_id: str = "user-1", booking_id: str = "booking-1") -> dict:
    return {
        "user": {"id": user_id, "raw": {}},
        "booking": {"id": booking_id, "code": "123456", "raw": {}},
    }


def test_one_active_or_ready_submission_per_user(tmp_path, monkeypatch):
    monkeypatch.setattr(submission_telemetry, "DB_PATH", tmp_path / "cosmos.db")
    context = _context()

    assert submission_telemetry.get_submission_eligibility(context)["eligible"] is True
    first = submission_telemetry.claim_submission_opportunity(
        user_context=context,
        job_id="job-1",
        submission_id="submission-1",
        artwork_id="artwork-1",
    )
    assert first["eligible"] is True

    duplicate = submission_telemetry.claim_submission_opportunity(
        user_context=context,
        job_id="job-2",
        submission_id="submission-2",
        artwork_id="artwork-2",
    )
    assert duplicate["eligible"] is False
    assert duplicate["artworkId"] == "artwork-1"

    submission_telemetry.record_submission_finished(
        job_id="job-1",
        status="ready",
        success=True,
        total_ms=100,
    )
    assert submission_telemetry.get_submission_eligibility(context)["eligible"] is False


def test_failed_submission_releases_opportunity_for_retry(tmp_path, monkeypatch):
    monkeypatch.setattr(submission_telemetry, "DB_PATH", tmp_path / "cosmos.db")
    context = _context()
    submission_telemetry.claim_submission_opportunity(
        user_context=context,
        job_id="job-failed",
        submission_id="submission-failed",
        artwork_id="artwork-failed",
    )
    submission_telemetry.record_submission_finished(
        job_id="job-failed",
        status="failed",
        success=False,
        total_ms=100,
        error_message="generation failed",
    )

    retry = submission_telemetry.claim_submission_opportunity(
        user_context=context,
        job_id="job-retry",
        submission_id="submission-retry",
        artwork_id="artwork-retry",
    )
    assert retry["eligible"] is True


def test_controlled_test_user_is_exempt(tmp_path, monkeypatch):
    monkeypatch.setattr(submission_telemetry, "DB_PATH", tmp_path / "cosmos.db")
    context = _context(user_id="submit-test-user", booking_id="submit-test-booking")
    context["user"]["raw"] = {"testMode": True}

    first = submission_telemetry.claim_submission_opportunity(
        user_context=context,
        job_id="test-job-1",
        submission_id="test-submission-1",
        artwork_id="test-artwork-1",
    )
    second = submission_telemetry.claim_submission_opportunity(
        user_context=context,
        job_id="test-job-2",
        submission_id="test-submission-2",
        artwork_id="test-artwork-2",
    )
    assert first["eligible"] is True
    assert second["eligible"] is True
    assert second["testMode"] is True
