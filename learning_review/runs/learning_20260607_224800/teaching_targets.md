# Teaching Targets

Use this file to decide what becomes deterministic code, project legend work, or model teaching.

## Counts

- By fix type: `{"deterministic_rule": 3, "manual_review": 59, "project_legend": 4}`
- By field: `{"category": 4, "datasheet_document_no": 1, "datasheet_reference_no": 1, "duplicate_grouping": 1, "end_connection": 5, "io_type": 1, "line_tag": 25, "material_description": 2, "piping_class": 5, "rating": 5, "remarks": 1, "service": 10, "size_inch": 1, "supply_voltage": 1, "system": 2, "valve_bore": 1}`

## Top Groups

### manual_review / line_tag (24)

- `instrument_index` `FE-1203P-01` MEDIUM: Line tag is missing.
- `instrument_index` `FE-1370P-01` MEDIUM: Line tag is missing.
- `instrument_index` `FE-1375P-01` MEDIUM: Line tag is missing.
- `instrument_index` `FE-1414P-26` MEDIUM: Line tag is missing.
- `instrument_index` `FE-1762P-12` MEDIUM: Line tag is missing.
- `io_list` `LIFT-109` HIGH: Missing line or equipment tag for process level transmitter.
- `io_list` `LIFT-113` HIGH: Missing line or equipment tag for process level transmitter.
- `io_list` `LIFT-128` HIGH: Missing line or equipment tag for process level transmitter.

### manual_review / service (10)

- `instrument_index` `CALL-08` HIGH: Service description confidence is low (0.35), and description is generic.
- `instrument_index` `CC-26` HIGH: Service description confidence is low (0.35), and description is generic.
- `instrument_index` `CC-573P-01` HIGH: Service description confidence is low (0.35), and description is generic.
- `instrument_index` `FIRE-40` HIGH: Service description 'Flow Indicating Element' is likely a fallback and may not match the tag type.
- `instrument_index` `FLAME-40` HIGH: Service description 'Process flow low-low alarm' does not match typical FLAME detector function.
- `instrument_index` `FLOW-251482-P` HIGH: Service description 'Flow Low Well' is unclear and likely a fallback.
- `instrument_index` `GATE-24` HIGH: Service description is generic and confidence is low.
- `instrument_index` `PI-1203P-03` MEDIUM: Service description is generic and confidence is low.

### manual_review / end_connection (5)

- `piping_mto` `H.1` CRITICAL: Missing end connection type.
- `piping_mto` `H.2` CRITICAL: Missing end connection type.
- `piping_mto` `H.3` CRITICAL: Missing end connection type.
- `piping_mto` `H.4` CRITICAL: Missing end connection type.
- `piping_mto` `H.5` CRITICAL: Missing end connection type.

### manual_review / piping_class (5)

- `piping_mto` `H.1` HIGH: Missing piping class.
- `piping_mto` `H.2` HIGH: Missing piping class.
- `piping_mto` `H.3` HIGH: Missing piping class.
- `piping_mto` `H.4` HIGH: Missing piping class.
- `piping_mto` `H.5` HIGH: Missing piping class.

### manual_review / rating (5)

- `piping_mto` `H.1` CRITICAL: Missing pressure rating.
- `piping_mto` `H.2` CRITICAL: Missing pressure rating.
- `piping_mto` `H.3` CRITICAL: Missing pressure rating.
- `piping_mto` `H.4` CRITICAL: Missing pressure rating.
- `piping_mto` `H.5` CRITICAL: Missing pressure rating.

### project_legend / category (3)

- `instrument_index` `CVZI-573P-02` MEDIUM: Category is missing for a control valve position indicator.
- `instrument_index` `FIC-1203P-01` MEDIUM: Category is missing for controller.
- `instrument_index` `HIC-1203P-01` MEDIUM: Category is missing for controller.

### deterministic_rule / material_description (2)

- `piping_mto` `H.2` CRITICAL: Material description is missing.
- `piping_mto` `H.4` CRITICAL: Material description is missing.

### manual_review / system (2)

- `instrument_index` `PI-1203P-01` MEDIUM: System field is blank for a field device.
- `io_list` `FI-1414P-02` MEDIUM: Missing system assignment for flow indicator.

### deterministic_rule / line_tag (1)

- `instrument_index` `HSD-1414P-30` HIGH: Line tag field contains 'Review_required=true' instead of a valid line tag or being left blank.

### manual_review / category (1)

- `instrument_index` `GAS-30` MEDIUM: Category is 'field_device' but service is generic; confirm if correct.

### manual_review / datasheet_document_no (1)

- `piping_mto` `-` MEDIUM: Datasheet document number is missing for all entries.

### manual_review / datasheet_reference_no (1)

- `piping_mto` `-` MEDIUM: Datasheet reference number is missing for all entries.

### manual_review / duplicate_grouping (1)

- `piping_mto` `-` HIGH: Multiple entries for ball valves of the same size (e.g., H.1 and H.2 for 3/4 inch, H.4 and H.5 for 2 inch) may indicate duplicate grouping.

### manual_review / remarks (1)

- `piping_mto` `-` MEDIUM: All entries are seeded from the legend, but no cross-reference to P&ID or tag numbers.

### manual_review / size_inch (1)

- `piping_mto` `-` MEDIUM: Size is present but not explicitly evidenced from P&ID or legend; reliance on legend only may be risky.

### manual_review / supply_voltage (1)

- `io_list` `FI-1414P-02` MEDIUM: Missing supply voltage for flow indicator.

### manual_review / valve_bore (1)

- `piping_mto` `-` MEDIUM: Valve bore (full/reduced) is not specified.

### project_legend / io_type (1)

- `instrument_index` `FE-1203P-01` MEDIUM: IO type is missing for flow element.
