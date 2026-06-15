import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  GitBranch, RefreshCw, Download, Sparkles, Loader2, AlertCircle,
  ChevronDown, Search, X, Check, Info,
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
interface Instrument {
  id:        string;
  tag:       string;
  type:      string;
  service:   string;
  io_type:   string;
  system:    string;
  sil:       string;
  fail_state:string;
  loop:      string;
  area:      string;
}

interface CellData {
  action: string;   // 'X' | 'A' | 'I' | ''
  voting: string;
  notes:  string;
}

interface MatrixData {
  project_id: string;
  causes:     Instrument[];
  effects:    Instrument[];
  cells:      Record<string, CellData>;
  stats:      { cause_count: number; effect_count: number; cell_count: number };
}

interface Project { project_id: string; name: string | null; project_no: string | null; }

// ─────────────────────────────────────────────────────────────────────────────
// Action config
// ─────────────────────────────────────────────────────────────────────────────
const ACTIONS = [
  { value: 'X', label: 'Trip / Act',   bg: 'bg-emerald-500/20', text: 'text-emerald-300', border: 'border-emerald-500/40' },
  { value: 'A', label: 'Alarm Only',   bg: 'bg-amber-500/20',   text: 'text-amber-300',   border: 'border-amber-500/40'   },
  { value: 'I', label: 'Inhibit',      bg: 'bg-gray-500/15',    text: 'text-gray-500',    border: 'border-gray-600/40'    },
  { value: '',  label: 'Clear',        bg: '',                   text: '',                 border: ''                      },
];
const ACTION_MAP = Object.fromEntries(ACTIONS.map(a => [a.value, a]));

const SYSTEM_FILTERS = ['All', 'SIS/ESD', 'F&GS'];
const VOTING_OPTIONS  = ['', '1oo1', '1oo2', '2oo2', '2oo3', '1oo3'];

// ─────────────────────────────────────────────────────────────────────────────
// Cell popup
// ─────────────────────────────────────────────────────────────────────────────
interface CellPopupProps {
  cause:    Instrument;
  effect:   Instrument;
  current:  CellData | null;
  anchor:   { x: number; y: number };
  onSave:   (action: string, voting: string, notes: string) => void;
  onClose:  () => void;
}
const CellPopup: React.FC<CellPopupProps> = ({ cause, effect, current, anchor, onSave, onClose }) => {
  const [action, setAction] = useState(current?.action ?? '');
  const [voting, setVoting] = useState(current?.voting ?? '');
  const [notes,  setNotes]  = useState(current?.notes  ?? '');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  // keep popup inside viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(anchor.x, window.innerWidth - 320),
    top:  Math.min(anchor.y, window.innerHeight - 280),
    zIndex: 9999,
  };

  return (
    <div ref={ref} style={style}
      className="w-72 rounded-lg border border-white/[0.12] bg-[#0f0f16] shadow-2xl shadow-black/70 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-mono font-bold text-white">{cause.tag} → {effect.tag}</p>
          <p className="text-[10px] text-gray-600 mt-0.5 truncate">{cause.service || cause.type}</p>
        </div>
        <button onClick={onClose}><X className="w-3.5 h-3.5 text-gray-600 hover:text-gray-300" /></button>
      </div>

      {/* Action selector */}
      <div className="grid grid-cols-4 gap-1">
        {ACTIONS.map(a => (
          <button key={a.value} onClick={() => setAction(a.value)}
            className={`rounded py-1 text-[10px] font-bold border transition-all
              ${action === a.value
                ? (a.bg || 'bg-white/[0.08]') + ' ' + (a.text || 'text-gray-400') + ' ' + (a.border || 'border-white/[0.1]')
                : 'bg-white/[0.03] text-gray-600 border-white/[0.06] hover:bg-white/[0.06]'
              }`}>
            {a.value || '—'}
          </button>
        ))}
      </div>
      <div className="flex gap-1 items-center justify-between">
        {ACTIONS.map(a => (
          <span key={a.value} className="text-[9px] text-gray-700 text-center flex-1">
            {a.label}
          </span>
        ))}
      </div>

      {/* Voting */}
      {action && action !== 'A' && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-600 shrink-0">Voting</span>
          <select value={voting} onChange={e => setVoting(e.target.value)}
            className="flex-1 h-6 rounded bg-black border border-white/[0.08] text-[10px] text-gray-300 px-1.5 outline-none">
            {VOTING_OPTIONS.map(v => <option key={v} value={v}>{v || '—'}</option>)}
          </select>
        </div>
      )}

      {/* Notes */}
      <textarea value={notes} onChange={e => setNotes(e.target.value)}
        placeholder="Notes (optional)…"
        rows={2}
        className="w-full rounded bg-black border border-white/[0.08] text-[10px] text-gray-300
          placeholder:text-gray-700 px-2 py-1.5 outline-none resize-none" />

      {/* Effect info */}
      <div className="text-[9px] text-gray-700 border-t border-white/[0.04] pt-2">
        Effect: <span className="text-gray-500">{effect.tag}</span>
        {effect.fail_state && <span className="ml-1">· Fail {effect.fail_state}</span>}
        {effect.system && <span className="ml-1">· {effect.system}</span>}
      </div>

      <button onClick={() => { onSave(action, voting, notes); onClose(); }}
        className="w-full h-7 rounded bg-white/[0.07] hover:bg-white/[0.12] border border-white/[0.1]
          text-[11px] text-white font-medium transition-colors flex items-center justify-center gap-1.5">
        <Check className="w-3 h-3" /> Save
      </button>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────
const CauseEffectPage: React.FC = () => {
  const [projects,   setProjects]   = useState<Project[]>([]);
  const [projectId,  setProjectId]  = useState('');
  const [sysFilter,  setSysFilter]  = useState('All');
  const [causeSearch, setCauseSearch] = useState('');
  const [effSearch,   setEffSearch]   = useState('');
  const [matrix,     setMatrix]     = useState<MatrixData | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [saving,     setSaving]     = useState<Set<string>>(new Set());
  const [saved,      setSaved]      = useState<Set<string>>(new Set());
  const [error,      setError]      = useState<string | null>(null);
  const [popup,      setPopup]      = useState<{
    cause: Instrument; effect: Instrument; anchor: { x: number; y: number };
  } | null>(null);
  const [cells,      setCells]      = useState<Record<string, CellData>>({});

  // Load projects
  useEffect(() => {
    fetch(`${API}/api/v1/datasheet/projects`)
      .then(r => r.json())
      .then(d => {
        const list: Project[] = d.projects ?? [];
        setProjects(list);
        if (list.length) setProjectId(list[0].project_id);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ project_id: projectId });
      if (sysFilter !== 'All') p.set('system_filter', sysFilter);
      const r = await fetch(`${API}/api/v1/cause-effect/matrix?${p}`);
      if (!r.ok) throw new Error(`Server ${r.status}`);
      const d: MatrixData = await r.json();
      setMatrix(d);
      setCells(d.cells ?? {});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [projectId, sysFilter]);

  useEffect(() => { load(); }, [load]);

  const filteredCauses = useMemo(() => {
    const q = causeSearch.toLowerCase();
    return (matrix?.causes ?? []).filter(c =>
      !q || c.tag.toLowerCase().includes(q) || c.service.toLowerCase().includes(q)
    );
  }, [matrix, causeSearch]);

  const filteredEffects = useMemo(() => {
    const q = effSearch.toLowerCase();
    return (matrix?.effects ?? []).filter(e =>
      !q || e.tag.toLowerCase().includes(q) || e.service.toLowerCase().includes(q)
    );
  }, [matrix, effSearch]);

  const saveCell = useCallback(async (
    cause: Instrument, effect: Instrument,
    action: string, voting: string, notes: string,
  ) => {
    const key = `${cause.tag}|${effect.tag}`;
    // Optimistic update
    if (action) {
      setCells(prev => ({ ...prev, [key]: { action, voting, notes } }));
    } else {
      setCells(prev => { const n = { ...prev }; delete n[key]; return n; });
    }
    setSaving(s => new Set([...s, key]));
    try {
      await fetch(`${API}/api/v1/cause-effect/cell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id:    projectId,
          initiator_tag: cause.tag,
          effect_tag:    effect.tag,
          action, voting, notes,
        }),
      });
      setSaved(s => new Set([...s, key]));
      setTimeout(() => setSaved(s => { const n = new Set(s); n.delete(key); return n; }), 1200);
    } catch {
      // revert
      setCells(prev => {
        const n = { ...prev };
        if (matrix?.cells[key]) n[key] = matrix.cells[key];
        else delete n[key];
        return n;
      });
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(key); return n; });
    }
  }, [projectId, matrix]);

  const runSuggest = async () => {
    if (!projectId) return;
    setSuggesting(true);
    try {
      const r = await fetch(`${API}/api/v1/cause-effect/suggest?project_id=${encodeURIComponent(projectId)}`);
      const d = await r.json();
      const suggestions: Array<{
        initiator_tag: string; effect_tag: string; action: string; voting: string; notes: string;
      }> = d.suggestions ?? [];
      if (!suggestions.length) return;

      // Apply to cells state and bulk-save
      const newCells = { ...cells };
      for (const s of suggestions) {
        const key = `${s.initiator_tag}|${s.effect_tag}`;
        if (!newCells[key]) {  // only fill empty cells
          newCells[key] = { action: s.action, voting: s.voting, notes: s.notes };
        }
      }
      setCells(newCells);

      // Save only new ones
      const toSave = suggestions.filter(s => !cells[`${s.initiator_tag}|${s.effect_tag}`]);
      if (toSave.length) {
        await fetch(`${API}/api/v1/cause-effect/cells/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: projectId, cells: toSave }),
        });
      }
    } catch {
      setError('Suggest failed');
    } finally {
      setSuggesting(false);
    }
  };

  const exportExcel = () => {
    window.open(`${API}/api/v1/cause-effect/export?project_id=${encodeURIComponent(projectId)}`, '_blank');
  };

  const cellCount  = Object.keys(cells).length;
  const filledPct  = matrix
    ? Math.round((cellCount / Math.max(1, (matrix.causes.length * matrix.effects.length))) * 100)
    : 0;

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#09090c] text-gray-200">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-white/[0.06] bg-[#0d0d11] px-5 py-3">
        <div className="flex items-center gap-3 flex-wrap">
          <GitBranch className="h-4 w-4 text-gray-400 shrink-0" />
          <h1 className="text-sm font-semibold text-white">C&E Matrix</h1>
          <span className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-gray-500">
            Cause &amp; Effect
          </span>

          <div className="w-px h-4 bg-white/[0.08]" />

          {/* Project */}
          <select value={projectId} onChange={e => setProjectId(e.target.value)}
            className="h-7 rounded-md border border-white/[0.08] bg-black px-2 text-[11px] text-gray-300
              outline-none focus:border-white/[0.2] min-w-[200px]">
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map(p => (
              <option key={p.project_id} value={p.project_id}>
                {p.name || p.project_id}
              </option>
            ))}
          </select>

          {/* System filter */}
          <div className="flex rounded-md border border-white/[0.08] overflow-hidden">
            {SYSTEM_FILTERS.map(f => (
              <button key={f} onClick={() => setSysFilter(f)}
                className={`px-2.5 h-7 text-[10px] font-medium transition-colors ${
                  sysFilter === f ? 'bg-white/[0.1] text-white' : 'text-gray-600 hover:text-gray-300'
                }`}>
                {f}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* Stats */}
            {matrix && (
              <span className="text-[10px] text-gray-600 font-mono">
                {matrix.stats.cause_count}C × {matrix.stats.effect_count}E · {cellCount} filled ({filledPct}%)
              </span>
            )}

            {/* Suggest */}
            <button onClick={runSuggest} disabled={!projectId || suggesting}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-white/[0.08]
                bg-white/[0.03] text-[11px] text-gray-500 hover:text-gray-200 hover:border-white/[0.16]
                transition-colors disabled:opacity-40">
              {suggesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Suggest
            </button>

            {/* Refresh */}
            <button onClick={load} disabled={loading}
              className="h-7 w-7 flex items-center justify-center rounded-md border border-white/[0.08]
                bg-white/[0.03] text-gray-600 hover:text-gray-300 transition-colors disabled:opacity-40">
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            </button>

            {/* Export */}
            <button onClick={exportExcel} disabled={!projectId}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded-md border border-white/[0.08]
                bg-white/[0.03] text-[11px] text-gray-500 hover:text-gray-200 hover:border-white/[0.16]
                transition-colors disabled:opacity-40">
              <Download className="w-3 h-3" /> Export
            </button>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="shrink-0 flex items-center gap-2 text-red-300 bg-red-500/10
          border-b border-red-400/20 px-4 py-2 text-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
        </div>
      )}

      {/* ── Legend + search bar ───────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-5 border-b border-white/[0.04] px-4 py-1.5 flex-wrap">
        {ACTIONS.filter(a => a.value).map(a => (
          <div key={a.value} className="flex items-center gap-1.5">
            <span className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center
              border ${a.bg} ${a.text} ${a.border}`}>{a.value}</span>
            <span className="text-[10px] text-gray-700">{a.label}</span>
          </div>
        ))}
        <div className="w-px h-3 bg-white/[0.06] mx-1" />
        <div className="flex items-center gap-1.5">
          <Info className="w-3 h-3 text-gray-700" />
          <span className="text-[10px] text-gray-700">Click any cell to set action · Rows = Causes · Columns = Effects</span>
        </div>
      </div>

      {/* ── Grid ─────────────────────────────────────────────────────────── */}
      {loading && !matrix ? (
        <div className="flex-1 flex items-center justify-center gap-2 text-[11px] text-gray-600">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading matrix…
        </div>
      ) : !matrix || (matrix.causes.length === 0 && matrix.effects.length === 0) ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-600">
          <GitBranch className="w-10 h-10 opacity-20" />
          <p className="text-xs">
            {projectId
              ? 'No SIS/ESD or F&G instruments found. Extract a P&ID first.'
              : 'Select a project above.'}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto xyra-scroll-contained">
          <table className="border-collapse"
            style={{ minWidth: 320 + filteredEffects.length * 48 }}>
            <thead>
              {/* Row 1: effect search */}
              <tr>
                {/* Cause header area — sticky corner */}
                <th colSpan={4}
                  className="sticky left-0 z-30 bg-[#0b0b10] border-b border-r-2 border-white/[0.08] px-3 py-2"
                  style={{ minWidth: 320 }}>
                  <div className="flex items-center gap-1.5">
                    <Search className="w-3 h-3 text-gray-700 shrink-0" />
                    <input value={causeSearch} onChange={e => setCauseSearch(e.target.value)}
                      placeholder="Filter causes…"
                      className="bg-transparent text-[10px] text-gray-400 placeholder:text-gray-700 outline-none flex-1" />
                    {causeSearch && (
                      <button onClick={() => setCauseSearch('')}><X className="w-3 h-3 text-gray-700" /></button>
                    )}
                  </div>
                </th>
                {/* Effect search */}
                <th colSpan={filteredEffects.length}
                  className="sticky top-0 z-20 bg-[#0b0b10] border-b border-white/[0.06] px-3 py-2 text-left">
                  <div className="flex items-center gap-1.5">
                    <Search className="w-3 h-3 text-gray-700 shrink-0" />
                    <input value={effSearch} onChange={e => setEffSearch(e.target.value)}
                      placeholder="Filter effects…"
                      className="bg-transparent text-[10px] text-gray-400 placeholder:text-gray-700 outline-none w-36" />
                    {effSearch && (
                      <button onClick={() => setEffSearch('')}><X className="w-3 h-3 text-gray-700" /></button>
                    )}
                  </div>
                </th>
              </tr>

              {/* Row 2: effect tags (rotated) */}
              <tr>
                {/* Cause column headers */}
                {['Tag No.', 'Service', 'SIL', 'Sys'].map((lbl, i) => (
                  <th key={lbl}
                    className="sticky left-0 z-30 bg-[#0d0d11] border-b border-r border-white/[0.06]
                      px-2 py-2 text-left whitespace-nowrap"
                    style={{
                      top: 33,
                      minWidth: i === 0 ? 110 : i === 1 ? 140 : i === 2 ? 40 : 60,
                      left: i === 0 ? 0 : i === 1 ? 110 : i === 2 ? 250 : 290,
                    }}>
                    <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-gray-600">{lbl}</span>
                  </th>
                ))}
                {/* Effect columns */}
                {filteredEffects.map(eff => (
                  <th key={eff.id}
                    className="sticky z-20 bg-[#0d0d11] border-b border-r border-white/[0.06] p-1"
                    style={{ top: 33, minWidth: 44, width: 44 }}>
                    <div className="flex flex-col items-center gap-0.5">
                      <span
                        title={`${eff.tag} — ${eff.service}`}
                        className="text-[9px] font-mono font-semibold text-blue-300 truncate max-w-[40px]"
                        style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', maxHeight: 72 }}>
                        {eff.tag}
                      </span>
                      {eff.fail_state && (
                        <span className="text-[8px] text-gray-700">{eff.fail_state[0]}</span>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {filteredCauses.map((cause, ri) => {
                const stripe = ri % 2 === 1;
                return (
                  <tr key={cause.id}
                    className={`border-b border-white/[0.03] ${stripe ? 'bg-white/[0.005]' : ''}`}>
                    {/* Tag */}
                    <td className={`sticky z-10 border-r border-white/[0.06] px-2 font-mono
                      text-[10px] font-semibold text-white whitespace-nowrap
                      ${stripe ? 'bg-[#0c0c10]' : 'bg-[#09090c]'}`}
                      style={{ left: 0, minWidth: 110, height: 28 }}>
                      {cause.tag}
                    </td>
                    {/* Service */}
                    <td className={`sticky z-10 border-r border-white/[0.06] px-2
                      text-[10px] text-gray-500 max-w-[140px] truncate
                      ${stripe ? 'bg-[#0c0c10]' : 'bg-[#09090c]'}`}
                      style={{ left: 110, minWidth: 140 }}
                      title={cause.service}>
                      {cause.service || cause.type || '—'}
                    </td>
                    {/* SIL */}
                    <td className={`sticky z-10 border-r border-white/[0.06] px-1 text-center
                      ${stripe ? 'bg-[#0c0c10]' : 'bg-[#09090c]'}`}
                      style={{ left: 250, minWidth: 40 }}>
                      {cause.sil && (
                        <span className="text-[9px] font-mono font-bold text-purple-400 bg-purple-500/10
                          border border-purple-500/20 rounded px-1">{cause.sil}</span>
                      )}
                    </td>
                    {/* System */}
                    <td className={`sticky z-10 border-r-2 border-white/[0.08] px-1.5 text-[9px] text-gray-600 whitespace-nowrap
                      ${stripe ? 'bg-[#0c0c10]' : 'bg-[#09090c]'}`}
                      style={{ left: 290, minWidth: 60 }}>
                      {cause.system || '—'}
                    </td>

                    {/* Effect cells */}
                    {filteredEffects.map(effect => {
                      const key     = `${cause.tag}|${effect.tag}`;
                      const cell    = cells[key];
                      const isSaving = saving.has(key);
                      const isSaved  = saved.has(key);
                      const cfg = cell ? ACTION_MAP[cell.action] : null;

                      return (
                        <td key={effect.id}
                          onClick={e => {
                            const rect = (e.target as HTMLElement).getBoundingClientRect();
                            setPopup({ cause, effect, anchor: { x: rect.right + 4, y: rect.top } });
                          }}
                          title={cell ? `${cause.tag} → ${effect.tag}: ${cell.action}${cell.voting ? ' ' + cell.voting : ''}${cell.notes ? '\n' + cell.notes : ''}` : `${cause.tag} → ${effect.tag}`}
                          className={`border-r border-white/[0.03] cursor-pointer transition-colors
                            hover:bg-white/[0.06] text-center
                            ${cfg ? cfg.bg : stripe ? 'bg-white/[0.003]' : ''}`}
                          style={{ width: 44, minWidth: 44, height: 28 }}>
                          {isSaving ? (
                            <Loader2 className="w-2.5 h-2.5 text-gray-600 animate-spin mx-auto" />
                          ) : cell?.action ? (
                            <span className={`text-[11px] font-bold ${cfg?.text ?? 'text-gray-400'}`}>
                              {cell.action}
                            </span>
                          ) : (
                            <span className="text-gray-800 text-[10px]">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      {matrix && (
        <div className="shrink-0 flex items-center justify-between border-t border-white/[0.04] px-4 py-1.5">
          <span className="text-[10px] text-gray-700">
            {filteredCauses.length} causes · {filteredEffects.length} effects · {cellCount} actions defined
          </span>
          <span className="text-[10px] text-gray-700">
            Click a cell to set · X = Trip/Act · A = Alarm · I = Inhibit
          </span>
        </div>
      )}

      {/* ── Cell popup ───────────────────────────────────────────────────── */}
      {popup && (
        <CellPopup
          cause={popup.cause}
          effect={popup.effect}
          current={cells[`${popup.cause.tag}|${popup.effect.tag}`] ?? null}
          anchor={popup.anchor}
          onSave={(action, voting, notes) =>
            saveCell(popup.cause, popup.effect, action, voting, notes)
          }
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
};

export default CauseEffectPage;
