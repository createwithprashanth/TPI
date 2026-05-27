#Requires -RunAsAdministrator
<#
.SYNOPSIS
    XYRA Studio — Windows Server installer (Docker Desktop, online mode)
    Run as Administrator from the repo root:
        Set-ExecutionPolicy Bypass -Scope Process -Force
        .\deploy\install.ps1

.DESCRIPTION
    Installs Docker Desktop (if needed), loads or pulls the Ollama model,
    and starts all services via docker-compose.
#>

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $MyInvocation.MyCommand.Path -Parent | Split-Path -Parent

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  XYRA Studio — Installation" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Check Docker ───────────────────────────────────────────────────────────
Write-Host "[1/5] Checking Docker..." -ForegroundColor Yellow
try {
    $dockerVersion = docker --version 2>&1
    Write-Host "      $dockerVersion" -ForegroundColor Green
} catch {
    Write-Host "      Docker not found. Please install Docker Desktop for Windows first:" -ForegroundColor Red
    Write-Host "      https://docs.docker.com/desktop/install/windows-install/" -ForegroundColor White
    Write-Host "      Then re-run this script." -ForegroundColor White
    exit 1
}

# ── 2. Check docker-compose ───────────────────────────────────────────────────
Write-Host "[2/5] Checking docker compose..." -ForegroundColor Yellow
try {
    docker compose version | Out-Null
    Write-Host "      docker compose OK" -ForegroundColor Green
} catch {
    Write-Host "      docker compose not available. Update Docker Desktop to v2.0+." -ForegroundColor Red
    exit 1
}

# ── 3. Offline model bundle (optional) ───────────────────────────────────────
Write-Host "[3/5] Checking for offline model bundle..." -ForegroundColor Yellow
$offlineBundle = Join-Path $RepoRoot "deploy\qwen2.5-7b-offline.tar"
if (Test-Path $offlineBundle) {
    Write-Host "      Found offline bundle — loading Ollama image from tar..." -ForegroundColor Green
    docker load -i $offlineBundle
} else {
    Write-Host "      No offline bundle found — model will be pulled from internet on first start." -ForegroundColor White
    Write-Host "      (Run deploy\bundle-offline.ps1 on a machine with internet to create one.)" -ForegroundColor DarkGray
}

# ── 4. Check credentials ──────────────────────────────────────────────────────
Write-Host "[4/5] Checking Google Vision credentials..." -ForegroundColor Yellow
$credFile = Join-Path $RepoRoot "google_credentials.json"
if (-not (Test-Path $credFile)) {
    Write-Host "      WARNING: google_credentials.json not found." -ForegroundColor Yellow
    Write-Host "      OCR will not work until you place your Google Vision service account key" -ForegroundColor Yellow
    Write-Host "      at: $credFile" -ForegroundColor White
} else {
    Write-Host "      google_credentials.json found." -ForegroundColor Green
}

# ── 5. Start services ─────────────────────────────────────────────────────────
Write-Host "[5/5] Starting XYRA Studio..." -ForegroundColor Yellow
Set-Location $RepoRoot
docker compose up -d --build

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  XYRA Studio is starting up." -ForegroundColor Green
Write-Host ""
Write-Host "  Open in browser:  http://localhost" -ForegroundColor White
Write-Host "  Or from network:  http://<this-server-ip>" -ForegroundColor White
Write-Host ""
Write-Host "  First start: Ollama will pull the Qwen2.5 7B model (~4.7 GB)." -ForegroundColor DarkGray
Write-Host "  This takes ~10 min on a fast connection. Progress:" -ForegroundColor DarkGray
Write-Host "    docker compose logs -f ollama" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  To stop:   docker compose down" -ForegroundColor DarkGray
Write-Host "  To update: git pull && docker compose up -d --build" -ForegroundColor DarkGray
Write-Host "=========================================" -ForegroundColor Cyan
