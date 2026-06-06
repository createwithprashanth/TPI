# Customer Deployment Readiness

This is the deployment-readiness checklist for XYRA Studio on a client internal network.

## Deployment Goal

The client should access XYRA Studio through a browser at one internal URL. The server should expose only port `80`.

```text
Client Browser -> port 80 -> nginx/frontend -> backend over Docker network
```

Backend, Redis, worker, and Ollama should not be exposed directly to the client network.

## Pre-Deployment Checklist

- Confirm server has Docker installed.
- Confirm enough disk space for PDFs, outputs, models, and SQLite DB.
- Confirm `.env` is created from `.env.template`.
- Set `CORS_ORIGINS` to the actual client URL.
- Set project/license/customer identifiers where applicable.
- Run model setup script.
- Build containers.
- Run nginx syntax check.
- Start all services.

## Required Runtime Services

| Service | Required | Notes |
|---|---:|---|
| Frontend/nginx | Yes | Only public service. |
| Backend API | Yes | Internal only. |
| Redis | Yes | Queue and worker state. |
| Worker | Yes | Required for instrumentation/background jobs. |
| Ollama | Yes for AI features | App should still fail gracefully where possible. |
| SQLite DB | Yes | Local project database. |

## First-Run Validation

Run these before giving the system to the client:

1. Open frontend on the client URL.
2. Open System Health.
3. Confirm API Core is live.
4. Confirm State Bus is live.
5. Confirm Worker Engine is live.
6. Confirm LLM Runtime is live.
7. Confirm all required XYRA models are live.
8. Upload a sample P&ID.
9. Run Instrumentation extraction.
10. Confirm instruments appear in AI Grid.
11. Save one AI Grid edit.
12. Run a Project Intelligence question.
13. Run one Piping MTO detection.
14. Run one FlowSizing calculation if process data is available.

## Supportability

Because the business is operated with limited support manpower, customer deployments need self-diagnostics.

Near-term support features to add:

- Diagnostic bundle download.
- Failed job viewer.
- Log viewer.
- DB backup/export button.
- Model availability check with rebuild instructions.
- Clear worker restart instructions.
- Deployment version screen.

Suggested diagnostic bundle contents:

- App version / git commit.
- `.env` safe summary without secrets.
- Docker service status.
- Last backend logs.
- Last worker logs.
- Redis queue depth.
- Failed jobs summary.
- Ollama model list.
- SQLite DB size and table counts.

## Backup

Minimum backup target:

- `backend/data/xyra_studio.db`
- uploaded files/output folders if stored locally
- component library
- model files and setup scripts

Recommended later:

- Daily scheduled backup.
- Manual backup button in System Health.
- Restore instructions.
- DB integrity check.

## Customer Handoff Notes

The customer should receive:

- Internal URL.
- Admin/startup instructions.
- Stop/restart instructions.
- Backup instructions.
- Basic troubleshooting page.
- Known limitations.
- Support contact and escalation path.

## Known Deployment Risks

| Risk | Mitigation |
|---|---|
| Ollama model not built | Setup script and System Health model checks. |
| Worker not running | System Health worker card and failed-job count. |
| CORS misconfigured | `.env.template` requires client URL. |
| Backend exposed directly | Docker network and nginx-only host exposure. |
| Large drawings slow | Worker jobs, cached rendering/extraction. |
| DB grows without backup | Add backup mechanism before large production rollout. |

