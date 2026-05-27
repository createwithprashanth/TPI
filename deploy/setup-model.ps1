<#
.SYNOPSIS
    Builds the xyra-pid:v1 custom model from the Modelfile.
    Run AFTER docker compose is up and Ollama has finished pulling qwen2.5:7b.

    Usage:
        .\deploy\setup-model.ps1
#>

$RepoRoot = Split-Path $MyInvocation.MyCommand.Path -Parent | Split-Path -Parent

Write-Host "Building xyra-pid:v1 custom model..." -ForegroundColor Cyan

# Copy Modelfile into the Ollama container and build
docker cp "$RepoRoot\deploy\Modelfile" xyra-studio-ollama-1:/tmp/Modelfile
docker exec xyra-studio-ollama-1 ollama create xyra-pid:v1 --file /tmp/Modelfile

Write-Host ""
Write-Host "Done. xyra-pid:v1 is ready." -ForegroundColor Green
Write-Host "Update DEFAULT_MODEL in backend/app/modules/llm/service.py to use it." -ForegroundColor DarkGray
