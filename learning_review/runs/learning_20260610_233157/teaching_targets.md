# Teaching Targets

Use this file to decide what becomes deterministic code, project legend work, or model teaching.

## Counts

- By fix type: `{"manual_review": 44, "model_prompt": 2}`
- By field: `{"line_tag": 33, "service": 13}`

## Top Groups

### manual_review / line_tag (33)

- `instrument_index` `13-LT-2602` CRITICAL: Hardwired IO (AI) with no connected line/equipment tag.
- `instrument_index` `AS-22TO` CRITICAL: Hardwired IO (DI) with no connected line/equipment tag.
- `instrument_index` `AS-PE1695-IN` CRITICAL: Hardwired IO (DI) with no connected line/equipment tag.
- `instrument_index` `AS-PE3141` CRITICAL: Hardwired IO (DI) with no connected line/equipment tag.
- `instrument_index` `CS-130` CRITICAL: Hardwired IO (DI) with no connected line/equipment tag.
- `instrument_index` `CS-140` CRITICAL: Hardwired IO (DI) with no connected line/equipment tag.
- `instrument_index` `DRUMS-2139` CRITICAL: Hardwired IO (DI) with no connected line/equipment tag.
- `instrument_index` `FCV-1514` CRITICAL: Hardwired IO (AO) with no connected line/equipment tag.

### manual_review / service (11)

- `instrument_index` `13-LT-2602` HIGH: Service description has low confidence (0.35).
- `instrument_index` `AS-PE1695-IN` HIGH: Service description has low confidence (0.35).
- `instrument_index` `AS-PE3141` HIGH: Service description has low confidence (0.35).
- `instrument_index` `CS-130` HIGH: Service description has low confidence (0.35).
- `instrument_index` `FE-1001` MEDIUM: Service description has low confidence (0.35).
- `instrument_index` `FE-1002` MEDIUM: Service description has low confidence (0.35).
- `instrument_index` `FE-1005` MEDIUM: Service description has low confidence (0.35).
- `instrument_index` `CH1` MEDIUM: Service is 'Review required' and io_type is 'REVIEW'.

### model_prompt / service (2)

- `io_list` `FT-1006` HIGH: Service description is generic ('Flow measurement'); lacks process context.
- `io_list` `LIMIT-11055` MEDIUM: Service description is generic ('Level measurement'); lacks process context.
