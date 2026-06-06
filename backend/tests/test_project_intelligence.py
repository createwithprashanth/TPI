import asyncio

from app.config import local_db
from app.config.settings import settings
from app.modules.instruments import service as instrument_service
from app.modules.project_intelligence import service as intelligence_service


def _use_temp_db(tmp_path):
    previous_path = settings.XYRA_DB_PATH
    settings.XYRA_DB_PATH = str(tmp_path / "xyra_project_intelligence_test.db")
    local_db._initialized = False
    local_db.init_db()
    return previous_path


def _restore_db(previous_path):
    settings.XYRA_DB_PATH = previous_path
    local_db._initialized = False


def test_project_memory_summarizes_sqlite_project(tmp_path):
    previous_path = _use_temp_db(tmp_path)
    try:
        instrument_service.create_instrument(
            {
                "project_id": "P-INTEL",
                "tag_number": "101-FCV-001",
                "instrument_type": "FCV",
                "service": "",
                "line_tag": "",
                "io_type": "AO",
                "signal_type": "4-20mA",
                "flowsizing_type": "control-valve",
                "review_required": True,
            }
        )
        instrument_service.create_instrument(
            {
                "project_id": "P-INTEL",
                "tag_number": "101-PT-001",
                "instrument_type": "PT",
                "service": "Suction pressure",
                "line_tag": "2-PG-1001-A",
                "io_type": "",
                "signal_type": "",
            }
        )

        memory = intelligence_service.get_project_memory("P-INTEL")

        assert memory["counts"]["instruments"] == 2
        assert memory["quality_gaps"]["missing_service"] == 1
        assert memory["quality_gaps"]["missing_io_type"] == 1
        assert memory["quality_gaps"]["flowsizing_missing_results"] == 1
        assert any(row["tag_number"] == "101-FCV-001" for row in memory["evidence_samples"])
    finally:
        _restore_db(previous_path)


def test_project_memory_query_falls_back_when_model_unavailable(tmp_path, monkeypatch):
    previous_path = _use_temp_db(tmp_path)
    try:
        instrument_service.create_instrument(
            {
                "project_id": "P-QUERY",
                "tag_number": "101-RO-001",
                "instrument_type": "RO",
                "flowsizing_type": "flow-element",
                "line_tag": "",
            }
        )
        monkeypatch.setattr(intelligence_service, "_is_available", lambda model: False)

        result = asyncio.run(
            intelligence_service.query_project_memory(
                project_id="P-QUERY",
                engineer="piping",
                question="What should piping check first?",
                use_model=True,
            )
        )

        assert result["mode"] == "rules_only_model_fallback"
        assert result["model_status"]["status"] == "model_unavailable"
        assert result["actions"]
        assert result["evidence"][0]["tag_number"] == "101-RO-001"
    finally:
        _restore_db(previous_path)


def test_project_memory_query_falls_back_when_model_raises(tmp_path, monkeypatch):
    previous_path = _use_temp_db(tmp_path)
    try:
        instrument_service.create_instrument(
            {
                "project_id": "P-QUERY-ERR",
                "tag_number": "101-FCV-001",
                "instrument_type": "FCV",
                "flowsizing_type": "control-valve",
                "service": "",
            }
        )
        monkeypatch.setattr(intelligence_service, "_is_available", lambda model: True)

        def raise_generate(*args, **kwargs):
            raise RuntimeError("model timeout")

        monkeypatch.setattr(intelligence_service, "generate", raise_generate)

        result = asyncio.run(
            intelligence_service.query_project_memory(
                project_id="P-QUERY-ERR",
                engineer="process",
                question="Review project readiness.",
                use_model=True,
            )
        )

        assert result["mode"] == "rules_only_model_fallback"
        assert result["model_status"]["status"] == "model_error"
        assert "without service" in result["answer"]
    finally:
        _restore_db(previous_path)
