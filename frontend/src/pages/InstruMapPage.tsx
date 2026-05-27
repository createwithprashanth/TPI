import React, { useRef, useState, Suspense, lazy } from 'react';
import { ProjectProvider } from '../contexts/ProjectContext';
import { WorkspaceProvider, useWorkspace } from '../contexts/WorkspaceContext';
import WorkspaceBar from '../components/workspace/WorkspaceBar';
import ActivityBar from '../components/workspace/ActivityBar';
import FileTabs from '../components/workspace/FileTabs';
import Breadcrumb from '../components/workspace/Breadcrumb';
import type { WorkspaceView } from '../components/workspace/WorkspaceSidebar';
import PIDAnalyserPage from './pid/PIDAnalyserPage';
import PipingMTOPage from './mto/PipingMTOPage';

const PrecisionPDFPage = lazy(() => import('./PrecisionPDFPage'));

const TOOL_LABELS: Record<WorkspaceView, string> = {
  pid: 'Instrumentation',
  piping: 'Piping MTO',
  precisionpdf: 'PrecisionPDF',
};

// ── Inner shell ───────────────────────────────────────────────────────────────

const WorkspaceShell: React.FC = () => {
  const { pidFiles, loadFiles, isPreviewLoading } = useWorkspace();
  const [view, setView] = useState<WorkspaceView>('pid');
  const [areaCode, setAreaCode] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openFiles = () => fileInputRef.current?.click();

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) loadFiles(files);
    e.target.value = '';
  };

  const handleDropFiles = (files: File[]) => loadFiles(files);

  const currentFile = pidFiles[0] ?? null;

  const breadcrumbItems = [
    { label: 'XYRA Studio', dim: true },
    { label: TOOL_LABELS[view] },
    ...(currentFile && view !== 'precisionpdf' ? [{ label: currentFile.name }] : []),
  ];

  return (
    <div className="h-full flex flex-col bg-[#0c0c0e] overflow-hidden">

      {/* ── Workspace bar — full width, above everything ── */}
      <WorkspaceBar />

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
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">

            {/* Tool top bar */}
            <div className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-white/[0.05] bg-[#0c0c0e]">
              <span className="text-[13px] font-semibold text-white tracking-tight">
                {TOOL_LABELS[view]}
              </span>

              <div className="flex items-center gap-2">
                {view === 'pid' && (
                  <input
                    type="text"
                    value={areaCode}
                    onChange={e => setAreaCode(e.target.value)}
                    placeholder="Area code"
                    className="h-7 w-28 rounded-md border border-white/[0.07] bg-white/[0.04] px-2.5 text-xs text-white placeholder:text-gray-600 outline-none focus:border-white/[0.15] transition-colors"
                  />
                )}
                <button
                  onClick={openFiles}
                  disabled={isPreviewLoading}
                  className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 bg-white hover:bg-gray-100 disabled:opacity-50 px-3 py-1.5 rounded-md transition-colors"
                >
                  Open Files
                </button>
              </div>
            </div>

            {/* File tabs */}
            <FileTabs onOpenFiles={openFiles} />

            {/* Breadcrumb */}
            <Breadcrumb items={breadcrumbItems} />

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
    </div>
  );
};

// ── Root ──────────────────────────────────────────────────────────────────────

const InstruMapPage: React.FC = () => (
  <ProjectProvider>
    <WorkspaceProvider>
      <WorkspaceShell />
    </WorkspaceProvider>
  </ProjectProvider>
);

export default InstruMapPage;
