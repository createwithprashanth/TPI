/**
 * ISA 5.1 P&ID Symbol Library
 * Each symbol is defined as inline SVG markup (viewBox 0 0 100 100).
 * stroke="currentColor" / fill="currentColor" allows runtime color injection.
 */

export interface ISASymbol {
  id: string;
  name: string;
  category: string;
  description: string;
  // SVG inner markup (no <svg> wrapper). Use currentColor for stroke/fill.
  svg: string;
  defaultSize: number; // px on the canvas
  tags: string[];
}

export interface ISACategory {
  id: string;
  label: string;
  symbols: ISASymbol[];
}

// ── Shared style constants ──────────────────────────────────────────────────
const SW = 4;   // stroke-width for most symbols
const SW2 = 3;

// ── INSTRUMENT BUBBLES ──────────────────────────────────────────────────────
const INSTRUMENT_BUBBLES: ISASymbol[] = [
  {
    id: "ib-field-discrete",
    name: "Field Discrete",
    category: "Instrument Bubbles",
    description: "Field-mounted discrete instrument",
    svg: `<circle cx="50" cy="50" r="42" stroke="currentColor" stroke-width="${SW}" fill="none"/>`,
    defaultSize: 48,
    tags: ["instrument", "field", "discrete", "bubble"],
  },
  {
    id: "ib-shared-dcs",
    name: "Shared DCS",
    category: "Instrument Bubbles",
    description: "Shared display / shared control (DCS)",
    svg: `<circle cx="50" cy="50" r="42" stroke="currentColor" stroke-width="${SW}" fill="none"/>
          <line x1="8" y1="50" x2="92" y2="50" stroke="currentColor" stroke-width="${SW}"/>`,
    defaultSize: 48,
    tags: ["dcs", "shared", "instrument", "bubble"],
  },
  {
    id: "ib-panel-mounted",
    name: "Panel Mounted (Rear)",
    category: "Instrument Bubbles",
    description: "Panel-mounted behind, inaccessible to operator",
    svg: `<circle cx="50" cy="50" r="42" stroke="currentColor" stroke-width="${SW}" fill="none"/>
          <line x1="8" y1="42" x2="92" y2="42" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="8" y1="58" x2="92" y2="58" stroke="currentColor" stroke-width="${SW}"/>`,
    defaultSize: 48,
    tags: ["panel", "instrument", "bubble", "behind"],
  },
  {
    id: "ib-panel-accessible",
    name: "Panel Mounted (Front)",
    category: "Instrument Bubbles",
    description: "Panel-mounted, accessible to operator",
    svg: `<circle cx="50" cy="50" r="42" stroke="currentColor" stroke-width="${SW}" fill="none"/>
          <line x1="8" y1="50" x2="92" y2="50" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 48,
    tags: ["panel front", "instrument", "bubble", "accessible"],
  },
  {
    id: "ib-computer",
    name: "Computer Function",
    category: "Instrument Bubbles",
    description: "Computer / software function",
    svg: `<polygon points="50,5 93,28 93,72 50,95 7,72 7,28" stroke="currentColor" stroke-width="${SW}" fill="none"/>`,
    defaultSize: 52,
    tags: ["computer", "software", "function", "hexagon"],
  },
  {
    id: "ib-plc",
    name: "PLC / Logic",
    category: "Instrument Bubbles",
    description: "Programmable logic controller",
    svg: `<rect x="8" y="8" width="84" height="84" stroke="currentColor" stroke-width="${SW}" fill="none"/>`,
    defaultSize: 48,
    tags: ["plc", "logic", "controller", "square"],
  },
  {
    id: "ib-sis",
    name: "SIS / Safety",
    category: "Instrument Bubbles",
    description: "Safety Instrumented System (SIL)",
    svg: `<rect x="8" y="8" width="84" height="84" stroke="currentColor" stroke-width="${SW}" fill="none"/>
          <line x1="8" y1="50" x2="92" y2="50" stroke="currentColor" stroke-width="${SW}"/>`,
    defaultSize: 48,
    tags: ["sis", "sil", "safety", "square"],
  },
  {
    id: "ib-undefined",
    name: "Undefined Location",
    category: "Instrument Bubbles",
    description: "Undefined or general instrument location",
    svg: `<circle cx="50" cy="50" r="42" stroke="currentColor" stroke-width="${SW}" fill="none" stroke-dasharray="8,5"/>`,
    defaultSize: 48,
    tags: ["undefined", "general", "bubble"],
  },
  {
    id: "ib-remote-transmitter",
    name: "Remote Transmitter",
    category: "Instrument Bubbles",
    description: "Remotely-mounted transmitter (with capillary)",
    svg: `<circle cx="50" cy="50" r="38" stroke="currentColor" stroke-width="${SW}" fill="none"/>
          <line x1="8" y1="50" x2="12" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="88" y1="50" x2="92" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="50" y1="88" x2="50" y2="95" stroke="currentColor" stroke-width="${SW2}" stroke-dasharray="4,3"/>`,
    defaultSize: 48,
    tags: ["remote", "transmitter", "field", "bubble"],
  },
  {
    id: "ib-analyzer",
    name: "Analyzer",
    category: "Instrument Bubbles",
    description: "Online process analyzer instrument",
    svg: `<circle cx="50" cy="50" r="42" stroke="currentColor" stroke-width="${SW}" fill="none"/>
          <text x="50" y="58" text-anchor="middle" font-size="28" font-weight="bold" fill="currentColor" font-family="sans-serif">A</text>`,
    defaultSize: 52,
    tags: ["analyzer", "analysis", "online", "AT"],
  },
  {
    id: "ib-transmitter",
    name: "Transmitter",
    category: "Instrument Bubbles",
    description: "Field-mounted transmitter (FT/PT/TT etc.)",
    svg: `<circle cx="50" cy="50" r="42" stroke="currentColor" stroke-width="${SW}" fill="none"/>
          <text x="50" y="58" text-anchor="middle" font-size="24" font-weight="bold" fill="currentColor" font-family="sans-serif">T</text>`,
    defaultSize: 48,
    tags: ["transmitter", "T", "FT", "PT", "TT"],
  },
  {
    id: "ib-local-indicator",
    name: "Local Indicator",
    category: "Instrument Bubbles",
    description: "Field-mounted local indicator / gauge",
    svg: `<circle cx="50" cy="50" r="42" stroke="currentColor" stroke-width="${SW}" fill="none"/>
          <text x="50" y="60" text-anchor="middle" font-size="28" font-weight="bold" fill="currentColor" font-family="sans-serif">I</text>`,
    defaultSize: 48,
    tags: ["indicator", "gauge", "local", "PI", "LI", "TI"],
  },
  {
    id: "ib-recorder",
    name: "Recorder",
    category: "Instrument Bubbles",
    description: "Recorder / trend recording function",
    svg: `<circle cx="50" cy="50" r="42" stroke="currentColor" stroke-width="${SW}" fill="none"/>
          <text x="50" y="60" text-anchor="middle" font-size="26" font-weight="bold" fill="currentColor" font-family="sans-serif">R</text>`,
    defaultSize: 48,
    tags: ["recorder", "trend", "record", "FR", "PR", "TR"],
  },
  {
    id: "ib-alarm",
    name: "Alarm Function",
    category: "Instrument Bubbles",
    description: "Alarm / annunciator function",
    svg: `<circle cx="50" cy="50" r="42" stroke="currentColor" stroke-width="${SW}" fill="none"/>
          <path d="M32,66 L50,24 L68,66 Z" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <circle cx="50" cy="57" r="3" fill="currentColor"/>
          <line x1="50" y1="38" x2="50" y2="51" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,
    defaultSize: 52,
    tags: ["alarm", "annunciator", "warning", "LAH", "PAH"],
  },
  {
    id: "ib-interlock",
    name: "Interlock / Logic",
    category: "Instrument Bubbles",
    description: "Interlock or permissive logic function",
    svg: `<polygon points="50,6 94,50 50,94 6,50" stroke="currentColor" stroke-width="${SW}" fill="none"/>
          <text x="50" y="58" text-anchor="middle" font-size="20" font-weight="bold" fill="currentColor" font-family="sans-serif">IL</text>`,
    defaultSize: 52,
    tags: ["interlock", "logic", "permissive", "trip", "IL"],
  },
];

// ── VALVES ──────────────────────────────────────────────────────────────────
const VALVES: ISASymbol[] = [
  {
    id: "v-gate",
    name: "Gate Valve",
    category: "Valves",
    description: "Gate valve (inline isolation)",
    svg: `<path d="M8,20 L50,50 L8,80 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M92,20 L50,50 L92,80 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <line x1="50" y1="8" x2="50" y2="50" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 44,
    tags: ["gate", "valve", "isolation", "block"],
  },
  {
    id: "v-globe",
    name: "Globe Valve",
    category: "Valves",
    description: "Globe valve",
    svg: `<path d="M8,20 L50,50 L8,80 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M92,20 L50,50 L92,80 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <circle cx="50" cy="50" r="12" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="8" x2="50" y2="38" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 44,
    tags: ["globe", "valve", "control"],
  },
  {
    id: "v-ball",
    name: "Ball Valve",
    category: "Valves",
    description: "Ball valve",
    svg: `<path d="M8,20 L50,50 L8,80 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M92,20 L50,50 L92,80 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <circle cx="50" cy="50" r="18" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="8" x2="50" y2="32" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 44,
    tags: ["ball", "valve", "isolation", "quarter-turn"],
  },
  {
    id: "v-butterfly",
    name: "Butterfly Valve",
    category: "Valves",
    description: "Butterfly valve",
    svg: `<circle cx="50" cy="50" r="40" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="${SW2}"/>
          <path d="M50,10 C30,30 30,70 50,90 C70,70 70,30 50,10 Z" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="5" x2="50" y2="15" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 48,
    tags: ["butterfly", "valve", "quarter-turn", "wafer"],
  },
  {
    id: "v-check",
    name: "Check Valve",
    category: "Valves",
    description: "Non-return / check valve",
    svg: `<path d="M8,20 L50,50 L8,80 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <line x1="50" y1="15" x2="50" y2="85" stroke="currentColor" stroke-width="${SW2+1}"/>`,
    defaultSize: 44,
    tags: ["check", "non-return", "valve", "NRV"],
  },
  {
    id: "v-control",
    name: "Control Valve",
    category: "Valves",
    description: "Control valve (globe body, generic actuator)",
    svg: `<path d="M8,52 L50,76 L8,96 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M92,52 L50,76 L92,96 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <rect x="30" y="8" width="40" height="44" rx="4" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="52" x2="50" y2="76" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 52,
    tags: ["control", "valve", "CV", "actuated"],
  },
  {
    id: "v-safety-relief",
    name: "Safety / Relief Valve",
    category: "Valves",
    description: "Pressure safety / relief valve (PSV/PRV)",
    svg: `<path d="M8,40 L50,65 L8,90 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M92,40 L50,65 L92,90 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M35,10 L35,40 M65,10 L65,40 M35,10 Q50,25 65,10" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="40" x2="50" y2="65" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 52,
    tags: ["safety", "relief", "PSV", "PRV", "rupture"],
  },
  {
    id: "v-plug",
    name: "Plug Valve",
    category: "Valves",
    description: "Plug valve / cock",
    svg: `<path d="M8,20 L50,50 L8,80 Z" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M92,20 L50,50 L92,80 Z" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M8,20 L50,50 L92,20" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M8,80 L50,50 L92,80" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="8" x2="50" y2="50" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 44,
    tags: ["plug", "cock", "valve"],
  },
  {
    id: "v-angle",
    name: "Angle Valve",
    category: "Valves",
    description: "Angle valve (90° turn)",
    svg: `<path d="M8,65 L50,65 L50,18" stroke="currentColor" stroke-width="${SW2+1}" fill="none" stroke-linejoin="round"/>
          <path d="M8,47 L50,65 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M8,83 L50,65 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M32,18 L50,42 L68,18" stroke="currentColor" stroke-width="${SW2}" fill="none"/>`,
    defaultSize: 52,
    tags: ["angle", "valve"],
  },
  {
    id: "v-three-way",
    name: "3-Way Valve",
    category: "Valves",
    description: "Three-way valve",
    svg: `<path d="M8,50 L92,50" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M50,50 L50,90" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M20,30 L50,50 L20,70 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M80,30 L50,50 L80,70 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <line x1="50" y1="8" x2="50" y2="30" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 52,
    tags: ["three-way", "3-way", "diverting", "mixing"],
  },
  // ── New valve types ────────────────────────────────────────────────────────
  {
    id: "v-needle",
    name: "Needle Valve",
    category: "Valves",
    description: "Fine-adjustment needle valve",
    svg: `<path d="M8,22 L50,50 L8,78 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M92,22 L50,50 L92,78 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <line x1="50" y1="8" x2="50" y2="50" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="42" y1="8" x2="58" y2="8" stroke="currentColor" stroke-width="2.5"/>
          <line x1="43" y1="16" x2="57" y2="16" stroke="currentColor" stroke-width="1.5"/>
          <line x1="44" y1="24" x2="56" y2="24" stroke="currentColor" stroke-width="1.5"/>`,
    defaultSize: 44,
    tags: ["needle", "valve", "fine", "metering"],
  },
  {
    id: "v-diaphragm",
    name: "Diaphragm Valve",
    category: "Valves",
    description: "Flexible diaphragm valve (weir type)",
    svg: `<path d="M8,22 L50,50 L8,78 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M92,22 L50,50 L92,78 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M20,50 Q50,16 80,50" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="8" x2="50" y2="16" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 44,
    tags: ["diaphragm", "valve", "weir"],
  },
  {
    id: "v-pressure-regulator",
    name: "Pressure Regulator",
    category: "Valves",
    description: "Self-acting pressure reducing valve",
    svg: `<path d="M5,50 L30,32 L30,68 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M95,50 L70,32 L70,68 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <line x1="30" y1="50" x2="70" y2="50" stroke="currentColor" stroke-width="${SW2}"/>
          <rect x="35" y="8" width="30" height="24" rx="3" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M39,14 Q43,20 47,14 Q51,8 55,14 Q59,20 63,14" stroke="currentColor" stroke-width="2" fill="none"/>
          <line x1="50" y1="32" x2="50" y2="50" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 48,
    tags: ["pressure regulator", "PRV", "self-acting", "reducing"],
  },
  {
    id: "v-knife-gate",
    name: "Knife Gate Valve",
    category: "Valves",
    description: "Knife gate / slurry isolation valve",
    svg: `<path d="M8,22 L50,50 L8,78 Z" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M92,22 L50,50 L92,78 Z" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="44" y1="5" x2="56" y2="5" stroke="currentColor" stroke-width="3"/>
          <line x1="50" y1="5" x2="50" y2="50" stroke="currentColor" stroke-width="5"/>`,
    defaultSize: 44,
    tags: ["knife gate", "slurry", "valve"],
  },
  {
    id: "v-fail-close",
    name: "Control Valve (FC)",
    category: "Valves",
    description: "Control valve — fail-close on air/signal failure",
    svg: `<path d="M8,50 L50,74 L8,96 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M92,50 L50,74 L92,96 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <rect x="30" y="8" width="40" height="42" rx="4" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="50" x2="50" y2="74" stroke="currentColor" stroke-width="${SW2}"/>
          <polygon points="43,42 57,42 50,50" fill="currentColor"/>`,
    defaultSize: 52,
    tags: ["control valve", "FC", "fail close", "spring close"],
  },
  {
    id: "v-fail-open",
    name: "Control Valve (FO)",
    category: "Valves",
    description: "Control valve — fail-open on air/signal failure",
    svg: `<path d="M8,50 L50,74 L8,96 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M92,50 L50,74 L92,96 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <rect x="30" y="8" width="40" height="42" rx="4" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="50" x2="50" y2="74" stroke="currentColor" stroke-width="${SW2}"/>
          <polygon points="43,8 57,8 50,0" fill="currentColor"/>`,
    defaultSize: 52,
    tags: ["control valve", "FO", "fail open", "spring open"],
  },
  {
    id: "v-blowdown",
    name: "Blowdown / Drain Valve",
    category: "Valves",
    description: "Blowdown or drain valve on downward branch",
    svg: `<line x1="5" y1="35" x2="95" y2="35" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="50" y1="35" x2="50" y2="52" stroke="currentColor" stroke-width="${SW2}"/>
          <path d="M32,52 L50,76 L32,96 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <path d="M68,52 L50,76 L68,96 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>`,
    defaultSize: 52,
    tags: ["blowdown", "drain", "vent", "BD"],
  },
  {
    id: "v-double-block",
    name: "Double Block & Bleed",
    category: "Valves",
    description: "Double block and bleed valve arrangement",
    svg: `<path d="M5,22 L27,50 L5,78 Z" stroke="currentColor" stroke-width="2.5" fill="currentColor"/>
          <path d="M48,22 L27,50 L48,78 Z" stroke="currentColor" stroke-width="2.5" fill="currentColor"/>
          <path d="M52,22 L73,50 L52,78 Z" stroke="currentColor" stroke-width="2.5" fill="currentColor"/>
          <path d="M95,22 L73,50 L95,78 Z" stroke="currentColor" stroke-width="2.5" fill="currentColor"/>
          <line x1="50" y1="50" x2="50" y2="75" stroke="currentColor" stroke-width="2.5"/>
          <path d="M40,75 L50,92 L60,75 Z" stroke="currentColor" stroke-width="2" fill="currentColor"/>`,
    defaultSize: 56,
    tags: ["double block", "bleed", "DBB", "isolation"],
  },
  {
    id: "v-pinch",
    name: "Pinch Valve",
    category: "Valves",
    description: "Pinch valve (flexible sleeve)",
    svg: `<line x1="5" y1="50" x2="22" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="78" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <path d="M22,30 L78,30 L78,70 L22,70 Z" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M22,30 Q50,46 78,30" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M22,70 Q50,54 78,70" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="8" x2="50" y2="30" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 48,
    tags: ["pinch", "valve", "sleeve", "flexible"],
  },
  {
    id: "v-swing-check",
    name: "Swing Check Valve",
    category: "Valves",
    description: "Swing check / non-return valve",
    svg: `<path d="M8,22 L50,50 L8,78 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor"/>
          <line x1="50" y1="16" x2="50" y2="84" stroke="currentColor" stroke-width="${SW2 + 1}"/>
          <path d="M50,28 Q72,44 50,64" stroke="currentColor" stroke-width="${SW2}" fill="none"/>`,
    defaultSize: 44,
    tags: ["swing check", "check", "non-return", "NRV", "valve"],
  },
  {
    id: "v-tilting-disc-check",
    name: "Tilting Disc Check",
    category: "Valves",
    description: "Tilting disc check valve",
    svg: `<line x1="8" y1="50" x2="92" y2="50" stroke="currentColor" stroke-width="${SW2}"/>
          <circle cx="50" cy="50" r="32" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="34" y1="68" x2="68" y2="30" stroke="currentColor" stroke-width="${SW2 + 1}"/>
          <line x1="62" y1="18" x2="62" y2="82" stroke="currentColor" stroke-width="2"/>`,
    defaultSize: 50,
    tags: ["tilting disc", "check", "non-return", "valve"],
  },
  {
    id: "v-spectacle-blind",
    name: "Spectacle Blind",
    category: "Valves",
    description: "Spectacle blind / line blind",
    svg: `<line x1="5" y1="50" x2="25" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="75" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <circle cx="36" cy="50" r="18" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <circle cx="64" cy="50" r="18" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="26" y1="32" x2="74" y2="68" stroke="currentColor" stroke-width="2"/>`,
    defaultSize: 52,
    tags: ["spectacle blind", "blind", "spade", "line blind", "isolation"],
  },
  {
    id: "v-pressure-vacuum",
    name: "Pressure / Vacuum Valve",
    category: "Valves",
    description: "Tank pressure-vacuum breather valve",
    svg: `<line x1="50" y1="90" x2="50" y2="58" stroke="currentColor" stroke-width="${SW2}"/>
          <rect x="24" y="38" width="52" height="20" rx="4" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M32,38 Q50,12 68,38" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M36,58 Q50,72 64,58" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="20" y1="48" x2="80" y2="48" stroke="currentColor" stroke-width="1.5"/>`,
    defaultSize: 52,
    tags: ["pressure vacuum", "breather", "PV valve", "tank vent"],
  },
  {
    id: "v-vacuum-breaker",
    name: "Vacuum Breaker",
    category: "Valves",
    description: "Vacuum breaker valve",
    svg: `<line x1="50" y1="92" x2="50" y2="58" stroke="currentColor" stroke-width="${SW2}"/>
          <path d="M24,58 L50,34 L76,58 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor" fill-opacity="0.2"/>
          <path d="M34,34 Q50,14 66,34" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <polygon points="43,40 57,40 50,52" fill="currentColor"/>`,
    defaultSize: 52,
    tags: ["vacuum breaker", "vacuum", "breaker", "vent valve"],
  },
];

// ── ACTUATORS ───────────────────────────────────────────────────────────────
const ACTUATORS: ISASymbol[] = [
  {
    id: "act-pneumatic-spring",
    name: "Pneumatic (Spring Return)",
    category: "Actuators",
    description: "Spring-return pneumatic diaphragm actuator",
    svg: `<path d="M20,15 L80,15 L80,55 L20,55 Z" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M20,35 Q30,45 40,35 Q50,25 60,35 Q70,45 80,35" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="55" x2="50" y2="85" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 52,
    tags: ["pneumatic", "spring", "return", "diaphragm", "actuator"],
  },
  {
    id: "act-pneumatic-da",
    name: "Pneumatic (Double-Acting)",
    category: "Actuators",
    description: "Double-acting pneumatic cylinder actuator",
    svg: `<rect x="20" y="15" width="60" height="55" rx="5" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="20" y1="42" x2="80" y2="42" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="50" y1="70" x2="50" y2="90" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="5" y1="28" x2="20" y2="28" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="5" y1="55" x2="20" y2="55" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 52,
    tags: ["pneumatic", "double-acting", "cylinder", "actuator"],
  },
  {
    id: "act-electric-motor",
    name: "Electric Motor",
    category: "Actuators",
    description: "Electric motor actuator (MOV)",
    svg: `<circle cx="50" cy="38" r="28" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <text x="50" y="44" text-anchor="middle" font-size="22" font-weight="bold" fill="currentColor" font-family="sans-serif">M</text>
          <line x1="50" y1="66" x2="50" y2="90" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 52,
    tags: ["electric", "motor", "MOV", "actuator"],
  },
  {
    id: "act-solenoid",
    name: "Solenoid",
    category: "Actuators",
    description: "Solenoid actuator (SOV)",
    svg: `<rect x="28" y="12" width="44" height="45" rx="3" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="28" y1="24" x2="72" y2="24" stroke="currentColor" stroke-width="2"/>
          <line x1="28" y1="35" x2="72" y2="35" stroke="currentColor" stroke-width="2"/>
          <line x1="28" y1="46" x2="72" y2="46" stroke="currentColor" stroke-width="2"/>
          <line x1="50" y1="57" x2="50" y2="78" stroke="currentColor" stroke-width="${SW2}"/>
          <path d="M38,78 L50,95 L62,78 Z" stroke="currentColor" stroke-width="2" fill="currentColor"/>`,
    defaultSize: 48,
    tags: ["solenoid", "SOV", "actuator"],
  },
  {
    id: "act-hydraulic",
    name: "Hydraulic",
    category: "Actuators",
    description: "Hydraulic actuator",
    svg: `<rect x="20" y="15" width="60" height="55" rx="3" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <rect x="20" y="15" width="60" height="25" rx="3" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity="0.2"/>
          <line x1="50" y1="70" x2="50" y2="90" stroke="currentColor" stroke-width="${SW2}"/>
          <circle cx="50" cy="40" r="6" stroke="currentColor" stroke-width="2" fill="none"/>`,
    defaultSize: 52,
    tags: ["hydraulic", "actuator"],
  },
  // ── New actuator types ─────────────────────────────────────────────────────
  {
    id: "act-handwheel",
    name: "Handwheel (Manual)",
    category: "Actuators",
    description: "Manual handwheel actuator",
    svg: `<circle cx="50" cy="30" r="24" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <circle cx="50" cy="30" r="6" stroke="currentColor" stroke-width="2" fill="none"/>
          <line x1="50" y1="6" x2="50" y2="24" stroke="currentColor" stroke-width="2.5"/>
          <line x1="26" y1="30" x2="44" y2="30" stroke="currentColor" stroke-width="2.5"/>
          <line x1="56" y1="30" x2="74" y2="30" stroke="currentColor" stroke-width="2.5"/>
          <line x1="50" y1="36" x2="50" y2="54" stroke="currentColor" stroke-width="2.5"/>
          <line x1="50" y1="54" x2="50" y2="88" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 52,
    tags: ["handwheel", "manual", "HW", "hand operated"],
  },
  {
    id: "act-hand-lever",
    name: "Hand Lever",
    category: "Actuators",
    description: "Quarter-turn hand lever actuator",
    svg: `<rect x="35" y="30" width="30" height="18" rx="3" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="48" x2="50" y2="88" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="35" y1="39" x2="8" y2="20" stroke="currentColor" stroke-width="${SW+1}" stroke-linecap="round"/>
          <circle cx="8" cy="20" r="5" stroke="currentColor" stroke-width="2" fill="currentColor"/>`,
    defaultSize: 52,
    tags: ["hand lever", "lever", "quarter turn", "manual"],
  },
  {
    id: "act-positioner",
    name: "I/P Positioner",
    category: "Actuators",
    description: "Electro-pneumatic valve positioner",
    svg: `<rect x="25" y="20" width="50" height="35" rx="3" stroke="currentColor" stroke-width="2.5" fill="none"/>
          <text x="50" y="42" text-anchor="middle" font-size="14" font-weight="bold" fill="currentColor" font-family="sans-serif">I/P</text>
          <line x1="50" y1="55" x2="50" y2="88" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="25" y1="37" x2="5" y2="37" stroke="currentColor" stroke-width="2" stroke-dasharray="4,3"/>
          <line x1="75" y1="37" x2="95" y2="37" stroke="currentColor" stroke-width="2"/>`,
    defaultSize: 52,
    tags: ["positioner", "I/P", "converter", "electro-pneumatic"],
  },
  {
    id: "act-lockout",
    name: "Lockout / Tagout",
    category: "Actuators",
    description: "Locked position indicator (LOTO)",
    svg: `<rect x="30" y="30" width="40" height="36" rx="4" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M38,30 L38,20 Q38,8 50,8 Q62,8 62,20 L62,30" stroke="currentColor" stroke-width="2.5" fill="none"/>
          <circle cx="50" cy="52" r="5" stroke="currentColor" stroke-width="2" fill="currentColor"/>
          <line x1="50" y1="66" x2="50" y2="88" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 52,
    tags: ["lockout", "tagout", "locked", "LOTO"],
  },
];

// ── INLINE ELEMENTS ─────────────────────────────────────────────────────────
const INLINE_ELEMENTS: ISASymbol[] = [
  {
    id: "ie-orifice-plate",
    name: "Orifice Plate",
    category: "Inline Elements",
    description: "Restriction orifice / orifice plate (FE)",
    svg: `<line x1="8" y1="50" x2="40" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="60" y1="50" x2="92" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="40" y1="20" x2="40" y2="80" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="60" y1="20" x2="60" y2="80" stroke="currentColor" stroke-width="${SW}"/>`,
    defaultSize: 48,
    tags: ["orifice", "plate", "FE", "flow element", "restriction"],
  },
  {
    id: "ie-venturi",
    name: "Venturi / Nozzle",
    category: "Inline Elements",
    description: "Venturi tube or flow nozzle",
    svg: `<line x1="8" y1="50" x2="30" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <path d="M30,30 L55,44 L55,56 L30,70 Z" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="55" y1="50" x2="70" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <path d="M70,44 L92,30" stroke="currentColor" stroke-width="${SW2}"/>
          <path d="M70,56 L92,70" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 52,
    tags: ["venturi", "nozzle", "flow element", "FE"],
  },
  {
    id: "ie-rotameter",
    name: "Rotameter",
    category: "Inline Elements",
    description: "Variable area flow meter (rotameter)",
    svg: `<line x1="8" y1="50" x2="25" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="75" y1="50" x2="92" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <path d="M25,20 L75,20 L75,80 L25,80 Z" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <ellipse cx="50" cy="50" rx="12" ry="16" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity="0.3"/>`,
    defaultSize: 52,
    tags: ["rotameter", "flow meter", "variable area"],
  },
  {
    id: "ie-strainer",
    name: "Strainer / Filter",
    category: "Inline Elements",
    description: "In-line strainer or filter",
    svg: `<line x1="8" y1="50" x2="25" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="75" y1="50" x2="92" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <polygon points="25,20 75,20 75,80 25,80" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="35" y1="28" x2="45" y2="72" stroke="currentColor" stroke-width="2"/>
          <line x1="47" y1="28" x2="57" y2="72" stroke="currentColor" stroke-width="2"/>
          <line x1="59" y1="28" x2="69" y2="72" stroke="currentColor" stroke-width="2"/>`,
    defaultSize: 52,
    tags: ["strainer", "filter", "Y-strainer"],
  },
  {
    id: "ie-silencer",
    name: "Silencer / Flame Arrestor",
    category: "Inline Elements",
    description: "Silencer or flame arrestor",
    svg: `<line x1="8" y1="50" x2="25" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="75" y1="50" x2="92" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <rect x="25" y="25" width="50" height="50" rx="6" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="38" y1="25" x2="38" y2="75" stroke="currentColor" stroke-width="2"/>
          <line x1="50" y1="25" x2="50" y2="75" stroke="currentColor" stroke-width="2"/>
          <line x1="62" y1="25" x2="62" y2="75" stroke="currentColor" stroke-width="2"/>`,
    defaultSize: 52,
    tags: ["silencer", "flame arrestor", "breather"],
  },
  {
    id: "ie-rupture-disc",
    name: "Rupture Disc",
    category: "Inline Elements",
    description: "Rupture disc / bursting disc",
    svg: `<line x1="8" y1="50" x2="40" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="60" y1="50" x2="92" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <path d="M40,20 Q50,50 40,80" stroke="currentColor" stroke-width="${SW}" fill="none"/>
          <line x1="40" y1="20" x2="60" y2="20" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="40" y1="80" x2="60" y2="80" stroke="currentColor" stroke-width="${SW}"/>`,
    defaultSize: 48,
    tags: ["rupture disc", "bursting disc", "pressure relief"],
  },
  {
    id: "ie-pump",
    name: "Centrifugal Pump",
    category: "Inline Elements",
    description: "Centrifugal pump",
    svg: `<circle cx="50" cy="58" r="30" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M50,28 L50,58" stroke="currentColor" stroke-width="${SW2}"/>
          <path d="M50,58 Q65,42 80,58" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="8" y1="58" x2="20" y2="58" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="50" y1="12" x2="50" y2="28" stroke="currentColor" stroke-width="${SW}"/>`,
    defaultSize: 56,
    tags: ["pump", "centrifugal", "PU"],
  },
  {
    id: "ie-heat-exchanger",
    name: "Heat Exchanger",
    category: "Inline Elements",
    description: "Shell and tube heat exchanger",
    svg: `<rect x="10" y="30" width="80" height="40" rx="20" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="35" y1="30" x2="35" y2="70" stroke="currentColor" stroke-width="2"/>
          <line x1="50" y1="30" x2="50" y2="70" stroke="currentColor" stroke-width="2"/>
          <line x1="65" y1="30" x2="65" y2="70" stroke="currentColor" stroke-width="2"/>
          <line x1="8" y1="50" x2="10" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="90" y1="50" x2="92" y2="50" stroke="currentColor" stroke-width="${SW}"/>`,
    defaultSize: 60,
    tags: ["heat exchanger", "HE", "shell and tube"],
  },
  // ── New inline elements ────────────────────────────────────────────────────
  {
    id: "ie-turbine-meter",
    name: "Turbine Flow Meter",
    category: "Inline Elements",
    description: "Turbine-type flow measurement element",
    svg: `<line x1="5" y1="50" x2="25" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="75" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <rect x="25" y="22" width="50" height="56" rx="5" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M40,34 L60,50 L40,66 Z" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity="0.5"/>
          <line x1="50" y1="22" x2="50" y2="34" stroke="currentColor" stroke-width="2"/>`,
    defaultSize: 52,
    tags: ["turbine meter", "flow meter", "FT"],
  },
  {
    id: "ie-mag-meter",
    name: "Magnetic Flow Meter",
    category: "Inline Elements",
    description: "Electromagnetic (mag) flow meter",
    svg: `<line x1="5" y1="50" x2="25" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="75" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <rect x="25" y="28" width="50" height="44" rx="3" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="20" x2="50" y2="28" stroke="currentColor" stroke-width="2"/>
          <line x1="50" y1="72" x2="50" y2="80" stroke="currentColor" stroke-width="2"/>
          <circle cx="50" cy="50" r="10" stroke="currentColor" stroke-width="2" fill="none"/>
          <line x1="35" y1="50" x2="65" y2="50" stroke="currentColor" stroke-width="1.5"/>`,
    defaultSize: 52,
    tags: ["magnetic", "mag meter", "electromagnetic", "flow meter"],
  },
  {
    id: "ie-vortex-meter",
    name: "Vortex Flow Meter",
    category: "Inline Elements",
    description: "Vortex-shedding flow meter",
    svg: `<line x1="5" y1="50" x2="25" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="75" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <rect x="25" y="25" width="50" height="50" rx="3" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="45" y1="32" x2="45" y2="68" stroke="currentColor" stroke-width="4"/>
          <path d="M55,32 Q68,40 62,50 Q55,60 68,68" stroke="currentColor" stroke-width="2" fill="none"/>`,
    defaultSize: 52,
    tags: ["vortex", "flow meter", "FV"],
  },
  {
    id: "ie-coriolis",
    name: "Coriolis Meter",
    category: "Inline Elements",
    description: "Coriolis mass flow meter",
    svg: `<line x1="5" y1="50" x2="25" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="75" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <rect x="25" y="22" width="50" height="56" rx="5" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M36,36 Q50,28 64,36 Q72,44 64,50 Q50,56 36,64 Q28,72 36,78" stroke="currentColor" stroke-width="2.5" fill="none"/>`,
    defaultSize: 52,
    tags: ["coriolis", "mass flow", "meter"],
  },
  {
    id: "ie-static-mixer",
    name: "Static Mixer",
    category: "Inline Elements",
    description: "In-line static mixer element",
    svg: `<line x1="5" y1="50" x2="22" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="78" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <rect x="22" y="26" width="56" height="48" rx="3" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="34" y1="30" x2="46" y2="70" stroke="currentColor" stroke-width="2"/>
          <line x1="46" y1="30" x2="58" y2="70" stroke="currentColor" stroke-width="2"/>
          <line x1="58" y1="30" x2="70" y2="70" stroke="currentColor" stroke-width="2"/>
          <line x1="70" y1="30" x2="58" y2="70" stroke="currentColor" stroke-width="2"/>`,
    defaultSize: 52,
    tags: ["static mixer", "inline mixer"],
  },
  {
    id: "ie-pd-meter",
    name: "PD Meter",
    category: "Inline Elements",
    description: "Positive displacement flow meter",
    svg: `<line x1="5" y1="50" x2="22" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="78" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <rect x="22" y="22" width="56" height="56" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <circle cx="38" cy="50" r="12" stroke="currentColor" stroke-width="2" fill="none"/>
          <circle cx="62" cy="50" r="12" stroke="currentColor" stroke-width="2" fill="none"/>`,
    defaultSize: 52,
    tags: ["PD meter", "positive displacement", "flow meter"],
  },
  {
    id: "ie-flow-conditioner",
    name: "Flow Conditioner",
    category: "Inline Elements",
    description: "Flow conditioner / straightener",
    svg: `<line x1="5" y1="50" x2="28" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="72" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <rect x="28" y="24" width="44" height="52" rx="3" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="28" y1="36" x2="72" y2="36" stroke="currentColor" stroke-width="1.5"/>
          <line x1="28" y1="50" x2="72" y2="50" stroke="currentColor" stroke-width="1.5"/>
          <line x1="28" y1="64" x2="72" y2="64" stroke="currentColor" stroke-width="1.5"/>`,
    defaultSize: 52,
    tags: ["flow conditioner", "straightener", "meter run"],
  },
  {
    id: "ie-concentric-reducer",
    name: "Concentric Reducer",
    category: "Inline Elements",
    description: "Concentric pipe reducer",
    svg: `<line x1="5" y1="38" x2="28" y2="38" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="5" y1="62" x2="28" y2="62" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="72" y1="46" x2="95" y2="46" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="72" y1="54" x2="95" y2="54" stroke="currentColor" stroke-width="${SW}"/>
          <path d="M28,38 L72,46 M28,62 L72,54" stroke="currentColor" stroke-width="${SW2}" fill="none"/>`,
    defaultSize: 52,
    tags: ["reducer", "concentric", "pipe fitting", "transition"],
  },
  {
    id: "ie-eccentric-reducer",
    name: "Eccentric Reducer",
    category: "Inline Elements",
    description: "Eccentric pipe reducer",
    svg: `<line x1="5" y1="38" x2="28" y2="38" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="5" y1="62" x2="28" y2="62" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="72" y1="38" x2="95" y2="38" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="72" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <path d="M28,38 L72,38 M28,62 L72,50" stroke="currentColor" stroke-width="${SW2}" fill="none"/>`,
    defaultSize: 52,
    tags: ["reducer", "eccentric", "pipe fitting", "transition"],
  },
  {
    id: "ie-expansion-joint",
    name: "Expansion Joint",
    category: "Inline Elements",
    description: "Bellows / expansion joint",
    svg: `<line x1="5" y1="50" x2="24" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="76" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <path d="M24,30 Q30,50 36,30 Q42,50 48,30 Q54,50 60,30 Q66,50 72,30" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M24,70 Q30,50 36,70 Q42,50 48,70 Q54,50 60,70 Q66,50 72,70" stroke="currentColor" stroke-width="${SW2}" fill="none"/>`,
    defaultSize: 56,
    tags: ["expansion joint", "bellows", "flexible", "pipe fitting"],
  },
  {
    id: "ie-sight-glass",
    name: "Sight Glass",
    category: "Inline Elements",
    description: "Inline sight glass / flow indicator",
    svg: `<line x1="5" y1="50" x2="25" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="75" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <rect x="25" y="28" width="50" height="44" rx="4" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <circle cx="50" cy="50" r="14" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M39,60 L61,40" stroke="currentColor" stroke-width="2"/>`,
    defaultSize: 52,
    tags: ["sight glass", "flow indicator", "viewing glass", "inline"],
  },
  {
    id: "ie-steam-trap",
    name: "Steam Trap",
    category: "Inline Elements",
    description: "Steam trap / condensate trap",
    svg: `<line x1="5" y1="50" x2="26" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="74" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <path d="M26,30 L74,30 L62,74 L38,74 Z" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M38,44 Q50,34 62,44 Q50,54 38,44" stroke="currentColor" stroke-width="2" fill="none"/>`,
    defaultSize: 52,
    tags: ["steam trap", "trap", "condensate", "ST"],
  },
  {
    id: "ie-sample-point",
    name: "Sample Point",
    category: "Inline Elements",
    description: "Process sample connection",
    svg: `<line x1="5" y1="42" x2="95" y2="42" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="50" y1="42" x2="50" y2="70" stroke="currentColor" stroke-width="${SW2}"/>
          <circle cx="50" cy="78" r="8" stroke="currentColor" stroke-width="2.5" fill="none"/>
          <line x1="36" y1="88" x2="64" y2="88" stroke="currentColor" stroke-width="2.5"/>`,
    defaultSize: 52,
    tags: ["sample", "sample point", "connection", "SC"],
  },
  {
    id: "ie-injection-quill",
    name: "Injection Quill",
    category: "Inline Elements",
    description: "Chemical injection quill / lance",
    svg: `<line x1="5" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="50" y1="12" x2="50" y2="50" stroke="currentColor" stroke-width="${SW2}"/>
          <path d="M42,12 L58,12 L50,2 Z" stroke="currentColor" stroke-width="2" fill="currentColor"/>
          <path d="M50,50 L62,62 M50,50 L38,62" stroke="currentColor" stroke-width="2"/>`,
    defaultSize: 52,
    tags: ["injection", "quill", "chemical injection", "lance"],
  },
];

// ── EQUIPMENT (new category) ─────────────────────────────────────────────────
const EQUIPMENT: ISASymbol[] = [
  {
    id: "eq-vertical-vessel",
    name: "Vertical Vessel",
    category: "Equipment",
    description: "Vertical pressure vessel or drum",
    svg: `<rect x="28" y="22" width="44" height="56" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M28,22 Q50,10 72,22" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M28,78 Q50,90 72,78" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="5" y1="50" x2="28" y2="50" stroke="currentColor" stroke-width="2.5"/>
          <line x1="72" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="2.5"/>`,
    defaultSize: 64,
    tags: ["vessel", "drum", "pressure vessel", "vertical", "V"],
  },
  {
    id: "eq-horizontal-vessel",
    name: "Horizontal Vessel",
    category: "Equipment",
    description: "Horizontal pressure vessel or drum",
    svg: `<rect x="16" y="28" width="68" height="44" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M16,28 Q4,50 16,72" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M84,28 Q96,50 84,72" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="72" x2="50" y2="92" stroke="currentColor" stroke-width="2.5"/>
          <line x1="30" y1="28" x2="30" y2="8" stroke="currentColor" stroke-width="2.5"/>`,
    defaultSize: 68,
    tags: ["vessel", "drum", "horizontal", "separator"],
  },
  {
    id: "eq-column",
    name: "Column / Tower",
    category: "Equipment",
    description: "Distillation column or packed tower",
    svg: `<rect x="33" y="8" width="34" height="84" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M33,8 Q50,0 67,8" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M33,92 Q50,100 67,92" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="33" y1="32" x2="67" y2="32" stroke="currentColor" stroke-width="1.5"/>
          <line x1="33" y1="52" x2="67" y2="52" stroke="currentColor" stroke-width="1.5"/>
          <line x1="33" y1="70" x2="67" y2="70" stroke="currentColor" stroke-width="1.5"/>
          <line x1="5" y1="32" x2="33" y2="32" stroke="currentColor" stroke-width="2"/>
          <line x1="67" y1="52" x2="95" y2="52" stroke="currentColor" stroke-width="2"/>
          <line x1="5" y1="70" x2="33" y2="70" stroke="currentColor" stroke-width="2"/>`,
    defaultSize: 72,
    tags: ["column", "tower", "distillation", "packed tower", "T"],
  },
  {
    id: "eq-fixed-roof-tank",
    name: "Fixed Roof Tank",
    category: "Equipment",
    description: "Atmospheric fixed-roof storage tank",
    svg: `<rect x="12" y="48" width="76" height="42" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M12,48 L50,18 L88,48" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="12" y1="64" x2="88" y2="64" stroke="currentColor" stroke-width="1.5" stroke-dasharray="5,4"/>`,
    defaultSize: 72,
    tags: ["tank", "storage", "fixed roof", "atmospheric"],
  },
  {
    id: "eq-open-tank",
    name: "Open / Sump Tank",
    category: "Equipment",
    description: "Open-top atmospheric or sump tank",
    svg: `<path d="M12,16 L12,88 L88,88 L88,16" stroke="currentColor" stroke-width="${SW2}" fill="none" stroke-linecap="round"/>
          <line x1="12" y1="58" x2="88" y2="58" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6,4"/>`,
    defaultSize: 64,
    tags: ["open tank", "sump", "atmospheric", "TK"],
  },
  {
    id: "eq-compressor",
    name: "Centrifugal Compressor",
    category: "Equipment",
    description: "Centrifugal compressor",
    svg: `<circle cx="50" cy="56" r="34" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <text x="50" y="65" text-anchor="middle" font-size="26" font-weight="bold" fill="currentColor" font-family="sans-serif">C</text>
          <line x1="5" y1="56" x2="16" y2="56" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="84" y1="56" x2="95" y2="56" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="50" y1="8" x2="50" y2="22" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 60,
    tags: ["compressor", "centrifugal", "C", "gas"],
  },
  {
    id: "eq-recip-compressor",
    name: "Reciprocating Compressor",
    category: "Equipment",
    description: "Reciprocating / piston compressor",
    svg: `<rect x="15" y="25" width="70" height="50" rx="3" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="48" y1="25" x2="48" y2="75" stroke="currentColor" stroke-width="2.5"/>
          <rect x="15" y="38" width="33" height="24" stroke="currentColor" stroke-width="2" fill="none"/>
          <line x1="48" y1="50" x2="72" y2="50" stroke="currentColor" stroke-width="2.5"/>
          <circle cx="74" cy="50" r="9" stroke="currentColor" stroke-width="2.5" fill="none"/>
          <line x1="5" y1="50" x2="15" y2="50" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="85" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 64,
    tags: ["reciprocating", "compressor", "piston", "gas"],
  },
  {
    id: "eq-turbine",
    name: "Steam / Gas Turbine",
    category: "Equipment",
    description: "Steam or gas turbine driver",
    svg: `<circle cx="50" cy="56" r="34" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <text x="50" y="65" text-anchor="middle" font-size="26" font-weight="bold" fill="currentColor" font-family="sans-serif">T</text>
          <line x1="5" y1="56" x2="16" y2="56" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="84" y1="56" x2="95" y2="56" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="50" y1="8" x2="50" y2="22" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 60,
    tags: ["turbine", "steam turbine", "gas turbine", "driver"],
  },
  {
    id: "eq-agitated-vessel",
    name: "Agitated Vessel / Reactor",
    category: "Equipment",
    description: "Stirred tank reactor or mixer vessel",
    svg: `<rect x="22" y="18" width="56" height="62" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <ellipse cx="50" cy="18" rx="28" ry="8" stroke="currentColor" stroke-width="2.5" fill="none"/>
          <path d="M22,80 Q50,94 78,80" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="6" x2="50" y2="76" stroke="currentColor" stroke-width="2"/>
          <line x1="34" y1="52" x2="50" y2="60" stroke="currentColor" stroke-width="2"/>
          <line x1="66" y1="52" x2="50" y2="60" stroke="currentColor" stroke-width="2"/>
          <line x1="38" y1="64" x2="50" y2="68" stroke="currentColor" stroke-width="1.5"/>
          <line x1="62" y1="64" x2="50" y2="68" stroke="currentColor" stroke-width="1.5"/>`,
    defaultSize: 68,
    tags: ["agitator", "mixer", "reactor", "stirred vessel", "R"],
  },
  {
    id: "eq-air-cooler",
    name: "Air Fin Cooler",
    category: "Equipment",
    description: "Aerial fin-fan air cooler",
    svg: `<rect x="10" y="36" width="80" height="34" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="23" y1="36" x2="23" y2="70" stroke="currentColor" stroke-width="1.5"/>
          <line x1="37" y1="36" x2="37" y2="70" stroke="currentColor" stroke-width="1.5"/>
          <line x1="50" y1="36" x2="50" y2="70" stroke="currentColor" stroke-width="1.5"/>
          <line x1="63" y1="36" x2="63" y2="70" stroke="currentColor" stroke-width="1.5"/>
          <line x1="77" y1="36" x2="77" y2="70" stroke="currentColor" stroke-width="1.5"/>
          <circle cx="50" cy="22" r="13" stroke="currentColor" stroke-width="2" fill="none"/>
          <line x1="50" y1="9" x2="50" y2="35" stroke="currentColor" stroke-width="1.5"/>
          <line x1="37" y1="22" x2="63" y2="22" stroke="currentColor" stroke-width="1.5"/>
          <line x1="20" y1="70" x2="20" y2="92" stroke="currentColor" stroke-width="2.5"/>
          <line x1="80" y1="70" x2="80" y2="92" stroke="currentColor" stroke-width="2.5"/>`,
    defaultSize: 68,
    tags: ["air cooler", "fin fan", "aerial cooler", "ACC"],
  },
  {
    id: "eq-fired-heater",
    name: "Fired Heater / Furnace",
    category: "Equipment",
    description: "Direct fired heater or process furnace",
    svg: `<rect x="15" y="15" width="70" height="70" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M35,80 Q30,64 38,56 Q32,46 40,42 Q36,30 48,28 Q44,18 57,20 Q52,30 60,38 Q68,32 66,48 Q74,52 68,65 Q72,74 62,80" stroke="currentColor" stroke-width="2" fill="none"/>
          <line x1="50" y1="5" x2="50" y2="15" stroke="currentColor" stroke-width="4"/>
          <line x1="8" y1="28" x2="15" y2="28" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="8" y1="72" x2="15" y2="72" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 68,
    tags: ["fired heater", "furnace", "heater", "H"],
  },
  {
    id: "eq-separator",
    name: "3-Phase Separator",
    category: "Equipment",
    description: "3-phase horizontal separator (gas/oil/water)",
    svg: `<rect x="16" y="28" width="68" height="44" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M16,28 Q4,50 16,72" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M84,28 Q96,50 84,72" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="55" y1="40" x2="55" y2="72" stroke="currentColor" stroke-width="2"/>
          <line x1="50" y1="28" x2="50" y2="8" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="28" y1="72" x2="28" y2="92" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="72" y1="72" x2="72" y2="92" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 68,
    tags: ["separator", "3-phase", "knockout", "FWKO", "S"],
  },
  {
    id: "eq-knockout-drum",
    name: "Knockout Drum",
    category: "Equipment",
    description: "Vertical knockout / liquid-gas separator",
    svg: `<rect x="28" y="18" width="44" height="60" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M28,18 Q50,6 72,18" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M28,78 Q50,90 72,78" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="6" x2="50" y2="18" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="50" y1="78" x2="50" y2="95" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="28" y1="55" x2="5" y2="55" stroke="currentColor" stroke-width="2.5"/>`,
    defaultSize: 64,
    tags: ["knockout", "drum", "KO drum", "slug catcher"],
  },
  {
    id: "eq-mixing-tee",
    name: "Mixing Tee",
    category: "Equipment",
    description: "In-line mixing tee junction",
    svg: `<line x1="5" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="50" y1="50" x2="50" y2="92" stroke="currentColor" stroke-width="${SW}"/>
          <circle cx="50" cy="50" r="8" stroke="currentColor" stroke-width="2.5" fill="none"/>`,
    defaultSize: 52,
    tags: ["mixing tee", "tee", "junction", "inline mixer"],
  },
  {
    id: "eq-floating-roof-tank",
    name: "Floating Roof Tank",
    category: "Equipment",
    description: "Floating-roof atmospheric storage tank",
    svg: `<rect x="12" y="30" width="76" height="58" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <ellipse cx="50" cy="30" rx="38" ry="10" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <ellipse cx="50" cy="50" rx="32" ry="7" stroke="currentColor" stroke-width="2" fill="none"/>
          <line x1="18" y1="50" x2="82" y2="50" stroke="currentColor" stroke-width="1.5" stroke-dasharray="6,4"/>`,
    defaultSize: 72,
    tags: ["tank", "floating roof", "storage", "atmospheric"],
  },
  {
    id: "eq-positive-displacement-pump",
    name: "Positive Displacement Pump",
    category: "Equipment",
    description: "Rotary positive displacement pump",
    svg: `<rect x="20" y="28" width="60" height="44" rx="6" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <circle cx="42" cy="50" r="13" stroke="currentColor" stroke-width="2.5" fill="none"/>
          <circle cx="58" cy="50" r="13" stroke="currentColor" stroke-width="2.5" fill="none"/>
          <line x1="5" y1="50" x2="20" y2="50" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="80" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="50" y1="15" x2="50" y2="28" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 64,
    tags: ["positive displacement", "pump", "rotary pump", "gear pump", "PD"],
  },
  {
    id: "eq-fan-blower",
    name: "Fan / Blower",
    category: "Equipment",
    description: "Process fan or blower",
    svg: `<circle cx="50" cy="50" r="34" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M50,50 Q52,24 72,30 Q60,42 50,50" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity="0.25"/>
          <path d="M50,50 Q74,58 64,76 Q56,60 50,50" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity="0.25"/>
          <path d="M50,50 Q28,66 24,44 Q42,44 50,50" stroke="currentColor" stroke-width="2" fill="currentColor" fill-opacity="0.25"/>
          <line x1="5" y1="50" x2="16" y2="50" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="84" y1="50" x2="95" y2="50" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 64,
    tags: ["fan", "blower", "air", "ventilation"],
  },
  {
    id: "eq-ejector",
    name: "Ejector / Edictor",
    category: "Equipment",
    description: "Jet ejector / eductor",
    svg: `<line x1="5" y1="50" x2="28" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <path d="M28,32 L58,45 L58,55 L28,68 Z" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M58,45 L92,30 M58,55 L92,70" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="45" y1="12" x2="45" y2="40" stroke="currentColor" stroke-width="${SW2}"/>
          <polygon points="39,22 51,22 45,12" fill="currentColor"/>`,
    defaultSize: 64,
    tags: ["ejector", "eductor", "jet pump", "vacuum"],
  },
  {
    id: "eq-plate-heat-exchanger",
    name: "Plate Heat Exchanger",
    category: "Equipment",
    description: "Plate-and-frame heat exchanger",
    svg: `<rect x="18" y="20" width="64" height="60" rx="4" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="30" y1="20" x2="42" y2="80" stroke="currentColor" stroke-width="2"/>
          <line x1="42" y1="20" x2="54" y2="80" stroke="currentColor" stroke-width="2"/>
          <line x1="54" y1="20" x2="66" y2="80" stroke="currentColor" stroke-width="2"/>
          <line x1="5" y1="35" x2="18" y2="35" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="82" y1="65" x2="95" y2="65" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 68,
    tags: ["plate heat exchanger", "PHE", "heat exchanger"],
  },
  {
    id: "eq-bag-filter",
    name: "Bag Filter",
    category: "Equipment",
    description: "Bag filter / cartridge filter vessel",
    svg: `<rect x="24" y="16" width="52" height="70" rx="4" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M24,16 Q50,4 76,16" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <path d="M34,26 L34,78 M46,26 L46,78 M58,26 L58,78 M70,26 L70,78" stroke="currentColor" stroke-width="1.5"/>
          <line x1="5" y1="42" x2="24" y2="42" stroke="currentColor" stroke-width="${SW2}"/>
          <line x1="76" y1="60" x2="95" y2="60" stroke="currentColor" stroke-width="${SW2}"/>`,
    defaultSize: 68,
    tags: ["bag filter", "filter", "cartridge", "vessel"],
  },
];

// ── SIGNAL LINES ─────────────────────────────────────────────────────────────
const SIGNAL_LINES: ISASymbol[] = [
  {
    id: "sl-instrument",
    name: "Instrument Signal",
    category: "Signal Lines",
    description: "General instrument signal line",
    svg: `<line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="${SW}" stroke-dasharray="12,5"/>
          <polygon points="80,42 90,50 80,58" fill="currentColor"/>`,
    defaultSize: 80,
    tags: ["signal", "instrument", "line", "connection"],
  },
  {
    id: "sl-pneumatic",
    name: "Pneumatic Signal",
    category: "Signal Lines",
    description: "Pneumatic signal line",
    svg: `<line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="${SW}" stroke-dasharray="2,5"/>
          <polygon points="80,42 90,50 80,58" fill="currentColor"/>`,
    defaultSize: 80,
    tags: ["pneumatic", "signal", "line", "air"],
  },
  {
    id: "sl-electrical",
    name: "Electrical Signal",
    category: "Signal Lines",
    description: "Electrical signal line",
    svg: `<line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <polygon points="80,42 90,50 80,58" fill="currentColor"/>`,
    defaultSize: 80,
    tags: ["electrical", "signal", "line", "wired"],
  },
  {
    id: "sl-data-link",
    name: "Data / Bus Link",
    category: "Signal Lines",
    description: "Data bus or network link",
    svg: `<line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="${SW}" stroke-dasharray="15,4,2,4"/>
          <polygon points="80,42 90,50 80,58" fill="currentColor"/>`,
    defaultSize: 80,
    tags: ["data", "bus", "network", "fieldbus"],
  },
  {
    id: "sl-capillary",
    name: "Capillary / Filled System",
    category: "Signal Lines",
    description: "Capillary tube or filled system",
    svg: `<line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="${SW}" stroke-dasharray="2,3,8,3"/>
          <polygon points="80,42 90,50 80,58" fill="currentColor"/>`,
    defaultSize: 80,
    tags: ["capillary", "filled", "system", "signal"],
  },
  {
    id: "sl-hydraulic",
    name: "Hydraulic Signal",
    category: "Signal Lines",
    description: "Hydraulic signal / fluid power line",
    svg: `<line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="${SW}" stroke-dasharray="8,3,2,3"/>
          <polygon points="80,42 90,50 80,58" fill="currentColor"/>`,
    defaultSize: 80,
    tags: ["hydraulic", "signal", "line", "fluid power"],
  },
  {
    id: "sl-mechanical",
    name: "Mechanical Link",
    category: "Signal Lines",
    description: "Mechanical shaft or linkage connection",
    svg: `<line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="${SW+1}"/>
          <line x1="10" y1="36" x2="10" y2="64" stroke="currentColor" stroke-width="3"/>
          <line x1="90" y1="36" x2="90" y2="64" stroke="currentColor" stroke-width="3"/>`,
    defaultSize: 80,
    tags: ["mechanical", "link", "shaft", "coupling"],
  },
  {
    id: "sl-wireless",
    name: "Wireless Signal",
    category: "Signal Lines",
    description: "Wireless or radio signal transmission",
    svg: `<line x1="10" y1="50" x2="38" y2="50" stroke="currentColor" stroke-width="${SW}"/>
          <line x1="62" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="${SW}" stroke-dasharray="4,4"/>
          <path d="M44,34 Q50,26 56,34" stroke="currentColor" stroke-width="2" fill="none"/>
          <path d="M40,42 Q50,30 60,42" stroke="currentColor" stroke-width="2" fill="none"/>
          <circle cx="50" cy="50" r="4" fill="currentColor"/>`,
    defaultSize: 80,
    tags: ["wireless", "radio", "Wi-Fi", "signal"],
  },
  {
    id: "sl-software-link",
    name: "Software Link",
    category: "Signal Lines",
    description: "Software / internal system communication link",
    svg: `<line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="${SW}" stroke-dasharray="3,4,12,4"/>
          <circle cx="28" cy="50" r="4" fill="currentColor"/>
          <circle cx="50" cy="50" r="4" fill="currentColor"/>
          <circle cx="72" cy="50" r="4" fill="currentColor"/>`,
    defaultSize: 80,
    tags: ["software", "internal", "communication", "link", "system"],
  },
  {
    id: "sl-safety-signal",
    name: "Safety Signal",
    category: "Signal Lines",
    description: "Safety instrumented / trip signal line",
    svg: `<line x1="10" y1="50" x2="90" y2="50" stroke="currentColor" stroke-width="${SW}" stroke-dasharray="10,3,2,3,2,3"/>
          <polygon points="80,42 90,50 80,58" fill="currentColor"/>
          <path d="M42,36 L50,24 L58,36 Z" stroke="currentColor" stroke-width="2" fill="none"/>`,
    defaultSize: 80,
    tags: ["safety", "sis", "trip", "signal", "esd"],
  },
];

// ── MARKUP & REVIEW ──────────────────────────────────────────────────────────
const MARKUP: ISASymbol[] = [
  {
    id: "mk-cloud",
    name: "Revision Cloud",
    category: "Markup",
    description: "Revision / review cloud annotation",
    svg: `<path d="M15,65 Q10,55 18,47 Q14,35 26,30 Q28,18 40,18 Q50,10 60,18 Q72,14 76,26 Q88,28 87,42 Q96,48 90,58 Q94,70 82,72 Q78,82 65,78 Q58,88 45,83 Q34,88 28,78 Q16,78 15,65 Z"
              stroke="currentColor" stroke-width="${SW2}" fill="none" stroke-linejoin="round"/>`,
    defaultSize: 80,
    tags: ["revision", "cloud", "markup", "review"],
  },
  {
    id: "mk-hold",
    name: "Hold Flag",
    category: "Markup",
    description: "Hold / action required flag",
    svg: `<rect x="10" y="22" width="80" height="56" rx="6" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <text x="50" y="58" text-anchor="middle" font-size="20" font-weight="bold" fill="currentColor" font-family="sans-serif">HOLD</text>`,
    defaultSize: 64,
    tags: ["hold", "flag", "action", "review"],
  },
  {
    id: "mk-comment",
    name: "Comment Balloon",
    category: "Markup",
    description: "Comment / note balloon",
    svg: `<path d="M12,15 L88,15 Q95,15 95,22 L95,65 Q95,72 88,72 L42,72 L28,88 L28,72 L12,72 Q5,72 5,65 L5,22 Q5,15 12,15 Z"
              stroke="currentColor" stroke-width="${SW2}" fill="none"/>`,
    defaultSize: 72,
    tags: ["comment", "note", "balloon", "annotation"],
  },
  {
    id: "mk-arrow",
    name: "Action Arrow",
    category: "Markup",
    description: "Action or direction arrow",
    svg: `<line x1="10" y1="50" x2="75" y2="50" stroke="currentColor" stroke-width="${SW+1}"/>
          <polygon points="75,35 95,50 75,65" fill="currentColor" stroke="currentColor" stroke-width="2"/>`,
    defaultSize: 64,
    tags: ["arrow", "direction", "action", "pointer"],
  },
  {
    id: "mk-x-mark",
    name: "X Mark / Remove",
    category: "Markup",
    description: "Cross-out / remove marking",
    svg: `<line x1="15" y1="15" x2="85" y2="85" stroke="currentColor" stroke-width="${SW+1}"/>
          <line x1="85" y1="15" x2="15" y2="85" stroke="currentColor" stroke-width="${SW+1}"/>`,
    defaultSize: 40,
    tags: ["remove", "delete", "cross", "mark"],
  },
  {
    id: "mk-circle-mark",
    name: "Circle Callout",
    category: "Markup",
    description: "Circle callout / highlight",
    svg: `<circle cx="50" cy="50" r="42" stroke="currentColor" stroke-width="${SW+1}" fill="none"/>`,
    defaultSize: 56,
    tags: ["circle", "callout", "highlight", "mark"],
  },
  {
    id: "mk-new-item",
    name: "New Item Tag",
    category: "Markup",
    description: "New item / addition marker",
    svg: `<polygon points="50,5 61,35 95,35 68,57 79,91 50,70 21,91 32,57 5,35 39,35"
              stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <text x="50" y="56" text-anchor="middle" font-size="16" font-weight="bold" fill="currentColor" font-family="sans-serif">NEW</text>`,
    defaultSize: 56,
    tags: ["new", "add", "star", "highlight"],
  },
  {
    id: "mk-flag",
    name: "Review Flag",
    category: "Markup",
    description: "Review / attention flag",
    svg: `<line x1="20" y1="10" x2="20" y2="90" stroke="currentColor" stroke-width="${SW}"/>
          <path d="M20,10 L80,28 L20,46 Z" stroke="currentColor" stroke-width="${SW2}" fill="currentColor" fill-opacity="0.4"/>`,
    defaultSize: 48,
    tags: ["flag", "review", "attention", "mark"],
  },
  {
    id: "mk-warning",
    name: "Warning Triangle",
    category: "Markup",
    description: "Caution / warning attention triangle",
    svg: `<polygon points="50,8 95,88 5,88" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <text x="50" y="82" text-anchor="middle" font-size="42" font-weight="bold" fill="currentColor" font-family="sans-serif">!</text>`,
    defaultSize: 56,
    tags: ["warning", "caution", "triangle", "hazard"],
  },
  {
    id: "mk-label-box",
    name: "Label / Tag Box",
    category: "Markup",
    description: "Equipment tag or label box",
    svg: `<rect x="8" y="22" width="84" height="56" rx="5" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="8" y1="42" x2="92" y2="42" stroke="currentColor" stroke-width="1.5"/>
          <line x1="32" y1="22" x2="32" y2="42" stroke="currentColor" stroke-width="1.5"/>`,
    defaultSize: 72,
    tags: ["label", "tag", "box", "equipment tag"],
  },
  {
    id: "mk-number-tag",
    name: "Number Tag",
    category: "Markup",
    description: "Numbered sequence marker",
    svg: `<circle cx="50" cy="50" r="40" stroke="currentColor" stroke-width="${SW}" fill="none"/>
          <text x="50" y="62" text-anchor="middle" font-size="36" font-weight="bold" fill="currentColor" font-family="sans-serif">1</text>`,
    defaultSize: 48,
    tags: ["number", "tag", "sequence", "marker"],
  },
  {
    id: "mk-note-triangle",
    name: "Detail Reference",
    category: "Markup",
    description: "Detail / note reference triangle",
    svg: `<polygon points="50,8 92,85 8,85" stroke="currentColor" stroke-width="${SW2}" fill="none"/>
          <line x1="50" y1="86" x2="50" y2="96" stroke="currentColor" stroke-width="${SW2}"/>
          <circle cx="50" cy="96" r="3" fill="currentColor"/>`,
    defaultSize: 56,
    tags: ["detail", "reference", "note", "triangle"],
  },
];

// ── Exported categories ─────────────────────────────────────────────────────
export const ISA_CATEGORIES: ISACategory[] = [
  { id: "instrument-bubbles", label: "Instrument Bubbles", symbols: INSTRUMENT_BUBBLES },
  { id: "valves",             label: "Valves",             symbols: VALVES },
  { id: "actuators",          label: "Actuators",          symbols: ACTUATORS },
  { id: "equipment",          label: "Equipment",          symbols: EQUIPMENT },
  { id: "inline-elements",    label: "Inline Elements",    symbols: INLINE_ELEMENTS },
  { id: "signal-lines",       label: "Signal Lines",       symbols: SIGNAL_LINES },
  { id: "markup",             label: "Markup & Review",    symbols: MARKUP },
];

export const ALL_SYMBOLS: ISASymbol[] = ISA_CATEGORIES.flatMap((c) => c.symbols);

export function findSymbol(id: string): ISASymbol | undefined {
  return ALL_SYMBOLS.find((s) => s.id === id);
}
