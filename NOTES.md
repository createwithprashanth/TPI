# InstruMap White-Label — Working Notes

## What this is

A standalone, client-deployable version of InstruMap.
Copied from XYRA-BACKEND + xyra-ai frontend.

**Removed from XYRA version:**
- No Xyra branding (logo, name references)
- No authentication (Auth0 removed)
- No Supabase database or storage
- No LLM enrichment (Together AI / Llama removed)
- No Tag Register (AI Grid)
- No Extraction History view
- No project database (project details stored in localStorage only)

**Kept:**
- Full P&ID processing engine (PyMuPDF + Google Vision OCR pipeline)
- All core extraction logic (calibration, level1/2/3, line extractor)
- Excel deliverables (Instrument Index, IO List, Verification Log, Line List)
- ZIP download served directly from local disk
- Redis + RQ async job queue with progress tracking
- Same dark UI look and feel

---

## Folder Structure

```
MTO/
├── docker-compose.yml          ← deploy with: docker compose up --build
├── .env                        ← local dev env vars (not committed)
├── .env.example                ← template for client
├── google_credentials.json     ← Google Vision API key (NOT committed)
├── README.md                   ← client deployment instructions
│
├── backend/
│   ├── main.py                 ← FastAPI app entry point (no auth middleware)
│   ├── worker.py               ← RQ worker entry point
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── .venv/                  ← local Python venv (not committed)
│   └── app/
│       ├── config/
│       │   ├── settings.py     ← simplified (Redis URL + Google creds only)
│       │   └── redis_client.py
│       ├── modules/instrumap/
│       │   ├── routes.py       ← API endpoints (no auth, local file serving)
│       │   └── core/           ← copied from XYRA, unchanged
│       └── workers/
│           └── instrumap_tasks.py  ← stripped worker (no LLM, no Supabase)
│
└── frontend/
    ├── Dockerfile
    ├── nginx.conf              ← proxies /api/ to backend:8000
    ├── package.json
    └── src/
        ├── pages/InstruMapPage.tsx  ← main UI (simplified)
        └── services/instrumap.ts   ← API calls
```

---

## Running Locally (Dev)

**Prerequisites already done:**
- Redis installed via homebrew and running
- Python 3.11 venv created at `backend/.venv`
- All pip deps installed
- Frontend npm deps installed

**Start all three services:**

```bash
# Terminal 1 — Backend
cd /Users/prashanththipparthi/Desktop/MTO/backend
GOOGLE_APPLICATION_CREDENTIALS=/Users/prashanththipparthi/Desktop/xyra-ai-backend/XYRA-BACKEND/instrumap-464410-3cb4dae6350d.json \
REDIS_URL=redis://localhost:6379 \
.venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — Worker
cd /Users/prashanththipparthi/Desktop/MTO/backend
GOOGLE_APPLICATION_CREDENTIALS=/Users/prashanththipparthi/Desktop/xyra-ai-backend/XYRA-BACKEND/instrumap-464410-3cb4dae6350d.json \
REDIS_URL=redis://localhost:6379 \
.venv/bin/python worker.py

# Terminal 3 — Frontend
cd /Users/prashanththipparthi/Desktop/MTO/frontend
npm run dev
```

App opens at: http://localhost:5173
Backend API at: http://localhost:8000

**Stop everything:**
```bash
pkill -f "uvicorn main:app"
pkill -f "worker.py"
pkill -f "vite"
brew services stop redis
```

---

## Deploy to Client (Docker)

1. Place `google_credentials.json` in MTO/ root
2. `cp .env.example .env`
3. `docker compose up --build`
4. App at http://localhost

---

## TODO / Things to finish

- [ ] Test end-to-end with a real P&ID PDF
- [ ] Verify Excel output looks correct without LLM enrichment
- [ ] Custom branding — replace "InstruMap" with client product name if needed
- [ ] Add client logo to Excel cover sheet (currently uses project_info fields only)
- [ ] Consider adding a simple password gate if client needs basic access control
- [ ] Test batch (multi-file) processing
- [ ] Package for handoff: zip the MTO folder (exclude .venv, node_modules, batch_outputs)

---

## Source repos (do not modify)

- Backend: `/Users/prashanththipparthi/Desktop/xyra-ai-backend/XYRA-BACKEND`
- Frontend: `/Users/prashanththipparthi/Desktop/xyra-ai`
- Google credentials: `XYRA-BACKEND/instrumap-464410-3cb4dae6350d.json`
