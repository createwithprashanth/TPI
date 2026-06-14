"""
Tests for app/modules/instrumap/core/line_extractor.py

All tests are pure — no OCR, no PDF, no network calls.
OCR word data is synthesised as plain dicts matching the Vision API shape.
"""
import pandas as pd


# ── _try_parse ────────────────────────────────────────────────────────────────

class TestTryParse:
    def _p(self, text):
        from app.modules.instrumap.core.line_extractor import _try_parse
        return _try_parse(text)

    # Happy path — various real-world line number formats
    def test_imperial_with_inch_mark(self):
        r = self._p('6"-P-1001-A1A')
        assert r is not None
        assert r["Line_Number"] == "6-P-1001-A1A"
        assert r["Pipe_Size"] == "6"
        assert r["Fluid_Code"] == "P"
        assert r["Size_Unit"] == "in"

    def test_metric_dn_prefix(self):
        r = self._p("DN100-CS-3001")
        assert r is not None
        assert r["Line_Number"] == "DN100-CS-3001"
        assert r["Size_Unit"] == "DN (mm)"

    def test_line_with_area_and_suffixes(self):
        r = self._p('4"-IA-2001-256620-J-P')
        assert r is not None
        assert r["Area_Code"] == "256620"
        assert r["Insulation"] == "J"
        assert r["Spec"] == "P"

    def test_strips_glued_instrument_suffix_from_final_spec(self):
        r = self._p('2"-PG-24468-251482-X-N18')
        assert r is not None
        assert r["Line_Number"] == "2-PG-24468-251482-X-N"
        assert r["Spec"] == "N"

    def test_small_bore_half_inch(self):
        r = self._p('0.5"-IA-101')
        assert r is not None
        assert r["Pipe_Size"] == "0.5"

    def test_unicode_inch_mark_normalised(self):
        r = self._p("6”-P-1001")   # right double quotation mark
        assert r is not None

    def test_lowercase_input_accepted(self):
        r = self._p('6"-p-1001')
        assert r is not None
        assert r["Fluid_Code"] == "P"

    # Rejection cases
    def test_rejects_unknown_pipe_size(self):
        assert self._p("7-P-1001") is None       # 7" not in known sizes

    def test_rejects_vowel_fluid_code(self):
        assert self._p('6"-A-1001') is None       # A is a vowel noise rejection
        assert self._p('6"-E-1001') is None

    def test_rejects_non_numeric_start(self):
        assert self._p("GATE-VALVE-1001") is None

    def test_rejects_empty_string(self):
        assert self._p("") is None

    def test_rejects_random_text(self):
        assert self._p("FLOW INDICATOR") is None

    def test_rejects_annotation_words_as_fluid_code(self):
        assert self._p('2"-NOTE-253461-Y') is None
        assert self._p('2"-ANSI-2500') is None

    def test_rejects_instrument_tag_fragments_as_line_numbers(self):
        assert self._p("24-LG-2005-LT") is None
        assert self._p("16-FT-1626-B-5642-A") is None

    def test_rejects_partial_match(self):
        # Sequence number too short (< 3 digits)
        assert self._p('6"-P-10') is None

    def test_line_number_without_area_code(self):
        r = self._p('6"-P-1001')
        assert r is not None
        assert r["Area_Code"] == ""
        assert "A1A" not in r["Line_Number"]


# ── extract_line_numbers ──────────────────────────────────────────────────────

def _word(text: str, x: int, y: int, w: int = 60, h: int = 20) -> dict:
    """Synthesise a word dict in the full internal format expected by line_extractor."""
    return {
        "text":     text,
        "x":        x,
        "y":        y,
        "w":        w,
        "h":        h,
        "center_x": x + w // 2,
        "center_y": y + h // 2,
    }


class TestExtractLineNumbers:
    def _extract(self, words, filename_base="drawing_p1"):
        from app.modules.instrumap.core.line_extractor import extract_line_numbers
        return extract_line_numbers(words, filename_base)

    def test_empty_input_returns_empty_df(self):
        df = self._extract([])
        assert isinstance(df, pd.DataFrame)
        assert df.empty

    def test_pass1_single_token_match(self):
        # Full line number in one OCR token
        words = [_word('6"-P-1001-A1A', x=100, y=100)]
        df = self._extract(words)
        assert len(df) == 1
        assert df.iloc[0]["Line_Number"] == "6-P-1001-A1A"

    def test_pass2_hyphen_join(self):
        # Line number split across two tokens on the same horizontal line
        words = [
            _word('6"',     x=100, y=100, w=30),
            _word('P-1001', x=140, y=100, w=80),
        ]
        df = self._extract(words)
        assert len(df) == 1
        assert "P-1001" in df.iloc[0]["Line_Number"]

    def test_deduplication(self):
        # Same line number appears on the page twice — should be one row
        words = [
            _word('6"-P-1001', x=100, y=100),
            _word('6"-P-1001', x=100, y=400),
        ]
        df = self._extract(words)
        assert len(df) == 1

    def test_coordinates_populated(self):
        words = [_word('6"-P-1001', x=100, y=200)]
        df = self._extract(words)
        assert "Coordinates" in df.columns
        assert df.iloc[0]["Coordinates"] != ""

    def test_filename_parsed_correctly(self):
        words = [_word('6"-P-1001', x=100, y=100)]
        df = self._extract(words, filename_base="pid_drawing_p3")
        assert df.iloc[0]["P&ID_Filename"] == "pid_drawing.pdf"
        assert df.iloc[0]["P&ID_Page"] == 3

    def test_multiple_distinct_lines(self):
        words = [
            _word('6"-P-1001', x=100, y=100),
            _word('4"-IA-2001', x=100, y=300),
            _word('2"-SW-3001', x=100, y=500),
        ]
        df = self._extract(words)
        assert len(df) == 3

    def test_noise_tokens_not_extracted(self):
        words = [
            _word("NORTH",  x=10,  y=10),
            _word("P&ID",   x=100, y=10),
            _word("A",      x=200, y=10),   # too short
            _word("6\"-P-1001", x=100, y=200),
        ]
        df = self._extract(words)
        # Only the real line number should survive
        assert len(df) == 1
        assert df.iloc[0]["Fluid_Code"] == "P"

    def test_pass4_inch_mark_anchor(self):
        # Pass 4: size+inch mark anchor with large gap to the rest of the tag
        words = [
            _word('6"',      x=100, y=100, w=25),
            # large gap
            _word('P-1001',  x=400, y=100, w=80),
        ]
        df = self._extract(words)
        # Should find via pass 4 inch-mark anchor search
        assert len(df) >= 1
