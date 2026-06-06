# XYRA Studio Structure Guide

This guide defines how XYRA Studio should stay loosely coupled, performant, and customer deployable as more engineering tools and AI models are added.

## Core Principle

XYRA Studio is one product, but every engineering capability should behave like a separate tool plugged into a shared studio shell.

Each tool should own:

- Its user workflow.
- Its backend route module.
- Its deterministic engineering logic.
- Its exports and reports.
- Its tests.

Each tool may consume:

- Shared project context.
- Shared uploaded files.
- Shared SQLite project database.
- Shared LLM service.
- Shared system health telemetry.

Each tool should avoid:

- Importing another tool's UI internals.
- Writing directly to another tool's private state.
- Depending on an LLM response to complete a critical workflow.
- Making long-running work run inside a foreground HTTP request when a worker job is more appropriate.

## Target Shape

```text
Frontend Studio Shell
  |
  |-- Workspace Context
  |-- Project Context
  |-- Tool Pages
      |-- Instrumentation
      |-- Piping MTO
      |-- PrecisionPDF
      |-- AI Grid
      |-- FlowSizing
      |-- System Health

Backend FastAPI
  |
  |-- Tool Modules
      |-- instrumap
      |-- piping_mto
      |-- precision/pdf support where needed
      |-- instruments
      |-- flowsizing
      |-- engineering_team
      |-- project_intelligence
  |
  |-- Shared Infrastructure
      |-- local_db SQLite
      |-- redis queue
      |-- worker
      |-- llm service
      |-- telemetry
```

## Shared Data Boundary

The SQLite database is the shared engineering memory. It should not belong to Instrumentation, AI Grid, or FlowSizing alone.

Current shared DB areas:

| Area | Owner | Consumers |
|---|---|---|
| `projects` | Project setup / context | All tools |
| `documents` | Drawing/document registration | Instrumentation, PrecisionPDF, future reports |
| `extraction_sessions` | Background extraction workflows | System Health, Project Intelligence |
| `instruments` | Instrument data grid | Instrumap, AI Grid, FlowSizing, AI engineers |
| `process_data` | Process engineering inputs | FlowSizing, Process Engineer |
| `sizing_results` | FlowSizing outputs | AI Grid, reports, Piping/Process Engineer |
| `instrument_field_history` | Audit and corrections | Support, QA, future revision workflows |

Rules:

- Tool outputs can write to shared tables only through service functions.
- Reads can be broad; writes must be deliberate.
- AI suggestions must be staged or reviewable before overwriting trusted manual data.
- Project Intelligence should remain read-first unless a specific workflow asks it to apply changes.

## API Boundary

Backend modules should follow this shape:

```text
backend/app/modules/<tool>/
  routes.py      FastAPI boundary, request/response models
  service.py     business logic and persistence
  schemas.py     optional shared pydantic models
  tests          covered from backend/tests
```

Current exceptions are acceptable where legacy logic exists, but new work should move toward this shape.

## LLM Boundary

XYRA models are engineering assistants, not single points of failure.

Every LLM-backed workflow should have:

- A deterministic baseline.
- Model availability check.
- Timeout.
- Fallback result.
- Clear `model_status` returned to UI.
- Prompt scoped to the role and task.
- Guardrails that restrict which fields the model may suggest.

Recommended role split:

| Model | Responsibility |
|---|---|
| `xyra-pid-engineer` | Extract/classify instrument tags from P&ID text/context. |
| `xyra-line-mapper` | Map instruments to line numbers. |
| `xyra-project-context` | Read title blocks, legends, project scope, standards. |
| `xyra-mto-reviewer` | Review MTO detections and EPC report readiness. |
| `xyra-instrumentation-engineer` | IO, signal, category, review status, instrumentation data quality. |
| `xyra-process-engineer` | Service text, process context, process data readiness. |
| `xyra-piping-engineer` | Line tags, inline components, MTO/FlowSizing handoff. |

Future AI engineers should be added only when they have a distinct engineering responsibility.

The shared role/model contract lives in:

```text
backend/app/modules/ai_engineers/contracts.py
```

When adding a new discipline engineer, update that contract first. Consumers such as Engineering Team, Project Intelligence, and System Health should read from the contract rather than duplicating model names or allowed fields.

## Frontend Boundary

The frontend shell should stay stable while tool pages evolve.

Shared frontend pieces:

- `WorkspaceContext`: uploaded files, active file, preview state.
- `ProjectContext`: project metadata.
- `services/api.ts`: base HTTP client.
- Tool service files: one service file per backend module.
- Activity bar/sidebar: navigation only.

Tool pages should not become mega-pages forever. When a page grows, split by workflow:

```text
PipingMTOPage
  ComponentLibraryPanel
  DrawingPreviewPanel
  DetectionResultsPanel
  MTOReportPanel
```

Same pattern applies to AI Grid and FlowSizing.

## Performance Principles

1. Keep the browser responsive.
   Long PDF or image operations should show progress and avoid blocking the main interaction path.

2. Move heavy backend work to worker jobs.
   Batch extraction, multi-page MTO detection, and large report generation should run through Redis/RQ.

3. Cache project memory.
   Project Intelligence can compute summaries quickly today, but large client DBs should use cached summary snapshots later.

4. Limit model context.
   Send evidence rows and aggregated memory, not the full database.

5. Index shared tables.
   Any frequent filter or join must have a SQLite index before large client deployment.

6. Prefer incremental update.
   Saving one edited grid row should not reload or recompute the entire engineering system unless necessary.

## Customer Deployment Principles

Customer installs should feel boring and repeatable.

Deployment requirements:

- Expose only port `80`.
- Keep backend, Redis, worker, and Ollama internal.
- Use `.env.template` for site-specific settings.
- Run `deploy/setup-model.ps1` or equivalent before first use.
- Run a health check after install.
- Keep logs and DB backup paths known.
- Avoid internet dependency after deployment.

Minimum handoff checks:

- Frontend opens.
- Backend `/health` works through nginx.
- System Health shows API, Redis, worker, Ollama, and models.
- Instrumentation can process one sample drawing.
- Piping MTO can detect a known component.
- AI Grid can read/write SQLite.
- FlowSizing can save a result.

## Code Review Checklist

Use this checklist before adding a new feature:

- Does this feature belong to an existing tool or a new module?
- Does it write shared DB data only through a service function?
- Does it have deterministic behavior when the LLM is down?
- Can it run on an internal network without internet?
- Is the slow path a worker job?
- Is the UI compact enough for engineering use?
- Are failures visible in System Health or logs?
- Are tests focused on the new contract?

Reference guides:

- `docs/FUTURE_TOOL_AND_MODEL_TEMPLATE.md`
- `docs/TEST_STRATEGY.md`
