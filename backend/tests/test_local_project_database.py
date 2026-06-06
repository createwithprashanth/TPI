import pandas as pd

from app.config import local_db
from app.config.settings import settings
from app.modules.instruments import service as instrument_service


def _use_temp_db(tmp_path):
    previous_path = settings.XYRA_DB_PATH
    settings.XYRA_DB_PATH = str(tmp_path / "xyra_test.db")
    local_db._initialized = False
    local_db.init_db()
    return previous_path


def _restore_db(previous_path):
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
