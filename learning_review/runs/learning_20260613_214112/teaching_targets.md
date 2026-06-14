# Teaching Targets

Use this file to decide what becomes deterministic code, project legend work, or model teaching.

## Counts

- By fix type: `{"manual_review": 42}`
- By field: `{"geometry_evidence": 4, "line_tag": 14, "notes": 4, "review_required": 5, "service": 15}`

## Top Groups

### manual_review / service (15)

- `instrument_index` `FE-1414P-26` HIGH: Service description has low confidence and is based only on tag type.
- `instrument_index` `FE-1762P-12` HIGH: Service description has low confidence and is based only on tag type.
- `instrument_index` `FIC-1414P-26` HIGH: Service description has low confidence and is based only on tag type.
- `instrument_index` `FIC-1762P-12` HIGH: Service description has low confidence and is based only on tag type.
- `instrument_index` `PSAL-1762P-25` HIGH: Service description has low confidence and is based only on tag type.
- `instrument_index` `PSDL-1762P-25` HIGH: Service description has low confidence and is based only on tag type.
- `instrument_index` `PSDH-1762P-02` MEDIUM: Service description has low confidence and is based only on tag type.
- `instrument_index` `PSDH-1762P-14` MEDIUM: Service description has low confidence and is based only on tag type.

### manual_review / line_tag (14)

- `instrument_index` `FE-1414P-26` HIGH: No line association; geometry evidence does not provide a line.
- `instrument_index` `FE-1762P-12` HIGH: No line association; geometry evidence does not provide a line.
- `instrument_index` `FIC-1414P-26` HIGH: No line association; geometry evidence is absent.
- `instrument_index` `FIC-1762P-12` HIGH: No line association; geometry evidence is absent.
- `instrument_index` `PSAL-1762P-25` CRITICAL: Hardwired IO (DI) with no connected line or equipment tag; geometry evidence is absent.
- `instrument_index` `SSV-1414P-02` CRITICAL: Hardwired IO (DO) with no connected line or equipment tag; geometry evidence is absent.
- `instrument_index` `SSV-1414P-07` CRITICAL: Hardwired IO (DO) with no connected line or equipment tag; geometry evidence is absent.
- `instrument_index` `SSV-1762P-08` CRITICAL: Hardwired IO (DO) with no connected line or equipment tag; geometry evidence is absent.

### manual_review / review_required (5)

- `io_list` `SSV-1414P-02` MEDIUM: Review required flag is set but no clear path to resolve without additional evidence.
- `io_list` `SSV-1414P-07` MEDIUM: Review required flag is set but no clear path to resolve without additional evidence.
- `io_list` `SSV-1762P-08` MEDIUM: Review required flag is set but no clear path to resolve without additional evidence.
- `io_list` `PSAL-1762P-25` MEDIUM: Review required flag is set but no clear path to resolve without additional evidence.
- `io_list` `VENT-5000-IN` MEDIUM: Review required flag is set but no clear path to resolve without additional evidence.

### manual_review / geometry_evidence (4)

- `io_list` `SSV-1414P-02` MEDIUM: Geometry evidence links to another SSV, not a process line or equipment.
- `io_list` `SSV-1414P-07` MEDIUM: Geometry evidence links to another SSV, not a process line or equipment.
- `io_list` `SSV-1762P-08` MEDIUM: Geometry evidence links to another SSV, not a process line or equipment.
- `io_list` `VENT-5000-IN` MEDIUM: Geometry evidence links to equipment but not to a process line.

### manual_review / notes (4)

- `io_list` `SSV-1414P-02` MEDIUM: Notes indicate SSV shutdown valve but do not clarify missing line/equipment association.
- `io_list` `SSV-1414P-07` MEDIUM: Notes indicate SSV shutdown valve but do not clarify missing line/equipment association.
- `io_list` `SSV-1762P-08` MEDIUM: Notes indicate SSV shutdown valve but do not clarify missing line/equipment association.
- `io_list` `PSAL-1762P-25` MEDIUM: Notes indicate tag type only; no line/equipment association.
