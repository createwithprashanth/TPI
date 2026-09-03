"""
Run telemetry for TPI P&ID analysis.

Writes one JSONL event file and one human-readable summary (.txt) per run to
logs/runs/ in the project root.  Both are gitignored — they live only on disk
for local inspection and debugging.

Usage:
    rl = RunLogger("drawing_p1")
    rl.log_path("pymupdf")
    rl.log_lines(page=1, line_numbers=["6\"-P-1001", ...])
    rl.log_instruments(page=1, tags=["101-FT-001", ...])
    rl.flush()   # returns (jsonl_path, txt_path)
"""
import json
import os
import time
from datetime import datetime, timezone
from typing import Optional

# backend/app/modules/ → ../../.. → project root
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_DEFAULT_LOGS_DIR = os.path.join(_REPO_ROOT, "logs", "runs")


class RunLogger:
    def __init__(self, filename_base: str, logs_dir: Optional[str] = None):
        self._events: list = []
        self._t0 = time.monotonic()
        self._filename_base = filename_base
        self._ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
        self._logs_dir = logs_dir or os.getenv("TPI_LOGS_DIR", _DEFAULT_LOGS_DIR)
        self._append("run_start", filename=filename_base)

    # ── Low-level ─────────────────────────────────────────────────────────────

    def _append(self, event: str, **kwargs) -> None:
        self._events.append({
            "ts": datetime.now(timezone.utc).isoformat(),
            "event": event,
            **kwargs,
        })

    # ── Convenience loggers ───────────────────────────────────────────────────

    def log_path(self, path: str) -> None:
        """Record whether 'pymupdf' (vector) or 'ocr' (scanned) path was taken."""
        self._append("path_selected", path=path)

    def log_lines(self, page: int, line_numbers: list) -> None:
        self._append("lines_extracted", page=page,
                     count=len(line_numbers), line_numbers=line_numbers)

    def log_instruments(self, page: int, tags: list) -> None:
        self._append("instruments_extracted", page=page,
                     count=len(tags), tags=tags)

    # ── Flush ─────────────────────────────────────────────────────────────────

    def flush(self) -> tuple:
        """Write JSONL + summary. Returns (jsonl_path, txt_path)."""
        self._append("run_end", duration_s=round(time.monotonic() - self._t0, 2))

        os.makedirs(self._logs_dir, exist_ok=True)
        stem        = f"{self._ts}_{self._filename_base}"
        jsonl_path  = os.path.join(self._logs_dir, f"{stem}.jsonl")
        txt_path    = os.path.join(self._logs_dir, f"{stem}.txt")
        latest_path = os.path.join(self._logs_dir, "latest.txt")

        with open(jsonl_path, "w", encoding="utf-8") as fh:
            for ev in self._events:
                fh.write(json.dumps(ev, ensure_ascii=False) + "\n")

        summary = _build_summary(self._events)
        for path in (txt_path, latest_path):
            try:
                with open(path, "w", encoding="utf-8") as fh:
                    fh.write(summary)
            except OSError:
                pass

        return jsonl_path, txt_path


# ── Summary renderer ──────────────────────────────────────────────────────────

_W = 72


def _build_summary(events: list) -> str:
    out = []

    run_start = _first(events, "run_start") or {}
    run_end   = _first_rev(events, "run_end") or {}
    path_ev   = _first(events, "path_selected") or {}

    out += [
        "=" * _W,
        "  TPI — P&ID Analysis Run Log",
        f"  File    : {run_start.get('filename', '?')}",
        f"  Started : {run_start.get('ts', '?')}",
        f"  Path    : {path_ev.get('path', 'unknown')}",
        f"  Duration: {run_end.get('duration_s', '?')} s",
        "=" * _W,
    ]

    pages = sorted({e["page"] for e in events if "page" in e})
    for page in pages:
        evs       = [e for e in events if e.get("page") == page]
        lines_ev  = _first(evs, "lines_extracted")
        instr_ev  = _first(evs, "instruments_extracted")

        out.append(f"\n── Page {page} " + "─" * (_W - 10))

        if lines_ev:
            lns = ", ".join(lines_ev.get("line_numbers", []))
            out.append(f"  Lines      ({lines_ev.get('count', 0)}): {lns or '—'}")

        if instr_ev:
            tags = ", ".join(instr_ev.get("tags", []))
            out.append(f"  Instruments({instr_ev.get('count', 0)}): {tags or '—'}")

    # ── Totals ────────────────────────────────────────────────────────────────
    total_instr = sum(
        e.get("count", 0) for e in events if e["event"] == "instruments_extracted"
    )
    total_lines = sum(
        e.get("count", 0) for e in events if e["event"] == "lines_extracted"
    )
    out += [
        "",
        "─" * _W,
        f"  Total instruments : {total_instr}",
        f"  Total line numbers: {total_lines}",
        "=" * _W,
        "",
    ]
    return "\n".join(out)


def _first(events, event_type):
    return next((e for e in events if e["event"] == event_type), None)


def _first_rev(events, event_type):
    return next((e for e in reversed(events) if e["event"] == event_type), None)
