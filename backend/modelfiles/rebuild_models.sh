#!/bin/bash
# Rebuild all XYRA Ollama models from their Modelfiles.
# Run from the backend/modelfiles/ directory or anywhere — uses absolute path.
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

models=(
  "xyra-pid-engineer"
  "xyra-line-mapper"
  "xyra-instrumentation-engineer"
  "xyra-process-engineer"
  "xyra-piping-engineer"
  "xyra-mto-reviewer"
  "xyra-project-context"
)

for model in "${models[@]}"; do
  echo "==> Building $model ..."
  ollama create "$model" -f "$DIR/$model.modelfile"
  echo "    OK"
done

echo ""
echo "All models rebuilt."
echo "Verify with: ollama list"
