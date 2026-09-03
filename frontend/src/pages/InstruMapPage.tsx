import React, { useEffect, useRef, useState } from 'react';
import ProjectNavigator from '../components/workspace/ProjectNavigator';
import { DomainProvider, useDomain } from '../contexts/DomainContext';
import { ProjectProvider, useProject } from '../contexts/ProjectContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { WorkspaceProvider, useWorkspace } from '../contexts/WorkspaceContext';
import WorkflowHeader, { type WorkspaceView } from '../components/workspace/WorkflowHeader';
import FileTabs from '../components/workspace/FileTabs';
import PIDAnalyserPage from './pid/PIDAnalyserPage';
import DataEditorPage from './DataEditorPage';

// ── Inner shell ───────────────────────────────────────────────────────────────

const WorkspaceShell: React.FC = () => {
  const { pidFiles, loadFiles, clearFiles, isPreviewLoading } = useWorkspace();
  const { selected } = useDomain();
  const { project, setProject } = useProject();
  const [view, setView] = useState<WorkspaceView>('pid');
  const [extractedCount, setExtractedCount] = useState<number | null>(null);
  const [referenceReady, setReferenceReady] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previousUnitRef = useRef(selected.unit.id);

  const openFiles = () => {
    setView('pid');
    fileInputRef.current?.click();
  };

  useEffect(() => {
    setProject({
      ...project,
      project_name: selected.project.name,
      project_no: selected.projectId,
      location: `${selected.plant.name} / ${selected.area.name} / ${selected.unit.name}`,
    });
    // selected domain is the source of truth for extraction scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected.projectId, selected.project.name, selected.plant.name, selected.area.name, selected.unit.name]);

  useEffect(() => {
    if (previousUnitRef.current === selected.unit.id) return;
    previousUnitRef.current = selected.unit.id;
    setExtractedCount(null);
    setReferenceReady(false);
    setView('pid');
    clearFiles();
  }, [clearFiles, selected.unit.id]);

  useEffect(() => {
    if (!pidFiles.length) {
      setExtractedCount(null);
      setReferenceReady(false);
    }
  }, [pidFiles.length]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length) {
      setExtractedCount(null);
      setReferenceReady(false);
      setView('pid');
      loadFiles(files);
    }
    e.target.value = '';
  };

  const handleDropFiles = (files: File[]) => {
    setExtractedCount(null);
    setReferenceReady(false);
    setView('pid');
    loadFiles(files);
  };

  const handleExtractionComplete = (instrumentCount: number) => {
    setExtractedCount(instrumentCount);
    setView('data-editor');
  };

  return (
    <div className="tpi-app h-full flex flex-col overflow-hidden">

      {/* ── Workspace bar — full width, above everything ── */}
      <WorkflowHeader
        view={view}
        onViewChange={setView}
        selectedPath={selected.displayPath}
        onOpenFiles={openFiles}
        openFilesDisabled={isPreviewLoading}
        pidFileCount={pidFiles.length}
        extractionComplete={extractedCount !== null}
        referenceReady={referenceReady}
      />

      {/* ── Main row ── */}
      <div className="flex-1 flex overflow-hidden min-h-0">

        <ProjectNavigator />

        {/* ── Editor area ── */}
        {view === 'data-editor' ? (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <DataEditorPage />
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden min-w-0">
            <FileTabs onOpenFiles={openFiles} />
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
              <PIDAnalyserPage
                areaCode={selected.areaCode}
                onOpenFiles={openFiles}
                onDropFiles={handleDropFiles}
                onExtractionComplete={handleExtractionComplete}
                onReferenceChange={setReferenceReady}
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
      <DomainProvider>
        <WorkspaceProvider>
          <WorkspaceShell />
        </WorkspaceProvider>
      </DomainProvider>
    </ProjectProvider>
  </ThemeProvider>
);

export default InstruMapPage;
