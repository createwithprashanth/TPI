# TPI/app/modules/instrumap/core/standard_library.py
import re
import pandas as pd

# Instrument types that are always soft/calculated — no physical standalone version
# FQT removed: it is a real AI transmitter, not a DCS display
_ALWAYS_SOFT_TYPES = {'FQI', 'FIR', 'TIR', 'PIR', 'AIR', 'LIR'}

# Physical descriptions for standalone indicators (no transmitter in same loop)
_PHYSICAL_GAUGE_DESC = {
    'P': 'Pressure Gauge',
    'T': 'Temperature Gauge',
    'L': 'Level Gauge (Sight Glass)',
    'F': 'Flow Indicator (Local)',
    'D': 'Differential Pressure Gauge',
    'A': 'Analysis Indicator (Local)',
    'V': 'Vibration Indicator (Local)',
    'W': 'Weight Indicator (Local)',
    'M': 'Moisture Indicator (Local)',
}

_NOISE_TAG_RE = re.compile(
    r"^(?:"
    r"[A-Z]$|"
    r"[A-Z]-[A-Z]$|"
    r"NOTE(?:[-_ ][A-Z0-9]+)?|NOTES?|"
    r"REV(?:[-_ ][A-Z0-9]+)?|"
    r"J-K|R-S|S-R|"
    r"DRAWN|CHECKED|APPROVED|SCALE|SHEET|HOLD|TYP|"
    r"\d+"
    r")$",
    re.IGNORECASE,
)

_NOISE_WORD_TOKENS = {
    "ADCO",
    "ADNOC",
    "AFTER",
    "ALARM",
    "ALL",
    "AREA",
    "ASME",
    "ASIC",
    "BALL",
    "BAND",
    "BLEED",
    "CALL",
    "EPC",
    "FIRE",
    "FLAME",
    "FLOW",
    "FROM",
    "GATE",
    "LIMIT",
    "GAS",
    "NEED",
    "PANEL",
    "PLUG",
    "SPARE",
    "VALVE",
    "WELL",
    "WHICH",
    "WILL",
}

_NON_INSTRUMENT_PREFIXES = {
    "ADCO",
    "ADNOC",
    "AFTER",
    "ALARM",
    "ALL",
    "AREA",
    "ASME",
    "ASIC",
    "BALL",
    "BAND",
    "BLEED",
    "EPC",
    "FOR",
    "FROM",
    "GAS",
    "GATE",
    "HAVE",
    "IN",
    "LIFT",
    "LIMIT",
    "LOCAL",
    "LP",
    "PLUG",
    "PLUGS",
    "SH",
    "SIL",
    "SPARE",
    "PANEL",
    "THE",
    "VALVE",
    "WELL",
    "WILL",
    "XFAB",
    "XGAB",
    "XMCP",
}

_SOFT_DISPLAY_CONTROLLER_TYPES = {
    "CC",
    "FIC",
    "FI",
    "LIC",
    "LI",
    "LC",
    "PIC",
    "PI",
    "TIC",
    "TI",
}

_POSITION_FEEDBACK_TYPES = {
    "CVZI": "DI",
    "CVZT": "AI",
    "FZT": "AI",
}

_LINE_OPTIONAL_TYPES = {
    "GAS",
    "HS",
    "HSD",
    "HSS",
    "XA",
    "XFD",
    "XGD",
    "XHMD",
    "XTGD",
}

_HARDWIRED_IO_TYPES = {"AI", "AO", "DI", "DO"}

_INVALID_LINE_TAG_RE = re.compile(
    r"^(?:"
    r"review[_ -]?required(?:=true|=false)?|"
    r"true|false|none|null|nan|"
    r"manual[_ -]?review"
    r")$",
    re.IGNORECASE,
)

_LINE_WITH_SUFFIX_RE = re.compile(
    r"^(?P<head>\d+(?:\.\d+)?-[A-Z]{1,4}-.+?-[A-Z])(?P<suffix>\d{1,3})$",
    re.IGNORECASE,
)

_PROJECT_PREFIXED_INSTRUMENT_RE = re.compile(
    r"^\d{1,4}-[A-Z]{1,5}-[A-Z0-9]{3,8}[A-Z]?$",
    re.IGNORECASE,
)


def _clean_text(value) -> str:
    text = str(value or "").strip()
    return "" if text.lower() == "nan" else text


def _clean_connected_line(row) -> str:
    line = _clean_text(row.get("Connected_Line"))
    if not line:
        return ""

    if _INVALID_LINE_TAG_RE.match(line):
        return ""

    # OCR/LLM mapping can occasionally glue the instrument suffix onto a
    # nearby line number, for example 2-PG-24468-251482-X-N18 for PIT-...-18.
    suffix = _clean_text(row.get("Suffix"))
    match = _LINE_WITH_SUFFIX_RE.match(line)
    if match and suffix and match.group("suffix") == suffix:
        return match.group("head")

    return line


def _is_type_only_fragment(row) -> bool:
    tag = _clean_text(row.get("Tag_Number")).upper()
    typ = _clean_text(row.get("Type")).upper()
    loop = _clean_text(row.get("Loop"))
    suffix = _clean_text(row.get("Suffix"))
    if not tag or not typ:
        return False
    return tag == typ and not loop and not suffix


def _is_project_prefixed_instrument_tag(tag: str, typ: str, row) -> bool:
    """Accept client tags like 13-TP-4000A while rejecting 253-FL fragments."""
    if not _PROJECT_PREFIXED_INSTRUMENT_RE.match(tag):
        return False
    parts = tag.split("-")
    if len(parts) < 3:
        return False
    type_part = parts[1].upper()
    if typ and type_part != typ:
        return False
    loop = _clean_text(row.get("Loop"))
    return bool(loop and len(loop) >= 3)


def instrument_tag_quality(row) -> tuple[str, str]:
    """
    Classify extracted tag quality without deleting anything.

    Returns (quality, reason), where quality is:
      - accepted: can appear in client deliverables
      - suppressed: useful evidence, but not a real indexed instrument yet
      - rejected_noise: obvious OCR/admin/language fragment
    """
    tag = _clean_text(row.get("Tag_Number")).upper()
    typ = _clean_text(row.get("Type") or row.get("Instrument_Type")).upper()

    if not tag:
        return "rejected_noise", "Blank tag number"

    if _NOISE_TAG_RE.match(tag):
        return "rejected_noise", "Drawing/admin fragment, not an instrument tag"

    if _is_type_only_fragment(row):
        return "suppressed", "Type-only detection without loop number"

    tokens = [part for part in re.split(r"[-_/\\s]+", tag) if part]
    if any(token in _NOISE_WORD_TOKENS for token in tokens):
        return "rejected_noise", "English/text fragment captured as tag"

    if typ in _NON_INSTRUMENT_PREFIXES:
        return "rejected_noise", f"Non-ISA/non-instrument prefix: {typ}"

    if re.match(r"^\d", tag) and not _is_project_prefixed_instrument_tag(tag, typ, row):
        return "rejected_noise", "Incomplete tag: missing ISA type prefix"

    if typ and len(typ) == 1 and "-" not in tag:
        return "suppressed", "Single-letter type without loop number"

    return "accepted", ""


def apply_output_sanity_rules(master_df: pd.DataFrame) -> pd.DataFrame:
    """
    Final non-destructive cleanup after extraction, enrichment, and line mapping.

    This intentionally does not delete rows. It clears impossible line links and
    marks obvious OCR/admin fragments for review so engineers can filter them.
    """
    if master_df is None or master_df.empty:
        return master_df

    df = master_df.copy()

    for col, default in (
        ("Review_Required", False),
        ("Connected_Line", ""),
        ("System", ""),
        ("IO_Type", ""),
        ("Signal_Type", ""),
        ("Power_Supply", ""),
        ("Instrument_Description", ""),
        ("Rejected_As_Noise", False),
        ("Noise_Reason", ""),
        ("Tag_Quality", "accepted"),
    ):
        if col not in df.columns:
            df[col] = default
    df["Connected_Line"] = df["Connected_Line"].astype("object").fillna("")

    # F&GS area detectors/alarms are not connected to process pipe numbers.
    fgs_mask = df["System"].astype(str).str.strip().eq("F&GS")
    df.loc[fgs_mask, "Connected_Line"] = ""

    df["Connected_Line"] = df.apply(_clean_connected_line, axis=1)

    quality = df.apply(instrument_tag_quality, axis=1, result_type="expand")
    quality.columns = ["Tag_Quality", "Noise_Reason"]
    df["Tag_Quality"] = quality["Tag_Quality"]
    df["Noise_Reason"] = quality["Noise_Reason"]

    noise_mask = df["Tag_Quality"].isin({"suppressed", "rejected_noise"})
    if noise_mask.any():
        df.loc[noise_mask, "Review_Required"] = True
        df.loc[noise_mask, "Connected_Line"] = ""
        df.loc[noise_mask, "System"] = ""
        df.loc[noise_mask, "IO_Type"] = "Soft Link"
        df.loc[noise_mask, "Signal_Type"] = ""
        df.loc[noise_mask, "Power_Supply"] = ""
        empty_desc = df["Instrument_Description"].astype(str).str.strip().eq("")
        df.loc[noise_mask & empty_desc, "Instrument_Description"] = "Review Required"
        df.loc[df["Tag_Quality"].eq("rejected_noise"), "Rejected_As_Noise"] = True

    # Passive primary/mechanical devices are not IO list rows.
    passive_type_mask = df["Type"].astype(str).str.strip().str.upper().isin({"FE", "RO", "TE", "TP", "TW"})
    if passive_type_mask.any():
        df.loc[passive_type_mask, "IO_Type"] = "None"
        df.loc[passive_type_mask, "Signal_Type"] = ""
        df.loc[passive_type_mask, "Power_Supply"] = ""

    # Standalone indicators and DCS controllers are software/display functions
    # unless a transmitter/final-element tag exists separately. They should not
    # create hardwired IO rows by themselves.
    soft_type_mask = df["Type"].astype(str).str.strip().str.upper().isin(_SOFT_DISPLAY_CONTROLLER_TYPES)
    if soft_type_mask.any():
        df.loc[soft_type_mask, "IO_Type"] = "Soft Link"
        df.loc[soft_type_mask, "Signal_Type"] = ""
        df.loc[soft_type_mask, "Power_Supply"] = ""

    # Valve position feedback/indication is a real signal even when the model
    # did not know the project-specific CVZ/FZ convention.
    position_types = df["Type"].astype(str).str.strip().str.upper()
    for instr_type, io_type in _POSITION_FEEDBACK_TYPES.items():
        mask = position_types.eq(instr_type)
        if mask.any():
            df.loc[mask, "IO_Type"] = io_type

    def _normalise_io(row) -> tuple[str, str]:
        io_type = _clean_text(row.get("IO_Type"))
        signal = _clean_text(row.get("Signal_Type"))
        power = _clean_text(row.get("Power_Supply"))
        if io_type == "AO":
            return signal or "4-20mA", "24VDC"
        if io_type == "DO":
            return signal or "24VDC", "24VDC"
        if io_type == "DI":
            return signal or "24VDC (Dry Contact)", "24VDC"
        if io_type == "AI":
            return signal or "4-20mA + HART", power or "24VDC (Loop Powered)"
        if io_type == "Soft Link":
            return "", ""
        if io_type == "None":
            return "", ""
        return signal, power

    if {"IO_Type", "Signal_Type", "Power_Supply"}.issubset(df.columns):
        normalised = df.apply(_normalise_io, axis=1, result_type="expand")
        normalised.columns = ["Signal_Type", "Power_Supply"]
        df["Signal_Type"] = normalised["Signal_Type"]
        df["Power_Supply"] = normalised["Power_Supply"]

    service_conf = df.get("Service_Confidence", pd.Series("", index=df.index)).astype(str).str.strip().str.lower()
    weak_service_mask = service_conf.isin({"low", "review"})
    if weak_service_mask.any():
        df.loc[weak_service_mask, "Review_Required"] = True

    line_expected_mask = (
        df["IO_Type"].astype(str).str.strip().str.upper().isin(_HARDWIRED_IO_TYPES)
        & df["Connected_Line"].astype(str).str.strip().eq("")
        & ~df["Type"].astype(str).str.strip().str.upper().isin(_LINE_OPTIONAL_TYPES)
        & ~df["System"].astype(str).str.strip().eq("F&GS")
    )
    if line_expected_mask.any():
        df.loc[line_expected_mask, "Review_Required"] = True

    return df


def _loop_key(row) -> tuple:
    """Return a hashable key that uniquely identifies a loop.

    Uses (area, loop, numeric_suffix) so that instruments sharing the same
    area unit (e.g. '298P') but different loop numbers ('01' vs '07') are
    correctly treated as separate loops.

    Examples:
      FIT-298P-01 → ('', '298P', '01')
      FI-298P-01  → ('', '298P', '01')   — same loop as FIT ✓
      PI-298P-07  → ('', '298P', '07')   — different loop ✓
      FIT-01      → ('', '01',   '')
      FI-01       → ('', '01',   '')     — same loop ✓
    """
    import re as _re
    area = str(row.get('Area', '') or '')
    loop = str(row.get('Loop', '') or '')
    s    = str(row.get('Suffix', '') or '')
    m = _re.match(r'^(\d+)', s)
    num_suffix = m.group(1) if m else ''
    return (area, loop, num_suffix)


def compute_programmatic_fields(master_df: pd.DataFrame) -> pd.DataFrame:
    """
    Populate Fail_State, SIL_Level, Criticality and Enclosure columns
    directly from instrument type / system classification — no LLM needed.
    """
    if master_df is None or master_df.empty:
        return master_df

    df = master_df.copy()

    def _fail_state(row) -> str:
        desc = str(row.get('Instrument_Description', '') or '')
        io   = str(row.get('IO_Type', '') or '')
        # Spring-loaded safety/relief valves open on over-pressure — always Fail Open
        if any(x in desc for x in ('Safety Valve', 'Relief Valve', 'Blowdown')):
            return 'Fail Open'
        # All other actuated valves default to Fail Close (safe position)
        if io in ('AO', 'DO'):
            return 'Fail Close'
        return ''

    def _sil_level(row) -> str:
        sys_  = str(row.get('System', '') or '')
        desc  = str(row.get('Instrument_Description', '') or '')
        io    = str(row.get('IO_Type', '') or '')
        # SIL 2: SIS/ESD system, or dual-redundant safety actions (High-High / Low-Low)
        if sys_ == 'SIS/ESD':
            return 'SIL 2'
        if any(x in desc for x in ('Safety Valve', 'Relief Valve', 'High High', 'Low Low')):
            return 'SIL 2'
        # SIL 1: any single field switch — discrete safety measurement, not just display
        if io == 'DI' and 'Switch' in desc:
            return 'SIL 1'
        return ''

    def _criticality(row) -> str:
        sys_ = str(row.get('System', '') or '')
        io   = str(row.get('IO_Type', '') or '')
        if sys_ == 'SIS/ESD':
            return 'Safety Critical'
        if io in ('AI', 'AO', 'DI', 'DO') and sys_ == 'DCS':
            return 'Critical'
        return 'Normal'

    def _enclosure(row) -> str:
        mounting = str(row.get('Mounting', '') or '')
        io       = str(row.get('IO_Type', '') or '')
        desc     = str(row.get('Instrument_Description', '') or '')
        fluid    = str(row.get('Matched_Fluid', '') or '') or str(row.get('Process_Fluid', '') or '')
        # Only hardwired field devices get an IP rating
        if 'Field' not in mounting or io not in ('AI', 'AO', 'DI', 'DO'):
            return ''
        # Wet / water service or submerged → IP67
        wet_keywords = ('Water', 'water', 'Produced Water', 'Cooling Water',
                        'Fire Water', 'subsea', 'Subsea', 'submerged')
        if any(w in fluid or w in desc for w in wet_keywords):
            return 'IP67'
        return 'IP65'

    df['Fail_State']  = df.apply(_fail_state,  axis=1)
    df['SIL_Level']   = df.apply(_sil_level,   axis=1)
    df['Criticality'] = df.apply(_criticality, axis=1)
    df['Enclosure']   = df.apply(_enclosure,   axis=1)

    # F&GS area monitors are not connected to process pipes — clear any line assigned
    if 'Connected_Line' in df.columns:
        df['Connected_Line'] = df['Connected_Line'].astype('object').fillna('')
        fgs_mask = df['System'].astype(str) == 'F&GS'
        df.loc[fgs_mask, 'Connected_Line'] = ''

    return apply_output_sanity_rules(df)


def refine_descriptions_by_loop_context(master_df: pd.DataFrame) -> pd.DataFrame:
    """
    Correct instrument descriptions based on loop context.

    An indicator (type ends in 'I') with no transmitter (type ends in 'T')
    of the same variable letter in the same loop is a physical field gauge,
    not a soft/panel indicator.

    Examples:
      PI alone in loop        → Pressure Gauge       (IO_Type='', System='')
      PI + PIT in same loop   → Pressure Indicator   (soft, no change)
      TI + TIT in same loop   → Temperature Indicator (soft, no change)
      TI alone                → Temperature Gauge
    """
    if master_df is None or master_df.empty:
        return master_df

    df = master_df.copy()

    # Build set of (loop_key, first_letter) for every transmitter in master_df
    transmitter_keys = set()
    for _, row in df.iterrows():
        t = str(row.get('Type', '') or '')
        if len(t) >= 2 and t[-1] == 'T':
            transmitter_keys.add((_loop_key(row), t[0]))

    for idx, row in df.iterrows():
        t = str(row.get('Type', '') or '')
        if len(t) < 2 or t[-1] != 'I':
            continue
        if t in _ALWAYS_SOFT_TYPES:
            continue

        first = t[0]
        if first not in _PHYSICAL_GAUGE_DESC:
            continue

        has_transmitter = (_loop_key(row), first) in transmitter_keys
        if not has_transmitter:
            df.at[idx, 'Instrument_Description'] = _PHYSICAL_GAUGE_DESC[first]
            df.at[idx, 'IO_Type']     = ''
            df.at[idx, 'Signal_Type'] = ''
            df.at[idx, 'Power_Supply'] = ''
            df.at[idx, 'System']      = ''
            df.at[idx, 'Mounting']    = 'Field / Direct'

    return df


class InstrumentLogicEngine:
    """
    Advanced Logic Engine for parsing Tags into Engineering Data.
    Tuned for real-world EPC P&IDs including irregular tags (SZ, CV, X).
    """

    # 1. EXACT MATCH OVERRIDES (The "Cheatsheet")
    # These take precedence over standard logic to handle project-specific edge cases.
    SPECIAL_OVERRIDES = {
        # Hand / manual devices
        "HIC":  "Hand Indicating Controller",
        "HSD":  "Hand Switch (Shutdown)",
        "HS":   "Hand Switch",
        "HSS":  "Hand Switch (Safety)",
        "SZHS": "Safety Hand Switch (Position)",
        "HOV":  "Hand Operated Valve",
        "MOV":  "Motor Operated Valve",
        "SY":   "Signal Relay / Converter",
        # Position / actuator feedback
        "CVA":  "Control Valve Actuator",
        "CVZI": "Control Valve Position Indicator",
        "CVZT": "Control Valve Position Transmitter",
        "FZT":  "Flow Element Position Transmitter",
        "ZSC":  "Position Switch (Closed)",
        "ZSO":  "Position Switch (Open)",
        "ZSL":  "Position Switch (Low/Closed)",
        "ZSH":  "Position Switch (High/Open)",
        "SZSL": "Safety Position Switch (Low/Closed)",
        "SZSH": "Safety Position Switch (High/Open)",
        "SZIL": "Safety Position Indicator (Low)",
        "SZIH": "Safety Position Indicator (High)",
        "ZI":   "Position Indicator",
        "ZIH":  "Position Indicator High",
        "ZIL":  "Position Indicator Low",
        "ZIT":  "Position Indicating Transmitter",
        "ZIAH": "Position Indicator Alarm High",
        "ZIAL": "Position Indicator Alarm Low",
        # Totalizer / integrators
        "FQI":  "Flow Totalizer Indicator",
        "FQT":  "Flow Totalizer Transmitter",
        # Analyzers
        "AT":   "Analyzer Transmitter",
        "AIT":  "Analyzer Indicating Transmitter",
        "AE":   "Analyzer Element",
        # Differential pressure
        "PDT":  "Differential Pressure Transmitter",
        "PDIT": "Differential Pressure Indicating Transmitter",
        "PDI":  "Differential Pressure Indicator",
        # Control valves — variable-type prefix
        "CV":   "Control Valve",
        "FCV":  "Flow Control Valve",
        "PCV":  "Pressure Control Valve",
        "TCV":  "Temperature Control Valve",
        "LCV":  "Level Control Valve",
        # On/Off and safety valves
        "XV":   "On/Off Valve",
        "SDV":  "Shutdown Valve",
        "BDV":  "Blowdown Valve",
        "ESV":  "Emergency Shutdown Valve",
        "ESDV": "Emergency Shutdown Valve",
        "SSV":  "Surface Safety Valve",
        "SSSV": "Subsurface Safety Valve",
        "SSOV": "Subsurface Safety Valve",
        "SVHC": "Safety Valve Hydraulic Close Solenoid",
        "SVHO": "Safety Valve Hydraulic Open Solenoid",
        "SVZA": "Safety Valve Position Alarm",
        "PSV":  "Pressure Safety Valve",
        "PRV":  "Pressure Relief Valve",
        # Direct-read gauges (no electrical signal)
        "PG":   "Pressure Gauge",
        "TG":   "Temperature Gauge",
        "LG":   "Level Gauge",
        # Misc
        "BMS":  "Burner Management System",
        "WIT":  "Weight / Mass Flow Indicating Transmitter",
        # Fire & Gas detection (F&GS system — not on process pipes)
        "XFD":  "Flame Detector",
        "XGD":  "Gas Detector",
        "XTGD": "Toxic Gas Detector",
        "XHMD": "Combustible Gas Detector",
        "XTGA": "Toxic Gas Alarm",
        "XGA":  "Gas Alarm",
        "XMCA": "Fire & Gas Monitor Alarm",
        # Temperature passive points (no electrical signal)
        "TP":   "Temperature Point",
        "THP":  "Temperature High Point",
        # Common OCR typos
        "P1":   "Pressure Indicator",
        "T1":   "Temperature Indicator",
    }

    # 2. ISA-5.1 STANDARD DICTIONARIES
    FIRST_LETTER = {
        'A': 'Analysis', 'B': 'Burner', 'C': 'Conductivity', 'D': 'Density',
        'E': 'Voltage', 'F': 'Flow', 'G': 'Gauging', 'H': 'Hand',
        'I': 'Current', 'J': 'Power', 'K': 'Time', 'L': 'Level',
        'M': 'Moisture', 'P': 'Pressure', 'Q': 'Quantity', 'R': 'Radiation',
        'S': 'Speed', 'T': 'Temperature', 'U': 'Multivariable', 'V': 'Vibration',
        'W': 'Weight', 'X': 'Process (Misc)', 'Y': 'Event', 'Z': 'Position'
    }

    MODIFIERS = {
        'D': 'Differential', 'F': 'Ratio', 'I': 'Indicating', 'Q': 'Totalizer',
        'S': 'Safety', 'J': 'Scan', 'H': 'High', 'L': 'Low'
    }

    READOUT_PASSIVE = {
        'A': 'Alarm', 'E': 'Element', 'G': 'Gauge', 'I': 'Indicator',
        'R': 'Recorder', 'Q': 'Totalizer', 'W': 'Well', 'O': 'Orifice'
    }

    OUTPUT_ACTIVE = {
        'C': 'Controller', 'S': 'Switch', 'T': 'Transmitter',
        'V': 'Valve', 'Y': 'Relay/Compute', 'Z': 'Actuator/Driver'
    }

    @staticmethod
    def parse_tag_structure(full_tag):
        """
        Parses a tag string (e.g., "10-PIT-101A" or "TIT-298P-05") into its components.
        """
        clean_tag = full_tag.strip()
        
        # --- PATTERN 1: Complex Loop with Separator (The "298P-05" Case) ---
        # Matches: Area(Opt) - Type - Loop(Alphanumeric) - Suffix(Alphanumeric)
        # Regex explanation:
        # (\d+[-_])?      -> Optional Area Code (e.g., "10-")
        # ([A-Z]+)        -> Instrument Type (e.g., "TIT")
        # [-_ ]?          -> Separator
        # ([A-Z0-9]+)     -> Loop Number (Now allows letters like "298P")
        # [-_ ]           -> Mandatory Separator
        # ([A-Z0-9]+)$    -> Suffix (e.g., "05")
        # Separator between Type and Loop is MANDATORY to prevent "FI-01" being
        # split as Type="F", Loop="I", Suffix="01" by the greedy [A-Z]+ group.
        pattern_complex = r'^(\d+[-_])?([A-Z]+)[-_ ]([A-Z0-9]+)[-_ ]([A-Z0-9]+)$'
        match = re.match(pattern_complex, clean_tag)

        if match:
            area_raw = match.group(1)
            area = area_raw.replace('-', '').replace('_', '') if area_raw else ""
            return {
                "Area_Code": area,
                "Instrument_Type": match.group(2),
                "Loop_Number": match.group(3), # Captures "298P"
                "Tag_Suffix": match.group(4)   # Captures "05"
            }

        # --- PATTERN 2: Standard Loop (The "101A" Case) ---
        # Separator required here too for the same reason.
        pattern_std = r'^(\d+[-_])?([A-Z]+)[-_ ]([A-Z0-9]+)([A-Z]?)$'
        match = re.match(pattern_std, clean_tag)
        
        if match:
            area_raw = match.group(1)
            area = area_raw.replace('-', '').replace('_', '') if area_raw else ""
            return {
                "Area_Code": area,
                "Instrument_Type": match.group(2),
                "Loop_Number": match.group(3),
                "Tag_Suffix": match.group(4)
            }
        
        # Fallback: Just extract the type so we don't crash, but Loop will be empty
        type_match = re.search(r'([A-Z]+)', clean_tag)
        return {
            "Area_Code": "",
            "Instrument_Type": type_match.group(1) if type_match else "UNKNOWN",
            "Loop_Number": "",
            "Tag_Suffix": ""
        }

    @staticmethod
    def get_epc_specs(full_tag, default_area_code=None):
        """
        Main function to generate Engineering Specs from a Tag.
        """
        parsed = InstrumentLogicEngine.parse_tag_structure(full_tag)
        code = parsed["Instrument_Type"]
        
        # Area Code Logic: Use parsed, otherwise fallback to default
        final_area_code = parsed["Area_Code"]
        if not final_area_code and default_area_code:
            final_area_code = str(default_area_code).strip()

        # Default Specs (Warning State)
        specs = {
            "Area_Code": final_area_code,
            "Instrument_Type": code,
            "Loop_Number": parsed["Loop_Number"],
            "Tag_Suffix": parsed["Tag_Suffix"],
            "Instrument_Description": "Unknown Instrument",
            "Service": "", 
            "System": "REVIEW",     
            "IO_Type": "REVIEW",    
            "Signal_Type": "",
            "Power_Supply": "",
            "Mounting": "Field",
            "Confidence": "Low"
        }

        if not code: return specs

        # ---------------------------------------------------------
        # STRATEGY 1: EXACT OVERRIDES (Fast Path)
        # ---------------------------------------------------------
        if code in InstrumentLogicEngine.SPECIAL_OVERRIDES:
            specs['Instrument_Description'] = InstrumentLogicEngine.SPECIAL_OVERRIDES[code]
            specs['Confidence'] = "High"
            specs['System'] = "DCS" # Default unless overridden below

            # Apply Engineering Rules to Overrides
            desc = specs['Instrument_Description']
            if "Detector" in desc:
                specs['System'] = "F&GS"
                if "Flame" in desc:
                    specs['IO_Type'] = "DI"
                    specs['Signal_Type'] = "24VDC (Dry Contact)"
                    specs['Power_Supply'] = "24VDC"
                else:
                    specs['IO_Type'] = "AI"
                    specs['Signal_Type'] = "4-20mA + HART"
                    specs['Power_Supply'] = "24VDC (Loop Powered)"
                    specs['Mounting'] = "Field / Direct"
            elif "Gas Alarm" in desc or "Toxic Gas Alarm" in desc or "Fire & Gas Monitor" in desc:
                specs['System'] = "F&GS"
                specs['IO_Type'] = "Soft Link"
            elif "Temperature Point" in desc or "Temperature High Point" in desc:
                specs['IO_Type'] = ""
                specs['Signal_Type'] = ""
                specs['Power_Supply'] = ""
                specs['System'] = ""
                specs['Mounting'] = "Field / Direct"
            elif "Control Valve Position Indicator" in desc:
                specs['IO_Type'] = "Soft Link"
                specs['System'] = "DCS"
            elif "Solenoid" in desc:
                specs['IO_Type'] = "DO"
                specs['Signal_Type'] = "24VDC"
                specs['Power_Supply'] = "24VDC"
                specs['System'] = "SIS/ESD" if "Safety" in desc else "DCS"
            elif "Safety Valve Position Alarm" in desc:
                specs['IO_Type'] = "DI"
                specs['Signal_Type'] = "24VDC (Dry Contact)"
                specs['Power_Supply'] = "24VDC"
                specs['System'] = "SIS/ESD"
            elif "Switch" in desc:
                specs['IO_Type'] = "DI"
                specs['Signal_Type'] = "24VDC (Dry Contact)"
                specs['Power_Supply'] = "24VDC"
                if "Safety" in desc or "Shutdown" in desc:
                    specs['System'] = "SIS/ESD"
            elif "Control Valve" in desc and "Transmitter" not in desc:
                specs['IO_Type'] = "AO"
                specs['Signal_Type'] = "4-20mA"
                specs['Power_Supply'] = "24VDC"
                specs['System'] = "DCS"
            elif code in {"SSV", "SSSV", "SSOV"}:
                specs['IO_Type'] = "DO"
                specs['Signal_Type'] = "24VDC"
                specs['Power_Supply'] = "24VDC"
                specs['System'] = "SIS/ESD"
            elif "Valve" in desc and "Control" not in desc:
                if "Hand" in desc or "Relief" in desc or "Safety Valve" in desc:
                    # Manually operated or spring-loaded — no electrical actuator
                    specs['IO_Type'] = ""
                    specs['System'] = ""
                    specs['Mounting'] = "Field / Direct"
                else:
                    specs['IO_Type'] = "DO"
                    specs['System'] = (
                        "SIS/ESD" if any(w in desc for w in
                            ("Safety", "Shutdown", "Blowdown", "Emergency"))
                        else "DCS"
                    )
            elif "Transmitter" in desc:
                specs['IO_Type'] = "AI"
                specs['Signal_Type'] = "4-20mA + HART"
                specs['Power_Supply'] = "24VDC (Loop Powered)"
                specs['Mounting'] = "Field / Direct"
            elif "Element" in desc or (
                # Direct-read gauges: PG, TG, LG — no electrical signal
                any(x in desc for x in ("Pressure Gauge", "Temperature Gauge", "Level Gauge"))
            ):
                specs['IO_Type'] = ""
                specs['Signal_Type'] = ""
                specs['Power_Supply'] = ""
                specs['System'] = ""
                specs['Mounting'] = "Field / Direct"
            elif "Indicator" in desc and "Totalizer" not in desc:
                specs['IO_Type'] = "Soft Link"
                specs['System'] = "SIS/ESD" if "Safety" in desc else "DCS"

            # Catch-all: anything that didn't match above is a DCS soft display
            if specs['IO_Type'] == 'REVIEW':
                specs['IO_Type'] = 'Soft Link'

            return specs

        # ---------------------------------------------------------
        # STRATEGY 2: INTELLIGENT PARSING
        # ---------------------------------------------------------
        first_char = code[0]
        rest_chars = code[1:]
        
        # Valid ISA tags must map the first letter
        if first_char not in InstrumentLogicEngine.FIRST_LETTER:
            specs['Instrument_Description'] = f"Unknown Variable ({code})"
            return specs

        desc_words = [InstrumentLogicEngine.FIRST_LETTER.get(first_char, 'Process')]
        found_function = False 

        # -- MODIFIER LOGIC (Middle Letters) --
        for i, char in enumerate(rest_chars[:-1]):
            if char == 'S':
                # 'S' = Switch when followed by H/L/A (e.g. PSH, PSL, PSHA),
                # otherwise Safety (e.g. PST = Pressure Safety Transmitter)
                next_char = rest_chars[i+1]
                if next_char in ['H', 'L', 'A']:
                    desc_words.append("Switch")
                else:
                    desc_words.append("Safety")
            elif char == 'A':
                # 'A' in middle = Alarm (PAH, TAH, LAH, PAHH, etc.)
                desc_words.append("Alarm")
            elif char in InstrumentLogicEngine.MODIFIERS:
                desc_words.append(InstrumentLogicEngine.MODIFIERS[char])

        # -- FUNCTION LOGIC (Last Letter) --
        last_char = rest_chars[-1] if rest_chars else ""
        if last_char in InstrumentLogicEngine.OUTPUT_ACTIVE:
            desc_words.append(InstrumentLogicEngine.OUTPUT_ACTIVE[last_char])
            found_function = True
        elif last_char in InstrumentLogicEngine.READOUT_PASSIVE:
            desc_words.append(InstrumentLogicEngine.READOUT_PASSIVE[last_char])
            found_function = True

        # H/L at the end qualifies as a valid function when preceded by Switch (S)
        # or Alarm (A): PSH, PSL, PSHH, PSLL, PAH, PAL, TSH, LSH, LSHH, LSLL …
        if last_char in ('H', 'L') and any(c in rest_chars for c in ('S', 'A')):
            desc_words.append(InstrumentLogicEngine.MODIFIERS.get(last_char, ''))
            found_function = True
        
        specs['Instrument_Description'] = " ".join(desc_words).replace("  ", " ").strip()

        # 3. FINAL SAFETY CHECK
        if not found_function and len(code) > 1:
            specs['Confidence'] = "Low"
            specs['Instrument_Description'] += " (?)"
            return specs
        
        # If we made it here, it's a valid standard tag
        specs['Confidence'] = "High"
        specs['System'] = "DCS"
        specs['IO_Type'] = "Soft Link"

        # ---------------------------------------------------------
        # 4. ENGINEERING SPECS LOGIC
        # ---------------------------------------------------------
        desc = specs['Instrument_Description']

        if "Transmitter" in desc:
            specs['IO_Type'] = "AI"
            specs['Signal_Type'] = "4-20mA + HART"
            specs['Power_Supply'] = "24VDC (Loop Powered)"
            if first_char == 'Z': specs['Signal_Type'] = "4-20mA"

        elif "Element" in desc or "Well" in desc:
            # Physical passive field device — no electrical signal (FE, TE, TW, PE)
            specs['IO_Type'] = ""
            specs['Signal_Type'] = ""
            specs['Power_Supply'] = ""
            specs['System'] = ""
            specs['Mounting'] = "Field / Direct"

        elif "Control Valve" in desc or (first_char in ['F','L','P','T'] and 'V' in rest_chars):
            specs['IO_Type'] = "AO"
            specs['Signal_Type'] = "4-20mA"
            specs['Power_Supply'] = "24VDC"
            if "Control Valve" not in desc: specs['Instrument_Description'] += " (Control Valve)"

        elif "Switch" in desc:
            specs['IO_Type'] = "DI"
            specs['Signal_Type'] = "24VDC (Dry Contact)"
            specs['Power_Supply'] = "24VDC"
            # High-High / Low-Low or explicit Safety → SIS/ESD trip switch
            if "Safety" in desc or "High High" in desc or "Low Low" in desc:
                specs['System'] = "SIS/ESD"

        elif "Alarm" in desc and "Switch" not in desc:
            # Alarm tags (PAH, TAH, LAH …) are DCS soft displays, not hardwired
            specs['System'] = "DCS"
            specs['IO_Type'] = "Soft Link"

        elif "Gauge" in desc:
            # Physical direct-read gauge — no electrical signal, no system
            specs['System'] = ""
            specs['IO_Type'] = ""
            specs['Mounting'] = "Field / Direct"

        elif "Indicator" in desc:
            # Panel / HMI soft indicator — DCS display, not a hardwired device
            specs['System'] = "DCS"
            if "Transmitter" not in desc:
                specs['IO_Type'] = "Soft Link"

        return specs
