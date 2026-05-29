#Requires -RunAsAdministrator
<#
.SYNOPSIS
    XYRA Studio — Offline installer for air-gapped customer servers.
    Copy the entire bundle folder to the server, then run:
        Set-ExecutionPolicy Bypass -Scope Process -Force
        .\install-offline.ps1
#>

$ErrorActionPreference = "Stop"
$BundleDir = $PSScriptRoot

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  XYRA Studio — Offline Installation" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Check Docker ───────────────────────────────────────────────────────────
Write-Host "[1/5] Checking Docker..." -ForegroundColor Yellow
try {
    docker --version | Out-Null
    Write-Host "      Docker OK" -ForegroundColor Green
} catch {
    Write-Host "      Docker not found. Install Docker Desktop for Windows first." -ForegroundColor Red
    exit 1
}

# ── 2. Load Docker images ─────────────────────────────────────────────────────
Write-Host "[2/5] Loading Docker images from bundle..." -ForegroundColor Yellow
Get-ChildItem "$BundleDir\docker-images\*.tar" | ForEach-Object {
    Write-Host "      Loading $($_.Name)..." -ForegroundColor Gray
    docker load -i $_.FullName
}
Write-Host "      All images loaded." -ForegroundColor Green

# ── 3. Restore Ollama model blobs ─────────────────────────────────────────────
Write-Host "[3/5] Restoring Ollama model files..." -ForegroundColor Yellow
$modelDir = "$BundleDir\models"
if (Test-Path $modelDir) {
    Write-Host "      Model files found at: $modelDir" -ForegroundColor Green
} else {
    New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
    Write-Host "      WARNING: models folder not found — Ollama model will be unavailable until copied here." -ForegroundColor Yellow
}

# ── 4. Check credentials ──────────────────────────────────────────────────────
Write-Host "[4/5] Checking Google Vision credentials..." -ForegroundColor Yellow
$credFile = "$BundleDir\google_credentials.json"
if (-not (Test-Path $credFile)) {
    Write-Host "      Place google_credentials.json in this folder, then re-run." -ForegroundColor Yellow
} else {
    Write-Host "      Credentials found." -ForegroundColor Green
}

$envFile = "$BundleDir\.env"
if (-not (Test-Path $envFile)) {
    if (Test-Path "$BundleDir\.env.example") {
        Copy-Item "$BundleDir\.env.example" $envFile
    } else {
        @"
REDIS_URL=redis://redis:6379
CORS_ORIGINS=http://localhost,http://127.0.0.1
GOOGLE_APPLICATION_CREDENTIALS=/app/google_credentials.json
"@ | Set-Content -Path $envFile -Encoding UTF8
    }
    Write-Host "      Created .env from defaults. Edit CORS_ORIGINS if users access by server name/IP." -ForegroundColor Yellow
}

# ── 5. Start services ─────────────────────────────────────────────────────────
Write-Host "[5/5] Starting XYRA Studio..." -ForegroundColor Yellow
Set-Location $BundleDir
docker compose up -d

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  XYRA Studio is running." -ForegroundColor Green
Write-Host ""
Write-Host "  Open in browser:  http://localhost" -ForegroundColor White
Write-Host "  Or from network:  http://<this-server-ip>" -ForegroundColor White
Write-Host ""
Write-Host "  To stop:   docker compose down" -ForegroundColor DarkGray
Write-Host "  Logs:      docker compose logs -f" -ForegroundColor DarkGray
Write-Host "=========================================" -ForegroundColor Cyan
