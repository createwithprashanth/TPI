# Performance and Scaling Plan

XYRA Studio must feel fast on a client's internal network, even when drawings are large and engineers are running multiple tools.

## Current Performance Priorities

| Priority | Why it matters |
|---|---|
| Keep UI responsive | Engineers should never feel the app is frozen during extraction, MTO, or AI review. |
| Use worker jobs for heavy work | Large PDFs and multi-page matching can exceed normal HTTP request comfort. |
| Cache rendered/extracted drawing data | Reprocessing the same PDF wastes time. |
| Keep LLM prompts small | Local 7B models are useful, but context must be curated. |
| Keep SQLite indexed | SQLite is strong for this deployment size when queries are disciplined. |

## Backend Workflows

Recommended rule:

- Under 3 seconds: foreground API request is acceptable.
- 3 to 30 seconds: foreground is acceptable only if UI clearly shows progress.
- Over 30 seconds: use Redis/RQ worker.

Worker candidates:

- Instrumentation batch extraction.
- Multi-page MTO detection.
- MTO export generation for large packages.
- FlowSizing report package generation.
- Project-wide AI review.
- Diagnostic bundle generation.

## SQLite

SQLite is acceptable for the current one-server internal deployment.

Keep it efficient by:

- Avoiding full-table scans on large project tables.
- Keeping indexes on `project_id`, `tag_number`, `instrument_type`, `status`, `line_tag`, and `flowsizing_type`.
- Using pagination for large grids.
- Running writes in batches.
- Keeping AI memory reads aggregated.

Future SQLite upgrades:

- Add a `project_memory_snapshots` table for cached counts/gaps.
- Add `job_events` for support diagnostics.
- Add `issue_register` for review actions.
- Add DB backup/restore scripts.
- Add DB compaction/maintenance command.

When to consider PostgreSQL:

- Multiple servers.
- Many concurrent users writing heavily.
- Need for advanced permissions and audit queries.
- Need for central enterprise DB operations.

## Frontend

Immediate performance rules:

- Avoid rendering thousands of DOM rows without virtualization.
- Keep panels compact and independently scrollable.
- Do not use heavy animations on top of heavy PDF rendering.
- Use longer request timeouts only for known AI operations.
- Show status and fallback messages instead of blocking.

Future frontend work:

- Virtualized AI Grid.
- Virtualized PDF thumbnails.
- Incremental project memory refresh.
- Background query cancellation.
- Progress events for worker-backed workflows.

## LLM Performance

Local models should receive only the data they need.

Recommended pattern:

```text
Rules collect evidence rows
  |
  v
Model receives:
  - project counts
  - quality gaps
  - top evidence rows
  - allowed output fields
  - strict JSON format
```

Avoid:

- Sending all instruments in a project.
- Asking one model to solve every discipline.
- Blocking final results on optional model review.
- Rebuilding models during normal customer operation.

## Deployment Performance Checks

Before client handoff:

- Open System Health and confirm all services are live.
- Process one known instrumentation drawing.
- Run one known MTO component detection.
- Save one AI Grid edit.
- Run one FlowSizing calculation.
- Ask one Project Intelligence question.
- Confirm CPU/RAM are acceptable during the heaviest workflow.

