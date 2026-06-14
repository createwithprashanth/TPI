# GPT-4.1 Instrumentation Learning Refresh - 2026-06-13

Source review runs:

- `learning_review/runs/learning_20260610_232021`
- `learning_review/runs/learning_20260610_233157`
- `learning_review/runs/learning_20260610_234026`

Applied to models:

- `backend/modelfiles/xyra-pid-engineer.modelfile`
- `backend/modelfiles/xyra-instrumentation-engineer.modelfile`

Applied to deterministic safeguards:

- `backend/app/modules/instrumap/core/type_enricher.py`

## Model Teaching Added

Reject these as text/title/spec/note fragments unless a project legend explicitly defines the exact tag pattern:

- `ADCO-1963-ADCO`
- `ADCO-3844`
- `AFTER-317-209`
- `AREA-5610-5710`
- `ALARM-8004`
- `ALL-01-03`
- `ASIC-7767`
- `ASIC-7768`
- `BALL-316`
- `BALL-316-INTHE`
- `BAND-150-TRIP`
- `LIMIT-11055`

Reject or flag prefixes:

- `ADCO`
- `AFTER`
- `AREA`
- `ALARM`
- `ALL`
- `ASIC`
- `BALL`
- `BAND`
- `LIMIT`

Do not automatically reject `AIR`; it can be a legitimate Analysis Indicating Recorder. Keep it for review when context is weak.

These project-text prefixes are also blocked before LLM enrichment. This prevents base-model ISA decoding from turning fragments such as `ADCO-1963-ADCO`, `ALL-01-03`, or `ASIC-7767` into false analyzer instruments.

## Conservative Engineering Rules

- Missing line/equipment association for hardwired IO is a real EPC quality gap, but the model must not invent `line_tag`.
- If evidence is only "nearest equipment", keep `line_tag` blank and keep `review_required=true`.
- Generic services such as `Flow measurement`, `Valve control`, `Level measurement`, or `Analysis switch` are acceptable only as low-confidence placeholders.
- Use upstream/downstream/inlet/outlet wording only when position evidence is explicit or strongly supported by geometry.
- Manual review is a valid and preferred output when the drawing evidence is insufficient.

## Not Solved By Model Teaching

GPT-4.1 repeatedly flagged missing line/equipment tags for process transmitters and valves. That is not a prompt problem. The next real improvement is a stronger geometric line/equipment association engine and confidence/evidence UI.

## Verification

- Rebuilt local Ollama contexts:
  - `ollama create xyra-pid-engineer -f backend/modelfiles/xyra-pid-engineer.modelfile`
  - `ollama create xyra-instrumentation-engineer -f backend/modelfiles/xyra-instrumentation-engineer.modelfile`
- Backend focused tests: `14 passed`
- Noise benchmark: `55/55 passed`
- Engineering team model smoke tests: `10/10 passed`
