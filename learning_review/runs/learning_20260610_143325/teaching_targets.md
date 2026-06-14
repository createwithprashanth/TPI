# Teaching Targets

Use this file to decide what becomes deterministic code, project legend work, or model teaching.

## Counts

- By fix type: `{"deterministic_rule": 3, "manual_review": 34}`
- By field: `{"category": 2, "instrument_type": 4, "io_type": 3, "line_tag": 17, "notes": 1, "review_required": 1, "service": 5, "signal_type": 1, "system": 3}`

## Top Groups

### manual_review / line_tag (17)

- `instrument_index` `-` CRITICAL: Line tag is missing for the majority of instruments.
- `io_list` `CVZI-573P-02` HIGH: Missing process line or equipment tag for control valve position indication DI.
- `io_list` `PPHS-573P-01A` HIGH: Missing process line or equipment tag for pressure switch DI.
- `io_list` `PSAH-573P-47` HIGH: Missing process line or equipment tag for pressure switch DI.
- `io_list` `PSAH-573P-48` HIGH: Missing process line or equipment tag for pressure switch DI.
- `io_list` `PSAL-1370P-20` HIGH: Missing process line or equipment tag for pressure low switch DI.
- `io_list` `PSAL-1370P-25` HIGH: Missing process line or equipment tag for pressure low switch DI.
- `io_list` `PSAL-1375P-20` HIGH: Missing process line or equipment tag for pressure low switch DI.

### manual_review / service (5)

- `instrument_index` `-` HIGH: Service descriptions have low confidence (0.35) for most tags.
- `instrument_index` `CC-26` MEDIUM: Service description is generic and low confidence.
- `instrument_index` `CC-573P-01` MEDIUM: Service description is generic and low confidence.
- `instrument_index` `GAS-30` MEDIUM: Service description is generic and low confidence.
- `instrument_index` `GAS-40` MEDIUM: Service description is generic and low confidence.

### manual_review / instrument_type (4)

- `instrument_index` `PANEL-34` MEDIUM: Instrument type 'PANEL' is not standard for instrument index.
- `instrument_index` `VALVE-1000` MEDIUM: Instrument type 'VALVE' is generic and not descriptive.
- `instrument_index` `VALVE-23` MEDIUM: Instrument type 'VALVE' is generic and not descriptive.
- `instrument_index` `VALVE-24` MEDIUM: Instrument type 'VALVE' is generic and not descriptive.

### manual_review / system (3)

- `instrument_index` `PI-1203P-03` MEDIUM: System is missing for PI tag.
- `instrument_index` `PI-1370P-10` MEDIUM: System is missing for PI tag.
- `instrument_index` `PI-1375P-10` MEDIUM: System is missing for PI tag.

### deterministic_rule / io_type (2)

- `instrument_index` `TE-1375P-05` MEDIUM: IO type is 'None' but not consistently applied to all passive elements.
- `instrument_index` `TW-1375P-04` MEDIUM: IO type is 'None' but not consistently applied to all TW tags.

### deterministic_rule / category (1)

- `instrument_index` `TE-1370P-04` MEDIUM: Category is 'passive' but IO type is missing.

### manual_review / category (1)

- `instrument_index` `-` HIGH: Category is missing or inconsistent for many instruments (e.g., controllers, passives, field_device).

### manual_review / io_type (1)

- `instrument_index` `-` HIGH: IO type is missing or set to 'Soft Link' for many field devices and passives.

### manual_review / notes (1)

- `instrument_index` `-` MEDIUM: Notes field often contains only 'tag type only' or 'description fallback'.

### manual_review / review_required (1)

- `instrument_index` `-` HIGH: Many tags are flagged 'For Review' but lack specific review notes or flags.

### manual_review / signal_type (1)

- `instrument_index` `-` HIGH: Signal type is missing for most instruments, especially those with IO type 'Soft Link' or 'None'.
