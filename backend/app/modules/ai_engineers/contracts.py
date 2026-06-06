from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from app.modules.llm.service import (
    INSTRUMENTATION_ENGINEER_MODEL,
    PIPING_ENGINEER_MODEL,
    PROCESS_ENGINEER_MODEL,
)

EngineerRole = Literal["instrumentation", "process", "piping"]


@dataclass(frozen=True)
class EngineerContract:
    role: EngineerRole
    model: str
    label: str
    health_key: str
    health_role: str
    allowed_fields: frozenset[str]


ALL_SUGGESTION_FIELDS = frozenset(
    {
        "instrument_type",
        "category",
        "io_type",
        "signal_type",
        "status",
        "review_required",
        "flowsizing_type",
        "service",
        "line_tag",
    }
)

ENGINEER_CONTRACTS: dict[EngineerRole, EngineerContract] = {
    "instrumentation": EngineerContract(
        role="instrumentation",
        model=INSTRUMENTATION_ENGINEER_MODEL,
        label="Instrumentation Engineer",
        health_key="instrumentation_engineer_model",
        health_role="AI Grid instrumentation reviewer",
        allowed_fields=frozenset(
            {
                "instrument_type",
                "category",
                "io_type",
                "signal_type",
                "status",
                "review_required",
                "flowsizing_type",
            }
        ),
    ),
    "process": EngineerContract(
        role="process",
        model=PROCESS_ENGINEER_MODEL,
        label="Process Engineer",
        health_key="process_engineer_model",
        health_role="AI Grid process reviewer",
        allowed_fields=frozenset({"service", "status", "review_required", "line_tag"}),
    ),
    "piping": EngineerContract(
        role="piping",
        model=PIPING_ENGINEER_MODEL,
        label="Piping Engineer",
        health_key="piping_engineer_model",
        health_role="AI Grid piping reviewer",
        allowed_fields=frozenset({"line_tag", "flowsizing_type", "status", "review_required"}),
    ),
}

ENGINEER_MODELS: dict[EngineerRole, str] = {
    role: contract.model for role, contract in ENGINEER_CONTRACTS.items()
}

ROLE_ALLOWED_FIELDS: dict[EngineerRole, frozenset[str]] = {
    role: contract.allowed_fields for role, contract in ENGINEER_CONTRACTS.items()
}

TYPE_DEFAULTS: dict[str, dict[str, Any]] = {
    "FCV": {"io_type": "AO", "signal_type": "4-20mA", "category": "final_element", "flowsizing_type": "control-valve"},
    "PCV": {"io_type": "AO", "signal_type": "4-20mA", "category": "final_element", "flowsizing_type": "control-valve"},
    "LCV": {"io_type": "AO", "signal_type": "4-20mA", "category": "final_element", "flowsizing_type": "control-valve"},
    "TCV": {"io_type": "AO", "signal_type": "4-20mA", "category": "final_element", "flowsizing_type": "control-valve"},
    "HCV": {"io_type": "AO", "signal_type": "4-20mA", "category": "final_element", "flowsizing_type": "control-valve"},
    "BDV": {"io_type": "DO", "signal_type": "24VDC", "category": "final_element", "flowsizing_type": "control-valve"},
    "SDV": {"io_type": "DO", "signal_type": "24VDC", "category": "final_element", "flowsizing_type": "control-valve"},
    "SSV": {"io_type": "DO", "signal_type": "24VDC", "category": "final_element", "flowsizing_type": "control-valve"},
    "MOV": {"io_type": "DO", "signal_type": "24VDC", "category": "final_element", "flowsizing_type": "control-valve"},
    "XV": {"io_type": "DO", "signal_type": "24VDC", "category": "final_element", "flowsizing_type": "control-valve"},
    "PSV": {"io_type": "None", "category": "safety", "flowsizing_type": "relief-valve"},
    "FE": {"io_type": "None", "category": "field_device", "flowsizing_type": "flow-element"},
    "RO": {"io_type": "None", "category": "field_device", "flowsizing_type": "flow-element"},
    "FT": {"io_type": "AI", "signal_type": "4-20mA + HART", "category": "field_device"},
    "FIT": {"io_type": "AI", "signal_type": "4-20mA + HART", "category": "field_device"},
    "FIC": {"io_type": "Soft Link", "signal_type": "Soft Link", "category": "controller"},
    "PT": {"io_type": "AI", "signal_type": "4-20mA + HART", "category": "field_device"},
    "PIT": {"io_type": "AI", "signal_type": "4-20mA + HART", "category": "field_device"},
    "PDT": {"io_type": "AI", "signal_type": "4-20mA + HART", "category": "field_device"},
    "TT": {"io_type": "AI", "signal_type": "4-20mA + HART", "category": "field_device"},
    "TIT": {"io_type": "AI", "signal_type": "4-20mA + HART", "category": "field_device"},
    "TE": {"io_type": "AI", "signal_type": "RTD/TC", "category": "field_device"},
    "LT": {"io_type": "AI", "signal_type": "4-20mA + HART", "category": "field_device"},
    "LIT": {"io_type": "AI", "signal_type": "4-20mA + HART", "category": "field_device"},
    "AT": {"io_type": "AI", "signal_type": "4-20mA + HART", "category": "analyzer"},
    "XGD": {"io_type": "AI", "signal_type": "4-20mA + HART", "category": "analyzer"},
    "XFD": {"io_type": "DI", "signal_type": "24VDC (Dry Contact)", "category": "analyzer"},
    "HS": {"io_type": "DI", "signal_type": "24VDC (Dry Contact)", "category": "field_device"},
    "PSAH": {"io_type": "DI", "signal_type": "24VDC (Dry Contact)", "category": "safety"},
    "PSAL": {"io_type": "DI", "signal_type": "24VDC (Dry Contact)", "category": "safety"},
}


def role_model(role: EngineerRole) -> str:
    return ENGINEER_CONTRACTS[role].model
