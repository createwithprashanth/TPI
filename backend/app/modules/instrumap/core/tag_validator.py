"""
Tag format validator for InstruMap.

Validates extracted instrument tags against the project's tag numbering
convention, as parsed from the legend (tag_format_parsed.example).

Strategy:
  Build a structural regex from the example tag by classifying each
  segment as alpha / numeric / alphanum and turning separators into
  literal anchors. This avoids trying to parse the freeform pattern
  string ("PP-TTT-NNNNS") which varies between projects and software.

  Example tag  "FT-1001-A1"
  Segments     ["FT", "1001", "A1"]
  Types        ["alpha", "numeric", "alphanum"]
  Regex        ^[A-Z]+-\d+-[A-Z0-9]+$

  "FIC-2034-B3"  → matches   (alpha-numeric-alphanum, same shape)
  "ZT-1001"      → mismatch  (2 segments, expected 3)
  "1234-FT"      → mismatch  (numeric-alpha, wrong order)

Leniency rules:
  - Letter-count within a segment is not enforced (FT and PDIC both
    match [A-Z]+). Real tags vary: PT=2 letters, TIC=3, PDIC=4.
  - The third segment (area) is made OPTIONAL when the pattern has
    exactly 3 segments, because some P&IDs omit the area suffix for
    instruments in the default area.
  - Tags already flagged Review_Required=True are skipped (don't
    double-flag instruments from detail expansion or other sources).
  - Instrument types UNKNOWN / REVIEW are skipped entirely.

Outputs:
  - master_df with Review_Required set True for format mismatches.
  - Tag_Format_Note column added: empty string for valid tags,
    human-readable reason string for mismatches.
    This column appears in the Verification Log Excel sheet.
"""
import logging
import re
from typing import Optional

import pandas as pd

logger = logging.getLogger(__name__)

# Types that are placeholder / not real instrument tags
_SKIP_TYPES = {"UNKNOWN", "REVIEW", ""}


def _segment_class(segment: str) -> str:
    """Classify a tag segment as 'alpha', 'numeric', or 'alphanum'."""
    if segment.isalpha():
        return "alpha"
    if segment.isdigit():
        return "numeric"
    return "alphanum"


def _class_to_pattern(cls: str) -> str:
    if cls == "alpha":
        return "[A-Z]+"
    if cls == "numeric":
        return r"\d+"
    return "[A-Z0-9]+"


def _infer_regex_from_example(example: str) -> Optional[re.Pattern]:
    """
    Build a tag validation regex from an example tag string.
    Returns compiled Pattern or None if the example is unusable.
    """
    example = example.strip().upper()
    if not example:
        return None

    # Pattern strings like "PP-TTT-NNNNS" contain no real digits — useless for
    # validation since every real tag would fail.  Only accept actual example tags.
    if not re.search(r"\d", example):
        logger.info(f"Tag validation: example '{example}' has no digits — looks like pattern notation, skipping")
        return None

    # Find the primary delimiter character (most common non-alphanumeric)
    raw_delimiters = re.findall(r"[^A-Za-z0-9]", example)
    if not raw_delimiters:
        # No delimiter — single-segment tag, validate as [A-Z0-9]+
        try:
            return re.compile(r"^[A-Z0-9]+$", re.IGNORECASE)
        except Exception:
            return None

    delimiter = max(set(raw_delimiters), key=raw_delimiters.count)
    segments = example.split(delimiter)
    if len(segments) < 2:
        return None

    seg_classes = [_segment_class(s) for s in segments if s]
    seg_patterns = [_class_to_pattern(c) for c in seg_classes]

    esc_delim = re.escape(delimiter)

    # For 3-segment patterns, make the third segment (area) optional —
    # some P&IDs omit the area suffix for instruments in the default area.
    if len(seg_patterns) == 3:
        regex_str = (
            f"^{seg_patterns[0]}{esc_delim}{seg_patterns[1]}"
            f"(?:{esc_delim}{seg_patterns[2]})?$"
        )
    else:
        regex_str = f"^{esc_delim.join(seg_patterns)}$"

    try:
        return re.compile(regex_str, re.IGNORECASE)
    except re.error as exc:
        logger.warning(f"Tag validator: could not compile regex '{regex_str}': {exc}")
        return None


def _resolve_example(legend_context: dict) -> str:
    """
    Return the best available example tag from the legend context.

    Priority:
      1. tag_format_parsed["example"]   — structured extraction (new)
      2. tag_format_parsed["pattern"]   — pattern string if no example
      3. tag_format                     — legacy plain string
    """
    parsed = legend_context.get("tag_format_parsed") or {}
    if isinstance(parsed, dict):
        if parsed.get("example", "").strip():
            return parsed["example"].strip()
        if parsed.get("pattern", "").strip():
            return parsed["pattern"].strip()
    legacy = legend_context.get("tag_format", "")
    return str(legacy).strip() if legacy else ""


def validate_tag_formats(
    master_df: pd.DataFrame,
    legend_context: dict,
) -> pd.DataFrame:
    """
    Validate Tag_Number values against the project tag format from the legend.

    Adds a 'Tag_Format_Note' column:
      ""                           — tag is valid or validation skipped
      "Tag format mismatch: ..."   — tag doesn't match expected pattern

    Sets Review_Required = True for mismatched tags.

    Args:
        master_df:      Deduplicated instrument DataFrame
        legend_context: Row from legend_contexts table

    Returns:
        master_df with Tag_Format_Note added and Review_Required updated.
        Never raises — all errors are non-fatal.
    """
    if master_df.empty:
        return master_df

    example = _resolve_example(legend_context)
    if not example:
        logger.info("Tag validation: no example tag in legend — skipping")
        master_df = master_df.copy()
        master_df["Tag_Format_Note"] = ""
        return master_df

    pattern_regex = _infer_regex_from_example(example)
    if pattern_regex is None:
        logger.warning(f"Tag validation: could not build regex from example '{example}' — skipping")
        master_df = master_df.copy()
        master_df["Tag_Format_Note"] = ""
        return master_df

    logger.info(f"Tag validation: pattern='{pattern_regex.pattern}' (from example '{example}')")

    master_df = master_df.copy()
    if "Tag_Format_Note" not in master_df.columns:
        master_df["Tag_Format_Note"] = ""

    mismatch_count = 0

    for idx, row in master_df.iterrows():
        tag  = str(row.get("Tag_Number", "")).strip()
        typ  = str(row.get("Type", "")).strip().upper()

        if not tag or typ in _SKIP_TYPES:
            continue

        if not pattern_regex.match(tag):
            note = f"Tag format mismatch — expected pattern like '{example}'"
            master_df.at[idx, "Tag_Format_Note"] = note
            master_df.at[idx, "Review_Required"] = True
            mismatch_count += 1

    logger.info(
        f"Tag validation: {mismatch_count} mismatch(es) flagged "
        f"out of {len(master_df)} instruments"
    )
    return master_df
