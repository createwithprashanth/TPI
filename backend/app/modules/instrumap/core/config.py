# XYRA-BACKEND/app/modules/instrumap/core/config.py

import os

# --- GOOGLE VISION API CONFIG ---
# Path to your Google Service Account Credentials JSON file
# IMPORTANT: Update this path to your actual credentials file.
GOOGLE_APPLICATION_CREDENTIALS_PATH = os.path.join(os.getcwd(), 'instrumap-464410-3cb4dae6350d.json')


# Poppler path for PDF conversion (None for Linux system-wide install, Windows path if needed)
POPPLER_PATH = os.getenv("POPPLER_PATH", None)  # Set to None for Linux, or provide Windows path via env var

# --- PDF CONFIG ---
# Path to Poppler (needed for PDF to Image conversion on Windows)
# Set to None if Poppler is in system PATH (e.g., on Linux/macOS)

PDF_DPI = 300 # DPI used for PDF to Image conversion

# --- EXTRACTION MODE ---
# USE_PYMUPDF  : try direct PDF extraction first (vector PDFs only, zero API calls)
#                falls back silently to OCR if PDF is scanned / has no embedded text
# USE_FAST_OCR : True  → single full-page OCR (level2_extraction_fast.py)
#                False → original per-circle OCR (level2_extraction.py) — safe fallback
USE_PYMUPDF  = True
USE_FAST_OCR = True

# --- HOUGH CIRCLE DETECTION PARAMETERS (DEFAULT) ---
# Used if interactive calibration fails or is skipped
HOUGH_DP = 1 # Inverse ratio of the accumulator resolution to the image resolution
HOUGH_MIN_DIST = 30 # Minimum distance between the centers of the detected circles
HOUGH_PARAM1 = 100 # Canny edge detection high threshold (original mode)
HOUGH_PARAM1_FAST = 60 # Lower threshold for fast mode — more sensitive for thin-line vector PDFs
HOUGH_PARAM2 = 30 # Accumulator threshold for the Canny detector
HOUGH_MIN_RADIUS = 10 # Minimum circle radius
HOUGH_MAX_RADIUS = 100 # Maximum circle radius

# --- OCR CONFIG ---
OCR_ROI_MARGIN_FACTOR = 1.0 # Radius multiplier to define the OCR search area (ROI)
TEXT_CONCAT_SEPARATOR = "-" # Separator to use when joining multi-line tags
OCR_MIN_CHARS_PER_ROW = 2 # Minimum characters required for a valid OCR row
OCR_MAX_CHARS_PER_ROW = 5 # Maximum characters allowed for a valid OCR row
OCR_MAX_TAG_ROWS = 3 # Maximum number of rows allowed in a tag
OCR_Y_TOLERANCE = 5 # Vertical pixel tolerance for grouping OCR results into a single line

# --- NEW: TEXT MINING ENGINE CONFIG (The Scavenger) ---
# Parameters for the "Vertical Magnet" clustering
TEXT_MINING_MAX_X_DIST = 30 # Pixels alignment tolerance (vertical stack alignment)
TEXT_MINING_MAX_Y_GAP = 50  # Pixels gap between lines
TEXT_MINING_MIN_TAG_LENGTH = 3 # Minimum total characters in a tag
TEXT_MINING_MAX_TYPE_LENGTH = 5 # Max length for the "Type" part (e.g. "GENERAL" is 7 -> Drop)

# The "Ruthless" Blocklist (Common P&ID words that mimic tags)
TEXT_MINING_STOPWORDS = {
    "FOR", "AND", "THE", "SEE", "DWG", "REF", "TYP", "MIN", "MAX", 
    "HOT", "COLD", "AIR", "GAS", "OIL", "DRY", "WET", "IN", "OUT",
    "OFF", "ON", "SET", "TAP", "TOP", "BOT", "REV", "NOT", "YES", "NO",
    "ALL", "EQUIPMENT", "INSTRUMENT", "TAG", "NOS", "DRAWING", "SHALL",
    "AREA", "CODE", "PLANT", "SPECIFIED", "OTHER", "WISE", "NOTE", "NOTES",
    "DETAIL", "SECTION", "GENERAL", "LEGEND", "SYMBOL", "PIPING", 
    "AS", "AFTER", "BEFORE", "WITH", "WITHOUT"
}

# --- NEW INTERACTIVE CALIBRATION CONFIG ---
ANCHOR_MIN_COUNT = 1 # Minimum number of anchor points required (currently 1 for interactive)
RADIUS_TOLERANCE_PERCENT = 0.20 # 20% tolerance around the measured radius to define the search range

# --- P&ID GRID FOR LOCATION (Legacy/Future Use) ---
PID_GRID_ROWS = 5
PID_GRID_COLS = 5
PID_SEARCH_ORDER = 'top_left_to_bottom_right'

# --- DEBUGGING CONFIG ---
# Set DEBUG_MODE=true via environment variable to enable on a specific worker.
# Always off in production — saving per-page JPEGs at 300 DPI is expensive.
DEBUG_MODE = os.getenv("INSTRUMAP_DEBUG", "false").lower() == "true"
DEBUG_OUTPUT_FOLDER = "debug_output"