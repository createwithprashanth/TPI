# Teaching Targets

Use this file to decide what becomes deterministic code, project legend work, or model teaching.

## Counts

- By fix type: `{"manual_review": 44}`
- By field: `{"line_candidates": 4, "line_tag": 31, "loop_context": 7, "service": 2}`

## Top Groups

### manual_review / line_tag (31)

- `instrument_index` `FE-1414P-26` CRITICAL: No confirmed line_tag; conflicting loop context and nearest line label only.
- `instrument_index` `FE-1762P-12` CRITICAL: No confirmed line_tag; conflicting loop context and nearest line label only.
- `instrument_index` `FIC-1414P-26` HIGH: No confirmed line_tag; only weak loop context and distant nearest line label.
- `instrument_index` `FIC-1762P-12` HIGH: No confirmed line_tag; only weak loop context and distant nearest line label.
- `instrument_index` `PIC-1414P-26` HIGH: No confirmed line_tag; conflicting loop context and weak nearest line label.
- `instrument_index` `PIC-1762P-12` HIGH: No confirmed line_tag; conflicting loop context and weak nearest line label.
- `instrument_index` `PSAL-1762P-25` CRITICAL: No line_tag or equipment association for hardwired IO device.
- `instrument_index` `PSDH-1762P-02` HIGH: Conflicting loop context; no confirmed line_tag.

### manual_review / loop_context (7)

- `io_list` `FCV-1414P-26` MEDIUM: Conflicting loop/line context detected for FCV-1414P-26 and associated FIT/FQI/FZT.
- `io_list` `FCV-1762P-12` MEDIUM: Conflicting loop/line context detected for FCV-1762P-12 and associated FIT/FQI/FZT.
- `io_list` `FIT-1414P-26` MEDIUM: Conflicting loop/line context detected for FIT-1414P-26 and associated FCV/FQI/FZT.
- `io_list` `FIT-1762P-12` MEDIUM: Conflicting loop/line context detected for FIT-1762P-12 and associated FCV/FQI/FZT.
- `io_list` `FZT-1414P-26` MEDIUM: Conflicting loop/line context detected for FZT-1414P-26 and associated FCV/FQI/FIT.
- `io_list` `FZT-1762P-12` MEDIUM: Conflicting loop/line context detected for FZT-1762P-12 and associated FCV/FQI/FIT.
- `io_list` `PIT-1762P-02` LOW: Loop context line (4-PO-27769-FC1L6C-FX-P) differs from direct line (4-PO-27769-FC1L6C-FX-PSP); verify if these are equivalent or distinct.

### manual_review / line_candidates (4)

- `io_list` `CVA-1762P-01` LOW: Multiple candidate lines with similar confidence; ensure correct selection.
- `io_list` `PIT-1762P-04` LOW: Multiple candidate lines with similar confidence; ensure correct selection.
- `io_list` `PIT-1414P-30` LOW: Multiple candidate lines with similar confidence; ensure correct selection.
- `io_list` `PIT-1414P-31` LOW: Multiple candidate lines with similar confidence; ensure correct selection.

### manual_review / service (2)

- `instrument_index` `RO-1414P-03` LOW: Service description has low confidence; fallback used.
- `instrument_index` `RO-1762P-03` LOW: Service description has low confidence; fallback used.
