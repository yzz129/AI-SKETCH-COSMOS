from app.content_moderation import mask_sensitive_text, normalise_moderation_result


def test_masks_explicit_sensitive_phrases_and_simple_obfuscation():
    assert mask_sensitive_text("星河色情小队") == "星河**小队"
    assert mask_sensitive_text("血-腥画家") == "***画家"
    assert mask_sensitive_text("PORNO artist") == "***** artist"


def test_does_not_mask_ambiguous_or_innocent_nicknames():
    assert mask_sensitive_text("杀人鲸之歌") == "杀人鲸之歌"
    assert mask_sensitive_text("黄色小鸭") == "黄色小鸭"
    assert mask_sensitive_text("Essex painter") == "Essex painter"
    assert mask_sensitive_text("红色颜料爆炸了") == "红色颜料爆炸了"


def test_blocks_only_high_confidence_target_categories():
    blocked = normalise_moderation_result(
        {"decision": "block", "category": "graphic_violence", "confidence": 0.91},
        threshold=0.82,
    )
    uncertain = normalise_moderation_result(
        {"decision": "block", "category": "graphic_violence", "confidence": 0.73},
        threshold=0.82,
    )
    safe = normalise_moderation_result(
        {"decision": "allow", "category": "safe", "confidence": 0.99},
        threshold=0.82,
    )

    assert blocked.allowed is False
    assert uncertain.allowed is True
    assert safe.allowed is True


def test_sexual_minor_category_uses_stricter_safety_threshold():
    result = normalise_moderation_result(
        {"decision": "block", "category": "sexual_minors", "confidence": 0.7},
        threshold=0.82,
    )

    assert result.allowed is False
