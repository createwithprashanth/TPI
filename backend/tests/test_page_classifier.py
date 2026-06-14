from app.modules.instrumap.core.page_classifier import classify_page_for_instruments


def test_skips_low_density_crs_cover_sheet():
    text = """
    Prepared By: VK Revision No: B Checked By: DV
    1. Revise and Re-submit 2. Approved with comments
    Page No. Clause No. For Information only
    """

    result = classify_page_for_instruments(text, word_count=150, drawing_count=48)

    assert result.kind == "admin"
    assert result.should_extract is False
    assert result.admin_score >= 3


def test_keeps_dense_pid_even_with_title_block_words():
    text = """
    Prepared By: VK Revision No: B
    SMART POSITIONER 1527 FZT 1527 FZLC 2036 LG ESD 1 3549 PI
    """

    result = classify_page_for_instruments(text, word_count=1800, drawing_count=2400)

    assert result.kind == "drawing"
    assert result.should_extract is True


def test_keeps_unknown_page_when_skip_evidence_is_weak():
    result = classify_page_for_instruments("small drawing note", word_count=40, drawing_count=80)

    assert result.kind == "unknown"
    assert result.should_extract is True
