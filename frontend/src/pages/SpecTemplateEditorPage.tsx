import React, { useState, useEffect, useCallback } from 'react';
import {
  ChevronLeft, Plus, Trash2, Save, Loader2, CheckCircle2,
  GripVertical, Settings2, Wrench, Sparkles,
} from 'lucide-react';
import type { FormTemplate, TemplateField } from './DatasheetEditorPage';

interface Props {
  onBack: () => void;
}

const API = import.meta.env.VITE_API_URL || '';

const inputCls  = 'h-8 w-full rounded-md border border-white/[0.08] bg-black px-2.5 text-xs text-gray-200 placeholder:text-gray-700 outline-none focus:border-white/[0.18] transition-colors';
const selectCls = 'h-8 w-full rounded-md border border-white/[0.08] bg-black px-2.5 text-xs text-gray-200 outline-none focus:border-white/[0.18] transition-colors';
const labelCls  = 'text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-600 mb-1 block';

const FIELD_TYPES = ['text', 'number', 'select', 'textarea', 'checkbox'] as const;
const REVISIONS   = ['Rev 0','Rev 1','Rev 2','Rev A','Rev B','Rev C'];

const NEXT_UDF = (existing: TemplateField[]): string => {
  const used = new Set(existing.map(f => f.udf));
  for (let i = 1; i <= 100; i++) {
    const key = `udf_${String(i).padStart(2, '0')}`;
    if (!used.has(key)) return key;
  }
  return 'udf_100';
};

const EMPTY_FIELD = (existing: TemplateField[]): TemplateField => ({
  udf:     NEXT_UDF(existing),
  label:   '',
  section: 'General',
  type:    'text',
});

// ---------------------------------------------------------------------------
// Field row editor
// ---------------------------------------------------------------------------
const FieldRow: React.FC<{
  field:    TemplateField;
  onChange: (f: TemplateField) => void;
  onDelete: () => void;
}> = ({ field, onChange, onDelete }) => {
  const set = <K extends keyof TemplateField>(k: K, v: TemplateField[K]) =>
    onChange({ ...field, [k]: v });

  return (
    <div className="grid grid-cols-[20px_60px_1fr_1fr_100px_1fr_28px] gap-2 items-start py-2 border-b border-white/[0.04] last:border-0">
      {/* drag handle — decorative */}
      <div className="flex items-center h-8 text-gray-700 cursor-grab">
        <GripVertical className="w-3.5 h-3.5" />
      </div>

      {/* UDF badge */}
      <div className="flex items-center h-8">
        <span className="text-[10px] font-mono text-gray-600 border border-white/[0.06] rounded px-1.5 py-0.5">
          {field.udf.replace('udf_', '#')}
        </span>
      </div>

      {/* Label */}
      <input
        value={field.label} placeholder="Label"
        onChange={e => set('label', e.target.value)}
        className={inputCls}
      />

      {/* Section */}
      <input
        value={field.section} placeholder="Section"
        onChange={e => set('section', e.target.value)}
        className={inputCls}
      />

      {/* Type */}
      <select value={field.type} onChange={e => set('type', e.target.value as TemplateField['type'])} className={selectCls}>
        {FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      {/* Options (only for select) / Placeholder */}
      {field.type === 'select' ? (
        <input
          value={(field.options ?? []).join(', ')}
          onChange={e => set('options', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          placeholder="Opt1, Opt2, Opt3…"
          className={inputCls}
        />
      ) : (
        <input
          value={field.placeholder ?? ''}
          onChange={e => set('placeholder', e.target.value)}
          placeholder="Placeholder text"
          className={inputCls}
        />
      )}

      {/* Delete */}
      <button onClick={onDelete}
        className="h-8 w-7 flex items-center justify-center rounded-md text-gray-700 hover:text-red-400 hover:bg-red-400/10 transition-colors">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Template editor panel
// ---------------------------------------------------------------------------
const TemplateEditor: React.FC<{
  template: FormTemplate | null;
  onSaved:  (t: FormTemplate) => void;
  onDelete: (id: string) => void;
}> = ({ template, onSaved, onDelete }) => {
  const [name,    setName]   = useState(template?.template_name ?? '');
  const [itype,   setItype]  = useState(template?.instrument_type ?? '');
  const [fields,  setFields] = useState<TemplateField[]>(template?.field_definitions ?? []);
  const [saving,  setSaving] = useState(false);
  const [saved,   setSaved]  = useState(false);
  const [deleting,setDel]    = useState(false);
  const [error,   setError]  = useState<string | null>(null);

  useEffect(() => {
    setName(template?.template_name ?? '');
    setItype(template?.instrument_type ?? '');
    setFields(template?.field_definitions ?? []);
    setSaved(false);
    setError(null);
  }, [template]);

  const save = async () => {
    if (!name.trim()) { setError('Template name is required'); return; }
    setSaving(true); setSaved(false); setError(null);
    try {
      const r = await fetch(`${API}/api/v1/datasheet/templates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id:                template?.id ?? null,
          template_name:     name.trim(),
          instrument_type:   itype.trim() || null,
          field_definitions: fields,
        }),
      });
      if (!r.ok) throw new Error(`Server ${r.status}`);
      const saved_t: FormTemplate = await r.json();
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      onSaved(saved_t);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const del = async () => {
    if (!template?.id) return;
    setDel(true);
    await fetch(`${API}/api/v1/datasheet/templates/${template.id}`, { method: 'DELETE' });
    setDel(false);
    onDelete(template.id);
  };

  const addField = () => setFields(f => [...f, EMPTY_FIELD(f)]);
  const updateField = (i: number, updated: TemplateField) =>
    setFields(f => f.map((x, idx) => idx === i ? updated : x));
  const deleteField = (i: number) => setFields(f => f.filter((_, idx) => idx !== i));

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Meta */}
      <div className="shrink-0 border-b border-white/[0.06] px-5 py-4 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Template name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. PT - Pressure Transmitter" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Instrument type (optional)</label>
            <input value={itype} onChange={e => setItype(e.target.value.toUpperCase())} placeholder="e.g. PT, FT, CV…" className={inputCls} />
          </div>
        </div>
        {itype && (
          <p className="text-[11px] text-gray-600">
            Auto-loaded when editing any <span className="font-mono text-gray-400">{itype}</span> instrument spec sheet.
          </p>
        )}
      </div>

      {/* Column headers */}
      <div className="shrink-0 grid grid-cols-[20px_60px_1fr_1fr_100px_1fr_28px] gap-2 px-5 py-2 bg-white/[0.02] border-b border-white/[0.06]">
        {['', 'UDF', 'Label', 'Section', 'Type', 'Options / Placeholder', ''].map((h, i) => (
          <span key={i} className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-700">{h}</span>
        ))}
      </div>

      {/* Fields */}
      <div className="flex-1 overflow-y-auto xyra-scroll-contained px-5">
        {fields.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center text-[11px] text-gray-600">
            <Settings2 className="w-6 h-6 text-gray-700" />
            No fields yet. Add your first UDF field below.
          </div>
        ) : (
          fields.map((f, i) => (
            <FieldRow key={f.udf + i} field={f} onChange={upd => updateField(i, upd)} onDelete={() => deleteField(i)} />
          ))
        )}
      </div>

      {/* Footer actions */}
      <div className="shrink-0 border-t border-white/[0.06] px-5 py-3 flex items-center gap-3">
        <button onClick={addField}
          className="flex items-center gap-1.5 h-8 px-3 rounded-md text-[11px] text-gray-500 border border-dashed border-white/[0.08] hover:text-gray-200 hover:border-white/[0.2] transition-colors">
          <Plus className="w-3 h-3" /> Add field
        </button>
        <div className="flex items-center gap-2 ml-auto">
          {template?.id && (
            <button onClick={del} disabled={deleting}
              className="h-8 px-3 rounded-md text-xs text-red-400 border border-red-400/20 hover:bg-red-400/10 transition-colors disabled:opacity-40">
              {deleting ? 'Deleting…' : 'Delete template'}
            </button>
          )}
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 h-8 px-5 rounded-md bg-white text-black text-xs font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40">
            {saving  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
             : saved ? <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> Saved</>
             :         <><Save className="w-3.5 h-3.5" /> Save Template</>}
          </button>
        </div>
        {error && <span className="text-xs text-red-400 ml-2">{error}</span>}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
const SpecTemplateEditorPage: React.FC<Props> = ({ onBack }) => {
  const [templates, setTemplates]   = useState<FormTemplate[]>([]);
  const [selected,  setSelected]    = useState<FormTemplate | null>(null);
  const [isNew,     setIsNew]       = useState(false);
  const [loading,   setLoading]     = useState(true);
  const [seeding,   setSeeding]     = useState(false);
  const [seedMsg,   setSeedMsg]     = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await fetch(`${API}/api/v1/datasheet/templates`);
    const d = await r.json();
    const tmpl: FormTemplate[] = d.templates ?? [];
    setTemplates(tmpl);
    if (!selected && tmpl.length > 0) setSelected(tmpl[0]);
    setLoading(false);
  }, [selected]);

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaved = (saved: FormTemplate) => {
    setTemplates(ts => {
      const idx = ts.findIndex(t => t.id === saved.id);
      return idx >= 0 ? ts.map(t => t.id === saved.id ? saved : t) : [...ts, saved];
    });
    setSelected(saved);
    setIsNew(false);
  };

  const seedDefaults = async () => {
    setSeeding(true); setSeedMsg(null);
    try {
      const r = await fetch(`${API}/api/v1/datasheet/templates/seed`, { method: 'POST' });
      const d = await r.json();
      setSeedMsg(`Added ${d.created} template${d.created !== 1 ? 's' : ''}${d.skipped ? `, ${d.skipped} already existed` : ''}.`);
      await load();
    } catch {
      setSeedMsg('Seed failed — is the backend running?');
    } finally {
      setSeeding(false);
      setTimeout(() => setSeedMsg(null), 4000);
    }
  };

  const handleDelete = (id: string) => {
    const remaining = templates.filter(t => t.id !== id);
    setTemplates(remaining);
    setSelected(remaining[0] ?? null);
  };

  const newTemplate = (): FormTemplate => ({
    id: '',
    template_name: '',
    instrument_type: null,
    field_definitions: [],
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#09090c] text-gray-200">
      {/* Header */}
      <div className="shrink-0 border-b border-white/[0.06] bg-[#0d0d11] px-5 py-3 flex items-center gap-3">
        <button onClick={onBack}
          className="flex items-center gap-1.5 text-gray-500 hover:text-gray-200 text-xs transition-colors">
          <ChevronLeft className="w-3.5 h-3.5" /> Datasheets
        </button>
        <span className="text-white/[0.15]">/</span>
        <div className="flex items-center gap-2">
          <Settings2 className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-sm font-semibold text-white">Spec Sheet Templates</span>
          <span className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-gray-500">
            UDF Fields
          </span>
        </div>
      </div>

      {/* Body: sidebar + editor */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* Template list sidebar */}
        <div className="w-56 shrink-0 border-r border-white/[0.06] flex flex-col overflow-hidden">
          <div className="shrink-0 px-3 pt-3 pb-2 space-y-1.5">
            <button
              onClick={() => { setSelected(newTemplate()); setIsNew(true); }}
              className="w-full flex items-center justify-center gap-1.5 h-8 rounded-md border border-dashed border-white/[0.08] text-[11px] text-gray-600 hover:text-gray-300 hover:border-white/[0.18] transition-colors">
              <Plus className="w-3 h-3" /> New template
            </button>
            <button
              onClick={seedDefaults}
              disabled={seeding}
              className="w-full flex items-center justify-center gap-1.5 h-8 rounded-md border border-dashed border-white/[0.06] text-[11px] text-gray-700 hover:text-emerald-300 hover:border-emerald-400/30 transition-colors disabled:opacity-40">
              {seeding
                ? <><Loader2 className="w-3 h-3 animate-spin" /> Loading…</>
                : <><Sparkles className="w-3 h-3" /> Load defaults</>}
            </button>
            {seedMsg && (
              <p className="text-[10px] text-emerald-400 text-center leading-tight px-1">{seedMsg}</p>
            )}
          </div>
          <div className="flex-1 overflow-y-auto xyra-scroll-contained px-2 pb-2">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-8 text-[11px] text-gray-600">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              </div>
            ) : templates.length === 0 ? (
              <div className="text-center py-8 text-[11px] text-gray-700">
                No templates yet.
              </div>
            ) : (
              templates.map(t => (
                <button key={t.id}
                  onClick={() => { setSelected(t); setIsNew(false); }}
                  className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors mb-0.5 ${
                    selected?.id === t.id && !isNew
                      ? 'bg-white/[0.08] text-white'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-white/[0.04]'
                  }`}>
                  <p className="font-medium truncate">{t.template_name}</p>
                  {t.instrument_type && (
                    <p className="text-[10px] text-gray-600 font-mono">{t.instrument_type}</p>
                  )}
                  <p className="text-[10px] text-gray-700">{t.field_definitions.length} field{t.field_definitions.length !== 1 ? 's' : ''}</p>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Editor */}
        {selected ? (
          <TemplateEditor
            key={selected.id || 'new'}
            template={isNew ? null : selected}
            onSaved={handleSaved}
            onDelete={handleDelete}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center">
            <Wrench className="w-8 h-8 text-gray-700" />
            <p className="text-xs text-gray-600">Select a template or create a new one.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SpecTemplateEditorPage;
