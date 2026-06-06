# Backend Module Rules

Backend modules should stay loosely coupled.

Recommended module shape:

```text
app/modules/<module>/
  routes.py    FastAPI boundary
  service.py   business logic, DB access, external calls
  schemas.py   optional request/response models
```

Rules:

- Routes should be thin.
- Services should own persistence.
- Shared SQLite writes should go through service functions.
- LLM calls must have timeout and fallback behavior.
- Worker-backed jobs should return a job id and progress state.
- Do not import frontend concepts into backend modules.
- Avoid one module mutating another module's private files or state.

Shared modules:

- `ai_engineers`: shared role/model contracts for discipline AI engineers.
- `instruments`: shared instrument DB service.
- `project_intelligence`: read-first project memory and role-specific AI questions.
- `llm`: Ollama/model service.
- `telemetry`: workflow run logs.

Tool modules:

- `instrumap`: instrumentation extraction and deliverables.
- `piping_mto`: component detection and MTO exports.
- `flowsizing`: sizing inputs/results/reports.
- `engineering_team`: row-level AI Grid suggestions.
