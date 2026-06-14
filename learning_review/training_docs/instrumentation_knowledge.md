# XYRA Instrumentation Engineering Knowledge Base

This document is a complete domain reference for extracting, classifying, and reviewing instrumentation data from P&ID drawings in EPC and plant engineering projects. It is intended to teach an AI model how a senior instrumentation engineer reads, interprets, and validates a P&ID.

---

## 1. What a P&ID Is and What You Are Looking For

A Piping and Instrumentation Diagram (P&ID) is an engineering drawing that shows:
- Process equipment (vessels, heat exchangers, pumps, compressors, tanks)
- Piping (with line numbers, sizes, and fluid codes)
- Instruments (with tag numbers, functions, and connections)
- Control loops (how instruments communicate with the control system)
- Valves (manual, control, on/off, safety)
- Interlocks and safety trips

Your job when reading a P&ID is to extract:
1. Every instrument tag and its full identification (tag number, type, loop, suffix)
2. The connected line number or equipment tag
3. The instrument service (what it measures or controls)
4. The IO type and signal type (how it connects to the control system)
5. Any quality or review flags (ambiguous tagging, noise, missing data)

You are NOT looking for equipment tags (E-101, V-201, P-301), drawing revision notes, general drawing title blocks, or text that is part of the north arrow, scale, legend, or border.

---

## 2. The ISA-5.1 Instrument Identification System

ISA-5.1 is the American standard for instrument symbology and identification. It defines a letter-based system where each instrument has a tag built from up to five functional letters plus a loop number and optional suffix.

### 2.1 First Letter — Measured or Initiating Variable

The first letter tells you what is being measured or what variable the instrument is associated with.

| Letter | Variable |
|--------|----------|
| A | Analysis (general, includes pH, conductivity, composition) |
| B | Burner, combustion |
| C | User-defined (conductivity in some projects) |
| D | User-defined or density/specific gravity |
| E | Voltage or electrical measurement |
| F | Flow |
| G | Gauging, dimensional measurement |
| H | Hand (operator-initiated) |
| I | Current (electrical) |
| J | Power |
| K | Time, time schedule |
| L | Level |
| M | Moisture, humidity |
| N | User-defined |
| O | User-defined |
| P | Pressure or vacuum |
| Q | Quantity, event, count |
| R | Radiation |
| S | Speed, frequency |
| T | Temperature |
| U | Multivariable |
| V | Vibration, mechanical analysis |
| W | Weight, force |
| X | Unclassified (used for anything not covered above) |
| Y | Event, state, presence |
| Z | Position, dimension (also used for safety actuators) |

### 2.2 Second Letter — Modifier to the First Letter

The second letter modifies the measured variable. Common modifiers:

| Letter | Modifier meaning |
|--------|-----------------|
| D | Differential (e.g., PDT = Pressure Differential Transmitter) |
| F | Ratio |
| H | High |
| L | Low |
| Q | Integrate or totalize |
| I | Indicator (readout function when used as second or third letter) |
| R | Record (when used as second or third letter) |
| S | Safety (in some project standards, modifier to indicate SIS function) |

### 2.3 Third and Fourth Letters — Passive/Readout and Active/Output Function

These letters describe what the instrument does.

| Letter | Readout / Passive function | Active / Output function |
|--------|---------------------------|--------------------------|
| A | Alarm | — |
| C | — | Control |
| E | Primary element / sensor | — |
| G | Glass, sight glass | — |
| H | High state | — |
| I | Indicate | — |
| K | — | Control station |
| L | Light, pilot light | Low state |
| O | Orifice | — |
| P | Point, test connection | — |
| R | Record | — |
| S | Switch | — |
| T | Transmit | — |
| V | — | Valve, damper, louver |
| W | Well, thermowell | — |
| X | Auxiliary | Auxiliary |
| Y | — | Relay, compute, convert |
| Z | — | Driver, actuator, final control element |

### 2.4 Building a Complete Tag — Reading Rules

Combine the letters in order to read the full function. Always read left to right:

- **FT** = Flow Transmitter
- **FIC** = Flow Indicating Controller
- **PDT** = Pressure Differential Transmitter
- **PDIC** = Pressure Differential Indicating Controller
- **LCV** = Level Control Valve
- **PSV** = Pressure Safety Valve
- **ZSH** = Position Switch High
- **ZSL** = Position Switch Low
- **HS** = Hand Switch
- **HSD** = Hand Switch (with D modifier, project-specific: often Hand Shutdown Switch in ESD context)
- **HV** = Hand Valve (manually operated control valve)
- **XV** = On/Off Valve (automated)
- **FY** = Flow relay / flow computer / flow converter
- **PY** = Pressure relay / signal converter
- **TY** = Temperature relay / signal converter
- **SDV** = Shutdown Valve (S=safety/shutdown first letter, D=differential or user modifier, V=valve)
- **BDV** = Blowdown Valve
- **SSV** = Surface Safety Valve (common in oil/gas wellhead context)
- **SSDSV** = Surface Safety and Downhole Safety Valve (long form, uncommon in instrumentation context)
- **XA** = Alarm associated with unclassified variable or process condition
- **YA** = Alarm associated with an event or state

### 2.5 Fifth Letter (Optional) — Function Modifier

| Letter | Meaning |
|--------|---------|
| H | High |
| L | Low |
| HH | High-high |
| LL | Low-low |

Examples:
- **TAHH** = Temperature Alarm High-High (highest priority temperature alarm)
- **TALL** = Temperature Alarm Low-Low
- **PSHH** = Pressure Switch High-High (safety trip)
- **PSLL** = Pressure Switch Low-Low (safety trip)

---

## 3. Tag Number Anatomy

A full instrument tag has three parts:

```
[Functional Letters] - [Loop Number] - [Suffix]
```

Example: **FIT-1762P-12**

- **FIT** = Flow Indicating Transmitter (functional letters)
- **1762** = Loop number (identifies the control loop)
- **P** = Area or system code (P = process, U = utility, varies by project)
- **12** = Suffix (distinguishes multiple instruments in the same loop)

### 3.1 Loop Numbers

Loop numbers group related instruments. All instruments in the same control loop share the same loop number.

Example loop FIC-1762:
- FE-1762 = Flow Element (primary measurement)
- FT-1762 = Flow Transmitter (signal conditioning)
- FIC-1762 = Flow Indicating Controller (control logic)
- FCV-1762 = Flow Control Valve (final element)
- FY-1762 = Flow relay or splitter (if present)
- FAH-1762 = Flow Alarm High (if present)
- FAL-1762 = Flow Alarm Low (if present)

All of these share loop number 1762. This is how you identify loop membership.

### 3.2 Suffix Conventions

Suffixes distinguish multiple instances of the same instrument type in the same loop or area.

- **Numeric suffix**: FT-1762-01, FT-1762-02 (two flow transmitters measuring different streams in the same loop)
- **Alphabetic suffix**: FT-1762A, FT-1762B (redundant transmitters, voting logic in SIS)
- **Combined**: FT-1762P-12 (P = area code, 12 = instance number)

If no suffix is visible, the instrument is the only one of its type in that loop.

### 3.3 Area and System Codes in Tags

Different projects use different area codes. Common ones:
- P = Process
- U = Utility
- F = Flare / fuel
- C = Cooling water
- S = Steam
- A = Air / instrument air
- N = Nitrogen

These codes appear after the loop number digit block. They tell you which process system the instrument belongs to and help with filtering.

### 3.4 Type-Only Tags (Extraction Noise)

Some P&IDs (especially scanned drawings or drawings with text layers) may show only the instrument type letters without a loop number, like: FT, PIC, LCV. These are usually:
- Legend boxes
- Symbol labels in the drawing legend
- Title block annotations
- Partially obscured tags where the number was not captured

**Do not treat type-only extractions as real instruments.** Flag them with `review_required = true` and `source = tag_type_only`.

---

## 4. Line Number Anatomy

Line numbers identify every pipe in a plant. They encode useful information about the fluid, size, area, and specification.

### 4.1 Standard EPC Line Number Format

```
[Size]-[Fluid Code]-[Sequence Number]-[Area Code]-[Insulation]-[Tracing]
```

Example: **2-PG-24468-251482-X-N**

- **2** = Pipe size in inches (2 inch)
- **PG** = Fluid code (PG = Process Gas)
- **24468** = Pipe sequence number (unique identifier within the area)
- **251482** = Area or system code block
- **X** = Insulation code (X = no insulation)
- **N** = Heat tracing code (N = no tracing)

Another example: **6-VG-20715-013461-Y-N**
- **6** = 6 inch pipe
- **VG** = Vent Gas
- **Y** = Insulated (Y = yes, standard insulation)

### 4.2 Common Fluid Codes

| Code | Fluid |
|------|-------|
| PG | Process Gas |
| PO | Process Oil / Liquid |
| VG | Vent Gas |
| FG | Fuel Gas |
| IA | Instrument Air |
| PA | Plant Air / Utility Air |
| CW | Cooling Water |
| SW | Seawater / Brackish Water |
| FW | Fresh Water / Fire Water |
| ST | Steam |
| CS | Condensate (Steam) |
| N2 | Nitrogen |
| CB | Chemical / Blend |
| HP | High Pressure (general) |
| LP | Low Pressure (general) |
| SC | Slops or Chemical |
| GL | Glycol |
| IZ | Inert (nitrogen blanketing) |
| D | Drain |
| NOTE | Note or annotation line (not a real process line) |

When you see a line number like **2-NOTE-25341-Y**, the `NOTE` fluid code means this is an annotation line, not a real pipe. Do not include NOTE lines in the Line List.

### 4.3 Using Line Numbers to Infer Service

The line number connected to an instrument tells you what fluid and process the instrument is measuring.

Rules:
- An **FT on a PG line** is measuring process gas flow → service = "Process gas flow"
- A **PT on an FG line** is measuring fuel gas pressure → service = "Fuel gas pressure"
- An **LT on a vessel** measures vessel level → service depends on the vessel function
- A **TT on a CW line** measures cooling water temperature → service = "Cooling water temperature"
- An **FCV connected to a PG line** is controlling process gas flow → service = "Process gas flow control"

When the line number fluid code is ambiguous or absent, look for:
- The equipment the instrument is connected to
- Upstream and downstream equipment tags
- Adjacent instrument tags (FT and FIC sharing a loop are both on the same fluid)
- Drawing notes or title block that identifies the process unit

---

## 5. Instrument Service Descriptions

The service field describes, in plain English, what the instrument is measuring or controlling. It should be concise (3–8 words), use process engineering language, and not include the tag number or function letters.

### 5.1 Service Inference Rules

**From line number + instrument type:**

| Instrument | Line Number | Service |
|-----------|------------|---------|
| FT | 2-PG-xxx | Process gas flow |
| FT | 4-PO-xxx | Process oil flow |
| FCV | 2-PG-xxx | Process gas flow control |
| PT | 2-PG-xxx | Process gas pressure |
| LT | vessel | Vessel level |
| TT | 2-ST-xxx | Steam temperature |
| PDT | across a filter | Filter differential pressure |
| ZT | control valve | Control valve position |
| ZSH / ZSL | valve | Valve position, open/closed limit |
| HS | panel/field | Operator hand switch |
| HSD | ESD panel | Emergency shutdown switch |

**From upstream equipment:**

| Equipment | Typical service context |
|-----------|------------------------|
| Compressor inlet | Suction pressure, suction temperature, suction flow |
| Compressor discharge | Discharge pressure, discharge temperature, discharge flow |
| Heat exchanger shell | Shell side inlet/outlet temperature, shell side pressure |
| Heat exchanger tube | Tube side inlet/outlet temperature, tube side pressure |
| Separator (gas/liquid) | Vessel pressure, liquid level, gas outlet flow |
| Pump suction | Pump suction pressure, suction flow |
| Pump discharge | Pump discharge pressure, discharge flow |
| Storage tank | Tank level, tank temperature, tank pressure |
| Wellhead | Wellhead pressure, wellhead temperature, production flow |

### 5.2 When Service Cannot Be Inferred

If the line number is absent, the instrument is in a congested area with no adjacent context, or the tag is a type-only extraction, service should be left blank and `review_required = true`.

Do not invent a service. Do not use generic placeholders like "Process service" or "Instrument service." Either provide a specific service or leave it empty and flag it.

### 5.3 Service Quality Rules

Good service description:
- "Chemical injection line pressure" — specific, concise
- "Separator inlet flow" — accurate, process-linked
- "Compressor discharge temperature" — clear, actionable

Bad service description:
- "Service" — empty placeholder
- "Flow" — too vague, does not say what fluid or where
- "Tag type only" — not a service description
- "FT service" — repeating the tag type is not a service

---

## 6. IO Types and Signal Types

Every instrument in a P&ID eventually connects to a control system (DCS, PLC, ESD/SIS). The IO type describes that connection.

### 6.1 IO Type Classification

| IO Type | Description |
|---------|-------------|
| AI | Analog Input — the instrument sends a continuous analog signal to the control system (usually 4–20 mA) |
| AO | Analog Output — the control system sends an analog signal to the instrument (usually to a control valve positioner) |
| DI | Digital Input — the instrument sends a binary (on/off) signal to the control system (from a switch, limit switch, relay) |
| DO | Digital Output — the control system sends a binary signal to an instrument (to an on/off valve solenoid) |
| Soft Link | The instrument exists in the control system logic but has no physical IO card (typical for indicators, controllers, and loop elements that are computed inside the DCS) |

### 6.2 Rules for Assigning IO Types

**Transmitters (TT, FT, PT, LT, AT, ST, etc.):**
- Physical transmitters = AI
- Signal type = 4-20 mA (most common) or HART (4-20 mA with digital overlay)
- High-accuracy or smart transmitters often have HART

**Indicating Controllers (FIC, PIC, LIC, TIC, etc.):**
- Soft Link — the controller function lives inside the DCS/PLC
- Exception: stand-alone panel-mounted controllers = AI + AO (one for measurement input, one for output)

**Indicators (FI, PI, LI, TI, etc.):**
- Local gauges (no connection to DCS) = no IO type
- If remotely connected = AI
- Soft Link if they are DCS trend/display points only

**Control Valves (FCV, PCV, LCV, TCV, etc.):**
- AO (the DCS sends an analog 4-20 mA signal to the valve positioner)
- If the valve has a position transmitter (ZT), add AI for that

**On/Off Valves (XV, SDV, BDV, SSV, etc.):**
- DO for the solenoid (open/close command)
- DI for limit switches: ZSH (valve open limit) and ZSL (valve closed limit)
- A typical shutdown valve therefore generates: 1 DO + 2 DI (sometimes more for partial-stroke testing)

**Hand Switches (HS, HSD):**
- DI — the switch sends a digital signal to the control system

**Pressure Safety Valves (PSV, PRV):**
- No IO — these are mechanical relief valves, not connected to the control system
- Exception: if a PSV has a limit switch on it (ZSL-xxx) to confirm valve lift, that ZSL is DI

**Alarms (FAH, FAL, PAH, PAL, TAHH, TALL, etc.):**
- Soft Link — alarms are logic points inside the DCS generated from the measurement transmitter
- Exception: standalone hard-wired alarm switches = DI

**Thermowells (TW), Orifice Plates (FO, RO), Flow Elements (FE):**
- No IO — these are primary elements without signal output

### 6.3 Signal Types

| Signal Type | Description |
|-------------|-------------|
| 4-20 mA | Standard analog current signal for transmitters and control valve positioners |
| 4-20 mA / HART | Same as 4-20 mA but with digital HART protocol superimposed |
| 24 VDC | Standard DC supply for digital input/output signals |
| 24 VDC (Dry Contact) | Volt-free dry contact for DI — no voltage on the contact itself |
| 110 VAC | Mains voltage for some older plants and power applications |
| Fieldbus (FF, Profibus) | Digital fieldbus protocol (Foundation Fieldbus, Profibus DP/PA) |
| NAMUR | Low-power signal for intrinsically safe proximity switches |
| RTD / TC | Resistance Temperature Detector (RTD) or Thermocouple direct wiring |

Most EPC projects default to 4-20 mA for AI/AO. If HART is not specifically called out in the P&ID or instrument datasheet, default to 4-20 mA.

RTD and TC wiring is used for some temperature instruments (direct connection without a transmitter). If a TW (thermowell) shows only a TI (temperature indicator) bubble with no TT (temperature transmitter), the temperature element may be connected as RTD/TC direct.

### 6.4 Systems (DCS, SIS, PLC)

Instruments are assigned to a control system:

| System | Description |
|--------|-------------|
| DCS | Distributed Control System — main process control system |
| SIS/ESD | Safety Instrumented System / Emergency Shutdown System — handles safety critical loops |
| PLC | Programmable Logic Controller — often used for utility or package systems |
| SCADA | Supervisory Control and Data Acquisition — remote monitoring for pipelines and remote wellheads |
| Local | Purely local instrument, no connection to any control system |
| Panel | Panel-mounted instrument in a control room or local panel |

**Rule:** If an instrument tag includes an SDV, SSV, BDV, PSLL, PSHH, LSLL, LSHH, FSHH, or similar Safety Instrumented Function (SIF) designation, assign it to SIS/ESD system, not DCS.

---

## 7. Complete Instrument Types — Reference Table

| Abbreviation | Full Name | Typical IO | Typical Signal | Notes |
|---|---|---|---|---|
| AT | Analyzer Transmitter | AI | 4-20 mA / HART | pH, conductivity, O2, H2S analyzers |
| AIC | Analyzer Indicating Controller | Soft Link | — | DCS loop point |
| AV | Analyzer Valve / sample valve | DO | 24 VDC | On/off sample valve |
| BDV | Blowdown Valve | DO + 2× DI | 24 VDC | Safety-type on/off valve |
| CC | Conductivity Controller | Soft Link | — | Often used for water treatment |
| CP | Conductivity/Chemistry Point | AI or Soft Link | 4-20 mA | |
| CV | Control Valve | AO | 4-20 mA | Throttling valve |
| FCV | Flow Control Valve | AO | 4-20 mA | Throttling, flow-controlled |
| FE | Flow Element | No IO | — | Orifice plate, venturi tube, pitot tube |
| FI | Flow Indicator | AI or Soft Link | 4-20 mA | Local or DCS display |
| FIC | Flow Indicating Controller | Soft Link | — | DCS controller function |
| FICA | Flow Indicating Controller Alarm | Soft Link | — | |
| FO | Flow Orifice | No IO | — | Fixed restriction for flow measurement |
| FQI | Flow Quantity Indicator | AI or Soft Link | 4-20 mA | Totalizer / integrator |
| FR | Flow Recorder | AI or Soft Link | 4-20 mA | |
| FT | Flow Transmitter | AI | 4-20 mA / HART | |
| FV | Flow Valve | AO | 4-20 mA | |
| FY | Flow relay / flow computer | Soft Link | — | Signal conditioning in DCS |
| FAH | Flow Alarm High | Soft Link | — | DCS alarm point |
| FAL | Flow Alarm Low | Soft Link | — | DCS alarm point |
| FAHH | Flow Alarm High-High | Soft Link (DCS) or DI (SIS) | — | Safety alarm |
| FALL | Flow Alarm Low-Low | Soft Link (DCS) or DI (SIS) | — | Safety alarm |
| FS | Flow Switch | DI | 24 VDC | Binary flow confirmation |
| FSH | Flow Switch High | DI | 24 VDC | |
| FSL | Flow Switch Low | DI | 24 VDC | |
| FSHH | Flow Switch High-High | DI | 24 VDC | SIS trip input |
| FSLL | Flow Switch Low-Low | DI | 24 VDC | SIS trip input |
| GT | Gas/Vibration Transmitter | AI | 4-20 mA | Sometimes used for vibration |
| HS | Hand Switch | DI | 24 VDC (Dry Contact) | Panel or field pushbutton |
| HSD | Hand Shutdown Switch | DI | 24 VDC (Dry Contact) | ESD panel switch |
| HIC | Hand Indicating Controller | Soft Link | — | Manual setpoint station in DCS |
| HV | Hand Valve (manual) | No IO | — | No DCS connection |
| LCV | Level Control Valve | AO | 4-20 mA | Throttling, level-controlled |
| LG | Level Gauge / glass | No IO | — | Local sight glass |
| LI | Level Indicator | AI or Soft Link | 4-20 mA | |
| LIC | Level Indicating Controller | Soft Link | — | DCS controller |
| LSH | Level Switch High | DI | 24 VDC | |
| LSL | Level Switch Low | DI | 24 VDC | |
| LSHH | Level Switch High-High | DI | 24 VDC | SIS trip |
| LSLL | Level Switch Low-Low | DI | 24 VDC | SIS trip |
| LT | Level Transmitter | AI | 4-20 mA / HART | |
| MSAS | Moisture Switch Alarm Switch | DI | 24 VDC | Also written as MSAH or MSAL |
| PCV | Pressure Control Valve | AO | 4-20 mA | Back-pressure or pressure-reducing |
| PDT | Pressure Differential Transmitter | AI | 4-20 mA / HART | Across a restriction, filter, or vessel |
| PDIC | Pressure Differential Indicating Controller | Soft Link | — | |
| PI | Pressure Indicator | Local or AI | — | Pressure gauge or DCS point |
| PIC | Pressure Indicating Controller | Soft Link | — | DCS controller |
| PRV | Pressure Relief Valve | No IO | — | Mechanical relief only |
| PSH | Pressure Switch High | DI | 24 VDC | |
| PSL | Pressure Switch Low | DI | 24 VDC | |
| PSHH | Pressure Switch High-High | DI | 24 VDC | SIS trip |
| PSLL | Pressure Switch Low-Low | DI | 24 VDC | SIS trip |
| PSV | Pressure Safety Valve | No IO | — | Mechanical spring relief valve |
| PT | Pressure Transmitter | AI | 4-20 mA / HART | |
| PY | Pressure relay / signal converter | Soft Link | — | I/P converter if physical |
| RO | Restriction Orifice | No IO | — | Fixed orifice for flow restriction, no IO |
| SC | Speed Controller | Soft Link | — | VFD or governor DCS point |
| SDV | Shutdown Valve | DO + 2× DI | 24 VDC | SIS/ESD valve |
| SSV | Surface Safety Valve | DO + 2× DI | 24 VDC | Common in oil/gas wellheads |
| SSSV | Sub-Surface Safety Valve | DO + DI | 24 VDC | Downhole, SIS |
| ST | Speed Transmitter | AI | 4-20 mA | Turbine or compressor speed |
| SY | Speed relay / signal converter | Soft Link | — | |
| TAH | Temperature Alarm High | Soft Link | — | DCS alarm |
| TAL | Temperature Alarm Low | Soft Link | — | DCS alarm |
| TAHH | Temperature Alarm High-High | Soft Link or DI | — | Safety alarm |
| TCV | Temperature Control Valve | AO | 4-20 mA | Throttling, temperature-controlled |
| TE | Temperature Element | No IO | — | Thermocouple or RTD element only |
| TI | Temperature Indicator | Local or AI | — | Thermometer or DCS point |
| TIC | Temperature Indicating Controller | Soft Link | — | DCS controller |
| TIT | Temperature Indicating Transmitter | AI | 4-20 mA / HART | Same as TT with indicator display |
| TSH | Temperature Switch High | DI | 24 VDC | |
| TSL | Temperature Switch Low | DI | 24 VDC | |
| TSHH | Temperature Switch High-High | DI | 24 VDC | SIS trip |
| TT | Temperature Transmitter | AI | 4-20 mA / HART | |
| TW | Thermowell | No IO | — | Protection pocket for temperature element |
| TY | Temperature relay / signal converter | Soft Link | — | |
| VT | Vibration Transmitter | AI | 4-20 mA | Machinery protection |
| WT | Weight Transmitter | AI | 4-20 mA | Load cell, weight measurement |
| XA | Process Alarm | Soft Link | — | Alarm for unclassified variable |
| XV | On/Off Valve (automated) | DO + 2× DI | 24 VDC | |
| YA | State or Event Alarm | Soft Link | — | |
| ZIC | Position Indicating Controller | Soft Link | — | DCS position control |
| ZIH | Position Indicator High | AI or DI | 4-20 mA or 24 VDC | Open position feedback |
| ZIL | Position Indicator Low | AI or DI | 4-20 mA or 24 VDC | Closed position feedback |
| ZSH | Position Switch High | DI | 24 VDC | Valve fully open limit switch |
| ZSL | Position Switch Low | DI | 24 VDC | Valve fully closed limit switch |
| ZT | Position Transmitter | AI | 4-20 mA | Continuous valve or actuator position |

---

## 8. Noise Rejection — What to Ignore

P&ID drawings contain a great deal of text that is NOT instrument tags. You must reject these correctly.

### 8.1 Equipment Tags

Equipment tags follow a different format from instrument tags:
- **Vessels**: V-101, D-201, T-302, S-401 (letter + dash + number)
- **Heat exchangers**: E-101, HE-201 (E or HE + dash + number)
- **Pumps**: P-101A/B (P + dash + number + AB redundancy suffix)
- **Compressors**: C-201, K-201 (C or K + dash + number)
- **Reactors**: R-101 (R + dash + number)
- **Columns**: T-201 (T + dash + number)
- **Tanks**: TK-101, F-101 (TK or F + dash + number)

Equipment tags do not have loop numbers and are formatted very differently from ISA instrument tags. Never extract equipment tags as instruments.

### 8.2 Title Block Information

P&IDs have a title block usually in the bottom right corner containing:
- Drawing number (e.g., P&ID-1001, DWG-PID-001)
- Drawing title (e.g., "FUEL GAS SYSTEM")
- Plant name, client name, project number
- Revision table (Rev 0, Rev 1, Rev A, etc.)
- Document owner (engineer name, checker, approver)
- Sheet number (Sheet 1 of 3)

None of this is instrument data. The drawing number is not a tag number. The revision code is not a suffix.

### 8.3 Notes and Annotations

P&IDs contain drawing notes labeled as:
- "NOTE 1: ALL VALVES TO BE NORMALLY CLOSED UNLESS SHOWN"
- "TYP." (typical — indicating a pattern applies to multiple similar items)
- "SEE DWG xxx FOR CONTINUATION"
- "LINE BREAK" or "MATCH LINE"
- "TO/FROM [unit name or equipment]"

These are narrative labels, not instrument tags.

### 8.4 Pipe Labels

Line numbers (e.g., 2-PG-24468-251482-X-N) are not instrument tags. They are piping identifiers to be extracted separately into the Line List, not the Instrument Index.

However, a pipe label that appears immediately adjacent to an instrument tag is the best evidence for the instrument's connected line — use it for service inference and line_tag assignment.

### 8.5 Legend Box Contents

Most P&IDs have a legend box showing instrument bubble types and their meaning. The contents of a legend box are definitions, not actual instruments. For example:
```
  ○ = Field instrument
  ⊗ = DCS instrument
  FT = Flow Transmitter
```
These legend entries are not instruments on the drawing. Reject them.

### 8.6 Common False Positive Patterns

| Text on drawing | Why it is not a real instrument |
|----------------|--------------------------------|
| "FT TYP." | "TYP" means typical — refers to a symbol definition, not an instance |
| "CC" alone in a table | May be a column heading or category code |
| "P&ID REV.0" | Drawing revision label |
| "DCS" inside a box | Control system label, not a tag |
| "SIS" or "ESD" standalone | System name label |
| "3/4" | Pipe reducer size annotation |
| "SPARE" near an instrument bubble | Placeholder for a future instrument |
| "TBD" inside an instrument bubble | To Be Determined — not assigned yet |
| Numbers like "120", "240" near wiring | Electrical terminal numbers, not loop numbers |

---

## 9. Review Flags and Quality Assessment

When extracting instruments, some should be flagged for engineer review. The following conditions warrant a flag.

### 9.1 Automatic Review Flags

Flag `review_required = true` when:
- The tag number is type-only (no loop number)
- The loop number is present but the suffix cannot be determined
- Service cannot be inferred from context
- IO type is ambiguous (e.g., the instrument could be AI or Soft Link depending on project standard)
- The same tag number appears more than once in the drawing (duplication)
- The tag number contains characters that are not valid ISA letters or numbers
- The instrument type is unrecognised (X-prefix without definition)
- A required field cannot be filled from drawing evidence alone

### 9.2 Confidence Levels

Assign a confidence level to the extraction:
- **High**: tag number complete, loop number present, line tag visible, service is obvious
- **Medium**: tag number complete, one of the following is missing or inferred (line tag, service, IO type)
- **Low**: type-only tag, or multiple fields missing, or context is ambiguous

---

## 10. Worked Example — Reading a P&ID Excerpt

### Drawing context:
A P&ID shows a 2-inch gas line entering a separator vessel. The line is labeled `2-PG-24468-251482-X-N`. On the line, the following instrument bubbles are visible:

- A circle with `FT` and below it the number `1762P-12`
- A dashed line going from FT to a square with `FIC` and `1762P-12`
- An arrow from FIC going to a control valve body labeled `FCV` with `1762P-12`
- A separate bubble `FAH-1762P-12` connected to the FIC
- A separate bubble `FAL-1762P-12` connected to the FIC
- On the separator vessel, a bubble `LT-2301P-01` with a line to `LIC-2301P-01`
- An arrow from LIC to a valve `LCV-2301P-01`
- A bubble `PSV-2301P-01` on the vessel top nozzle with no control line
- A bubble `LSHH-2301P-01` on the vessel
- A bubble `LSLL-2301P-01` on the vessel
- A bubble `PT-2301P-02` on the vessel

### Extracted Instrument Index:

| Tag Number | Loop | Type | Service | IO Type | Signal | System | Review |
|---|---|---|---|---|---|---|---|
| FT-1762P-12 | 1762 | FT | Process gas flow | AI | 4-20mA/HART | DCS | No |
| FIC-1762P-12 | 1762 | FIC | Process gas flow control | Soft Link | — | DCS | No |
| FCV-1762P-12 | 1762 | FCV | Process gas flow control | AO | 4-20mA | DCS | No |
| FAH-1762P-12 | 1762 | FAH | Process gas flow alarm high | Soft Link | — | DCS | No |
| FAL-1762P-12 | 1762 | FAL | Process gas flow alarm low | Soft Link | — | DCS | No |
| LT-2301P-01 | 2301 | LT | Separator liquid level | AI | 4-20mA/HART | DCS | No |
| LIC-2301P-01 | 2301 | LIC | Separator liquid level control | Soft Link | — | DCS | No |
| LCV-2301P-01 | 2301 | LCV | Separator liquid level control | AO | 4-20mA | DCS | No |
| PSV-2301P-01 | 2301 | PSV | Separator relief | No IO | — | Local | No |
| LSHH-2301P-01 | 2301 | LSHH | Separator level high-high trip | DI | 24VDC | SIS/ESD | No |
| LSLL-2301P-01 | 2301 | LSLL | Separator level low-low trip | DI | 24VDC | SIS/ESD | No |
| PT-2301P-02 | 2301 | PT | Separator pressure | AI | 4-20mA/HART | DCS | No |

Note: PSV has no IO because it is a mechanical spring relief valve. LSHH and LSLL are assigned to SIS/ESD because they are safety trips. The FIC and LIC are Soft Link because they are DCS controller function blocks.

---

## 11. Line List Rules

The Line List is a separate deliverable from the Instrument Index. It lists every process pipe on the P&ID.

Each row in the Line List contains:
- Line number (full string)
- Pipe size (inches)
- Fluid code (from the line number)
- Sequence number
- Area code
- Insulation code
- Tracing code
- P&ID source (drawing number and page)

### 11.1 Line Number Extraction Rules

- Extract every line number that appears on a pipe in the drawing
- Do not extract line numbers from notes, legends, or title blocks
- Do not extract NOTE-series line numbers (2-NOTE-xxx) as real lines
- If a line number appears on a continuation arrow ("TO/FROM xxx"), it is real and should be included with a note about the connected drawing

### 11.2 Size Extraction

The pipe size is always the first part of the line number (before the first dash). It is in inches. Typical sizes: 1/2, 3/4, 1, 1.5, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24 (inches).

When a size annotation appears near an instrument or on a component (like "2" BALL VALVE"), that size refers to the valve body, not necessarily the line.

---

## 12. Piping MTO Component Detection — Rules for AI Review

The Piping MTO reviewer checks detected components against the drawing context.

### 12.1 What Makes a Good MTO Detection

A valid detection:
- Is in the correct location (overlaps visually with a component symbol)
- Has a confidence score above the set threshold
- Is not in a title block, legend, or notes box area
- Is not a repeat of an adjacent detection (no duplicate at the same location)
- Has a consistent size extracted from the nearest pipe label or size annotation

### 12.2 Common False Positives in MTO

| False positive type | Description |
|--------------------|-------------|
| Legend symbol | Component symbol in the drawing legend, not a real component |
| Title block graphic | Decorative graphic or company logo resembling a symbol |
| Adjacent overlap | Two detected boxes for the same physical valve |
| Text character match | A letter or number in a tag that visually resembles a component symbol |
| Very low score match | Score below 0.5 with no confirmation from adjacent text evidence |

### 12.3 Size Evidence Priority

When assigning size to a detected component:
1. Explicit size annotation next to the component (e.g., "2"" beside the valve) — highest confidence
2. The connected line number's first digit (e.g., from `2-PG-xxx`, the size is 2 inch)
3. Reducing annotation across the component (e.g., "4"x2"" means the valve is at a size change)
4. AI-inferred size from context — flag with lower confidence

### 12.4 MTO Grouping Rules

Components should be grouped by:
- Item type (Ball Valve, Globe Valve, Gate Valve, Check Valve, etc.)
- Size in inches
- Piping class (if known from project specification)
- Rating (if known)

If piping class or rating is not available on the drawing, leave those fields blank and note that project legend data is required.

---

## 13. EPC Drawing Conventions by Region and Company Type

Different EPC companies and regions use variations of ISA-5.1. These are the most common variations:

### 13.1 Tag Format Variations

| Convention | Example | Description |
|------------|---------|-------------|
| ISA standard (US) | FT-1762 | Pure letter + number |
| Suffix with area | FT-1762P-12 | Loop + area code + instance |
| NORSOK (Norway) | 15FT1234 | Area code prefixed before letters |
| KKS (Europe, Power) | 10LBA10CT001 | Complex hierarchical system |
| Military / defense | FT-1762-01 | Just numeric suffix |
| Process licensor | FT-101 | Short loop numbers (licensors often use 3-digit) |

For XYRA, default to ISA standard. If you detect NORSOK or KKS format, note it in the project context.

### 13.2 Line Number Format Variations

| Format | Example | Description |
|--------|---------|-------------|
| Size-Fluid-Seq-Area | 2-PG-24468-251482 | Most common EPC format |
| Seq-Size-Fluid | 24468-2-PG | Some older projects reverse the order |
| Alphanumeric | 2"-A-101 | Smaller plants, chemical industry |
| NORSOK | 20-PG-4468-AB1 | Norwegian standard |

### 13.3 Control System Symbols

| Symbol | Meaning |
|--------|---------|
| Circle with line through it | DCS-connected instrument |
| Plain circle | Field-mounted instrument (no DCS connection) |
| Square or hexagon | SIS/ESD instrument |
| Dashed line between instruments | Signal line (electrical, pneumatic, or digital) |
| Solid line between instruments | Capillary or mechanical connection |
| Square inside circle | Instrument mounted behind panel/board |

---

## 14. Completeness Checklist Before Finalising Instrument Index

Before issuing the Instrument Index from a P&ID review:

- [ ] Every instrument bubble has been captured (no bubbles missed)
- [ ] All tag numbers are complete (functional letters + loop number + suffix where visible)
- [ ] All type-only tags are flagged for review
- [ ] Line tags are assigned where the pipe label is visible near the instrument
- [ ] Service descriptions are specific and process-linked, not generic
- [ ] IO types are consistent with instrument type rules
- [ ] PSVs and mechanical relief devices show No IO
- [ ] SIS/ESD instruments (PSHH, LSHH, LSLL, SDV, SSV, BDV) are assigned to SIS/ESD system
- [ ] Soft Link instruments (controllers, indicators without transmitters) are not given AI/AO/DI/DO IO types
- [ ] Alarms are Soft Link (DCS logic) not separate AI points
- [ ] No equipment tags (V-xxx, E-xxx, P-xxx) have been captured as instruments
- [ ] No NOTE-series pipe labels appear in the Line List
- [ ] Duplicate tags (same tag number appearing twice) are flagged

---

## 15. Common Engineer Review Flag Reasons

These are the most common reasons an instrument should be flagged `review_required = true`:

1. **Type-only tag** — Only functional letters visible, no loop number
2. **Missing loop number** — Tag has letters and suffix but loop number not legible
3. **Ambiguous service** — Adjacent line is cut off or continuation goes to another drawing
4. **IO type unclear** — Instrument could be local or DCS connected depending on project standard
5. **Duplicate tag** — Same tag number appears more than once in the project
6. **Unknown instrument type** — Functional letters not in ISA-5.1 and not defined in drawing legend
7. **Missing line assignment** — Instrument is floating without a connected pipe
8. **SPARE bubble** — Reserved position, no instrument installed yet
9. **TBD tag** — To Be Determined, engineer has not yet defined the instrument
10. **Tag in legend** — Instrument appears to be in the drawing legend rather than on the process

---

*End of XYRA Instrumentation Engineering Knowledge Base.*
*Version: 1.0 | Written for XYRA AI model training | June 2026*
