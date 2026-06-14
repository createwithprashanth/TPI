# XYRA Studio - System Documentation

XYRA Studio is an on-premise engineering platform for EPC and plant engineering teams working with P&ID drawings. It combines drawing review, instrument extraction, piping MTO preparation, and local LLM assistance inside one browser-based studio.

The system is designed for client internal networks. In a production deployment, engineers access only the frontend on port 80. Backend, Redis, worker, and Ollama are hidden behind Docker networks and are not exposed to the host.

## Contents

1. [Product Overview](#product-overview)
2. [Engineering Structure Pack](#engineering-structure-pack)
3. [Tools](#tools)
4. [Architecture](#architecture)
5. [Frontend Structure](#frontend-structure)
6. [Backend Structure](#backend-structure)
7. [LLM Models](#llm-models)
8. [Data and Storage](#data-and-storage)
9. [Workflows](#workflows)
10. [Deployment](#deployment)
11. [Security Surface](#security-surface)
12. [Operations and Troubleshooting](#operations-and-troubleshooting)
13. [Testing](#testing)
14. [Extension Roadmap](#extension-roadmap)
15. [Repository Notes](#repository-notes)

## Product Overview

XYRA Studio currently includes these core capability areas:

| Area | Purpose |
|---|---|
| Instrumentation | Extract instrument tags from P&IDs and generate engineering deliverables such as Instrument Index, IO List, Verification Log, and Line List. |
| Piping MTO | Detect and count piping components from P&IDs using user-created component libraries, exact computer-vision matching, size extraction, and EPC-style Excel output. |
| PrecisionPDF | Review, annotate, search, and mark up PDFs inside the same studio workspace. |
| AI Grid | Read, edit, sort, filter, and save shared engineering database records with AI-assisted discipline review. |
| FlowSizing | Prepare sizing inputs/results for process and piping handoff workflows. |
| Project Intelligence | Query shared project memory with instrumentation, process, and piping AI engineers. |
| System Health | Show the client that the local compute fabric is alive: API, worker, Redis, Ollama, and XYRA models. |

All tools share a common workspace. Uploaded drawings are available to every tool without re-uploading.

The intended business model is a monthly licensed internal-network deployment. A typical client deployment is one Windows Server or Linux server running Docker, accessed by multiple engineers through Chrome or Edge.

## Engineering Structure Pack

The following engineering guides should be used before major feature work, client deployment, or architecture cleanup:

| Guide | Purpose |
|---|---|
| `docs/XYRA_STUDIO_STRUCTURE.md` | System boundaries, loose-coupling rules, shared data ownership, and code review checklist. |
| `docs/COMPONENT_CONTRACTS.md` | What each component owns, consumes, must avoid, and can improve next. |
| `docs/PERFORMANCE_AND_SCALING.md` | Worker-job rules, SQLite scaling plan, frontend performance, and LLM context discipline. |
| `docs/CUSTOMER_DEPLOYMENT_READINESS.md` | Client install checklist, first-run validation, backup, and supportability plan. |
| `docs/FUTURE_TOOL_AND_MODEL_TEMPLATE.md` | Standard template for adding future tools, AI engineers, and shared DB tables safely. |
| `docs/TEST_STRATEGY.md` | Required test layers, AI fallback tests, UI smoke checks, and client release gates. |
| `backend/app/modules/README.md` | Backend module shape and coupling rules for future code work. |

## Tools

### Instrumentation

Instrumentation is the most developed engineering pipeline in the system. It processes uploaded P&IDs and generates structured Excel deliverables.

Main capabilities:

- Extract instrument tags from vector and scanned P&ID PDFs.
- Classify tags using ISA-style instrument knowledge.
- Detect equipment/noise/title-block fragments and lower confidence where needed.
- Map instruments to connected pipe line numbers.
- Infer instrument service using nearby line numbers, upstream/downstream context, and EPC drawing conventions.
- Generate Instrument Index, IO List, Verification Log, and Line List.
- Add review flags for uncertain extraction/classification/mapping cases.
- Use project legend/context where available.
- Run as background jobs through Redis Queue so large batches do not block the UI.

Important backend modules:

| File | Role |
|---|---|
| `backend/app/modules/instrumap/core/instrument_processor.py` | Main orchestration for instrument extraction and Excel generation. |
| `backend/app/modules/instrumap/core/level2_extraction_pymupdf.py` | Vector PDF text extraction path. |
| `backend/app/modules/instrumap/core/level2_extraction_fast.py` | OCR/scanned PDF extraction path. |
| `backend/app/modules/instrumap/core/line_extractor.py` | Pipe line number extraction. |
| `backend/app/modules/instrumap/core/line_mapper.py` | Geometry/proximity instrument-to-line mapping. |
| `backend/app/modules/instrumap/core/service_enricher.py` | Instrument service inference. |
| `backend/app/modules/instrumap/core/project_legend.py` | Project legend extraction and context support. |
| `backend/app/modules/instrumap/core/excel_writer.py` | Engineering Excel output. |

### Piping MTO

Piping MTO prepares a piping material take-off from P&IDs. The user selects a component once, saves it to the library, and runs detection across drawings.

Current capabilities:

- User-created component library stored on the backend.
- Rectangular capture with automatic outer whitespace trimming.
- Component thumbnails in the UI.
- Exact/pixel-aware matching with rotation support.
- Tolerant mode and ORB fallback for difficult drawings.
- Multi-page PDF detection.
- False-positive removal from result overlays.
- Size extraction near detected components, e.g. `2"`, `3/4"`, `4"x2"`.
- AI review using local MTO reviewer model where available.
- Graceful fallback: if AI review fails, MTO results still return.
- EPC-style Excel package including MTO, Detection Register, QA Checks, and run metadata.

Important backend modules:

| File | Role |
|---|---|
| `backend/app/modules/piping_mto/routes.py` | MTO API routes. |
| `backend/app/modules/piping_mto/service.py` | Library CRUD, detection dispatch, export package dispatch. |
| `backend/app/modules/piping_mto/excel_writer.py` | EPC-style MTO Excel package writer. |
| `backend/app/modules/piping_mto/reviewer.py` | AI review and fallback review logic. |
| `backend/app/modules/instrumap/core/piping_mto.py` | OpenCV/PyMuPDF detection engine. |
| `backend/data/symbol_library.json` | Shared component library. |

Terminology in the UI should prefer `component`, `valve`, `instrument`, or the actual item type. Avoid using `symbol` in user-facing MTO workflow labels unless referring to a drawing legend.

Library image format:

- `templateImage`: raw base64 JPEG string, no `data:image/...` prefix.
- `thumbnail`: raw base64 PNG string, no `data:image/...` prefix.
- The frontend adds the MIME prefix when rendering.

### PrecisionPDF

PrecisionPDF is the drawing review and markup tool.

Capabilities:

- PDF.js rendering.
- Page navigation.
- Zoom and pan.
- Searchable text layer.
- Freehand annotation and shape tools.
- Annotation sidebar.
- Thumbnail sidebar.
- Minimap overlay for large drawings.
- Save/download annotated PDF.
- P&ID symbol panel for review markup support.

Important frontend modules:

| File | Role |
|---|---|
| `frontend/src/pages/PrecisionPDFPage.tsx` | PrecisionPDF page wrapper. |
| `frontend/src/components/pdf/ViewerContainer.tsx` | Main PDF viewer container. |
| `frontend/src/components/pdf/Toolbar.tsx` | Viewer and annotation toolbar. |
| `frontend/src/components/pdf/AnnotationLayer.tsx` | Annotation rendering. |
| `frontend/src/components/pdf/CanvasLayer.tsx` | Drawing canvas layer. |
| `frontend/src/components/pdf/TextLayer.tsx` | Searchable/selectable PDF text layer. |
| `frontend/src/components/pdf/utils/savePdf.ts` | PDF export/save logic. |

### System Health

The System Health dashboard is a client-facing confidence screen. It should feel like the user is connected to a powerful local compute system.

It shows:

- API Core.
- State Bus / Redis.
- Worker Engine.
- Local LLM Runtime / Ollama.
- XYRA model array.
- Queue and failed job counts.
- System health percentage.
- Digital data-wave background.

Important modules:

| File | Role |
|---|---|
| `frontend/src/components/workspace/SystemHealthDashboard.tsx` | Main UI. |
| `frontend/src/components/workspace/SystemHealthDataFabric.tsx` | Data wave / compute fabric visual. |
| `backend/app/modules/telemetry.py` | Run logs for instrumentation workflows. |

## Architecture

High-level production deployment:

```text
Engineer Browser
    |
    | HTTP port 80 only
    v
nginx / React SPA
    |
    | /api proxy over Docker frontend network
    v
FastAPI Backend
    |----------------------|
    |                      |
Redis Queue            Ollama
    |                      |
RQ Worker              Local XYRA models
```

Docker services:

| Service | Role | Host exposure |
|---|---|---|
| `frontend` | nginx + built React SPA | `80:80` only |
| `backend` | FastAPI API | internal Docker network only |
| `worker` | RQ background worker | internal Docker network only |
| `redis` | Queue/state broker | internal Docker network only |
| `ollama` | Local LLM runtime | internal Docker network only |

Networks:

| Network | Members | Purpose |
|---|---|---|
| `frontend` | frontend, backend | Allows nginx to proxy API requests to backend. |
| `internal` | backend, worker, redis, ollama | Internal compute network. Marked `internal: true`. |

Design principles:

- Tools are loosely coupled. Instrumentation, Piping MTO, and PrecisionPDF should not depend on each other directly.
- Shared file/workspace state lives in frontend context.
- Backend modules own their own routes, schemas, and services.
- Long-running processing runs in background workers.
- LLM failures are non-fatal; deterministic engineering logic must still return usable results.
- Client deployments expose the smallest possible network surface.

## Frontend Structure

Main files:

| Path | Purpose |
|---|---|
| `frontend/src/App.tsx` | Application shell. |
| `frontend/src/pages/InstruMapPage.tsx` | Main studio page and tool switching. |
| `frontend/src/pages/pid/PIDAnalyserPage.tsx` | Instrumentation tool UI. |
| `frontend/src/pages/mto/PipingMTOPage.tsx` | Piping MTO tool UI. |
| `frontend/src/pages/PrecisionPDFPage.tsx` | PrecisionPDF page. |
| `frontend/src/contexts/WorkspaceContext.tsx` | Shared uploaded files, active file, preview state. |
| `frontend/src/contexts/ProjectContext.tsx` | Project metadata state. |
| `frontend/src/services/api.ts` | Axios base client. |
| `frontend/src/services/pid.ts` | Instrumentation API client. |
| `frontend/src/services/mto.ts` | MTO API client. |

Workspace components:

| Path | Purpose |
|---|---|
| `frontend/src/components/workspace/ActivityBar.tsx` | VS Code-inspired tool switcher. |
| `frontend/src/components/workspace/WorkspaceBar.tsx` | Top studio bar. |
| `frontend/src/components/workspace/FileTabs.tsx` | Uploaded file tabs. |
| `frontend/src/components/workspace/PDFViewer.tsx` | Shared preview/drop target. |
| `frontend/src/components/workspace/ProjectModal.tsx` | Project context entry. |
| `frontend/src/components/workspace/StatusBar.tsx` | Bottom status display. |

UI direction:

- Keep controls compact and VS Code-inspired.
- Prefer icon buttons for tools/actions.
- Avoid unnecessary second rows in tool headers.
- Keep MTO component library searchable and horizontally/vertically usable without hiding primary actions.
- Use direct engineering terminology: `Prepare MTO`, `Component Library`, `Valve Type`, `Detection Register`, `Review Required`.

## Backend Structure

Main files:

| Path | Purpose |
|---|---|
| `backend/main.py` | FastAPI app, routers, CORS, system endpoints. |
| `backend/worker.py` | RQ worker entry point. |
| `backend/app/config/settings.py` | Environment-driven settings. |
| `backend/app/config/redis_client.py` | Redis and queue helpers. |
| `backend/app/modules/pid_analyser/` | Instrumentation API wrapper. |
| `backend/app/modules/instrumap/` | Instrumentation processing engine. |
| `backend/app/modules/piping_mto/` | MTO API, library, exports, AI review. |
| `backend/app/modules/project_context/` | Project/scope/title-block context extraction. |
| `backend/app/modules/llm/` | Ollama client and LLM workflow helpers. |
| `backend/app/modules/telemetry.py` | Local run logging. |

API route groups:

| Prefix | Purpose |
|---|---|
| `/api/v1/pid/*` | Instrumentation/P&ID analyser jobs, preview, download. |
| `/api/v1/mto/*` | Piping MTO library, detection, review, export package. |
| `/api/v1/system/*` | Health and system monitor endpoints. |

## LLM Models

XYRA uses local Ollama models. The base model is Qwen2.5 7B, with separate Modelfiles that bake in task-specific instructions.

Expected custom models:

| Model | Purpose |
|---|---|
| `xyra-pid-engineer` | Instrument tag understanding, ISA-5.1 style reasoning, noise rejection. |
| `xyra-line-mapper` | Instrument-to-line mapping decisions. |
| `xyra-project-context` | Project/title-block/scope/cover-sheet context extraction. |
| `xyra-mto-reviewer` | MTO result review and QA suggestions. |

Model names are configurable through `.env`:

```env
XYRA_INSTRUMENT_MODEL=xyra-pid-engineer
XYRA_INSTRUMENT_MODEL_FALLBACK=qwen2.5:7b
XYRA_LINE_MAPPER_MODEL=xyra-line-mapper
XYRA_LINE_MAPPER_MODEL_FALLBACK=qwen2.5:7b
XYRA_MTO_REVIEWER_MODEL=xyra-mto-reviewer
XYRA_MTO_REVIEWER_MODEL_FALLBACK=qwen2.5:7b
```

Build models on a workstation:

```bash
ollama pull qwen2.5:7b
ollama create xyra-pid-engineer -f backend/modelfiles/xyra-pid-engineer.modelfile
ollama create xyra-line-mapper -f backend/modelfiles/xyra-line-mapper.modelfile
ollama create xyra-project-context -f backend/modelfiles/xyra-project-context.modelfile
ollama create xyra-mto-reviewer -f backend/modelfiles/xyra-mto-reviewer.modelfile
```

Windows helper:

```powershell
.\deploy\setup-model.ps1
```

Important behavior:

- Model weights are not modified by this repo.
- `ollama create` builds local model variants from Modelfiles.
- If a custom model is unavailable, the system falls back to `qwen2.5:7b` where configured.
- AI review failures should not block user results.

## Data and Storage

| Data | Location | Notes |
|---|---|---|
| Uploaded file state | Browser memory | Shared by tools during the session. |
| Instrumentation batch output | `batch_outputs/` volume | Generated ZIP/Excel outputs. |
| MTO component library | `backend/data/symbol_library.json` | Shared library across users. |
| MTO export packages | `backend/data/mto_exports/` | Generated MTO packages. |
| Project database | `backend/data/xyra_studio.db` | Offline SQLite database for project settings, instrument grid, extraction sessions, sizing placeholders, datasheet placeholders, and AI grid preferences. |
| Redis queue/state | Docker volume `redis_data` | Jobs and worker state. |
| Ollama model files | `models/` | Large local model binaries, not committed. |
| Run logs | `logs/runs/` | Local troubleshooting logs. |
| Environment | `.env` | Never commit. |
| Google Vision key | `google_credentials.json` | Never commit. |

Current storage notes:

- Instrumentation results are automatically upserted into the local project database after each successful run. The Excel/ZIP deliverables remain the primary user output; database writes are non-fatal so extraction results are not blocked by a DB issue.
- The local database mirrors the web/Supabase contract for instrument index and AI grid preferences through `/api/v1/instruments` and `/api/v1/aigrid/preferences/{datasource_id}`.
- Override the database path with `XYRA_DB_PATH` when a client deployment needs the DB on a backed-up volume.
- The MTO library is a JSON file with backend locking. This is acceptable for a single backend process.
- If using multiple backend workers/processes or needing stronger audit/history/role isolation, migrate the SQLite project database and MTO library to PostgreSQL.
- PostgreSQL is free/open-source and is the recommended future database for mini-SPI style instrument records.
- SQLite is the current offline XYRA Studio default because it is zero-install, self-contained, and easy to back up for single-server client deployments.

## Workflows

### Instrumentation Workflow

```text
Upload P&ID PDFs
    |
Preview / optional calibration
    |
Submit background job
    |
Worker extracts text/tags/lines
    |
Classify instruments
    |
Map lines and infer services
    |
Generate Excel deliverables
    |
Download ZIP
```

Expected outputs:

- Instrument Index.
- IO List.
- Verification Log.
- Line List.
- Supporting highlighted/diagnostic output where enabled.

### Piping MTO Workflow

```text
Upload P&ID PDFs
    |
Select component area on drawing
    |
System trims outer whitespace
    |
Save to Component Library
    |
Prepare MTO across drawings/pages
    |
Review detections and remove false positives
    |
AI review runs if available
    |
Export EPC-style MTO package
```

Expected outputs:

- Piping Material Take-Off.xlsx.
- Detection Register.xlsx.
- QA Checks.xlsx.
- `mto_run.json`.
- ZIP package.

### PrecisionPDF Workflow

```text
Open uploaded PDF
    |
Review pages / search text
    |
Annotate or mark up drawing
    |
Navigate via thumbnails/minimap
    |
Save annotated PDF
```

## Deployment

### Local Development

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

Worker:

```bash
cd backend
source .venv/bin/activate
python worker.py
```

Frontend:

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open:

```text
http://127.0.0.1:5173
```

### Docker / Client Deployment

```bash
cp .env.template .env
docker compose up --build
```

Open:

```text
http://localhost
```

For a client network install, set:

```env
CORS_ORIGINS=http://YOUR_SERVER_IP
ALLOW_SYSTEM_WORKER_START=false
INSTRUMAP_DEBUG=false
PDF_DPI=300
```

Only port 80 should be exposed to the client network.

### Offline Deployment

Online machine:

```powershell
.\deploy\bundle-offline.ps1
```

Client server:

```powershell
.\deploy\install-offline.ps1
```

Reference:

- `deploy/install.ps1`
- `deploy/install-offline.ps1`
- `deploy/bundle-offline.ps1`
- `deploy/docker-compose.offline.yml`
- `NEW_LAPTOP_SETUP.md`

## Security Surface

Production nginx configuration is in `frontend/nginx.conf`.

Current controls:

- Only port `80` is published.
- Backend, Redis, worker, and Ollama are not host-exposed.
- nginx proxies `/api/*` to backend internally.
- `server_tokens off`.
- Security headers:
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `X-XSS-Protection`
  - `Referrer-Policy`
  - `Permissions-Policy`
  - `Content-Security-Policy`
- API rate limiting:
  - General API: 60 requests/minute per IP.
  - Heavy upload/detection endpoints: 10 requests/minute per IP.
- Dotfiles are denied.
- `/api/v1/system/worker/start` is blocked at nginx in client builds.
- Backend has `ALLOW_SYSTEM_WORKER_START=false` as defense in depth.
- CORS is environment-configured and warns if production uses localhost defaults.

Recommended future controls:

- Active Directory / LDAP login for client user identity.
- Role separation: viewer, engineer, admin.
- Audit log for library changes and exports.
- HTTPS/TLS termination at IIS, nginx, or client reverse proxy.
- Per-project data retention policy.

## Operations and Troubleshooting

### Health Checks

Docker:

```bash
docker compose ps
docker compose logs -f frontend
docker compose logs -f backend
docker compose logs -f worker
docker compose logs -f ollama
docker compose logs -f redis
```

Local services:

```bash
curl http://127.0.0.1:8000/api/v1/system/health
curl http://127.0.0.1:8000/api/v1/mto/library
redis-cli ping
curl http://127.0.0.1:11434/api/tags
```

Frontend:

```bash
cd frontend
npm run build
```

Backend tests:

```bash
cd backend
pytest
```

### Common Issues

| Symptom | Likely cause | Action |
|---|---|---|
| System Health shows model down | Ollama not running or custom model not built | Run `ollama list`, rebuild models with `deploy/setup-model.ps1`. |
| Instrumentation job stuck queued | Worker not running | Start `python worker.py` or check `docker compose logs worker`. |
| MTO AI review 500 | Ollama/model issue | Results should still be returned without AI review; check `xyra-mto-reviewer`. |
| Component thumbnails broken | Library image saved with wrong prefix | `symbol_library.json` must store raw base64 only. |
| Backend CORS error | `.env` CORS not set to actual URL | Set `CORS_ORIGINS=http://SERVER_IP` and restart backend. |
| Slow scanned P&ID processing | OCR and LLM are CPU/GPU heavy | Use GPU for Ollama, reduce batch size, monitor worker logs. |
| Docker client install cannot reach app | Firewall or port mapping | Confirm only `80:80` is exposed and Windows firewall allows inbound 80. |

### Logs

Instrumentation run logs:

```text
logs/runs/
```

Generated outputs:

```text
batch_outputs/
backend/data/mto_exports/
```

Application logs:

- Local dev: terminal running backend/worker/frontend.
- Docker: `docker compose logs`.

Support principle: the system should produce enough local evidence for a one-person support operation. Prefer clear logs, downloadable run metadata, and non-fatal fallbacks over silent failure.

## Instrument-to-Line Association

XYRA Studio includes a geometric line-association engine for instrumentation extraction. It is designed as an evidence system, not a blind nearest-text guess.

Pipeline:

1. Extract pipe line number text using the existing line-number OCR parser.
2. Extract straight vector pipe segments from PyMuPDF drawings, including CAD hairline rectangles.
3. Build a pipe graph by snapping segment endpoints.
4. For each physical instrument, detect pipe/stub segments touching or crossing the instrument boundary.
5. Walk the pipe graph from the stub and rank nearby line-number labels.
6. Fall back to axis-aligned text proximity only when graph evidence is unavailable.
7. Propagate line candidates within the same loop instance when a directly mapped loop mate exists.
8. Store the final line plus auditable evidence in SQLite and AI Grid.

Stored fields:

| Field | Meaning |
|---|---|
| `line_tag` | Final selected connected line/equipment tag shown to the engineer. |
| `line_confidence` | Confidence score from 0.0 to 1.0. |
| `line_association_method` | Evidence method such as `pipe_graph`, `axis_aligned_text`, or `loop_propagation`. |
| `line_association_reason` | Human-readable explanation for support/review. |
| `line_candidates` | Ranked JSON candidates preserved for future AI review and teaching. |

Confidence intent:

- `pipe_graph`: strongest evidence because the instrument is physically connected to a traced pipe network.
- `loop_propagation`: medium evidence inherited from a loop mate already connected to a line.
- `axis_aligned_text`: fallback evidence, useful but normally reviewable in dense drawings.

Known limits:

- Scanned or raster-only PDFs may not expose vector pipe segments, so the engine falls back to text geometry.
- Continuation bubbles, off-page connectors, and dense crossings still require review if graph evidence is ambiguous.
- This is not yet a full process network simulator. It produces line candidates and confidence that can evolve into a full pipe graph/line map module.

## Testing

Current test areas:

| Test file | Purpose |
|---|---|
| `backend/tests/test_piping_mto.py` | MTO detection logic. |
| `backend/tests/test_piping_mto_export.py` | MTO export package. |
| `backend/tests/test_line_extractor.py` | Pipe line number extraction. |
| `backend/tests/test_line_mapper_evidence.py` | Pipe graph / line association evidence ranking. |
| `backend/tests/test_llm_line_mapper.py` | LLM line mapping behavior. |
| `backend/tests/test_llm_service.py` | LLM service/fallback behavior. |
| `backend/tests/test_project_context.py` | Project context extraction. |
| `backend/tests/test_telemetry.py` | Run logging. |
| `backend/tests/benchmarks/run_benchmark.py` | Benchmark runner for model/pipeline changes. |

Recommended before client handoff:

```bash
cd frontend && npm run build
cd ../backend && pytest
docker compose build frontend backend
docker compose run --rm frontend nginx -t
```

Recommended real-drawing smoke tests:

- Instrumentation batch on known P&IDs.
- MTO detection with at least one vertical and one horizontal valve/component.
- MTO size extraction near detected components.
- Export package open-check in Excel.
- System Health screen with all expected models visible.

## Extension Roadmap

Near-term engineering improvements:

- MTO component selection with better shape-assisted capture while keeping automatic outside whitespace trim.
- MTO per-project libraries.
- MTO material description mapping from project valve/material class tables.
- Project cover sheet and project context workflow.
- More structured logs and support bundle download.
- PostgreSQL migration option for larger multi-user deployments that outgrow the embedded SQLite project database.

Client/business improvements:

- Active Directory / LDAP login.
- Roles and permissions.
- Audit trail.
- Deployment health checker and repair script.
- One-click backup/restore for project data.
- License activation and expiry controls for monthly subscription.

Longer-term AI improvements:

- Local OCR alternative for fully offline sites.
- Retrieval over structured instrument/MTO database for engineer questions.
- Confirmed-result benchmark sets per client.
- Customer-specific model adapters once enough verified examples exist.

## Repository Notes

Files that are intentionally local and should not be committed:

- `.env`
- `google_credentials.json`
- Ollama model binaries under `models/`
- Temporary batch outputs
- Customer drawings
- Local logs unless explicitly needed for a test fixture

When moving to another laptop, use:

```text
NEW_LAPTOP_SETUP.md
```

Git pull transfers source code, Modelfiles, UI, deployment scripts, and committed library/test data. It does not transfer local `.env`, model binaries, credentials, or uncommitted work.
