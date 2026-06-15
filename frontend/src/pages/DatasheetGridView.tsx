import React, {
  useState, useEffect, useCallback, useRef, useMemo,
} from 'react';
import {
  Loader2, Check, ChevronDown, ChevronRight, Search, X,
  AlertCircle, RefreshCw, Columns3, Database, FileText, Activity,
  ExternalLink, Layers, Download,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import type { FormTemplate, TemplateField } from './DatasheetEditorPage';

// ─────────────────────────────────────────────────────────────────────────────
// Column definition system
// ─────────────────────────────────────────────────────────────────────────────

type ColSource = 'instrument' | 'spec_sheet' | 'process_data';

interface ColDef {
  key:      string;
  label:    string;
  group:    string;
  source:   ColSource;
  editable: boolean;
  type:     'text' | 'number' | 'select' | 'checkbox';
  options?: string[];
  saveKey?: string;
  width?:   number;
  mapped?:  boolean;   // true when a template has named this UDF slot
}

// FIX #3 helper: counts for picker not filtered but total (see ColumnPicker)
const INSTR_COLS: ColDef[] = [
  { key: 'instrument_type', label: 'Type',          group: 'Index', source: 'instrument', editable: false, type: 'text', width: 64  },
  { key: 'service',         label: 'Service',        group: 'Index', source: 'instrument', editable: false, type: 'text', width: 200 },
  { key: 'line_tag',        label: 'Line Tag',       group: 'Index', source: 'instrument', editable: false, type: 'text', width: 120 },
  { key: 'area_code',       label: 'Area Code',      group: 'Index', source: 'instrument', editable: false, type: 'text', width: 90  },
  { key: 'unit_code',       label: 'Unit Code',      group: 'Index', source: 'instrument', editable: false, type: 'text', width: 90  },
  { key: 'loop_number',     label: 'Loop No.',       group: 'Index', source: 'instrument', editable: false, type: 'text', width: 90  },
  { key: 'inst_status',     label: 'Inst. Status',   group: 'Index', source: 'instrument', editable: false, type: 'text', width: 100 },
  { key: 'active_on_pid',   label: 'Active on P&ID', group: 'Index', source: 'instrument', editable: false, type: 'text', width: 100 },
];

const SPEC_COLS: ColDef[] = [
  { key: 'ds_status',    label: 'DS Status',   group: 'Status', source: 'spec_sheet', editable: true, saveKey: 'status',
    type: 'select', options: ['Draft','For-Review','For-Approval','Approved','Issued-For-Construction'], width: 130 },
  { key: 'ds_revision',  label: 'Revision',    group: 'Status', source: 'spec_sheet', editable: false, saveKey: 'revision', type: 'text', width: 80 },
  { key: 'prepared_by',  label: 'Prepared By', group: 'Status', source: 'spec_sheet', editable: true,  type: 'text', width: 110 },
  { key: 'checked_by',   label: 'Checked By',  group: 'Status', source: 'spec_sheet', editable: true,  type: 'text', width: 110 },
  { key: 'approved_by',  label: 'Approved By', group: 'Status', source: 'spec_sheet', editable: true,  type: 'text', width: 110 },
  { key: 'service_description', label: 'Service Desc.', group: 'Identity', source: 'spec_sheet', editable: true, type: 'text', width: 200 },
  { key: 'pid_number',          label: 'P&ID No.',      group: 'Identity', source: 'spec_sheet', editable: true, type: 'text', width: 110 },
  { key: 'manufacturer',  label: 'Manufacturer',   group: 'Vendor', source: 'spec_sheet', editable: true, type: 'text', width: 150 },
  { key: 'model_number',  label: 'Model No.',      group: 'Vendor', source: 'spec_sheet', editable: true, type: 'text', width: 130 },
  { key: 'serial_number', label: 'Serial No.',     group: 'Vendor', source: 'spec_sheet', editable: true, type: 'text', width: 120 },
  { key: 'body_material',      label: 'Body Material',    group: 'Body', source: 'spec_sheet', editable: true, type: 'text', width: 150 },
  { key: 'body_size_inch',     label: 'Body Size',        group: 'Body', source: 'spec_sheet', editable: true, type: 'text', width: 90  },
  { key: 'pressure_rating',    label: 'Press. Rating',    group: 'Body', source: 'spec_sheet', editable: true, type: 'text', width: 110 },
  { key: 'process_connection', label: 'Process Conn.',    group: 'Body', source: 'spec_sheet', editable: true, type: 'text', width: 130 },
  { key: 'face_to_face_mm',    label: 'F-to-F (mm)',      group: 'Body', source: 'spec_sheet', editable: true, type: 'number', width: 90 },
  { key: 'element_type',       label: 'Element Type',     group: 'Body', source: 'spec_sheet', editable: true, type: 'text', width: 120 },
  { key: 'element_material',   label: 'Element Material', group: 'Body', source: 'spec_sheet', editable: true, type: 'text', width: 140 },
  { key: 'trim_material',      label: 'Trim Material',    group: 'Body', source: 'spec_sheet', editable: true, type: 'text', width: 130 },
  { key: 'power_supply',            label: 'Power Supply',  group: 'Electrical', source: 'spec_sheet', editable: true, type: 'text', width: 170 },
  { key: 'output_signal',           label: 'Output Signal', group: 'Electrical', source: 'spec_sheet', editable: true, type: 'text', width: 150 },
  { key: 'output_range',            label: 'Output Range',  group: 'Electrical', source: 'spec_sheet', editable: true, type: 'text', width: 110 },
  { key: 'communication_protocol',  label: 'Protocol',      group: 'Electrical', source: 'spec_sheet', editable: true, type: 'text', width: 120 },
  { key: 'enclosure_ip_rating',     label: 'IP Rating',     group: 'Electrical', source: 'spec_sheet', editable: true, type: 'text', width: 90  },
  { key: 'range_min',  label: 'Range Min',  group: 'Calibration', source: 'spec_sheet', editable: true, type: 'number', width: 90 },
  { key: 'range_max',  label: 'Range Max',  group: 'Calibration', source: 'spec_sheet', editable: true, type: 'number', width: 90 },
  { key: 'range_unit', label: 'Range Unit', group: 'Calibration', source: 'spec_sheet', editable: true, type: 'text',   width: 80 },
  { key: 'area_classification', label: 'Area Class.',  group: 'Hazardous Area', source: 'spec_sheet', editable: true, type: 'text', width: 110 },
  { key: 'gas_group',           label: 'Gas Group',    group: 'Hazardous Area', source: 'spec_sheet', editable: true, type: 'text', width: 80  },
  { key: 'temp_class',          label: 'Temp Class',   group: 'Hazardous Area', source: 'spec_sheet', editable: true, type: 'text', width: 100 },
  { key: 'protection_method',   label: 'Ex Method',    group: 'Hazardous Area', source: 'spec_sheet', editable: true, type: 'text', width: 120 },
  { key: 'certification_body',  label: 'Cert. Body',   group: 'Hazardous Area', source: 'spec_sheet', editable: true, type: 'text', width: 100 },
  { key: 'mounting_type', label: 'Mounting',    group: 'Installation', source: 'spec_sheet', editable: true, type: 'text', width: 150 },
  { key: 'orientation',   label: 'Orientation', group: 'Installation', source: 'spec_sheet', editable: true, type: 'text', width: 110 },
];

const PD_COLS: ColDef[] = [
  { key: 'pd_fluid',                label: 'Fluid',                  group: 'Fluid',      source: 'process_data', editable: false, saveKey: 'fluid',                 type: 'text',   width: 150 },
  { key: 'pd_fluid_state',          label: 'Phase',                  group: 'Fluid',      source: 'process_data', editable: false, saveKey: 'fluid_state',            type: 'text',   width: 90  },
  { key: 'pd_molecular_weight',     label: 'Mol. Weight',            group: 'Fluid',      source: 'process_data', editable: false, saveKey: 'molecular_weight',        type: 'number', width: 100 },
  { key: 'pd_specific_gravity',     label: 'SG',                     group: 'Fluid',      source: 'process_data', editable: false, saveKey: 'specific_gravity',        type: 'number', width: 70  },
  { key: 'pd_viscosity_cp',         label: 'Viscosity (cP)',         group: 'Fluid',      source: 'process_data', editable: false, saveKey: 'viscosity_cp',            type: 'number', width: 110 },
  { key: 'pd_vapour_pressure_barg', label: 'Vapour Press (barg)',    group: 'Fluid',      source: 'process_data', editable: false, saveKey: 'vapour_pressure_barg',    type: 'number', width: 130 },
  { key: 'pd_cp_cv_ratio',          label: 'Cp/Cv (k)',              group: 'Fluid',      source: 'process_data', editable: false, saveKey: 'cp_cv_ratio',             type: 'number', width: 80  },
  { key: 'pd_compressibility_factor',label: 'Z Factor',              group: 'Fluid',      source: 'process_data', editable: false, saveKey: 'compressibility_factor',  type: 'number', width: 90  },
  { key: 'pd_temp_operating_c',     label: 'Oper. Temp (°C)',        group: 'Conditions', source: 'process_data', editable: false, saveKey: 'temp_operating_c',        type: 'number', width: 120 },
  { key: 'pd_temp_design_c',        label: 'Design Temp (°C)',       group: 'Conditions', source: 'process_data', editable: false, saveKey: 'temp_design_c',           type: 'number', width: 120 },
  { key: 'pd_temp_min_c',           label: 'Min Temp (°C)',          group: 'Conditions', source: 'process_data', editable: false, saveKey: 'temp_min_c',              type: 'number', width: 110 },
  { key: 'pd_press_operating_barg', label: 'Oper. Press (barg)',     group: 'Conditions', source: 'process_data', editable: false, saveKey: 'press_operating_barg',    type: 'number', width: 130 },
  { key: 'pd_press_design_barg',    label: 'Design Press (barg)',    group: 'Conditions', source: 'process_data', editable: false, saveKey: 'press_design_barg',       type: 'number', width: 130 },
  { key: 'pd_press_min_barg',       label: 'Min Press (barg)',       group: 'Conditions', source: 'process_data', editable: false, saveKey: 'press_min_barg',          type: 'number', width: 120 },
  { key: 'pd_density_liquid_kgm3',  label: 'Liquid Density (kg/m³)', group: 'Conditions', source: 'process_data', editable: false, saveKey: 'density_liquid_kgm3',     type: 'number', width: 150 },
  { key: 'pd_density_vapour_kgm3',  label: 'Vapour Density (kg/m³)',group: 'Conditions', source: 'process_data', editable: false, saveKey: 'density_vapour_kgm3',     type: 'number', width: 155 },
  { key: 'pd_flow_normal',          label: 'Flow Normal',            group: 'Flow',       source: 'process_data', editable: false, saveKey: 'flow_normal',             type: 'number', width: 100 },
  { key: 'pd_flow_max',             label: 'Flow Max',               group: 'Flow',       source: 'process_data', editable: false, saveKey: 'flow_max',                type: 'number', width: 90  },
  { key: 'pd_flow_min',             label: 'Flow Min',               group: 'Flow',       source: 'process_data', editable: false, saveKey: 'flow_min',                type: 'number', width: 90  },
  { key: 'pd_flow_unit',            label: 'Flow Unit',              group: 'Flow',       source: 'process_data', editable: false, saveKey: 'flow_unit',               type: 'text',   width: 90  },
];

// Always builds all 100 UDF slots. Template fields override generic labels/types.
function buildUdfCols(template: FormTemplate | null): ColDef[] {
  const overrides = new Map<string, ColDef>(
    (template?.field_definitions ?? []).map((f: TemplateField) => [
      f.udf,
      { key: f.udf, label: f.label, group: f.section,
        source: 'spec_sheet', editable: true,
        type: f.type as ColDef['type'], options: f.options, width: 160,
        mapped: true },
    ])
  );
  return Array.from({ length: 100 }, (_, i) => {
    const n   = String(i + 1).padStart(2, '0');
    const key = `udf_${n}`;
    return overrides.get(key) ?? {
      key, label: `UDF ${i + 1}`, group: 'UDF',
      source: 'spec_sheet', editable: true, type: 'text' as const, width: 150,
      mapped: false,
    };
  });
}

const DEFAULT_KEYS = new Set(['instrument_type', 'service', 'line_tag', 'ds_status', 'ds_revision', 'manufacturer', 'model_number']);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface GridRow {
  id:              string;
  tag_number:      string;
  instrument_type: string;
  service:         string | null;
  ds_status:       string | null;
  ds_revision:     string | null;
  [key: string]:   unknown;
}

interface Props {
  projectId:      string;
  onOpenEditor?:  (row: GridRow) => void;
}

const API = import.meta.env.VITE_API_URL || '';
const PROCESS_CASES = ['Normal', 'Min', 'Max', 'Design', 'Start-up', 'Shutdown', 'Upset'];

// ─────────────────────────────────────────────────────────────────────────────
// Status dot on tag column
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_DOT: Record<string, string> = {
  'Draft':        'bg-gray-500',
  'For-Review':   'bg-blue-400',
  'For-Approval': 'bg-amber-400',
  'Approved':     'bg-emerald-400',
  'Issued-For-Construction': 'bg-emerald-300',
};
const RevDot: React.FC<{ status: string | null }> = ({ status }) => (
  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 shrink-0
    ${STATUS_DOT[status ?? ''] ?? 'bg-gray-800'}`} />
);

// ─────────────────────────────────────────────────────────────────────────────
// Editable cell
// ─────────────────────────────────────────────────────────────────────────────
interface CellProps {
  col:         ColDef;
  value:       string;
  isEditing:   boolean;
  isSaving:    boolean;
  isSaved:     boolean;
  stripe:      boolean;
  onStartEdit: () => void;
  onCommit:    (v: string) => void;
}

const EditableCell: React.FC<CellProps> = ({
  col, value, isEditing, isSaving, isSaved, stripe, onStartEdit, onCommit,
}) => {
  const [local, setLocal] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const selRef   = useRef<HTMLSelectElement>(null);

  useEffect(() => {
    if (isEditing) {
      setLocal(value);
      setTimeout(() => { inputRef.current?.focus(); selRef.current?.focus(); }, 0);
    }
  }, [isEditing]); // eslint-disable-line

  const commit = () => onCommit(local);
  const onKey  = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { setLocal(value); onCommit(value); }
  };

  const shared = `w-full h-full px-2.5 text-[11px] text-gray-100 bg-[#1a2035] border border-blue-400/50 outline-none`;

  if (isEditing && col.editable) {
    if (col.type === 'select' && col.options?.length) {
      return (
        <td className="p-0 border-r border-white/[0.04]" style={{ minWidth: col.width ?? 160, height: 32 }}>
          <select ref={selRef} value={local}
            onChange={e => { setLocal(e.target.value); onCommit(e.target.value); }}
            onBlur={commit} className={`${shared} appearance-none`} style={{ height: 32 }}>
            <option value="">—</option>
            {col.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        </td>
      );
    }
    return (
      <td className="p-0 border-r border-white/[0.04]" style={{ minWidth: col.width ?? 160, height: 32 }}>
        <input ref={inputRef} type={col.type === 'number' ? 'number' : 'text'}
          value={local} onChange={e => setLocal(e.target.value)}
          onBlur={commit} onKeyDown={onKey} className={shared} style={{ height: 32 }} />
      </td>
    );
  }

  const isPd = col.source === 'process_data';
  const isRo = !col.editable;
  // FIX #1: no select-none here, text remains selectable
  // FIX #2: stripe background respects read-only tint
  const bgCls = isSaved
    ? 'bg-emerald-500/[0.06]'
    : isPd
      ? (stripe ? 'bg-blue-400/[0.04]' : 'bg-blue-400/[0.025]')
      : isRo
        ? (stripe ? 'bg-white/[0.012]' : 'bg-white/[0.005]')
        : (stripe ? 'bg-white/[0.009]' : '');

  return (
    <td
      onClick={col.editable ? onStartEdit : undefined}
      className={[
        'border-r border-white/[0.04] transition-colors',
        col.editable ? 'cursor-pointer hover:bg-white/[0.04]' : 'cursor-default',
        isSaving ? 'opacity-50' : '',
        bgCls,
      ].join(' ')}
      style={{ minWidth: col.width ?? 160, height: 32, padding: '0 10px' }}
    >
      <div className="flex items-center gap-1 h-full">
        {isSaving && <Loader2 className="w-2.5 h-2.5 text-gray-600 animate-spin shrink-0" />}
        {isSaved && !isSaving && <Check className="w-2.5 h-2.5 text-emerald-500/60 shrink-0" />}
        {/* FIX #1: select-none removed → text is selectable */}
        <span className={`text-[11px] truncate ${value ? (isRo ? 'text-gray-500' : 'text-gray-200') : 'text-gray-700'}`}>
          {value || '—'}
        </span>
      </div>
    </td>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// FIX #3: Section extracted to module level — not nested inside ColumnPicker
// ─────────────────────────────────────────────────────────────────────────────
interface SectionProps {
  label:     string;
  icon:      React.ReactNode;
  cols:      ColDef[];      // filtered list (for display)
  totalLen:  number;        // FIX #4: total count (unfiltered)
  isOpen:    boolean;
  onToggle:  () => void;
  selCount:  number;
  allKeys:   string[];
  selected:  Set<string>;
  onToggleCol: (key: string) => void;
  onToggleGroup: (keys: string[], on: boolean) => void;
}

const PickerSection: React.FC<SectionProps> = ({
  label, icon, cols, totalLen, isOpen, onToggle,
  selCount, allKeys, selected, onToggleCol, onToggleGroup,
}) => {
  if (totalLen === 0) return null;
  const allOn = allKeys.every(k => selected.has(k));
  return (
    <>
      <button onClick={onToggle}
        className="w-full flex items-center gap-2 px-3 py-1.5 bg-white/[0.02]
          border-b border-white/[0.04] hover:bg-white/[0.04] transition-colors">
        {isOpen
          ? <ChevronDown  className="w-3 h-3 text-gray-600 shrink-0" />
          : <ChevronRight className="w-3 h-3 text-gray-600 shrink-0" />}
        <span className="text-gray-500 shrink-0">{icon}</span>
        <span className="text-[11px] font-semibold text-gray-300">{label}</span>
        {/* FIX #4: show total, not filtered count */}
        <span className="ml-auto text-[10px] font-mono text-gray-600">{selCount}/{totalLen}</span>
        <button onClick={e => { e.stopPropagation(); onToggleGroup(allKeys, !allOn); }}
          className="text-[10px] text-gray-600 hover:text-gray-300 ml-1 px-1.5 py-0.5
            rounded hover:bg-white/[0.06] transition-colors">
          {allOn ? 'none' : 'all'}
        </button>
      </button>
      {isOpen && cols.map(c => {
        const isUdfSlot  = c.key.startsWith('udf_');
        const isMapped   = c.mapped === true;
        const slotNum    = isUdfSlot ? c.key.replace('udf_', '#') : null;
        return (
          <button key={c.key} onClick={() => onToggleCol(c.key)}
            className={`w-full flex items-center gap-2 px-3 py-1 transition-colors
              ${isUdfSlot && !isMapped ? 'opacity-40 hover:opacity-70' : 'hover:bg-white/[0.03]'}`}>
            <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0
              ${selected.has(c.key) ? 'bg-white border-white' : 'border-white/[0.2]'}`}>
              {selected.has(c.key) && <Check className="w-2 h-2 text-black" />}
            </span>
            <span className={`text-[11px] truncate flex-1 text-left
              ${isMapped ? 'text-gray-200' : 'text-gray-500'}`}>
              {c.label}
            </span>
            {slotNum && (
              <span className="text-[9px] font-mono text-white/[0.15] shrink-0">{slotNum}</span>
            )}
            {!isUdfSlot && (
              <span className="text-[9px] text-gray-700 font-mono shrink-0 ml-1">{c.group}</span>
            )}
            {isMapped && (
              <span className="text-[9px] text-gray-600 shrink-0 ml-0.5 truncate max-w-[60px]">{c.group}</span>
            )}
            {!c.editable && <span className="text-[9px] text-white/[0.2] ml-1">RO</span>}
          </button>
        );
      })}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Column picker
// ─────────────────────────────────────────────────────────────────────────────
interface PickerProps {
  instrCols:  ColDef[];
  specCols:   ColDef[];
  udfCols:    ColDef[];
  pdCols:     ColDef[];
  hasPdCols:  boolean;   // whether any PD col is selected
  selected:   Set<string>;
  onChange:   (s: Set<string>) => void;
}

const SOURCE_ICONS = {
  instrument:   <Database className="w-3 h-3" />,
  spec_sheet:   <FileText className="w-3 h-3" />,
  udf:          <Layers   className="w-3 h-3" />,
  process_data: <Activity className="w-3 h-3" />,
};

const ColumnPicker: React.FC<PickerProps> = ({
  instrCols, specCols, udfCols, pdCols, selected, onChange,
}) => {
  const [open,   setOpen]   = useState(false);
  const [filter, setFilter] = useState('');
  const [exp,    setExp]    = useState({ instr: true, spec: true, udf: false, pd: false });
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  const toggleCol   = (key: string) => {
    const n = new Set(selected); n.has(key) ? n.delete(key) : n.add(key); onChange(n);
  };
  const toggleGroup = (keys: string[], on: boolean) => {
    const n = new Set(selected); keys.forEach(k => on ? n.add(k) : n.delete(k)); onChange(n);
  };

  const q = filter.toLowerCase();
  const match = (c: ColDef) =>
    !q || c.label.toLowerCase().includes(q) || c.key.includes(q) || c.group.toLowerCase().includes(q);

  const instrFiltered = instrCols.filter(match);
  const specFiltered  = specCols.filter(match);
  const udfFiltered   = udfCols.filter(match);
  const pdFiltered    = pdCols.filter(match);

  const selInstr = instrCols.filter(c => selected.has(c.key)).length;
  const selSpec  = specCols.filter(c => selected.has(c.key)).length;
  const selUdf   = udfCols.filter(c => selected.has(c.key)).length;
  const selPd    = pdCols.filter(c => selected.has(c.key)).length;

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-white/[0.08]
          bg-white/[0.03] text-[11px] text-gray-500 hover:text-gray-200 hover:border-white/[0.16]
          transition-colors">
        <Columns3 className="w-3 h-3" />
        Columns
        <span className="font-mono text-[10px] text-gray-700 ml-0.5">{selected.size}</span>
        <ChevronDown className="w-3 h-3 ml-0.5" />
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-50 w-72 rounded-md border border-white/[0.1]
          bg-[#0f0f14] shadow-2xl shadow-black/60 flex flex-col overflow-hidden"
          style={{ maxHeight: 480 }}>
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.06] shrink-0">
            <Search className="w-3 h-3 text-gray-700 shrink-0" />
            <input value={filter} onChange={e => setFilter(e.target.value)}
              placeholder="Search columns…"
              className="flex-1 bg-transparent text-[11px] text-gray-300 placeholder:text-gray-700 outline-none" />
            {filter && (
              <button onClick={() => setFilter('')}><X className="w-3 h-3 text-gray-700" /></button>
            )}
          </div>

          <div className="overflow-y-auto xyra-scroll-contained flex-1">
            <PickerSection
              label="Instrument" icon={SOURCE_ICONS.instrument}
              cols={instrFiltered} totalLen={instrCols.length}
              isOpen={exp.instr} onToggle={() => setExp(e => ({ ...e, instr: !e.instr }))}
              selCount={selInstr} allKeys={instrCols.map(c => c.key)}
              selected={selected} onToggleCol={toggleCol} onToggleGroup={toggleGroup}
            />
            <PickerSection
              label="Spec Sheet" icon={SOURCE_ICONS.spec_sheet}
              cols={specFiltered} totalLen={specCols.length}
              isOpen={exp.spec} onToggle={() => setExp(e => ({ ...e, spec: !e.spec }))}
              selCount={selSpec} allKeys={specCols.map(c => c.key)}
              selected={selected} onToggleCol={toggleCol} onToggleGroup={toggleGroup}
            />
            <PickerSection
              label="UDF / Template Fields" icon={SOURCE_ICONS.udf}
              cols={udfFiltered} totalLen={udfCols.length}
              isOpen={exp.udf} onToggle={() => setExp(e => ({ ...e, udf: !e.udf }))}
              selCount={selUdf} allKeys={udfCols.map(c => c.key)}
              selected={selected} onToggleCol={toggleCol} onToggleGroup={toggleGroup}
            />
            <PickerSection
              label="Process Data" icon={SOURCE_ICONS.process_data}
              cols={pdFiltered} totalLen={pdCols.length}
              isOpen={exp.pd} onToggle={() => setExp(e => ({ ...e, pd: !e.pd }))}
              selCount={selPd} allKeys={pdCols.map(c => c.key)}
              selected={selected} onToggleCol={toggleCol} onToggleGroup={toggleGroup}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main grid
// ─────────────────────────────────────────────────────────────────────────────
const DatasheetGridView: React.FC<Props> = ({ projectId, onOpenEditor }) => {
  const [rows,         setRows]         = useState<GridRow[]>([]);
  const [templates,    setTemplates]    = useState<FormTemplate[]>([]);
  const [tmplId,       setTmplId]       = useState('');
  const [itypeFilter,  setItypeFilter]  = useState('');
  // FIX #6: separate display state from debounced search value
  const [searchInput,  setSearchInput]  = useState('');
  const [search,       setSearch]       = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [procCase,     setProcCase]     = useState('Normal');
  const [selectedCols, setSelectedCols] = useState<Set<string>>(new Set(DEFAULT_KEYS));
  const [editCell,     setEditCell]     = useState<{ rowId: string; key: string } | null>(null);
  const [savingCells,  setSavingCells]  = useState<Set<string>>(new Set());
  const [savedCells,   setSavedCells]   = useState<Set<string>>(new Set());
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [bulkStatus,   setBulkStatus]   = useState('For-Review');
  const [bulkApplying, setBulkApplying] = useState(false);
  // FIX #10: track whether user manually cleared the type filter
  const userClearedType = useRef(false);

  // FIX #6: debounce search input
  const handleSearchInput = (val: string) => {
    setSearchInput(val);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 400);
  };

  // ── Load templates ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/v1/datasheet/templates`)
      .then(r => r.json())
      .then(d => {
        const list: FormTemplate[] = d.templates ?? [];
        setTemplates(list);
        if (list.length) {
          setTmplId(list[0].id);
          if (list[0].instrument_type && !userClearedType.current) {
            setItypeFilter(list[0].instrument_type);
          }
          const udfKeys = list[0].field_definitions.slice(0, 10).map((f: TemplateField) => f.udf);
          setSelectedCols(s => new Set([...s, ...udfKeys]));
        }
      })
      .catch(() => {});
  }, []);

  const selectedTemplate = useMemo(
    () => templates.find(t => t.id === tmplId) ?? null,
    [templates, tmplId],
  );
  const udfCols = useMemo(() => buildUdfCols(selectedTemplate), [selectedTemplate]);

  const allCols = useMemo<ColDef[]>(
    () => [...INSTR_COLS, ...SPEC_COLS, ...udfCols, ...PD_COLS],
    [udfCols],
  );
  const visibleCols = useMemo(
    () => allCols.filter(c => selectedCols.has(c.key)),
    [allCols, selectedCols],
  );

  // FIX #9: only show process case selector if any PD col is selected
  const hasPdColSelected = useMemo(
    () => PD_COLS.some(c => selectedCols.has(c.key)),
    [selectedCols],
  );

  const handleTmplChange = (id: string) => {
    const t = templates.find(x => x.id === id);
    setTmplId(id);
    if (t) {
      // FIX #10: only auto-set type filter if user hasn't manually cleared it
      if (t.instrument_type && !userClearedType.current) {
        setItypeFilter(t.instrument_type);
      }
      const oldUdfKeys = new Set(udfCols.map(c => c.key));
      const newUdfKeys = t.field_definitions.slice(0, 10).map((f: TemplateField) => f.udf);
      setSelectedCols(s => {
        const n = new Set([...s].filter(k => !oldUdfKeys.has(k)));
        newUdfKeys.forEach((k: string) => n.add(k));
        return n;
      });
    }
  };

  const clearTypeFilter = () => {
    // FIX #10: mark that user explicitly cleared the type filter
    userClearedType.current = true;
    setItypeFilter('');
  };

  // ── Load grid data ─────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ project_id: projectId, page_size: '500', process_case: procCase });
      if (itypeFilter) p.set('instrument_type', itypeFilter);
      if (search)      p.set('search', search);
      const r = await fetch(`${API}/api/v1/datasheet/grid?${p}`);
      if (!r.ok) throw new Error(`Server ${r.status}`);
      const d = await r.json();
      setRows(d.data ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [projectId, itypeFilter, search, procCase]);

  useEffect(() => { load(); }, [load]);

  // ── Save cell ──────────────────────────────────────────────────────────────
  const saveCell = useCallback(async (rowId: string, col: ColDef, value: string) => {
    if (!col.editable) return;
    const cellKey = `${rowId}:${col.key}`;
    const row = rows.find(r => r.id === rowId);
    if (!row) return;

    setRows(rs => rs.map(r => r.id === rowId ? { ...r, [col.key]: value || null } : r));
    setSavingCells(s => new Set([...s, cellKey]));
    try {
      const dbKey = col.saveKey ?? col.key;
      if (col.source === 'spec_sheet') {
        await fetch(`${API}/api/v1/datasheet/instruments/${rowId}/spec-sheet`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId,
            revision:   (row.ds_revision as string) ?? 'Rev 0',
            data:       { [dbKey]: value || null },
            user_id:    'local-user',
          }),
        });
        if (!row.ds_revision) {
          setRows(rs => rs.map(r =>
            r.id === rowId ? { ...r, ds_revision: 'Rev 0', ds_status: 'Draft' } : r));
        }
      } else if (col.source === 'process_data') {
        await fetch(`${API}/api/v1/datasheet/instruments/${rowId}/process-data`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            project_id: projectId, case_name: procCase,
            data: { [dbKey]: value || null }, user_id: 'local-user',
          }),
        });
      }
      setSavedCells(s => new Set([...s, cellKey]));
      setTimeout(() => setSavedCells(s => { const n = new Set(s); n.delete(cellKey); return n; }), 1500);
    } catch {
      setRows(rs => rs.map(r => r.id === rowId ? { ...r, [col.key]: row[col.key] } : r));
    } finally {
      setSavingCells(s => { const n = new Set(s); n.delete(cellKey); return n; });
    }
  }, [projectId, rows, procCase]);

  const applyBulkStatus = async () => {
    if (!selectedRows.size || !bulkStatus) return;
    setBulkApplying(true);
    const dsStatusCol = SPEC_COLS.find(c => c.key === 'ds_status')!;
    const targets = rows.filter(r => selectedRows.has(r.id));
    await Promise.allSettled(targets.map(row => saveCell(row.id, dsStatusCol, bulkStatus)));
    setSelectedRows(new Set());
    setBulkApplying(false);
  };

  const exportToExcel = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Instrument Index');
    ws.columns = [
      { header: 'Tag Number',   key: 'tag_number',      width: 20 },
      { header: 'Type',         key: 'instrument_type', width: 10 },
      { header: 'Service',      key: 'service',         width: 32 },
      { header: 'Line Tag',     key: 'line_tag',        width: 18 },
      { header: 'IO Type',      key: 'io_type',         width: 12 },
      { header: 'Loop No.',     key: 'loop_number',     width: 12 },
      { header: 'Area Code',    key: 'area_code',       width: 12 },
      { header: 'DS Status',    key: 'ds_status',       width: 22 },
      { header: 'Revision',     key: 'ds_revision',     width: 10 },
      { header: 'Prepared By',  key: 'ds_prepared_by',  width: 16 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A1A2E' } };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    rows.forEach(row => ws.addRow(row));
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Instrument_Index_${projectId ?? 'export'}_${new Date().toISOString().slice(0,10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditCell(null); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Source spans for header row 1
  const sourceSpans = useMemo(() => {
    const out: { source: ColSource; count: number }[] = [];
    for (const c of visibleCols) {
      if (!out.length || out[out.length - 1].source !== c.source) {
        out.push({ source: c.source, count: 1 });
      } else { out[out.length - 1].count++; }
    }
    return out;
  }, [visibleCols]);

  const sourceLabel: Record<ColSource, string> = {
    instrument: 'Instrument', spec_sheet: 'Spec Sheet', process_data: 'Process Data',
  };

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#09090c] text-gray-200">

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 relative flex items-center gap-2 border-b border-white/[0.06]
        bg-[#0d0d11] px-4 py-2 flex-wrap">

        {/* FIX #7: loading bar during refresh when rows already exist */}
        {loading && rows.length > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-px bg-blue-400/20 overflow-hidden">
            <div className="h-full w-1/3 bg-blue-400/50 animate-[loading-bar_1.2s_ease-in-out_infinite]" />
          </div>
        )}

        <select value={tmplId} onChange={e => handleTmplChange(e.target.value)}
          className="h-7 rounded-md border border-white/[0.08] bg-black px-2 text-[11px]
            text-gray-300 outline-none focus:border-white/[0.2] min-w-[190px]">
          <option value="">— Template (UDF columns) —</option>
          {templates.map(t => <option key={t.id} value={t.id}>{t.template_name}</option>)}
        </select>

        <div className="w-px h-4 bg-white/[0.08]" />

        {/* Type filter */}
        <div className="flex items-center gap-1.5 h-7 rounded-md border border-white/[0.08] bg-black px-2.5">
          <span className="text-[10px] text-gray-700 uppercase tracking-[0.1em] shrink-0">Type</span>
          <input value={itypeFilter}
            onChange={e => { userClearedType.current = !e.target.value; setItypeFilter(e.target.value.toUpperCase()); }}
            placeholder="PT…"
            className="bg-transparent text-[11px] text-gray-300 placeholder:text-gray-700 outline-none w-12 font-mono" />
          {itypeFilter && (
            <button onClick={clearTypeFilter}>
              <X className="w-3 h-3 text-gray-700 hover:text-gray-400" />
            </button>
          )}
        </div>

        {/* FIX #6: debounced search */}
        <div className="flex items-center gap-1.5 h-7 rounded-md border border-white/[0.08] bg-black px-2.5">
          <Search className="w-3 h-3 text-gray-700 shrink-0" />
          <input value={searchInput}
            onChange={e => handleSearchInput(e.target.value)}
            placeholder="Tag or service…"
            className="bg-transparent text-[11px] text-gray-300 placeholder:text-gray-700 outline-none w-28" />
          {searchInput && (
            <button onClick={() => { setSearchInput(''); setSearch(''); }}>
              <X className="w-3 h-3 text-gray-700 hover:text-gray-400" />
            </button>
          )}
        </div>

        {/* FIX #9: process case selector only when PD columns are shown */}
        {hasPdColSelected && (
          <div className="flex items-center gap-1.5 h-7 rounded-md border border-white/[0.08] bg-black px-2.5">
            <Activity className="w-3 h-3 text-gray-700 shrink-0" />
            <select value={procCase} onChange={e => setProcCase(e.target.value)}
              className="bg-transparent text-[11px] text-gray-400 outline-none">
              {PROCESS_CASES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
        )}

        <button onClick={load}
          className="h-7 w-7 flex items-center justify-center rounded-md border border-white/[0.08]
            bg-white/[0.03] text-gray-600 hover:text-gray-300 transition-colors">
          {loading && rows.length > 0
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <RefreshCw className="w-3 h-3" />}
        </button>

        <button
          onClick={() => void exportToExcel()}
          disabled={!rows.length}
          title="Export instrument index to Excel"
          className="h-7 flex items-center gap-1.5 rounded-md border border-white/[0.08]
            bg-white/[0.03] px-2.5 text-[11px] text-gray-500 hover:text-gray-200
            disabled:opacity-30 transition-colors">
          <Download className="w-3 h-3" />
          Export
        </button>

        <div className="ml-auto">
          <ColumnPicker
            instrCols={INSTR_COLS} specCols={SPEC_COLS}
            udfCols={udfCols} pdCols={PD_COLS}
            hasPdCols={hasPdColSelected}
            selected={selectedCols} onChange={setSelectedCols}
          />
        </div>
      </div>

      {/* Bulk action toolbar */}
      {selectedRows.size > 0 && (
        <div className="shrink-0 flex items-center gap-3 border-b border-amber-400/15
          bg-amber-400/[0.06] px-4 py-1.5">
          <span className="text-[11px] font-semibold text-amber-200">
            {selectedRows.size} row{selectedRows.size === 1 ? '' : 's'} selected
          </span>
          <div className="w-px h-4 bg-white/[0.08]" />
          <span className="text-[11px] text-gray-500">Set status:</span>
          <select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)}
            className="h-6 rounded border border-white/[0.08] bg-black px-1.5
              text-[11px] text-gray-300 outline-none focus:border-white/[0.2]">
            {['Draft','For-Review','For-Approval','Approved','Issued-For-Construction'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button
            onClick={() => void applyBulkStatus()}
            disabled={bulkApplying}
            className="h-6 flex items-center gap-1 rounded bg-amber-400/20 border
              border-amber-400/30 px-2.5 text-[11px] font-semibold text-amber-200
              hover:bg-amber-400/30 disabled:opacity-50">
            {bulkApplying ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            Apply
          </button>
          <button
            onClick={() => setSelectedRows(new Set())}
            className="h-6 flex items-center gap-1 rounded border border-white/[0.08]
              px-2 text-[11px] text-gray-500 hover:text-gray-300">
            <X className="w-3 h-3" />
            Clear
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="shrink-0 flex items-center gap-2 text-red-300 bg-red-500/10
          border-b border-red-400/20 px-4 py-2 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
        </div>
      )}

      {/* Legend */}
      <div className="shrink-0 flex items-center gap-4 border-b border-white/[0.04] px-4 py-1">
        {([
          ['Instrument', 'bg-white/[0.02]'],
          ['Spec Sheet (click to edit)', 'bg-white/[0.05]'],
          ['Process Data (read-only)', 'bg-blue-400/[0.06]'],
        ] as const).map(([lbl, cls]) => (
          <div key={lbl} className="flex items-center gap-1.5">
            <span className={`w-3 h-3 rounded-sm ${cls}`} />
            <span className="text-[10px] text-gray-700">{lbl}</span>
          </div>
        ))}
        {onOpenEditor && (
          <span className="text-[10px] text-gray-700 ml-2">
            · Click <ExternalLink className="w-2.5 h-2.5 inline mx-0.5" /> on tag to open full editor
          </span>
        )}
      </div>

      {/* ── Grid ────────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto xyra-scroll-contained">
        {loading && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-20 text-[11px] text-gray-600">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading grid…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-xs text-gray-600">
            {projectId ? 'No instruments found.' : 'Select a project above.'}
          </div>
        ) : (
          // FIX #1: select-none removed from table
          <table className="border-collapse text-xs"
            style={{ minWidth: 32 + 140 + visibleCols.reduce((s, c) => s + (c.width ?? 160), 0) }}>
            <thead>
              {/* Row 1: source group bands */}
              <tr>
                <th className="sticky left-0 z-30 bg-[#0b0b10] border-b border-white/[0.08]"
                  style={{ width: 32, minWidth: 32 }}>
                  <input
                    type="checkbox"
                    title="Select all"
                    checked={rows.length > 0 && selectedRows.size === rows.length}
                    onChange={e => setSelectedRows(e.target.checked ? new Set(rows.map(r => r.id)) : new Set())}
                    className="mx-auto block accent-amber-400 cursor-pointer"
                  />
                </th>
                <th className="sticky left-8 z-30 bg-[#0b0b10] border-b border-r-2 border-white/[0.08]"
                  style={{ minWidth: 140 }} />
                {sourceSpans.map((sp, i) => {
                  const isPd = sp.source === 'process_data';
                  return (
                    <th key={i} colSpan={sp.count}
                      className={`border-b border-r border-white/[0.04] px-2.5 py-1 text-left
                        sticky top-0 z-20 ${isPd ? 'bg-[#0d0d16]' : 'bg-[#0b0b10]'}`}>
                      <span className="text-[9px] font-semibold uppercase tracking-[0.14em]
                        text-gray-700 flex items-center gap-1.5">
                        <span className="text-gray-600">{SOURCE_ICONS[sp.source]}</span>
                        {sourceLabel[sp.source]}
                      </span>
                    </th>
                  );
                })}
              </tr>

              {/* Row 2: column labels */}
              {/* FIX #5: removed broken colSpans sub-label logic; headers are clean single-line */}
              <tr>
                <th className="sticky left-0 z-30 bg-[#0d0d11] border-b border-white/[0.08]"
                  style={{ top: 26, width: 32, minWidth: 32 }} />
                <th className="sticky left-8 z-30 bg-[#0d0d11] border-b border-r-2
                  border-white/[0.08] px-3 py-2 text-left whitespace-nowrap"
                  style={{ top: 26, minWidth: 140 }}>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-600">
                    Tag Number
                  </span>
                </th>
                {visibleCols.map(c => {
                  const isPd = c.source === 'process_data';
                  return (
                    <th key={c.key}
                      className={`border-b border-r border-white/[0.06] px-2.5 py-2 text-left
                        sticky z-20 whitespace-nowrap
                        ${isPd ? 'bg-[#0d0d16]' : 'bg-[#0d0d11]'}`}
                      style={{ top: 26, minWidth: c.width ?? 160 }}>
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-medium text-gray-400 truncate">
                          {c.label}
                        </span>
                        {c.key.startsWith('udf_') && (
                          <span className="text-[9px] font-mono text-white/[0.1] shrink-0">
                            #{c.key.replace(/^udf_0?/, '')}
                          </span>
                        )}
                        {!c.editable && (
                          <span className="text-[9px] text-white/[0.15] ml-auto shrink-0">RO</span>
                        )}
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>

            <tbody>
              {rows.map((row, ri) => {
                const stripe = ri % 2 === 1;
                const tagBg  = stripe ? 'bg-[#0c0c10]' : 'bg-[#09090c]';  // FIX #2
                return (
                  <tr key={row.id}
                    className={`group border-b border-white/[0.03] ${stripe ? 'bg-white/[0.006]' : ''}`}>

                    {/* Checkbox cell */}
                    <td className={`sticky left-0 z-10 border-white/[0.04] ${tagBg}`}
                      style={{ width: 32, minWidth: 32, height: 32 }}>
                      <div className="flex items-center justify-center h-full">
                        <input
                          type="checkbox"
                          checked={selectedRows.has(row.id)}
                          onChange={e => setSelectedRows(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(row.id); else next.delete(row.id);
                            return next;
                          })}
                          className="accent-amber-400 cursor-pointer"
                        />
                      </div>
                    </td>

                    {/* FIX #2: sticky tag cell matches alternating stripe */}
                    {/* FIX #8: clicking ExternalLink icon opens full editor */}
                    <td className={`sticky left-8 z-10 border-r-2 border-white/[0.08] px-2 py-0 ${tagBg}`}
                      style={{ height: 32, minWidth: 140 }}>
                      <div className="flex items-center h-full gap-1">
                        <RevDot status={row.ds_status as string | null} />
                        <span className="font-mono text-[11px] font-semibold text-white truncate flex-1">
                          {row.tag_number}
                        </span>
                        {onOpenEditor && (
                          <button
                            onClick={() => onOpenEditor(row)}
                            title="Open full spec sheet editor"
                            className="shrink-0 opacity-0 group-hover:opacity-100 text-gray-700
                              hover:text-gray-400 transition-all ml-1">
                            <ExternalLink className="w-2.5 h-2.5" />
                          </button>
                        )}
                      </div>
                    </td>

                    {visibleCols.map(col => {
                      const cellKey = `${row.id}:${col.key}`;
                      const raw = row[col.key];
                      const val = raw == null ? '' : String(raw);
                      return (
                        <EditableCell
                          key={col.key}
                          col={col}
                          value={val}
                          stripe={stripe}
                          isEditing={editCell?.rowId === row.id && editCell?.key === col.key}
                          isSaving={savingCells.has(cellKey)}
                          isSaved={savedCells.has(cellKey)}
                          onStartEdit={() => col.editable && setEditCell({ rowId: row.id, key: col.key })}
                          onCommit={v => {
                            setEditCell(null);
                            if (v !== val) saveCell(row.id, col, v);
                          }}
                        />
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 flex items-center justify-between border-t border-white/[0.04] px-4 py-1.5">
        <span className="text-[10px] text-gray-700">
          {rows.length} rows
          {itypeFilter ? ` · type = ${itypeFilter}` : ''}
          {` · ${visibleCols.length} columns`}
          {hasPdColSelected ? ` · case: ${procCase}` : ''}
        </span>
        <span className="text-[10px] text-gray-700">
          Editable cells: click to edit, Enter/Tab to confirm, Esc to cancel
        </span>
      </div>
    </div>
  );
};

export default DatasheetGridView;
