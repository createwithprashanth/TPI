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
$modelBundle = "$BundleDir\ollama-models.tar.gz"
if (Test-Path $modelBundle) {
    # Create named volume and extract model blobs into it
    docker volume create ollama_models | Out-Null
    docker run --rm `
        -v ollama_models:/root/.ollama `
        -v "${BundleDir}:/bundle" `
        alpine `
        tar xzf /bundle/ollama-models.tar.gz -C /root/.ollama
    Write-Host "      Model restored." -ForegroundColor Green
} else {
    Write-Host "      WARNING: ollama-models.tar.gz not found — model will be unavailable." -ForegroundColor Yellow
}

# ── 4. Check credentials ──────────────────────────────────────────────────────
Write-Host "[4/5] Checking Google Vision credentials..." -ForegroundColor Yellow
$credFile = "$BundleDir\google_credentials.json"
if (-not (Test-Path $credFile)) {
    Write-Host "      Place google_credentials.json in this folder, then re-run." -ForegroundColor Yellow
} else {
    Write-Host "      Credentials found." -ForegroundColor Green
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
