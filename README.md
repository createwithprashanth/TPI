# XYRA Studio

Internal engineering platform for P&ID analysis. Runs on your server, accessed through a browser. No data leaves the network.

## Tools

| Tool | What it does |
|---|---|
| **Instrumentation** | Extracts instrument tags from P&ID drawings. Generates engineering Excel reports — Instrument Index, IO List, Verification Log, Line List. |
| **Piping MTO** | Rubber-band a symbol on any drawing, counts every occurrence across all uploaded P&IDs. Exports MTO Excel, CSV, annotated drawings. |
| **PrecisionPDF** | Full-featured PDF viewer and annotation editor for reviewing drawings. |

## Quick Start (Docker)

**Prerequisites:** Docker Desktop installed and running.

```bash
# 1. Clone
git clone https://github.com/XYRA-AI-ENGINEERING/XYRA_Studio
cd XYRA_Studio

# 2. Add credentials
cp .env.example .env          # edit as needed
# Place Google Vision key at: ./google_credentials.json

# 3. Start
docker compose up --build

# 4. Open in browser
http://localhost
```

On first start, the Ollama container will download the Qwen2.5 7B model (~4.7 GB). This takes a few minutes and only happens once.

## Windows Server (Customer Deployment)

See [deploy/install.ps1](deploy/install.ps1) for the guided installer.  
For air-gapped sites with no internet: see [deploy/install-offline.ps1](deploy/install-offline.ps1).

## Stopping

```bash
docker compose down          # stop services, keep data
docker compose down -v       # stop and delete all stored data
```

## Updating

```bash
git pull
docker compose up --build
```

---

Full technical documentation: [DOCUMENTATION.md](DOCUMENTATION.md)
