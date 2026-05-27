# XYRA Studio — Technical Documentation

---

## Table of Contents

1. [Overview](#overview)
2. [Tools](#tools)
3. [Architecture](#architecture)
4. [Tech Stack](#tech-stack)
5. [Module Reference](#module-reference)
6. [Data Flow](#data-flow)
7. [Deployment](#deployment)
8. [Future Expansion](#future-expansion)

---

## Overview

XYRA Studio is an internal web application for process engineers working with Piping and Instrumentation Diagrams (P&IDs). It runs on a customer's internal server and is accessed through a browser by multiple users simultaneously.

The platform currently has three tools, each operating on uploaded PDF drawings:

| Tool | Purpose |
|---|---|
| **Instrumentation** | Extracts instrument tags from P&ID drawings and generates engineering Excel reports |
| **Piping MTO** | Counts piping symbols (valves, fittings, etc.) across drawings using template matching |
| **PrecisionPDF** | Full-featured PDF viewer and annotation editor for reviewing drawings |

All tools share a common workspace shell: a single file upload, a file navigator for multi-drawing sets, and per-drawing page navigation. The user opens a set of P&ID PDF files once and switches between tools without re-uploading.

**Repository:** [XYRA-AI-ENGINEERING/XYRA_Studio](https://github.com/XYRA-AI-ENGINEERING/XYRA_Studio) (previously `MTO_OCR`)
**Frontend package name:** `xyra-studio-frontend`

---

## Tools

### 1. Instrumentation

Automatically identifies and extracts instrument tags from P&ID drawings using OCR and a multi-stage processing pipeline.

**Workflow:**
1. User uploads one or more P&ID PDFs and sets an area code
2. An anchor/calibration point is optionally set on the drawing for scale reference
3. Processing is submitted as a background job (non-blocking)
4. Frontend polls job status — progress stages are shown in real time
5. On completion, user downloads a ZIP containing:
   - Engineering Excel report (instrument list with tag numbers, descriptions, loop context)
   - Highlighted drawing image showing detected instruments

**Processing pipeline (runs in RQ worker):**
```
Level 1 — Calibration
  ↓  Detects scale markers and anchor coordinates
Level 2 — Extraction
  ↓  Google Cloud Vision OCR reads all text from the rendered page
     Instrument tags matched by pattern (e.g. FT-101, LIC-203A)
Level 3 — Classification
  ↓  Tags grouped by instrument type, loop, area
     Standard library applied for descriptions
     Tag format validation
Excel + ZIP output
```

**Key behaviours:**
- Multiple files submitted in a single batch share a batch ID
- Jobs survive server restarts (persisted in Redis)
- Output stored under `batch_outputs/{batch_id}/` on the server

---

### 2. Piping MTO (Material Take-Off)

Counts occurrences of a piping symbol across one or more P&ID drawings using OpenCV template matching. Used to build a bill of materials for valves, fittings, instruments, and other components.

**Workflow:**
1. User draws a rubber-band box around one instance of a symbol on the preview image
2. Labels the symbol (e.g. "Ball Valve 2-inch")
3. Multiple symbols can be queued before running
4. Detection runs concurrently across all uploaded drawings and all pages
5. Results are shown as coloured bounding boxes overlaid on the drawing
6. Individual false-positive matches can be removed by clicking in edit mode
7. Sessions (symbol + results) persist within the workspace until cleared

**Detection algorithm:**
- PDF rendered at 300 DPI → OpenCV `TM_CCOEFF_NORMED` template matching
- Raw candidates capped at 2,000 before NMS to prevent O(n²) blowup on sparse edge images
- Non-maximum suppression (IoU threshold) removes duplicate hits
- ORB keypoint fallback for low-contrast templates
- Fine rotation support for rotated symbol variants
- Concurrency: up to `cpu_count - 1` simultaneous detection threads

**Symbol Library:**
- Symbols can be saved to a persistent server-side library (JSON file)
- Library is shared across all users (org-wide symbol set)
- Saved symbols can be re-used across sessions without re-drawing
- Read-modify-write operations are protected by a threading lock

**Exports:**
| Format | Contents |
|---|---|
| Excel (.xlsx) | Symbol name, thumbnail image, per-drawing count, total |
| CSV | Symbol name, drawing, count |
| PDF report | Summary table + annotated drawing pages |
| Annotated JPG | Drawing with coloured bounding boxes and legend |

---

### 3. PrecisionPDF

A full-featured PDF viewer and markup editor for reviewing and annotating P&ID drawings before or after analysis.

**Features:**
- Page-by-page rendering via PDF.js
- Text layer (selectable, searchable text)
- Canvas annotation layer (freehand draw, shapes)
- Annotation sidebar (list and navigate annotations)
- Thumbnail sidebar for page navigation
- Minimap overlay for spatial orientation in large drawings
- Full-text search with highlight
- Toolbar (zoom, pan, page controls, annotation tools, colour picker)

**Lazy loaded** — the PrecisionPDF bundle (~1 MB) is only fetched from the server when a user first navigates to this tab, keeping initial load fast.

---

## Architecture

```
Browser
  │
  └── React SPA (Vite, served by nginx)
        │
        ├── /api/v1/pid/*  ──────────────────────────────────┐
        │                                                     │
        └── /api/v1/mto/*  ──────────────────────────────────┤
                                                              │
                                              FastAPI (Uvicorn)
                                                    │
                                    ┌───────────────┼───────────────┐
                                    │               │               │
                           instrumentation  piping_mto     (future modules)
                             routes/service   routes/service
                                    │               │
                                    │         OpenCV detection
                                    │         Symbol library (JSON)
                                    │
                              Redis Queue
                                    │
                              RQ Worker process
                                    │
                          InstrumentProcessor
                          (OCR → classify → Excel)
                                    │
                          batch_outputs/{batch_id}/
                          (Excel + ZIP stored on disk)
```

**Key architectural decisions:**

- **Per-product modules** — each tool is a self-contained module with its own `routes.py`, `service.py`, and `schemas.py`. Adding a new tool means adding a new module directory and registering its router in `main.py`.

- **Thin routes, fat services** — route handlers only parse and validate; all logic lives in the service layer. This makes testing and future refactoring clean.

- **Async API, sync CPU work** — FastAPI handlers are `async def`. CPU-bound work (OpenCV, pdf2image) is offloaded to `ThreadPoolExecutor` via `run_in_executor` so the event loop is never blocked.

- **RQ for long jobs** — Instrumentation analysis (OCR + Excel generation) can take 30–120 seconds per drawing. It runs in a separate worker process so the API stays responsive. Frontend polls `GET /api/v1/pid/job/{job_id}`.

- **Shared workspace context** — the React `WorkspaceContext` owns file state and PDF preview. All three tools read from it; none owns the files independently. This makes switching tools without re-uploading natural.

---

## Tech Stack

### Frontend

| Layer | Technology | Version |
|---|---|---|
| Framework | React | 19 |
| Language | TypeScript | 5.2 |
| Build tool | Vite | 6.3 |
| Styling | Tailwind CSS | 3.4 |
| HTTP client | Axios | 1.13 |
| Animations | Framer Motion | 12 |
| PDF rendering | PDF.js (pdfjs-dist) | 5.7 |
| PDF manipulation | pdf-lib | 1.17 |
| Excel export | ExcelJS | 4.4 |
| PDF export | jsPDF | 4.2 |
| Icons | Lucide React | 0.523 |

### Backend

| Layer | Technology | Version |
|---|---|---|
| Framework | FastAPI | 0.118 |
| Server | Uvicorn | 0.37 |
| Language | Python | 3.11 |
| Validation | Pydantic v2 | 2.12 |
| Config | pydantic-settings | 2.7 |
| Computer vision | OpenCV | 4.12 |
| Numerical | NumPy | 2.2 |
| PDF → image | pdf2image + poppler | 1.17 |
| PDF parsing | PyMuPDF (fitz) | 1.24 |
| OCR | Google Cloud Vision | 3.11 |
| Data processing | pandas | 2.3 |
| Excel output | openpyxl / XlsxWriter | 3.1 / 3.2 |
| Job queue | RQ | 2.1 |
| Queue broker | Redis | 5.0 |

### Infrastructure

| Component | Technology |
|---|---|
| Reverse proxy | nginx (recommended) |
| Process manager | systemd or Docker Compose |
| Credentials | Environment variables via `.env` |
| Symbol storage | JSON file (thread-safe lock) |
| Job output storage | Local filesystem (`batch_outputs/`) |

---

## Module Reference

### Backend

```
backend/
├── main.py                          Entry point — registers routers, CORS, lifespan
├── app/
│   ├── config/
│   │   ├── settings.py              Unified env-driven config (BaseSettings)
│   │   └── redis_client.py          Redis connection + queue helpers
│   ├── modules/
│   │   ├── pid_analyser/            P&ID Analyser product
│   │   │   ├── routes.py            API endpoints: /preview, /process, /job/{id}, /download
│   │   │   ├── service.py           Orchestration: preview gen, job enqueue, status, download
│   │   │   └── schemas.py           Pydantic models: PreviewResponse, JobStatusResponse, …
│   │   ├── piping_mto/              Piping MTO product
│   │   │   ├── routes.py            API endpoints: /library CRUD, /detect, /detect-all-pages, /detect-from-library
│   │   │   ├── service.py           Detection dispatch, symbol library CRUD (locked)
│   │   │   └── schemas.py           Pydantic models: AllPagesDetectResponse, CreateSymbolRequest, …
│   │   └── instrumap/               Core processing engine (shared)
│   │       └── core/
│   │           ├── instrument_processor.py   Main OCR + extraction orchestrator
│   │           ├── level1_calibration.py     Scale detection
│   │           ├── level2_extraction.py      Google Vision OCR + tag matching
│   │           ├── level3_classification.py  Instrument classification
│   │           ├── piping_mto.py             Template matching + NMS engine
│   │           ├── excel_writer.py           Engineering Excel generation
│   │           ├── standard_library.py       Instrument description library
│   │           ├── tag_validator.py          Tag format validation
│   │           └── config.py                 Module-level constants
│   └── workers/
│       └── instrumap_tasks.py       RQ background job: full P&ID analysis pipeline
└── data/
    └── symbol_library.json          Persistent symbol library
```

### Frontend

```
frontend/src/
├── pages/
│   ├── InstruMapPage.tsx            Workspace shell — layout, file input, view routing
│   ├── pid/
│   │   └── PIDAnalyserPage.tsx      Instrumentation UI — calibration, job polling, results
│   ├── mto/
│   │   ├── PipingMTOPage.tsx        Piping MTO UI — rubber-band draw, results panel, exports
│   │   └── hooks/
│   │       ├── useMtoSessions.ts    Session state — staged templates, results, drag state
│   │       ├── useMtoDetection.ts   Detection runner — concurrency, progress, cancel
│   │       └── useMtoExports.ts     Export functions — CSV, Excel, PDF, annotated image
│   └── PrecisionPDFPage.tsx         PrecisionPDF wrapper (lazy loaded)
├── services/
│   ├── api.ts                       Axios base instance (VITE_API_URL)
│   ├── pid.ts                       P&ID Analyser API calls
│   └── mto.ts                       Piping MTO API calls + library CRUD
├── contexts/
│   ├── WorkspaceContext.tsx         Shared file state, preview generation, zoom
│   └── ProjectContext.tsx           Project metadata (name, number, client, …)
└── components/
    ├── workspace/
    │   ├── WorkspaceSidebar.tsx     Tool navigation sidebar
    │   ├── PDFViewer.tsx            Shared PDF image display with overlay slot
    │   ├── FileNavigator.tsx        Multi-file / multi-page tab bar
    │   └── StatusBar.tsx            Bottom status line
    └── pdf/                         PrecisionPDF rendering engine
        ├── ViewerContainer.tsx
        ├── PdfRenderer.tsx
        ├── CanvasLayer.tsx
        ├── TextLayer.tsx
        ├── AnnotationLayer.tsx
        ├── Toolbar.tsx
        ├── ThumbnailSidebar.tsx
        ├── AnnotationSidebar.tsx
        ├── SearchHighlightLayer.tsx
        ├── MiniMapOverlay.tsx
        └── context/PdfContext.tsx
```

---

## Data Flow

### Instrumentation — Job lifecycle

```
POST /api/v1/pid/preview        ← PDF bytes
  → pdf2image (first page)
  ← base64 JPEG preview + page count

POST /api/v1/pid/process        ← PDF bytes + calibration + project metadata
  → RQ enqueue(process_pid_task, job_id)
  ← { job_id, batch_id, status: "queued" }

GET  /api/v1/pid/job/{job_id}   ← poll every 3s
  ← { status, progress: { stage, message, eta } }
  ← when finished: { result, download_ready: true, download_endpoint }

GET  /api/v1/pid/download/{batch_id}
  ← ZIP blob (Excel + highlighted image)
```

### Piping MTO — Detection lifecycle

```
POST /api/v1/mto/detect-all-pages    ← PDF bytes + template box coords
  → render PDF at 300 DPI
  → TM_CCOEFF_NORMED matching per page
  → NMS
  ← { total_count, pages: [{ page, count, matches }], image_width, image_height }

POST /api/v1/mto/detect-from-library ← PDF bytes + template image bytes
  → same pipeline, template supplied as image
  ← same response shape

GET  /api/v1/mto/library             ← symbol library (JSON)
POST /api/v1/mto/library             ← CreateSymbolRequest → saved + 422 on bad input
PUT  /api/v1/mto/library/{id}        ← UpdateSymbolRequest → partial update
DELETE /api/v1/mto/library/{id}      ← removes entry
```

---

## Deployment

### Minimum requirements

| Component | Minimum | Recommended |
|---|---|---|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16 GB |
| Disk | 10 GB | 50 GB (batch outputs accumulate) |
| OS | Ubuntu 22.04 / RHEL 8 | Same |
| Python | 3.11 | 3.11 |
| Node | 18 | 20 |
| Redis | 6 | 7 |
| Poppler | Any | Latest |

### Environment variables (`.env`)

```env
ENV=production
REDIS_URL=redis://localhost:6379
PDF_DPI=300
POPPLER_PATH=/usr/bin           # leave empty if on PATH
GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json
INSTRUMAP_DEBUG=false
```

### Process layout

```
nginx                   → serves built frontend (dist/) on port 80/443
                        → proxies /api/* to uvicorn on port 8000

uvicorn main:app        → FastAPI, --workers 4 (or gunicorn -w 4 -k uvicorn.workers.UvicornWorker)

rq worker               → 2–4 processes for P&ID analysis jobs
                          rq worker --with-scheduler -c rq_settings

redis-server            → job queue broker
```

### nginx config (minimal)

```nginx
client_max_body_size 200m;   # P&ID PDFs can be large

location / {
    root /path/to/frontend/dist;
    try_files $uri $uri/ /index.html;
}

location /api/ {
    proxy_pass http://127.0.0.1:8000;
    proxy_read_timeout 600s;   # detect-all-pages can be slow on large PDFs
    proxy_send_timeout 600s;
}
```

### Scaling notes

- **Symbol library** is currently a single JSON file with a threading lock — safe for multiple threads within one process. If you run multiple uvicorn worker processes (`--workers N`), migrate the library to SQLite (WAL mode) for cross-process safety.
- **Detection concurrency** scales automatically with `cpu_count - 1` threads per process.
- **Batch outputs** accumulate on disk — add a cron job to purge outputs older than 30 days if disk space is a concern.

---

## Future Expansion

The architecture is designed for new tools to be added as independent modules. Adding a tool means:
1. Create `backend/app/modules/{tool_name}/` with `routes.py`, `service.py`, `schemas.py`
2. Register its router in `main.py`
3. Create `frontend/src/pages/{tool}/` with a page component and hooks
4. Add a `services/{tool}.ts` for API calls
5. Add a nav item in `WorkspaceSidebar.tsx` (nav labels live in the `NAV_ITEMS` registry at the top of that file)

### Planned

| Item | Notes |
|---|---|
| **Active Directory / SSO authentication** | Replace open access with AD-backed login; CORS origins will be locked to specific internal hostnames at the same time |
| **Remove git auto-commit from symbol library saves** | Currently spawns a subprocess thread on every save; to be replaced with scheduled backups |

### Candidate features

| Feature | Description |
|---|---|
| **Revision diff** | Compare two versions of the same P&ID — highlight added, removed, and changed instruments. Core is in `revision_diff.py` but not yet surfaced in the UI. |
| **Line tracing** | Follow a pipe run across a drawing and extract line numbers, service, and connected equipment |
| **Per-project symbol libraries** | Org-wide library works for most teams; project-scoped libraries would let different plant areas have separate valve sets |
| **SQLite symbol library** | Drop-in upgrade from JSON for multi-process deployments; no external dependency |
| **Batch export across projects** | Export a combined MTO Excel across multiple sessions and drawings in one action |
| **Audit log** | Record who added/modified/deleted library symbols and when |
| **REST API for integrations** | Expose P&ID Analyser results via a documented API so plant management systems (SAP, CMMS) can pull instrument data directly |
| **Docker Compose deployment** | `docker-compose up` to start nginx, FastAPI, worker, and Redis as a single unit — simplifies customer onboarding |
