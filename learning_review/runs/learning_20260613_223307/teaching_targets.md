# Teaching Targets

Use this file to decide what becomes deterministic code, project legend work, or model teaching.

## Counts

- By fix type: `{"manual_review": 28}`
- By field: `{"line_tag": 26, "service": 2}`

## Top Groups

### manual_review / line_tag (26)

- `instrument_index` `FE-1414P-26` CRITICAL: No line_tag assigned despite multiple candidate lines and conflicting loop context.
- `instrument_index` `FE-1762P-12` CRITICAL: No line_tag assigned; conflicting loop context and multiple candidate lines.
- `instrument_index` `FIC-1414P-26` HIGH: No line_tag assigned; loop context is conflicting and not supported by geometry.
- `instrument_index` `FIC-1762P-12` HIGH: No line_tag assigned; conflicting loop context and low geometry confidence.
- `instrument_index` `PIC-1414P-26` HIGH: No line_tag assigned; conflicting loop context and no geometry support.
- `instrument_index` `PIC-1762P-12` HIGH: No line_tag assigned; conflicting loop context and no geometry support.
- `instrument_index` `PSAL-1762P-25` CRITICAL: No line_tag or geometry evidence for hardwired DI safety switch.
- `instrument_index` `PSDH-1762P-02` HIGH: No line_tag assigned; conflicting loop context and candidate lines.

### manual_review / service (2)

- `instrument_index` `RO-1414P-03` MEDIUM: Service description has low confidence and may be a fallback.
- `instrument_index` `RO-1762P-03` MEDIUM: Service description has low confidence and may be a fallback.
