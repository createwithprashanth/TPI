"""
Tests for app/modules/llm/line_mapper.py

All LLM calls are mocked — no real Ollama needed.
Pure-function tests run without any mocking at all.
"""
import pandas as pd
import pytest
from unittest.mock import patch


# ── _safe_ln ──────────────────────────────────────────────────────────────────

class TestSafeLn:
    def test_replaces_double_quote_inch_mark(self):
        from app.modules.llm.line_mapper import _safe_ln
        assert _safe_ln('6"-P-1001') == "6in-P-1001"

    def test_replaces_unicode_inch_marks(self):
        from app.modules.llm.line_mapper import _safe_ln
        assert _safe_ln("6″-P-1001") == "6in-P-1001"   # ″
        assert _safe_ln("6′-P-1001") == "6in-P-1001"   # ′

    def test_passthrough_when_no_inch_mark(self):
        from app.modules.llm.line_mapper import _safe_ln
        assert _safe_ln("DN100-CS-3001") == "DN100-CS-3001"

    def test_empty_string(self):
        from app.modules.llm.line_mapper import _safe_ln
        assert _safe_ln("") == ""


# ── _resolve_line_no ──────────────────────────────────────────────────────────

class TestResolveLineNo:
    CANDIDATES = [
        ('6"-P-1001-A1A', 0, 0, 18,  '6', 'P'),
        ('4"-IA-2001',    0, 0, 340, '4', 'IA'),
        ('2"-SW-3001',    0, 0, 510, '2', 'SW'),
    ]

    def test_exact_match_returned_unchanged(self):
        from app.modules.llm.line_mapper import _resolve_line_no
        assert _resolve_line_no('6"-P-1001-A1A', self.CANDIDATES) == '6"-P-1001-A1A'

    def test_safe_form_resolves_to_original(self):
        from app.modules.llm.line_mapper import _resolve_line_no
        # Model returns inch-mark stripped form
        assert _resolve_line_no("6in-P-1001-A1A", self.CANDIDATES) == '6"-P-1001-A1A'

    def test_index_digit_resolved_to_candidate(self):
        from app.modules.llm.line_mapper import _resolve_line_no
        assert _resolve_line_no("1", self.CANDIDATES) == '6"-P-1001-A1A'
        assert _resolve_line_no("2", self.CANDIDATES) == '4"-IA-2001'
        assert _resolve_line_no("3", self.CANDIDATES) == '2"-SW-3001'

    def test_out_of_range_index_returns_raw(self):
        from app.modules.llm.line_mapper import _resolve_line_no
        assert _resolve_line_no("9", self.CANDIDATES) == "9"

    def test_partial_match_resolves(self):
        from app.modules.llm.line_mapper import _resolve_line_no
        # Model returns partial tag (missing area suffix)
        result = _resolve_line_no("6in-P-1001", self.CANDIDATES)
        assert result == '6"-P-1001-A1A'

    def test_no_match_returns_raw(self):
        from app.modules.llm.line_mapper import _resolve_line_no
        assert _resolve_line_no("8\"-CS-9999", self.CANDIDATES) == '8"-CS-9999'

    def test_empty_string_returns_empty(self):
        from app.modules.llm.line_mapper import _resolve_line_no
        assert _resolve_line_no("", self.CANDIDATES) == ""


# ── _build_candidates ─────────────────────────────────────────────────────────

class TestBuildCandidates:
    LINE_RECORDS = [
        {"line_number": "6\"-P-1001", "x": 100, "y": 100, "pipe_size": "6", "fluid_code": "P"},
        {"line_number": "4\"-IA-2001", "x": 500, "y": 500, "pipe_size": "4", "fluid_code": "IA"},
        {"line_number": "2\"-SW-3001", "x": 900, "y": 900, "pipe_size": "2", "fluid_code": "SW"},
    ]

    def test_sorted_nearest_first(self):
        from app.modules.llm.line_mapper import _build_candidates
        result = _build_candidates(110, 110, self.LINE_RECORDS)
        assert result[0][0] == '6"-P-1001'   # closest to (110,110)
        assert result[-1][0] == '2"-SW-3001' # farthest

    def test_respects_max_candidates(self):
        from app.modules.llm.line_mapper import _build_candidates, _MAX_CANDIDATES
        many = [{"line_number": f"6\"-P-{i:04d}", "x": i*10, "y": 0,
                 "pipe_size": "6", "fluid_code": "P"} for i in range(20)]
        result = _build_candidates(0, 0, many)
        assert len(result) <= _MAX_CANDIDATES

    def test_returns_correct_tuple_shape(self):
        from app.modules.llm.line_mapper import _build_candidates
        result = _build_candidates(100, 100, self.LINE_RECORDS)
        ln, lx, ly, dist, size, fluid = result[0]
        assert isinstance(ln, str)
        assert isinstance(dist, float)
        assert dist >= 0


# ── _build_prompt ─────────────────────────────────────────────────────────────

class TestBuildPrompt:
    CANDIDATES = [
        ('6"-P-1001-A1A', 520, 295, 18,  '6', 'P'),
        ('4"-IA-2001',    820, 410, 340, '4', 'IA'),
    ]

    def test_contains_tag_and_position(self):
        from app.modules.llm.line_mapper import _build_prompt
        prompt = _build_prompt("101-FT-001", 520, 310, self.CANDIDATES)
        assert "101-FT-001" in prompt
        assert "(520, 310)" in prompt

    def test_no_raw_inch_marks_in_prompt(self):
        from app.modules.llm.line_mapper import _build_prompt
        prompt = _build_prompt("101-FT-001", 520, 310, self.CANDIDATES)
        # Inch marks must be replaced so they don't break model JSON parsing
        assert '6"-P-1001' not in prompt
        assert "6in-P-1001" in prompt

    def test_contains_engineering_notes(self):
        from app.modules.llm.line_mapper import _build_prompt
        prompt = _build_prompt("101-FT-001", 520, 310, self.CANDIDATES)
        assert "Flow instruments" in prompt

    def test_empty_candidates_handled(self):
        from app.modules.llm.line_mapper import _build_prompt
        prompt = _build_prompt("101-PT-005", 100, 200, [])
        assert "none found" in prompt


# ── map_instruments_to_lines_llm — integration (mocked LLM) ──────────────────

class TestMapInstrumentsToLinesLlm:

    INSTRUMENTS = pd.DataFrame([
        {"Tag_Number": "101-FT-001", "Coordinates": "520,310", "Connected_Line": ""},
        {"Tag_Number": "101-PT-002", "Coordinates": "800,400", "Connected_Line": ""},
        {"Tag_Number": "101-LT-003", "Coordinates": "200,200", "Connected_Line": "6\"-P-9999"},
    ])

    LINES = pd.DataFrame([
        {"Line_Number": '6"-P-1001-A1A', "Pipe_Size": "6", "Size_Unit": "in",
         "Fluid_Code": "P",  "Coordinates": "520,295", "P&ID_Filename": "t.pdf", "P&ID_Page": 1},
        {"Line_Number": '4"-IA-2001',    "Pipe_Size": "4", "Size_Unit": "in",
         "Fluid_Code": "IA", "Coordinates": "810,410", "P&ID_Filename": "t.pdf", "P&ID_Page": 1},
    ])

    def _make_llm_answer(self, line_no: str, conf: float = 0.9):
        return {"line_number": line_no, "confidence": conf, "reason": "closest line"}

    def test_skips_when_ollama_unavailable(self):
        from app.modules.llm.line_mapper import map_instruments_to_lines_llm
        df = self.INSTRUMENTS.copy()
        with patch("app.modules.llm.line_mapper._is_available", return_value=False):
            result = map_instruments_to_lines_llm(df, self.LINES)
        # Unmatched rows should still be empty
        assert result.loc[result["Tag_Number"] == "101-FT-001", "Connected_Line"].iloc[0] == ""

    def test_skips_when_lines_empty(self):
        from app.modules.llm.line_mapper import map_instruments_to_lines_llm
        df = self.INSTRUMENTS.copy()
        with patch("app.modules.llm.line_mapper._is_available", return_value=True):
            result = map_instruments_to_lines_llm(df, pd.DataFrame())
        assert result.loc[result["Tag_Number"] == "101-FT-001", "Connected_Line"].iloc[0] == ""

    def test_already_matched_rows_not_overwritten(self):
        from app.modules.llm.line_mapper import map_instruments_to_lines_llm
        df = self.INSTRUMENTS.copy()
        with patch("app.modules.llm.line_mapper._is_available", return_value=True), \
             patch("app.modules.llm.line_mapper.generate",
                   return_value=self._make_llm_answer("6in-P-1001-A1A")):
            result = map_instruments_to_lines_llm(df, self.LINES)
        # Row that was already matched must keep its original value
        assert result.loc[result["Tag_Number"] == "101-LT-003", "Connected_Line"].iloc[0] == '6"-P-9999'

    def test_successful_match_writes_all_three_columns(self):
        from app.modules.llm.line_mapper import map_instruments_to_lines_llm
        df = self.INSTRUMENTS.copy()
        with patch("app.modules.llm.line_mapper._is_available", return_value=True), \
             patch("app.modules.llm.line_mapper.generate",
                   return_value=self._make_llm_answer("6in-P-1001-A1A", 0.9)):
            result = map_instruments_to_lines_llm(df, self.LINES)
        row = result.loc[result["Tag_Number"] == "101-FT-001"].iloc[0]
        assert row["Connected_Line"] == '6"-P-1001-A1A'
        assert row["Line_Confidence"] == 0.9
        assert row["Line_Reason"] == "closest line"

    def test_low_confidence_answer_not_accepted(self):
        from app.modules.llm.line_mapper import map_instruments_to_lines_llm, _MIN_CONFIDENCE
        df = self.INSTRUMENTS.copy()
        low_conf = round(_MIN_CONFIDENCE - 0.1, 2)
        with patch("app.modules.llm.line_mapper._is_available", return_value=True), \
             patch("app.modules.llm.line_mapper.generate",
                   return_value=self._make_llm_answer("6in-P-1001-A1A", low_conf)):
            result = map_instruments_to_lines_llm(df, self.LINES)
        assert result.loc[result["Tag_Number"] == "101-FT-001", "Connected_Line"].iloc[0] == ""

    def test_none_llm_response_skipped(self):
        from app.modules.llm.line_mapper import map_instruments_to_lines_llm
        df = self.INSTRUMENTS.copy()
        with patch("app.modules.llm.line_mapper._is_available", return_value=True), \
             patch("app.modules.llm.line_mapper.generate", return_value=None):
            result = map_instruments_to_lines_llm(df, self.LINES)
        assert result.loc[result["Tag_Number"] == "101-FT-001", "Connected_Line"].iloc[0] == ""

    def test_output_columns_added_even_when_no_match(self):
        from app.modules.llm.line_mapper import map_instruments_to_lines_llm
        df = pd.DataFrame([{"Tag_Number": "101-FT-001", "Coordinates": "100,100"}])
        with patch("app.modules.llm.line_mapper._is_available", return_value=False):
            result = map_instruments_to_lines_llm(df, self.LINES)
        for col in ("Connected_Line", "Line_Confidence", "Line_Reason"):
            assert col in result.columns

    def test_index_digit_response_resolved(self):
        from app.modules.llm.line_mapper import map_instruments_to_lines_llm
        df = pd.DataFrame([{"Tag_Number": "101-FT-001", "Coordinates": "520,310", "Connected_Line": ""}])
        with patch("app.modules.llm.line_mapper._is_available", return_value=True), \
             patch("app.modules.llm.line_mapper.generate",
                   return_value={"line_number": "1", "confidence": 0.85, "reason": "nearest"}):
            result = map_instruments_to_lines_llm(df, self.LINES)
        # "1" should resolve to the nearest candidate, which is 6"-P-1001-A1A at distance 15
        assert result["Connected_Line"].iloc[0] == '6"-P-1001-A1A'

    def test_missing_coordinates_row_skipped_gracefully(self):
        from app.modules.llm.line_mapper import map_instruments_to_lines_llm
        df = pd.DataFrame([
            {"Tag_Number": "101-FT-001", "Coordinates": "",     "Connected_Line": ""},
            {"Tag_Number": "101-PT-002", "Coordinates": "bad",  "Connected_Line": ""},
        ])
        with patch("app.modules.llm.line_mapper._is_available", return_value=True), \
             patch("app.modules.llm.line_mapper.generate",
                   return_value={"line_number": "6in-P-1001", "confidence": 0.9, "reason": "ok"}):
            result = map_instruments_to_lines_llm(df, self.LINES)
        # Both rows have no valid coords — should not crash, Connected_Line stays empty
        assert result["Connected_Line"].tolist() == ["", ""]
