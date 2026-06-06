from fastapi.testclient import TestClient

from app.modules.ai_engineers.contracts import (
    ALL_SUGGESTION_FIELDS,
    ENGINEER_CONTRACTS,
    ENGINEER_MODELS,
    ROLE_ALLOWED_FIELDS,
    TYPE_DEFAULTS,
)
from main import app


client = TestClient(app)


def test_core_routes_are_registered():
    routes = {route.path for route in app.routes}
    expected = {
        "/health",
        "/api/v1/llm/status",
        "/api/v1/system/health",
        "/api/v1/instruments",
        "/api/v1/instruments/projects",
        "/api/v1/engineering-team/review",
        "/api/v1/project-intelligence/memory",
        "/api/v1/project-intelligence/query",
    }

    assert expected.issubset(routes)


def test_system_health_schema_is_client_safe():
    response = client.get("/api/v1/system/health")

    assert response.status_code == 200
    payload = response.json()
    assert "services" in payload
    assert "metrics" in payload
    assert payload["metrics"]["read_only"] is True
    for key in (
        "backend",
        "redis",
        "project_db",
        "rq_worker",
        "ollama",
        "pid_model",
        "line_model",
        "project_context_model",
        "mto_reviewer_model",
        "instrumentation_engineer_model",
        "process_engineer_model",
        "piping_engineer_model",
    ):
        assert key in payload["services"]
        assert {"label", "ok", "role", "detail"}.issubset(payload["services"][key])


def test_engineer_contracts_are_consistent():
    assert set(ENGINEER_CONTRACTS) == {"instrumentation", "process", "piping"}
    assert set(ENGINEER_MODELS) == set(ENGINEER_CONTRACTS)
    assert set(ROLE_ALLOWED_FIELDS) == set(ENGINEER_CONTRACTS)

    for role, contract in ENGINEER_CONTRACTS.items():
        assert contract.role == role
        assert contract.model.startswith("xyra-")
        assert contract.health_key.endswith("_model")
        assert contract.allowed_fields
        assert contract.allowed_fields.issubset(ALL_SUGGESTION_FIELDS)
        assert ENGINEER_MODELS[role] == contract.model
        assert ROLE_ALLOWED_FIELDS[role] == contract.allowed_fields


def test_engineering_defaults_cover_handoff_types():
    for code in ("FCV", "PCV", "LCV", "TCV", "BDV", "SDV", "SSV", "MOV", "XV"):
        assert TYPE_DEFAULTS[code]["category"] == "final_element"
        assert TYPE_DEFAULTS[code]["flowsizing_type"] == "control-valve"

    assert TYPE_DEFAULTS["PSV"]["flowsizing_type"] == "relief-valve"
    assert TYPE_DEFAULTS["FE"]["flowsizing_type"] == "flow-element"
    assert TYPE_DEFAULTS["RO"]["flowsizing_type"] == "flow-element"
