from backend.app import designer_hunyuan


def test_designer_service_no_longer_requires_confirmation():
    assert designer_hunyuan.designer_service_status()["confirmationRequired"] is False


def test_publish_request_is_idempotent_while_publication_is_in_progress(monkeypatch):
    job_id = "designer-job-auto-publish-test"
    monkeypatch.setitem(
        designer_hunyuan._jobs,
        job_id,
        designer_hunyuan.DesignerGenerationJob(
            id=job_id,
            name="auto publish",
            referenceMode="single",
            status="publishing",
        ),
    )

    result = designer_hunyuan.confirm_designer_job(job_id)

    assert result is not None
    assert result["status"] == "publishing"


def test_partial_publication_restores_missing_glb_without_duplicate(monkeypatch, tmp_path):
    job_id = "designer-job-partial-publish-test"
    model_id = "designer-existing-model"
    data_root = tmp_path / "designer-generations"
    exhibition_root = tmp_path / "exhibition-models"
    preview_path = data_root / job_id / "preview.glb"
    preview_path.parent.mkdir(parents=True)
    preview_path.write_bytes(b"glTF-restored-model")
    missing_target = exhibition_root / f"{model_id}.glb"

    monkeypatch.setattr(designer_hunyuan, "DATA_ROOT", data_root)
    monkeypatch.setattr(designer_hunyuan, "EXHIBITION_ROOT", exhibition_root)
    monkeypatch.setattr(
        designer_hunyuan,
        "get_exhibition_model",
        lambda requested_id: {
            "id": requested_id,
            "modelUrl": f"/exhibition-models/{model_id}.glb",
        } if requested_id == model_id else None,
    )
    published = []
    monkeypatch.setattr(
        designer_hunyuan,
        "record_submission_published",
        lambda **payload: published.append(payload),
    )
    monkeypatch.setitem(
        designer_hunyuan._jobs,
        job_id,
        designer_hunyuan.DesignerGenerationJob(
            id=job_id,
            name="partial publish",
            referenceMode="single",
            status="review",
            pendingPath=str(missing_target),
            modelId=model_id,
            modelUrl=f"/triposplat/exhibition-models/{model_id}.glb",
        ),
    )

    result = designer_hunyuan.confirm_designer_job(job_id)

    assert result is not None
    assert result["status"] == "ready"
    assert result["modelId"] == model_id
    assert missing_target.read_bytes() == b"glTF-restored-model"
    assert published == [{"job_id": job_id, "model_id": model_id}]
