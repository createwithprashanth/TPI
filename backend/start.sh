#!/bin/bash
# Starts FastAPI + RQ worker together.
# Run from the backend/ directory: ./start.sh
set -e
cd "$(dirname "$0")"
source .venv/bin/activate

echo "Starting FastAPI..."
uvicorn main:app --port 8000 --reload &
UVICORN_PID=$!

echo "Starting RQ worker (instrumap queue)..."
rq worker instrumap --with-scheduler &
RQ_PID=$!

echo "FastAPI PID: $UVICORN_PID | RQ worker PID: $RQ_PID"
echo "Press Ctrl+C to stop both."

trap "kill $UVICORN_PID $RQ_PID 2>/dev/null; exit 0" INT TERM
wait
