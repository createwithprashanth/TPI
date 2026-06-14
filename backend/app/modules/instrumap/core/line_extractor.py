"""
Pipe line number extractor for InstruMap.

Reuses full-page OCR data already fetched by the text engine — no extra Vision API call.

Four-pass strategy:
  Pass 1 — single-token match: OCR read the entire line number as one word
  Pass 2 — hyphen-join reconstruction: join adjacent tokens with '-'
  Pass 3 — concat reconstruction: concatenate adjacent tokens directly
            (handles OCR splits mid-token, e.g. 'PO' read as 'P' + 'O')
  Pass 4 — inch-mark anchor search: find every token containing '"', then scan
            ALL words within 1500px horizontally and 50px vertically — no chain
            dependency, catches line numbers with large token gaps
"""
import re
import logging
from typing import Dict, List, Optional

import pandas as pd

logger = logging.getLogger(__name__)

# ── Known pipe sizes ──────────────────────────────────────────────────────────

_IMPERIAL_SIZES = {
    '0.5', '0.75', '1', '1.25', '1.5', '2', '2.5', '3', '4',
    '6', '8', '10', '12', '14', '16', '18', '20', '24', '30', '36', '42', '48',
}

_METRIC_DN_SIZES = {
    '15', '20', '25', '32', '40', '50', '65', '80', '100', '125',
    '150', '200', '250', '300', '350', '400', '450', '500', '600',
}

# ── Regex ─────────────────────────────────────────────────────────────────────

# Matches a full line number in a single string, e.g.:
#   6"-P-1001-A1A-H   4"-FW-2001   DN100-CS-3001-B2B   2-IA-101
_RE_LINE_NUMBER = re.compile(
    r'^'
    r'(DN)?'
    r'(\d{1,3}(?:\.\d{1,2})?)'                           # pipe size
    r'["\u201c\u201d\u2019\u2032\u2033\']{0,2}'           # optional inch mark
    r'-?'
    r'([A-Z]{1,5})'                                       # fluid code
    r'-'
    r'(\d{3,6})'                                          # sequence number (3-6 digits)
    r'(?:-([A-Z0-9]{1,8}))?'                              # optional area code (up to 8 chars, e.g. 256620)
    r'(?:-([A-Z0-9]{1,4}))?'                              # optional suffix 1 (insulation/spec)
    r'(?:-([A-Z0-9]{1,4}))?'                              # optional suffix 2 (paint/coating)
    r'$',
    re.IGNORECASE,
)

# Single vowels that are clearly OCR noise, not fluid codes
_REJECT_FLUID = {
    'A', 'E', 'I', 'O', 'U', 'Y',
    'ANSI', 'API', 'DWG', 'DWGN', 'MIN', 'MAX', 'NOTE', 'TYP', 'TYPICAL',
    # Instrument/type fragments seen in dense P&ID bodies. These can otherwise
    # be misread as fluid codes when OCR joins a nearby note number + tag text:
    # e.g. "24 LG 2005 LT" -> "24-LG-2005-LT".
    'AT', 'FIT', 'FI', 'FT', 'FIC', 'FQI',
    'HS', 'LAH', 'LAHH', 'LAL', 'LALL', 'LG', 'LI', 'LIC', 'LIT', 'LT',
    'PDI', 'PDG', 'PDSL', 'PI', 'PIT', 'PT',
    'TE', 'TI', 'TIT', 'TT', 'TW',
    'VAH', 'VSH', 'XL', 'XZLC', 'XZLO', 'XZSC', 'XZSO',
}

# Tokens that look like a pipe size with inch mark — anchor point for Pass 4
_RE_SIZE_ANCHOR = re.compile(
    r'^(DN)?(\d{1,3}(?:\.\d{1,2})?)["\u201c\u201d\u2019\u2032\u2033\']',
    re.IGNORECASE,
)


def _normalize(text: str) -> str:
    """Normalize unicode quotes/inch-marks and strip whitespace."""
    text = re.sub(r'[\u201c\u201d\u2019\u2032\u2033]', '"', text)
    return text.strip()


def _try_parse(text: str) -> Optional[Dict]:
    """
    Try to parse text as a pipe line number.
    Returns a dict of fields, or None if no match.
    """
    text = _normalize(text).upper()
    if not text:
        return None
    # Must start with a digit or 'DN'
    if not (text[0].isdigit() or text.startswith('DN')):
        return None

    m = _RE_LINE_NUMBER.match(text)
    if not m:
        return None

    dn_prefix = m.group(1) or ''
    size      = m.group(2)
    fluid     = m.group(3).upper()
    sequence  = m.group(4)
    area      = (m.group(5) or '').upper()
    suffix1   = (m.group(6) or '').upper()  # insulation / spec (e.g. J)
    suffix2   = (m.group(7) or '').upper()  # secondary spec  (e.g. P)

    # OCR reconstruction can glue an adjacent instrument suffix onto the final
    # line spec, e.g. 2-PG-24468-251482-X-N18 beside PIT-...-18. In EPC line
    # numbers the final spec is commonly a short alpha code; trailing digits
    # here are stronger evidence of a neighbouring tag suffix than line data.
    if re.match(r'^[A-Z]\d{2,3}$', suffix2):
        suffix2 = suffix2[0]

    if fluid in _REJECT_FLUID:
        return None

    # Reject single-letter fluid codes that are likely OCR noise (except known single-letter codes)
    _SINGLE_LETTER_FLUID = {'P', 'N', 'W', 'S', 'G', 'F', 'H', 'C', 'D'}
    if len(fluid) == 1 and fluid not in _SINGLE_LETTER_FLUID:
        return None

    # Require a known pipe size — unknown sizes produce too many false positives
    size_str = size.lstrip('0') or '0'
    is_metric   = bool(dn_prefix) or size_str in _METRIC_DN_SIZES
    is_imperial = size_str in _IMPERIAL_SIZES or size in _IMPERIAL_SIZES
    if not (is_metric or is_imperial):
        return None

    display_size = f"DN{size}" if (dn_prefix or is_metric) else size
    parts = [display_size, fluid, sequence]
    if area:
        parts.append(area)
    if suffix1:
        parts.append(suffix1)
    if suffix2:
        parts.append(suffix2)

    return {
        'Line_Number': '-'.join(parts),
        'Pipe_Size':   size,
        'Size_Unit':   'DN (mm)' if (dn_prefix or is_metric) else 'in',
        'Fluid_Code':  fluid,
        'Sequence_No': sequence,
        'Area_Code':   area,
        'Insulation':  suffix1,
        'Spec':        suffix2,
    }


def _group_horizontal(
    full_text_data: List[Dict],
    y_tol: int = 30,
    x_gap_max: int = 500,
) -> List[List[Dict]]:
    """
    Bucket OCR words into horizontal lines by spatial proximity.

    Tolerances are intentionally loose — line numbers on P&IDs often have
    large gaps between tokens (e.g. '2"' ... 'PO-33646') and may be placed
    at a slight angle, shifting y coordinates by a few pixels.
    """
    if not full_text_data:
        return []

    sorted_words = sorted(full_text_data, key=lambda w: (w['y'], w['x']))
    lines: List[List[Dict]] = []

    for word in sorted_words:
        placed = False
        for line in lines:
            last = line[-1]
            y_diff = abs(word['y'] - last['y'])
            x_gap  = word['x'] - (last['x'] + last.get('w', 0))
            if y_diff <= y_tol and 0 <= x_gap <= x_gap_max:
                line.append(word)
                placed = True
                break
        if not placed:
            lines.append([word])

    return lines


def extract_line_numbers(
    full_text_data: List[Dict],
    filename_base: str,
) -> pd.DataFrame:
    """
    Extract pipe line numbers from full-page OCR word data.

    Args:
        full_text_data : list of word dicts from detect_text_full_page()
        filename_base  : e.g. "drawing_p2" — page number is parsed from the suffix

    Returns:
        DataFrame with columns: Line_Number, Pipe_Size, Size_Unit, Fluid_Code,
        Sequence_No, Area_Code, Insulation, P&ID_Filename, P&ID_Page, Coordinates
    """
    if not full_text_data:
        return pd.DataFrame()

    pid_filename = filename_base.rsplit('_p', 1)[0] + '.pdf'
    try:
        page_number = int(filename_base.rsplit('_p', 1)[1])
    except (IndexError, ValueError):
        page_number = 1

    results: List[Dict] = []
    seen: set = set()

    def _add(parsed: Dict, cx: float, cy: float) -> None:
        ln = parsed['Line_Number']
        if ln not in seen:
            seen.add(ln)
            results.append({
                **parsed,
                'P&ID_Filename': pid_filename,
                'P&ID_Page':     page_number,
                'Coordinates':   f"{int(cx)},{int(cy)}",
            })

    # Pass 1 — single token
    for word in full_text_data:
        parsed = _try_parse(word['text'])
        if parsed:
            _add(parsed, word['center_x'], word['center_y'])

    # Pass 2 — horizontal reconstruction (2–8 adjacent tokens)
    # e.g. "2"" + "PO" + "33646" + "256620" + "J" + "P" = 6 tokens
    # Pass 3 — same groups but tokens concatenated directly (no added dash)
    # Handles OCR splitting a token mid-word, e.g. '2"-P' + 'O-33646-256620-J' + '-P'
    # → concat gives '2"-PO-33646-256620-J-P' which matches cleanly
    for line_words in _group_horizontal(full_text_data):
        if len(line_words) < 2 or len(line_words) > 9:
            continue
        tokens = [w['text'].strip() for w in line_words]
        for start in range(len(tokens)):
            for length in range(2, min(9, len(tokens) - start + 1)):
                grp = line_words[start:start + length]
                cx  = sum(w['center_x'] for w in grp) / len(grp)
                cy  = sum(w['center_y'] for w in grp) / len(grp)

                # Pass 2: join with '-'
                candidate = '-'.join(tokens[start:start + length])
                candidate = re.sub(r'-{2,}', '-', candidate)
                parsed = _try_parse(candidate)
                if parsed:
                    _add(parsed, cx, cy)
                    continue

                # Pass 3: concatenate directly (repair OCR mid-token splits)
                raw = ''.join(tokens[start:start + length])
                raw = re.sub(r'-{2,}', '-', raw).strip('-')
                if raw != candidate:
                    parsed = _try_parse(raw)
                    if parsed:
                        _add(parsed, cx, cy)

    # Pass 4 — inch-mark anchor search (catches widely spaced tokens and OCR chain breaks)
    # Find every token that looks like a pipe size with inch mark (e.g. '2"', '4"-', '12"')
    # and look at ALL words within a generous horizontal band regardless of gaps between them.
    for anchor in full_text_data:
        if not _RE_SIZE_ANCHOR.match(_normalize(anchor['text']).upper()):
            continue

        ax, ay = anchor['x'], anchor['y']
        # Collect all words to the right within 1500px horizontally, 50px vertically
        nearby = sorted(
            [w for w in full_text_data
             if w['x'] > ax and abs(w['y'] - ay) <= 50 and (w['x'] - ax) <= 1500],
            key=lambda w: w['x'],
        )

        # Try increasing token windows from the anchor
        for n in range(1, min(9, len(nearby) + 1)):
            group = [anchor] + nearby[:n]
            tokens = [w['text'].strip() for w in group]
            cx = sum(w['center_x'] for w in group) / len(group)
            cy = sum(w['center_y'] for w in group) / len(group)

            # Hyphen-join
            candidate = '-'.join(tokens)
            candidate = re.sub(r'-{2,}', '-', candidate)
            parsed = _try_parse(candidate)
            if parsed:
                _add(parsed, cx, cy)
                continue

            # Direct concat (repairs OCR mid-token splits like '2"-P' + 'O-33646...')
            raw = ''.join(tokens)
            raw = re.sub(r'-{2,}', '-', raw).strip('-')
            if raw != candidate:
                parsed = _try_parse(raw)
                if parsed:
                    _add(parsed, cx, cy)

    if not results:
        return pd.DataFrame()

    # Remove prefix duplicates: if "2-PO-33646" and "2-PO-33646-256620-J-P" both exist,
    # keep only the longer one — it carries all the information.
    line_numbers = [r['Line_Number'] for r in results]
    filtered = [
        r for r in results
        if not any(
            other != r['Line_Number'] and other.startswith(r['Line_Number'] + '-')
            for other in line_numbers
        )
    ]

    _COLS = [
        'Line_Number', 'Pipe_Size', 'Size_Unit', 'Fluid_Code',
        'Sequence_No', 'Area_Code', 'Insulation', 'Spec',
        'P&ID_Filename', 'P&ID_Page', 'Coordinates',
    ]
    df = pd.DataFrame(filtered)
    return df[[c for c in _COLS if c in df.columns]]
