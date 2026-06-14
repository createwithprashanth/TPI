from app.modules.project_context.extractor import (
    blank_project_context,
    _extract_labeled_fields,
    _extract_epc_title_block_fields,
    _infer_document_no,
    _infer_scope,
    _run_llm_normalization,
    _should_run_llm_context,
    _set,
    legacy_project_info,
    merge_project_context,
    refresh_current_document_context,
)


def test_merge_project_context_preserves_detected_and_user_overrides():
    existing = blank_project_context()
    existing["source_files"] = ["old.pdf"]
    existing["standards"] = ["ISA-5.1"]

    detected = blank_project_context()
    detected.update({
        "project_name": "Detected Project",
        "document_type": "P&ID",
        "discipline": "Instrumentation",
        "scope": "Detected scope",
        "source_files": ["pid.pdf"],
        "standards": ["ASME B31.3"],
    })

    merged = merge_project_context(
        existing,
        detected,
        {"project_name": "User Project", "client_name": "Client ABC"},
    )

    assert merged["project_name"] == "User Project"
    assert merged["client_name"] == "Client ABC"
    assert merged["document_type"] == "P&ID"
    assert merged["discipline"] == "Instrumentation"
    assert merged["source_files"] == ["old.pdf", "pid.pdf"]
    assert merged["standards"] == ["ASME B31.3", "ISA-5.1"]


def test_legacy_project_info_exposes_cover_sheet_fields():
    ctx = blank_project_context()
    ctx.update({
        "project_name": "Project",
        "document_type": "P&ID",
        "document_no": "PID-001",
        "revision": "A",
        "source_files": ["pid.pdf"],
    })

    info = legacy_project_info(ctx)

    assert info["project_name"] == "Project"
    assert info["document_type"] == "P&ID"
    assert info["document_no"] == "PID-001"
    assert info["revision"] == "A"
    assert info["source_files"] == ["pid.pdf"]


def test_numeric_epc_filename_infers_document_number_revision_and_area():
    ctx = blank_project_context()

    _infer_document_no(ctx, "13-00-202-0.pdf")

    assert ctx["document_no"] == "13-00-202"
    assert ctx["revision"] == "0"
    assert ctx["unit_area"] == "13"


def test_long_epc_filename_infers_document_number_revision_and_area():
    ctx = blank_project_context()

    _infer_document_no(ctx, "5323P1-H1-013-00-50-001-0.pdf")

    assert ctx["document_no"] == "5323P1-H1-013-00-50-001"
    assert ctx["revision"] == "0"
    assert ctx["unit_area"] == "13"


def test_unit_area_label_cleanup_handles_cover_sheet_artifacts():
    ctx = blank_project_context()

    _set(ctx, "unit_area", "13)", "PDF label: unit_area")

    assert ctx["unit_area"] == "13"


def test_epc_unlabeled_title_block_fields_are_extracted():
    ctx = blank_project_context()

    _extract_epc_title_block_fields(
        ctx,
        """
        COMMENTS RESOLUTION SHEET
        ADNOC GAS
        HABSHAN & BAB CONTROL SYSTEMS UPGRADE (PACKAGE 1) PROJECT NO. 0405323
        PIPING & INSTRUMENTATION DIAGRAM EARLY THAMMAMA 'B' (HABSHAN) H.P.
        PIPELINE SCRAPER RECEIVER
        HABSHAN COMPLEX
        ABU DHABI GAS INDUSTRIES LTD
        """,
    )

    assert ctx["project_name"] == "HABSHAN & BAB CONTROL SYSTEMS UPGRADE (PACKAGE 1)"
    assert ctx["project_no"] == "0405323"
    assert ctx["client_name"] == "ADNOC GAS"
    assert ctx["country"] == "United Arab Emirates"
    assert ctx["facility"] == "HABSHAN COMPLEX"
    assert ctx["location"] == "Habshan"
    assert ctx["document_title"] == (
        "PIPING & INSTRUMENTATION DIAGRAM EARLY THAMMAMA 'B' (HABSHAN) H.P. "
        "PIPELINE SCRAPER RECEIVER"
    )
    assert ctx["document_type"] == "P&ID"


def test_scope_uses_facility_and_unit_when_available():
    ctx = blank_project_context()
    ctx.update({"document_type": "P&ID", "facility": "HABSHAN COMPLEX", "unit_area": "13"})

    _infer_scope(ctx)

    assert ctx["scope"] == "Extraction and review of instruments, lines, equipment, and IO points from HABSHAN COMPLEX / Unit 13."


def test_project_context_auto_llm_runs_only_for_incomplete_context(monkeypatch):
    monkeypatch.setenv("XYRA_PROJECT_CONTEXT_USE_LLM", "auto")

    weak = blank_project_context()
    weak.update({"document_no": "13-00-202", "document_type": "P&ID"})
    assert _should_run_llm_context(weak, "title block text", None) is True

    strong = blank_project_context()
    strong.update({
        "project_name": "HABSHAN & BAB CONTROL SYSTEMS UPGRADE (PACKAGE 1)",
        "project_no": "0405323",
        "client_name": "ADNOC GAS",
        "document_no": "13-00-202",
        "document_title": "PIPING & INSTRUMENTATION DIAGRAM EARLY THAMMAMA",
        "document_type": "P&ID",
    })
    assert _should_run_llm_context(strong, "title block text", None) is False


def test_llm_context_fills_blanks_without_overwriting_extracted_values(monkeypatch):
    ctx = blank_project_context()
    ctx.update({
        "document_no": "13-00-202",
        "revision": "B",
        "document_type": "P&ID",
        "basis": {
            "document_no": "filename",
            "revision": "PDF label: revision",
            "document_type": "document text/filename hint",
        },
    })

    def fake_generate(*args, **kwargs):
        return {
            "project_name": "HABSHAN & BAB CONTROL SYSTEMS UPGRADE (PACKAGE 1)",
            "project_no": "0405323",
            "client_name": "ADNOC GAS",
            "document_no": "WRONG-DOC-NO",
            "revision": "Z",
            "document_title": "PIPING & INSTRUMENTATION DIAGRAM EARLY THAMMAMA",
            "document_type": "Datasheet",
            "standards": ["ISA-5.1"],
        }

    monkeypatch.setattr("app.modules.llm.service.generate", fake_generate)

    normalized = _run_llm_normalization(ctx, "ADNOC GAS title block text", "13-00-202-0.pdf", enabled=True)

    assert normalized["project_name"] == "HABSHAN & BAB CONTROL SYSTEMS UPGRADE (PACKAGE 1)"
    assert normalized["project_no"] == "0405323"
    assert normalized["client_name"] == "ADNOC GAS"
    assert normalized["document_title"] == "PIPING & INSTRUMENTATION DIAGRAM EARLY THAMMAMA"
    assert normalized["document_no"] == "13-00-202"
    assert normalized["revision"] == "B"
    assert normalized["document_type"] == "P&ID"
    assert normalized["standards"] == ["ISA-5.1"]


def test_revision_from_crs_rev_submission_phrase_beats_filename_fallback():
    ctx = blank_project_context()

    _extract_labeled_fields(
        ctx,
        """
        COMMENTS RESOLUTION SHEET
        Following changes are made in P&ID w.r.t. Rev.B submission
        as per piping/instrumentation inputs.
        """,
    )
    _infer_document_no(ctx, "13-00-202-0.pdf")

    assert ctx["document_no"] == "13-00-202"
    assert ctx["revision"] == "B"
    assert ctx["basis"]["revision"] == "PDF label: revision"


def test_current_document_context_refreshes_file_specific_fields_only():
    merged = blank_project_context()
    merged.update({
        "project_no": "0405323",
        "client_name": "ADNOC GAS",
        "document_no": "13-00-202",
        "revision": "B",
        "unit_area": "13",
    })
    incoming = blank_project_context()
    incoming.update({
        "document_no": "13-00-204",
        "revision": "0",
        "unit_area": "13",
        "document_type": "P&ID",
        "discipline": "Instrumentation",
        "basis": {
            "document_no": "filename",
            "revision": "filename",
            "unit_area": "filename",
        },
    })

    refreshed = refresh_current_document_context(merged, incoming)

    assert refreshed["project_no"] == "0405323"
    assert refreshed["client_name"] == "ADNOC GAS"
    assert refreshed["document_no"] == "13-00-204"
    assert refreshed["revision"] == "0"
    assert refreshed["document_type"] == "P&ID"
