import json

import pandas as pd

from app.modules.instrumap.core.line_mapper import (
    _apply_best_candidate,
    _connection_topology,
    _directional_candidates,
    _graph_candidates_for_run,
    _merge_candidates,
)


def test_pipe_graph_candidates_rank_by_evidence_distance():
    segments = [
        (0.0, 0.0, 200.0, 0.0),
        (200.0, 0.0, 400.0, 0.0),
    ]
    lines = pd.DataFrame(
        [
            {"Line_Number": "2-PG-1001-A", "Coordinates": "402,4"},
            {"Line_Number": "4-IA-2002-B", "Coordinates": "420,160"},
        ]
    )

    candidates = _graph_candidates_for_run([0, 1], segments, lines, dpi=72, proximity_pt=50)

    assert candidates[0]["line_number"] == "2-PG-1001-A"
    assert candidates[0]["method"] == "pipe_graph"
    assert candidates[0]["confidence"] > 0.85
    assert all(item["line_number"] != "4-IA-2002-B" for item in candidates)


def test_connection_topology_records_stub_side_and_pipe_axis():
    segments = [
        (10.0, 0.0, 100.0, 0.0),
        (100.0, 0.0, 300.0, 0.0),
    ]

    topology = _connection_topology([0], [0, 1], segments, cx=0.0, cy=0.0, dpi=72)

    assert topology["connection_side"] == "right"
    assert topology["pipe_axis"] == "horizontal"
    assert topology["stub_count"] == 1
    assert topology["run_segment_count"] == 2


def test_pipe_graph_candidates_include_connection_topology():
    segments = [
        (0.0, 0.0, 200.0, 0.0),
        (200.0, 0.0, 400.0, 0.0),
    ]
    lines = pd.DataFrame([{"Line_Number": "2-PG-1001-A", "Coordinates": "402,4"}])
    topology = {"connection_side": "right", "pipe_axis": "horizontal", "stub_count": 1}

    candidates = _graph_candidates_for_run([0, 1], segments, lines, dpi=72, proximity_pt=50, topology=topology)

    assert candidates[0]["connection_side"] == "right"
    assert candidates[0]["pipe_axis"] == "horizontal"


def test_directional_candidates_are_lower_confidence_fallback():
    lines = pd.DataFrame(
        [
            {"Line_Number": "2-PG-1001-A", "Coordinates": "100,850"},
            {"Line_Number": "6-WW-9001-C", "Coordinates": "900,900"},
        ]
    )

    candidates = _directional_candidates(100, 100, lines, max_distance_px=1000, axis_band_px=80)

    assert candidates[0]["line_number"] == "2-PG-1001-A"
    assert candidates[0]["method"] == "axis_aligned_text"
    assert 0.45 <= candidates[0]["confidence"] <= 0.72


def test_apply_best_candidate_persists_auditable_evidence():
    frame = pd.DataFrame([{"Tag_Number": "PT-1001", "Connected_Line": ""}])
    candidates = _merge_candidates(
        [{"line_number": "2-PG-1001-A", "method": "pipe_graph", "confidence": 0.91, "evidence": "touching graph"}],
        [{"line_number": "2-PG-1001-A", "method": "axis_aligned_text", "confidence": 0.61, "evidence": "near text"}],
    )

    assert _apply_best_candidate(frame, 0, candidates)
    assert frame.at[0, "Connected_Line"] == "2-PG-1001-A"
    assert frame.at[0, "Line_Confidence"] == 0.91
    assert frame.at[0, "Line_Association_Method"] == "pipe_graph"
    assert json.loads(frame.at[0, "Line_Candidates"])[0]["method"] == "pipe_graph"
