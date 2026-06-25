import React, { useRef, useState } from 'react';
import { ProjectProvider } from '../contexts/ProjectContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { WorkspaceProvider, useWorkspace } from '../contexts/WorkspaceContext';
import WorkspaceBar from '../components/workspace/WorkspaceBar';
import ActivityBar from '../components/workspace/ActivityBar';
import FileTabs from '../components/workspace/FileTabs';
import type { WorkspaceView } from '../components/workspace/ActivityBar';
import PIDAnalyserPage from './pid/PIDAnalyserPage';
import AiGridPage from './AiGridPage';

const TOOL_LABELS: Record<WorkspaceView, string> = {
  pid:    'Instrumentation',
  aigrid: 'AI Grid',
};

// ── Inner shell ───────────────────────────────────────────────────────────────

const WorkspaceShell: React.FC = () => {
  const { loadFiles, isPreviewLoading } = useWorkspace();
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
    <div className="tpi-app h-full flex flex-col bg-[#0c0c0e] overflow-hidden">

      {/* ── Workspace bar — full width, above everything ── */}
      <WorkspaceBar
        toolLabel={TOOL_LABELS[view]}
        showAreaCode={view === 'pid'}
        areaCode={areaCode}
        onAreaCodeChange={setAreaCode}
        onOpenFiles={view === 'aigrid' ? undefined : openFiles}
        openFilesDisabled={isPreviewLoading}
      />

      {/* ── Main row ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        {/* Activity bar */}
        <ActivityBar view={view} onViewChange={setView} />

        {/* ── Editor area ── */}
        {view === 'aigrid' ? (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <AiGridPage />
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <FileTabs onOpenFiles={openFiles} />
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <PIDAnalyserPage
                areaCode={areaCode}
                onOpenFiles={openFiles}
                onDropFiles={handleDropFiles}
              />
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
  <ThemeProvider>
    <ProjectProvider>
      <WorkspaceProvider>
        <WorkspaceShell />
      </WorkspaceProvider>
    </ProjectProvider>
  </ThemeProvider>
);

export default InstruMapPage;
