# Future Tool and Model Template

Use this template whenever XYRA Studio adds a new engineering tool or a new AI engineer model.

## New Tool Checklist

Create the tool as a loosely coupled module.

Backend:

```text
backend/app/modules/<tool_name>/
  __init__.py
  routes.py
  service.py
  schemas.py        optional
```

Frontend:

```text
frontend/src/pages/<ToolPage>.tsx
frontend/src/services/<toolService>.ts
frontend/src/components/<tool_name>/... optional
```

Registration:

- Add backend router in `backend/main.py`.
- Add frontend navigation in `WorkspaceSidebar.tsx` and `ActivityBar.tsx`.
- Add tool rendering in `InstruMapPage.tsx`.
- Add health/readiness checks only if the tool has runtime dependencies.

Rules:

- The tool owns its UI and API.
- The tool writes shared project data only through service functions.
- Long-running work should be a worker job.
- LLM use must be optional with deterministic fallback.
- The tool must not import private UI or service internals from another tool unless that module is explicitly shared.

Minimum tests:

- Route smoke test.
- Service test for core deterministic behavior.
- Failure/fallback test.
- Export/report test if applicable.
- Readiness test if the tool has runtime dependencies.

## New AI Engineer Checklist

Add the model contract once in:

```text
backend/app/modules/ai_engineers/contracts.py
```

The contract must define:

- `role`
- `model`
- `label`
- `health_key`
- `health_role`
- `allowed_fields`

Then update only the consumers that need the new role:

- AI Grid engineering review.
- Project Intelligence.
- System Health.
- Frontend role selector.
- Model setup scripts.
- `.env.template` / `.env.example`.

Rules:

- The model can suggest only fields in its `allowed_fields`.
- The model response must be JSON.
- The model call must have timeout and fallback.
- A model failure must not block save/export/result generation.
- Model suggestions must be staged or reviewed before writing to trusted DB fields.

Minimum tests:

- Contract consistency test.
- Role field guardrail test.
- Model unavailable fallback test.
- Model exception fallback test.
- System Health includes the new model.

## New Shared DB Table Checklist

Before adding a table:

- Confirm it is shared project data, not private temporary tool state.
- Define which module owns writes.
- Define which modules can read.
- Add indexes for expected filters.
- Add migration/upgrade logic in `local_db.py`.
- Add row decoding for JSON fields if needed.
- Add tests using temporary SQLite DB.

Do not add a table just because an LLM needs context. Prefer summaries/evidence from existing tables first.

## Client Delivery Rule

Every new capability must pass:

```bash
pytest backend/tests -q
npm run build
```

Plus one manual browser smoke test on:

- Instrumentation
- Piping MTO
- AI Grid
- FlowSizing
- System Health

