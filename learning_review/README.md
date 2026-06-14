# XYRA Learning Review Pipeline

Temporary internal pipeline for teaching XYRA Studio with external reviewer comments.

This folder is intentionally outside `backend/app` so it stays loosely coupled from customer deployments. It reads local XYRA outputs, prepares compact review payloads, optionally sends them to a teacher model, and stores structured comments for later human-approved improvements.

## What It Does

1. Reads the local SQLite project database.
2. Builds review payloads for:
   - Instrument Index
   - IO List
   - Piping MTO
3. Optionally calls a teacher provider:
   - `openai`
   - `gemini`
   - `mock` dry-run provider
4. Saves teacher comments and a learning report.
5. Classifies comments into improvement buckets:
   - deterministic rule
   - model prompt
   - benchmark
   - project legend
   - UI review flag
   - manual review

External teacher comments never write to SQLite and never change code automatically.

## Commands

Dry run:

```bash
backend/.venv/bin/python learning_review/run_learning_review.py \
  --project-id XYRA_E2E_PID_GRID_TEST_20260607 \
  --provider mock
```

OpenAI teacher:

```bash
export OPENAI_API_KEY=...
backend/.venv/bin/python learning_review/run_learning_review.py \
  --project-id XYRA_E2E_PID_GRID_TEST_20260607 \
  --provider openai \
  --model gpt-4.1
```

Gemini teacher:

```bash
export GEMINI_API_KEY=...
backend/.venv/bin/python learning_review/run_learning_review.py \
  --project-id XYRA_E2E_PID_GRID_TEST_20260607 \
  --provider gemini \
  --model gemini-1.5-pro
```

## Outputs

Each run creates:

```text
learning_review/runs/{run_id}/
  review_payloads/
  comments/
  learning_report.md
  run_summary.json
```

## Current Status

This is an internal learning tool. Do not expose it in the customer UI or deployment package.
