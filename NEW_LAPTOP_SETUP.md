# XYRA Studio - New Laptop Setup

Use this checklist when moving XYRA Studio to another laptop or workstation.

## 1. Get the Code

```bash
git clone https://github.com/XYRA-AI-ENGINEERING/XYRA_Studio.git
cd XYRA_Studio
git pull origin main
```

This brings the pushed application code, including Piping MTO, PrecisionPDF, model Modelfiles, deployment scripts, and UI changes.

Important: local unpushed changes from another machine do not come with `git pull`.

## 2. Create Environment File

```bash
cp .env.template .env
```

Edit `.env`:

```env
CORS_ORIGINS=http://YOUR_SERVER_IP
XYRA_PROJECT_CONTEXT_USE_LLM=0
XYRA_MTO_REVIEW_USE_LLM=1
ALLOW_SYSTEM_WORKER_START=false
INSTRUMAP_DEBUG=false
PDF_DPI=300
```

For local development without Docker, use local service URLs:

```env
REDIS_URL=redis://localhost:6379
OLLAMA_HOST=http://localhost:11434
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Never commit `.env`.

## 3. Install Runtime Tools

Install these on the new laptop:

- Git
- Python 3.11 or newer
- Node.js 20 or newer
- Redis
- Ollama
- Docker Desktop, if using Docker deployment

## 4. Build Local LLM Models

Start Ollama first, then build XYRA models.

On Windows PowerShell:

```powershell
.\deploy\setup-model.ps1
```

On macOS/Linux, build manually:

```bash
ollama pull qwen2.5:7b
ollama create xyra-pid-engineer -f backend/modelfiles/xyra-pid-engineer.modelfile
ollama create xyra-line-mapper -f backend/modelfiles/xyra-line-mapper.modelfile
ollama create xyra-project-context -f backend/modelfiles/xyra-project-context.modelfile
ollama create xyra-mto-reviewer -f backend/modelfiles/xyra-mto-reviewer.modelfile
```

Check models:

```bash
ollama list
```

Expected custom models:

- `xyra-pid-engineer`
- `xyra-line-mapper`
- `xyra-project-context`
- `xyra-mto-reviewer`

## 5. Local Development Setup

Backend:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000
```

Worker, in a second terminal:

```bash
cd backend
source .venv/bin/activate
python worker.py
```

Frontend, in a third terminal:

```bash
cd frontend
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

Open:

```text
http://127.0.0.1:5173
```

## 6. Docker Deployment

For a client-style deployment:

```bash
docker compose up --build
```

Open:

```text
http://localhost
```

For client network deployment, set `CORS_ORIGINS` in `.env` to the real server URL or LAN IP before starting.

## 7. Health Checks

Backend:

```bash
curl http://127.0.0.1:8000/api/v1/system/health
```

Frontend:

```bash
curl -I http://127.0.0.1:5173
```

Redis:

```bash
redis-cli ping
```

Ollama:

```bash
curl http://127.0.0.1:11434/api/tags
```

System Health in the app should show:

- Backend API live
- Redis live
- Worker live
- Ollama live
- `xyra-pid-engineer` live
- `xyra-line-mapper` live
- `xyra-project-context` live
- `xyra-mto-reviewer` live

## 8. What Does Not Transfer by Git

These are local machine items and must be recreated or copied manually if needed:

- `.env`
- Ollama model binaries
- Redis data
- generated exports under `backend/data/mto_exports/`
- temporary batch outputs
- private credentials such as `google_credentials.json`
- any uncommitted local code changes

## 9. Usual Update Flow

```bash
git pull origin main
cd frontend && npm install
cd ../backend && pip install -r requirements.txt
```

If Modelfiles changed:

```bash
ollama create xyra-pid-engineer -f backend/modelfiles/xyra-pid-engineer.modelfile
ollama create xyra-line-mapper -f backend/modelfiles/xyra-line-mapper.modelfile
ollama create xyra-project-context -f backend/modelfiles/xyra-project-context.modelfile
ollama create xyra-mto-reviewer -f backend/modelfiles/xyra-mto-reviewer.modelfile
```

Then restart backend, worker, and frontend.
