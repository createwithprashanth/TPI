"""
Engineering-grade Excel deliverable writer for InstruMap.
Shared by both the FastAPI service layer and the RQ background worker.

Produces four separate workbooks:
  Instrument Index.xlsx  — full engineering columns, LLM-enriched per instrument
  IO List.xlsx           — hardwired AI/AO/DI/DO points for DCS/PLC design
  Verification Log.xlsx  — raw OCR extraction with review flags
  Line List.xlsx         — pipe line numbers extracted from P&ID
  Equipment List.xlsx    — equipment tags extracted from P&ID text
"""
import io
import logging
import os
from datetime import date
from typing import Dict, List, Optional

import pandas as pd

from .standard_library import instrument_tag_quality

logger = logging.getLogger(__name__)

# Columns populated by LLM — rendered with a light blue tint so engineers can
# distinguish AI-suggested values from OCR-extracted values at a glance.
_LLM_COLS = {
    "Instrument Service",
    "Process Fluid",
    "Oper. Pressure (bar g)",
    "Oper. Temp. (°C)",
    "Hazardous Area Class",
    "Calibration Range",
    "Accuracy",
    "Process Connection",
    "Suggested Manufacturer",
    "Suggested Model",
    "Notes",
}
# System-derived columns (no blue tint — not AI-suggested)
_PROG_COLS = {"Enclosure / IP Rating", "Fail State", "SIL Level", "Criticality"}


def _ev(enrichment: Dict, tag: str, field: str) -> str:
    """Return one enrichment field for a tag number, or '' if missing."""
    return str(enrichment.get(str(tag), {}).get(field, ""))


def _service_value(enrichment: Dict, tag: str, row) -> str:
    """Instrument service may come from enrichment or deterministic row data."""
    return _ev(enrichment, tag, "service_description") or str(row.get("Instrument_Service", "") or "")


def _service_confidence(enrichment: Dict, tag: str, row) -> str:
    return _ev(enrichment, tag, "service_confidence") or str(row.get("Service_Confidence", "") or "")


def _service_basis(enrichment: Dict, tag: str, row) -> str:
    return _ev(enrichment, tag, "service_basis") or str(row.get("Service_Basis", "") or "")


def _loop_no(row) -> str:
    """Build loop number: first letter of type + area (if any) + loop + numeric suffix."""
    import re as _re
    def _v(val) -> str:
        s = str(val or "").strip()
        return "" if s.lower() == "nan" else s
    t = _v(row.get("Type", ""))
    a = _v(row.get("Area", ""))
    l = _v(row.get("Loop", ""))
    s = _v(row.get("Suffix", ""))
    if not l:
        return ""
    first = t[0] if t else ""
    num_suffix_m = _re.match(r'^(\d+)', s)
    num_suffix = num_suffix_m.group(1) if num_suffix_m else ""
    parts = [p for p in [first, a, l, num_suffix] if p]
    return "-".join(parts)


def _is_type_only_detection(row) -> bool:
    """
    Return True for legend-like/type-only detections such as FE, PIT, TW, XA.

    These are useful in the Verification Log and QA Checks, but they should not
    pollute client-facing deliverables unless a real loop/tag number was found.
    """
    import re as _re

    tag = str(row.get("Tag_Number", "") or "").strip()
    if not tag:
        return True

    if _loop_no(row):
        return False

    # Real instrument tags in this project family carry a numbered body, e.g.
    # FIT-1762P-12. Type-only snippets and legend labels do not.
    return _re.search(r"-\d", tag) is None


def _deliverable_df(master_df: pd.DataFrame) -> pd.DataFrame:
    """Rows suitable for client-facing Instrument Index / IO List workbooks."""
    if master_df.empty:
        return master_df.copy()
    quality = master_df.apply(instrument_tag_quality, axis=1, result_type="expand")
    quality.columns = ["_tag_quality", "_noise_reason"]
    keep_mask = ~master_df.apply(_is_type_only_detection, axis=1)
    keep_mask &= quality["_tag_quality"].eq("accepted")
    if "Rejected_As_Noise" in master_df.columns:
        keep_mask &= master_df["Rejected_As_Noise"] != True
    return master_df[keep_mask].copy()


def _write_cover_sheet(wb, project_info: dict, document_title: str) -> None:
    """Insert a branded title/cover sheet as the FIRST worksheet in the workbook."""
    ws = wb.add_worksheet("Cover")
    ws.set_column(0, 0, 22)   # A: labels
    ws.set_column(1, 4, 19)   # B-E: values
    ws.set_column(5, 6, 18)   # F-G: logo / right side

    title_fmt = wb.add_format({
        "bold": True, "font_size": 20,
        "bg_color": "#1F3864", "font_color": "#FFFFFF",
        "align": "center", "valign": "vcenter",
    })
    sub_fmt = wb.add_format({
        "font_size": 10, "italic": True,
        "bg_color": "#2E4A8B", "font_color": "#C8D4EF",
        "align": "center", "valign": "vcenter",
    })
    label_fmt = wb.add_format({
        "bold": True, "font_size": 10,
        "bg_color": "#EEF2FA", "font_color": "#1F3864",
        "border": 1, "valign": "vcenter", "indent": 1,
    })
    value_fmt = wb.add_format({
        "font_size": 10, "border": 1,
        "valign": "vcenter", "indent": 1,
    })
    logo_label_fmt = wb.add_format({
        "bold": True, "font_size": 9, "font_color": "#555555",
        "align": "center", "valign": "bottom",
    })
    footer_fmt = wb.add_format({
        "font_size": 8, "font_color": "#AAAAAA",
        "italic": True, "align": "right",
    })

    # Row 0: document title
    ws.set_row(0, 52)
    ws.merge_range(0, 0, 0, 6, document_title, title_fmt)

    # Row 1: subtitle
    ws.set_row(1, 22)
    ws.merge_range(1, 0, 1, 6, "Generated by TPI InstruMap  •  Automated P&ID Extraction", sub_fmt)

    # Row 2: spacer
    ws.set_row(2, 14)

    def _join_values(values) -> str:
        if isinstance(values, (list, tuple, set)):
            return ", ".join(str(v) for v in values if str(v or "").strip())
        return str(values or "")

    # Rows 3-14: project/document context table
    location = " ".join(filter(None, [project_info.get("location", ""), project_info.get("country", "")])).strip()
    fields = [
        ("Project Name",       project_info.get("project_name", "")),
        ("Project No.",        project_info.get("project_no", "") or ""),
        ("Client / Owner",     project_info.get("client_name", "") or ""),
        ("Contractor / EPC",   project_info.get("contractor_name", "") or ""),
        ("Location",           location),
        ("Facility / Unit",     " / ".join(filter(None, [project_info.get("facility", ""), project_info.get("unit_area", "")]))),
        ("Document Title",      project_info.get("document_title", "")),
        ("Document No. / Rev.", " / ".join(filter(None, [project_info.get("document_no", ""), project_info.get("revision", "")]))),
        ("Document Type",       project_info.get("document_type", "")),
        ("Discipline / Phase",  " / ".join(filter(None, [project_info.get("discipline", ""), project_info.get("engineering_phase", "")]))),
        ("Standards",           _join_values(project_info.get("standards", []))),
        ("Date Generated",     date.today().strftime("%d %B %Y")),
    ]
    for i, (label, value) in enumerate(fields):
        row = i + 3
        ws.set_row(row, 22)
        ws.write(row, 0, label, label_fmt)
        ws.merge_range(row, 1, row, 6, value, value_fmt)

    scope = str(project_info.get("scope", "") or "").strip()
    source_files = _join_values(project_info.get("source_files", []))
    context_confidence = str(project_info.get("confidence", "") or "").strip()

    scope_row = len(fields) + 4
    if scope:
        ws.set_row(scope_row, 42)
        ws.write(scope_row, 0, "Scope", label_fmt)
        ws.merge_range(scope_row, 1, scope_row, 6, scope, value_fmt)
        scope_row += 1

    if source_files or context_confidence:
        ws.set_row(scope_row, 24)
        ws.write(scope_row, 0, "Context Source", label_fmt)
        source_text = source_files
        if context_confidence:
            source_text = f"{source_text} | Confidence: {context_confidence}" if source_text else f"Confidence: {context_confidence}"
        ws.merge_range(scope_row, 1, scope_row, 6, source_text, value_fmt)
        scope_row += 1

    # Spacer before logos
    logo_start = scope_row + 1
    ws.set_row(logo_start - 1, 14)

    # Logo section (only rendered when at least one logo is present)
    client_bytes = project_info.get("client_logo_bytes")
    contractor_bytes = project_info.get("contractor_logo_bytes")

    if client_bytes or contractor_bytes:
        ws.set_row(logo_start, 14)
        if client_bytes:
            ws.merge_range(logo_start, 0, logo_start, 2, "CLIENT", logo_label_fmt)
        if contractor_bytes:
            ws.merge_range(logo_start, 4, logo_start, 6, "CONTRACTOR / EPC", logo_label_fmt)

        ws.set_row(logo_start + 1, 90)
        if client_bytes:
            ext = project_info.get("client_logo_ext", ".png")
            ws.insert_image(logo_start + 1, 0, f"client_logo{ext}", {
                "image_data": io.BytesIO(client_bytes),
                "x_scale": 0.45, "y_scale": 0.45,
                "x_offset": 8, "y_offset": 8,
                "object_position": 1,
            })
        if contractor_bytes:
            ext = project_info.get("contractor_logo_ext", ".png")
            ws.insert_image(logo_start + 1, 4, f"contractor_logo{ext}", {
                "image_data": io.BytesIO(contractor_bytes),
                "x_scale": 0.45, "y_scale": 0.45,
                "x_offset": 8, "y_offset": 8,
                "object_position": 1,
            })

    # Footer
    footer_row = logo_start + 6
    ws.set_row(footer_row, 14)
    ws.merge_range(
        footer_row, 0, footer_row, 6,
        "Verify all data before use in engineering applications.",
        footer_fmt,
    )


def _make_formats(wb):
    """Create and return a dict of named xlsxwriter formats for a workbook."""
    return {
        "hdr": wb.add_format({
            "bold": True, "bg_color": "#1F3864", "font_color": "#FFFFFF",
            "border": 1, "text_wrap": True, "valign": "vcenter", "align": "center",
        }),
        "hdr_verify": wb.add_format({
            "bold": True, "bg_color": "#0070C0", "font_color": "#FFFFFF", "border": 1,
        }),
        "hdr_lines": wb.add_format({
            "bold": True, "bg_color": "#1F5C2E", "font_color": "#FFFFFF",
            "border": 1, "text_wrap": True, "valign": "vcenter", "align": "center",
        }),
        "loop_even":  wb.add_format({"border": 1}),
        "loop_odd":   wb.add_format({"bg_color": "#F2F2F2", "border": 1}),
        "llm_even":   wb.add_format({"bg_color": "#EBF3FB", "border": 1}),
        "llm_odd":    wb.add_format({"bg_color": "#D6E8F7", "border": 1}),
        "prog_even":  wb.add_format({"bg_color": "#E8F5E9", "border": 1}),
        "prog_odd":   wb.add_format({"bg_color": "#C8E6C9", "border": 1}),
        "warn":       wb.add_format({"bg_color": "#FFEB9C", "font_color": "#9C5700", "border": 1}),
    }


def _write_instrument_index(output_dir: str, index_df: pd.DataFrame, project_info: Optional[dict] = None) -> str:
    path = os.path.join(output_dir, "Instrument Index.xlsx")
    _IDX_WIDTHS = {
        "Tag No.": 18,                  "Loop No.": 12,
        "Instrument Description": 32,
        "Instrument Service": 36,       "Area / Unit": 12,
        "P&ID No.": 22,
        "Service": 18,                  "Process Fluid": 18,
        "Line / Equip. Tag": 20,        "Oper. Pressure (bar g)": 20,
        "Oper. Temp. (°C)": 18,         "Instrument Type": 14,
        "Suffix": 8,
        "Control System": 14,           "IO Type": 10,
        "Signal Type": 22,              "Power Supply": 18,
        "Mounting": 12,                 "Location": 12,
        "Hazardous Area Class": 22,     "Enclosure / IP Rating": 22,
        "Calibration Range": 22,        "Accuracy": 18,
        "Process Connection": 22,       "Fail State": 14,
        "SIL Level": 10,                "Criticality": 16,
        "Status": 10,                   "DCS / PLC Tag": 18,
        "Suggested Manufacturer": 30,   "Suggested Model": 28,
        "Notes": 40,
    }
    with pd.ExcelWriter(path, engine="xlsxwriter") as writer:
        wb = writer.book
        fmt = _make_formats(wb)
        if project_info:
            _write_cover_sheet(wb, project_info, "INSTRUMENT INDEX")
        ws = wb.add_worksheet("Instrument Index")
        writer.sheets["Instrument Index"] = ws
        ws.set_row(0, 32)

        col_names = list(index_df.columns)
        for col_num, col_name in enumerate(col_names):
            ws.write(0, col_num, col_name, fmt["hdr"])
            ws.set_column(col_num, col_num, _IDX_WIDTHS.get(col_name, 18))

        loop_group_idx = -1
        prev_loop = None
        for row_num, (_, data_row) in enumerate(index_df.iterrows(), start=1):
            current_loop = data_row.get("Loop No.", "")
            if current_loop != prev_loop:
                loop_group_idx += 1
                prev_loop = current_loop
            is_odd = (loop_group_idx % 2 == 1)
            for col_num, col_name in enumerate(col_names):
                val = data_row[col_name]
                val = "" if pd.isna(val) else val
                if col_name in _LLM_COLS:
                    cell_fmt = fmt["llm_odd"] if is_odd else fmt["llm_even"]
                elif col_name in _PROG_COLS:
                    cell_fmt = fmt["prog_odd"] if is_odd else fmt["prog_even"]
                else:
                    cell_fmt = fmt["loop_odd"] if is_odd else fmt["loop_even"]
                ws.write(row_num, col_num, val, cell_fmt)

        ws.autofilter(0, 0, len(index_df), len(index_df.columns) - 1)
        ws.freeze_panes(1, 1)

    return path


def _write_io_list(output_dir: str, io_df: pd.DataFrame, project_info: Optional[dict] = None) -> str:
    path = os.path.join(output_dir, "IO List.xlsx")
    _IO_WIDTHS = {
        "Tag No.": 18,           "Loop No.": 12,
        "Instrument Description": 30,
        "Instrument Service": 36, "Line / Equip. Tag": 20,
        "Control System": 14,    "IO Type": 10,
        "Signal Type": 22,
        "Eng. Range Low": 15,    "Eng. Range High": 15,
        "Eng. Range Units": 15,  "Alarm LL": 10,
        "Alarm L": 10,           "Alarm H": 10,
        "Alarm HH": 10,          "Trip L": 10,
        "Trip H": 10,            "Fail State": 14,
        "DCS / PLC Tag": 18,     "Cabinet / Panel": 16,
        "Slot / Channel": 14,    "Terminal": 12,
        "Cable Ref.": 15,        "Junction Box": 14,
        "Remarks": 30,
    }
    with pd.ExcelWriter(path, engine="xlsxwriter") as writer:
        wb = writer.book
        fmt = _make_formats(wb)
        if project_info:
            _write_cover_sheet(wb, project_info, "IO LIST")
        io_df.to_excel(writer, sheet_name="IO List", index=False)
        ws = writer.sheets["IO List"]
        ws.set_row(0, 32)

        for col_num, col_name in enumerate(io_df.columns):
            ws.write(0, col_num, col_name, fmt["hdr"])
            ws.set_column(col_num, col_num, _IO_WIDTHS.get(col_name, 15))

        ws.autofilter(0, 0, len(io_df), len(io_df.columns) - 1)
        ws.freeze_panes(1, 1)

    return path


def _write_verification_log(output_dir: str, verify_df: pd.DataFrame, project_info: Optional[dict] = None) -> str:
    path = os.path.join(output_dir, "Verification Log.xlsx")
    with pd.ExcelWriter(path, engine="xlsxwriter") as writer:
        wb = writer.book
        fmt = _make_formats(wb)
        if project_info:
            _write_cover_sheet(wb, project_info, "VERIFICATION LOG")
        verify_df.to_excel(writer, sheet_name="Verification Log", index=False)
        ws = writer.sheets["Verification Log"]

        for col_num, col_name in enumerate(verify_df.columns):
            ws.write(0, col_num, col_name, fmt["hdr_verify"])
            ws.set_column(col_num, col_num, 25)

        if "Review_Required" in verify_df.columns:
            for row_num in range(len(verify_df)):
                if verify_df.iloc[row_num].get("Review_Required", False):
                    ws.set_row(row_num + 1, None, fmt["warn"])

        ws.autofilter(0, 0, len(verify_df), len(verify_df.columns) - 1)
        ws.freeze_panes(1, 0)

    return path


def _write_qa_checks(
    output_dir: str,
    master_df: pd.DataFrame,
    full_df: pd.DataFrame,
    project_info: Optional[dict] = None,
) -> str:
    """
    Write a QA Checks workbook that surfaces issues the engineer should review:
      - Tags flagged for manual review (low OCR confidence)
      - Tags whose format didn't match the legend pattern
      - Loops with only one instrument (possible missed tag)
      - Tags appearing on more than one P&ID drawing (cross-sheet references)
    """
    issues: list = []

    # ── 1. Low-confidence tags ────────────────────────────────────────────────
    if "Review_Required" in master_df.columns:
        for _, row in master_df[master_df["Review_Required"] == True].iterrows():
            reason = str(row.get("Noise_Reason", "") or "").strip()
            detail = (
                reason
                if bool(row.get("Rejected_As_Noise", False)) and reason
                else "OCR confidence is low — verify this tag against the original P&ID"
            )
            issues.append({
                "Tag Number": row.get("Tag_Number", ""),
                "Severity":   "Error" if bool(row.get("Rejected_As_Noise", False)) else "Warning",
                "Check":      "Rejected as Noise" if bool(row.get("Rejected_As_Noise", False)) else "Manual Review Required",
                "Detail":     detail,
                "P&ID File":  row.get("P&ID_Filename", ""),
            })

    # ── 1b. Type-only detections suppressed from client deliverables ──────────
    for _, row in master_df[master_df.apply(_is_type_only_detection, axis=1)].iterrows():
        issues.append({
            "Tag Number": row.get("Tag_Number", ""),
            "Severity":   "Info",
            "Check":      "Suppressed from Deliverable",
            "Detail":     "Type-only/no-loop detection kept in Verification Log but excluded from Instrument Index and IO List",
            "P&ID File":  row.get("P&ID_Filename", ""),
        })

    # ── 2. Tag format mismatches (populated by tag_validator) ─────────────────
    if "Tag_Format_Note" in master_df.columns:
        note_mask = master_df["Tag_Format_Note"].notna() & (master_df["Tag_Format_Note"].astype(str).str.strip() != "")
        for _, row in master_df[note_mask].iterrows():
            issues.append({
                "Tag Number": row.get("Tag_Number", ""),
                "Severity":   "Warning",
                "Check":      "Tag Format Mismatch",
                "Detail":     str(row.get("Tag_Format_Note", "")),
                "P&ID File":  row.get("P&ID_Filename", ""),
            })

    # ── 3. Single-instrument loops ────────────────────────────────────────────
    # ISA loops typically have at least 2 instruments; a lone instrument may mean
    # the companion tag was missed by the extractor.
    loop_col = "Loop" if "Loop" in master_df.columns else None
    area_col = "Area" if "Area" in master_df.columns else None
    if loop_col and area_col:
        loop_sub = master_df[
            master_df[loop_col].notna() & (master_df[loop_col].astype(str).str.strip() != "")
        ].copy()
        loop_sub["_loop_key"] = (
            loop_sub[area_col].fillna("").astype(str) + "|" +
            loop_sub[loop_col].fillna("").astype(str)
        )
        loop_counts = loop_sub["_loop_key"].value_counts()
        single_keys = loop_counts[loop_counts == 1].index
        for key in single_keys[:100]:  # cap to avoid huge reports
            match = loop_sub[loop_sub["_loop_key"] == key]
            if match.empty:
                continue
            row = match.iloc[0]
            area = row.get(area_col, "")
            loop = row.get(loop_col, "")
            loop_label = f"{area}-{loop}" if area else str(loop)
            issues.append({
                "Tag Number": row.get("Tag_Number", ""),
                "Severity":   "Info",
                "Check":      "Single-Instrument Loop",
                "Detail":     f"Loop {loop_label} has only 1 instrument — check for missed companion tag",
                "P&ID File":  row.get("P&ID_Filename", ""),
            })

    # ── 4. Loop completeness — ISA-standard minimum instrument sets ───────────
    # Each process loop should have at least one field device (transmitter/element)
    # and, where a final element exists, a corresponding measuring device.
    if loop_col and area_col and "Type" in master_df.columns:
        _FIELD_DEVICES = {
            # Transmitters / elements (measure the variable)
            "FT", "FIT", "FE", "FQ", "FQT",
            "PT", "PIT", "PE", "PDT", "PDIT",
            "TT", "TIT", "TE", "TW", "TG",
            "LT", "LIT", "LE", "LG",
            "AT", "AIT",
            "FT", "WT", "WIT", "ST", "SIT",
            "VT", "VIT",
        }
        _FINAL_ELEMENTS = {
            # Control / on-off valves and other actuated elements
            "FCV", "PCV", "TCV", "LCV",
            "XV", "BDV", "SDV", "ESV",
            "HV", "MOV",
        }
        _CONTROLLERS = {
            "FIC", "PIC", "TIC", "LIC", "FRC",
            "FFC", "AIC",
        }
        _ALARM_ONLY = {
            "FAH", "FAL", "PAH", "PAL", "TAH", "TAL", "LAH", "LAL",
            "FAHH", "FALL", "PAHH", "PALL", "TAHH", "TALL", "LAHH", "LALL",
            "PSH", "PSHH", "PSLL", "PSL",
            "LSH", "LSHH", "LSLL", "LSL",
            "TSH", "TSHH", "TSLL", "TSL",
            "FSH", "FSHH", "FSLL", "FSL",
        }
        _loop_df = master_df[
            master_df[loop_col].notna() & (master_df[loop_col].astype(str).str.strip() != "")
        ].copy()
        _loop_df["_lk"] = (
            _loop_df[area_col].fillna("").astype(str) + "|" +
            _loop_df[loop_col].fillna("").astype(str)
        )
        for _lk, _grp in _loop_df.groupby("_lk"):
            if len(_grp) < 2:
                continue  # singles handled by check 3
            types_in_loop = set(_grp["Type"].str.strip().str.upper())
            has_field = bool(types_in_loop & _FIELD_DEVICES)
            has_final = bool(types_in_loop & _FINAL_ELEMENTS)
            has_ctrl  = bool(types_in_loop & _CONTROLLERS)
            all_alarms = types_in_loop.issubset(_ALARM_ONLY | {"", "UNKNOWN", "REVIEW"})

            area_part = _lk.split("|")[0]
            loop_part = _lk.split("|")[1]
            loop_label = f"{area_part}-{loop_part}" if area_part else loop_part
            rep = _grp.iloc[0]

            if has_final and not has_field:
                issues.append({
                    "Tag Number": rep.get("Tag_Number", ""),
                    "Severity":   "Warning",
                    "Check":      "Loop Completeness",
                    "Detail":     f"Loop {loop_label} has a final element ({', '.join(types_in_loop & _FINAL_ELEMENTS)}) but no transmitter/sensor",
                    "P&ID File":  rep.get("P&ID_Filename", ""),
                })
            elif has_ctrl and not has_field:
                issues.append({
                    "Tag Number": rep.get("Tag_Number", ""),
                    "Severity":   "Warning",
                    "Check":      "Loop Completeness",
                    "Detail":     f"Loop {loop_label} has a controller ({', '.join(types_in_loop & _CONTROLLERS)}) but no transmitter/sensor",
                    "P&ID File":  rep.get("P&ID_Filename", ""),
                })

    # ── 5. Tags found on multiple drawings ────────────────────────────────────
    if not full_df.empty and "Tag_Number" in full_df.columns and "P&ID_Filename" in full_df.columns:
        file_counts = (
            full_df.dropna(subset=["Tag_Number", "P&ID_Filename"])
            .groupby("Tag_Number")["P&ID_Filename"]
            .nunique()
        )
        multi_file_tags = file_counts[file_counts > 1].index
        for tag in multi_file_tags[:50]:
            files = full_df[full_df["Tag_Number"] == tag]["P&ID_Filename"].dropna().unique()
            issues.append({
                "Tag Number": tag,
                "Severity":   "Info",
                "Check":      "Tag on Multiple Drawings",
                "Detail":     f"Appears on {len(files)} P&ID files: {', '.join(str(f) for f in files[:3])}",
                "P&ID File":  " / ".join(str(f) for f in files[:3]),
            })

    # ── 6. Service confidence and basis checks ───────────────────────────────
    if "Service_Confidence" in master_df.columns:
        service_conf = master_df["Service_Confidence"].fillna("").astype(str).str.strip()
        for _, row in master_df[service_conf.eq("Review")].iterrows():
            issues.append({
                "Tag Number": row.get("Tag_Number", ""),
                "Severity":   "Warning",
                "Check":      "Service Requires Review",
                "Detail":     f"Instrument service is '{row.get('Instrument_Service', '')}' — verify extracted tag/service",
                "P&ID File":  row.get("P&ID_Filename", ""),
            })

        for _, row in master_df[service_conf.eq("Low")].iterrows():
            issues.append({
                "Tag Number": row.get("Tag_Number", ""),
                "Severity":   "Info",
                "Check":      "Service Confidence Low",
                "Detail":     f"Service basis: {row.get('Service_Basis', 'tag type only')}",
                "P&ID File":  row.get("P&ID_Filename", ""),
            })

    # ── 7. Missing context for service-critical instruments ──────────────────
    if {"Type", "Service_Confidence", "Service_Basis"}.issubset(master_df.columns):
        key_types = {
            "PIT", "PT", "PDT", "PDIT", "TIT", "TT", "LIT", "LT", "FIT", "FT",
            "PSH", "PSAH", "TSH", "LSH", "FSH",
        }
        svc_mask = (
            master_df["Type"].fillna("").astype(str).str.upper().isin(key_types)
            & master_df["Service_Confidence"].fillna("").astype(str).isin(["Low", "Medium"])
            & ~master_df["Service_Basis"].fillna("").astype(str).str.contains(
                "equipment|valve|upstream|downstream", case=False, regex=True
            )
        )
        for _, row in master_df[svc_mask].iterrows():
            issues.append({
                "Tag Number": row.get("Tag_Number", ""),
                "Severity":   "Info",
                "Check":      "Missing Equipment Context",
                "Detail":     "Service is based on tag/line only — equipment or valve context was not found",
                "P&ID File":  row.get("P&ID_Filename", ""),
            })

    # ── 8. F&G line conflict guard ───────────────────────────────────────────
    if {"System", "Connected_Line"}.issubset(master_df.columns):
        fgs_line_mask = (
            master_df["System"].fillna("").astype(str).eq("F&GS")
            & master_df["Connected_Line"].fillna("").astype(str).str.strip().ne("")
        )
        for _, row in master_df[fgs_line_mask].iterrows():
            issues.append({
                "Tag Number": row.get("Tag_Number", ""),
                "Severity":   "Warning",
                "Check":      "F&G Line Conflict",
                "Detail":     f"F&G instrument should not have process line {row.get('Connected_Line', '')}",
                "P&ID File":  row.get("P&ID_Filename", ""),
            })

    if not issues:
        issues.append({
            "Tag Number": "—",
            "Severity":   "Pass",
            "Check":      "All checks passed",
            "Detail":     "No issues detected in this extraction",
            "P&ID File":  "—",
        })

    issues_df = pd.DataFrame(issues, columns=["Tag Number", "Severity", "Check", "Detail", "P&ID File"])

    path = os.path.join(output_dir, "QA Checks.xlsx")
    with pd.ExcelWriter(path, engine="xlsxwriter") as writer:
        wb = writer.book
        if project_info:
            _write_cover_sheet(wb, project_info, "QA CHECKS")

        issues_df.to_excel(writer, sheet_name="QA Checks", index=False)
        ws = writer.sheets["QA Checks"]
        ws.set_row(0, 28)

        hdr_qa  = wb.add_format({"bold": True, "bg_color": "#7B2D8B", "font_color": "#FFFFFF",
                                   "border": 1, "valign": "vcenter"})
        warn_fmt = wb.add_format({"bg_color": "#FFEB9C", "font_color": "#9C5700", "border": 1})
        info_fmt = wb.add_format({"bg_color": "#DEEAF1", "font_color": "#265680", "border": 1})
        pass_fmt = wb.add_format({"bg_color": "#E2EFDA", "font_color": "#375623", "border": 1})

        col_widths = {"Tag Number": 20, "Severity": 12, "Check": 28, "Detail": 60, "P&ID File": 32}
        for col_num, col_name in enumerate(issues_df.columns):
            ws.write(0, col_num, col_name, hdr_qa)
            ws.set_column(col_num, col_num, col_widths.get(col_name, 20))

        severity_fmt = {"Warning": warn_fmt, "Info": info_fmt, "Pass": pass_fmt}
        for row_num, (_, row) in enumerate(issues_df.iterrows(), start=1):
            row_fmt = severity_fmt.get(str(row.get("Severity", "")), info_fmt)
            ws.set_row(row_num, None, row_fmt)

        ws.autofilter(0, 0, len(issues_df), len(issues_df.columns) - 1)
        ws.freeze_panes(1, 0)

    return path


def _write_line_list(output_dir: str, line_list_df: pd.DataFrame, project_info: Optional[dict] = None) -> str:
    path = os.path.join(output_dir, "Line List.xlsx")
    _LINE_WIDTHS = {
        'Line_Number': 22, 'Pipe_Size': 10, 'Size_Unit': 12,
        'Fluid_Code': 12,  'Sequence_No': 12, 'Area_Code': 12,
        'Insulation': 12,  'P&ID_Filename': 28, 'P&ID_Page': 10, 'Coordinates': 16,
    }
    with pd.ExcelWriter(path, engine="xlsxwriter") as writer:
        wb = writer.book
        fmt = _make_formats(wb)
        if project_info:
            _write_cover_sheet(wb, project_info, "LINE LIST")
        line_list_df.to_excel(writer, sheet_name="Line List", index=False)
        ws = writer.sheets["Line List"]
        ws.set_row(0, 28)

        for col_num, col_name in enumerate(line_list_df.columns):
            ws.write(0, col_num, col_name, fmt["hdr_lines"])
            ws.set_column(col_num, col_num, _LINE_WIDTHS.get(col_name, 15))

        ws.autofilter(0, 0, len(line_list_df), len(line_list_df.columns) - 1)
        ws.freeze_panes(1, 0)

    return path


def _write_equipment_list(output_dir: str, equipment_df: pd.DataFrame, project_info: Optional[dict] = None) -> str:
    path = os.path.join(output_dir, "Equipment List.xlsx")
    _EQUIP_WIDTHS = {
        "Equipment_Tag": 20,
        "Equipment_Type": 20,
        "Equipment_Code": 16,
        "Equipment_Number": 18,
        "P&ID_Filename": 28,
        "P&ID_Page": 10,
        "Coordinates": 16,
    }
    with pd.ExcelWriter(path, engine="xlsxwriter") as writer:
        wb = writer.book
        fmt = _make_formats(wb)
        if project_info:
            _write_cover_sheet(wb, project_info, "EQUIPMENT LIST")
        equipment_df.to_excel(writer, sheet_name="Equipment List", index=False)
        ws = writer.sheets["Equipment List"]
        ws.set_row(0, 28)

        for col_num, col_name in enumerate(equipment_df.columns):
            ws.write(0, col_num, col_name, fmt["hdr_lines"])
            ws.set_column(col_num, col_num, _EQUIP_WIDTHS.get(col_name, 18))

        ws.autofilter(0, 0, len(equipment_df), len(equipment_df.columns) - 1)
        ws.freeze_panes(1, 0)

    return path


def write_engineering_excel(
    output_dir: str,
    master_df: pd.DataFrame,
    full_df: pd.DataFrame,
    enrichment: Dict,
    lines_df: pd.DataFrame = None,
    equipment_df: pd.DataFrame = None,
    project_info: Optional[Dict] = None,
) -> List[str]:
    """
    Write engineering-grade Excel deliverables as four separate files.

    Args:
        output_dir  : Directory where the four .xlsx files will be written.
        master_df   : Deduplicated instrument DataFrame (one row per tag).
        full_df     : Raw extraction DataFrame (all pages, all occurrences).
        enrichment  : Per-tag LLM enrichment dict keyed by Tag_Number.
        lines_df    : Line numbers DataFrame (optional).
        equipment_df: Equipment tags DataFrame (optional).

    Returns:
        List of absolute paths to the files written.
    """
    # Sort master_df: P&ID No. → Loop No. → Tag_Number
    master_df = master_df.copy()
    master_df["_loop_no"] = master_df.apply(_loop_no, axis=1)
    pid_col = "P&ID_Filename"
    master_df["_pid_no"] = (master_df[pid_col].fillna("").astype(str)
                            if pid_col in master_df.columns else "")
    master_df.sort_values(by=["_pid_no", "_loop_no", "Tag_Number"], inplace=True)
    master_df.drop(columns=["_loop_no", "_pid_no"], inplace=True)
    deliverable_df = _deliverable_df(master_df)

    # ── Build Instrument Index DataFrame ──────────────────────────────────────
    _IDX_COLS = [
        "Tag No.", "Loop No.", "Instrument Description", "Instrument Service",
        "Service Confidence", "Service Basis", "Instrument Type", "Suffix",
        "P&ID No.", "Line / Equip. Tag", "Control System", "IO Type",
        "Signal Type", "Power Supply", "Mounting", "Location",
        "Enclosure / IP Rating", "Fail State", "SIL Level", "Criticality",
        "Review Required",
    ]
    idx_rows = []
    for _, row in deliverable_df.iterrows():
        tag = str(row.get("Tag_Number", ""))
        idx_rows.append({
            "Tag No.":                tag,
            "Loop No.":               _loop_no(row),
            "Instrument Description": row.get("Instrument_Description", ""),
            "Instrument Service":     _service_value(enrichment, tag, row),
            "Service Confidence":     _service_confidence(enrichment, tag, row),
            "Service Basis":          _service_basis(enrichment, tag, row),
            "P&ID No.":               row.get("P&ID_Filename", ""),
            "Line / Equip. Tag":      row.get("Connected_Line", ""),
            "Instrument Type":        row.get("Type", ""),
            "Suffix":                 row.get("Suffix", ""),
            "Control System":         row.get("System", ""),
            "IO Type":                row.get("IO_Type", ""),
            "Signal Type":            row.get("Signal_Type", ""),
            "Power Supply":           row.get("Power_Supply", ""),
            "Mounting":               row.get("Mounting", ""),
            "Location":               row.get("Location_Drawing", ""),
            "Enclosure / IP Rating":  row.get("Enclosure", ""),
            "Fail State":             row.get("Fail_State", ""),
            "SIL Level":              row.get("SIL_Level", ""),
            "Criticality":            row.get("Criticality", "") or "Normal",
            "Review Required":        "Yes" if bool(row.get("Review_Required", False)) else "",
        })
    index_df = pd.DataFrame(idx_rows, columns=_IDX_COLS) if idx_rows else pd.DataFrame(columns=_IDX_COLS)

    # ── Build IO List DataFrame ───────────────────────────────────────────────
    _HARDWIRED_IO = {"AI", "AO", "DI", "DO", "PI"}
    _IO_COLS = [
        "Tag No.", "Loop No.", "Instrument Description", "Instrument Service",
        "Service Confidence", "Service Basis", "Line / Equip. Tag",
        "Control System", "IO Type", "Signal Type", "Power Supply",
        "Fail State", "SIL Level",
    ]
    io_mask = (
        deliverable_df["IO_Type"].isin(_HARDWIRED_IO)
        & (deliverable_df.get("Review_Required", pd.Series(False, index=deliverable_df.index)) != True)
        if "IO_Type" in deliverable_df.columns
        else pd.Series(False, index=deliverable_df.index)
    )
    io_rows = []
    for _, row in deliverable_df[io_mask].iterrows():
        tag = str(row.get("Tag_Number", ""))
        io_rows.append({
            "Tag No.":          tag,
            "Loop No.":         _loop_no(row),
            "Instrument Description": row.get("Instrument_Description", ""),
            "Instrument Service": _service_value(enrichment, tag, row),
            "Service Confidence": _service_confidence(enrichment, tag, row),
            "Service Basis":    _service_basis(enrichment, tag, row),
            "Line / Equip. Tag": row.get("Connected_Line", ""),
            "Control System":   row.get("System", ""),
            "IO Type":          row.get("IO_Type", ""),
            "Signal Type":      row.get("Signal_Type", ""),
            "Power Supply":     row.get("Power_Supply", ""),
            "Fail State":       row.get("Fail_State", ""),
            "SIL Level":        row.get("SIL_Level", ""),
        })
    io_df = pd.DataFrame(io_rows, columns=_IO_COLS) if io_rows else pd.DataFrame(columns=_IO_COLS)

    # ── Build Verification Log DataFrame ──────────────────────────────────────
    _lead = ["Ref_ID", "Tag_Number", "Verification_Source", "P&ID_Filename"]
    verify_col_order = _lead + [c for c in full_df.columns if c not in _lead]
    verify_df = full_df[[c for c in verify_col_order if c in full_df.columns]].copy()

    # ── Build Line List DataFrame ─────────────────────────────────────────────
    _LINE_COLS = [
        'Line_Number', 'Pipe_Size', 'Size_Unit', 'Fluid_Code',
        'Sequence_No', 'Area_Code', 'Insulation', 'Spec',
        'P&ID_Filename', 'P&ID_Page', 'Coordinates',
    ]
    if lines_df is not None and not lines_df.empty:
        line_list_df = lines_df[[c for c in _LINE_COLS if c in lines_df.columns]].copy()
    else:
        line_list_df = pd.DataFrame(columns=_LINE_COLS)

    # ── Build Equipment List DataFrame ───────────────────────────────────────
    _EQUIP_COLS = [
        "Equipment_Tag", "Equipment_Type", "Equipment_Code", "Equipment_Number",
        "P&ID_Filename", "P&ID_Page", "Coordinates",
    ]
    if equipment_df is not None and not equipment_df.empty:
        equipment_list_df = equipment_df[[c for c in _EQUIP_COLS if c in equipment_df.columns]].copy()
    else:
        equipment_list_df = pd.DataFrame(columns=_EQUIP_COLS)

    # ── Write the six files ───────────────────────────────────────────────────
    written = []
    written.append(_write_instrument_index(output_dir, index_df, project_info=project_info))
    written.append(_write_io_list(output_dir, io_df, project_info=project_info))
    written.append(_write_verification_log(output_dir, verify_df, project_info=project_info))
    written.append(_write_line_list(output_dir, line_list_df, project_info=project_info))
    written.append(_write_equipment_list(output_dir, equipment_list_df, project_info=project_info))
    written.append(_write_qa_checks(output_dir, master_df, full_df, project_info=project_info))

    logger.info(f"Engineering Excel files written to: {output_dir}")
    return written
