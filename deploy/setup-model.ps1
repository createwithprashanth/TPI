<#
.SYNOPSIS
    Builds XYRA custom Ollama models inside the running Docker container.
    Run AFTER docker compose is up and Ollama has finished pulling qwen2.5:7b.

    Models built:
        xyra-pid-engineer  — instrument classification / ISA-5.1 enrichment
        xyra-line-mapper   — instrument-to-pipe-line assignment
        xyra-project-context — project/document context normalization
        xyra-mto-reviewer  — piping MTO evidence review / normalization
        xyra-instrumentation-engineer — AI Grid instrumentation review
        xyra-process-engineer — AI Grid process/service review
        xyra-piping-engineer — AI Grid piping/line review

    Usage:
        .\deploy\setup-model.ps1
#>

$RepoRoot = Split-Path $MyInvocation.MyCommand.Path -Parent | Split-Path -Parent
$Container = "xyra-studio-ollama-1"

function Build-Model {
    param (
        [string]$ModelName,
        [string]$ModelfileSrc
    )
    Write-Host ""
    Write-Host "Building $ModelName ..." -ForegroundColor Cyan
    docker cp $ModelfileSrc "${Container}:/tmp/${ModelName}.modelfile"
    docker exec $Container ollama create $ModelName --file "/tmp/${ModelName}.modelfile"
    if ($LASTEXITCODE -eq 0) {
        Write-Host "$ModelName ready." -ForegroundColor Green
    } else {
        Write-Host "ERROR building $ModelName — check Ollama logs." -ForegroundColor Red
    }
}

Build-Model -ModelName "xyra-pid-engineer" `
            -ModelfileSrc "$RepoRoot\backend\modelfiles\xyra-pid-engineer.modelfile"

Build-Model -ModelName "xyra-line-mapper" `
            -ModelfileSrc "$RepoRoot\backend\modelfiles\xyra-line-mapper.modelfile"

Build-Model -ModelName "xyra-project-context" `
            -ModelfileSrc "$RepoRoot\backend\modelfiles\xyra-project-context.modelfile"

Build-Model -ModelName "xyra-mto-reviewer" `
            -ModelfileSrc "$RepoRoot\backend\modelfiles\xyra-mto-reviewer.modelfile"

Build-Model -ModelName "xyra-instrumentation-engineer" `
            -ModelfileSrc "$RepoRoot\backend\modelfiles\xyra-instrumentation-engineer.modelfile"

Build-Model -ModelName "xyra-process-engineer" `
            -ModelfileSrc "$RepoRoot\backend\modelfiles\xyra-process-engineer.modelfile"

Build-Model -ModelName "xyra-piping-engineer" `
            -ModelfileSrc "$RepoRoot\backend\modelfiles\xyra-piping-engineer.modelfile"

Write-Host ""
Write-Host "All models ready. Configure names in .env if needed:" -ForegroundColor DarkGray
Write-Host "  XYRA_INSTRUMENT_MODEL=xyra-pid-engineer" -ForegroundColor DarkGray
Write-Host "  XYRA_LINE_MAPPER_MODEL=xyra-line-mapper" -ForegroundColor DarkGray
Write-Host "  XYRA_PROJECT_CONTEXT_MODEL=xyra-project-context" -ForegroundColor DarkGray
Write-Host "  XYRA_MTO_REVIEWER_MODEL=xyra-mto-reviewer" -ForegroundColor DarkGray
Write-Host "  XYRA_INSTRUMENTATION_ENGINEER_MODEL=xyra-instrumentation-engineer" -ForegroundColor DarkGray
Write-Host "  XYRA_PROCESS_ENGINEER_MODEL=xyra-process-engineer" -ForegroundColor DarkGray
Write-Host "  XYRA_PIPING_ENGINEER_MODEL=xyra-piping-engineer" -ForegroundColor DarkGray
