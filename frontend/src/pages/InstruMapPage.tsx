import React, { useRef, useState, useEffect, Suspense, lazy } from 'react';
import { Search, Loader2 } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

// ── Global Tag Search modal ───────────────────────────────────────────────────

interface TagResult {
  id: string;
  tag_number: string;
  instrument_type: string;
  service: string | null;
}

interface SearchProject { project_id: string; name: string | null }

const GlobalTagSearch: React.FC<{
  onClose: () => void;
  onSelect: (instrumentId: string, projectId: string) => void;
}> = ({ onClose, onSelect }) => {
  const [query,     setQuery]     = useState('');
  const [projects,  setProjects]  = useState<SearchProject[]>([]);
  const [projectId, setProjectId] = useState('');
  const [results,   setResults]   = useState<TagResult[]>([]);
  const [loading,   setLoading]   = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    fetch(`${API}/api/v1/datasheet/projects`)
      .then(r => r.json())
      .then(d => {
        const list: SearchProject[] = d.projects ?? [];
        setProjects(list);
        if (list.length) setProjectId(list[0].project_id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!query.trim() || !projectId) { setResults([]); return; }
    setLoading(true);
    const p = new URLSearchParams({ project_id: projectId, search: query, page_size: '15' });
    fetch(`${API}/api/v1/datasheet/instruments?${p}`)
      .then(r => r.json())
      .then(d => setResults(d.data ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [query, projectId]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-white/[0.12] bg-[#111114] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-gray-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search tag number or service…"
            className="flex-1 bg-transparent text-sm text-gray-100 outline-none placeholder:text-gray-600"
          />
          {loading
            ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-gray-600" />
            : <kbd className="rounded border border-white/[0.08] px-1.5 py-0.5 text-[10px] text-gray-600">Esc</kbd>
          }
        </div>
        {projects.length > 1 && (
          <div className="flex items-center gap-2 border-b border-white/[0.06] bg-[#0d0d10] px-4 py-1.5">
            <span className="text-[10px] text-gray-600">Project</span>
            <select
              value={projectId}
              onChange={e => setProjectId(e.target.value)}
              className="h-6 rounded border border-white/[0.08] bg-black px-1.5 text-[11px] text-gray-300 outline-none"
            >
              {projects.map(p => (
                <option key={p.project_id} value={p.project_id}>
                  {p.name ?? p.project_id}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="max-h-80 overflow-y-auto">
          {!query && (
            <div className="py-6 text-center text-xs text-gray-700">
              Type a tag number or service description
            </div>
          )}
          {query && !loading && results.length === 0 && (
            <div className="py-8 text-center text-sm text-gray-600">No instruments found</div>
          )}
          {results.map(r => (
            <button
              key={r.id}
              onClick={() => { onSelect(r.id, projectId); onClose(); }}
              className="flex w-full items-start gap-3 border-b border-white/[0.04] px-4 py-2.5
                text-left transition-colors last:border-b-0 hover:bg-white/[0.04]"
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-semibold text-white">{r.tag_number}</div>
                <div className="truncate text-[11px] text-gray-500">{r.service ?? '—'}</div>
              </div>
              <span className="ml-auto shrink-0 rounded bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] text-gray-400">
                {r.instrument_type}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
import { ProjectProvider } from '../contexts/ProjectContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { WorkspaceProvider, useWorkspace } from '../contexts/WorkspaceContext';
import WorkspaceBar from '../components/workspace/WorkspaceBar';
import ActivityBar from '../components/workspace/ActivityBar';
import FileTabs from '../components/workspace/FileTabs';
import SystemHealthDashboard from '../components/workspace/SystemHealthDashboard';
import type { WorkspaceView } from '../components/workspace/WorkspaceSidebar';
import PIDAnalyserPage from './pid/PIDAnalyserPage';
import PipingMTOPage from './mto/PipingMTOPage';
import AiGridPage from './AiGridPage';
import FlowSizingStudioPage from './FlowSizingStudioPage';
import DataPumpPage from './DataPumpPage';
import DataDiffPage from './DataDiffPage';
import DatasheetPage from './DatasheetPage';
import CauseEffectPage from './CauseEffectPage';
import ProjectKnowledgePage from './ProjectKnowledgePage';

const PrecisionPDFPage = lazy(() => import('./PrecisionPDFPage'));

const TOOL_LABELS: Record<WorkspaceView, string> = {
  pid:         'Instrumentation',
  piping:      'Piping MTO',
  precisionpdf:'PrecisionPDF',
  knowledge:   'Project Knowledge',
  aigrid:      'AI Grid',
  flowsizing:  'FlowSizing',
  datapump:    'DataPump',
  datadiff:    'DataDiff',
  datasheet:   'Datasheet',
  cne:         'C&E Matrix',
};

// ── Inner shell ───────────────────────────────────────────────────────────────

const WorkspaceShell: React.FC = () => {
  const { pidFiles, loadFiles, isPreviewLoading } = useWorkspace();
  const [view, setView] = useState<WorkspaceView>('pid');
  const [areaCode, setAreaCode] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tagSearchOpen, setTagSearchOpen] = useState(false);
  const [jumpTo, setJumpTo] = useState<{ instrumentId: string; projectId: string } | null>(null);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setTagSearchOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const openFiles = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) loadFiles(files);
    e.target.value = '';
  };

  const handleDropFiles = (files: File[]) => loadFiles(files);

  return (
    <div className="xyra-app h-full flex flex-col bg-[#0c0c0e] overflow-hidden">

      {/* ── Workspace bar — full width, above everything ── */}
      <WorkspaceBar
        toolLabel={TOOL_LABELS[view]}
        showAreaCode={view === 'pid'}
        areaCode={areaCode}
        onAreaCodeChange={setAreaCode}
        onOpenFiles={view === 'precisionpdf' || view === 'knowledge' || view === 'aigrid' || view === 'datapump' || view === 'datadiff' || view === 'datasheet' || view === 'cne' ? undefined : openFiles}
        openFilesDisabled={isPreviewLoading}
      />

      {/* ── Main row ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* Activity bar */}
        <ActivityBar view={view} onViewChange={setView} />

        {/* ── Editor area ── */}
        {view === 'precisionpdf' ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            <Suspense fallback={
              <div className="flex h-full items-center justify-center bg-[#111114]">
                <span className="text-sm text-gray-600">Loading…</span>
              </div>
            }>
              <PrecisionPDFPage />
            </Suspense>
          </div>
        ) : view === 'aigrid' ? (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <AiGridPage />
          </div>
        ) : view === 'knowledge' ? (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <ProjectKnowledgePage />
          </div>
        ) : view === 'flowsizing' ? (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <FlowSizingStudioPage />
          </div>
        ) : view === 'datapump' ? (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <DataPumpPage />
          </div>
        ) : view === 'datadiff' ? (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <DataDiffPage />
          </div>
        ) : view === 'datasheet' ? (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <DatasheetPage jumpTo={jumpTo} onJumpConsumed={() => setJumpTo(null)} />
          </div>
        ) : view === 'cne' ? (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <CauseEffectPage />
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">

            {/* File tabs */}
            <FileTabs onOpenFiles={openFiles} />

            {/* Active product */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              {view === 'pid' && (
                <PIDAnalyserPage
                  areaCode={areaCode}
                  onOpenFiles={openFiles}
                  onDropFiles={handleDropFiles}
                />
              )}
              {view === 'piping' && (
                <PipingMTOPage
                  onOpenFiles={openFiles}
                  onDropFiles={handleDropFiles}
                />
              )}
            </div>

          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        multiple
        onChange={handleFileChange}
        className="hidden"
      />

      {/* System health — fixed overlay, independent of layout */}
      <SystemHealthDashboard />

      {/* Cmd+K Global Tag Search */}
      {tagSearchOpen && (
        <GlobalTagSearch
          onClose={() => setTagSearchOpen(false)}
          onSelect={(instrumentId, projectId) => {
            setJumpTo({ instrumentId, projectId });
            setView('datasheet');
          }}
        />
      )}
    </div>
  );
};

// ── Root ──────────────────────────────────────────────────────────────────────

const InstruMapPage: React.FC = () => (
  <ThemeProvider>
    <ProjectProvider>
      <WorkspaceProvider>
        <WorkspaceShell />
      </WorkspaceProvider>
    </ProjectProvider>
  </ThemeProvider>
);

export default InstruMapPage;
