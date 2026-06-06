# XYRA Studio Model Training Workspace

This folder keeps local model improvement work auditable and repeatable.

XYRA Studio uses small local Ollama models with expert system prompts. The model weights are not changed. A "training" cycle means:

1. Curate public/domain-safe knowledge into compact corpus packs.
2. Validate that the corpus has source traceability and no copied standards text.
3. Refresh Modelfiles with concise expert rules and worked examples.
4. Rebuild the local Ollama models.
5. Run benchmark and regression tests.
6. Save a run report under `backend/training/reports`.

## Folder Layout

- `source_registry.json` lists approved public sources and how they may be used.
- `corpus/*.json` stores XYRA-owned distilled rules, examples, and benchmark additions.
- `scripts/validate_training_corpus.py` validates source references and corpus structure.
- `scripts/build_local_models.py` rebuilds Ollama models from `backend/modelfiles`.
- `scripts/run_training_cycle.py` runs validation, optional model rebuild, benchmarks, and writes a report.

## Guardrails

- Do not paste paid standards or long copyrighted passages into this repository.
- Corpus entries must be written in XYRA's own words.
- Prefer conservative engineering review flags over fabricated values.
- Every corpus pack must reference one or more registered sources.

## Common Commands

```bash
python backend/training/scripts/validate_training_corpus.py
python backend/training/scripts/build_local_models.py --dry-run
python backend/training/scripts/run_training_cycle.py --skip-build
python backend/training/scripts/run_training_cycle.py --build
```
