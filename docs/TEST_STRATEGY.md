# XYRA Studio Test Strategy

The goal is simple: customer deployments should not break during normal engineering work.

## Test Layers

| Layer | Purpose | Command |
|---|---|---|
| Backend unit/contract tests | Protect extraction helpers, DB services, AI fallbacks, exports, readiness contracts | `pytest backend/tests -q` |
| Frontend type/build test | Protect React/TypeScript integration and bundle generation | `cd frontend && npm run build` |
| Browser smoke test | Protect actual visible workflows | Manual or automated local browser pass |
| Model benchmark | Protect prompt/model quality after Modelfile changes | `python backend/tests/benchmarks/run_engineering_team_models.py` |
| Client install smoke | Protect Docker/network/model deployment | System Health + sample workflows |

## Always-Test Areas

Before a client delivery:

- `/health`
- `/api/v1/system/health`
- Instrumentation extraction job
- AI Grid load/save
- Engineering Team review fallback
- Project Intelligence query fallback
- Piping MTO detection and export
- FlowSizing save/result
- System Health model visibility

## AI Failure Requirements

Every AI-backed workflow must have tests for:

- model unavailable
- model call raises/timeout
- malformed/non-JSON response
- model suggests a field outside its allowed role
- deterministic fallback still returns useful output

Current protected examples:

- `test_engineering_team_model_error_falls_back_to_rules`
- `test_project_memory_query_falls_back_when_model_unavailable`
- `test_project_memory_query_falls_back_when_model_raises`

## SQLite Requirements

Every DB workflow must use a temporary SQLite DB in tests.

Required checks:

- create
- update
- list/filter
- JSON field decoding
- schema upgrade where applicable
- shared project ownership

## UI Smoke Checklist

At minimum, verify:

- Header controls fit at `1920x1080`.
- Dark/light toggle works and persists.
- No console errors.
- No global horizontal page scroll.
- Tool navigation works.
- AI Grid can scroll and save.
- MTO component row does not horizontally overflow.
- PrecisionPDF toolbar controls are visible.
- System Health overlay opens and closes.

## Release Gate

Do not hand to client unless:

```text
Backend tests pass
Frontend build passes
System Health is green or clearly explains unavailable optional services
Sample Instrumentation workflow works
Sample MTO workflow works
AI Grid reads/writes SQLite
FlowSizing opens and saves at least one result
```

## Future Test Automation

Recommended next automation:

- Add Playwright as a dev dependency.
- Create `frontend/tests/smoke.spec.ts`.
- Capture screenshots for dark/light and all tools.
- Run smoke tests against local Vite server.
- Include browser test artifacts in diagnostic bundle.

