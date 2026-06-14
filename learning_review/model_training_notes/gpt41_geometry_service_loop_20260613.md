# GPT-4.1 Geometry + Service Learning Loop - 2026-06-13

## Scope

Focused on InstruMap output quality for real EPC P&IDs using the temporary GPT-4.1 learning-review pipeline.

Test source:
- `/Users/prashanththipparthi/Downloads/Zoho WorkDrive`
- Files used in repeat loop: `pid (1).pdf`, `pid (10).pdf`, `pid (11).pdf`

Final validation project:
- `XYRA_GEOM_GPT41_LOOP7_20260613`
- Rows written to SQLite: 198 instruments
- Rows with geometry evidence: 198
- Rows with line tag: 105
- Rows requiring review after this pass: 62

## Implemented

1. Added same-loop geometry evidence.
   - New `geometry_evidence.loop_context` block records mapped line candidates from same-loop physical instruments/final elements.
   - Conflicting loop lines are explicitly marked with `conflict=true`.
   - This evidence is read-only/auditable and does not directly overwrite `line_tag`.

2. Made service writing conflict-aware.
   - Clean same-loop context can improve service text.
   - Conflicting same-loop context now produces review phrasing instead of a guessed line-specific service.
   - Example: `FIC-1414P-26` now becomes `Process flow control line requires review` when loop candidates conflict.

3. Added deterministic EPC service rules.
   - `HIC` -> `Manual indicating controller`
   - `LAL/LAH/LALL/LAHH` -> level alarm services
   - `PDHG/PDG` -> local differential pressure indication
   - `PSDH/PSDL/PDSH/PDSL` -> differential pressure switch services
   - `XA` -> miscellaneous/process alarm
   - `PSAL/PSAH` -> pressure low/high switch services
   - `ZIH/ZIL` -> valve position high/low indication

4. Updated `xyra-instrumentation-engineer`.
   - Added loop-context conflict rules.
   - Added EPC service tag lessons.
   - Rebuilt local Ollama model: `xyra-instrumentation-engineer`.

5. Added regression tests.
   - Same-loop evidence creation.
   - Conflicting loop-context detection.
   - Controller service from same-loop context.
   - EPC service vocabulary coverage.

## GPT-4.1 Review Results

Baseline first small review:
- Run: `learning_review/runs/learning_20260613_214112`
- Total comments: 42
- Instrument Index: 23
- IO List: 19

After geometry/service loop:
- Run: `learning_review/runs/learning_20260613_222132`
- Total comments: 28
- Instrument Index: 23
- IO List: 5

Best intermediate service-only comparison:
- Run: `learning_review/runs/learning_20260613_221806`
- Total comments: 25
- No critical comments in summary.

Interpretation:
- IO List quality improved significantly.
- Service vocabulary issues were reduced to near zero.
- Remaining comments are mostly line association / project legend / unresolved geometry conflicts.

## Verification

Commands run:

```bash
backend/.venv/bin/python -m pytest backend/tests/test_service_enricher.py backend/tests/test_geometry_evidence.py backend/tests/test_line_mapper_evidence.py -q
```

Result:
- `13 passed`

```bash
backend/.venv/bin/python backend/tests/benchmarks/run_engineering_team_models.py
```

Result:
- All engineering model smoke cases passed.

## Remaining High-Value Next Task

Build a stronger physical connection graph for hardwired and passive devices:

- Resolve `SSV`, `PSAL`, `FE`, `TE`, `TW`, `PY`, `FIC/PIC` line associations using actual symbol-to-pipe topology instead of loop propagation alone.
- Add evidence fields for:
  - nearest traced pipe segment
  - valve/inline symbol pipe intersection
  - branch/stub continuity
  - whether the component is equipment-mounted rather than line-mounted
- Use project legend only as a tie-breaker, not as a replacement for geometry.

This is the correct next improvement because GPT-4.1 now consistently asks for deterministic geometry evidence, not more tag vocabulary.

## Engineering Team Guardrail Loop 2026-06-13

Follow-up issue:
- The raw local `xyra-instrumentation-engineer` model still occasionally produced malformed or stubborn output for passive `TE` rows.
- Example bad raw behavior: `TE` with blank `io_type`, `signal_type`, and `category` could be returned as blank values or generic review instead of `None` / `None` / `passive`.

Changes made:
- Normalized `TE` and `TW` deterministic defaults to `signal_type="None"`.
- Passed `geometry_evidence` and `notes` through the Engineering Team model prompt instead of stripping them from AI Grid rows.
- Added deterministic review flagging for process-connected instruments that have no confirmed `line_tag` and only weak/contextual geometry evidence.
- Hardened model suggestion parsing for local LLM shorthand and root-level JSON responses.
- Prevented model suggestions from overriding known deterministic type defaults.
- Updated `xyra-instrumentation-engineer` with mandatory passive TE/TW and weak-geometry behavior.

Verification:

```bash
backend/.venv/bin/python -m pytest backend/tests/test_engineering_team.py learning_review/tests/test_learning_review.py backend/tests/test_geometry_evidence.py backend/tests/test_service_enricher.py backend/tests/test_line_mapper_evidence.py -q
```

Result:
- `30 passed`

```bash
backend/.venv/bin/python backend/tests/benchmarks/run_engineering_team_models.py
```

Result:
- All engineering model smoke cases passed through the deployed guardrail path.

Important interpretation:
- The local model is useful as an engineering reviewer, but it must remain behind deterministic EPC guardrails.
- Client-facing results should trust deterministic rules first, then accept model suggestions only when they do not contradict known ISA/project defaults.
- This architecture is more deployable than trying to make a 7B local model perfectly obedient for every row shape.

## AI Grid E2E Reliability Loop 2026-06-13

Real PID acceptance input:
- Source: `/Users/prashanththipparthi/Downloads/Zoho WorkDrive`
- File count: 1
- Project: `XYRA_GUARDRAIL_E2E_20260613`
- Report: `backend/training/reports/xyra_guardrail_e2e_20260613.json`

Observed before this loop:
- Physical devices such as `FIT` and `PIT` could remain as `Soft Link` after extraction.
- Passive line-mounted items such as `TE`, `TW`, `FE`, and `RO` needed clearer deterministic handling.
- Full geometry evidence in model prompts could cause local Ollama model timeouts.

Changes made:
- Correct physical transmitter/default device conflicts, not only blank fields.
- Treat `FE`, `RO`, `TE`, and `TW` as passive/no-IO defaults while preserving FlowSizing handoff where applicable.
- Let the process engineer suggest `line_tag` only when `geometry_evidence.line.tag` is confirmed by strong methods such as `pipe_graph` or `loop_propagation`.
- Keep nearest line labels and same-loop context as review evidence, not automatic line assignment.
- Compact `geometry_evidence` before sending it to local LLMs so candidate arrays do not bloat prompts.
- Filter model rows by engineer role.
- Lower default model review cost:
  - `XYRA_ENGINEERING_MODEL_ROW_LIMIT` default: `8`
  - `XYRA_ENGINEERING_MODEL_TIMEOUT` default: `25`
  - `XYRA_ENGINEERING_MODEL_NUM_PREDICT` default: `900`

Latest E2E result:
- Extraction: 85 instruments inserted.
- AI Grid deterministic/model review: 60 rows reviewed.
- Applied corrections: 43.
- Result examples:
  - `FIT` and `PIT` corrected to `AI / 4-20mA + HART / field_device`.
  - `FE`, `RO`, `TE`, and `TW` corrected to passive/no-IO defaults.
  - Rows with weak/nearest-only line evidence remain `For Review`.

Known remaining behavior:
- The piping model can still timeout in batch review on this machine; deterministic review still completes and applies corrections.
- This is acceptable for client deployment only because model calls are advisory and bounded by timeout. Future work should make model calls cancellable/backgrounded in the UI.
