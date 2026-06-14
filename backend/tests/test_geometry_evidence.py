import json

import pandas as pd

from app.modules.instrumap.core.geometry_evidence import attach_geometry_evidence


def test_geometry_evidence_combines_line_valve_and_equipment_context():
    instruments = pd.DataFrame(
        [
            {
                "Tag_Number": "PIT-1762P-18",
                "Type": "PIT",
                "Loop": "1762P",
                "Instrument_Description": "Pressure Indicating Transmitter",
                "Connected_Line": "2-PG-24464-251482-X-N",
                "Line_Confidence": 0.91,
                "Line_Association_Method": "pipe_graph",
                "Line_Association_Reason": "line label is 42px from traced pipe graph",
                "Line_Candidates": '[{"line_number":"2-PG-24464-251482-X-N","confidence":0.91,"connection_side":"right","pipe_axis":"horizontal","stub_count":1,"run_segment_count":4}]',
                "Coordinates": "100,100",
                "P&ID_Page": 1,
            },
            {
                "Tag_Number": "FCV-1762P-12",
                "Type": "FCV",
                "Loop": "1762P",
                "Instrument_Description": "Flow Control Valve",
                "Connected_Line": "2-PG-24464-251482-X-N",
                "Coordinates": "320,100",
                "P&ID_Page": 1,
            },
        ]
    )
    lines = pd.DataFrame(
        [
            {
                "Line_Number": "2-PG-24464-251482-X-N",
                "Pipe_Size": "2",
                "Size_Unit": "in",
                "Fluid_Code": "PG",
            }
        ]
    )
    equipment = pd.DataFrame(
        [
            {
                "Equipment_Tag": "V-100",
                "Equipment_Type": "Vessel",
                "Equipment_Code": "V",
                "P&ID_Page": 1,
                "Coordinates": "40,100",
            }
        ]
    )

    enriched = attach_geometry_evidence(instruments, lines, equipment)
    evidence = json.loads(enriched.loc[0, "Geometry_Evidence"])

    assert evidence["line"]["tag"] == "2-PG-24464-251482-X-N"
    assert evidence["line"]["size"] == "2"
    assert evidence["line"]["fluid_code"] == "PG"
    assert evidence["line"]["connection_side"] == "right"
    assert evidence["line"]["pipe_axis"] == "horizontal"
    assert evidence["valve"]["tag"] == "FCV-1762P-12"
    assert evidence["valve"]["position"] == "upstream"
    assert evidence["equipment"]["tag"] == "V-100"
    assert evidence["summary"].startswith("line 2-PG-24464-251482-X-N horizontal via right stub")


def test_geometry_evidence_adds_loop_context_without_assigning_line():
    instruments = pd.DataFrame(
        [
            {
                "Tag_Number": "FIC-1414P-26",
                "Type": "FIC",
                "Loop": "1414P",
                "Instrument_Description": "Flow Indicating Controller",
                "Connected_Line": "",
                "Coordinates": "100,100",
            },
            {
                "Tag_Number": "FIT-1414P-26",
                "Type": "FIT",
                "Loop": "1414P",
                "Instrument_Description": "Flow Indicating Transmitter",
                "Connected_Line": "2-PG-24331-251482-X-N",
                "Line_Confidence": 0.68,
                "Line_Association_Method": "loop_propagation",
                "Line_Association_Reason": "same loop final element",
                "Coordinates": "140,100",
            },
        ]
    )
    lines = pd.DataFrame([{"Line_Number": "2-PG-24331-251482-X-N", "Fluid_Code": "PG"}])

    enriched = attach_geometry_evidence(instruments, lines)
    evidence = json.loads(enriched.loc[0, "Geometry_Evidence"])

    assert evidence["line"] is None
    assert evidence["loop_context"]["line"] == "2-PG-24331-251482-X-N"
    assert evidence["loop_context"]["source_tag"] == "FIT-1414P-26"
    assert evidence["loop_context"]["conflict"] is False
    assert "loop line 2-PG-24331-251482-X-N from FIT-1414P-26" in evidence["summary"]


def test_geometry_evidence_adds_nearest_line_label_for_unmapped_row():
    instruments = pd.DataFrame(
        [
            {
                "Tag_Number": "SSV-1414P-02",
                "Type": "SSV",
                "Loop": "1414P",
                "Instrument_Description": "Safety Shutdown Valve",
                "Connected_Line": "",
                "Coordinates": "1000,1000",
                "P&ID_Page": 2,
            },
        ]
    )
    lines = pd.DataFrame(
        [
            {
                "Line_Number": "2-PG-24331-251482-X-N",
                "Coordinates": "1000,1500",
                "P&ID_Page": 2,
                "Fluid_Code": "PG",
            },
            {
                "Line_Number": "6-VG-99999-X",
                "Coordinates": "2500,2500",
                "P&ID_Page": 2,
            },
        ]
    )

    enriched = attach_geometry_evidence(instruments, lines)
    evidence = json.loads(enriched.loc[0, "Geometry_Evidence"])

    assert evidence["line"] is None
    assert evidence["nearest_line_label"]["tag"] == "2-PG-24331-251482-X-N"
    assert evidence["nearest_line_label"]["axis_aligned"] is True
    assert evidence["nearest_line_label"]["confidence"] < 0.5
    assert "nearest axis-aligned line label 2-PG-24331-251482-X-N" in evidence["summary"]


def test_geometry_evidence_does_not_add_nearest_label_when_line_is_confirmed():
    instruments = pd.DataFrame(
        [
            {
                "Tag_Number": "PIT-1762P-18",
                "Type": "PIT",
                "Loop": "1762P",
                "Instrument_Description": "Pressure Indicating Transmitter",
                "Connected_Line": "2-PG-24464-251482-X-N",
                "Line_Confidence": 0.91,
                "Line_Association_Method": "pipe_graph",
                "Line_Association_Reason": "line label is 42px from traced pipe graph",
                "Line_Candidates": '[{"line_number":"2-PG-24464-251482-X-N","confidence":0.91}]',
                "Coordinates": "100,100",
                "P&ID_Page": 1,
            },
        ]
    )
    lines = pd.DataFrame(
        [
            {
                "Line_Number": "2-PG-24464-251482-X-N",
                "Coordinates": "100,140",
                "P&ID_Page": 1,
            }
        ]
    )

    enriched = attach_geometry_evidence(instruments, lines)
    evidence = json.loads(enriched.loc[0, "Geometry_Evidence"])

    assert evidence["line"]["tag"] == "2-PG-24464-251482-X-N"
    assert evidence["nearest_line_label"] is None


def test_geometry_evidence_flags_conflicting_loop_context():
    instruments = pd.DataFrame(
        [
            {
                "Tag_Number": "FE-1762P-12",
                "Type": "FE",
                "Loop": "1762P",
                "Instrument_Description": "Flow Element",
                "Connected_Line": "",
                "Coordinates": "100,100",
            },
            {
                "Tag_Number": "FIT-1762P-12",
                "Type": "FIT",
                "Loop": "1762P",
                "Instrument_Description": "Flow Indicating Transmitter",
                "Connected_Line": "2-VG-20718-013461-Y-N",
                "Line_Confidence": 0.54,
                "Coordinates": "140,100",
            },
            {
                "Tag_Number": "FCV-1762P-12",
                "Type": "FCV",
                "Loop": "1762P",
                "Instrument_Description": "Flow Control Valve",
                "Connected_Line": "1-IZ-26840-253411-Z-N",
                "Line_Confidence": 0.63,
                "Coordinates": "400,100",
            },
        ]
    )

    enriched = attach_geometry_evidence(instruments)
    evidence = json.loads(enriched.loc[0, "Geometry_Evidence"])

    assert evidence["loop_context"]["conflict"] is True
    assert len(evidence["loop_context"]["candidate_lines"]) == 2
