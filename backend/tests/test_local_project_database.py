import pandas as pd
import pytest

from app.config import local_db
from app.config.settings import settings
from app.modules.instrumap.core.excel_writer import _deliverable_df
from app.modules.instrumap.core.standard_library import apply_output_sanity_rules, instrument_tag_quality
from app.modules.instruments import service as instrument_service
from app.modules.piping_mto import database as mto_database


def _use_temp_db(tmp_path):
    previous_path = settings.XYRA_DB_PATH
    settings.XYRA_DB_PATH = str(tmp_path / "xyra_test.db")
    local_db._initialized = False
    local_db.init_db()
    return previous_path


def _restore_db(previous_path):
    settings.XYRA_DB_PATH = previous_path
    local_db._initialized = False


def test_non_sqlite_backend_is_explicitly_guarded(tmp_path):
    previous_path = settings.XYRA_DB_PATH
    previous_backend = settings.XYRA_DB_BACKEND
    settings.XYRA_DB_PATH = str(tmp_path / "xyra_test.db")
    settings.XYRA_DB_BACKEND = "mssql"
    local_db._initialized = False
    try:
        with pytest.raises(RuntimeError, match="not enabled"):
            local_db.init_db()
    finally:
        settings.XYRA_DB_BACKEND = previous_backend
        settings.XYRA_DB_PATH = previous_path
        local_db._initialized = False


def test_instrument_crud_and_lookups(tmp_path):
    previous_path = _use_temp_db(tmp_path)
    try:
        created = instrument_service.create_instrument(
            {
                "project_id": "P-100",
                "tag_number": "101-PT-001",
                "instrument_type": "PT",
                "service": "Test pressure",
                "io_type": "AI",
                "review_required": True,
            },
            user_id="tester",
        )

        assert created["tag_number"] == "101-PT-001"
        assert created["review_required"] is True

        updated = instrument_service.update_instrument(
            created["id"],
            {"service": "Updated pressure", "status": "Issued for Design"},
            user_id="tester",
        )
        assert updated["service"] == "Updated pressure"

        listed = instrument_service.list_instruments("P-100")
        assert listed["total"] == 1
        assert listed["data"][0]["tag_number"] == "101-PT-001"

        lookups = instrument_service.get_lookups("P-100")
        assert any(item["value"] == "PT" for item in lookups["instrument_types"])
    finally:
        _restore_db(previous_path)


def test_instrumap_upsert_and_grid_preferences(tmp_path):
    previous_path = _use_temp_db(tmp_path)
    try:
        df = pd.DataFrame(
            [
                {
                    "Tag_Number": "101-FCV-001",
                    "Type": "FCV",
                    "Suffix": "001",
                    "Instrument_Service": "Crude inlet flow control",
                    "IO_Type": "AO",
                    "Signal_Type": "4-20mA + HART",
                    "Loop": "001",
                    "Area": "101",
                    "Connected_Line": "2-PG-1001-A",
                    "Review_Required": False,
                    "Line_Confidence": 0.92,
                    "Geometry_Evidence": '{"line":{"tag":"2-PG-1001-A","confidence":0.92},"summary":"line 2-PG-1001-A"}',
                    "Service_Confidence": "high",
                }
            ]
        )

        stats = instrument_service.upsert_instrumap_dataframe(
            df,
            project_id="P-200",
            batch_id="batch-1",
            pdf_filename="pid-001.pdf",
            project_metadata={"project_name": "Demo Project"},
        )
        assert stats == {"inserted": 1, "updated": 0, "skipped": 0}

        listed = instrument_service.list_instruments("P-200")
        row = listed["data"][0]
        assert row["tag_number"] == "101-FCV-001"
        assert row["line_tag"] == "2-PG-1001-A"
        assert row["field_confidence"]["service"] == 0.9
        assert row["geometry_evidence"]["line"]["tag"] == "2-PG-1001-A"

        with local_db.connection() as conn:
            conn.execute(
                """
                INSERT INTO user_grid_preferences
                  (user_id, datasource_id, visible_columns, column_order, column_widths)
                VALUES ('local-user', 'instruments', '["tag_number"]', '["tag_number"]', '{"tag_number":160}')
                """
            )
            prefs = conn.execute(
                """
                SELECT visible_columns, column_order, column_widths
                FROM user_grid_preferences
                WHERE user_id='local-user' AND datasource_id='instruments'
                """
            ).fetchone()

        decoded = local_db.row_to_dict(prefs)
        assert decoded["visible_columns"] == ["tag_number"]
        assert decoded["column_widths"]["tag_number"] == 160
    finally:
        _restore_db(previous_path)


def test_mto_payload_saves_grid_rows_and_detection_evidence(tmp_path):
    previous_path = _use_temp_db(tmp_path)
    try:
        payload = {
            "project_id": "MTO-100",
            "project": {"project_name": "Demo MTO", "project_no": "MTO-100", "client_name": "Client"},
            "threshold": 0.8,
            "sessions": [
                {
                    "id": "ball",
                    "label": "Ball valve",
                    "count": 2,
                    "metadata": {
                        "categoryCode": "H",
                        "categoryName": "BALL VALVE",
                        "unit": "-",
                        "itemType": "Ball valve",
                        "pipingClass": "A1A3A-FA",
                        "rating": "150#",
                        "valveBore": "FB",
                        "endConnection": "FLANGED",
                        "dataSheetDocumentNo": "50213-DS-00-LA-8004",
                        "dataSheetReferenceNo": "BV-001",
                    },
                    "fileResults": [
                        {
                            "fileName": "PID-001.pdf",
                            "count": 2,
                            "matches": [
                                {
                                    "page": 1,
                                    "x1": 10,
                                    "y1": 20,
                                    "x2": 40,
                                    "y2": 60,
                                    "score": 0.91,
                                    "sizeInch": "0.75",
                                    "sizeSource": '3/4"',
                                    "sizeSourceType": "standalone",
                                    "sizeConfidence": 0.94,
                                    "sizeCandidates": [{"size": "0.75", "source": '3/4"', "confidence": 0.94}],
                                    "aiDecision": "ACCEPT",
                                },
                                {
                                    "page": 1,
                                    "x1": 80,
                                    "y1": 20,
                                    "x2": 110,
                                    "y2": 60,
                                    "score": 0.88,
                                    "accepted": False,
                                    "sizeInch": "2",
                                    "sizeSource": '2"',
                                    "sizeConfidence": 0.62,
                                    "sizeAmbiguous": True,
                                    "aiDecision": "REVIEW",
                                },
                            ],
                            "pageCounts": [{"page": 1, "count": 2}],
                        }
                    ],
                }
            ],
        }

        saved = mto_database.save_mto_payload(payload, user_id="tester")

        assert saved["rows_saved"] == 1
        assert saved["detections_saved"] == 1

        listed = mto_database.list_mto_items("MTO-100", sort_by="size_inch")
        assert listed["total"] == 1
        assert {row["size_inch"] for row in listed["data"]} == {"0.75"}
        assert not any(row["review_required"] for row in listed["data"])

        reviewed = listed["data"][0]
        evidence = mto_database.get_mto_evidence(reviewed["id"])
        assert evidence[0]["size_ambiguous"] is False
        assert evidence[0]["review_required"] is False

        updated = mto_database.update_mto_item(reviewed["id"], {"review_status": "Checked"})
        assert updated["review_status"] == "Checked"
    finally:
        _restore_db(previous_path)


def test_gemini_taught_noise_is_rejected_from_deliverables_and_db(tmp_path):
    previous_path = _use_temp_db(tmp_path)
    try:
        raw_df = pd.DataFrame(
            [
                {
                    "Tag_Number": "PIT-1762P-18",
                    "Type": "PIT",
                    "Loop": "1762P",
                    "Suffix": "18",
                    "IO_Type": "AI",
                    "Signal_Type": "4-20mA + HART",
                    "Connected_Line": "Review_required=true",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "FROM-12330-FROM",
                    "Type": "FROM",
                    "Loop": "12330",
                    "Suffix": "FROM",
                    "IO_Type": "Soft Link",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "1203P-01",
                    "Type": "",
                    "Loop": "1203P",
                    "Suffix": "01",
                    "IO_Type": "Soft Link",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "ADNOC-11",
                    "Type": "ADNOC",
                    "Loop": "11",
                    "Suffix": "",
                    "IO_Type": "Soft Link",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "PLUG-18",
                    "Type": "PLUG",
                    "Loop": "",
                    "Suffix": "18",
                    "IO_Type": "Soft Link",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "FCV-1762P-12",
                    "Type": "FCV",
                    "Loop": "1762P",
                    "Suffix": "12",
                    "IO_Type": "AO",
                    "Signal_Type": "",
                    "Power_Supply": "Loop Powered",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "CC",
                    "Type": "CC",
                    "Loop": "",
                    "Suffix": "",
                    "IO_Type": "Soft Link",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "TE-1762P-02",
                    "Type": "TE",
                    "Loop": "1762P",
                    "Suffix": "02",
                    "IO_Type": "AI",
                    "Signal_Type": "RTD/TC",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "VALVE-24",
                    "Type": "VALVE",
                    "Loop": "",
                    "Suffix": "24",
                    "IO_Type": "Soft Link",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "13-TP-4000A",
                    "Type": "TP",
                    "Area": "13",
                    "Loop": "4000",
                    "Suffix": "A",
                    "IO_Type": "",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "253-FL",
                    "Type": "FL",
                    "Loop": "",
                    "Suffix": "",
                    "IO_Type": "",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "PANEL-34",
                    "Type": "PANEL",
                    "Loop": "",
                    "Suffix": "34",
                    "IO_Type": "Soft Link",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "GAS-40",
                    "Type": "GAS",
                    "Loop": "",
                    "Suffix": "40",
                    "IO_Type": "DI",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "SPARE-14",
                    "Type": "SPARE",
                    "Loop": "",
                    "Suffix": "14",
                    "IO_Type": "Soft Link",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "PT-1762P-18",
                    "Type": "PT",
                    "Loop": "1762P",
                    "Suffix": "18",
                    "IO_Type": "AI",
                    "Connected_Line": "2-PG-24468-251482-X-N18",
                    "Line_Confidence": 0.86,
                    "Line_Association_Method": "pipe_graph",
                    "Line_Association_Reason": "line label is 42px from traced pipe graph",
                    "Line_Candidates": '[{"line_number":"2-PG-24468-251482-X-N","method":"pipe_graph","confidence":0.86}]',
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "CVZI-573P-02",
                    "Type": "CVZI",
                    "Loop": "573P",
                    "Suffix": "02",
                    "IO_Type": "DI",
                    "Service_Confidence": "Low",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "ADCO-1963-ADCO",
                    "Type": "ADCO",
                    "Loop": "1963",
                    "Suffix": "ADCO",
                    "IO_Type": "Soft Link",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "AFTER-317-209",
                    "Type": "AFTER",
                    "Loop": "317",
                    "Suffix": "209",
                    "IO_Type": "Soft Link",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "AREA-5610-5710",
                    "Type": "AREA",
                    "Loop": "5610",
                    "Suffix": "5710",
                    "IO_Type": "Soft Link",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "ALARM-8004",
                    "Type": "ALARM",
                    "Loop": "8004",
                    "Suffix": "",
                    "IO_Type": "Soft Link",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "ASIC-7767",
                    "Type": "ASIC",
                    "Loop": "7767",
                    "Suffix": "",
                    "IO_Type": "Soft Link",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "BALL-316-INTHE",
                    "Type": "BALL",
                    "Loop": "316",
                    "Suffix": "INTHE",
                    "IO_Type": "Soft Link",
                    "Review_Required": False,
                },
                {
                    "Tag_Number": "LIMIT-11055",
                    "Type": "LIMIT",
                    "Loop": "11055",
                    "Suffix": "",
                    "IO_Type": "AI",
                    "Review_Required": False,
                },
            ]
        )

        cleaned = apply_output_sanity_rules(raw_df)
        deliverable = _deliverable_df(cleaned)

        assert instrument_tag_quality(raw_df.iloc[1].to_dict())[0] == "rejected_noise"
        assert "FROM-12330-FROM" not in set(deliverable["Tag_Number"])
        assert "1203P-01" not in set(deliverable["Tag_Number"])
        assert "ADNOC-11" not in set(deliverable["Tag_Number"])
        assert "PLUG-18" not in set(deliverable["Tag_Number"])
        assert "CC" not in set(deliverable["Tag_Number"])
        assert "VALVE-24" not in set(deliverable["Tag_Number"])
        assert "253-FL" not in set(deliverable["Tag_Number"])
        assert "13-TP-4000A" in set(deliverable["Tag_Number"])
        assert "PANEL-34" not in set(deliverable["Tag_Number"])
        assert "GAS-40" not in set(deliverable["Tag_Number"])
        assert "SPARE-14" not in set(deliverable["Tag_Number"])
        assert "ADCO-1963-ADCO" not in set(deliverable["Tag_Number"])
        assert "AFTER-317-209" not in set(deliverable["Tag_Number"])
        assert "AREA-5610-5710" not in set(deliverable["Tag_Number"])
        assert "ALARM-8004" not in set(deliverable["Tag_Number"])
        assert "ASIC-7767" not in set(deliverable["Tag_Number"])
        assert "BALL-316-INTHE" not in set(deliverable["Tag_Number"])
        assert "LIMIT-11055" not in set(deliverable["Tag_Number"])
        assert "PIT-1762P-18" in set(deliverable["Tag_Number"])
        assert "FCV-1762P-12" in set(deliverable["Tag_Number"])
        assert cleaned.loc[cleaned["Tag_Number"] == "PIT-1762P-18", "Connected_Line"].iloc[0] == ""
        assert cleaned.loc[cleaned["Tag_Number"] == "PT-1762P-18", "Connected_Line"].iloc[0] == "2-PG-24468-251482-X-N"
        assert cleaned.loc[cleaned["Tag_Number"] == "TE-1762P-02", "IO_Type"].iloc[0] == "None"
        assert cleaned.loc[cleaned["Tag_Number"] == "FCV-1762P-12", "Power_Supply"].iloc[0] == "24VDC"

        stats = instrument_service.upsert_instrumap_dataframe(
            cleaned,
            project_id="P-300",
            batch_id="batch-noise",
            pdf_filename="pid-noise.pdf",
        )
        assert stats["inserted"] == 23

        listed = instrument_service.list_instruments("P-300", page_size=40)
        rows = {row["tag_number"]: row for row in listed["data"]}
        assert rows["FROM-12330-FROM"]["status"] == "Rejected - Noise"
        assert rows["FROM-12330-FROM"]["active_on_pid"] is False
        assert rows["1203P-01"]["status"] == "Rejected - Noise"
        assert rows["ADNOC-11"]["status"] == "Rejected - Noise"
        assert rows["PLUG-18"]["status"] == "Rejected - Noise"
        assert rows["VALVE-24"]["status"] == "Rejected - Noise"
        assert rows["253-FL"]["status"] == "Rejected - Noise"
        assert rows["13-TP-4000A"]["status"] in {"Draft", "For Review"}
        assert rows["13-TP-4000A"]["active_on_pid"] is True
        assert rows["13-TP-4000A"]["io_type"] == "None"
        assert rows["PANEL-34"]["status"] == "Rejected - Noise"
        assert rows["GAS-40"]["status"] == "Rejected - Noise"
        assert rows["SPARE-14"]["status"] == "Rejected - Noise"
        assert rows["ADCO-1963-ADCO"]["status"] == "Rejected - Noise"
        assert rows["AFTER-317-209"]["status"] == "Rejected - Noise"
        assert rows["AREA-5610-5710"]["status"] == "Rejected - Noise"
        assert rows["ALARM-8004"]["status"] == "Rejected - Noise"
        assert rows["ASIC-7767"]["status"] == "Rejected - Noise"
        assert rows["BALL-316-INTHE"]["status"] == "Rejected - Noise"
        assert rows["LIMIT-11055"]["status"] == "Rejected - Noise"
        assert rows["FCV-1762P-12"]["supply_voltage"] == "24VDC"
        assert rows["CC"]["status"] == "Suppressed - Incomplete"
        assert rows["CC"]["active_on_pid"] is False
        assert rows["PIT-1762P-18"]["active_on_pid"] is True
        assert rows["PIT-1762P-18"]["line_tag"] in ("", None)
        assert rows["PT-1762P-18"]["line_tag"] == "2-PG-24468-251482-X-N"
        assert rows["PT-1762P-18"]["line_confidence"] == 0.86
        assert rows["PT-1762P-18"]["line_association_method"] == "pipe_graph"
        assert rows["PT-1762P-18"]["line_candidates"][0]["line_number"] == "2-PG-24468-251482-X-N"
        assert rows["TE-1762P-02"]["io_type"] == "None"
        assert rows["TE-1762P-02"]["category"] == "passive"
        assert rows["CVZI-573P-02"]["category"] == "field_device"
        assert rows["CVZI-573P-02"]["io_type"] == "DI"
        assert rows["CVZI-573P-02"]["signal_type"] == "24VDC (Dry Contact)"
        assert "hardwired IO has no connected line/equipment tag" in rows["CVZI-573P-02"]["notes"]
        assert "service description has low confidence" in rows["CVZI-573P-02"]["notes"]
    finally:
        _restore_db(previous_path)
