"""
Batch quality test — runs all PIDs in a folder through the full InstruMap pipeline
and drops the combined ZIP to ~/Downloads.

Usage:
    cd backend
    .venv/bin/python batch_test.py
"""
import logging
import os
import shutil
import sys
import time
import uuid
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger("batch_test")

PID_FOLDER   = Path("/Users/prashanththipparthi/Downloads/Zoho WorkDrive")
OUTPUT_BASE  = Path(__file__).parent / "batch_outputs"
BATCH_ID     = f"batch_quality_{time.strftime('%Y%m%d_%H%M%S')}"
BATCH_DIR    = OUTPUT_BASE / BATCH_ID
DOWNLOAD_DST = Path.home() / "Downloads" / f"InstruMap_QualityTest_{BATCH_ID}.zip"

from app.workers.instrumap_tasks import process_pid_task


def run():
    pdf_files = sorted(PID_FOLDER.glob("*.pdf"))
    if not pdf_files:
        logger.error("No PDFs found in %s", PID_FOLDER)
        sys.exit(1)

    logger.info("Found %d PDFs — batch_id=%s", len(pdf_files), BATCH_ID)
    BATCH_DIR.mkdir(parents=True, exist_ok=True)

    results_summary = []

    for i, pdf_path in enumerate(pdf_files, 1):
        job_id = str(uuid.uuid4())
        logger.info("[%d/%d] Processing: %s  (job=%s)", i, len(pdf_files), pdf_path.name, job_id[:8])
        t0 = time.perf_counter()

        pdf_content = pdf_path.read_bytes()
        result = process_pid_task(
            job_id=job_id,
            pdf_content=pdf_content,
            pdf_filename=pdf_path.name,
            batch_id=BATCH_ID,
        )

        elapsed = time.perf_counter() - t0
        status = result.get("status", "unknown")
        count  = result.get("instrument_count", 0)
        logger.info(
            "[%d/%d] %s → status=%s  instruments=%d  %.1fs",
            i, len(pdf_files), pdf_path.name, status, count, elapsed
        )
        results_summary.append({
            "file": pdf_path.name,
            "status": status,
            "instruments": count,
            "elapsed_s": round(elapsed, 1),
            "error": result.get("error", ""),
        })

    # Print summary table
    print("\n" + "=" * 72)
    print(f"  BATCH QUALITY TEST SUMMARY — {BATCH_ID}")
    print("=" * 72)
    print(f"  {'File':<22} {'Status':<18} {'Instruments':>12}  {'Time':>7}")
    print("  " + "-" * 68)
    total_instruments = 0
    for r in results_summary:
        flag = "  " if r["status"] == "finished" else "⚠ "
        print(f"  {flag}{r['file']:<20} {r['status']:<18} {r['instruments']:>12}  {r['elapsed_s']:>5.1f}s")
        total_instruments += r["instruments"]
        if r["error"]:
            print(f"       └─ error: {r['error'][:80]}")
    print("  " + "-" * 68)
    finished = sum(1 for r in results_summary if r["status"] == "finished")
    print(f"  Total: {finished}/{len(results_summary)} finished  |  {total_instruments} instruments extracted")
    print("=" * 72)

    # Copy ZIP to Downloads
    zip_src = BATCH_DIR / f"InstruMap_Results_{BATCH_ID}.zip"
    if zip_src.exists():
        shutil.copy2(zip_src, DOWNLOAD_DST)
        logger.info("ZIP copied to: %s", DOWNLOAD_DST)
        print(f"\n  Results ZIP: {DOWNLOAD_DST}\n")
    else:
        logger.warning("ZIP not found at %s", zip_src)


if __name__ == "__main__":
    run()
