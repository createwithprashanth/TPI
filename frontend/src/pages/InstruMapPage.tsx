/**
 * InstruMap workspace shell.
 * Owns: layout, routing between products, file input, top bar.
 * All product logic lives in pages/pid/, pages/mto/, pages/precisionpdf/.
 * To add a new product: create a page, add a NAV_ITEM in WorkspaceSidebar.
 */
import React, { useRef, useState, Suspense, lazy } from 'react';
import { FolderOpen, X } from 'lucide-react';
import { ProjectProvider } from '../contexts/ProjectContext';
import { WorkspaceProvider, useWorkspace } from '../contexts/WorkspaceContext';
import WorkspaceSidebar, { type WorkspaceView } from '../components/workspace/WorkspaceSidebar';
import FileNavigator from '../components/workspace/FileNavigator';
import PIDAnalyserPage from './pid/PIDAnalyserPage';
import PipingMTOPage from './mto/PipingMTOPage';

const PrecisionPDFPage = lazy(() => import('./PrecisionPDFPage'));

// ── Inner shell (needs WorkspaceContext) ──────────────────────────────────────

const WorkspaceShell: React.FC = () => {
  const { pidFiles, loadFiles, clearFiles, isPreviewLoading } = useWorkspace();
  const [view, setView] = useState<WorkspaceView>('pid');
  const [areaCode, setAreaCode] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) loadFiles(files);
    e.target.value = '';
  };

  const openFiles = () => fileInputRef.current?.click();

  const handleViewChange = (v: WorkspaceView) => setView(v);

  const truncate = (name: string, max = 36) =>
    name.length > max ? `${name.slice(0, max - 1)}…` : name;

  return (
    <div className="h-full flex bg-gray-950 overflow-hidden">
      {/* ── Sidebar ── */}
      <WorkspaceSidebar view={view} onViewChange={handleViewChange} />

      {/* ── Main area ── */}
      {view === 'precisionpdf' ? (
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={<div className="flex h-full items-center justify-center bg-slate-900"><span className="text-sm text-slate-400">Loading…</span></div>}>
            <PrecisionPDFPage />
          </Suspense>
        </div>
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Top bar */}
          <div className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-white/[0.06] bg-gray-950 z-20">
            <div className="flex items-center gap-2.5">
              <span className="text-white font-semibold text-sm tracking-tight">
                {view === 'pid' ? 'P&ID Analyser' : 'Piping MTO'}
              </span>
              {pidFiles.length === 1 && (
                <span className="text-[11px] text-gray-500 bg-white/[0.06] px-2 py-0.5 rounded-full max-w-[220px] truncate">
                  {truncate(pidFiles[0].name)}
                </span>
              )}
              {pidFiles.length > 1 && (
                <span className="text-[11px] text-gray-500 bg-white/[0.06] px-2 py-0.5 rounded-full">
                  {pidFiles.length} files
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {view === 'pid' && (
                <input
                  type="text" value={areaCode} onChange={e => setAreaCode(e.target.value)}
                  placeholder="Area code"
                  className="h-8 w-28 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-xs text-white placeholder:text-gray-500 outline-none transition-colors focus:border-white/[0.16]"
                />
              )}
              <button
                onClick={openFiles}
                className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 bg-white hover:bg-gray-100 px-3 py-1.5 rounded-md transition-colors"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Open Files
              </button>
              {pidFiles.length > 0 && !isPreviewLoading && (
                <button
                  onClick={clearFiles}
                  className="flex items-center justify-center w-7 h-7 rounded-md text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                  title="Close drawings"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* File navigator (shared across products) */}
          <FileNavigator />

          {/* Active product */}
          {view === 'pid' && <PIDAnalyserPage areaCode={areaCode} onOpenFiles={openFiles} />}
          {view === 'piping' && <PipingMTOPage onOpenFiles={openFiles} />}
        </div>
      )}

      <input
        ref={fileInputRef} type="file" accept=".pdf" multiple
        onChange={handleFileChange} className="hidden"
      />
    </div>
  );
};

// ── Root: wrap with context providers ────────────────────────────────────────

const InstruMapPage: React.FC = () => (
  <ProjectProvider>
    <WorkspaceProvider>
      <WorkspaceShell />
    </WorkspaceProvider>
  </ProjectProvider>
);

export default InstruMapPage;
