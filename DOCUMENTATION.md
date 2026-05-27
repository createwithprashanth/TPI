# XYRA Studio — Technical Documentation

---

## Table of Contents

1. [Overview](#overview)
2. [Tools](#tools)
3. [Architecture](#architecture)
4. [LLM Integration](#llm-integration)
5. [Tech Stack](#tech-stack)
6. [Module Reference](#module-reference)
7. [Data Flow](#data-flow)
8. [Deployment](#deployment)
9. [Customer Deployment — Windows Server](#customer-deployment--windows-server)
10. [Future Expansion](#future-expansion)

---

## Overview

XYRA Studio is an internal web application for process engineers working with Piping and Instrumentation Diagrams (P&IDs). It runs on a customer's internal server and is accessed through a browser by multiple engineers simultaneously.

All processing happens on-premise — no drawings, instrument data, or analysis results are sent to external services (except Google Cloud Vision for OCR, which is configurable).

**Repository:** [XYRA-AI-ENGINEERING/XYRA_Studio](https://github.com/XYRA-AI-ENGINEERING/XYRA_Studio)  
**Frontend package:** `xyra-studio-frontend`

The platform has three tools, each operating on uploaded PDF drawings. All tools share a single workspace: files are uploaded once and all tools read from the shared file state.

| Tool | Purpose |
|---|---|
| **Instrumentation** | Extracts instrument tags, maps them to pipe lines, generates engineering Excel reports |
| **Piping MTO** | Counts piping symbols (valves, fittings) across drawings using template matching |
| **PrecisionPDF** | Full-featured PDF viewer and annotation editor |

---

## Tools

### 1. Instrumentation

Automatically identifies and extracts instrument tags from P&ID drawings using a four-level processing pipeline.

**Workflow:**
1. User uploads one or more P&ID PDFs and optionally sets an area code
2. An anchor/calibration circle is optionally identified on the drawing for scale reference
3. Processing is submitted as a background job (non-blocking)
4. Frontend polls job status — live progress messages shown for each stage
5. On completion, user downloads a ZIP containing four Excel workbooks

**Processing pipeline:**

```
Level 1 — Calibration
  Detects instrument circle radius from an anchor point
  Establishes pixel-to-drawing-unit scale

Level 2 — Extraction  [two paths depending on PDF type]

  PATH A — Vector PDF (PyMuPDF)                PATH B — Scanned PDF (OCR)
  ─────────────────────────────────            ─────────────────────────────
  PDF vector text extracted directly           pdf2image renders pages at 300 DPI
  No Vision API call needed                    Google Cloud Vision reads all text
  Instrument tags parsed from text             Tags matched by regex pattern
  ↓                                            ↓
  Level 3 — Line Mapping (geometry)            Level 3 — Line Mapping (directional)
  Vector segment graph built from PDF          Axis-aligned proximity search
  BFS through connected pipe segments          Finds nearest line number label
  Finds associated line number label           within 1200px in 4 directions
  ↓                                            ↓
                                               Level 4 — LLM Line Mapping
                                               Qwen2.5 7B (via Ollama) resolves
                                               ambiguous or unmatched cases
                                               Spatial candidates + engineering
                                               context → structured JSON answer

Level 4 — Classification
  Tags grouped by loop, area, instrument type
  Standard library applied for descriptions
  Tag format validated against legend/pattern

Excel + ZIP output
  Instrument Index   — engineering-grade deliverable
  IO List            — hardwired AI/AO/DI/DO points
  Verification Log   — raw extraction with confidence flags
  Line List          — all pipe line numbers found on drawings
```

**Output columns:**
- `Connected_Line` — pipe line number the instrument is mapped to ("Line / Equip. Tag" in the Index)
- `Line_Confidence` — 0.0–1.0 score when assigned by the LLM (Verification Log only)
- `Line_Reason` — one-sentence LLM explanation for the assignment (Verification Log only)

**Key behaviours:**
- Multiple files submitted in a single batch share a batch ID
- Jobs survive server restarts (persisted in Redis)
- Output stored under `batch_outputs/{batch_id}/` on the server

---

### 2. Piping MTO (Material Take-Off)

Counts occurrences of a piping symbol across one or more P&ID drawings using OpenCV template matching.

**Workflow:**
1. User draws a rubber-band box around one instance of a symbol on the drawing preview
2. Labels the symbol (e.g. "Ball Valve 2-inch")
3. Multiple symbols can be queued before running
4. Detection runs concurrently across all uploaded drawings and all pages
5. Results shown as coloured bounding boxes overlaid on the drawing
6. Individual false-positive matches can be removed in edit mode
7. Sessions (symbol + results) persist within the workspace until cleared

**Detection algorithm:**
- PDF rendered at 300 DPI → OpenCV `TM_CCOEFF_NORMED` template matching
- Raw candidates capped at 2,000 before NMS to prevent O(n²) blowup
- Non-maximum suppression (IoU threshold) removes duplicate hits
- ORB keypoint fallback for low-contrast templates
- Rotation support for rotated symbol variants
- Concurrency: up to `cpu_count - 1` simultaneous detection threads

**Symbol Library:**
- Symbols saved to a persistent server-side JSON file (shared across all users)
- Read-modify-write operations protected by a threading lock
- Saved symbols can be reused across sessions without redrawing

**Exports:**

| Format | Contents |
|---|---|
| Excel (.xlsx) | Symbol name, thumbnail image, per-drawing count, total |
| CSV | Symbol name, drawing, count |
| PDF report | Summary table + annotated drawing pages |
| Annotated JPG | Drawing with coloured bounding boxes and legend |

---

### 3. PrecisionPDF

A full-featured PDF viewer and markup editor for reviewing and annotating P&ID drawings.

**Features:**
- Page-by-page rendering via PDF.js
- Selectable, searchable text layer
- Canvas annotation layer (freehand draw, shapes, colours)
- Annotation sidebar (list and navigate all markups)
- Thumbnail sidebar for page navigation
- Minimap overlay for spatial orientation in large drawings
- Full-text search with highlights
- Toolbar: zoom, pan, page controls, annotation tools, colour picker

**Lazy loaded** — the PrecisionPDF bundle is only fetched when the user first navigates to this tab, keeping initial load fast.

---

## Architecture

```
Browser (Chrome / Edge)
  │
  └── React SPA (Vite, served by nginx on port 80)
        │
        ├── /api/v1/pid/*  ──────────────────────────────────┐
        └── /api/v1/mto/*  ──────────────────────────────────┤
                                                              │
                                              FastAPI (Uvicorn, port 8000)
                                                    │
                                    ┌───────────────┴───────────────┐
                                    │                               │
                               instrumentation                 piping_mto
                               routes / service              routes / service
                                    │                               │
                              Redis Queue                    OpenCV detection
                                    │                        Symbol library
                              RQ Worker
                                    │
                          InstrumentProcessor
                          (extract → classify → Excel)
                                    │
                                    ├── PyMuPDF path (vector PDF)
                                    │     └── geometry line mapper
                                    │
                                    └── OCR path (scanned PDF)
                                          ├── Google Vision OCR
                                          ├── directional line mapper
                                          └── LLM line mapper ──► Ollama
                                                                    (port 11434)
                                                                  Qwen2.5 7B
```

**Key architectural decisions:**

- **Per-product modules** — each tool is a self-contained module with its own `routes.py`, `service.py`, and `schemas.py`. Adding a new tool means adding one module directory.

- **Thin routes, fat services** — route handlers only parse and validate; all logic lives in the service layer.

- **Async API, sync CPU work** — FastAPI handlers are `async def`. CPU-bound work is offloaded via `run_in_executor` so the event loop is never blocked.

- **RQ for long jobs** — Instrumentation analysis (OCR + Excel) can take 30–120 seconds per drawing. It runs in a separate RQ worker process. Frontend polls `GET /api/v1/pid/job/{job_id}`.

- **LLM is non-fatal** — if Ollama is offline or the model isn't loaded, line mapping degrades gracefully to directional fallback. No errors surface to the user.

- **Shared workspace context** — `WorkspaceContext` owns file state and PDF preview. All three tools read from it; none owns the files independently.

---

## LLM Integration

### Why

P&ID drawings come in two types. **Vector PDFs** (native CAD export) contain embedded geometry — the line mapper uses graph traversal through PDF vector segments to trace pipe runs and identify which line each instrument connects to. **Scanned/raster PDFs** (photographed or printed-then-scanned) have no vector geometry. The only fallback is axis-aligned pixel-space proximity, which fails when lines are diagonal, when instruments are at junctions, or when the nearest label belongs to a different pipe run.

Qwen2.5 7B fills this gap. Given an instrument tag, its position, and its N nearest candidate line numbers (sorted by distance), it applies engineering domain knowledge to pick the right one.

### Model

| Property | Value |
|---|---|
| Model | Qwen2.5 7B (Q4_K_M quantisation) |
| Served via | Ollama (OpenAI-compatible HTTP API) |
| Size on disk | ~4.7 GB |
| Inference speed | ~5–8 s/tag on CPU (M1) · ~0.3 s/tag on GPU (RTX 3090) |
| Output format | JSON (forced via Ollama `"format": "json"` parameter) |
| Temperature | 0.1 (near-deterministic for structured output) |

### Custom model: `xyra-pid:v1`

A custom Ollama model with a P&ID engineering system prompt baked in (`deploy/Modelfile`). Build it once after deployment:

```bash
docker exec xyra-studio-ollama-1 ollama create xyra-pid:v1 --file /tmp/Modelfile
```

The system prompt covers ISA 5.1 tag nomenclature, pipe line number formats, instrument connection rules (flow instruments on process lines, valves in-line, etc.), and common EPC drawing conventions.

### How it works

For each unmatched instrument (after geometry and directional fallback):

1. **Candidate generation** — sort all line numbers on the same page by Euclidean pixel distance, take top 8
2. **Prompt construction** — include tag number, instrument type description, pixel position, and a ranked list of candidate lines with their size, fluid code, and distance
3. **LLM call** — `POST /api/generate` to Ollama with `"format": "json"`
4. **Response parsing** — extract `{ line_number, confidence, reason }` from the JSON response
5. **Acceptance** — accepted only if `confidence >= 0.55`, otherwise the instrument remains unmatched

### Fine-tuning roadmap

| Phase | Approach | When |
|---|---|---|
| **Now** | `xyra-pid:v1` Modelfile (baked system prompt) | Ready to use |
| **Near term** | Few-shot examples in every prompt (5–10 confirmed matches from the vector path) | When you have 50+ confirmed pairs |
| **Later** | QLoRA fine-tuning on accumulated confirmed mappings — produces a 40 MB adapter | When you have 500+ confirmed pairs from real customer P&IDs |

The training data source: every time the vector path (graph traversal) confirms a mapping, that pair is a verified ground truth example. No manual labelling required.

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
| Computer vision | OpenCV | 4.12 |
| Numerical | NumPy | 2.2 |
| PDF → image | pdf2image + Poppler | 1.17 |
| PDF parsing | PyMuPDF (fitz) | 1.24 |
| OCR | Google Cloud Vision | 3.11 |
| Data processing | pandas | 2.3 |
| Excel output | openpyxl / XlsxWriter | 3.1 / 3.2 |
| Job queue | RQ | 2.1 |
| Queue broker | Redis | 5.0 |

### LLM / AI

| Component | Technology |
|---|---|
| LLM inference server | Ollama (local, no internet required after model download) |
| Model | Qwen2.5 7B Q4_K_M |
| Custom model | `xyra-pid:v1` (Modelfile with P&ID system prompt) |
| API protocol | Ollama HTTP API (OpenAI-compatible) |
| GPU acceleration | NVIDIA CUDA (optional, falls back to CPU) |

---

## Module Reference

### Backend

```
backend/
├── main.py                              Entry point — routers, CORS, lifespan
├── worker.py                            RQ worker entry point
├── app/
│   ├── config/
│   │   ├── settings.py                  Env-driven config (BaseSettings)
│   │   └── redis_client.py              Redis connection + queue helpers
│   └── modules/
│       ├── llm/                         LLM service layer
│       │   ├── service.py               Ollama HTTP client
│       │   │                            OLLAMA_HOST env var for Docker networking
│       │   │                            Forces JSON output, temperature 0.1
│       │   └── line_mapper.py           LLM-powered instrument→line mapper
│       │                                Spatial candidate ranking + prompt builder
│       │                                Confidence threshold filtering (≥ 0.55)
│       │
│       ├── instrumap/                   Instrumentation processing engine
│       │   └── core/
│       │       ├── instrument_processor.py   Main pipeline orchestrator
│       │       │                             Selects vector vs OCR path
│       │       │                             Wires LLM mapper into OCR path
│       │       ├── level1_calibration.py     Circle detection + scale reference
│       │       ├── level2_extraction.py      OCR tag extraction (standard)
│       │       ├── level2_extraction_fast.py OCR tag extraction (fast mode)
│       │       ├── level2_extraction_pymupdf.py  Vector PDF extraction (no OCR)
│       │       ├── level3_classification.py  Tag grouping + description library
│       │       ├── line_extractor.py         Pipe line number extraction (4-pass)
│       │       │                             Pass 1: single token · Pass 2: hyphen-join
│       │       │                             Pass 3: concat · Pass 4: inch-mark anchor
│       │       ├── line_mapper.py            Geometry-based line mapper (vector path)
│       │       │                             Vector segment graph → BFS → line label
│       │       │                             Directional fallback for stubs not in graph
│       │       ├── excel_writer.py           Engineering Excel output (4 workbooks)
│       │       ├── standard_library.py       ISA instrument description lookup
│       │       ├── tag_validator.py          Tag format validation
│       │       └── config.py                 Module constants
│       │
│       ├── pid_analyser/                P&ID Analyser API module
│       │   ├── routes.py                /preview · /process · /job/{id} · /download
│       │   ├── service.py               Job orchestration + status tracking
│       │   └── schemas.py               Pydantic models
│       │
│       └── piping_mto/                  Piping MTO API module
│           ├── routes.py                /library CRUD · /detect · /detect-all-pages
│           ├── service.py               Detection dispatch + symbol library (locked)
│           └── schemas.py               Pydantic models
│
└── data/
    └── symbol_library.json              Persistent symbol library
```

### Frontend

```
frontend/src/
├── pages/
│   ├── InstruMapPage.tsx            Workspace shell — layout, routing, file input
│   │                                WorkspaceBar + ActivityBar + editor area
│   ├── pid/
│   │   └── PIDAnalyserPage.tsx      Instrumentation — calibration, job polling, results
│   ├── mto/
│   │   ├── PipingMTOPage.tsx        Piping MTO — rubber-band, results, exports
│   │   └── hooks/
│   │       ├── useMtoSessions.ts    Session state — staged templates, results
│   │       ├── useMtoDetection.ts   Detection runner — concurrency, cancel
│   │       └── useMtoExports.ts     CSV, Excel, PDF, annotated image exports
│   └── PrecisionPDFPage.tsx         PrecisionPDF wrapper (lazy-loaded)
│
├── services/
│   ├── api.ts                       Axios base instance (VITE_API_URL)
│   ├── pid.ts                       P&ID Analyser API calls
│   └── mto.ts                       MTO API calls + symbol library CRUD
│
├── contexts/
│   ├── WorkspaceContext.tsx         Shared file state, preview, zoom, closeFile()
│   └── ProjectContext.tsx           Project metadata — persisted to localStorage
│
└── components/
    ├── workspace/
    │   ├── WorkspaceBar.tsx         Top-of-app bar: XYRA logo + project chip
    │   ├── ActivityBar.tsx          48px icon-only tool switcher (VS Code style)
    │   ├── FileTabs.tsx             Horizontal scrollable per-file tabs
    │   ├── Breadcrumb.tsx           XYRA Studio › Tool › Filename
    │   ├── ProjectModal.tsx         Project name/number/client/contractor modal
    │   ├── StatusBar.tsx            Bottom status line (RUNNING/DONE + message)
    │   └── PDFViewer.tsx            PDF image display + drag-and-drop empty state
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

### Instrumentation — job lifecycle

```
POST /api/v1/pid/preview        ← PDF bytes
  → pdf2image (first page render)
  ← base64 JPEG preview + page count

POST /api/v1/pid/process        ← PDF bytes + calibration + project metadata
  → RQ enqueue(process_pid_task, job_id)
  ← { job_id, batch_id, status: "queued" }

GET  /api/v1/pid/job/{job_id}   ← polled every 3 s by frontend
  ← { status, progress: { stage, message } }
  ← when finished: { result, download_ready: true, download_endpoint }

GET  /api/v1/pid/download/{batch_id}
  ← ZIP blob (4× Excel workbooks + highlighted image)
```

### Piping MTO — detection lifecycle

```
POST /api/v1/mto/detect-all-pages    ← PDF bytes + template box coords
  → render PDF at 300 DPI
  → TM_CCOEFF_NORMED per page → NMS
  ← { total_count, pages: [{ page, count, matches }] }

GET  /api/v1/mto/library             ← full symbol list
POST /api/v1/mto/library             ← save new symbol (returns ID)
PUT  /api/v1/mto/library/{id}        ← update name/thumbnail
DELETE /api/v1/mto/library/{id}      ← remove entry
```

---

## Deployment

### Docker Compose (recommended)

```bash
git clone https://github.com/XYRA-AI-ENGINEERING/XYRA_Studio
cd XYRA_Studio
cp .env.example .env          # edit as needed
docker compose up --build
```

**Services started:**

| Container | Role | Port |
|---|---|---|
| `xyra-frontend` | nginx serving built React SPA | 80 |
| `xyra-backend` | FastAPI + Uvicorn | 8000 (internal) |
| `xyra-worker` | RQ background job worker | — |
| `xyra-redis` | Redis job queue broker | 6379 (internal) |
| `xyra-ollama` | Ollama LLM inference server | 11434 (internal) |

The `models/` directory is mounted into the Ollama container as a volume. Model files persist across container restarts and never need to be re-downloaded.

On first start, Ollama automatically pulls `qwen2.5:7b` (~4.7 GB). Progress:
```bash
docker compose logs -f ollama
```

After the model is ready, build the custom `xyra-pid:v1` model with the baked-in P&ID prompt:
```bash
.\deploy\setup-model.ps1      # Windows
# or:
docker cp deploy/Modelfile xyra-studio-ollama-1:/tmp/Modelfile
docker exec xyra-studio-ollama-1 ollama create xyra-pid:v1 --file /tmp/Modelfile
```

### Environment variables (`.env`)

```env
ENV=production
REDIS_URL=redis://redis:6379
OLLAMA_HOST=http://ollama:11434    # Docker service name — don't change
PDF_DPI=300
POPPLER_PATH=                      # leave empty — poppler is in the Docker image
GOOGLE_APPLICATION_CREDENTIALS=/app/google_credentials.json
INSTRUMAP_DEBUG=false
```

### Hardware requirements

| Component | Minimum | Recommended |
|---|---|---|
| CPU | 4 cores | 8+ cores |
| RAM | 16 GB | 32 GB |
| Disk | 20 GB | 100 GB (batch outputs + model files) |
| GPU | None (CPU inference ~5–8 s/tag) | NVIDIA RTX 3090 24 GB (0.3 s/tag) |
| OS | Windows Server 2019 / Ubuntu 22.04 | Same |

### Scaling notes

- **Symbol library** is a single JSON file with a threading lock. Safe for multiple threads within one process. If you run multiple Uvicorn workers (`--workers N`), migrate to SQLite (WAL mode).
- **LLM throughput** is the bottleneck on scanned PDFs. One GPU on the Ollama server resolves ~3 instruments/second. For large batches, run the Ollama container with GPU passthrough.
- **Batch outputs** accumulate on disk. Set up a cron job or Windows Task Scheduler to purge `batch_outputs/` entries older than 30 days.

---

## Customer Deployment — Windows Server

EPCs run Windows everywhere. XYRA Studio is designed to be installed on a single Windows Server machine and accessed by engineers on the internal network via browser.

### Architecture on a customer site

```
EPC Internal Network

  Engineers (Windows 10/11, Chrome/Edge)
        │
        │  HTTP on port 80
        ▼
  Windows Server 2019/2022
  ┌─────────────────────────────────────────┐
  │  Docker Desktop                          │
  │  ├── nginx container    (port 80)        │
  │  ├── FastAPI container  (internal)       │
  │  ├── Redis container    (internal)       │
  │  ├── RQ worker          (internal)       │
  │  └── Ollama container   (internal)       │
  │       └── qwen2.5:7b  (no GPU needed)   │
  │                                          │
  │  models\        ← model files on disk   │
  │  google_credentials.json                 │
  └─────────────────────────────────────────┘
        │
     No internet required after setup
```

### Online install (server has internet access)

```powershell
# Run as Administrator
Set-ExecutionPolicy Bypass -Scope Process -Force
.\deploy\install.ps1
```

The installer checks Docker, starts all services, and prints the URL to open in a browser.

### Offline install (air-gapped site)

**Step 1** — On a machine with internet, create the bundle:
```powershell
.\deploy\bundle-offline.ps1
# Output: deploy\XYRA_Studio_offline_bundle\  (~8 GB)
```

**Step 2** — Copy the entire bundle folder to a USB drive.

**Step 3** — On the customer server:
```powershell
Set-ExecutionPolicy Bypass -Scope Process -Force
.\install-offline.ps1
```

The offline installer loads pre-saved Docker image tars and Ollama model blobs — no internet required.

### Network configuration

The only port that needs to be open on the server's firewall is **80 (HTTP)**. Engineers access `http://<server-name>` or `http://<server-ip>` from their workstations. All other ports (8000, 6379, 11434) are internal to Docker.

For HTTPS, put a reverse proxy (IIS ARR or nginx) in front of port 80 and handle TLS termination there.

---

## Future Expansion

### Adding a new tool

1. Create `backend/app/modules/{tool_name}/` with `routes.py`, `service.py`, `schemas.py`
2. Register the router in `main.py`
3. Create `frontend/src/pages/{tool}/` with a page component and hooks
4. Add `services/{tool}.ts` for API calls
5. Add an entry to the `TOOLS` array in `ActivityBar.tsx` and `TOOL_LABELS` in `InstruMapPage.tsx`

### Planned

| Item | Status | Notes |
|---|---|---|
| **LLM fine-tuning pipeline** | Planned | QLoRA training on confirmed instrument→line pairs collected from production. Produces a customer-specific model adapter (~40 MB) that learns each firm's tagging conventions. |
| **Feedback loop UI** | Planned | "Mark as correct / incorrect" buttons on the Instrumentation results table. Confirmed pairs saved to `training_data/` for future fine-tuning. |
| **Active Directory / SSO** | Planned | Replace open access with AD-backed login; CORS locked to internal hostnames. |
| **Local OCR alternative** | Planned | Replace Google Cloud Vision with PaddleOCR or Tesseract for fully offline operation — no API key required. Relevant for customers on fully air-gapped networks. |

### Candidate features

| Feature | Description |
|---|---|
| **Revision diff** | Compare two versions of a P&ID — highlight added, removed, and changed instruments. Core is in `revision_diff.py`, not yet surfaced in UI. |
| **Per-project symbol libraries** | Project-scoped symbol sets so different plant areas can have separate valve inventories. |
| **SQLite symbol library** | Drop-in upgrade from JSON for multi-process deployments. |
| **Batch export across projects** | Combined MTO Excel across multiple sessions and drawings in one action. |
| **REST API for integrations** | Expose Instrumentation results via a versioned API so SAP / CMMS systems can pull instrument data directly. |
| **Audit log** | Who added/modified/deleted library symbols and when. |
