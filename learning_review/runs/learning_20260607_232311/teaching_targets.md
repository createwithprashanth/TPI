# Teaching Targets

Use this file to decide what becomes deterministic code, project legend work, or model teaching.

## Counts

- By fix type: `{"deterministic_rule": 3, "manual_review": 40, "mto_grouping": 1, "project_legend": 1}`
- By field: `{"category": 1, "duplicate_grouping": 1, "end_connection": 5, "line_tag": 7, "material_description": 2, "piping_class": 5, "rating": 5, "service": 14, "valve_bore": 5}`

## Top Groups

### manual_review / service (14)

- `instrument_index` `FI-1414P-02` HIGH: Low service confidence (0.65) for flow indication.
- `instrument_index` `CC-26` MEDIUM: Very low service confidence (0.35) for process conductivity control.
- `instrument_index` `CC-573P-01` MEDIUM: Very low service confidence (0.35) for process conductivity control.
- `instrument_index` `FE-1203P-01` MEDIUM: Very low service confidence (0.35) for flow element.
- `instrument_index` `FIC-1203P-01` MEDIUM: Very low service confidence (0.35) for process flow control.
- `instrument_index` `GAS-30` MEDIUM: Very low service confidence (0.35) for instrument switch.
- `instrument_index` `LAL-56113-20` MEDIUM: Very low service confidence (0.35) for process level low alarm.
- `instrument_index` `LC-12` MEDIUM: Very low service confidence (0.35) for process level control.

### manual_review / line_tag (6)

- `instrument_index` `HSD-1414P-30` HIGH: Missing line tag for field device.
- `instrument_index` `HS-1299P-06` HIGH: Missing line tag for field device.
- `instrument_index` `HSD-1370P-30` HIGH: Missing line tag for field device.
- `instrument_index` `HSD-1375P-30` HIGH: Missing line tag for field device.
- `instrument_index` `HSD-1762P-30` HIGH: Missing line tag for field device.
- `instrument_index` `HSD-573P-04` HIGH: Missing line tag for field device.

### manual_review / end_connection (5)

- `piping_mto` `H.1` CRITICAL: Missing end connection type.
- `piping_mto` `H.2` CRITICAL: Missing end connection type.
- `piping_mto` `H.3` CRITICAL: Missing end connection type.
- `piping_mto` `H.4` CRITICAL: Missing end connection type.
- `piping_mto` `H.5` CRITICAL: Missing end connection type.

### manual_review / piping_class (5)

- `piping_mto` `H.1` HIGH: Piping class not specified.
- `piping_mto` `H.2` HIGH: Piping class not specified.
- `piping_mto` `H.3` HIGH: Piping class not specified.
- `piping_mto` `H.4` HIGH: Piping class not specified.
- `piping_mto` `H.5` HIGH: Piping class not specified.

### manual_review / rating (5)

- `piping_mto` `H.1` CRITICAL: Missing pressure rating.
- `piping_mto` `H.2` CRITICAL: Missing pressure rating.
- `piping_mto` `H.3` CRITICAL: Missing pressure rating.
- `piping_mto` `H.4` CRITICAL: Missing pressure rating.
- `piping_mto` `H.5` CRITICAL: Missing pressure rating.

### manual_review / valve_bore (5)

- `piping_mto` `H.1` MEDIUM: Valve bore not specified.
- `piping_mto` `H.2` MEDIUM: Valve bore not specified.
- `piping_mto` `H.3` MEDIUM: Valve bore not specified.
- `piping_mto` `H.4` MEDIUM: Valve bore not specified.
- `piping_mto` `H.5` MEDIUM: Valve bore not specified.

### deterministic_rule / material_description (2)

- `piping_mto` `H.2` CRITICAL: Material description missing.
- `piping_mto` `H.4` CRITICAL: Material description missing.

### deterministic_rule / line_tag (1)

- `io_list` `FI-1414P-02` HIGH: Missing line tag for flow indicator with service referencing a specific process line.

### mto_grouping / duplicate_grouping (1)

- `piping_mto` `H.1` HIGH: Multiple entries for same valve size/type without clear differentiation.

### project_legend / category (1)

- `instrument_index` `CVZI-573P-02` MEDIUM: Missing category for valve position indication.
