from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
DB_PATH = Path(os.getenv("XYRA_LEARNING_DB_PATH", BACKEND_ROOT / "data" / "xyra_studio.db"))
RUNS_DIR = Path(os.getenv("XYRA_LEARNING_RUNS_DIR", REPO_ROOT / "learning_review" / "runs"))
MTO_EXPORT_DIR = Path(os.getenv("XYRA_LEARNING_MTO_EXPORT_DIR", BACKEND_ROOT / "data" / "mto_exports"))

DEFAULT_PROJECT_ID = os.getenv("XYRA_LEARNING_PROJECT_ID", "XYRA_E2E_PID_GRID_TEST_20260607")
MAX_REVIEW_ROWS = int(os.getenv("XYRA_LEARNING_MAX_ROWS", "80"))
MAX_MTO_ROWS = int(os.getenv("XYRA_LEARNING_MAX_MTO_ROWS", "120"))
