import React, { useRef, useState, Suspense, lazy } from 'react';
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

const PrecisionPDFPage = lazy(() => import('./PrecisionPDFPage'));

const TOOL_LABELS: Record<WorkspaceView, string> = {
  pid: 'Instrumentation',
  piping: 'Piping MTO',
  precisionpdf: 'PrecisionPDF',
  aigrid: 'AI Grid',
  flowsizing: 'FlowSizing',
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

  return (
    <div className="xyra-app h-full flex flex-col bg-[#0c0c0e] overflow-hidden">

      {/* ── Workspace bar — full width, above everything ── */}
      <WorkspaceBar
        toolLabel={TOOL_LABELS[view]}
        showAreaCode={view === 'pid'}
        areaCode={areaCode}
        onAreaCodeChange={setAreaCode}
        onOpenFiles={view === 'precisionpdf' || view === 'aigrid' ? undefined : openFiles}
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
        ) : view === 'flowsizing' ? (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <FlowSizingStudioPage />
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
