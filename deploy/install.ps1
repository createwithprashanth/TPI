#Requires -RunAsAdministrator
<#
.SYNOPSIS
    XYRA Studio — Windows Server installer (Docker Desktop, online mode)
    Run as Administrator from the repo root:
        Set-ExecutionPolicy Bypass -Scope Process -Force
        .\deploy\install.ps1

.DESCRIPTION
    Checks Docker Desktop and starts all services via docker-compose.
#>

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path $MyInvocation.MyCommand.Path -Parent | Split-Path -Parent

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  XYRA Studio — Installation" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# ── 1. Check Docker ───────────────────────────────────────────────────────────
Write-Host "[1/3] Checking Docker..." -ForegroundColor Yellow
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
Write-Host "[2/3] Checking docker compose..." -ForegroundColor Yellow
try {
    docker compose version | Out-Null
    Write-Host "      docker compose OK" -ForegroundColor Green
} catch {
    Write-Host "      docker compose not available. Update Docker Desktop to v2.0+." -ForegroundColor Red
    exit 1
}

# ── 3. Offline model bundle (optional) ───────────────────────────────────────
# ── 4. Check credentials ──────────────────────────────────────────────────────
# ── 5. Start services ─────────────────────────────────────────────────────────
Write-Host "[3/3] Starting XYRA Studio..." -ForegroundColor Yellow
Set-Location $RepoRoot
docker compose up -d --build

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  XYRA Studio is starting up." -ForegroundColor Green
Write-Host ""
Write-Host "  Open in browser:  http://localhost" -ForegroundColor White
Write-Host "  Or from network:  http://<this-server-ip>" -ForegroundColor White
Write-Host ""
Write-Host ""
Write-Host "  To stop:   docker compose down" -ForegroundColor DarkGray
Write-Host "  To update: git pull && docker compose up -d --build" -ForegroundColor DarkGray
Write-Host "=========================================" -ForegroundColor Cyan
