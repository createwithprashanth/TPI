```markdown
# XYRA Studio Local LLM Modelfile Teaching: P&ID, Instrumentation, and Piping MTO

## Executive Teaching Summary

This document distills key, actionable rules and guidance for local XYRA Studio models to extract, interpret, and benchmark P&ID (Piping & Instrumentation Diagram) data. It covers deterministic extraction rules, prompt guidance, review triggers, and negative examples for P&ID reading, instrument index/IO list creation, line/service inference, and piping MTO (Material Take-Off). All rules are derived from referenced source files and are designed for robust, auditable model behavior.

---

## Common P&ID Reading Rules For All XYRA Models

- **P&IDs are schematic, not to scale.** Do not infer physical layout or dimensions.
- **All equipment, piping, valves, and instruments must be identified by tag or symbol.**
- **Symbols and abbreviations must be interpreted per project legend.** If legend is missing, flag for review.
- **P&IDs are grouped by process section; each sheet may only show part of the system.**
- **Revisions and notes are critical; always check for latest revision and associated notes.**
- **Do not infer control logic beyond what is explicitly shown (e.g., interlocks, fail actions).**
- **All connections (process, utility, instrument) must be traced to their endpoints or flagged as ambiguous.**

---

## Teach xyra-pid-engineer

### Deterministic Extraction Rules

- Extract all equipment, piping, valves, and instrument tags as unique entities.
- Capture all line numbers, sizes, and specifications where present.
- Identify and record all connections (including off-page connectors).
- Extract all revision notes, general notes, and sheet legends.
- If a symbol or abbreviation is not in the legend, flag as "project legend required".

### Prompt Guidance

- "List all equipment and instrument tags with their associated symbols and connections."
- "For each line, extract size, spec, and service if present; otherwise, flag as incomplete."

### Negative Examples & Review Triggers

- If a line or instrument is shown without a tag or symbol, flag for review.
- If a connection is ambiguous (e.g., off-page with no destination), flag for human check.

---

## Teach xyra-instrumentation-engineer

### Deterministic Extraction Rules

- Extract all instrument tags, loop numbers, and function designations.
- Map each instrument to its process connection and control loop.
- Identify instrument types (e.g., transmitter, controller, indicator) using ISA/ISO symbols.
- Extract IO type (AI, AO, DI, DO) where shown or infer from function, but flag if ambiguous.

### Prompt Guidance

- "For each instrument, extract tag, type, loop number, and IO type."
- "If instrument function or service is unclear, flag for review."

### Negative Examples & Review Triggers

- If instrument tag format does not match project standard, flag for legend check.
- If instrument is shown without a process connection, flag as incomplete.

---

## Teach xyra-line-mapper

### Deterministic Extraction Rules

- Extract all line numbers, sizes, specs, and services.
- Map each line to its start and end equipment or process node.
- Identify line type (process, utility, drain, vent) using legend or standard symbology.
- If service or spec is missing, flag as "service/spec required".

### Prompt Guidance

- "For each line, extract number, size, spec, service, and endpoints."
- "If line crosses sheets, ensure continuity or flag for review."

### Negative Examples & Review Triggers

- If line number is reused for different services, flag as potential error.
- If line endpoint is not connected to equipment or another line, flag as incomplete.

---

## Teach xyra-piping-engineer And xyra-mto-reviewer

### Deterministic Extraction Rules

- Extract all piping components (pipe, fittings, valves, specialties) with size and spec.
- For each line, generate a material take-off (MTO) list by counting all components.
- Include all inline instruments and specialty items in MTO.
- If component spec or size is missing, flag for review.

### Prompt Guidance

- "Generate MTO for each line, listing all components by size and spec."
- "If component cannot be identified, flag as 'unknown item'."

### Negative Examples & Review Triggers

- If MTO count does not match visible components, flag for human check.
- If valve or fitting symbol is ambiguous, flag for legend review.

---

## Instrument Service Writing Rules

- Instrument service description must be based on tag, function, and process connection.
- Use standard ISA/ISO function designations where possible.
- If service cannot be determined from diagram, flag as "service description required".
- Do not invent or assume client-specific tag meanings.

---

## Noise Rejection Rules

- Ignore decorative, non-functional symbols or artwork.
- Ignore non-P&ID sheets (e.g., civil, architectural, electrical) unless explicitly referenced.
- Reject extraction from notes unrelated to process, piping, or instrumentation.
- Ignore duplicate or obsolete revision clouds unless marked as current.

---

## Project Legend Rules

- Always extract and reference the project legend for symbols, abbreviations, and tag formats.
- If legend is missing or incomplete, flag all ambiguous symbols/tags as "project legend required".
- Do not attempt to interpret non-standard symbols without legend confirmation.

---

## Benchmark Cases To Add

- P&ID sheets with missing or ambiguous legends (test legend handling).
- Lines with reused numbers for different services (test error detection).
- Instruments with non-standard tag formats (test legend requirement).
- P&IDs with off-page connectors and incomplete connections (test continuity checks).
- MTOs with missing or ambiguous component specs (test review triggers).

---

## Modelfile Insert Blocks

### Deterministic Rule Block Example

```yaml
- rule: "Extract all equipment, piping, valves, and instrument tags as unique entities."
- rule: "Flag any symbol or abbreviation not found in the project legend as 'project legend required'."
- rule: "For each line, extract number, size, spec, service, and endpoints; flag if incomplete."
```

### Prompt Guidance Block Example

```yaml
- prompt: "List all instrument tags, types, loop numbers, and IO types. Flag any ambiguous or missing data."
- prompt: "Generate MTO for each line, listing all components by size and spec. Flag unknown items."
```

---

## Open Questions For Human EPC Review

- What is the correct interpretation for non-standard instrument tag formats not in the legend?
- How should ambiguous off-page connections be resolved if not shown on any sheet?
- Are there project-specific rules for line numbering or service designation not covered by standard?
- Should duplicate line numbers across different services be treated as error or project convention?

---

## Source Traceability

- **pid_aiche_barkel.pdf**: P&ID purpose, schematic nature, revision handling, confidentiality.
- **pid_aquaenergyexpo_1.pdf, pid_aquaenergyexpo_2.pdf, pid_aquaenergyexpo_3.pdf**: Instrument loop basics, symbol/legend importance, process control loop structure.
- **pid_klm_standard.pdf**: Minimum P&ID content, legend use, component identification.
- **pid_ou_chedesign.pdf**: Tagging, spare requirements, bypasses, and operational notes.
- **pid_zoho_01.pdf – pid_zoho_11.pdf**: Tag prefixing, legend referencing, manual operation notes, review triggers for ambiguous or missing data.

---
```