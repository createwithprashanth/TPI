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
