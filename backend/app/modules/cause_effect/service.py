"""
Cause & Effect Matrix — service layer.

Reads initiators and effects from the instruments table (already classified
by the extraction pipeline) and persists the matrix cells in ce_matrix.
"""
from __future__ import annotations

import json
from typing import Any

from app.config.local_db import connection, row_to_dict

# ── Instrument type → default role heuristics ─────────────────────────────────
# Instruments whose IO_Type / naming pattern makes them causes vs effects.

_CAUSE_IO   = {"AI", "DI", "PI"}          # field initiators
_EFFECT_IO  = {"DO", "AO"}                # final elements / outputs
_SIS_SYS    = {"SIS/ESD", "SIS", "ESD"}
_FG_SYS     = {"F&GS", "F&G"}

# Tag-prefix heuristics when IO_Type is absent
_CAUSE_PREFIXES  = ("PAHH","PALL","PSLL","PSHL","TAHH","TALL","LAHH","LALL",
                    "FSLL","FSHL","FAHH","FALL","PAH","PAL","TAH","TAL",
                    "LAH","LAL","FAH","FAL","PS","LS","FS","TS","GD","FD",
                    "UVSS","AT","QT")
_EFFECT_PREFIXES = ("SDV","ESDV","BDV","SSOV","SSV","SSSV","XV","ZV",
                    "FCV","TCV","PCV","LCV","MOV","SOL","P","K","E","H",
                    "PSV","PRV","RV")


def _role(row: dict) -> str | None:
    io  = str(row.get("io_type") or row.get("IO_Type") or "").strip().upper()
    sys = str(row.get("control_system") or row.get("system") or "").strip().upper()
    tag = str(row.get("tag_number") or "").strip().upper()

    # explicit IO type wins
    if io in _CAUSE_IO  and sys in _SIS_SYS | _FG_SYS | {""}: return "cause"
    if io in _EFFECT_IO and sys in _SIS_SYS | _FG_SYS | {""}: return "effect"

    # fall back to tag prefix
    for p in _CAUSE_PREFIXES:
        if tag.startswith(p): return "cause"
    for p in _EFFECT_PREFIXES:
        if tag.startswith(p): return "effect"
    return None


# ── Public API ────────────────────────────────────────────────────────────────

def get_matrix(project_id: str, system_filter: str | None = None) -> dict:
    """
    Return causes list, effects list, and sparse cells dict for the project.
    system_filter: 'SIS/ESD' | 'F&GS' | None (all)
    """
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT id, tag_number, instrument_type, service,
                   io_type, control_system, sil_level, fail_state,
                   criticality, loop_number, area_code
            FROM instruments
            WHERE project_id = ?
            ORDER BY tag_number
            """,
            (project_id,),
        ).fetchall()

    causes: list[dict]  = []
    effects: list[dict] = []

    for r in rows:
        d = dict(r)
        role = _role(d)
        sys  = str(d.get("control_system") or "").strip().upper()
        if system_filter and sys not in (system_filter.upper(), ""):
            if role == "effect":
                pass  # still include effects (they apply to all systems)
            else:
                continue

        item = {
            "id":              d["id"],
            "tag":             d["tag_number"],
            "type":            d.get("instrument_type") or "",
            "service":         d.get("service") or "",
            "io_type":         d.get("io_type") or "",
            "system":          d.get("control_system") or "",
            "sil":             d.get("sil_level") or "",
            "fail_state":      d.get("fail_state") or "",
            "criticality":     d.get("criticality") or "",
            "loop":            d.get("loop_number") or "",
            "area":            d.get("area_code") or "",
        }
        if role == "cause":
            causes.append(item)
        elif role == "effect":
            effects.append(item)

    # Load saved cells
    with connection() as conn:
        cell_rows = conn.execute(
            "SELECT initiator_tag, effect_tag, action, voting, notes FROM ce_matrix WHERE project_id = ?",
            (project_id,),
        ).fetchall()

    cells: dict[str, dict] = {}
    for cr in cell_rows:
        key = f"{cr['initiator_tag']}|{cr['effect_tag']}"
        cells[key] = {
            "action":  cr["action"],
            "voting":  cr["voting"] or "",
            "notes":   cr["notes"] or "",
        }

    return {
        "project_id": project_id,
        "causes":  causes,
        "effects": effects,
        "cells":   cells,
        "stats": {
            "cause_count":  len(causes),
            "effect_count": len(effects),
            "cell_count":   len(cells),
        },
    }


def upsert_cell(
    project_id:    str,
    initiator_tag: str,
    effect_tag:    str,
    action:        str,
    voting:        str = "",
    notes:         str = "",
    user_id:       str = "local-user",
) -> dict:
    """Save or clear a single C&E cell. action='' removes the entry."""
    with connection() as conn:
        if not action:
            conn.execute(
                "DELETE FROM ce_matrix WHERE project_id=? AND initiator_tag=? AND effect_tag=?",
                (project_id, initiator_tag, effect_tag),
            )
            return {"deleted": True, "initiator_tag": initiator_tag, "effect_tag": effect_tag}

        conn.execute(
            """
            INSERT INTO ce_matrix (project_id, initiator_tag, effect_tag, action, voting, notes, updated_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, initiator_tag, effect_tag)
            DO UPDATE SET action=excluded.action, voting=excluded.voting,
                          notes=excluded.notes, updated_by=excluded.updated_by,
                          updated_at=CURRENT_TIMESTAMP
            """,
            (project_id, initiator_tag, effect_tag, action, voting, notes, user_id),
        )
    return {
        "project_id":    project_id,
        "initiator_tag": initiator_tag,
        "effect_tag":    effect_tag,
        "action":        action,
        "voting":        voting,
        "notes":         notes,
    }


def bulk_upsert_cells(project_id: str, cells: list[dict], user_id: str = "local-user") -> dict:
    """Bulk save cells — used by AI suggest."""
    saved = 0
    for c in cells:
        upsert_cell(
            project_id    = project_id,
            initiator_tag = c["initiator_tag"],
            effect_tag    = c["effect_tag"],
            action        = c.get("action", "X"),
            voting        = c.get("voting", ""),
            notes         = c.get("notes", ""),
            user_id       = user_id,
        )
        saved += 1
    return {"saved": saved}


def suggest_cells(project_id: str) -> list[dict]:
    """
    Heuristic (loop-based) suggestion of C&E relationships.
    Returns list of suggested cells without saving them.
    """
    matrix = get_matrix(project_id)
    causes  = {c["tag"]: c for c in matrix["causes"]}
    effects = {e["tag"]: e for e in matrix["effects"]}

    # Group by loop number
    loop_causes:  dict[str, list[str]] = {}
    loop_effects: dict[str, list[str]] = {}

    for tag, c in causes.items():
        ln = c.get("loop") or ""
        if ln:
            loop_causes.setdefault(ln, []).append(tag)

    for tag, e in effects.items():
        ln = e.get("loop") or ""
        if ln:
            loop_effects.setdefault(ln, []).append(tag)

    suggestions: list[dict] = []
    seen: set[tuple] = set()

    # Loop-matched suggestions
    for ln, ctags in loop_causes.items():
        etags = loop_effects.get(ln, [])
        for ct in ctags:
            for et in etags:
                key = (ct, et)
                if key not in seen:
                    seen.add(key)
                    suggestions.append({
                        "initiator_tag": ct,
                        "effect_tag":    et,
                        "action":        "X",
                        "voting":        "1oo1",
                        "notes":         f"Suggested: same loop {ln}",
                        "confidence":    "loop-match",
                    })

    # Area-matched suggestions (when no loop match found)
    area_causes:  dict[str, list[str]] = {}
    area_effects: dict[str, list[str]] = {}
    for tag, c in causes.items():
        a = c.get("area") or ""
        if a: area_causes.setdefault(a, []).append(tag)
    for tag, e in effects.items():
        a = e.get("area") or ""
        if a: area_effects.setdefault(a, []).append(tag)

    for area, ctags in area_causes.items():
        etags = area_effects.get(area, [])
        for ct in ctags:
            for et in etags:
                key = (ct, et)
                if key not in seen:
                    seen.add(key)
                    suggestions.append({
                        "initiator_tag": ct,
                        "effect_tag":    et,
                        "action":        "X",
                        "voting":        "",
                        "notes":         f"Suggested: same area {area}",
                        "confidence":    "area-match",
                    })

    return suggestions


def export_excel(project_id: str) -> bytes:
    """Generate a styled C&E matrix Excel workbook and return bytes."""
    import io
    import xlsxwriter

    matrix = get_matrix(project_id)
    causes  = matrix["causes"]
    effects = matrix["effects"]
    cells   = matrix["cells"]

    buf = io.BytesIO()
    wb  = xlsxwriter.Workbook(buf, {"in_memory": True})

    # ── Formats ────────────────────────────────────────────────────────────────
    hdr_fmt   = wb.add_format({"bold": True, "bg_color": "#1a1a2e", "font_color": "#ffffff",
                                "border": 1, "align": "center", "valign": "vcenter", "text_wrap": True})
    cause_fmt = wb.add_format({"bold": True, "bg_color": "#0d1b2a", "font_color": "#e0e0e0",
                                "border": 1, "font_size": 9})
    sil_fmt   = wb.add_format({"bold": True, "bg_color": "#2d1b69", "font_color": "#c9b8ff",
                                "border": 1, "align": "center", "font_size": 9})
    x_fmt     = wb.add_format({"bold": True, "bg_color": "#1a3a2a", "font_color": "#4ade80",
                                "border": 1, "align": "center", "valign": "vcenter"})
    a_fmt     = wb.add_format({"bold": True, "bg_color": "#3a2a00", "font_color": "#fbbf24",
                                "border": 1, "align": "center", "valign": "vcenter"})
    i_fmt     = wb.add_format({"bold": True, "bg_color": "#1a1a1a", "font_color": "#6b7280",
                                "border": 1, "align": "center", "valign": "vcenter"})
    empty_fmt = wb.add_format({"bg_color": "#0a0a0f", "border": 1, "border_color": "#2a2a3a"})
    eff_fmt   = wb.add_format({"bold": True, "bg_color": "#0d1b2a", "font_color": "#93c5fd",
                                "border": 1, "rotation": 90, "align": "center",
                                "valign": "bottom", "font_size": 8, "text_wrap": True})
    ro_fmt    = wb.add_format({"bg_color": "#0d1b2a", "font_color": "#6b7280",
                                "border": 1, "align": "center", "font_size": 8})

    ACTION_FMTS = {"X": x_fmt, "A": a_fmt, "I": i_fmt}

    for sheet_name, sys_filter in [("ESD-SIS Matrix", "SIS/ESD"), ("FG Matrix", "F&GS"), ("All", None)]:
        data   = get_matrix(project_id, system_filter=sys_filter)
        c_list = data["causes"]
        e_list = data["effects"]
        c_cells = data["cells"]
        if not c_list and not e_list:
            continue

        ws = wb.add_worksheet(sheet_name)
        ws.freeze_panes(3, 4)   # freeze cause header columns + 2 header rows

        # Fixed left columns
        LEFT_COLS = ["Tag No.", "Description / Service", "Loop", "SIL"]
        LEFT_W    = [14, 32, 10, 6]
        for ci, (lbl, w) in enumerate(zip(LEFT_COLS, LEFT_W)):
            ws.set_column(ci, ci, w)
            ws.write(2, ci, lbl, hdr_fmt)

        # Effect columns (rotated header)
        for ei, eff in enumerate(e_list):
            col = len(LEFT_COLS) + ei
            ws.set_column(col, col, 4)
            ws.write(1, col, eff["tag"],     eff_fmt)
            ws.write(2, col, eff.get("fail_state", ""), ro_fmt)

        ws.set_row(1, 80)
        ws.set_row(2, 20)

        # Title row
        ws.merge_range(0, 0, 0, len(LEFT_COLS) + len(e_list) - 1,
                       f"CAUSE & EFFECT MATRIX — {sheet_name.upper()} — Project: {project_id}", hdr_fmt)

        # Cause rows
        for ri, cause in enumerate(c_list):
            row = ri + 3
            ws.write(row, 0, cause["tag"],             cause_fmt)
            ws.write(row, 1, cause.get("service", ""), cause_fmt)
            ws.write(row, 2, cause.get("loop", ""),    cause_fmt)
            ws.write(row, 3, cause.get("sil", ""),     sil_fmt)

            for ei, eff in enumerate(e_list):
                col = len(LEFT_COLS) + ei
                key = f"{cause['tag']}|{eff['tag']}"
                cell = c_cells.get(key)
                if cell:
                    action = cell.get("action", "X")
                    fmt = ACTION_FMTS.get(action, x_fmt)
                    ws.write(row, col, action, fmt)
                else:
                    ws.write(row, col, "", empty_fmt)

        ws.set_row(0, 20)
        for ri in range(len(c_list)):
            ws.set_row(ri + 3, 16)

    wb.close()
    buf.seek(0)
    return buf.read()
