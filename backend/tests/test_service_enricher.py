import pandas as pd

from app.modules.instrumap.core.service_enricher import enrich_instrument_services


def test_service_uses_line_fluid_size_and_valve_position():
    instruments = pd.DataFrame(
        [
            {
                "Tag_Number": "PIT-1762P-18",
                "Type": "PIT",
                "Loop": "1762P",
                "Instrument_Description": "Pressure Indicating Transmitter",
                "IO_Type": "AI",
                "System": "DCS",
                "Connected_Line": "2-PG-24464-251482-X-N",
                "Coordinates": "100,100",
            },
            {
                "Tag_Number": "FCV-1762P-12",
                "Type": "FCV",
                "Loop": "1762P",
                "Instrument_Description": "Flow Control Valve",
                "IO_Type": "AO",
                "System": "DCS",
                "Connected_Line": "2-PG-24464-251482-X-N",
                "Coordinates": "300,100",
            },
        ]
    )
    lines = pd.DataFrame(
        [
            {
                "Line_Number": "2-PG-24464-251482-X-N",
                "Fluid_Code": "PG",
            }
        ]
    )

    enriched = enrich_instrument_services(instruments, lines)
    row = enriched[enriched["Tag_Number"] == "PIT-1762P-18"].iloc[0]

    assert row["Instrument_Service"] == "Pressure measurement on 2 in Produced gas line upstream of FCV-1762P-12"
    assert row["Service_Confidence"] == "High"
    assert "valve context FCV-1762P-12" in row["Service_Basis"]


def test_service_uses_equipment_inlet_outlet_language():
    instruments = pd.DataFrame(
        [
            {
                "Tag_Number": "TIT-100-01",
                "Type": "TIT",
                "Loop": "100",
                "Instrument_Description": "Temperature Indicating Transmitter",
                "IO_Type": "AI",
                "System": "DCS",
                "Connected_Line": "4-PO-1001-A",
                "Coordinates": "500,200",
                "P&ID_Page": 1,
            }
        ]
    )
    lines = pd.DataFrame([{"Line_Number": "4-PO-1001-A", "Fluid_Code": "PO"}])
    equipment = pd.DataFrame(
        [
            {
                "Equipment_Tag": "E-100",
                "Equipment_Type": "Heat Exchanger",
                "Equipment_Code": "E",
                "P&ID_Page": 1,
                "Coordinates": "300,200",
            }
        ]
    )

    enriched = enrich_instrument_services(instruments, lines, equipment)
    row = enriched.iloc[0]

    assert row["Instrument_Service"] == "Temperature measurement on 4 in Process oil line at heat exchanger outlet"
    assert row["Service_Confidence"] == "High"


def test_service_uses_same_loop_context_for_controller_without_line_tag():
    instruments = pd.DataFrame(
        [
            {
                "Tag_Number": "FIC-1414P-26",
                "Type": "FIC",
                "Loop": "1414P",
                "Instrument_Description": "Flow Indicating Controller",
                "IO_Type": "SOFT",
                "System": "DCS",
                "Connected_Line": "",
                "Coordinates": "100,100",
            },
            {
                "Tag_Number": "FIT-1414P-26",
                "Type": "FIT",
                "Loop": "1414P",
                "Instrument_Description": "Flow Indicating Transmitter",
                "IO_Type": "AI",
                "System": "DCS",
                "Connected_Line": "2-PG-24331-251482-X-N",
                "Line_Confidence": 0.68,
                "Line_Association_Method": "loop_propagation",
                "Line_Association_Reason": "same loop final element",
                "Coordinates": "140,100",
            },
        ]
    )
    lines = pd.DataFrame([{"Line_Number": "2-PG-24331-251482-X-N", "Fluid_Code": "PG"}])

    enriched = enrich_instrument_services(instruments, lines)
    row = enriched[enriched["Tag_Number"] == "FIC-1414P-26"].iloc[0]

    assert row["Connected_Line"] == ""
    assert row["Instrument_Service"] == "2 in Produced gas line flow control"
    assert row["Service_Confidence"] == "Medium"
    assert "same-loop context from FIT-1414P-26" in row["Service_Basis"]


def test_service_marks_conflicting_same_loop_context_for_review():
    instruments = pd.DataFrame(
        [
            {
                "Tag_Number": "FE-1762P-12",
                "Type": "FE",
                "Loop": "1762P",
                "Instrument_Description": "Flow Element",
                "IO_Type": "",
                "System": "DCS",
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

    enriched = enrich_instrument_services(instruments)
    row = enriched[enriched["Tag_Number"] == "FE-1762P-12"].iloc[0]

    assert row["Service_Confidence"] == "Review"
    assert "conflicting loop lines require review" in row["Service_Basis"]


def test_service_knows_common_epc_soft_tag_services():
    instruments = pd.DataFrame(
        [
            {
                "Tag_Number": "HIC-1414P-26",
                "Type": "HIC",
                "Instrument_Description": "Hand Indicating Controller",
                "IO_Type": "Soft Link",
                "System": "DCS",
            },
            {
                "Tag_Number": "LAL-56113-20",
                "Type": "LAL",
                "Instrument_Description": "Level Alarm Low",
                "IO_Type": "Soft Link",
                "System": "DCS",
            },
            {
                "Tag_Number": "PDHG-43",
                "Type": "PDHG",
                "Instrument_Description": "Differential Pressure Gauge",
                "IO_Type": "Soft Link",
                "System": "DCS",
            },
            {
                "Tag_Number": "PSDH-1762P-02",
                "Type": "PSDH",
                "Instrument_Description": "Pressure Safety Differential High",
                "IO_Type": "Soft Link",
                "System": "DCS",
            },
            {
                "Tag_Number": "PSDL-1762P-07",
                "Type": "PSDL",
                "Instrument_Description": "Pressure Safety Differential Low",
                "IO_Type": "Soft Link",
                "System": "DCS",
            },
            {
                "Tag_Number": "XA-1762P-03",
                "Type": "XA",
                "Instrument_Description": "Miscellaneous Alarm",
                "IO_Type": "Soft Link",
                "System": "DCS",
            },
            {
                "Tag_Number": "PSAL-1762P-25",
                "Type": "PSAL",
                "Instrument_Description": "Pressure Switch Alarm Low",
                "IO_Type": "DI",
                "System": "SIS/ESD",
            },
            {
                "Tag_Number": "ZIH-1762P-03",
                "Type": "ZIH",
                "Instrument_Description": "Position Indicator High",
                "IO_Type": "DI",
                "System": "DCS",
            },
        ]
    )

    enriched = enrich_instrument_services(instruments)
    services = dict(zip(enriched["Tag_Number"], enriched["Instrument_Service"], strict=False))
    confidences = dict(zip(enriched["Tag_Number"], enriched["Service_Confidence"], strict=False))

    assert services["HIC-1414P-26"] == "Manual indicating controller"
    assert services["LAL-56113-20"] == "Level low alarm"
    assert services["PDHG-43"] == "Local differential pressure indication"
    assert services["PSDH-1762P-02"] == "Differential pressure high switch"
    assert services["PSDL-1762P-07"] == "Differential pressure low switch"
    assert services["XA-1762P-03"] == "Miscellaneous process alarm"
    assert services["PSAL-1762P-25"] == "Pressure low switch"
    assert services["ZIH-1762P-03"] == "Valve position high indication"
    assert all(confidence == "Medium" for confidence in confidences.values())


def test_service_knows_restriction_orifice_with_line_context():
    instruments = pd.DataFrame(
        [
            {
                "Tag_Number": "RO-1414P-03",
                "Type": "RO",
                "Loop": "1414P",
                "Instrument_Description": "Restriction Orifice",
                "IO_Type": "None",
                "System": "DCS",
                "Connected_Line": "2-PG-24338-251482-X-NVR",
                "Line_Confidence": 0.91,
                "Coordinates": "100,100",
            }
        ]
    )
    lines = pd.DataFrame([{"Line_Number": "2-PG-24338-251482-X-NVR", "Fluid_Code": "PG"}])

    enriched = enrich_instrument_services(instruments, lines)
    row = enriched.iloc[0]

    assert row["Instrument_Service"] == "2 in Produced gas line restriction orifice"
    assert row["Service_Confidence"] == "Medium"
