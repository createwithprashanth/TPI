from __future__ import annotations

import fitz

from app.config import local_db
from app.config.settings import settings
from app.modules.project_knowledge import service


def _use_temp_db(tmp_path):
    previous_path = settings.XYRA_DB_PATH
    settings.XYRA_DB_PATH = str(tmp_path / "xyra_test.db")
    local_db._initialized = False
    local_db.init_db()
    return previous_path


def _restore_db(previous_path):
    settings.XYRA_DB_PATH = previous_path
    local_db._initialized = False


def _write_pdf(path, text: str):
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), text)
    doc.save(path)
    doc.close()


def test_project_knowledge_indexes_folder_and_searches_with_citations(tmp_path):
    previous_path = _use_temp_db(tmp_path)
    try:
        docs = tmp_path / "docs"
        docs.mkdir()
        (docs / "client_standard.md").write_text(
            "Client standard: all shutdown valves shall fail closed and follow IEC 61511.",
            encoding="utf-8",
        )
        (docs / "legend.txt").write_text(
            "PID legend defines instrument symbols, valve symbols, and drawing symbology.",
            encoding="utf-8",
        )
        _write_pdf(
            docs / "project_sow.pdf",
            "Project SOW includes P&ID review, instrumentation deliverables, and valve MTO verification.",
        )

        stats = service.index_folder("PK-100", str(docs))
        assert stats["indexed"] == 3
        assert stats["chunks"] >= 3

        listed = service.list_documents("PK-100")
        assert listed["total"] == 3
        assert listed["chunks"] >= 3
        pdf_doc = next(doc for doc in listed["documents"] if doc["file_name"] == "project_sow.pdf")
        preview = service.render_page_image("PK-100", pdf_doc["id"], page_number=1, zoom=0.35)
        assert preview.startswith(b"\x89PNG")

        hits = service.search("PK-100", "shutdown valves IEC 61511", limit=5)
        assert hits["results"]
        assert hits["results"][0]["file_name"] == "client_standard.md"
        assert "IEC 61511" in hits["results"][0]["excerpt"]

        symbol_hits = service.search("PK-100", "P&ID symbols", limit=3)
        assert symbol_hits["results"][0]["file_name"] == "legend.txt"
        assert "symbol" in symbol_hits["results"][0]["matched_terms"]

        saved = service.save_evidence("PK-100", symbol_hits["results"][0], question="P&ID symbols?")
        assert saved["citation_snapshot"]["file_name"] == "legend.txt"
        saved_list = service.list_saved_evidence("PK-100")
        assert saved_list["total"] == 1
        deleted = service.delete_saved_evidence("PK-100", saved["id"])
        assert deleted["deleted"] is True
        assert service.list_saved_evidence("PK-100")["total"] == 0
    finally:
        _restore_db(previous_path)


def test_project_knowledge_chat_falls_back_without_model(tmp_path):
    previous_path = _use_temp_db(tmp_path)
    try:
        docs = tmp_path / "docs"
        docs.mkdir()
        (docs / "sow.txt").write_text(
            "The scope includes instrument index, IO list, P&ID extraction, and piping material take-off.",
            encoding="utf-8",
        )
        service.index_folder("PK-200", str(docs))

        import asyncio

        result = asyncio.run(service.chat("PK-200", "What is in the scope?", use_model=False))
        assert "scope" in result["answer"].lower()
        assert result["citations"]
        assert result["follow_up_questions"]

        with local_db.connection() as conn:
            count = conn.execute("SELECT COUNT(*) FROM project_knowledge_chat WHERE project_id='PK-200'").fetchone()[0]
        assert count == 1
    finally:
        _restore_db(previous_path)
