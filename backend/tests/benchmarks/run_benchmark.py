#!/usr/bin/env python3
"""
XYRA Benchmark Runner
Usage:  python run_benchmark.py [--category all|ic|noise|fgs|sis|lm] [--verbose]

IC cases have a 'method' field:
  library — calls InstrumentLogicEngine.get_epc_specs() directly (deterministic)
  llm     — calls xyra-pid-engineer via Ollama (network required)
"""
import json
import sys
import time
import argparse
from pathlib import Path

# ── path setup ────────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parents[2]   # backend/tests/benchmarks → backend
sys.path.insert(0, str(REPO_ROOT))

CASES_FILE = Path(__file__).parent / "cases.json"

# ── category map ──────────────────────────────────────────────────────────────
CATEGORIES = {
    "ic":    ("instrument_classification", "Instrument Classification"),
    "noise": ("noise",                     "Noise / Non-instrument"),
    "fgs":   ("fgs",                       "Fire & Gas"),
    "sis":   ("sis",                       "SIS / ESD"),
    "lm":    ("line_mapping",              "Line Mapping"),
}

# ── LLM callers ───────────────────────────────────────────────────────────────

def _call_library(tag: str) -> dict:
    """Call InstrumentLogicEngine.get_epc_specs() and normalize to benchmark dict."""
    from app.modules.instrumap.core.standard_library import InstrumentLogicEngine
    specs = InstrumentLogicEngine.get_epc_specs(tag)
    conf_map = {"High": 1.0, "Medium": 0.7, "Low": 0.3}
    io  = str(specs.get("IO_Type",  "") or "").strip()
    sys_ = str(specs.get("System",  "") or "").strip()
    # Normalize REVIEW state to empty (unknown instrument)
    if io   == "REVIEW": io   = ""
    if sys_ == "REVIEW": sys_ = ""
    return {
        "description": str(specs.get("Instrument_Description", "") or "").strip(),
        "io_type":     io,
        "system":      sys_,
        "confidence":  conf_map.get(str(specs.get("Confidence", "Low")), 0.3),
    }


def _call_instrument_model(tag: str, instr_type: str, loop: str) -> dict:
    from app.modules.instrumap.core.type_enricher import _NOISE_RE, _call_llm, _resolve_model
    if _NOISE_RE.match(tag):
        return {"description": "", "io_type": "", "system": "", "confidence": 0.0}
    model = _resolve_model()
    if not model:
        return {}
    return _call_llm(tag, instr_type, loop, model) or {}


def _call_line_mapper(tag: str, instr_type: str, candidates: list) -> dict:
    import json as _json
    import urllib.request
    from app.modules.llm.service import LINE_MAPPER_MODEL, OLLAMA_BASE_URL

    prompt = (
        f"Classify connection for tag {tag} (type {instr_type}). "
        f"Candidates: {_json.dumps(candidates)}. Return ONLY JSON."
    )
    payload = _json.dumps({
        "model": LINE_MAPPER_MODEL,
        "prompt": prompt,
        "format": "json",
        "stream": False,
        "options": {"temperature": 0.05, "num_predict": 200},
    }).encode()
    req = urllib.request.Request(
        f"{OLLAMA_BASE_URL}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = _json.loads(resp.read())
            return _json.loads(raw.get("response", "{}"))
    except Exception:
        return {}


# ── checkers ─────────────────────────────────────────────────────────────────

def _check_instrument(case: dict, result: dict) -> tuple[bool, str]:
    exp = case["expect"]
    conf = float(result.get("confidence", 0.0))
    io   = str(result.get("io_type", "")).strip()
    sys_ = str(result.get("system", "")).strip()
    desc = str(result.get("description", "")).strip()

    if conf < float(exp.get("confidence_min", 0.0)):
        return False, f"conf {conf:.2f} < {exp['confidence_min']}"

    if "io_type" in exp and io != exp["io_type"]:
        return False, f"io_type={io!r} expected {exp['io_type']!r}"

    if "system" in exp and sys_ != exp["system"]:
        return False, f"system={sys_!r} expected {exp['system']!r}"

    missing = [w for w in exp.get("description_contains", []) if w.lower() not in desc.lower()]
    if missing:
        return False, f"description missing: {missing} — got {desc!r}"

    return True, ""


def _check_noise(case: dict, result: dict) -> tuple[bool, str]:
    conf = float(result.get("confidence", 0.0))
    max_conf = float(case["expect"].get("confidence_max", 0.10))
    if conf > max_conf:
        return False, f"conf {conf:.2f} > {max_conf} — model treated noise as instrument"
    return True, ""


def _check_line(case: dict, result: dict) -> tuple[bool, str]:
    exp     = case["expect"]
    got_ln  = str(result.get("line_number", "")).strip()
    exp_ln  = str(exp.get("line_number", "")).strip()
    conf    = float(result.get("confidence", 0.0))

    if got_ln != exp_ln:
        return False, f"line={got_ln!r} expected {exp_ln!r}"

    if exp_ln != "" and conf < float(exp.get("confidence_min", 0.0)):
        return False, f"conf {conf:.2f} < {exp['confidence_min']}"

    return True, ""


# ── runner ────────────────────────────────────────────────────────────────────

def _dispatch(key: str, case: dict) -> tuple[dict, tuple[bool, str]]:
    """Call the right model + checker for the given category and case."""
    tag    = case["tag"]
    typ    = case.get("type", "")
    loop   = case.get("loop", "")
    method = case.get("method", "llm")

    if key == "lm":
        result = _call_line_mapper(tag, typ, case.get("candidates", []))
        return result, _check_line(case, result)

    if key == "noise":
        result = _call_instrument_model(tag, typ, loop)
        return result, _check_noise(case, result)

    # ic / fgs / sis — method field selects library or llm
    if method == "library":
        result = _call_library(tag)
    else:
        result = _call_instrument_model(tag, typ, loop)
    return result, _check_instrument(case, result)


def run_category(key: str, cases: list, verbose: bool) -> dict:
    passed = failed = errors = 0
    failures = []

    for case in cases:
        cid    = case["id"]
        tag    = case["tag"]
        method = case.get("method", "llm")
        src    = f"[{method}]" if "method" in case else ""

        t0 = time.monotonic()
        try:
            result, (ok, reason) = _dispatch(key, case)
        except Exception as exc:
            ok, reason, result = False, f"EXCEPTION: {exc}", {}
            errors += 1

        elapsed = (time.monotonic() - t0) * 1000

        if ok:
            passed += 1
            if verbose:
                print(f"  ✓ {cid} {tag:<22} {src} ({elapsed:.0f}ms)", flush=True)
        else:
            failed += 1
            got_desc = result.get("description") or result.get("line_number", "")
            failures.append((cid, tag, reason, got_desc, elapsed))
            print(f"  ✗ {cid} {tag:<22} {src} FAIL: {reason}  got={got_desc!r:.40}  ({elapsed:.0f}ms)", flush=True)

    return {"passed": passed, "failed": failed, "errors": errors, "failures": failures}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--category", default="all",
                        help="all | ic | noise | fgs | sis | lm")
    parser.add_argument("--verbose", action="store_true",
                        help="Print passing cases too")
    args = parser.parse_args()

    with open(CASES_FILE) as f:
        data = json.load(f)

    selected = (
        list(CATEGORIES.keys())
        if args.category == "all"
        else [args.category]
    )

    totals = {"passed": 0, "failed": 0, "errors": 0}
    t_start = time.monotonic()

    print("=" * 70, flush=True)
    print("  XYRA BENCHMARK", flush=True)
    print("=" * 70, flush=True)

    for key in selected:
        json_key, label = CATEGORIES[key]
        cases = data.get(json_key, [])
        if not cases:
            continue

        lib_count = sum(1 for c in cases if c.get("method") == "library")
        llm_count = sum(1 for c in cases if c.get("method") == "llm")
        if lib_count + llm_count > 0:
            print(f"\n── {label} ({len(cases)} cases: {lib_count} library, {llm_count} llm) ──", flush=True)
        else:
            print(f"\n── {label} ({len(cases)} cases) ──", flush=True)

        result = run_category(key, cases, args.verbose)
        for k in ("passed", "failed", "errors"):
            totals[k] += result[k]
        pct = 100 * result["passed"] // len(cases) if cases else 0
        print(f"  → {result['passed']}/{len(cases)} passed  ({pct}%)", flush=True)

    elapsed_total = time.monotonic() - t_start
    total_cases   = totals["passed"] + totals["failed"]
    total_pct     = 100 * totals["passed"] // total_cases if total_cases else 0

    print(flush=True)
    print("=" * 70, flush=True)
    print(f"  TOTAL  {totals['passed']}/{total_cases} passed  ({total_pct}%)   "
          f"time={elapsed_total:.1f}s", flush=True)
    if totals["errors"]:
        print(f"  ERRORS {totals['errors']} (model unavailable or exception)", flush=True)
    print("=" * 70, flush=True)

    sys.exit(0 if totals["failed"] == 0 else 1)


if __name__ == "__main__":
    main()
