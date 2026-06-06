# XYRA Component Contracts and Enhancement Lanes

This document defines what each component owns, what it consumes, and where future improvements should go.

## Instrumentation / Instrumap

Owns:

- Instrument tag extraction.
- Instrument classification.
- Line mapping.
- Service inference.
- Instrument Index, IO List, Line List, Verification Log.
- Writing extracted instruments to SQLite.

Consumes:

- Uploaded P&ID PDFs.
- Project context and legend.
- Local LLM models.
- SQLite project database.

Must not own:

- FlowSizing calculations.
- Piping MTO component library.
- AI Grid UI behavior.

Future enhancement scope:

- Better project legend ingestion.
- More negative examples for noise rejection.
- More robust service wording from upstream/downstream context.
- Revision comparison between drawing issues.
- Discipline QA report before export.
- Background batch recovery and resume.

Performance work:

- Cache extracted text per PDF/page.
- Store page-level line and tag geometry.
- Avoid repeated OCR on unchanged files.
- Batch DB writes.

## Piping MTO

Owns:

- Component library.
- Component capture and trimming.
- Pixel/feature matching.
- Size extraction near detected components.
- Detection overlays and false-positive removal.
- EPC-style MTO export.

Consumes:

- Uploaded P&ID PDFs.
- Component library JSON or future DB-backed library.
- Optional MTO reviewer model.

Must not own:

- Instrument Index fields.
- FlowSizing calculation results.
- Project-wide AI memory.

Future enhancement scope:

- Better shape-aware component capture.
- Per-client component library packs.
- Component grouping by valve family, size, class, and line.
- Drawing-scale calibration.
- MTO revision comparison.
- QA summary for missed/low-confidence detections.

Performance work:

- Move multi-page detection into worker jobs.
- Cache rendered PDF pages.
- Precompute component templates at multiple orientations.
- Use page regions to reduce search area.
- Keep AI review optional and post-processing only.

## PrecisionPDF

Owns:

- PDF review.
- Annotation tools.
- Search and navigation.
- Markup export.
- Reviewer interaction layer.

Consumes:

- Uploaded PDFs.
- Workspace file state.
- Future project document records.

Must not own:

- Instrument extraction logic.
- Piping MTO detection logic.
- SQLite engineering schema except document/review metadata when added.

Future enhancement scope:

- Persistent review sessions.
- Comment threads.
- Stamp sets for EPC workflows.
- Markup import/export.
- Drawing comparison.
- Review package generation.

Performance work:

- Virtualize thumbnails.
- Lazy render pages.
- Cache rendered canvases by zoom/page.
- Keep annotations separate from PDF rendering.

## AI Grid

Owns:

- Spreadsheet-like editing of shared engineering tables.
- Sorting, filtering, layout, save/discard.
- Staging AI suggestions before DB write.

Consumes:

- SQLite instrument/project tables.
- Engineering Team suggestions.
- Project Intelligence summaries.

Must not own:

- Instrument extraction.
- FlowSizing math.
- Model prompts beyond grid review requests.

Future enhancement scope:

- Excel-like copy/paste.
- Multi-cell fill down.
- Saved views per user/project.
- Validation rules per field.
- Revision/audit panel.
- Conflict detection for manual vs AI updates.

Performance work:

- Row virtualization for large projects.
- Server-side filtering and pagination for 10k+ rows.
- Debounced autosave option.
- Partial reload after save.

## FlowSizing

Owns:

- Process/sizing input forms.
- Calculation engines.
- Sizing result storage.
- Sizing reports/datasheets.

Consumes:

- Instruments from SQLite.
- Process data from SQLite.
- Project units/settings.

Must not own:

- Instrumap extraction.
- MTO detection.
- General AI grid behavior.

Future enhancement scope:

- Control valve datasheets.
- Relief valve sizing package.
- Restriction orifice sizing.
- Batch sizing readiness checks.
- Calculation validation against EPC standards.
- Report revision control.

Performance work:

- Cache calculation inputs/results.
- Separate large report generation into worker jobs.
- Keep equations pure and testable.

## Project Intelligence

Owns:

- Read-only project memory summaries.
- Discipline-specific project questions.
- Evidence gathering across shared tables.
- Model fallback and model status.

Consumes:

- SQLite shared DB.
- Role-specific XYRA engineer models.

Must not own:

- Silent DB updates.
- Tool-specific detailed workflows.
- Long-running extraction or calculation jobs.

Future enhancement scope:

- Cached project memory snapshots.
- Issue/action register.
- Cross-discipline readiness dashboard.
- Natural language query over project DB.
- Model-assisted bulk suggestions with review staging.

Performance work:

- Add summary cache table when project DB grows.
- Keep evidence row limits strict.
- Use indexed SQL only.
- Avoid sending full DB data to models.

## System Health

Owns:

- Client-visible compute status.
- API, Redis, worker, Ollama, and model health.
- Queue and failed job counters.
- Deployment confidence screen.

Consumes:

- Backend health endpoint.
- Redis/RQ status.
- Ollama model availability.

Must not own:

- Tool workflows.
- Debug actions that can mutate production data unless explicitly gated.

Future enhancement scope:

- Log viewer.
- Failed job drill-down.
- One-click diagnostic bundle.
- DB size and backup status.
- License status.
- Deployment readiness score.

Performance work:

- Poll less often when tab is hidden.
- Cache model metadata.
- Keep health endpoint cheap and read-only.

