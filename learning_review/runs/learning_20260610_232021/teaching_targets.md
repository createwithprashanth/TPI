# Teaching Targets

Use this file to decide what becomes deterministic code, project legend work, or model teaching.

## Counts

- By fix type: `{"manual_review": 40, "project_legend": 5}`
- By field: `{"instrument_type": 5, "line_tag": 30, "service": 10}`

## Top Groups

### manual_review / line_tag (30)

- `instrument_index` `13-LT-2602` HIGH: Missing line/equipment tag for hardwired AI device.
- `instrument_index` `AS-22TO` HIGH: Missing line/equipment tag for hardwired DI device.
- `instrument_index` `AS-PE1695-IN` HIGH: Missing line/equipment tag for hardwired DI device.
- `instrument_index` `AS-PE3141` HIGH: Missing line/equipment tag for hardwired DI device.
- `instrument_index` `CS-130` HIGH: Missing line/equipment tag for hardwired DI device.
- `instrument_index` `CS-140` HIGH: Missing line/equipment tag for hardwired DI device.
- `instrument_index` `DRUMS-2139` HIGH: Missing line/equipment tag for hardwired DI device.
- `instrument_index` `FCV-1514` HIGH: Missing line/equipment tag for hardwired AO device (control valve).

### manual_review / service (10)

- `instrument_index` `FE-1001` MEDIUM: Service description is low confidence and generic for passive device.
- `instrument_index` `FE-1002` MEDIUM: Service description is low confidence and generic for passive device.
- `instrument_index` `ALL-01-03` MEDIUM: Service description is fallback/uncertain (contains '(?)').
- `instrument_index` `ADCO-1963-ADCO` MEDIUM: Service description has low confidence and is likely a fallback.
- `instrument_index` `ADCO-3844` MEDIUM: Service description has low confidence and is likely a fallback.
- `instrument_index` `AFTER-317-209` MEDIUM: Service description has low confidence and is likely a fallback.
- `instrument_index` `AIR-172` MEDIUM: Service description has low confidence and is likely a fallback.
- `instrument_index` `ASIC-7767` MEDIUM: Service description has low confidence and is likely a fallback.

### project_legend / instrument_type (5)

- `io_list` `FZT-1516` MEDIUM: Instrument type 'FZT' is uncommon; confirm if this is a standard tag for valve position feedback.
- `io_list` `FZT-1526` MEDIUM: Instrument type 'FZT' is uncommon; confirm if this is a standard tag for valve position feedback.
- `io_list` `FZT-1527` MEDIUM: Instrument type 'FZT' is uncommon; confirm if this is a standard tag for valve position feedback.
- `io_list` `CS-130` MEDIUM: Instrument type 'CS' (Conductivity Switch) is not standard ISA; confirm project convention.
- `io_list` `DRUMS-2139` MEDIUM: Instrument type 'DRUMS' is not standard ISA; confirm project convention.
