import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText, Search, ChevronRight, Loader2, AlertCircle,
  CheckCircle2, Clock, FileEdit, Circle, RefreshCw, Settings2,
  LayoutList, LayoutGrid,
} from 'lucide-react';
import { DatasheetEditorPage } from './DatasheetEditorPage';
import SpecTemplateEditorPage from './SpecTemplateEditorPage';
import DatasheetGridView, { type GridRow } from './DatasheetGridView';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Project {
  project_id: string;
  name: string | null;
  project_no: string | null;
}

interface InstrumentRow {
  id:           string;
  tag_number:   string;
  instrument_type: string;
  service:      string | null;
  line_tag:     string | null;
  area_code:    string | null;
  inst_status:  string | null;
  ds_status:    string | null;
  ds_revision:  string | null;
  ds_updated_at: string | null;
  ds_prepared_by: string | null;
}

const API = import.meta.env.VITE_API_URL || '';

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------
const DS_STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  'Not Started':      { label: 'Not Started',     cls: 'bg-white/[0.04] text-gray-600 border-white/[0.06]' },
  'Draft':            { label: 'Draft',            cls: 'bg-white/[0.06] text-gray-400 border-white/[0.08]' },
  'For-Review':       { label: 'For Review',       cls: 'bg-blue-500/10 text-blue-300 border-blue-400/20' },
  'For-Approval':     { label: 'For Approval',     cls: 'bg-amber-500/10 text-amber-300 border-amber-400/20' },
  'Approved':         { label: 'Approved',         cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-400/20' },
  'Issued-For-Construction': { label: 'IFC', cls: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30' },
};

const StatusBadge: React.FC<{ status: string | null }> = ({ status }) => {
  const key = status ?? 'Not Started';
  const cfg = DS_STATUS_CONFIG[key] ?? DS_STATUS_CONFIG['Not Started'];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
};

const StatusIcon: React.FC<{ status: string | null }> = ({ status }) => {
  if (!status || status === 'Not Started') return <Circle className="w-3 h-3 text-gray-700" />;
  if (status === 'Approved' || status === 'Issued-For-Construction') return <CheckCircle2 className="w-3 h-3 text-emerald-400" />;
  if (status === 'For-Approval') return <Clock className="w-3 h-3 text-amber-400" />;
  return <FileEdit className="w-3 h-3 text-gray-500" />;
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
interface DatasheetPageProps {
  jumpTo?: { instrumentId: string; projectId: string } | null;
  onJumpConsumed?: () => void;
}

const DatasheetPage: React.FC<DatasheetPageProps> = ({ jumpTo, onJumpConsumed }) => {
  const [projects,   setProjects]   = useState<Project[]>([]);
  const [projectId,  setProjectId]  = useState('');
  const [search,     setSearch]     = useState('');
  const [dsFilter,   setDsFilter]   = useState('');
  const [rows,       setRows]       = useState<InstrumentRow[]>([]);
  const [total,      setTotal]      = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [selected,   setSelected]   = useState<InstrumentRow | null>(null);
  const [viewTemplates, setViewTemplates] = useState(false);
  const [viewMode,      setViewMode]      = useState<'list' | 'grid'>('list');

  // load projects
  useEffect(() => {
    fetch(`${API}/api/v1/datasheet/projects`)
      .then(r => r.json())
      .then(d => {
        setProjects(d.projects ?? []);
        if (d.projects?.length) setProjectId(d.projects[0].project_id);
      })
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ project_id: projectId, page_size: '200' });
      if (search)   params.set('search',    search);
      if (dsFilter) params.set('ds_status', dsFilter);
      const r = await fetch(`${API}/api/v1/datasheet/instruments?${params}`);
      if (!r.ok) throw new Error(`Server ${r.status}`);
      const d = await r.json();
      setRows(d.data ?? []);
      setTotal(d.total ?? 0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [projectId, search, dsFilter]);

  useEffect(() => { load(); }, [load]);

  const pendingJumpId = useRef<string | null>(null);

  useEffect(() => {
    if (!jumpTo) return;
    pendingJumpId.current = jumpTo.instrumentId;
    setProjectId(jumpTo.projectId);
    setSearch('');
    setDsFilter('');
    onJumpConsumed?.();
  }, [jumpTo]);  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!pendingJumpId.current || !rows.length) return;
    const found = rows.find(r => r.id === pendingJumpId.current);
    if (found) {
      setSelected(found);
      pendingJumpId.current = null;
    }
  }, [rows]);

  const sectionLabel = 'text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600';

  if (viewTemplates) {
    return <SpecTemplateEditorPage onBack={() => setViewTemplates(false)} />;
  }

  if (selected) {
    return (
      <DatasheetEditorPage
        instrument={selected}
        projectId={projectId}
        onBack={() => { setSelected(null); load(); }}
        onManageTemplates={() => { setSelected(null); setViewTemplates(true); }}
      />
    );
  }

  // Stats
  const notStarted = rows.filter(r => !r.ds_status).length;
  const inProgress = rows.filter(r => r.ds_status && r.ds_status !== 'Approved' && r.ds_status !== 'Issued-For-Construction').length;
  const approved   = rows.filter(r => r.ds_status === 'Approved' || r.ds_status === 'Issued-For-Construction').length;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#09090c] text-gray-200">

      {/* Header */}
      <div className="shrink-0 border-b border-white/[0.06] bg-[#0d0d11] px-5 py-3">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-gray-400" />
          <h1 className="text-sm font-semibold text-white">Datasheet Generator</h1>
          <span className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-gray-500">
            Instrument Spec Sheets
          </span>

          {/* View toggle */}
          <div className="ml-3 flex items-center rounded-md border border-white/[0.08] overflow-hidden">
            {([['list', LayoutList, 'List'], ['grid', LayoutGrid, 'Grid']] as const).map(([mode, Icon, label]) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`flex items-center gap-1.5 h-6 px-2.5 text-[10px] transition-colors ${
                  viewMode === mode
                    ? 'bg-white/[0.1] text-white'
                    : 'text-gray-600 hover:text-gray-300'
                }`}
              >
                <Icon className="w-3 h-3" />{label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setViewTemplates(true)}
              className="flex items-center gap-1.5 h-7 px-3 rounded-md border border-white/[0.08] text-[11px] text-gray-500 hover:text-gray-200 hover:border-white/[0.16] transition-colors">
              <Settings2 className="w-3 h-3" /> Spec Templates
            </button>
          </div>
        </div>
      </div>

      {/* ── Grid view ──────────────────────────────────────────────────── */}
      {viewMode === 'grid' && (
        <div className="shrink-0 flex items-center gap-3 border-b border-white/[0.06] bg-[#0d0d11] px-5 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-600">Project</span>
          <select
            value={projectId}
            onChange={e => setProjectId(e.target.value)}
            className="h-7 rounded-md border border-white/[0.08] bg-black px-2.5 text-xs text-gray-200 outline-none focus:border-white/[0.18] min-w-[200px]"
          >
            {projects.length === 0 && <option value="">No projects yet</option>}
            {projects.map(p => (
              <option key={p.project_id} value={p.project_id}>
                {p.name || p.project_id}{p.project_no ? ` · ${p.project_no}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {viewMode === 'grid' ? (
        <div className="flex-1 overflow-hidden min-h-0">
          <DatasheetGridView
            projectId={projectId}
            onOpenEditor={(row: GridRow) => {
              setSelected({
                id:              row.id,
                tag_number:      row.tag_number,
                instrument_type: row.instrument_type,
                service:         row.service,
                line_tag:        (row.line_tag as string | null) ?? null,
                area_code:       (row.area_code as string | null) ?? null,
                inst_status:     (row.inst_status as string | null) ?? null,
                ds_status:       row.ds_status,
                ds_revision:     row.ds_revision,
                ds_updated_at:   null,
                ds_prepared_by:  null,
              });
            }}
          />
        </div>
      ) : (

      <div className="flex-1 overflow-y-auto xyra-scroll-contained">
        <div className="px-5 py-5 space-y-4 max-w-5xl mx-auto">

          {/* Controls row */}
          <div className="flex items-center gap-3 flex-wrap">
            {/* Project selector */}
            <div className="flex flex-col gap-1">
              <span className={sectionLabel}>Project</span>
              <select
                value={projectId}
                onChange={e => setProjectId(e.target.value)}
                className="h-8 rounded-md border border-white/[0.08] bg-black px-2.5 text-xs text-gray-200 outline-none focus:border-white/[0.18] min-w-[180px]"
              >
                {projects.length === 0 && <option value="">No projects yet</option>}
                {projects.map(p => (
                  <option key={p.project_id} value={p.project_id}>
                    {p.name || p.project_id}{p.project_no ? ` · ${p.project_no}` : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div className="flex flex-col gap-1">
              <span className={sectionLabel}>Search</span>
              <div className="flex items-center gap-2 h-8 rounded-md border border-white/[0.08] bg-black px-2.5">
                <Search className="w-3 h-3 text-gray-600 shrink-0" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Tag or service…"
                  className="bg-transparent text-xs text-gray-200 placeholder:text-gray-700 outline-none w-36"
                />
              </div>
            </div>

            {/* DS Status filter */}
            <div className="flex flex-col gap-1">
              <span className={sectionLabel}>Status</span>
              <select
                value={dsFilter}
                onChange={e => setDsFilter(e.target.value)}
                className="h-8 rounded-md border border-white/[0.08] bg-black px-2.5 text-xs text-gray-200 outline-none focus:border-white/[0.18]"
              >
                <option value="">All</option>
                <option value="Not Started">Not Started</option>
                <option value="Draft">Draft</option>
                <option value="For-Review">For Review</option>
                <option value="For-Approval">For Approval</option>
                <option value="Approved">Approved</option>
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <span className={sectionLabel}>&nbsp;</span>
              <button onClick={load}
                className="h-8 w-8 flex items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.03] text-gray-500 hover:text-gray-200 transition-colors">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Stats strip */}
          {rows.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Not Started', value: notStarted, cls: 'text-gray-500' },
                { label: 'In Progress', value: inProgress, cls: 'text-amber-400' },
                { label: 'Approved',    value: approved,   cls: 'text-emerald-400' },
              ].map(({ label, value, cls }) => (
                <div key={label} className="rounded-md border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                  <p className={`text-xl font-bold ${cls}`}>{value}</p>
                  <p className="text-[11px] text-gray-600 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-red-300 bg-red-500/10 border border-red-400/20 rounded-md px-3 py-2 text-xs">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />{error}
            </div>
          )}

          {/* Table */}
          <div className="rounded-md border border-white/[0.06] overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[2fr_1fr_2fr_1fr_1fr_auto] gap-0 bg-white/[0.02] border-b border-white/[0.06] px-4 py-2">
              {['Tag Number', 'Type', 'Service', 'Line', 'Spec Sheet', ''].map(h => (
                <span key={h} className="text-[10px] font-semibold uppercase tracking-[0.12em] text-gray-600">{h}</span>
              ))}
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-[11px] text-gray-600">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading instruments…
              </div>
            ) : rows.length === 0 ? (
              <div className="py-16 text-center">
                <FileText className="w-8 h-8 text-gray-700 mx-auto mb-3" />
                <p className="text-xs text-gray-500">
                  {projectId ? 'No instruments found. Extract a P&ID first to populate instruments.' : 'Select a project to begin.'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.03] max-h-[520px] overflow-y-auto xyra-scroll-contained">
                {rows.map(row => (
                  <button
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className="w-full grid grid-cols-[2fr_1fr_2fr_1fr_1fr_auto] gap-0 items-center px-4 py-2.5 hover:bg-white/[0.03] transition-colors text-left group"
                  >
                    <span className="font-mono text-xs font-medium text-white">{row.tag_number}</span>
                    <span className="text-[11px] text-gray-500 font-mono">{row.instrument_type}</span>
                    <span className="text-[11px] text-gray-400 truncate pr-2">{row.service ?? '—'}</span>
                    <span className="text-[11px] text-gray-600 font-mono truncate">{row.line_tag ?? '—'}</span>
                    <span className="flex items-center gap-1.5">
                      <StatusIcon status={row.ds_status} />
                      <StatusBadge status={row.ds_status} />
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-gray-700 group-hover:text-gray-400 transition-colors" />
                  </button>
                ))}
              </div>
            )}

            {!loading && rows.length > 0 && (
              <div className="border-t border-white/[0.04] px-4 py-2 flex items-center justify-between">
                <span className="text-[11px] text-gray-700">{total} instrument{total !== 1 ? 's' : ''}</span>
                <span className="text-[11px] text-gray-700">
                  {approved}/{total} approved
                </span>
              </div>
            )}
          </div>

        </div>
      </div>

      )} {/* end viewMode === 'list' */}
    </div>
  );
};

export default DatasheetPage;
