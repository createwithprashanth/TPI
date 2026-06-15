import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft, FileText, Save, Loader2,
  CheckCircle2, Plus, Trash2, Calculator, Thermometer,
  Gauge, Waves, Shield, Wrench, Settings2, Printer,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface InstrumentRow {
  id:              string;
  tag_number:      string;
  instrument_type: string;
  service:         string | null;
  line_tag:        string | null;
  area_code:       string | null;
  pid_number?:     string | null;
  ds_status:       string | null;
  ds_revision:     string | null;
}

interface ProcessCase {
  id:                   string;
  case_name:            string;
  fluid:                string | null;
  fluid_state:          string | null;
  temp_operating_c:     number | null;
  temp_design_c:        number | null;
  press_operating_barg: number | null;
  press_design_barg:    number | null;
  flow_normal:          number | null;
  flow_max:             number | null;
  flow_min:             number | null;
  flow_unit:            string | null;
  density_liquid_kgm3:  number | null;
  viscosity_cp:         number | null;
  molecular_weight:     number | null;
}

interface SpecSheet {
  id:                   string;
  revision:             string;
  status:               string;
  prepared_by:          string | null;
  checked_by:           string | null;
  approved_by:          string | null;
  revision_date:        string | null;
  revision_description: string | null;
  [key: string]: unknown; // udf_01..udf_100
}

export interface TemplateField {
  udf:          string;   // "udf_01"
  label:        string;
  section:      string;
  type:         'text' | 'number' | 'select' | 'textarea' | 'checkbox';
  options?:     string[];
  placeholder?: string;
  required?:    boolean;
}

export interface FormTemplate {
  id:                string;
  template_name:     string;
  instrument_type:   string | null;
  field_definitions: TemplateField[];
}

interface Calculation {
  id:                string;
  calc_type:         string;
  case_name:         string;
  result_value:      number | null;
  result_unit:       string | null;
  result_label:      string | null;
  selected_value:    number | null;
  sizing_margin_pct: number | null;
  calc_status:       string;
  revision:          string;
}

interface Props {
  instrument:        InstrumentRow;
  projectId:         string;
  onBack:            () => void;
  onManageTemplates: () => void;
}

const API = import.meta.env.VITE_API_URL || '';

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------
const inputCls  = 'h-8 w-full rounded-md border border-white/[0.08] bg-black px-2.5 text-xs text-gray-200 placeholder:text-gray-700 outline-none focus:border-white/[0.18] transition-colors';
const selectCls = 'h-8 w-full rounded-md border border-white/[0.08] bg-black px-2.5 text-xs text-gray-200 outline-none focus:border-white/[0.18] transition-colors';
const labelCls  = 'text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-600 mb-1 block';

const SField: React.FC<{
  label:        string;
  value:        string | number | null | undefined;
  onChange:     (v: string) => void;
  type?:        string;
  placeholder?: string;
  options?:     string[];
}> = ({ label, value, onChange, type = 'text', placeholder, options }) => (
  <div>
    <label className={labelCls}>{label}</label>
    {options ? (
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} className={selectCls}>
        <option value="">—</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    ) : (
      <input
        type={type} value={value ?? ''} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} className={inputCls}
      />
    )}
  </div>
);

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
const TABS = [
  { id: 'process',  label: 'Process Data',  icon: Thermometer },
  { id: 'spec',     label: 'Specification', icon: Wrench },
  { id: 'approval', label: 'Approval',      icon: Shield },
  { id: 'calcs',    label: 'Calculations',  icon: Calculator },
];

// ---------------------------------------------------------------------------
// Process Data tab
// ---------------------------------------------------------------------------
const EMPTY_CASE = (): Partial<ProcessCase> => ({
  case_name: 'Normal', fluid: '', fluid_state: 'Liquid',
  temp_operating_c: null, temp_design_c: null,
  press_operating_barg: null, press_design_barg: null,
  flow_normal: null, flow_max: null, flow_min: null, flow_unit: 'm3/h',
  density_liquid_kgm3: null, viscosity_cp: null, molecular_weight: null,
});

const ProcessTab: React.FC<{ instrumentId: string; projectId: string }> = ({ instrumentId, projectId }) => {
  const [cases,  setCases]  = useState<ProcessCase[]>([]);
  const [active, setActive] = useState(0);
  const [form,   setForm]   = useState<Partial<ProcessCase>>(EMPTY_CASE());
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [error,  setError]  = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`${API}/api/v1/datasheet/instruments/${instrumentId}/process-data`);
    if (!r.ok) return;
    const d = await r.json();
    setCases(d.cases ?? []);
    if (d.cases?.length) setForm(d.cases[0]);
  }, [instrumentId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (cases[active]) setForm(cases[active]);
    else setForm(EMPTY_CASE());
  }, [active, cases]);

  const save = async () => {
    setSaving(true); setSaved(false); setError(null);
    try {
      const r = await fetch(`${API}/api/v1/datasheet/instruments/${instrumentId}/process-data`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, case_name: form.case_name ?? 'Normal', data: form }),
      });
      if (!r.ok) throw new Error(`Server ${r.status}`);
      setSaved(true); setTimeout(() => setSaved(false), 2000); load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const del = async (caseName: string) => {
    await fetch(
      `${API}/api/v1/datasheet/instruments/${instrumentId}/process-data/${encodeURIComponent(caseName)}`,
      { method: 'DELETE' }
    );
    load(); setActive(0);
  };

  const addCase = () => {
    const names = ['Normal', 'Min', 'Max', 'Design', 'Upset'];
    const existing = new Set(cases.map(c => c.case_name));
    const next = names.find(n => !existing.has(n)) ?? `Case ${cases.length + 1}`;
    setForm({ ...EMPTY_CASE(), case_name: next });
    setActive(cases.length);
  };

  const set = (k: string, v: string) =>
    setForm(f => ({ ...f, [k]: v === '' ? null : (isNaN(Number(v)) ? v : Number(v)) }));

  const PROCESS_SECTIONS = [
    { label: 'Fluid', cols: 2, fields: [
      { k: 'fluid',       label: 'Fluid',        type: 'text',   ph: 'e.g. Natural Gas' },
      { k: 'fluid_state', label: 'Phase / State', type: 'select', opts: ['Gas','Liquid','Two-phase','Steam','Vapour'] },
    ]},
    { label: 'Temperature', cols: 3, fields: [
      { k: 'temp_operating_c', label: 'Operating (°C)', type: 'number', ph: '45' },
      { k: 'temp_design_c',    label: 'Design (°C)',    type: 'number', ph: '60' },
    ]},
    { label: 'Pressure', cols: 3, fields: [
      { k: 'press_operating_barg', label: 'Operating (barg)', type: 'number', ph: '68.5' },
      { k: 'press_design_barg',    label: 'Design (barg)',    type: 'number', ph: '80' },
    ]},
    { label: 'Flow', cols: 4, fields: [
      { k: 'flow_normal', label: 'Normal', type: 'number' },
      { k: 'flow_min',    label: 'Min',    type: 'number' },
      { k: 'flow_max',    label: 'Max',    type: 'number' },
      { k: 'flow_unit',   label: 'Unit',   type: 'select', opts: ['m3/h','Sm3/h','MMSCFD','kg/h','t/h','l/min','US gpm'] },
    ]},
    { label: 'Physical Properties', cols: 3, fields: [
      { k: 'density_liquid_kgm3', label: 'Liquid density (kg/m³)', type: 'number', ph: '850' },
      { k: 'viscosity_cp',        label: 'Viscosity (cP)',         type: 'number', ph: '2.5' },
      { k: 'molecular_weight',    label: 'Molecular weight',       type: 'number', ph: '28.8' },
    ]},
  ] as const;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {cases.map((c, i) => (
          <button key={c.case_name} onClick={() => setActive(i)}
            className={`flex items-center gap-1.5 h-7 px-3 rounded-md text-xs font-medium transition-colors ${
              active === i ? 'bg-white text-black' : 'bg-white/[0.04] text-gray-400 hover:text-gray-200 border border-white/[0.06]'
            }`}>
            {c.case_name}
            {active === i && cases.length > 1 && (
              <button onClick={e => { e.stopPropagation(); del(c.case_name); }}
                className="ml-1 text-gray-500 hover:text-red-400 transition-colors">
                <Trash2 className="w-2.5 h-2.5" />
              </button>
            )}
          </button>
        ))}
        <button onClick={addCase}
          className="flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] text-gray-600 border border-dashed border-white/[0.08] hover:border-white/[0.2] hover:text-gray-300 transition-colors">
          <Plus className="w-3 h-3" /> Add case
        </button>
      </div>

      <div className="w-40">
        <SField label="Case name" value={form.case_name} onChange={v => setForm(f => ({ ...f, case_name: v }))} placeholder="Normal" />
      </div>

      {PROCESS_SECTIONS.map(section => (
        <div key={section.label} className="rounded-md border border-white/[0.06] overflow-hidden">
          <div className="bg-white/[0.02] border-b border-white/[0.06] px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-600">{section.label}</span>
          </div>
          <div className={`p-4 grid grid-cols-${section.cols} gap-3`}>
            {(section.fields as readonly { k: string; label: string; type: string; ph?: string; opts?: readonly string[] }[]).map(f => (
              <SField key={f.k} label={f.label}
                value={(form as Record<string, unknown>)[f.k] as string}
                onChange={v => set(f.k, v)} type={f.type}
                placeholder={f.ph} options={f.opts as string[] | undefined} />
            ))}
          </div>
        </div>
      ))}

      <div className="flex items-center gap-3 pt-1">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 h-8 px-5 rounded-md bg-white text-black text-xs font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40">
          {saving  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
           : saved ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Saved</>
           :         <><Save className="w-3.5 h-3.5" /> Save Process Data</>}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Dynamic field renderer — header label + UDF watermark inside the box
// ---------------------------------------------------------------------------
const DynamicField: React.FC<{
  field:    TemplateField;
  value:    string;
  onChange: (v: string) => void;
}> = ({ field, value, onChange }) => {
  const udfNum = field.udf.replace('udf_0', '').replace('udf_', ''); // "01"→"1", "42"→"42"
  const headerLabel = (
    <label className="text-[11px] font-medium text-gray-300 mb-1.5 block leading-none">
      {field.label}
    </label>
  );
  // Transparent UDF number overlaid inside the input, right side
  const watermark = (
    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-mono text-white/[0.07] pointer-events-none select-none">
      {udfNum}
    </span>
  );

  if (field.type === 'select') {
    return (
      <div>
        {headerLabel}
        <div className="relative">
          <select value={value} onChange={e => onChange(e.target.value)}
            className="h-9 w-full rounded-md border border-white/[0.08] bg-[#0d0d11] pl-3 pr-8 text-xs text-gray-200 outline-none focus:border-white/[0.18] transition-colors appearance-none">
            <option value="">—</option>
            {(field.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          {/* native chevron */}
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 text-[10px]">▾</span>
          {/* udf watermark left of chevron */}
          <span className="absolute right-7 top-1/2 -translate-y-1/2 text-[11px] font-mono text-white/[0.07] pointer-events-none select-none">
            {udfNum}
          </span>
        </div>
      </div>
    );
  }

  if (field.type === 'textarea') {
    return (
      <div className="col-span-3">
        {headerLabel}
        <div className="relative">
          <textarea
            value={value} onChange={e => onChange(e.target.value)}
            placeholder={field.placeholder} rows={3}
            className="w-full rounded-md border border-white/[0.08] bg-[#0d0d11] px-3 pr-10 py-2 text-xs text-gray-200 placeholder:text-gray-700 outline-none focus:border-white/[0.18] transition-colors resize-none"
          />
          <span className="absolute right-2.5 top-2.5 text-[11px] font-mono text-white/[0.07] pointer-events-none select-none">
            {udfNum}
          </span>
        </div>
      </div>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <div className="flex items-center gap-2 mt-5">
        <input type="checkbox" checked={value === 'true'}
          onChange={e => onChange(e.target.checked ? 'true' : 'false')}
          className="h-3.5 w-3.5 accent-white rounded" />
        <label className="text-[11px] text-gray-300">{field.label}</label>
        <span className="text-[10px] font-mono text-white/[0.07] ml-auto">{udfNum}</span>
      </div>
    );
  }

  // text / number
  return (
    <div>
      {headerLabel}
      <div className="relative">
        <input
          type={field.type === 'number' ? 'number' : 'text'}
          value={value} onChange={e => onChange(e.target.value)}
          placeholder={field.placeholder}
          className="h-9 w-full rounded-md border border-white/[0.08] bg-[#0d0d11] pl-3 pr-10 text-xs text-gray-200 placeholder:text-gray-700 outline-none focus:border-white/[0.18] transition-colors"
        />
        {watermark}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// UDF Spec Sheet tab — fully dynamic, driven by spec_form_templates
// ---------------------------------------------------------------------------
const UDFSpecTab: React.FC<{
  instrumentId:      string;
  projectId:         string;
  instrument:        InstrumentRow;
  onManageTemplates: () => void;
}> = ({ instrumentId, projectId, instrument, onManageTemplates }) => {
  const [template,        setTemplate]        = useState<FormTemplate | null>(null);
  const [allTemplates,    setAllTemplates]     = useState<FormTemplate[]>([]);
  const [templateLoading, setTemplateLoading] = useState(true);
  const [sheets,          setSheets]          = useState<SpecSheet[]>([]);
  const [activeRev,       setActiveRev]       = useState(0);
  const [form,            setForm]            = useState<Record<string, string>>({});
  const [revision,        setRevision]        = useState('Rev 0');
  const [saving,          setSaving]          = useState(false);
  const [saved,           setSaved]           = useState(false);
  const [error,           setError]           = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setTemplateLoading(true);
    try {
      const [r1, r2] = await Promise.all([
        fetch(`${API}/api/v1/datasheet/templates?instrument_type=${instrument.instrument_type}`),
        fetch(`${API}/api/v1/datasheet/templates`),
      ]);
      const matched: FormTemplate[] = (await r1.json()).templates ?? [];
      const all: FormTemplate[]     = (await r2.json()).templates ?? [];
      setAllTemplates(all);
      setTemplate(matched[0] ?? null);
    } finally {
      setTemplateLoading(false);
    }
  }, [instrument.instrument_type]);

  const loadSheets = useCallback(async () => {
    const r = await fetch(`${API}/api/v1/datasheet/instruments/${instrumentId}/spec-sheets`);
    if (!r.ok) return;
    const d = await r.json();
    const ss: SpecSheet[] = d.spec_sheets ?? [];
    setSheets(ss);
    if (ss[0]) {
      const udfs: Record<string, string> = {};
      for (let i = 1; i <= 100; i++) {
        const key = `udf_${String(i).padStart(2, '0')}`;
        if (ss[0][key] != null) udfs[key] = String(ss[0][key]);
      }
      setForm(udfs);
      setRevision(ss[0].revision);
    }
  }, [instrumentId]);

  useEffect(() => { loadTemplates(); loadSheets(); }, [loadTemplates, loadSheets]);

  useEffect(() => {
    const ss = sheets[activeRev];
    if (!ss) return;
    const udfs: Record<string, string> = {};
    for (let i = 1; i <= 100; i++) {
      const key = `udf_${String(i).padStart(2, '0')}`;
      if (ss[key] != null) udfs[key] = String(ss[key]);
    }
    setForm(udfs);
    setRevision(ss.revision);
  }, [activeRev, sheets]);

  const save = async () => {
    setSaving(true); setSaved(false); setError(null);
    try {
      const r = await fetch(`${API}/api/v1/datasheet/instruments/${instrumentId}/spec-sheet`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, revision, data: form }),
      });
      if (!r.ok) throw new Error(`Server ${r.status}`);
      setSaved(true); setTimeout(() => setSaved(false), 2000); loadSheets();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const sections = useMemo(() => {
    const groups: Record<string, TemplateField[]> = {};
    for (const f of template?.field_definitions ?? []) {
      const s = f.section || 'General';
      if (!groups[s]) groups[s] = [];
      groups[s].push(f);
    }
    return groups;
  }, [template]);

  const revisions = ['Rev 0', 'Rev 1', 'Rev 2', 'Rev 3', 'Rev A', 'Rev B', 'Rev C'];

  if (templateLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-[11px] text-gray-600">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading template…
      </div>
    );
  }

  if (!template) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <Wrench className="w-8 h-8 text-gray-700" />
        <div>
          <p className="text-sm font-medium text-white mb-1">
            No template for <span className="font-mono">{instrument.instrument_type}</span>
          </p>
          <p className="text-[11px] text-gray-600 max-w-xs">
            Create a spec sheet template to define which UDF fields appear for this instrument type.
          </p>
        </div>
        {allTemplates.length > 0 && (
          <div className="flex flex-col gap-1.5 w-64">
            <p className="text-[10px] text-gray-600 uppercase tracking-[0.12em] font-semibold">
              Or pick an existing template
            </p>
            {allTemplates.map(t => (
              <button key={t.id} onClick={() => setTemplate(t)}
                className="h-8 px-3 rounded-md border border-white/[0.06] bg-white/[0.02] text-xs text-gray-300 hover:text-white hover:border-white/[0.14] transition-colors text-left">
                {t.template_name}
              </button>
            ))}
          </div>
        )}
        <button onClick={onManageTemplates}
          className="flex items-center gap-2 h-8 px-4 rounded-md bg-white text-black text-xs font-semibold hover:bg-gray-200 transition-colors">
          <Plus className="w-3.5 h-3.5" /> Create Template
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Template switcher + revision tabs */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-gray-700">Template:</span>
          <select
            value={template.id}
            onChange={e => { const t = allTemplates.find(x => x.id === e.target.value); if (t) setTemplate(t); }}
            className="h-7 rounded-md border border-white/[0.06] bg-black px-2 text-[11px] text-gray-300 outline-none focus:border-white/[0.14]"
          >
            {allTemplates.map(t => <option key={t.id} value={t.id}>{t.template_name}</option>)}
          </select>
        </div>
        <button onClick={onManageTemplates}
          className="flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] text-gray-600 border border-white/[0.06] hover:text-gray-300 hover:border-white/[0.12] transition-colors">
          <Settings2 className="w-3 h-3" /> Edit Templates
        </button>
        <div className="ml-auto flex items-center gap-2">
          {sheets.map((s, i) => (
            <button key={s.revision} onClick={() => setActiveRev(i)}
              className={`h-7 px-3 rounded-md text-xs font-medium transition-colors ${
                activeRev === i ? 'bg-white text-black' : 'bg-white/[0.04] text-gray-400 border border-white/[0.06] hover:text-gray-200'
              }`}>
              {s.revision}
            </button>
          ))}
          <button onClick={() => { setForm({}); setActiveRev(sheets.length); setRevision('Rev 0'); }}
            className="flex items-center gap-1 h-7 px-2.5 rounded-md text-[11px] text-gray-600 border border-dashed border-white/[0.08] hover:border-white/[0.2] hover:text-gray-300 transition-colors">
            <Plus className="w-3 h-3" /> New rev
          </button>
        </div>
      </div>

      <div className="w-36">
        <label className={labelCls}>Revision</label>
        <select value={revision} onChange={e => setRevision(e.target.value)} className={selectCls}>
          {revisions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Dynamic UDF sections */}
      {Object.entries(sections).map(([sectionName, fields]) => (
        <div key={sectionName} className="rounded-md border border-white/[0.06] overflow-hidden">
          <div className="bg-white/[0.02] border-b border-white/[0.06] px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-600">{sectionName}</span>
          </div>
          <div className="p-4 grid grid-cols-3 gap-3">
            {fields.map(field => (
              <DynamicField key={field.udf} field={field}
                value={form[field.udf] ?? ''}
                onChange={v => setForm(f => ({ ...f, [field.udf]: v }))} />
            ))}
          </div>
        </div>
      ))}

      {template.field_definitions.length === 0 && (
        <div className="rounded-md border border-dashed border-white/[0.06] px-4 py-8 text-center text-[11px] text-gray-600">
          This template has no fields yet.{' '}
          <button onClick={onManageTemplates} className="text-gray-400 underline hover:text-white transition-colors">
            Add fields
          </button>.
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 h-8 px-5 rounded-md bg-white text-black text-xs font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40">
          {saving  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
           : saved ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Saved</>
           :         <><Save className="w-3.5 h-3.5" /> Save Spec Sheet</>}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Approval tab
// ---------------------------------------------------------------------------
const ApprovalTab: React.FC<{ instrumentId: string; projectId: string }> = ({ instrumentId, projectId }) => {
  const [sheets,  setSheets]  = useState<SpecSheet[]>([]);
  const [active,  setActive]  = useState(0);
  const [form,    setForm]    = useState<Partial<SpecSheet>>({ revision: 'Rev 0', status: 'Draft' });
  const [saving,  setSaving]  = useState(false);
  const [saved,   setSaved]   = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`${API}/api/v1/datasheet/instruments/${instrumentId}/spec-sheets`);
    if (!r.ok) return;
    const d = await r.json();
    setSheets(d.spec_sheets ?? []);
    if (d.spec_sheets?.length) setForm(d.spec_sheets[0]);
  }, [instrumentId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (sheets[active]) setForm(sheets[active]); }, [active, sheets]);

  const save = async () => {
    setSaving(true); setSaved(false); setError(null);
    try {
      const r = await fetch(`${API}/api/v1/datasheet/instruments/${instrumentId}/spec-sheet`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, revision: form.revision ?? 'Rev 0', data: form }),
      });
      if (!r.ok) throw new Error(`Server ${r.status}`);
      setSaved(true); setTimeout(() => setSaved(false), 2000); load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v || null }));
  const STATUSES = ['Draft', 'For-Review', 'For-Approval', 'Approved', 'Issued-For-Construction', 'As-Built'];

  if (sheets.length === 0) {
    return (
      <div className="text-[11px] text-gray-600 py-8 text-center">
        Save a specification first to manage approval.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {sheets.map((s, i) => (
          <button key={s.revision} onClick={() => setActive(i)}
            className={`h-7 px-3 rounded-md text-xs font-medium transition-colors ${
              active === i ? 'bg-white text-black' : 'bg-white/[0.04] text-gray-400 border border-white/[0.06] hover:text-gray-200'
            }`}>
            {s.revision}
          </button>
        ))}
      </div>
      <div className="rounded-md border border-white/[0.06] overflow-hidden">
        <div className="bg-white/[0.02] border-b border-white/[0.06] px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-600">Document Status</span>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <SField label="Status"         value={form.status as string}               onChange={v => set('status', v)} options={STATUSES} />
          <SField label="Revision"       value={form.revision as string}             onChange={v => set('revision', v)}
            options={['Rev 0','Rev 1','Rev 2','Rev 3','Rev A','Rev B','Rev C']} />
          <SField label="Revision date"  value={form.revision_date as string}        onChange={v => set('revision_date', v)} type="date" />
          <SField label="Revision notes" value={(form.revision_description as string) ?? ''} onChange={v => set('revision_description', v)} placeholder="What changed" />
        </div>
      </div>
      <div className="rounded-md border border-white/[0.06] overflow-hidden">
        <div className="bg-white/[0.02] border-b border-white/[0.06] px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-600">Signatures</span>
        </div>
        <div className="p-4 grid grid-cols-3 gap-3">
          <SField label="Prepared by" value={form.prepared_by as string} onChange={v => set('prepared_by', v)} placeholder="Name" />
          <SField label="Checked by"  value={form.checked_by as string}  onChange={v => set('checked_by', v)}  placeholder="Name" />
          <SField label="Approved by" value={form.approved_by as string} onChange={v => set('approved_by', v)} placeholder="Name" />
        </div>
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 h-8 px-5 rounded-md bg-white text-black text-xs font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40">
          {saving  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
           : saved ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Saved</>
           :         <><Save className="w-3.5 h-3.5" /> Update Status</>}
        </button>
        {error && <span className="text-xs text-red-400">{error}</span>}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Calculations tab (read-only)
// ---------------------------------------------------------------------------
const CalcsTab: React.FC<{ instrumentId: string }> = ({ instrumentId }) => {
  const [calcs, setCalcs] = useState<Calculation[]>([]);

  useEffect(() => {
    fetch(`${API}/api/v1/datasheet/instruments/${instrumentId}/calculations`)
      .then(r => r.json())
      .then(d => setCalcs(d.calculations ?? []))
      .catch(() => {});
  }, [instrumentId]);

  if (calcs.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Calculator className="w-8 h-8 text-gray-700" />
        <p className="text-xs text-gray-500">No calculations linked yet.</p>
        <p className="text-[11px] text-gray-700 max-w-xs">
          Run FlowSizing for this tag — results will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {calcs.map(c => (
        <div key={c.id} className="rounded-md border border-white/[0.06] bg-white/[0.02] p-3 flex items-center gap-4">
          <div className="flex-1">
            <p className="text-xs font-medium text-white font-mono">{c.calc_type}</p>
            <p className="text-[11px] text-gray-600">{c.case_name} · Rev {c.revision}</p>
          </div>
          {c.result_value != null && (
            <div className="text-right">
              <p className="text-xs text-gray-200 font-mono">{c.result_value} {c.result_unit ?? ''}</p>
              <p className="text-[11px] text-gray-600">{c.result_label}</p>
            </div>
          )}
          {c.sizing_margin_pct != null && (
            <div className="text-right">
              <p className={`text-xs font-mono font-medium ${c.sizing_margin_pct >= 10 ? 'text-emerald-400' : 'text-amber-400'}`}>
                +{c.sizing_margin_pct.toFixed(1)}%
              </p>
              <p className="text-[11px] text-gray-600">margin</p>
            </div>
          )}
          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${
            c.calc_status === 'Approved'
              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-400/20'
              : 'bg-white/[0.04] text-gray-500 border-white/[0.06]'
          }`}>{c.calc_status}</span>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Editor page
// ---------------------------------------------------------------------------
export const DatasheetEditorPage: React.FC<Props> = ({ instrument, projectId, onBack, onManageTemplates }) => {
  const [tab, setTab] = useState('process');

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#09090c] text-gray-200">
      <div className="shrink-0 border-b border-white/[0.06] bg-[#0d0d11] px-5 py-3 flex items-center gap-3">
        <button onClick={onBack}
          className="flex items-center gap-1.5 text-gray-500 hover:text-gray-200 text-xs transition-colors">
          <ChevronLeft className="w-3.5 h-3.5" /> Datasheets
        </button>
        <span className="text-white/[0.15]">/</span>
        <div className="flex items-center gap-2">
          <FileText className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-sm font-semibold text-white font-mono">{instrument.tag_number}</span>
          <span className="text-[11px] text-gray-500">{instrument.instrument_type}</span>
          {instrument.service && <span className="text-[11px] text-gray-600">— {instrument.service}</span>}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {instrument.ds_status && (
            <span className="text-[10px] text-gray-600 border border-white/[0.08] rounded px-2 py-0.5">
              {instrument.ds_revision} · {instrument.ds_status}
            </span>
          )}
          <a
            href={`${API}/api/v1/datasheet/instruments/${instrument.id}/pdf`}
            target="_blank"
            rel="noreferrer"
            title="Open printable datasheet PDF"
            className="flex items-center gap-1.5 h-7 px-3 rounded-md border border-white/[0.08]
              bg-white/[0.03] text-[11px] text-gray-400 hover:text-white hover:border-white/[0.2]
              transition-colors"
          >
            <Printer className="w-3 h-3" />
            Print PDF
          </a>
        </div>
      </div>

      <div className="shrink-0 border-b border-white/[0.06] bg-[#0d0d11] px-5 flex items-end gap-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              tab === id ? 'border-white text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}>
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto xyra-scroll-contained">
        <div className="max-w-4xl mx-auto px-5 py-5">
          {tab === 'process'  && <ProcessTab   instrumentId={instrument.id} projectId={projectId} />}
          {tab === 'spec'     && <UDFSpecTab   instrumentId={instrument.id} projectId={projectId} instrument={instrument} onManageTemplates={onManageTemplates} />}
          {tab === 'approval' && <ApprovalTab  instrumentId={instrument.id} projectId={projectId} />}
          {tab === 'calcs'    && <CalcsTab     instrumentId={instrument.id} />}
        </div>
      </div>
    </div>
  );
};

// Unused but needed to satisfy import references elsewhere
const _Gauge = Gauge;
const _Waves = Waves;
export { _Gauge, _Waves };

export default DatasheetEditorPage;
