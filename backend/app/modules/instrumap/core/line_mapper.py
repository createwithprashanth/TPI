"""
Line-to-instrument mapper for vector P&IDs.

For each field instrument (non-soft-tag), traces the stub line from its
circle boundary through connected pipe segments to find the associated
line number.

Only runs on the PyMuPDF path (vector PDFs). Scanned PDFs skip this entirely.
Zero API calls — pure geometry.

Two strategies are tried in order per instrument:
  1. Graph traversal: extract PDF vector segments, find stubs crossing the
     instrument circle, BFS through the connected pipe graph, check for line
     number labels close to the run.
  2. Directional fallback: pure pixel-space axis-aligned proximity search used
     when the graph strategy finds no stubs (e.g. very thin rectangle pipes
     not caught by segment extraction, or scanned overlay text).
"""
import math
import logging
from typing import Dict, List, Optional, Tuple

import pandas as pd

logger = logging.getLogger(__name__)

try:
    import fitz
    _PYMUPDF_AVAILABLE = True
except ImportError:
    _PYMUPDF_AVAILABLE = False

# Only an explicit "Soft Link" IO_Type is a definitive soft-tag marker.
# Empty IO_Type alone is not sufficient — a local indicator/gauge on the pipe
# has no wired IO but is still a physical field device.
_SOFT_IO_TYPES = {"Soft Link"}

# Instrument types that are always physically mounted on a process pipe,
# regardless of IO_Type.  The extraction layer sometimes tags these as
# "Soft Link" (e.g. because they have pneumatic/hydraulic signal lines),
# but they still have a hard process-pipe connection that must be recorded.
_ALWAYS_PHYSICAL = frozenset({
    # Shutoff / safety valves
    "SSV", "SSSV", "SSOV", "MSOV", "SDV", "ESDV", "BDV",
    "PSV", "PRV", "POSV",
    # Control valves and their actuators
    "FCV", "LCV", "PCV", "TCV", "HCV", "MOV", "ASDV", "CVA",
    # In-line metering elements
    "RO", "FO",
    # Test points
    "TP",
})

# Tolerance added to circle radius when checking which side of the boundary
# a segment endpoint is on.  8 pt ≈ 0.11 inch at 300 DPI — generous.
_STUB_TOUCH_TOLERANCE_PT = 8.0

# Max perpendicular distance from a pipe run segment to a line number label
_LINE_LABEL_PROXIMITY_PT = 50.0

# Max BFS hops when walking the pipe run graph
_MAX_RUN_STEPS = 40

# Two segment endpoints are "shared" if they are within this distance (PDF points)
_ENDPOINT_SNAP_PT = 4.0

# Minimum aspect ratio to treat a rectangle as a pipe segment (thin rect)
_MIN_RECT_ASPECT = 5.0

# After BFS, only segments within this radius (PDF points) of the instrument
# centre are considered when searching for a line-number label.
# 350 pt ≈ 1 460 px @ 300 DPI ≈ 4.9 inches — covers branch stubs that tap off
# a main pipe run whose label is several inches from the instrument.
# Dashed-line filtering (added separately) prevents the BFS over-traversal that
# originally required a tighter value here.
_MAX_STUB_SEARCH_RADIUS_PT = 350.0

# ── Directional fallback parameters ──────────────────────────────────────────
# Maximum pixel distance to look for a line label from an instrument centre.
# 1500 px ≈ 5 inches @ 300 DPI — covers branch instruments whose nearest pipe
# label sits several inches away on the main run.
_FALLBACK_MAX_DIST_PX = 1500.0
# A label is "axially aligned" if it is within this many pixels of the
# instrument's horizontal or vertical axis.
# 350 px ≈ 1.2 inches — generous enough to handle labels that sit slightly
# offset from the instrument's exact axis on wide pipe runs, yet still
# excludes panel instruments at the top of a drawing whose labels are far off.
_FALLBACK_AXIS_BAND_PX = 350.0

# Loop propagation distance gate — an instrument inherits its loop-mate's line
# only if it is within this many pixels of the line-number label.
# 1800 px ≈ 6 in @ 300 DPI covers legitimate same-area propagation (TW/TE/TIT
# on the same stub) while excluding panel instruments (y≈1834) from inheriting
# lines whose labels sit 2 000–5 000 px away on process runs.
_PROPAGATION_MAX_DIST_PX = 1800.0


# ── Coordinate helpers ────────────────────────────────────────────────────────

def _px_to_pt(px: float, dpi: int = 300) -> float:
    return px * 72.0 / dpi


def _dist(p1: Tuple, p2: Tuple) -> float:
    return math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2)


def _point_to_segment_dist(px, py, ax, ay, bx, by) -> float:
    """Perpendicular distance from point (px,py) to segment (ax,ay)-(bx,by)."""
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return _dist((px, py), (ax, ay))
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return _dist((px, py), (ax + t * dx, ay + t * dy))


# ── Geometry extraction ───────────────────────────────────────────────────────

def _extract_segments(page) -> List[Tuple[float, float, float, float]]:
    """
    Extract all straight line segments from PDF vector paths.
    Returns list of (x0, y0, x1, y1) in PDF points.

    Two sources:
      - m+l path items (explicit lineto drawing commands)
      - re (rectangle) items where aspect ratio >= _MIN_RECT_ASPECT:
        these are the "hairline" filled rectangles that many CAD exporters
        use for pipe runs instead of plain line strokes.
    """
    segments = []
    for path in page.get_drawings():
        # Skip dashed/dotted paths — these are instrument signal lines,
        # pneumatic lines, or electrical connections, NOT process pipe runs.
        dashes = path.get("dashes", "")
        if dashes and dashes not in ("", "[] 0", "[]"):
            continue
        items = path.get("items", [])
        current = None
        for item in items:
            kind = item[0]
            if kind == "m":
                current = (item[1].x, item[1].y)
            elif kind == "l" and current is not None:
                end = (item[1].x, item[1].y)
                if _dist(current, end) > 1.0:
                    segments.append((current[0], current[1], end[0], end[1]))
                current = end
            elif kind == "re":
                # Convert thin rectangle to a centre-line segment.
                rect = item[1]  # fitz.Rect
                w = rect.width
                h = rect.height
                if w < 1.0 or h < 1.0:
                    current = None
                    continue
                aspect = max(w, h) / min(w, h)
                if aspect >= _MIN_RECT_ASPECT:
                    if w >= h:
                        # horizontal-ish rectangle
                        mid_y = (rect.y0 + rect.y1) / 2.0
                        segments.append((rect.x0, mid_y, rect.x1, mid_y))
                    else:
                        # vertical-ish rectangle
                        mid_x = (rect.x0 + rect.x1) / 2.0
                        segments.append((mid_x, rect.y0, mid_x, rect.y1))
                current = None
    return segments


def _segments_crossing_circle(
    segments: List[Tuple],
    cx: float,
    cy: float,
    r: float,
    tol: float = _STUB_TOUCH_TOLERANCE_PT,
) -> List[int]:
    """
    Return indices of segments that connect to the instrument circle.

    Two cases:
      1. One endpoint inside (d <= r+tol), one outside — classic stub line.
      2. Both endpoints outside but the segment passes through the circle —
         instrument symbol sits directly on the pipe run (valves, orifices).
    """
    result = []
    r_in = r + tol
    for i, (x0, y0, x1, y1) in enumerate(segments):
        d0 = _dist((x0, y0), (cx, cy))
        d1 = _dist((x1, y1), (cx, cy))
        inside0 = d0 <= r_in
        inside1 = d1 <= r_in
        if (inside0 and not inside1) or (inside1 and not inside0):
            # Classic stub: one end inside the circle, one end outside
            result.append(i)
        elif not inside0 and not inside1:
            # Both outside — check if the segment passes through the circle.
            # This catches valves/orifices drawn directly on a pipe run.
            if _point_to_segment_dist(cx, cy, x0, y0, x1, y1) <= r_in:
                result.append(i)
    return result


# ── Graph helpers ─────────────────────────────────────────────────────────────

def _build_adjacency(
    segments: List[Tuple],
    tol: float = _ENDPOINT_SNAP_PT,
) -> Dict[int, List[int]]:
    """
    Build segment adjacency list using a grid bucket — O(n), not O(n²).
    Two segments are neighbours if they share an endpoint within `tol` points.
    """
    adj: Dict[int, List[int]] = {i: [] for i in range(len(segments))}
    cell = tol * 2  # grid cell size

    # bucket: grid_key → list of (x, y, seg_index)
    bucket: Dict[Tuple, List] = {}
    for i, (x0, y0, x1, y1) in enumerate(segments):
        for px, py in ((x0, y0), (x1, y1)):
            key = (int(px / cell), int(py / cell))
            bucket.setdefault(key, []).append((px, py, i))

    for i, (x0, y0, x1, y1) in enumerate(segments):
        for px, py in ((x0, y0), (x1, y1)):
            gx, gy = int(px / cell), int(py / cell)
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    for ex, ey, j in bucket.get((gx + dx, gy + dy), []):
                        if j == i:
                            continue
                        if abs(px - ex) <= tol and abs(py - ey) <= tol:
                            if _dist((px, py), (ex, ey)) <= tol:
                                if j not in adj[i]:
                                    adj[i].append(j)
                                if i not in adj[j]:
                                    adj[j].append(i)
    return adj


def _bfs_run(
    start_indices: List[int],
    adj: Dict[int, List[int]],
    max_steps: int = _MAX_RUN_STEPS,
) -> List[int]:
    """BFS from stub segment indices, return all reachable segment indices."""
    visited = set(start_indices)
    queue = list(start_indices)
    result = list(start_indices)
    steps = 0
    while queue and steps < max_steps:
        idx = queue.pop(0)
        for nb in adj.get(idx, []):
            if nb not in visited:
                visited.add(nb)
                queue.append(nb)
                result.append(nb)
        steps += 1
    return result


# ── Line number matching ──────────────────────────────────────────────────────

def _find_line_for_run(
    run_indices: List[int],
    segments: List[Tuple],
    lines_df: pd.DataFrame,
    dpi: int,
    proximity_pt: float = _LINE_LABEL_PROXIMITY_PT,
) -> Optional[str]:
    """
    Find the line number whose label sits closest to any segment in the run.
    lines_df coordinates are in pixels at `dpi`; converted to PDF points here.
    """
    if lines_df.empty or not run_indices:
        return None

    label_pts: List[Tuple[float, float, str]] = []
    for _, lr in lines_df.iterrows():
        try:
            coords = str(lr.get("Coordinates", "")).split(",")
            lx_pt = _px_to_pt(float(coords[0]), dpi)
            ly_pt = _px_to_pt(float(coords[1]), dpi)
            label_pts.append((lx_pt, ly_pt, str(lr.get("Line_Number", ""))))
        except Exception:
            continue

    best_line: Optional[str] = None
    best_dist = float("inf")

    for seg_idx in run_indices:
        x0, y0, x1, y1 = segments[seg_idx]
        for lx, ly, line_num in label_pts:
            d = _point_to_segment_dist(lx, ly, x0, y0, x1, y1)
            if d < proximity_pt and d < best_dist:
                best_dist = d
                best_line = line_num

    return best_line


def _directional_fallback(
    cx_px: float,
    cy_px: float,
    lines_df: pd.DataFrame,
    max_distance_px: float = _FALLBACK_MAX_DIST_PX,
    axis_band_px: float = _FALLBACK_AXIS_BAND_PX,
) -> Optional[str]:
    """
    Pixel-space fallback: find the line label most axially aligned with the
    instrument centre.

    For each line label we compute:
      - off_axis = min(|Δx|, |Δy|) — how far off a cardinal axis it is
      - dist = Euclidean distance

    Labels further than max_distance_px or with off_axis > axis_band_px are
    rejected.  Among the rest, we prefer smallest off_axis, then nearest.

    This works entirely in image-pixel coordinates so it requires no PDF
    geometry and acts as a reliable fallback when graph tracing finds nothing.
    """
    candidates = []
    for _, lr in lines_df.iterrows():
        try:
            coords = str(lr.get("Coordinates", "")).split(",")
            lx = float(coords[0])
            ly = float(coords[1])
        except Exception:
            continue

        dx = lx - cx_px
        dy = ly - cy_px
        dist = math.sqrt(dx * dx + dy * dy)
        if dist < 5.0 or dist > max_distance_px:
            continue

        off_axis = min(abs(dx), abs(dy))
        if off_axis <= axis_band_px:
            candidates.append((off_axis, dist, str(lr.get("Line_Number", ""))))

    if not candidates:
        return None

    candidates.sort(key=lambda x: (x[0], x[1]))
    return candidates[0][2]


# ── Soft-tag filter ───────────────────────────────────────────────────────────

def _build_transmitter_set(instruments_df: pd.DataFrame) -> set:
    """
    Return a set of (instrument_type, loop_number) for all transmitters.
    Used to detect indicators that are soft-tag mirrors of a field transmitter.
    """
    result = set()
    for _, row in instruments_df.iterrows():
        t = str(row.get("Type", "")).strip().upper()
        loop = str(row.get("Loop", "")).strip()
        if t.endswith("T"):  # transmitter
            result.add((t, loop))
    return result


def _is_soft_tag(row: pd.Series, transmitter_set: set) -> bool:
    """
    Return True if this instrument is a soft tag (no physical pipe connection).

    Rules applied in order:
    0. Type is in _ALWAYS_PHYSICAL → never a soft tag (overrides IO_Type).
    1. IO_Type is 'Soft Link' → flagged as soft by the extraction layer.
    2. Type ends in 'I' (Indicator) or 'R' (Recorder) AND a transmitter with the
       same loop number exists → DCS faceplate, not a field device.
    """
    instr_type = str(row.get("Type", "")).strip().upper()

    # Physical inline devices always have a process-pipe connection.
    if instr_type in _ALWAYS_PHYSICAL:
        return False

    io_type = str(row.get("IO_Type", "")).strip()
    if io_type in _SOFT_IO_TYPES:
        return True

    loop = str(row.get("Loop", "")).strip()

    if instr_type.endswith("I") or instr_type.endswith("R"):
        transmitter_type = instr_type[:-1] + "T"
        if (transmitter_type, loop) in transmitter_set:
            return True

    return False


# ── Public API ────────────────────────────────────────────────────────────────

def map_instruments_to_lines(
    instruments_df: pd.DataFrame,
    lines_df: pd.DataFrame,
    pdf_path: str,
    dpi: int = 300,
) -> pd.DataFrame:
    """
    Add a 'Connected_Line' column to instruments_df by tracing pipe geometry.

    Strategy per instrument (in order):
      1. PDF graph traversal: extract vector segments, detect crossing stubs,
         BFS through the pipe graph, check proximity to line number labels.
      2. Directional fallback: pure pixel-space axis-aligned proximity.

    Soft tags are skipped (no physical connection expected).
    Fully non-fatal — returns instruments_df unchanged on any failure.

    Args:
        instruments_df : extracted instruments (must have Coordinates, Radius, P&ID_Page)
        lines_df       : extracted line numbers (must have Coordinates, Line_Number, P&ID_Page)
        pdf_path       : path to the original vector PDF
        dpi            : DPI used during extraction (default 300)

    Returns:
        Copy of instruments_df with 'Connected_Line' column added.
    """
    instruments_df = instruments_df.copy()
    instruments_df["Connected_Line"] = ""

    if not _PYMUPDF_AVAILABLE:
        logger.warning("LineMapper: PyMuPDF not available — skipping line mapping")
        return instruments_df

    if lines_df.empty:
        logger.info("LineMapper: no line numbers available — skipping")
        return instruments_df

    transmitter_set = _build_transmitter_set(instruments_df)

    try:
        doc = fitz.open(pdf_path)
    except Exception as exc:
        logger.warning(f"LineMapper: could not open PDF: {exc}")
        return instruments_df

    graph_matched = 0
    fallback_matched = 0

    for page_idx, page in enumerate(doc):
        page_number = page_idx + 1

        page_instr_mask = (
            instruments_df.get("P&ID_Page", pd.Series(dtype=int)) == page_number
        )
        page_instruments = instruments_df[page_instr_mask]
        if page_instruments.empty:
            continue

        if "P&ID_Page" in lines_df.columns:
            page_lines = lines_df[lines_df["P&ID_Page"] == page_number]
        else:
            page_lines = lines_df

        # ── Strategy 1: PDF vector graph traversal ────────────────────────────
        segments = _extract_segments(page)
        logger.info(
            f"LineMapper page {page_number}: {len(segments)} segments extracted, "
            f"{len(page_instruments)} instruments, {len(page_lines)} line labels"
        )

        # Safety cap — extremely dense drawings; cap to avoid stall
        MAX_SEGMENTS = 15_000
        if len(segments) > MAX_SEGMENTS:
            logger.warning(
                f"LineMapper: page {page_number} has {len(segments)} segments — "
                f"capping to {MAX_SEGMENTS}"
            )
            segments = segments[:MAX_SEGMENTS]

        adj = _build_adjacency(segments) if segments else {}

        for idx, row in page_instruments.iterrows():
            if _is_soft_tag(row, transmitter_set):
                continue

            # Parse instrument pixel coordinates
            try:
                coords = str(row.get("Coordinates", "")).split(",")
                cx_px = float(coords[0])
                cy_px = float(coords[1])
                r_px = float(row.get("Radius", 20))
            except Exception:
                continue

            matched_line: Optional[str] = None

            # Graph traversal (only possible when we have segments)
            if segments:
                cx_pt = _px_to_pt(cx_px, dpi)
                cy_pt = _px_to_pt(cy_px, dpi)
                r_pt = _px_to_pt(r_px, dpi)

                stub_indices = _segments_crossing_circle(segments, cx_pt, cy_pt, r_pt)
                if stub_indices:
                    run_indices = _bfs_run(stub_indices, adj)
                    # Discard segments too far from the instrument — prevents BFS
                    # from reaching labels on an entirely different pipe run.
                    run_indices = [
                        i for i in run_indices
                        if _dist(
                            ((segments[i][0] + segments[i][2]) / 2,
                             (segments[i][1] + segments[i][3]) / 2),
                            (cx_pt, cy_pt),
                        ) <= _MAX_STUB_SEARCH_RADIUS_PT
                    ]
                    matched_line = _find_line_for_run(run_indices, segments, page_lines, dpi)
                    if matched_line:
                        graph_matched += 1
                        logger.debug(
                            f"  [{row.get('Tag_Number')}] graph → {matched_line} "
                            f"(stubs={len(stub_indices)}, run={len(run_indices)})"
                        )

            # Directional fallback when graph finds nothing
            if not matched_line and not page_lines.empty:
                matched_line = _directional_fallback(cx_px, cy_px, page_lines)
                if matched_line:
                    fallback_matched += 1
                    logger.debug(
                        f"  [{row.get('Tag_Number')}] fallback → {matched_line}"
                    )

            if matched_line:
                instruments_df.at[idx, "Connected_Line"] = matched_line

    doc.close()

    # ── Propagate Connected_Line within loop instance to field instruments ───────
    # FIT-1762P-12 gets mapped → FE-1762P-12 should show the same line.
    # Group by full tag-minus-type-prefix ("1762P-12") not just Loop ("1762P"),
    # so unrelated measurements that share a parent loop number stay independent.
    #
    # Distance gate: only propagate to instruments within _PROPAGATION_MAX_DIST_PX
    # of the line label — prevents panel instruments (far from process runs) from
    # inheriting a line number via a nearby loop-mate on the process piping.

    # Build label pixel-coordinate lookup for the distance gate
    _label_coords: Dict[str, Tuple[float, float]] = {}
    if "Coordinates" in lines_df.columns and "Line_Number" in lines_df.columns:
        for _, _lr in lines_df.iterrows():
            try:
                _lx, _ly = map(float, str(_lr["Coordinates"]).split(","))
                _label_coords[str(_lr["Line_Number"])] = (_lx, _ly)
            except Exception:
                pass

    if "Loop" in instruments_df.columns and "Tag_Number" in instruments_df.columns:
        def _loop_instance(row):
            tag = str(row.get("Tag_Number", "")).strip()
            loop = str(row.get("Loop", "")).strip()
            if tag and "-" in tag:
                return tag.split("-", 1)[1]  # e.g. "1762P-12" from "FCV-1762P-12"
            return loop

        loop_key_series = instruments_df.apply(_loop_instance, axis=1)
        for loop_val, group in instruments_df.groupby(loop_key_series):
            if not str(loop_val).strip():
                continue
            # Find best line in this loop instance (from any non-soft-tag member)
            best_line = ""
            for idx, row in group.iterrows():
                if not _is_soft_tag(row, transmitter_set):
                    cl = str(instruments_df.at[idx, "Connected_Line"]).strip()
                    if cl:
                        best_line = cl
                        break
            if not best_line:
                continue
            # Stamp it on every field instrument in the loop instance,
            # but only if the instrument is close enough to the line label.
            lbl_coord = _label_coords.get(best_line)
            for idx, row in group.iterrows():
                if (not _is_soft_tag(row, transmitter_set)
                        and not str(instruments_df.at[idx, "Connected_Line"]).strip()):
                    if lbl_coord is not None:
                        try:
                            ic = str(row.get("Coordinates", "")).split(",")
                            ix, iy = float(ic[0]), float(ic[1])
                            if _dist((ix, iy), lbl_coord) > _PROPAGATION_MAX_DIST_PX:
                                continue  # too far — likely a panel instrument
                        except Exception:
                            pass
                    instruments_df.at[idx, "Connected_Line"] = best_line
                    graph_matched += 1  # count as matched for logging

    total_field = sum(
        1 for _, r in instruments_df.iterrows()
        if not _is_soft_tag(r, transmitter_set)
    )
    logger.info(
        f"LineMapper: {graph_matched} graph + {fallback_matched} fallback = "
        f"{graph_matched + fallback_matched} / {total_field} field instruments matched"
    )
    return instruments_df
