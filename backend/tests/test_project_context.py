from app.modules.project_context.extractor import (
    blank_project_context,
    legacy_project_info,
    merge_project_context,
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
