from fastapi.testclient import TestClient

from app.modules.engineering_team import routes as engineering_routes
from main import app


client = TestClient(app)


def test_engineering_team_reviews_inline_control_valve():
    response = client.post(
        "/api/v1/engineering-team/review",
        json={
            "project_id": "P-100",
            "roles": ["instrumentation", "process", "piping"],
            "use_models": False,
            "rows": [
                {
                    "id": "row-1",
                    "tag_number": "101-FCV-001",
                    "instrument_type": "FCV",
                    "service": "",
                    "io_type": "",
                    "line_tag": "",
                    "source": "ai_extracted",
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    suggestions = payload["suggestions"]
    suggested_fields = {item["field"] for item in suggestions}

    assert payload["summary"]["rows_reviewed"] == 1
    assert "io_type" in suggested_fields
    assert "flowsizing_type" in suggested_fields
    assert "review_required" in suggested_fields
    assert any(item["engineer"] == "piping" for item in suggestions)


def test_engineering_team_keeps_highest_confidence_duplicate():
    response = client.post(
        "/api/v1/engineering-team/review",
        json={
            "project_id": "P-100",
            "roles": ["instrumentation", "process", "piping"],
            "use_models": False,
            "rows": [
                {
                    "id": "row-1",
                    "tag_number": "101-FCV-001",
                    "instrument_type": "FCV",
                    "line_tag": "",
                    "review_required": False,
                }
            ],
        },
    )

    assert response.status_code == 200
    review_flags = [
        item
        for item in response.json()["suggestions"]
        if item["id"] == "row-1" and item["field"] == "review_required"
    ]

    assert len(review_flags) == 1
    assert review_flags[0]["confidence"] == 0.88
    assert review_flags[0]["engineer"] == "piping"


def test_engineering_team_requires_rows():
    response = client.post(
        "/api/v1/engineering-team/review",
        json={"project_id": "P-100", "roles": ["instrumentation"], "use_models": False, "rows": []},
    )

    assert response.status_code == 400


def test_engineering_team_merges_model_suggestions(monkeypatch):
    def fake_call(body, role, rows):
        if role != "instrumentation":
            return "model_unavailable", []
        row = rows[0]
        return "reviewed", [
            engineering_routes.ReviewSuggestion(
                id=row.id,
                tag_number=row.tag_number,
                engineer=role,
                field="signal_type",
                current_value=row.signal_type,
                suggested_value="4-20mA + HART",
                confidence=0.91,
                reason="PT transmitters normally use 4-20mA + HART unless the project legend says otherwise.",
            )
        ]

    monkeypatch.setattr(engineering_routes, "_call_role_model_sync", fake_call)

    response = client.post(
        "/api/v1/engineering-team/review",
        json={
            "project_id": "P-100",
            "roles": ["instrumentation"],
            "rows": [
                {
                    "id": "row-1",
                    "tag_number": "101-PT-001",
                    "instrument_type": "PT",
                    "signal_type": "",
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "rules_plus_models"
    assert payload["model_status"]["instrumentation"]["status"] == "reviewed"
    assert any(item["field"] == "signal_type" for item in payload["suggestions"])


def test_engineering_team_model_error_falls_back_to_rules(monkeypatch):
    monkeypatch.setattr(engineering_routes, "_is_available", lambda model: True)

    def raise_generate(*args, **kwargs):
        raise RuntimeError("ollama unavailable")

    monkeypatch.setattr(engineering_routes, "generate", raise_generate)

    response = client.post(
        "/api/v1/engineering-team/review",
        json={
            "project_id": "P-100",
            "roles": ["instrumentation"],
            "rows": [
                {
                    "id": "row-1",
                    "tag_number": "101-PT-001",
                    "instrument_type": "PT",
                    "io_type": "",
                }
            ],
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["model_status"]["instrumentation"]["status"] == "model_error"
    assert any(item["field"] == "io_type" for item in payload["suggestions"])


def test_engineering_team_corrects_soft_display_io_and_rejects_model_conflict(monkeypatch):
    monkeypatch.setattr(engineering_routes, "_is_available", lambda model: True)
    monkeypatch.setattr(
        engineering_routes,
        "generate",
        lambda *args, **kwargs: {
            "suggestions": [
                {
                    "id": "row-1",
                    "field": "io_type",
                    "suggested_value": "AI",
                    "confidence": 0.99,
                    "reason": "Bad model suggestion: FI is not a transmitter.",
                }
            ]
        },
    )

    response = client.post(
        "/api/v1/engineering-team/review",
        json={
            "project_id": "P-100",
            "roles": ["instrumentation"],
            "rows": [
                {
                    "id": "row-1",
                    "tag_number": "FI-1414P-02",
                    "instrument_type": "FI",
                    "io_type": "AI",
                    "signal_type": "",
                    "line_tag": "1-IZ-10199-253411-Z-N",
                }
            ],
        },
    )

    assert response.status_code == 200
    io_suggestions = [
        item for item in response.json()["suggestions"]
        if item["field"] == "io_type"
    ]
    assert len(io_suggestions) == 1
    assert io_suggestions[0]["suggested_value"] == "Soft Link"
    assert io_suggestions[0]["engineer"] == "instrumentation"


def test_engineering_team_corrects_physical_transmitter_not_soft_link():
    response = client.post(
        "/api/v1/engineering-team/review",
        json={
            "project_id": "P-100",
            "roles": ["instrumentation"],
            "use_models": False,
            "rows": [
                {
                    "id": "row-1",
                    "tag_number": "FIT-1001",
                    "instrument_type": "FIT",
                    "io_type": "Soft Link",
                    "signal_type": "4-20mA + HART",
                    "category": "field_device",
                }
            ],
        },
    )

    assert response.status_code == 200
    suggestions = {
        item["field"]: item["suggested_value"]
        for item in response.json()["suggestions"]
        if item["engineer"] == "instrumentation"
    }
    assert suggestions["io_type"] == "AI"


def test_engineering_team_accepts_shorthand_model_suggestions(monkeypatch):
    monkeypatch.setattr(engineering_routes, "_is_available", lambda model: True)
    monkeypatch.setattr(
        engineering_routes,
        "generate",
        lambda *args, **kwargs: {
            "suggestions": [
                {
                    "id": "row-1",
                    "io_type": "AI",
                    "signal_type": "4-20mA + HART",
                    "category": "field_device",
                    "confidence": 0.88,
                    "reason": "PT transmitter defaults.",
                }
            ]
        },
    )

    response = client.post(
        "/api/v1/engineering-team/review",
        json={
            "project_id": "P-100",
            "roles": ["instrumentation"],
            "rows": [
                {
                    "id": "row-1",
                    "tag_number": "PT-1001",
                    "instrument_type": "PT",
                    "io_type": "",
                    "signal_type": "",
                    "category": "",
                }
            ],
        },
    )

    assert response.status_code == 200
    suggestions = {
        item["field"]: item["suggested_value"]
        for item in response.json()["suggestions"]
        if item["engineer"] == "instrumentation"
    }
    assert suggestions["io_type"] == "AI"
    assert suggestions["signal_type"] == "4-20mA + HART"
    assert suggestions["category"] == "field_device"


def test_engineering_team_passes_geometry_evidence_to_model_prompt(monkeypatch):
    seen_prompt = {}
    monkeypatch.setattr(engineering_routes, "_is_available", lambda model: True)

    def fake_generate(prompt, *args, **kwargs):
        seen_prompt["payload"] = prompt
        return {"suggestions": []}

    monkeypatch.setattr(engineering_routes, "generate", fake_generate)

    response = client.post(
        "/api/v1/engineering-team/review",
        json={
            "project_id": "P-100",
            "roles": ["instrumentation"],
            "rows": [
                {
                    "id": "row-1",
                    "tag_number": "PIT-1001",
                    "instrument_type": "PIT",
                    "line_tag": "",
                    "geometry_evidence": {
                        "line": {
                            "tag": "2-PG-1001-A",
                            "confidence": 0.9,
                            "method": "pipe_graph",
                            "candidates": [{"line_number": "2-PG-1001-A"}],
                        },
                        "equipment": {"tag": "V-100", "position": "upstream", "confidence": 0.71},
                        "summary": "upstream equipment V-100",
                    },
                }
            ],
        },
    )

    assert response.status_code == 200
    assert "geometry_evidence" in seen_prompt["payload"]
    assert "V-100" in seen_prompt["payload"]
    assert "candidates" not in seen_prompt["payload"]


def test_engineering_team_flags_weak_geometry_without_confirmed_line():
    response = client.post(
        "/api/v1/engineering-team/review",
        json={
            "project_id": "P-100",
            "roles": ["instrumentation"],
            "use_models": False,
            "rows": [
                {
                    "id": "row-1",
                    "tag_number": "PIT-1001",
                    "instrument_type": "PIT",
                    "io_type": "AI",
                    "line_tag": "",
                    "review_required": False,
                    "status": "Draft",
                    "geometry_evidence": {
                        "equipment": {"tag": "V-100", "position": "upstream", "confidence": 0.71},
                        "summary": "upstream equipment V-100",
                    },
                }
            ],
        },
    )

    assert response.status_code == 200
    suggestions = {
        item["field"]: item["suggested_value"]
        for item in response.json()["suggestions"]
        if item["engineer"] == "instrumentation"
    }
    assert suggestions["review_required"] is True
    assert suggestions["status"] == "For Review"


def test_process_engineer_suggests_line_tag_from_confirmed_geometry():
    response = client.post(
        "/api/v1/engineering-team/review",
        json={
            "project_id": "P-100",
            "roles": ["process"],
            "use_models": False,
            "rows": [
                {
                    "id": "row-1",
                    "tag_number": "TE-1001",
                    "instrument_type": "TE",
                    "line_tag": "",
                    "geometry_evidence": {
                        "line": {
                            "tag": "2-PG-24464-251482-X-N",
                            "method": "pipe_graph",
                            "confidence": 0.91,
                        }
                    },
                }
            ],
        },
    )

    assert response.status_code == 200
    suggestions = {
        item["field"]: item["suggested_value"]
        for item in response.json()["suggestions"]
        if item["engineer"] == "process"
    }
    assert suggestions["line_tag"] == "2-PG-24464-251482-X-N"


def test_engineering_team_rejects_model_suggestion_that_conflicts_with_type_defaults(monkeypatch):
    monkeypatch.setattr(engineering_routes, "_is_available", lambda model: True)
    monkeypatch.setattr(
        engineering_routes,
        "generate",
        lambda *args, **kwargs: {
            "suggestions": [
                {
                    "id": "row-1",
                    "field": "category",
                    "suggested_value": "field_device",
                    "confidence": 1,
                    "reason": "Bad model suggestion: TE is not a transmitter.",
                }
            ]
        },
    )

    response = client.post(
        "/api/v1/engineering-team/review",
        json={
            "project_id": "P-100",
            "roles": ["instrumentation"],
            "rows": [
                {
                    "id": "row-1",
                    "tag_number": "TE-1001",
                    "instrument_type": "TE",
                    "io_type": "",
                    "signal_type": "",
                    "category": "",
                }
            ],
        },
    )

    assert response.status_code == 200
    suggestions = {
        item["field"]: item["suggested_value"]
        for item in response.json()["suggestions"]
        if item["engineer"] == "instrumentation"
    }
    assert suggestions["io_type"] == "None"
    assert suggestions["signal_type"] == "None"
    assert suggestions["category"] == "passive"
