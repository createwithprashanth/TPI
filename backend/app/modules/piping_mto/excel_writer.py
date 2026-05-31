from __future__ import annotations

import json
import re
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any

import xlsxwriter


_CATEGORY_HINTS = [
    ("H", "BALL VALVE", ("BALL",)),
    ("I", "CHECK VALVE", ("CHECK", "STOP CHECK")),
    ("J", "PLUG VALVE", ("PLUG",)),
    ("K", "NEEDLE VALVE", ("NEEDLE",)),
    ("L", "BUTTERFLY VALVE", ("BUTTERFLY",)),
    ("M", "THREE WAY VALVE", ("THREE WAY", "3 WAY")),
    ("N", "ANGLE VALVE", ("ANGLE",)),
    ("O", "DIAPHRAGM VALVE", ("DIAPHRAGM",)),
    ("P", "CONTROL VALVE", ("CONTROL VALVE",)),
    ("Q", "STRAINER / FILTER", ("STRAINER", "FILTER")),
    ("R", "SPECIAL PIPING ITEM", ("SPECIAL", "COUPON", "NOZZLE", "TUNDISH")),
]


def _s(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _infer_category(label: str) -> tuple[str, str]:
    upper = _s(label).upper()
    for code, name, hints in _CATEGORY_HINTS:
        if any(h in upper for h in hints):
            return code, name
    return "Z", "UNCLASSIFIED MTO ITEMS"


def _meta(session: dict) -> dict:
    raw = session.get("metadata") or {}
    label = _s(session.get("label"))
    category_code = _s(raw.get("categoryCode"))
    category_name = _s(raw.get("categoryName"))
    if not category_code or not category_name:
        inferred_code, inferred_name = _infer_category(label)
        category_code = category_code or inferred_code
        category_name = category_name or inferred_name

    item_type = _s(raw.get("itemType")) or label
    return {
        "categoryCode": category_code,
        "categoryName": category_name,
        "unit": _s(raw.get("unit")) or "-",
        "itemType": item_type,
        "pipingClass": _s(raw.get("pipingClass")),
        "sizeInch": _s(raw.get("sizeInch")),
        "rating": _s(raw.get("rating")),
        "valveBore": _s(raw.get("valveBore")),
        "endConnection": _s(raw.get("endConnection")),
        "materialDescription": _s(raw.get("materialDescription")),
        "dataSheetDocumentNo": _s(raw.get("dataSheetDocumentNo")),
        "dataSheetReferenceNo": _s(raw.get("dataSheetReferenceNo")),
        "remarks": _s(raw.get("remarks")),
    }


def _natural_key(value: str) -> list[Any]:
    return [int(p) if p.isdigit() else p.lower() for p in re.split(r"(\d+)", value)]


def _iter_detection_rows(payload: dict):
    for session in payload.get("sessions", []):
        metadata = _meta(session)
        for file_result in session.get("fileResults", []):
            drawing = _s(file_result.get("fileName"))
            for match in file_result.get("matches", []):
                yield {
                    "Symbol": _s(session.get("label")),
                    "Category": f"{metadata['categoryCode']}. {metadata['categoryName']}",
                    "Drawing": drawing,
                    "Page": int(match.get("page") or 1),
                    "Score": float(match.get("score") or 0),
                    "X1": int(match.get("x1") or 0),
                    "Y1": int(match.get("y1") or 0),
                    "X2": int(match.get("x2") or 0),
                    "Y2": int(match.get("y2") or 0),
                }


def _aggregate_rows(payload: dict) -> list[dict]:
    groups: dict[tuple, dict] = {}
    for session in payload.get("sessions", []):
        metadata = _meta(session)
        key = (
            metadata["categoryCode"],
            metadata["categoryName"],
            metadata["unit"],
            metadata["itemType"],
            metadata["pipingClass"],
            metadata["sizeInch"],
            metadata["rating"],
            metadata["valveBore"],
            metadata["endConnection"],
            metadata["materialDescription"],
            metadata["dataSheetDocumentNo"],
            metadata["dataSheetReferenceNo"],
            metadata["remarks"],
        )
        if key not in groups:
            groups[key] = {
                **metadata,
                "quantity": 0,
                "symbols": set(),
                "drawings": set(),
                "minScore": 1.0,
            }
        row = groups[key]
        row["symbols"].add(_s(session.get("label")))
        row["quantity"] += int(session.get("count") or 0)
        for file_result in session.get("fileResults", []):
            row["drawings"].add(_s(file_result.get("fileName")))
            for match in file_result.get("matches", []):
                row["minScore"] = min(row["minScore"], float(match.get("score") or 0))

    rows = list(groups.values())
    rows.sort(key=lambda r: (_natural_key(r["categoryCode"]), r["categoryName"], r["itemType"], _natural_key(r["pipingClass"]), _natural_key(r["sizeInch"])))
    return rows


def _qa_rows(payload: dict, mto_rows: list[dict]) -> list[dict]:
    issues = []
    for session in payload.get("sessions", []):
        metadata = _meta(session)
        missing = [
            label for key, label in [
                ("categoryName", "Category"),
                ("itemType", "Item Type"),
                ("pipingClass", "Piping Class"),
                ("sizeInch", "Size"),
                ("rating", "Rating"),
                ("materialDescription", "Material Description"),
                ("dataSheetDocumentNo", "Data Sheet Document No."),
                ("dataSheetReferenceNo", "Data Sheet Reference No."),
            ]
            if not _s(metadata.get(key))
        ]
        if missing:
            issues.append({
                "Severity": "Info",
                "Check": "Metadata Incomplete",
                "Symbol": _s(session.get("label")),
                "Detail": "Missing: " + ", ".join(missing),
            })
        if int(session.get("count") or 0) == 0:
            issues.append({
                "Severity": "Warning",
                "Check": "Zero Quantity",
                "Symbol": _s(session.get("label")),
                "Detail": "Selected symbol/template returned zero detections.",
            })
        low = []
        for file_result in session.get("fileResults", []):
            for match in file_result.get("matches", []):
                if float(match.get("score") or 0) < 0.75:
                    low.append(f"{_s(file_result.get('fileName'))} p{int(match.get('page') or 1)}")
        if low:
            issues.append({
                "Severity": "Warning",
                "Check": "Low Confidence Detections",
                "Symbol": _s(session.get("label")),
                "Detail": f"{len(low)} detection(s) below 0.75 confidence. Examples: {', '.join(low[:5])}",
            })

    by_category = defaultdict(list)
    for row in mto_rows:
        by_category[(row["categoryCode"], row["categoryName"])].append(row)
    for _, rows in by_category.items():
        if len(rows) > 1:
            item_types = {r["itemType"] for r in rows}
            if len(item_types) == 1:
                issues.append({
                    "Severity": "Info",
                    "Check": "Same Item Split Across Metadata",
                    "Symbol": next(iter(item_types)),
                    "Detail": "Same item type appears in multiple MTO rows because class/size/rating metadata differs.",
                })

    if not issues:
        issues.append({
            "Severity": "Pass",
            "Check": "All checks passed",
            "Symbol": "-",
            "Detail": "No MTO QA issues detected.",
        })
    return issues


def _formats(wb):
    return {
        "title": wb.add_format({"bold": True, "font_size": 13, "align": "center", "valign": "vcenter", "border": 1}),
        "subtitle": wb.add_format({"bold": True, "font_size": 11, "align": "center", "valign": "vcenter", "border": 1}),
        "doc": wb.add_format({"font_size": 8, "align": "center", "valign": "vcenter", "border": 1}),
        "logo": wb.add_format({"bold": True, "font_size": 11, "align": "center", "valign": "vcenter", "border": 1}),
        "hdr": wb.add_format({"bold": True, "font_size": 8, "bg_color": "#DCEFF4", "border": 1, "align": "center", "valign": "vcenter", "text_wrap": True}),
        "group": wb.add_format({"bold": True, "font_size": 9, "bg_color": "#DCEFF4", "border": 1, "align": "left", "valign": "vcenter"}),
        "cell": wb.add_format({"font_size": 8, "border": 1, "align": "center", "valign": "vcenter", "text_wrap": True}),
        "left": wb.add_format({"font_size": 8, "border": 1, "align": "left", "valign": "vcenter", "text_wrap": True}),
        "warn": wb.add_format({"font_size": 8, "border": 1, "bg_color": "#FFEB9C", "font_color": "#9C5700", "text_wrap": True}),
        "info": wb.add_format({"font_size": 8, "border": 1, "bg_color": "#DEEAF1", "font_color": "#265680", "text_wrap": True}),
        "pass": wb.add_format({"font_size": 8, "border": 1, "bg_color": "#E2EFDA", "font_color": "#375623", "text_wrap": True}),
    }


def _write_main_mto(path: Path, payload: dict, mto_rows: list[dict]) -> None:
    project = payload.get("project") or {}
    title = _s(project.get("project_name")) or "PROJECT PIPING MATERIAL TAKE-OFF"
    doc_no = _s(project.get("project_no")) or "PROJECT NO. / DOCUMENT NO."

    wb = xlsxwriter.Workbook(path)
    fmt = _formats(wb)
    ws = wb.add_worksheet("Valves MTO")
    ws.set_landscape()
    ws.fit_to_pages(1, 0)
    ws.set_margins(0.25, 0.25, 0.25, 0.25)

    widths = [8, 12, 18, 12, 8, 10, 10, 15, 82, 22, 22, 14, 24]
    for i, width in enumerate(widths):
        ws.set_column(i, i, width)

    ws.set_row(0, 42)
    ws.merge_range(0, 0, 2, 1, _s(project.get("client_name")) or "CLIENT", fmt["logo"])
    ws.merge_range(0, 2, 0, 10, title.upper(), fmt["title"])
    ws.merge_range(0, 11, 0, 12, _s(project.get("contractor_name")) or "CONTRACTOR / EPC", fmt["logo"])
    ws.merge_range(1, 2, 1, 10, "PIPING MATERIAL TAKE-OFF (VALVES MTO)", fmt["subtitle"])
    ws.merge_range(1, 11, 2, 12, f"COMPANY DOC. NO. : {doc_no}", fmt["doc"])
    ws.merge_range(2, 2, 2, 10, _s(project.get("location")), fmt["doc"])

    headers = [
        "SL. No.", "Unit", "Item Type", "Piping\nClass", "Size\n(Inch)",
        "Rating", "Valve\nBore", "End\nConnection", "Material Description",
        "Data Sheet\nDocument Nos.", "Data Sheet\nReference Nos.", "Total\nQuantity", "Remarks",
    ]
    ws.set_row(3, 30)
    for col, header in enumerate(headers):
        ws.write(3, col, header, fmt["hdr"])

    row_no = 4
    grouped = defaultdict(list)
    for row in mto_rows:
        grouped[(row["categoryCode"], row["categoryName"])].append(row)

    for category_key in sorted(grouped, key=lambda k: _natural_key(k[0])):
        code, name = category_key
        ws.set_row(row_no, 24)
        ws.merge_range(row_no, 0, row_no, len(headers) - 1, f"{code}. {name}", fmt["group"])
        row_no += 1
        for idx, item in enumerate(grouped[category_key], start=1):
            ws.set_row(row_no, 32)
            values = [
                f"{code}.{idx}",
                item["unit"],
                item["itemType"],
                item["pipingClass"],
                item["sizeInch"],
                item["rating"],
                item["valveBore"],
                item["endConnection"],
                item["materialDescription"],
                item["dataSheetDocumentNo"],
                item["dataSheetReferenceNo"],
                item["quantity"],
                item["remarks"],
            ]
            for col, value in enumerate(values):
                ws.write(row_no, col, value, fmt["left"] if col in (2, 8, 12) else fmt["cell"])
            row_no += 1

    if not mto_rows:
        ws.merge_range(row_no, 0, row_no, len(headers) - 1, "No MTO rows available.", fmt["cell"])

    ws.freeze_panes(4, 0)
    ws.autofilter(3, 0, max(4, row_no - 1), len(headers) - 1)
    wb.close()


def _write_detection_register(path: Path, payload: dict) -> None:
    wb = xlsxwriter.Workbook(path)
    fmt = _formats(wb)
    ws = wb.add_worksheet("Detection Register")
    headers = ["No.", "Symbol", "Category", "Drawing", "Page", "Score", "X1", "Y1", "X2", "Y2"]
    widths = [7, 24, 28, 42, 8, 10, 10, 10, 10, 10]
    for i, width in enumerate(widths):
        ws.set_column(i, i, width)
        ws.write(0, i, headers[i], fmt["hdr"])
    for idx, row in enumerate(_iter_detection_rows(payload), start=1):
        values = [idx, row["Symbol"], row["Category"], row["Drawing"], row["Page"], row["Score"], row["X1"], row["Y1"], row["X2"], row["Y2"]]
        for col, value in enumerate(values):
            ws.write(idx, col, value, fmt["left"] if col in (1, 2, 3) else fmt["cell"])
    ws.freeze_panes(1, 0)
    ws.autofilter(0, 0, max(1, idx if "idx" in locals() else 1), len(headers) - 1)
    wb.close()


def _write_qa(path: Path, qa_rows: list[dict]) -> None:
    wb = xlsxwriter.Workbook(path)
    fmt = _formats(wb)
    ws = wb.add_worksheet("QA Checks")
    headers = ["Severity", "Check", "Symbol", "Detail"]
    widths = [12, 28, 24, 90]
    for i, width in enumerate(widths):
        ws.set_column(i, i, width)
        ws.write(0, i, headers[i], fmt["hdr"])
    severity_fmt = {"Warning": fmt["warn"], "Info": fmt["info"], "Pass": fmt["pass"]}
    for idx, row in enumerate(qa_rows, start=1):
        row_fmt = severity_fmt.get(row["Severity"], fmt["info"])
        for col, key in enumerate(headers):
            ws.write(idx, col, row.get(key, ""), row_fmt)
    ws.freeze_panes(1, 0)
    ws.autofilter(0, 0, max(1, len(qa_rows)), len(headers) - 1)
    wb.close()


def write_mto_package(output_dir: Path, payload: dict, run_id: str) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    mto_rows = _aggregate_rows(payload)
    qa = _qa_rows(payload, mto_rows)

    mto_path = output_dir / "Piping Material Take-Off.xlsx"
    register_path = output_dir / "Detection Register.xlsx"
    qa_path = output_dir / "QA Checks.xlsx"
    meta_path = output_dir / "mto_run.json"
    zip_path = output_dir / f"Piping_MTO_Results_{run_id}.zip"

    _write_main_mto(mto_path, payload, mto_rows)
    _write_detection_register(register_path, payload)
    _write_qa(qa_path, qa)

    meta_path.write_text(json.dumps({
        "run_id": run_id,
        "symbol_count": len(payload.get("sessions", [])),
        "total_quantity": sum(int(s.get("count") or 0) for s in payload.get("sessions", [])),
        "mto_rows": len(mto_rows),
        "qa_issues": len([r for r in qa if r.get("Severity") != "Pass"]),
        "threshold": payload.get("threshold"),
    }, indent=2), encoding="utf-8")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for fp in (mto_path, register_path, qa_path, meta_path):
            zf.write(fp, fp.name)

    return zip_path
