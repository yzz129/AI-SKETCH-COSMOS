from app import ai_model_registry as registry


def test_extract_response_text_ignores_reasoning_blocks():
    payload = {
        "output": [
            {"type": "reasoning", "text": "这不是最终 JSON"},
            {"type": "message", "content": [
                {"type": "output_text", "text": '{"ok": true}'},
            ]},
        ]
    }

    assert registry.extract_response_text(payload) == '{"ok": true}'


def test_extract_response_text_reads_hunyuan_message():
    payload = {"Choices": [{"Message": {"Content": '{"ok": true}'}}]}

    assert registry.extract_response_text(payload) == '{"ok": true}'


def test_vision_falls_back_from_ark_to_hunyuan(monkeypatch):
    monkeypatch.setenv("ARK_API_KEY", "configured")
    monkeypatch.setenv("TENCENT_SECRET_ID", "configured")
    monkeypatch.setenv("TENCENT_SECRET_KEY", "configured")
    monkeypatch.setattr(registry, "ark_vision_models", lambda: ("ark-a", "ark-b"))
    monkeypatch.setattr(registry, "hunyuan_vision_models", lambda: ("hunyuan-a",))
    monkeypatch.setattr(
        registry,
        "_ark_vision_completion",
        lambda *_: (_ for _ in ()).throw(RuntimeError("unavailable")),
    )
    monkeypatch.setattr(registry, "_hunyuan_vision_completion", lambda *_: "OK")

    completion = registry.complete_vision("data:image/png;base64,AA==", "probe")

    assert completion.provider == "tencent-hunyuan"
    assert completion.model == "hunyuan-a"


def test_reference_generation_falls_back_to_hunyuan(monkeypatch):
    monkeypatch.setenv("ARK_API_KEY", "configured")
    monkeypatch.setenv("TENCENT_SECRET_ID", "configured")
    monkeypatch.setenv("TENCENT_SECRET_KEY", "configured")
    monkeypatch.setattr(registry, "ark_image_models", lambda: ("seedream-a",))
    monkeypatch.setattr(
        registry,
        "_generate_ark_image",
        lambda *_: (_ for _ in ()).throw(RuntimeError("unavailable")),
    )
    monkeypatch.setattr(registry, "_generate_hunyuan_image", lambda *_: b"image")

    generated = registry.generate_reference_image(
        "data:image/png;base64,AA==",
        "prompt",
    )

    assert generated.payload == b"image"
    assert generated.provider == "tencent-hunyuan"
    assert generated.model == "SubmitHunyuanImageJob"
