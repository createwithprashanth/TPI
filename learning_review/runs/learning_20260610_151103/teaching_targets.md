# Teaching Targets

Use this file to decide what becomes deterministic code, project legend work, or model teaching.

## Counts

- By fix type: `{"deterministic_rule": 3, "manual_review": 40}`
- By field: `{"category": 1, "instrument_type": 3, "io_type": 1, "line_tag": 19, "review_required": 3, "service": 3, "signal_type": 9, "system": 4}`

## Top Groups

### manual_review / line_tag (19)

- `instrument_index` `CC-26` CRITICAL: Missing line tag assignment.
- `instrument_index` `CC-573P-01` CRITICAL: Missing line tag assignment.
- `instrument_index` `FE-1203P-01` HIGH: Missing line tag assignment.
- `io_list` `CVZI-573P-02` HIGH: Missing process line or equipment tag for hardwired IO.
- `io_list` `PPHS-573P-01A` HIGH: Missing process line or equipment tag for hardwired IO.
- `io_list` `PSAH-573P-47` HIGH: Missing process line or equipment tag for hardwired IO.
- `io_list` `PSAH-573P-48` HIGH: Missing process line or equipment tag for hardwired IO.
- `io_list` `PSAL-1370P-20` HIGH: Missing process line or equipment tag for hardwired IO.

### manual_review / signal_type (6)

- `instrument_index` `FIC-1375P-01` MEDIUM: Signal type is blank for a controller.
- `instrument_index` `HIC-1375P-01` MEDIUM: Signal type is blank for a controller.
- `instrument_index` `PI-1375P-10` MEDIUM: Signal type is blank for a field device.
- `instrument_index` `PIC-1375P-01` MEDIUM: Signal type is blank for a controller.
- `instrument_index` `TE-1375P-05` MEDIUM: Signal type is blank for a passive device.
- `instrument_index` `TE-1375P-06` MEDIUM: Signal type is blank for a passive device.

### manual_review / system (4)

- `io_list` `PT-1203P-05` MEDIUM: System not specified as SIS/ESD for pressure transmitter on safety-critical service.
- `io_list` `PT-1203P-10` MEDIUM: System not specified as SIS/ESD for pressure transmitter on safety-critical service.
- `io_list` `SSV-1370P-26` MEDIUM: System listed as SIS/ESD; confirm if correct for this shutdown valve.
- `io_list` `SSV-1414P-02` MEDIUM: System listed as SIS/ESD; confirm if correct for this shutdown valve.

### deterministic_rule / signal_type (3)

- `instrument_index` `TW-1375P-04` LOW: Signal type is blank for a passive device (thermowell).
- `instrument_index` `TW-1375P-05` LOW: Signal type is blank for a passive device (thermowell).
- `instrument_index` `TW-1375P-06` LOW: Signal type is blank for a passive device (thermowell).

### manual_review / instrument_type (3)

- `instrument_index` `SPARE-14` HIGH: Instrument type 'SPARE' is not standard and should be clarified or mapped to project legend.
- `instrument_index` `SPARE-15-27` HIGH: Instrument type 'SPARE' is not standard and should be clarified or mapped to project legend.
- `instrument_index` `SPARE-25` HIGH: Instrument type 'SPARE' is not standard and should be clarified or mapped to project legend.

### manual_review / review_required (3)

- `instrument_index` `CC-26` HIGH: Review flag is set, but no specific review reason is documented.
- `instrument_index` `CC-573P-01` HIGH: Review flag is set, but no specific review reason is documented.
- `instrument_index` `FE-1203P-01` HIGH: Review flag is set, but no specific review reason is documented.

### manual_review / service (3)

- `instrument_index` `CC-26` CRITICAL: Service description has very low confidence (0.35) and is generic.
- `instrument_index` `CC-573P-01` CRITICAL: Service description has very low confidence (0.35) and is generic.
- `instrument_index` `FE-1203P-01` HIGH: Service description is generic ('Flow element') with low confidence (0.35).

### manual_review / category (1)

- `instrument_index` `CVZI-573P-02` HIGH: Category is 'field_device' but location is 'Panel', which may be inconsistent.

### manual_review / io_type (1)

- `io_list` `CVZI-573P-02` MEDIUM: CVZI (Control Valve Position Indication) is typically AI, not DI.
