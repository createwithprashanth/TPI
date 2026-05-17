"""
Detail template expander for InstruMap.

On real P&IDs, complex instruments (MOVs, control valves, analysers) are
drawn as a single symbol with an annotation referencing a separate "detail"
or "typical" drawing that lists the full instrument package.

Common annotation forms (all handled):
  Detail-A   Det-A    Det. A    See Detail A    Ref. Detail-A
  Type-A     Typ-A    Typ. A    See Type A      See Typ. A
  Typical-A  Typical A          See Typical-1
  Standard-A Std-A    Std. A
  Package-A  Pkg-A
  TD-A   (Typical Drawing A)
  SD-A   (Standard Drawing A)

The legend knowledge base (extracted by legend_parser) stores templates like:
  "Detail-A": {
    "parent_type": "MOV",
    "description": "Motorised Valve Typical",
    "instruments": [
      {"type": "ZSO", "suffix": ""},
      {"type": "ZSC", "suffix": ""},
      {"type": "YV",  "suffix": ""},
    ]
  }

Expansion strategy (two passes):
  1. Text scan  — checks instrument description / system columns for explicit
                  reference annotations (e.g. "See Detail-A").
  2. Type match — if a template defines parent_type = "MOV", every MOV in the
                  extraction is expanded, even if no annotation was detected.
                  Text-scan match takes precedence over type match.

Child tags inherit loop number, area, and system from the parent.
IO type comes from io_mapping in the legend context.
All expanded instruments are flagged Review_Required = True.
Tags that already exist in the DataFrame are never duplicated.
"""
import logging
import re
from typing import Dict, List, Optional, Tuple

import pandas as pd

logger = logging.getLogger(__name__)

# ── Reference pattern matching ─────────────────────────────────────────────────

# Each pattern captures the identifier (letter or number) after the keyword.
# Order matters: longer / more specific matches first.
_RAW_PATTERNS = [
    # "See Detail-A" / "See Type-A" / "See Typical-A" / "See Typ. A"
    r"see\s+(?:det(?:ail)?|typ(?:ical|e)?|standard|std|pkg|package|td|sd)[\s.\-]*([A-Za-z0-9]+)",
    # "Ref. Detail-A" / "Ref Detail-A"
    r"ref(?:erence|\.?)?\s+(?:det(?:ail)?|typ(?:ical|e)?)[\s.\-]*([A-Za-z0-9]+)",
    # Typical Drawing / Standard Drawing: "TD-A" / "SD-A"
    r"\b(?:td|sd)[\s.\-]+([A-Za-z0-9]+)\b",
    # "Detail-A" / "Det-A" / "Det. A" / "Detail A"
    r"\bdet(?:ail)?[\s.\-]+([A-Za-z0-9]+)\b",
    # "Typical-A" / "Typical A"
    r"\btypical[\s.\-]+([A-Za-z0-9]+)\b",
    # "Type-A" / "Type A"
    r"\btype[\s.\-]+([A-Za-z0-9]+)\b",
    # "Typ-A" / "Typ. A" / "Typ A"
    r"\btyp[\s.\-]+([A-Za-z0-9]+)\b",
    # "Standard-A" / "Std-A" / "Std. A"
    r"\bst(?:andard|d)[\s.\-]+([A-Za-z0-9]+)\b",
    # "Package-A" / "Pkg-A"
    r"\b(?:package|pkg)[\s.\-]+([A-Za-z0-9]+)\b",
]

_COMPILED = [re.compile(p, re.IGNORECASE) for p in _RAW_PATTERNS]

# Columns to scan for explicit reference annotations (boolean columns excluded)
_TEXT_COLUMNS = ["Instrument_Description", "System", "Service"]


def _identifier(raw_key: str) -> str:
    """
    Extract the bare identifier from a template key or reference text.
    "Detail-A" → "A",  "Type-B" → "B",  "Typical-12" → "12"
    Returns upper-cased for case-insensitive matching.
    """
    m = re.search(r"([A-Za-z0-9]+)\s*$", raw_key.strip())
    return m.group(1).upper() if m else raw_key.strip().upper()


def _build_template_index(detail_templates: Dict) -> Dict[str, Tuple[str, Dict]]:
    """
    Build lookup: identifier → (canonical_key, template_dict).
    Handles "Detail-A", "Type-A", "Typ-1" all keyed by their trailing identifier.
    If two templates share the same identifier (unusual), the first wins.
    """
    index: Dict[str, Tuple[str, Dict]] = {}
    for key, tmpl in detail_templates.items():
        ident = _identifier(key)
        if ident not in index:
            index[ident] = (key, tmpl)
    return index


def _scan_text_for_reference(
    text: str,
    template_index: Dict[str, Tuple[str, Dict]],
) -> Optional[Tuple[str, Dict]]:
    """Return (canonical_key, template) if text contains a known reference, else None."""
    if not text or not isinstance(text, str):
        return None
    for pattern in _COMPILED:
        m = pattern.search(text)
        if m:
            ident = m.group(1).upper()
            if ident in template_index:
                return template_index[ident]
    return None


# ── IO type normalisation ─────────────────────────────────────────────────────

_IO_NORMALISE = re.compile(r"^(AI|AO|DI|DO|FIELDBUS|MODBUS|HART|PNEUMATIC|NONE)", re.IGNORECASE)


def _normalize_io_type(raw: str) -> str:
    """
    Collapse verbose IO strings to the bare type token.
    "AI (4-20mA)" → "AI",  "Digital Output" → "DO",  "" → ""
    """
    raw = raw.strip()
    # Explicit token match at start (handles "AI (4-20mA)", "AI/4-20mA")
    m = _IO_NORMALISE.match(raw)
    if m:
        return m.group(1).upper()
    # Fallback: expand common verbose forms
    lower = raw.lower()
    for token, phrases in [
        ("AI",  ["analogue input", "analog input"]),
        ("AO",  ["analogue output", "analog output"]),
        ("DI",  ["digital input", "discrete input"]),
        ("DO",  ["digital output", "discrete output"]),
    ]:
        if any(p in lower for p in phrases):
            return token
    return raw  # return as-is if unrecognised (don't silently drop it)


# ── Tag number generation ─────────────────────────────────────────────────────

def _child_tag(parent_tag: str, parent_loop: str, child_type: str, suffix: str) -> str:
    """
    Build a child instrument tag from the parent's loop number.

    MOV-1001    + ZSO → ZSO-1001
    MOV-1001-A1 + YV  → YV-1001-A1   (preserve letter-led area suffix)
    FI-298P     + ZSO → ZSO-298P      (alphanumeric loop preserved whole)
    Falls back to replacing the parent type prefix if no loop number found.
    """
    if parent_loop:
        # Use the entire loop string — avoids stripping alphanumeric suffixes like "298P"
        # Keep any letter-led area segment from the parent tag (e.g. "-A1", "-A")
        area_suffix_match = re.search(r"-([A-Za-z]\w*)$", parent_tag)
        area_suffix = f"-{area_suffix_match.group(1)}" if area_suffix_match else ""
        base = f"{child_type}-{parent_loop}{area_suffix}"
    else:
        # Replace leading type letters in parent tag
        base = re.sub(r"^[A-Za-z]+", child_type, parent_tag, count=1)

    return (base + suffix).rstrip("-")


# ── Expansion ─────────────────────────────────────────────────────────────────

def _expand_parent(
    parent_row: pd.Series,
    template_key: str,
    template: Dict,
    io_mapping: Dict[str, str],
) -> List[Dict]:
    """
    Generate one child instrument row per entry in the template's instruments list.
    Returns list of dicts (empty if no instruments defined).
    """
    parent_tag  = str(parent_row.get("Tag_Number", ""))
    parent_loop = str(parent_row.get("Loop", ""))
    parent_area = str(parent_row.get("Area", ""))
    parent_sys  = str(parent_row.get("System", ""))

    children: List[Dict] = []
    for inst_def in template.get("instruments", []):
        child_type   = str(inst_def.get("type",   "")).strip().upper()
        child_suffix = str(inst_def.get("suffix", "")).strip()
        if not child_type:
            continue

        tag = _child_tag(parent_tag, parent_loop, child_type, child_suffix)
        io  = _normalize_io_type(io_mapping.get(child_type, ""))

        child = dict(parent_row)   # inherit all columns from parent
        child.update({
            "Tag_Number":             tag,
            "Type":                   child_type,
            "Loop":                   parent_loop,
            "Area":                   parent_area,
            "System":                 parent_sys,
            "IO_Type":                io,
            "Instrument_Description": f"{child_type} — from {template_key} ({parent_tag})",
            "Review_Required":        True,
            # Internal marker — stripped before Excel output
            "_detail_template":       template_key,
            "_detail_parent":         parent_tag,
        })
        children.append(child)

    return children


def expand_detail_templates(
    full_df: pd.DataFrame,
    master_df: pd.DataFrame,
    legend_context: Dict,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    Detect detail/typical references in extracted instruments and expand them.

    Args:
        full_df:        All extracted instruments (may include per-file rows)
        master_df:      Deduplicated instrument index (one row per tag)
        legend_context: Row from legend_contexts DB table

    Returns:
        (expanded_full_df, expanded_master_df)
        Adds child instruments; never modifies existing rows.
    """
    detail_templates: Dict = legend_context.get("detail_templates") or {}
    io_mapping: Dict       = legend_context.get("io_mapping")       or {}

    if not detail_templates:
        return full_df, master_df

    template_index = _build_template_index(detail_templates)

    # Build type → template for automatic expansion (parent_type based)
    type_to_template: Dict[str, Tuple[str, Dict]] = {}
    for key, tmpl in detail_templates.items():
        pt = str(tmpl.get("parent_type", "")).strip().upper()
        if pt and pt not in type_to_template:
            type_to_template[pt] = (key, tmpl)

    existing_tags = set(master_df["Tag_Number"].astype(str).str.upper())
    master_cols   = master_df.columns.tolist()
    new_rows: List[Dict] = []
    expanded_count = 0
    parents_expanded: set = set()

    for _, row in master_df.iterrows():
        inst_type = str(row.get("Type", "")).strip().upper()
        parent_tag = str(row.get("Tag_Number", ""))

        # Strategy 1: explicit text annotation in any text column
        detected: Optional[Tuple[str, Dict]] = None
        for col in _TEXT_COLUMNS:
            detected = _scan_text_for_reference(str(row.get(col, "")), template_index)
            if detected:
                break

        # Strategy 2: type-based automatic expansion
        if not detected and inst_type in type_to_template:
            detected = type_to_template[inst_type]

        if not detected:
            continue

        template_key, template = detected
        children = _expand_parent(row, template_key, template, io_mapping)

        for child in children:
            child_tag_upper = str(child["Tag_Number"]).upper()
            if child_tag_upper not in existing_tags:
                # Align columns to master_df; internal marker cols added at end
                aligned = {c: child.get(c, "") for c in master_cols}
                aligned["_detail_template"] = child.get("_detail_template", "")
                aligned["_detail_parent"]   = child.get("_detail_parent", "")
                new_rows.append(aligned)
                existing_tags.add(child_tag_upper)
                expanded_count += 1

        parents_expanded.add(parent_tag)

    if not new_rows:
        logger.info("Detail expansion: no new instruments generated")
        return full_df, master_df

    new_df = pd.DataFrame(new_rows)
    # Drop internal marker columns before merging into the main DataFrames
    for col in ["_detail_template", "_detail_parent"]:
        if col in new_df.columns:
            new_df.drop(columns=[col], inplace=True)

    # Align to master_df columns exactly
    for col in master_cols:
        if col not in new_df.columns:
            new_df[col] = ""
    new_df = new_df[master_cols]

    expanded_master = pd.concat([master_df, new_df], ignore_index=True)
    expanded_full   = pd.concat([full_df,   new_df], ignore_index=True)

    logger.info(
        f"Detail expansion: +{expanded_count} instruments from "
        f"{len(parents_expanded)} parent(s) across "
        f"{len(detail_templates)} template(s)"
    )
    return expanded_full, expanded_master
