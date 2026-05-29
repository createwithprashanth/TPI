#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Creates an offline install bundle for air-gapped customer sites.
    Run this on a machine that HAS internet access.
    Output: deploy\XYRA_Studio_offline_bundle\ (~8 GB)

    Copy that folder to a USB drive and run install.ps1 on the customer server.
#>

$ErrorActionPreference = "Stop"
$RepoRoot  = Split-Path $MyInvocation.MyCommand.Path -Parent | Split-Path -Parent
$OutputDir = Join-Path $RepoRoot "deploy\XYRA_Studio_offline_bundle"
$ModelDir = Join-Path $OutputDir "models"

Write-Host "Building offline bundle → $OutputDir" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
New-Item -ItemType Directory -Force -Path "$OutputDir\docker-images" | Out-Null
New-Item -ItemType Directory -Force -Path $ModelDir | Out-Null

# ── 1. Build Docker images ────────────────────────────────────────────────────
Write-Host "[1/4] Building Docker images..." -ForegroundColor Yellow
Set-Location $RepoRoot
docker compose build

# ── 2. Save Docker images to tar ─────────────────────────────────────────────
Write-Host "[2/4] Saving images to tar files..." -ForegroundColor Yellow

docker save xyra-studio-frontend -o "$OutputDir\docker-images\xyra-frontend.tar"
docker save xyra-studio-backend  -o "$OutputDir\docker-images\xyra-backend.tar"
docker save ollama/ollama:latest  -o "$OutputDir\docker-images\ollama.tar"
docker save redis:7-alpine        -o "$OutputDir\docker-images\redis.tar"

# ── 3. Export Ollama model blobs ──────────────────────────────────────────────
Write-Host "[3/4] Exporting Ollama model (qwen2.5:7b)..." -ForegroundColor Yellow
# Pull model into a temporary Ollama container, then copy the blobs out
docker run --rm -v ollama_models:/root/.ollama ollama/ollama:latest pull qwen2.5:7b
docker run --rm `
    -v ollama_models:/root/.ollama `
    -v "${ModelDir}:/export" `
    alpine `
    sh -c "cd /root/.ollama && tar cf - . | tar xf - -C /export"

# ── 4. Copy deploy files ──────────────────────────────────────────────────────
Write-Host "[4/4] Copying deploy files..." -ForegroundColor Yellow
Copy-Item "$RepoRoot\deploy\docker-compose.offline.yml" (Join-Path $OutputDir "docker-compose.yml")
Copy-Item "$RepoRoot\deploy\install-offline.ps1" $OutputDir
Copy-Item "$RepoRoot\deploy\Modelfile"           $OutputDir
Copy-Item "$RepoRoot\.env.example"               (Join-Path $OutputDir ".env.example")

Write-Host ""
Write-Host "Bundle ready: $OutputDir" -ForegroundColor Green
Write-Host "Total size:" (Get-ChildItem $OutputDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1GB "GB" -ForegroundColor Green
Write-Host ""
Write-Host "Copy this folder to USB and run install-offline.ps1 on the customer server." -ForegroundColor White
