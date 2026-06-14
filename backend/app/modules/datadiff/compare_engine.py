"""
DataDiff — vectorized Excel comparison engine.
Uses pandas merge + xlsxwriter conditional formatting for large-file performance.
No Python-level row or cell loops over the data.
"""
import re
import time
from io import BytesIO

import numpy as np
import pandas as pd

# Unique merge suffixes — unlikely to clash with real column names
_S1 = "__@@f1"
_S2 = "__@@f2"
_SK = "__@@key"


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def parse_file(file_bytes: bytes) -> dict:
    """Return sheet names + column headers per sheet."""
    bio = BytesIO(file_bytes)
    xls = pd.ExcelFile(bio)
    columns_by_sheet: dict = {}
    for sheet in xls.sheet_names:
        try:
            df = pd.read_excel(BytesIO(file_bytes), sheet_name=sheet, nrows=0, dtype=str)
            columns_by_sheet[sheet] = [str(c) for c in df.columns]
        except Exception:
            columns_by_sheet[sheet] = []
    return {"sheets": xls.sheet_names, "columns_by_sheet": columns_by_sheet}


# ---------------------------------------------------------------------------
# Vectorized normalisation
# ---------------------------------------------------------------------------

def _std(s: pd.Series, *, ignore_spaces, ignore_hyphens, case_insensitive, ignore_special) -> pd.Series:
    """Normalise a full column at once. Returns NaN for blank/null cells."""
    r = s.fillna("").astype(str).str.strip()
    if case_insensitive:
        r = r.str.upper()
    if ignore_spaces:
        r = r.str.replace(" ", "", regex=False)
    if ignore_hyphens:
        r = r.str.replace("-", "", regex=False)
    if ignore_special:
        r = r.str.replace(r"[/_\.]", "", regex=True)
    return r.replace("", np.nan)


def _dedup_cols(df: pd.DataFrame) -> pd.DataFrame:
    cols = pd.Series(df.columns)
    for dup in df.columns[df.columns.duplicated(keep=False)].unique():
        for i, idx in enumerate(cols[cols == dup].index):
            if i > 0:
                df.columns.values[idx] = f"{dup}_{i}"
    return df


def _col_letter(n: int) -> str:
    """0-based column index → Excel letter (A, B, … Z, AA …)."""
    s, n = "", n + 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


# ---------------------------------------------------------------------------
# Core comparison (fully vectorized)
# ---------------------------------------------------------------------------

def compare(
    file1_bytes: bytes,
    file2_bytes: bytes,
    sheet1: str,
    sheet2: str,
    lookup_col1: str,
    lookup_col2: str,
    file1_name: str = "File1",
    file2_name: str = "File2",
    column_map: dict | None = None,
    ignore_spaces: bool = True,
    ignore_hyphens: bool = False,
    case_insensitive: bool = False,
    ignore_special: bool = False,
) -> tuple[BytesIO, dict]:
    """
    Compare two Excel sheets.
    Returns (BytesIO Excel report, stats dict).
    No Python loops over rows or cells — all operations are vectorized.
    """
    t0 = time.time()
    column_map = column_map or {}
    opts = dict(
        ignore_spaces=ignore_spaces,
        ignore_hyphens=ignore_hyphens,
        case_insensitive=case_insensitive,
        ignore_special=ignore_special,
    )

    lk1 = lookup_col1.upper()
    lk2 = lookup_col2.upper()

    # ── Read ─────────────────────────────────────────────────────────────────
    old_df = pd.read_excel(BytesIO(file1_bytes), sheet_name=sheet1, dtype=str)
    new_df = pd.read_excel(BytesIO(file2_bytes), sheet_name=sheet2, dtype=str)

    original_old_cols = list(old_df.columns)

    old_df.columns = old_df.columns.str.upper()
    new_df.columns = new_df.columns.str.upper()
    old_df = _dedup_cols(old_df)
    new_df = _dedup_cols(new_df)

    # ── Rename File 2 columns per column_map ─────────────────────────────────
    rename_new: dict = {}
    if lk2 != lk1 and lk2 in new_df.columns:
        rename_new[lk2] = lk1
    for f1c, f2c in {k.upper(): v.upper() for k, v in column_map.items()}.items():
        if f2c in new_df.columns and f2c != f1c:
            rename_new[f2c] = f1c
    if rename_new:
        new_df = new_df.rename(columns=rename_new)

    # ── Column catalogue ──────────────────────────────────────────────────────
    old_cols_set = set(old_df.columns) - {lk1}
    new_cols_set = set(new_df.columns) - {lk1}
    old_cols_ordered = [c.upper() for c in original_old_cols if c.upper() in old_cols_set]
    extra_cols       = sorted(new_cols_set - old_cols_set)
    all_cols         = old_cols_ordered + extra_cols

    # ── Strip lookup key for matching ─────────────────────────────────────────
    old_df[_SK] = _std(old_df[lk1], **opts)
    new_df[_SK] = _std(new_df[lk1], **opts)

    old_valid = old_df.dropna(subset=[_SK]).copy()
    new_valid = new_df.dropna(subset=[_SK]).copy()
    old_ignored = len(old_df) - len(old_valid)
    new_ignored = len(new_df) - len(new_valid)

    # ── Outer merge on stripped key ───────────────────────────────────────────
    merged = old_valid.merge(
        new_valid, on=_SK, suffixes=(_S1, _S2), how="outer", indicator=True
    )

    is_both  = (merged["_merge"] == "both").values
    is_left  = (merged["_merge"] == "left_only").values   # record removed
    is_right = (merged["_merge"] == "right_only").values  # record added

    not_f1 = f"Not in {file1_name}"
    not_f2 = f"Not in {file2_name}"

    # ── Build output DataFrame — no Python row loops ───────────────────────────
    out: dict[str, np.ndarray] = {}

    # Lookup key output columns
    lk_f1 = merged[f"{lk1}{_S1}"].values.astype(object)
    lk_f2 = merged[f"{lk1}{_S2}"].values.astype(object)
    out[f"{lk1} ({file1_name})"] = np.where(is_right, not_f1, lk_f1)
    out[f"{lk1} ({file2_name})"] = np.where(is_left,  not_f2, lk_f2)

    status_col_names: list[str] = []
    changed_counts:   dict[str, int] = {}

    for col in all_cols:
        in_old = col in old_cols_set
        in_new = col in new_cols_set
        sname  = f"{col} - Status"

        if in_old and in_new:
            # Column present in both files — vectorized value compare
            c1 = merged.get(f"{col}{_S1}", pd.Series(dtype=object)).values.astype(object)
            c2 = merged.get(f"{col}{_S2}", pd.Series(dtype=object)).values.astype(object)

            s1 = _std(pd.Series(c1), **opts).values
            s2 = _std(pd.Series(c2), **opts).values

            both_nan = pd.isna(s1) & pd.isna(s2)
            equal    = (s1 == s2) | both_nan

            status = np.where(
                is_left,  "Removed",
                np.where(is_right, "Added",
                np.where(equal,    "Matched", "Not Matched"))
            )
            changed_counts[col] = int((status == "Not Matched").sum())

            out[f"{col} ({file1_name})"] = np.where(is_right, not_f1, c1)
            out[f"{col} ({file2_name})"] = np.where(is_left,  not_f2, c2)

        elif in_old:
            # Column only in File 1
            c1 = merged.get(col, pd.Series(dtype=object)).values.astype(object)
            status = np.where(
                is_left,  "Removed",
                np.where(is_right, "Added", f"Missing in {file2_name}")
            )
            out[f"{col} ({file1_name})"] = np.where(is_right, not_f1, c1)
            out[f"{col} ({file2_name})"] = not_f2

        else:
            # Column only in File 2
            c2 = merged.get(col, pd.Series(dtype=object)).values.astype(object)
            status = np.where(
                is_left,  "Removed",
                np.where(is_right, "Added", f"Missing in {file1_name}")
            )
            out[f"{col} ({file1_name})"] = not_f1
            out[f"{col} ({file2_name})"] = np.where(is_left, not_f2, c2)

        out[sname] = status
        status_col_names.append(sname)

    result_df = pd.DataFrame(out)

    # ── Stats (vectorized) ────────────────────────────────────────────────────
    n_both, n_left, n_right = is_both.sum(), is_left.sum(), is_right.sum()

    if status_col_names and n_both > 0:
        status_mat     = result_df.loc[is_both, status_col_names]
        records_changed = int((status_mat == "Not Matched").any(axis=1).sum())
    else:
        records_changed = 0

    records_matched = int(n_both) - records_changed
    match_pct = round(records_matched / n_both * 100, 1) if n_both > 0 else 100.0

    top_changed = sorted(changed_counts.items(), key=lambda x: -x[1])[:10]

    stats = {
        "total_file1":         int(len(old_valid)),
        "total_file2":         int(len(new_valid)),
        "ignored_file1":       int(old_ignored),
        "ignored_file2":       int(new_ignored),
        "matched_keys":        int(n_both),
        "records_changed":     records_changed,
        "records_matched":     records_matched,
        "records_removed":     int(n_left),
        "records_added":       int(n_right),
        "match_pct":           match_pct,
        "total_cols":          len(all_cols),
        "top_changed_cols":    [{"col": c, "count": n} for c, n in top_changed if n > 0],
        "elapsed_ms":          0,  # filled after Excel write
    }

    # ── Summary sheet ─────────────────────────────────────────────────────────
    summary_df = pd.DataFrame({
        "Metric": [
            f"Total Records in {file1_name}",
            f"Total Records in {file2_name}",
            f"Ignored in {file1_name} (blank key)",
            f"Ignored in {file2_name} (blank key)",
            "Matched keys (in both files)",
            "Records with Differences",
            "Records Fully Matched",
            f"Removed (only in {file1_name})",
            f"Added (only in {file2_name})",
            "Match Score (%)",
            "Columns Compared",
        ],
        "Count": [
            stats["total_file1"],
            stats["total_file2"],
            stats["ignored_file1"],
            stats["ignored_file2"],
            stats["matched_keys"],
            records_changed,
            records_matched,
            stats["records_removed"],
            stats["records_added"],
            match_pct,
            len(all_cols),
        ],
    })

    # ── Write Excel with xlsxwriter (fast — no per-cell Python loop) ──────────
    out_bio = BytesIO()
    with pd.ExcelWriter(out_bio, engine="xlsxwriter") as writer:
        result_df.to_excel(writer, sheet_name="Comparison Details", index=False)
        summary_df.to_excel(writer, sheet_name="Summary Report",    index=False)

        wb = writer.book
        ws = writer.sheets["Comparison Details"]

        # Cell formats
        red_fmt   = wb.add_format({"bg_color": "#FFCCCC", "border": 0})
        green_fmt = wb.add_format({"bg_color": "#CCFFCC", "border": 0})
        amber_fmt = wb.add_format({"bg_color": "#FFF3CD", "border": 0})
        f1_hdr    = wb.add_format({"bg_color": "#B3CDE0", "bold": True})
        f2_hdr    = wb.add_format({"bg_color": "#FEEBAD", "bold": True})
        sta_hdr   = wb.add_format({"bg_color": "#E8E8E8", "bold": True})

        # Header row coloring (single write per cell — not per data row)
        for ci, col_name in enumerate(result_df.columns):
            cn_lower = col_name.lower()
            if file1_name.lower() in cn_lower:
                ws.write(0, ci, col_name, f1_hdr)
            elif file2_name.lower() in cn_lower:
                ws.write(0, ci, col_name, f2_hdr)
            elif "- status" in cn_lower:
                ws.write(0, ci, col_name, sta_hdr)

        # Conditional formatting applied to entire column RANGES — O(columns) not O(rows)
        nrows = len(result_df)
        for ci, col_name in enumerate(result_df.columns):
            if "- Status" not in col_name:
                continue
            ltr = _col_letter(ci)
            rng = f"{ltr}2:{ltr}{nrows + 1}"
            ws.conditional_format(rng, {"type": "cell", "criteria": "==", "value": '"Not Matched"', "format": red_fmt})
            ws.conditional_format(rng, {"type": "cell", "criteria": "==", "value": '"Matched"',     "format": green_fmt})
            ws.conditional_format(rng, {"type": "cell", "criteria": "==", "value": '"Removed"',     "format": red_fmt})
            ws.conditional_format(rng, {"type": "cell", "criteria": "==", "value": '"Added"',       "format": amber_fmt})

        # Freeze panes + auto-filter
        ws.freeze_panes(1, 2)
        ws.autofilter(0, 0, nrows, len(result_df.columns) - 1)

    out_bio.seek(0)
    stats["elapsed_ms"] = int((time.time() - t0) * 1000)
    return out_bio, stats
