"""
ISA-style Instrument Datasheet PDF generator.
Uses ReportLab Platypus — A4 portrait, professional engineering layout.
"""
from __future__ import annotations

from io import BytesIO
from datetime import date
from typing import Any

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT  # noqa: F401

# ── Brand palette ─────────────────────────────────────────────────────────────

NAVY   = HexColor('#1A2744')
DARK   = HexColor('#0D1525')
SUBHDR = HexColor('#2D3A5C')
ACCENT = HexColor('#4A90D9')
LIGHT  = HexColor('#F5F7FA')
GRAY   = HexColor('#E5E7EB')
MID    = HexColor('#9CA3AF')
TEXT   = HexColor('#111827')


# ── Paragraph styles ──────────────────────────────────────────────────────────

def _style(name: str, font: str = 'Helvetica', size: int = 8,
           color=TEXT, leading: int = 10, align=TA_LEFT) -> ParagraphStyle:
    return ParagraphStyle(name, fontName=font, fontSize=size,
                          textColor=color, leading=leading, alignment=align)


_normal = _style('n')
_bold   = _style('b', font='Helvetica-Bold')
_label  = _style('lbl', size=7, color=MID, leading=9)
_white  = _style('w', font='Helvetica-Bold', size=8, color=white)
_brand  = _style('br', font='Helvetica-Bold', size=11, color=ACCENT)
_title  = _style('ti', font='Helvetica-Bold', size=13, color=white, align=TA_CENTER)
_tag_r  = _style('tr', font='Helvetica-Bold', size=11, color=white, align=TA_RIGHT)
_sec    = _style('s', font='Helvetica-Bold', size=8, color=white)
_sub    = _style('su', font='Helvetica-Bold', size=7, color=white)


def _p(text: str, style=_normal) -> Paragraph:
    return Paragraph(str(text) if text else '—', style)


def _fmt(value: Any) -> str:
    if value is None:
        return '—'
    if isinstance(value, float):
        return f'{value:g}'
    return str(value)


# ── Shared table style helpers ─────────────────────────────────────────────────

def _data_style(has_alt: bool = True) -> TableStyle:
    cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), SUBHDR),
        ('TEXTCOLOR',  (0, 0), (-1, 0), white),
        ('FONTNAME',   (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE',   (0, 0), (-1, -1), 8),
        ('GRID',       (0, 0), (-1, -1), 0.4, GRAY),
        ('LEFTPADDING',  (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING',   (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING',(0, 0), (-1, -1), 3),
    ]
    if has_alt:
        cmds.append(('ROWBACKGROUNDS', (0, 1), (-1, -1), [white, LIGHT]))
    else:
        cmds.append(('BACKGROUND', (0, 1), (-1, -1), white))
    return TableStyle(cmds)


def _section_banner(label: str, width: float) -> Table:
    t = Table([[_p(label, _sec)]], colWidths=[width])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), NAVY),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING',  (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    return t


def _sub_banner(label: str, width: float) -> Table:
    t = Table([[_p(label.upper(), _sub)]], colWidths=[width])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), SUBHDR),
        ('TEXTCOLOR',  (0, 0), (-1, -1), white),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING',  (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    return t


# ── Main builder ──────────────────────────────────────────────────────────────

def build_datasheet_pdf(
    instrument:      dict,
    spec_sheets:     list[dict],
    process_data:    list[dict],
    calculations:    list[dict],
    template_fields: list[dict],
    project_name:    str = '',
) -> bytes:
    """
    Generate an ISA-style A4 datasheet PDF.
    Returns raw bytes.
    """
    buf = BytesIO()
    W = A4[0] - 24 * mm  # usable width

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=12 * mm, rightMargin=12 * mm,
        topMargin=10 * mm, bottomMargin=14 * mm,
        title=f"Datasheet – {instrument.get('tag_number', '')}",
        author='XYRA Studio',
    )

    # ── Instrument identity ──────────────────────────────────────────────────
    tag     = instrument.get('tag_number',      '') or ''
    service = instrument.get('service',         '') or ''
    itype   = instrument.get('instrument_type', '') or ''
    line    = instrument.get('line_tag',        '') or ''
    area    = instrument.get('area_code',       '') or ''
    pid_no  = instrument.get('pid_number',      '') or ''
    io_type = instrument.get('io_type',         '') or ''
    loop    = instrument.get('loop_number',     '') or ''

    # Latest spec sheet
    ss       = spec_sheets[0] if spec_sheets else {}
    rev_no   = ss.get('revision',             'Rev 0') or 'Rev 0'
    rev_date = ss.get('revision_date',        str(date.today())) or str(date.today())
    rev_desc = ss.get('revision_description', 'Initial Issue') or 'Initial Issue'
    ds_status  = ss.get('status',      'Draft') or 'Draft'
    prepared   = ss.get('prepared_by', '')       or ''
    checked    = ss.get('checked_by',  '')       or ''
    approved   = ss.get('approved_by', '')       or ''

    story: list = []

    # ── Title banner ──────────────────────────────────────────────────────────
    t_title = Table(
        [[_p('XYRA STUDIO', _brand),
          _p('INSTRUMENT DATA SHEET', _title),
          _p(f'Tag: <b>{tag}</b>', _tag_r)]],
        colWidths=[W * 0.22, W * 0.56, W * 0.22],
    )
    t_title.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), DARK),
        ('LEFTPADDING',   (0, 0), (-1, -1), 8),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 8),
        ('TOPPADDING',    (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ('LINEBELOW',     (0, 0), (-1, -1), 1.5, ACCENT),
    ]))
    story.append(t_title)

    # ── Identity grid ─────────────────────────────────────────────────────────
    id_data = [
        [_p('SERVICE', _label),   _p(service, _normal),
         _p('TYPE', _label),      _p(itype,   _normal)],
        [_p('LINE TAG', _label),  _p(line,    _normal),
         _p('AREA', _label),      _p(area,    _normal)],
        [_p('P&ID NO.', _label),  _p(pid_no,  _normal),
         _p('IO / LOOP', _label), _p(f'{io_type}  {loop}'.strip() or '—', _normal)],
        [_p('PROJECT', _label),   _p(project_name, _normal),
         _p('STATUS', _label),    _p(ds_status, _bold)],
    ]
    t_id = Table(id_data, colWidths=[W * 0.15, W * 0.35, W * 0.15, W * 0.35])
    t_id.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), LIGHT),
        ('GRID',       (0, 0), (-1, -1), 0.4, GRAY),
        ('TEXTCOLOR',  (0, 0), (0, -1), MID),
        ('TEXTCOLOR',  (2, 0), (2, -1), MID),
        ('FONTNAME',   (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE',   (0, 0), (-1, -1), 8),
        ('LEFTPADDING',  (0, 0), (-1, -1), 6),
        ('TOPPADDING',   (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING',(0, 0), (-1, -1), 3),
    ]))
    story.append(t_id)

    # ── Revision / Approval block ─────────────────────────────────────────────
    appr_rows = [
        [_p('REV', _label), _p('DATE', _label), _p('DESCRIPTION', _label),
         _p('PREPARED BY', _label), _p('CHECKED BY', _label), _p('APPROVED BY', _label)],
        [_p(rev_no, _bold), _p(rev_date, _normal), _p(rev_desc, _normal),
         _p(prepared, _normal), _p(checked, _normal), _p(approved, _normal)],
    ]
    for old in spec_sheets[1:3]:  # up to 2 prior revisions
        appr_rows.append([
            _p(old.get('revision', '') or '', _normal),
            _p(old.get('revision_date', '') or '', _normal),
            _p(old.get('revision_description', '') or '', _normal),
            _p(old.get('prepared_by', '') or '', _normal),
            _p(old.get('checked_by',  '') or '', _normal),
            _p(old.get('approved_by', '') or '', _normal),
        ])
    t_appr = Table(appr_rows,
                   colWidths=[W * 0.09, W * 0.13, W * 0.26,
                               W * 0.17, W * 0.17, W * 0.18])
    t_appr.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), SUBHDR),
        ('TEXTCOLOR',  (0, 0), (-1, 0), MID),
        ('BACKGROUND', (0, 1), (-1, 1), white),
        ('BACKGROUND', (0, 2), (-1, -1), LIGHT),
        ('GRID',       (0, 0), (-1, -1), 0.4, GRAY),
        ('FONTNAME',   (0, 0), (-1, -1), 'Helvetica'),
        ('FONTSIZE',   (0, 0), (-1, -1), 8),
        ('LEFTPADDING',  (0, 0), (-1, -1), 5),
        ('TOPPADDING',   (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING',(0, 0), (-1, -1), 3),
    ]))
    story.append(t_appr)
    story.append(Spacer(1, 4 * mm))

    # ── Process Data ──────────────────────────────────────────────────────────
    if process_data:
        story.append(_section_banner('PROCESS DATA', W))
        pd_hdr = [[
            _p('Case', _white), _p('Fluid', _white),   _p('Phase', _white),
            _p('T op (°C)', _white), _p('T ds (°C)', _white),
            _p('P op (barg)', _white), _p('P ds (barg)', _white),
            _p('Flow (N)', _white),   _p('Unit', _white),
        ]]
        pd_rows = []
        for pc in process_data:
            pd_rows.append([
                _p(pc.get('case_name',           '') or ''),
                _p(pc.get('fluid',               '') or ''),
                _p(pc.get('fluid_state',         '') or ''),
                _p(_fmt(pc.get('temp_operating_c'))),
                _p(_fmt(pc.get('temp_design_c'))),
                _p(_fmt(pc.get('press_operating_barg'))),
                _p(_fmt(pc.get('press_design_barg'))),
                _p(_fmt(pc.get('flow_normal'))),
                _p(pc.get('flow_unit', '') or ''),
            ])
        cw_pd = [W*0.10, W*0.12, W*0.09, W*0.10,
                 W*0.10, W*0.12, W*0.12, W*0.12, W*0.09]
        t_pd = Table(pd_hdr + pd_rows, colWidths=cw_pd)
        t_pd.setStyle(_data_style())
        story.append(t_pd)
        story.append(Spacer(1, 4 * mm))

    # ── Specification (UDF fields grouped by section) ─────────────────────────
    if template_fields and ss:
        story.append(_section_banner('SPECIFICATION', W))

        # Group by section, preserving definition order
        sections: dict[str, list[dict]] = {}
        for f in template_fields:
            sn = f.get('section') or 'General'
            sections.setdefault(sn, []).append(f)

        for sn, fields in sections.items():
            story.append(_sub_banner(sn, W))
            rows: list = []
            for i in range(0, len(fields), 2):
                f1 = fields[i]
                f2 = fields[i + 1] if i + 1 < len(fields) else None
                v1 = str(ss.get(f1['udf']) or '') or '—'
                row = [_p(f1['label'], _label), _p(v1)]
                if f2:
                    v2 = str(ss.get(f2['udf']) or '') or '—'
                    row += [_p(f2['label'], _label), _p(v2)]
                else:
                    row += [_p('', _label), _p('')]
                rows.append(row)
            t_fields = Table(rows, colWidths=[W * 0.20, W * 0.30, W * 0.20, W * 0.30])
            t_fields.setStyle(TableStyle([
                ('ROWBACKGROUNDS', (0, 0), (-1, -1), [white, LIGHT]),
                ('GRID',          (0, 0), (-1, -1), 0.3, GRAY),
                ('FONTNAME',      (0, 0), (-1, -1), 'Helvetica'),
                ('FONTSIZE',      (0, 0), (-1, -1), 8),
                ('TEXTCOLOR',     (0, 0), (0, -1), MID),
                ('TEXTCOLOR',     (2, 0), (2, -1), MID),
                ('LEFTPADDING',   (0, 0), (-1, -1), 6),
                ('TOPPADDING',    (0, 0), (-1, -1), 3),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
            ]))
            story.append(t_fields)
        story.append(Spacer(1, 4 * mm))

    # ── Calculations ──────────────────────────────────────────────────────────
    if calculations:
        story.append(_section_banner('SIZING / CALCULATIONS', W))
        calc_hdr = [[
            _p('Type', _white), _p('Case', _white), _p('Result', _white),
            _p('Unit', _white), _p('Revision', _white), _p('Status', _white),
        ]]
        calc_rows = []
        for c in calculations:
            calc_rows.append([
                _p(c.get('calc_type',   '') or ''),
                _p(c.get('case_name',   '') or ''),
                _p(_fmt(c.get('result_value')), _bold),
                _p(c.get('result_unit', '') or ''),
                _p(c.get('revision',    '') or ''),
                _p(c.get('calc_status', '') or ''),
            ])
        cw_calc = [W*0.20, W*0.12, W*0.16, W*0.12, W*0.16, W*0.24]
        t_calc = Table(calc_hdr + calc_rows, colWidths=cw_calc)
        t_calc.setStyle(_data_style())
        story.append(t_calc)

    # ── Footer callback ────────────────────────────────────────────────────────
    def _footer(canvas, doc):
        canvas.saveState()
        fy = 8 * mm
        canvas.setStrokeColor(GRAY)
        canvas.line(12 * mm, fy + 4 * mm, A4[0] - 12 * mm, fy + 4 * mm)
        canvas.setFont('Helvetica', 7)
        canvas.setFillColor(MID)
        canvas.drawString(
            12 * mm, fy,
            f'XYRA Studio  ·  {tag}  ·  {ds_status}  ·  {rev_no}',
        )
        canvas.drawRightString(A4[0] - 12 * mm, fy, f'Page {doc.page}')
        canvas.restoreState()

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return buf.getvalue()
