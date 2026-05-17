"""
P&ID Revision Diff — compare two batch extractions and surface changes.

Compares Rev A (old batch) vs Rev B (new batch) by Tag_Number and returns:
  - added:   tags in B not in A
  - removed: tags in A not in B
  - changed: same tag, different field values
  - unchanged: count of tags identical in both

Tracked fields for change detection:
  IO_Type, Type, Loop, Area, System, Instrument_Description

This is download-only: the caller is responsible for fetching the CSVs
from Supabase Storage and passing them as DataFrames.
"""
import logging
from typing import Dict, List, Any

import pandas as pd

logger = logging.getLogger(__name__)

# Fields compared for change detection (order matters — shown in Detail column)
_COMPARE_FIELDS = [
    "IO_Type",
    "Type",
    "Loop",
    "Area",
    "System",
    "Instrument_Description",
]


def _safe_str(val) -> str:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return ""
    return str(val).strip()


def compute_diff(
    df_a: pd.DataFrame,
    df_b: pd.DataFrame,
    label_a: str = "Rev A",
    label_b: str = "Rev B",
) -> Dict[str, Any]:
    """
    Compare two instrument index DataFrames and return a structured diff.

    Args:
        df_a:    Old extraction (Rev A). Must have a 'Tag_Number' column.
        df_b:    New extraction (Rev B). Must have a 'Tag_Number' column.
        label_a: Human-readable label for the old batch (shown in UI).
        label_b: Human-readable label for the new batch.

    Returns:
        {
          "summary":   {"added": N, "removed": N, "changed": N, "unchanged": N},
          "added":     [{"tag": …, "type": …, "io_type": …, "description": …}, …],
          "removed":   [{"tag": …, "type": …, "io_type": …, "description": …}, …],
          "changed":   [{"tag": …, "changes": [{"field": …, "from": …, "to": …}]}, …],
          "label_a":   "Rev A",
          "label_b":   "Rev B",
        }
    """
    if df_a.empty and df_b.empty:
        return _empty_result(label_a, label_b)

    tags_a = set(df_a["Tag_Number"].dropna().astype(str).str.strip()) if not df_a.empty else set()
    tags_b = set(df_b["Tag_Number"].dropna().astype(str).str.strip()) if not df_b.empty else set()

    idx_a = df_a.set_index("Tag_Number") if not df_a.empty else pd.DataFrame()
    idx_b = df_b.set_index("Tag_Number") if not df_b.empty else pd.DataFrame()

    added_tags   = sorted(tags_b - tags_a)
    removed_tags = sorted(tags_a - tags_b)
    common_tags  = sorted(tags_a & tags_b)

    def _row_summary(tag: str, idx: pd.DataFrame) -> dict:
        try:
            row = idx.loc[tag]
            return {
                "tag":         tag,
                "type":        _safe_str(row.get("Type")),
                "io_type":     _safe_str(row.get("IO_Type")),
                "loop":        _safe_str(row.get("Loop")),
                "area":        _safe_str(row.get("Area")),
                "description": _safe_str(row.get("Instrument_Description")),
            }
        except Exception:
            return {"tag": tag, "type": "", "io_type": "", "loop": "", "area": "", "description": ""}

    added   = [_row_summary(t, idx_b) for t in added_tags]
    removed = [_row_summary(t, idx_a) for t in removed_tags]

    changed   = []
    unchanged = 0

    for tag in common_tags:
        diffs = []
        try:
            row_a = idx_a.loc[tag]
            row_b = idx_b.loc[tag]
            for field in _COMPARE_FIELDS:
                v_a = _safe_str(row_a.get(field))
                v_b = _safe_str(row_b.get(field))
                if v_a != v_b:
                    diffs.append({"field": field, "from": v_a, "to": v_b})
        except Exception:
            pass
        if diffs:
            changed.append({
                "tag":     tag,
                "type":    _safe_str(idx_b.loc[tag].get("Type")) if tag in idx_b.index else "",
                "changes": diffs,
            })
        else:
            unchanged += 1

    logger.info(
        f"[Diff] {label_a} vs {label_b}: "
        f"+{len(added)} added, -{len(removed)} removed, "
        f"~{len(changed)} changed, ={unchanged} unchanged"
    )

    return {
        "label_a": label_a,
        "label_b": label_b,
        "summary": {
            "added":     len(added),
            "removed":   len(removed),
            "changed":   len(changed),
            "unchanged": unchanged,
        },
        "added":   added,
        "removed": removed,
        "changed": changed,
    }


def _empty_result(label_a: str, label_b: str) -> Dict[str, Any]:
    return {
        "label_a": label_a,
        "label_b": label_b,
        "summary": {"added": 0, "removed": 0, "changed": 0, "unchanged": 0},
        "added": [], "removed": [], "changed": [],
    }


def load_batch_df(user_id: str, batch_id: str) -> pd.DataFrame:
    """
    Download all _data.csv files for a batch from Supabase Storage and
    merge them into one DataFrame.  Returns empty DataFrame on failure.
    """
    try:
        from app.config.supabase_storage import list_files, download_file
        import io

        files = list_files(user_id, batch_id) or []
        dfs = []
        for f in files:
            name = f.get("name", "")
            if not name.endswith("_data.csv"):
                continue
            content = download_file(user_id, batch_id, name)
            if content:
                try:
                    dfs.append(pd.read_csv(io.BytesIO(content)))
                except Exception as exc:
                    logger.warning(f"[Diff] Could not parse {name}: {exc}")

        if not dfs:
            return pd.DataFrame()
        df = pd.concat(dfs, ignore_index=True)
        if "Tag_Number" not in df.columns:
            return pd.DataFrame()
        df["Tag_Number"] = df["Tag_Number"].astype(str).str.strip()
        return df.drop_duplicates(subset=["Tag_Number"])

    except Exception as exc:
        logger.warning(f"[Diff] Could not load batch {batch_id}: {exc}")
        return pd.DataFrame()
