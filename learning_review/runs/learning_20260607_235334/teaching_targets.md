# Teaching Targets

Use this file to decide what becomes deterministic code, project legend work, or model teaching.

## Counts

- By fix type: `{"deterministic_rule": 2, "manual_review": 57, "mto_grouping": 2}`
- By field: `{"duplicate_grouping": 2, "end_connection": 5, "line_tag": 21, "material_description": 2, "piping_class": 5, "rating": 5, "service": 12, "signal_type, system, supply_voltage": 1, "system": 3, "valve_bore": 5}`

## Top Groups

### manual_review / line_tag (21)

- `instrument_index` `CC-26` CRITICAL: Missing line tag.
- `instrument_index` `CC-573P-01` CRITICAL: Missing line tag.
- `instrument_index` `FE-1203P-01` CRITICAL: Missing line tag.
- `instrument_index` `FE-1370P-01` CRITICAL: Missing line tag.
- `instrument_index` `FE-1375P-01` CRITICAL: Missing line tag.
- `io_list` `CVZI-573P-02` HIGH: Missing process line or equipment tag for control valve position indication.
- `io_list` `PPHS-573P-01A` HIGH: Missing process line or equipment tag for pressure switch.
- `io_list` `PSAH-573P-47` HIGH: Missing process line or equipment tag for pressure switch.

### manual_review / service (12)

- `instrument_index` `CC-26` HIGH: Low service confidence (0.35) and generic description.
- `instrument_index` `CC-573P-01` HIGH: Low service confidence (0.35) and generic description.
- `instrument_index` `FE-1203P-01` HIGH: Low service confidence (0.35) and generic 'Flow element' description.
- `instrument_index` `FE-1370P-01` HIGH: Low service confidence (0.35) and generic description.
- `instrument_index` `FE-1375P-01` HIGH: Low service confidence (0.35) and generic description.
- `instrument_index` `FE-1414P-26` HIGH: Low service confidence (0.35) and generic description.
- `instrument_index` `FE-1762P-12` HIGH: Low service confidence (0.35) and generic description.
- `instrument_index` `FIC-1203P-01` HIGH: Low service confidence (0.35) and generic 'Process flow control' description.

### manual_review / end_connection (5)

- `piping_mto` `H.1` HIGH: End connection is missing.
- `piping_mto` `H.2` HIGH: End connection is missing.
- `piping_mto` `H.3` HIGH: End connection is missing.
- `piping_mto` `H.4` HIGH: End connection is missing.
- `piping_mto` `H.5` HIGH: End connection is missing.

### manual_review / piping_class (5)

- `piping_mto` `H.1` CRITICAL: Piping class is missing.
- `piping_mto` `H.2` CRITICAL: Piping class is missing.
- `piping_mto` `H.3` CRITICAL: Piping class is missing.
- `piping_mto` `H.4` CRITICAL: Piping class is missing.
- `piping_mto` `H.5` CRITICAL: Piping class is missing.

### manual_review / rating (5)

- `piping_mto` `H.1` CRITICAL: Pressure rating is missing.
- `piping_mto` `H.2` CRITICAL: Pressure rating is missing.
- `piping_mto` `H.3` CRITICAL: Pressure rating is missing.
- `piping_mto` `H.4` CRITICAL: Pressure rating is missing.
- `piping_mto` `H.5` CRITICAL: Pressure rating is missing.

### manual_review / valve_bore (5)

- `piping_mto` `H.1` MEDIUM: Valve bore is missing.
- `piping_mto` `H.2` MEDIUM: Valve bore is missing.
- `piping_mto` `H.3` MEDIUM: Valve bore is missing.
- `piping_mto` `H.4` MEDIUM: Valve bore is missing.
- `piping_mto` `H.5` MEDIUM: Valve bore is missing.

### manual_review / system (3)

- `instrument_index` `PI-1203P-03` MEDIUM: Missing system assignment.
- `instrument_index` `PI-1370P-10` MEDIUM: Missing system assignment.
- `instrument_index` `PI-1375P-10` MEDIUM: Missing system assignment.

### deterministic_rule / material_description (2)

- `piping_mto` `H.2` CRITICAL: Material description is missing.
- `piping_mto` `H.4` CRITICAL: Material description is missing.

### mto_grouping / duplicate_grouping (2)

- `piping_mto` `H.1` HIGH: Possible duplicate entry for 3/4 inch ball valve (H.1 and H.2).
- `piping_mto` `H.4` HIGH: Possible duplicate entry for 2 inch ball valve (H.4 and H.5).

### manual_review / signal_type, system, supply_voltage (1)

- `io_list` `FI-1414P-02` MEDIUM: Missing signal type, system, and supply voltage for flow indication.
