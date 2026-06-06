# XYRA Model Training Run

- Date: 2026-06-06
- Scope: First repeatable local model-training framework and model refresh cycle.
- Build method: Local Ollama `ollama create` from `backend/modelfiles`.
- Corpus policy: Public/domain-safe sources only; no paid standard text copied into the repository.

## Sources Registered

- ISA5.1 Instrumentation Symbols and Identification
- ISA-5 Series of Standards
- Emerson control-valve sizing and handbook pages
- NIST ICS security guidance
- AIChE public P&ID codes/tags/labels article
- Projectmaterials public line-designation article
- Public arXiv P&ID digitization/symbol recognition papers

See `backend/training/source_registry.json` for URLs, publishers, model targets, and usage notes.

## Implemented

- Added training workspace:
  - `backend/training/source_registry.json`
  - `backend/training/corpus/instrumentation_pack.json`
  - `backend/training/corpus/piping_mto_pack.json`
  - `backend/training/corpus/project_delivery_pack.json`
  - `backend/training/scripts/validate_training_corpus.py`
  - `backend/training/scripts/build_local_models.py`
  - `backend/training/scripts/run_training_cycle.py`
- Added training corpus regression:
  - `backend/tests/test_training_corpus.py`
- Refreshed model prompts:
  - `xyra-pid-engineer`
  - `xyra-line-mapper`
  - `xyra-project-context`
  - `xyra-mto-reviewer`
  - `xyra-instrumentation-engineer`
  - `xyra-process-engineer`
  - `xyra-piping-engineer`
- Added benchmark coverage for:
  - Passive TE instrument rows
  - PSV relief-valve handoff
  - F&G detector no-process-service review
  - RO line-mapping handoff
- Improved production noise prefilter for:
  - `PM-*` fragments
  - `Bb-*` well/battery labels
- Improved benchmark progress visibility with flushed output.

## Model Fixes From Iteration

- `SSOV-573P-02` was initially misclassified as speed/control valve.
  - Fixed with explicit EPC special-code hint and model rule.
- `BTT-101-01` initially missed `system=DCS`.
  - Fixed with explicit burner/bearing temperature transmitter hint.
- `PM-573P-01` was initially treated as a low-confidence pressure motor.
  - Fixed by production prefilter.
- `Bb-573P` was accurate but slow because it reached the LLM.
  - Fixed by production prefilter.

## Verification

- Corpus validation: passed
  - 9 sources
  - 3 corpus packs
  - 9 examples
  - 4 benchmark additions
- Engineering-team model benchmark: passed
  - 8/8 passed
- Full PID/line benchmark: passed
  - 132/132 passed
  - Time: 393.6 seconds before final `Bb-*` speed cleanup
- Noise benchmark after prefilter cleanup: passed
  - 20/20 passed
  - Time: 0.3 seconds
- Backend regression: passed
  - 145 passed
  - 5 warnings from existing SWIG/import dependencies
- Frontend production build: passed
  - `frontend/npm run build`

## Observations

- Accuracy is strong after this cycle.
- LLM line-mapper blank/no-connection cases remain slower than inline cases.
- Obvious drawing noise should continue to be filtered deterministically before LLM calls.
- Next model performance improvement should focus on deterministic pre-routing for F&G, DCS soft tags, level-to-vessel rows, and far-distance/no-line cases before calling `xyra-line-mapper`.
