"""
German P&ID instrument extractor.

German/DIN-style P&IDs encode instrument tags in two ways:
  1. Single hyphenated word:  "LS-72000", "HS-72100", "FH-52390"
  2. Adjacent text pair:      "PI"  "7216",  "TR"  "72000",  "US"  "72000"
     (type prefix and loop number are separate PDF text elements on the same line)

Neither form places text reliably inside a geometric bubble, so circle /
shape detection does not work.  This extractor reads raw text words, identifies
both patterns, and combines them into instrument tags.

Output schema matches level2_extraction_pymupdf.extract_from_pdf exactly
(instruments_df, lines_df, stats) so the downstream Excel / ZIP pipeline is
unchanged.
"""
from __future__ import annotations

import logging
import re
from typing import Optional

import pandas as pd

logger = logging.getLogger(__name__)

try:
    import fitz
    _PYMUPDF_AVAILABLE = True
except ImportError:
    _PYMUPDF_AVAILABLE = False

from .standard_library import InstrumentLogicEngine
from .line_extractor import extract_line_numbers as _extract_line_numbers
from .page_classifier import classify_page_for_instruments

# ── Accepted prefixes ──────────────────────────────────────────────────────────
# ISA standard types (subset used in German drawings)
_ISA_PREFIXES: frozenset[str] = frozenset({
    "AT", "BDV", "CVZI", "CVZT", "FCV", "FE", "FI", "FIC", "FIT", "FQI",
    "FR", "FRC", "FRI", "FT", "FZT", "HCV", "HS", "LCV", "LI", "LIC",
    "LIT", "LS", "LT", "MOV", "PCV", "PDT", "PI", "PIC", "PIT", "PR",
    "PRC", "PSAH", "PSAL", "PSV", "PT", "PY", "RO", "SDV", "SR", "SRC",
    "SSV", "ST", "TCV", "TE", "TI", "TIC", "TIT", "TP", "TR", "TRC",
    "TT", "TW", "VT", "XA", "XFD", "XGD", "XV", "ZI", "ZIH", "ZIL",
    "HSD", "HSS", "SZSH", "SZSL",
    # common extras used in German P&IDs
    "FC", "LC", "TC", "AC", "PC", "SC", "VC", "CC",
    "FS", "LRC", "FRC", "TRC", "PRC", "SRC",
    "FV", "LV", "TV", "PV",
    "AII", "AIW",
})

# German / DIN-specific prefixes not in ISA catalog
_GERMAN_PREFIXES: frozenset[str] = frozenset({
    "SOLL",   # Sollwert = setpoint
    "IST",    # Istwert  = actual value
    "SP", "SPLO", "SPHI", "SPSA",  # setpoint variants
    "EU",     # Einheit (unit value / engineering unit)
    "US",     # Ultraschall (ultrasonic)
    "OG",     # Obergrenze (upper limit)
    "GG",     # Grenzgrenze (limit value)
    "GH",     # Grenzwert Hoch
    "GL",     # Grenzwert Low
    "HL",     # Höhenstandlimit
    "SH",     # Schaltpunkt Hoch
    "SL",     # Schaltpunkt Low
    "SH",     # Schaltpunkt Hoch
    "HWL",    # High Water Level
    "FH",     # Fördermengen-Hochalarm / rotational speed
    "SK",     # Schaltkontakt (switch contact)
    "WHS", "WCOR", "WCOS",   # project-specific instrument codes
    "ASKS", "ASKL", "ASK",   # project-specific codes
    "ATM",                    # project-specific
    "VAKO",                   # project-specific
    "FRI",                    # Flow Rate Indicator
})

_ALL_ACCEPTED: frozenset[str] = _ISA_PREFIXES | _GERMAN_PREFIXES

# ── Hard noise prefixes — definitely not instrument tags ───────────────────────
_NOISE_PREFIXES: frozenset[str] = frozenset({
    "DN", "PN", "NPS", "DIN", "ISO", "EN",                 # pipe / standards
    "REV", "DWG", "SHT", "BLATT", "DOC",                   # drawing admin
    "DER", "DIE", "DAS", "DEN", "DEM", "DES",              # German articles
    "VON", "BIS", "AUF", "AB", "AN", "IN", "MIT",          # prepositions
    "ZU", "VOR", "NACH", "BEI", "AUS", "UND", "ODER",      # more prepositions
    "SETZT", "STEHT", "WIRD", "IST",                        # verbs (IST excluded here to keep IST prefix out, add back if needed)
    "RI",                                                    # drawing number prefix
    "AUF", "AM", "IM",                                      # more particles
    "STATUS", "DATUM", "MEDIUM", "PASS",                    # annotation words
    "NACH", "ZUM", "ZUR",
    "PUMPE", "NACH", "FUNKE", "WOLF", "LEY",               # manufacturer names
    "THIES", "GRUBER", "EKATO", "MONEX",
    "ERMETO", "SUNETT", "AUGUST",
    "ODER", "ODER",
    "CO", "IPM", "EMR", "EEXE",                             # misc non-instrument
})

# Pattern for a complete single-word hyphenated tag: LETTERS-DIGITS
_HYPHEN_TAG_RE = re.compile(r"^([A-Z]{1,6})-(\d[\w]*)$", re.IGNORECASE)
# Loop number: starts with a digit, short-ish (no pipe line compound structure)
_LOOP_NUMBER_RE = re.compile(r"^\d[\w.]*$")  # no hyphens — stops before pipe line tags
# Pure alpha prefix (instrument type)
_ALPHA_PREFIX_RE = re.compile(r"^[A-Z]{2,6}$", re.IGNORECASE)

# Skip words that look like tags but are actually line / pipe tags
_LINE_TAG_FRAG_RE = re.compile(
    r"^(?:DN|PN|NPS|\d{1,4}-[A-Z]{2,4}|-\w+FF)", re.IGNORECASE
)

# Pipe line tag pattern: DIGITS-ALPHA-... compound (not a loop number)
_PIPE_LINE_RE = re.compile(r"^\d+[-/][A-Z]{2,}", re.IGNORECASE)


def _pt_to_px(val: float, dpi: int = 300) -> int:
    return int(val * dpi / 72.0)


def _accept(prefix: str) -> bool:
    return prefix.upper() in _ALL_ACCEPTED and prefix.upper() not in _NOISE_PREFIXES


def _group_by_line(words: list[dict], y_tol: float = 14.0) -> list[list[dict]]:
    """Group words into text lines by y-position similarity."""
    if not words:
        return []
    sorted_words = sorted(words, key=lambda w: (w["y0"], w["x0"]))
    lines: list[list[dict]] = []
    current: list[dict] = [sorted_words[0]]
    ref_y = sorted_words[0]["y0"]
    for w in sorted_words[1:]:
        if abs(w["y0"] - ref_y) <= y_tol:
            current.append(w)
        else:
            lines.append(sorted(current, key=lambda x: x["x0"]))
            current = [w]
            ref_y = w["y0"]
    lines.append(sorted(current, key=lambda x: x["x0"]))
    return lines


def _extract_tags_from_page(page) -> list[dict]:
    """Extract all instrument tag candidates from one PDF page."""
    words_raw = page.get_text("words")
    words = [
        {
            "text": w[4].strip(),
            "x0": w[0], "y0": w[1], "x1": w[2], "y1": w[3],
            "cx": (w[0] + w[2]) / 2,
            "cy": (w[1] + w[3]) / 2,
        }
        for w in words_raw
        if w[4].strip()
    ]

    found: list[dict] = []
    seen_tags: set[str] = set()

    # ── Strategy 1: single hyphenated word  "LS-72000" ─────────────────────────
    for w in words:
        m = _HYPHEN_TAG_RE.match(w["text"])
        if not m:
            continue
        prefix, loop = m.group(1).upper(), m.group(2)
        if not _accept(prefix):
            continue
        if _LINE_TAG_FRAG_RE.match(w["text"]):
            continue
        tag = f"{prefix}-{loop}"
        key = tag.upper()
        if key in seen_tags:
            continue
        seen_tags.add(key)
        found.append({
            "tag": tag, "prefix": prefix, "loop": loop,
            "cx": w["cx"], "cy": w["cy"],
            "source": "hyphen",
        })

    # ── Strategy 2: adjacent text pair on the same line ────────────────────────
    # Handles both "PI  7216" (number right of prefix) and
    # "7216  TR" (number left of prefix) which both occur in German P&IDs.
    lines = _group_by_line(words)
    for line in lines:
        for i, w in enumerate(line):
            text = w["text"].upper()
            if not _ALPHA_PREFIX_RE.match(text):
                continue
            if not _accept(text):
                continue
            prefix = text
            loop: str | None = None
            partner_w = None

            # Search RIGHT: prefix … number
            for j in range(i + 1, min(i + 4, len(line))):
                nw = line[j]
                ntext = nw["text"].lstrip("-")
                if not _LOOP_NUMBER_RE.match(ntext):
                    break
                if _PIPE_LINE_RE.match(ntext):
                    break
                if nw["x0"] - w["x1"] > 200:
                    break
                loop = ntext
                partner_w = nw
                break

            # Search LEFT: number … prefix (if nothing found to the right)
            if loop is None:
                for j in range(i - 1, max(i - 4, -1), -1):
                    nw = line[j]
                    ntext = nw["text"].lstrip("-")
                    if not _LOOP_NUMBER_RE.match(ntext):
                        break
                    if _PIPE_LINE_RE.match(ntext):
                        break
                    if w["x0"] - nw["x1"] > 200:
                        break
                    loop = ntext
                    partner_w = nw
                    break

            if loop is None or partner_w is None:
                continue

            tag = f"{prefix}-{loop}"
            key = tag.upper()
            if key in seen_tags:
                continue
            seen_tags.add(key)
            found.append({
                "tag": tag, "prefix": prefix, "loop": loop,
                "cx": (w["cx"] + partner_w["cx"]) / 2,
                "cy": (w["cy"] + partner_w["cy"]) / 2,
                "source": "pair",
            })

    return found


# ── Main entry point ───────────────────────────────────────────────────────────

def extract_from_pdf_german(
    pdf_path: str,
    filename_base: str,
    default_area_code: Optional[str] = None,
    dpi: int = 300,
) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """
    Extract instrument tags from a German-style P&ID.

    Returns (instruments_df, lines_df, stats).
    """
    if not _PYMUPDF_AVAILABLE:
        logger.error("PyMuPDF not installed — German extraction unavailable")
        return pd.DataFrame(), pd.DataFrame(), {"error": "pymupdf_missing"}

    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:
        logger.error("German extractor: cannot open %s: %s", pdf_path, exc)
        return pd.DataFrame(), pd.DataFrame(), {"error": str(exc)}

    all_instruments: list[dict] = []
    all_lines: list[dict] = []
    instrument_counter = 1
    skipped_pages: list[int] = []

    for page_idx, page in enumerate(doc):
        page_number = page_idx + 1
        pid_filename = f"{filename_base}.pdf"

        page_text = page.get_text("text") or ""
        words_raw = page.get_text("words")
        drawing_count = len(page.get_drawings())

        page_class = classify_page_for_instruments(
            page_text,
            word_count=len(words_raw),
            drawing_count=drawing_count,
        )
        if not page_class.should_extract:
            skipped_pages.append(page_number)
            logger.info("German extractor: skipping page %d (%s)", page_number, page_class.reason)
            continue

        # Line numbers — skip for German mode; line_extractor expects OCR word format

        # Extract tag candidates
        candidates = _extract_tags_from_page(page)

        for cand in candidates:
            raw_tag = cand["tag"]
            prefix = cand["prefix"]
            epc = InstrumentLogicEngine.get_epc_specs(raw_tag, default_area_code)

            cx_px = _pt_to_px(cand["cx"], dpi)
            cy_px = _pt_to_px(cand["cy"], dpi)

            ref_id = str(instrument_counter)
            instrument_counter += 1

            is_isa = prefix in _ISA_PREFIXES
            all_instruments.append({
                "Ref_ID": ref_id,
                "Verification_Source": f"{filename_base}_p{page_number} -> German/{cand['source']} #{ref_id}",
                "Review_Required": (not is_isa),   # German-specific → always review
                "Rejected_As_Noise": False,
                "Noise_Reason": "",
                "Tag_Quality": "accepted",
                "P&ID_Filename": pid_filename,
                "Tag_Number": epc.get("Tag_Number") or raw_tag,
                "Area": epc["Area_Code"],
                "Type": epc["Instrument_Type"] or prefix,
                "Loop": epc["Loop_Number"] or cand["loop"],
                "Suffix": epc["Tag_Suffix"],
                "Instrument_Description": epc["Instrument_Description"],
                "Service": epc["Service"],
                "System": epc["System"],
                "IO_Type": epc["IO_Type"],
                "Signal_Type": epc["Signal_Type"],
                "Power_Supply": epc["Power_Supply"],
                "Mounting": epc["Mounting"],
                "Location_Drawing": "Field",
                "Coordinates": f"{cx_px},{cy_px}",
                "Radius": 0,
                "P&ID_Page": page_number,
            })

    doc.close()

    logger.info(
        "German extractor: %d tags extracted from %s (%d pages processed)",
        len(all_instruments), filename_base, instrument_counter - 1,
    )

    stats = {
        "mode": "german",
        "tags_extracted": len(all_instruments),
        "skipped_pages": skipped_pages,
    }
    instruments_df = pd.DataFrame(all_instruments) if all_instruments else pd.DataFrame()
    if all_lines and isinstance(all_lines[0], pd.DataFrame):
        lines_df = pd.concat(all_lines, ignore_index=True) if all_lines else pd.DataFrame()
    else:
        lines_df = pd.DataFrame(all_lines) if all_lines else pd.DataFrame()
    return instruments_df, lines_df, stats
