# Teaching Targets

Use this file to decide what becomes deterministic code, project legend work, or model teaching.

## Counts

- By fix type: `{"deterministic_rule": 39, "manual_review": 23, "mto_grouping": 4, "project_legend": 1}`
- By field: `{"category": 4, "duplicate_grouping": 4, "end_connection": 5, "line_tag": 18, "material_description": 2, "piping_class": 5, "rating": 5, "review_required": 1, "service": 16, "signal_type": 1, "system": 2, "valve_bore": 4}`

## Top Groups

### deterministic_rule / line_tag (16)

- `io_list` `CVZI-573P-02` HIGH: Missing process line or equipment tag for control valve position indication.
- `io_list` `PPHS-573P-01A` HIGH: Missing process line or equipment tag for pressure switch.
- `io_list` `PSAH-573P-47` HIGH: Missing process line or equipment tag for pressure switch.
- `io_list` `PSAH-573P-48` HIGH: Missing process line or equipment tag for pressure switch.
- `io_list` `PSAL-1370P-20` HIGH: Missing process line or equipment tag for pressure switch.
- `io_list` `PSAL-1370P-25` HIGH: Missing process line or equipment tag for pressure switch.
- `io_list` `PSAL-1375P-20` HIGH: Missing process line or equipment tag for pressure switch.
- `io_list` `PSAL-1414P-20` HIGH: Missing process line or equipment tag for pressure switch.

### deterministic_rule / service (16)

- `instrument_index` `CC-26` HIGH: Service field has low confidence (0.35) but review_required is not set.
- `instrument_index` `CC-573P-01` HIGH: Service field has low confidence (0.35) but review_required is not set.
- `instrument_index` `FIC-1203P-01` HIGH: Service field has low confidence (0.35) but review_required is not set.
- `instrument_index` `FIC-1370P-01` HIGH: Service field has low confidence (0.35) but review_required is not set.
- `instrument_index` `FIC-1375P-01` HIGH: Service field has low confidence (0.35) but review_required is not set.
- `instrument_index` `FIC-1414P-26` HIGH: Service field has low confidence (0.35) but review_required is not set.
- `instrument_index` `FIC-1762P-12` HIGH: Service field has low confidence (0.35) but review_required is not set.
- `instrument_index` `GAS-30` HIGH: Service field has low confidence (0.35) but review_required is not set.

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

### deterministic_rule / category (4)

- `instrument_index` `FE-1203P-01` HIGH: Category is 'passive', but review_required is not set despite fallback/low-confidence service.
- `instrument_index` `FE-1370P-01` HIGH: Category is 'passive', but review_required is not set despite fallback/low-confidence service.
- `instrument_index` `FE-1414P-26` HIGH: Category is 'passive', but review_required is not set despite fallback/low-confidence service.
- `instrument_index` `FE-1762P-12` HIGH: Category is 'passive', but review_required is not set despite fallback/low-confidence service.

### manual_review / valve_bore (4)

- `piping_mto` `H.1` MEDIUM: Valve bore is missing.
- `piping_mto` `H.3` MEDIUM: Valve bore is missing.
- `piping_mto` `H.4` MEDIUM: Valve bore is missing.
- `piping_mto` `H.5` MEDIUM: Valve bore is missing.

### mto_grouping / duplicate_grouping (4)

- `piping_mto` `H.1` HIGH: Possible duplicate entry for 3/4 inch ball valve (see H.2).
- `piping_mto` `H.2` HIGH: Possible duplicate entry for 3/4 inch ball valve (see H.1).
- `piping_mto` `H.4` HIGH: Possible duplicate entry for 2 inch ball valve (see H.5).
- `piping_mto` `H.5` HIGH: Possible duplicate entry for 2 inch ball valve (see H.4).

### deterministic_rule / material_description (2)

- `piping_mto` `H.2` CRITICAL: Material description is missing.
- `piping_mto` `H.4` CRITICAL: Material description is missing.

### manual_review / system (2)

- `instrument_index` `PI-1203P-01` MEDIUM: System field is null for a field device in a safety context.
- `io_list` `CVA-1203P-01` MEDIUM: Control valve actuator command is assigned to DCS. Confirm if this should be routed via SIS/ESD for safety-critical valves.

### deterministic_rule / review_required (1)

- `instrument_index` `HSD-1414P-30` HIGH: Review flag is set, but similar low-confidence/fallback entries elsewhere are not flagged.

### manual_review / line_tag (1)

- `io_list` `MSAS-1203P-01` MEDIUM: Line tag format '2-PG-23848-251482-X-N07' is inconsistent with other tags. Confirm if this is intentional.

### manual_review / signal_type (1)

- `io_list` `PT-1203P-05` MEDIUM: Signal type is '4-20mA + HART' but supply voltage is '24VDC (Loop Powered)'. Confirm if HART is supported by system.

### project_legend / line_tag (1)

- `io_list` `PIT-1203P-04` MEDIUM: Line tag 'DN032-PG-23845-251482-X-N' includes pipe size prefix. Confirm if this is per project standard.
