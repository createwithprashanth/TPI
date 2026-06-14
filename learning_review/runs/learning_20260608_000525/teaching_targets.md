# Teaching Targets

Use this file to decide what becomes deterministic code, project legend work, or model teaching.

## Counts

- By fix type: `{"deterministic_rule": 2, "manual_review": 57}`
- By field: `{"duplicate_grouping": 2, "end_connection": 5, "instrument_type": 4, "line_tag": 19, "material_description": 2, "piping_class": 5, "rating": 5, "service": 14, "system": 3}`

## Top Groups

### manual_review / line_tag (19)

- `instrument_index` `FE-1203P-01` CRITICAL: Missing line_tag for flow element.
- `instrument_index` `SSV-1370P-26` CRITICAL: Missing line_tag for shutdown valve.
- `instrument_index` `SSV-1414P-02` CRITICAL: Missing line_tag for shutdown valve.
- `io_list` `CVZI-573P-02` HIGH: Missing process line or equipment tag for control valve position indication.
- `io_list` `PPHS-573P-01A` HIGH: Missing process line or equipment tag for pressure switch.
- `io_list` `PSAH-573P-47` HIGH: Missing process line or equipment tag for pressure switch.
- `io_list` `PSAH-573P-48` HIGH: Missing process line or equipment tag for pressure switch.
- `io_list` `PSAL-1370P-20` HIGH: Missing process line or equipment tag for pressure switch.

### manual_review / service (14)

- `instrument_index` `CC-26` CRITICAL: Low service field confidence (0.35) and generic description.
- `instrument_index` `CC-573P-01` CRITICAL: Low service field confidence (0.35) and generic description.
- `instrument_index` `FE-1203P-01` HIGH: Low service field confidence (0.35) and generic description.
- `instrument_index` `FE-1370P-01` HIGH: Low service field confidence (0.35) and generic description.
- `instrument_index` `FE-1375P-01` HIGH: Low service field confidence (0.35) and generic description.
- `instrument_index` `FE-1414P-26` HIGH: Low service field confidence (0.35) and generic description.
- `instrument_index` `FE-1762P-12` HIGH: Low service field confidence (0.35) and generic description.
- `instrument_index` `FIC-1203P-01` HIGH: Low service field confidence (0.35) and generic description.

### manual_review / end_connection (5)

- `piping_mto` `H.1` HIGH: End connection missing.
- `piping_mto` `H.2` HIGH: End connection missing.
- `piping_mto` `H.3` HIGH: End connection missing.
- `piping_mto` `H.4` HIGH: End connection missing.
- `piping_mto` `H.5` HIGH: End connection missing.

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

### manual_review / instrument_type (4)

- `instrument_index` `PANEL-34` HIGH: Instrument type 'PANEL' is not standard for instrument index.
- `instrument_index` `SPARE-14` HIGH: Instrument type 'SPARE' is not standard for instrument index.
- `instrument_index` `SPARE-15-27` HIGH: Instrument type 'SPARE' is not standard for instrument index.
- `instrument_index` `SPARE-25` HIGH: Instrument type 'SPARE' is not standard for instrument index.

### manual_review / system (3)

- `instrument_index` `PI-1203P-03` HIGH: Missing system assignment.
- `instrument_index` `PI-1370P-10` HIGH: Missing system assignment.
- `instrument_index` `PI-1375P-10` HIGH: Missing system assignment.

### deterministic_rule / material_description (2)

- `piping_mto` `H.2` HIGH: Material description missing.
- `piping_mto` `H.4` HIGH: Material description missing.

### manual_review / duplicate_grouping (2)

- `piping_mto` `H.2` HIGH: Duplicate entry for 3/4 inch ball valve (see H.1 and H.2).
- `piping_mto` `H.4` HIGH: Duplicate entry for 2 inch ball valve (see H.4 and H.5).
