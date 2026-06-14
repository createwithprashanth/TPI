from pathlib import Path

import pytest

from app.modules.instrumap.core.level2_extraction_pymupdf import extract_from_pdf


TESTPID_SAMPLE = Path("/Users/prashanththipparthi/Desktop/XYRA Studio/learning_review/testpid/13-00-202-0.pdf")


@pytest.mark.skipif(not TESTPID_SAMPLE.exists(), reason="local learning_review/testpid sample not available")
def test_testpid_cover_page_is_not_extracted_as_instrument_or_line_page():
    instruments, lines, stats = extract_from_pdf(str(TESTPID_SAMPLE), TESTPID_SAMPLE.stem, dpi=300)

    assert stats["skipped_pages"][0]["page"] == 1
    assert set(instruments["P&ID_Page"].unique()) == {2}
    if not lines.empty:
        assert 1 not in set(lines["P&ID_Page"].unique())
