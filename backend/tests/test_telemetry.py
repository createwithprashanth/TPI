"""
Tests for app/modules/telemetry.py

All tests use a temp directory — nothing written to the real logs/runs/.
"""
import json
import os
import tempfile

from app.modules.telemetry import RunLogger


class TestRunLogger:

    def _make(self, tmpdir) -> RunLogger:
        return RunLogger("test_drawing", logs_dir=tmpdir)

    # ── flush creates the expected files ─────────────────────────────────────

    def test_flush_creates_jsonl_and_txt(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            rl = self._make(tmpdir)
            jsonl_path, txt_path = rl.flush()
            assert os.path.exists(jsonl_path)
            assert os.path.exists(txt_path)

    def test_latest_txt_always_updated(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            self._make(tmpdir).flush()
            assert os.path.exists(os.path.join(tmpdir, "latest.txt"))

    def test_empty_run_does_not_crash(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            jsonl_path, _ = self._make(tmpdir).flush()
            events = [json.loads(l) for l in open(jsonl_path)]
            types = [e["event"] for e in events]
            assert "run_start" in types
            assert "run_end"   in types

    # ── JSONL events ──────────────────────────────────────────────────────────

    def test_all_logged_events_appear_in_jsonl(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            rl = self._make(tmpdir)
            rl.log_path("ocr")
            rl.log_lines(page=1, line_numbers=['6"-P-1001', '4"-IA-2001'])
            rl.log_instruments(page=1, tags=["101-FT-001", "101-PT-002"])
            rl.log_llm_skip(page=1, reason="Ollama not available")
            jsonl_path, _ = rl.flush()
            types = [json.loads(l)["event"] for l in open(jsonl_path)]
            assert "path_selected"        in types
            assert "lines_extracted"      in types
            assert "instruments_extracted" in types
            assert "llm_skip"             in types
            assert "run_end"              in types

    def test_llm_call_fields_persisted(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            rl = self._make(tmpdir)
            rl.log_llm_call(
                page=1, tag="101-FT-001", ix=520, iy=310,
                candidates=[('6"-P-1001', 100, 100, 18.0, "6", "P")],
                raw_response={"line_number": "6in-P-1001", "confidence": 0.9, "reason": "closest"},
                resolved_line='6"-P-1001', confidence=0.9,
                reason="closest", latency_ms=450.0, accepted=True,
            )
            jsonl_path, _ = rl.flush()
            events = [json.loads(l) for l in open(jsonl_path)]
            call = next(e for e in events if e["event"] == "llm_call")
            assert call["tag"]           == "101-FT-001"
            assert call["accepted"]      is True
            assert call["confidence"]    == 0.9
            assert call["latency_ms"]    == 450.0
            assert call["resolved_line"] == '6"-P-1001'
            assert len(call["candidates"]) == 1
            assert call["candidates"][0]["ln"] == '6"-P-1001'

    def test_rejected_llm_call_recorded(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            rl = self._make(tmpdir)
            rl.log_llm_call(
                page=1, tag="101-FT-001", ix=100, iy=100,
                candidates=[], raw_response=None,
                resolved_line="", confidence=0.3,
                reason="", latency_ms=200.0, accepted=False,
            )
            jsonl_path, _ = rl.flush()
            events = [json.loads(l) for l in open(jsonl_path)]
            call = next(e for e in events if e["event"] == "llm_call")
            assert call["accepted"] is False

    # ── Human-readable summary ────────────────────────────────────────────────

    def test_summary_contains_filename_and_path(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            rl = RunLogger("drawing_abc", logs_dir=tmpdir)
            rl.log_path("pymupdf")
            _, txt_path = rl.flush()
            txt = open(txt_path).read()
            assert "drawing_abc" in txt
            assert "pymupdf"     in txt

    def test_summary_contains_line_numbers_and_tags(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            rl = self._make(tmpdir)
            rl.log_lines(page=1, line_numbers=['6"-P-1001', '4"-IA-2001'])
            rl.log_instruments(page=1, tags=["101-FT-001"])
            _, txt_path = rl.flush()
            txt = open(txt_path).read()
            assert '6"-P-1001'  in txt
            assert '4"-IA-2001' in txt
            assert "101-FT-001" in txt

    def test_summary_shows_llm_table(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            rl = self._make(tmpdir)
            rl.log_llm_call(
                page=1, tag="101-FT-001", ix=520, iy=310,
                candidates=[('6"-P-1001', 100, 100, 18.0, "6", "P")],
                raw_response=None, resolved_line='6"-P-1001',
                confidence=0.9, reason="nearest pipe", latency_ms=300.0, accepted=True,
            )
            _, txt_path = rl.flush()
            txt = open(txt_path).read()
            assert "101-FT-001"   in txt
            assert "nearest pipe" in txt
            assert "0.90"         in txt

    def test_summary_totals_section(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            rl = self._make(tmpdir)
            rl.log_instruments(page=1, tags=["101-FT-001", "101-PT-002"])
            rl.log_lines(page=1, line_numbers=['6"-P-1001'])
            _, txt_path = rl.flush()
            txt = open(txt_path).read()
            assert "Total instruments" in txt
            assert "Total line numbers" in txt
