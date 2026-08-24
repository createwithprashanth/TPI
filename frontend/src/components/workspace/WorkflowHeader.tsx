import React from 'react';
import { Check, Database, FileUp, Rows3 } from 'lucide-react';
import type { WorkspaceView } from './ActivityBar';

interface WorkflowHeaderProps {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  selectedPath: string;
  onOpenFiles: () => void;
  openFilesDisabled?: boolean;
  pidFileCount?: number;
  extractionComplete?: boolean;
  referenceReady?: boolean;
}

const WorkflowHeader: React.FC<WorkflowHeaderProps> = ({
  view,
  onViewChange,
  selectedPath,
  onOpenFiles,
  openFilesDisabled = false,
  pidFileCount = 0,
  extractionComplete = false,
  referenceReady = false,
}) => {
  const currentAction = extractionComplete
    ? 'Review and correct rows in TDE'
    : pidFileCount > 0
      ? referenceReady
        ? 'Extract selected drawing to TDE'
        : 'Click one instrument bubble on the drawing'
      : 'Upload a P&ID into the selected unit';

  const steps = [
    { label: 'Unit', done: true, active: false },
    { label: 'P&ID', done: pidFileCount > 0, active: view === 'pid' && pidFileCount === 0 },
    { label: 'Extract', done: extractionComplete, active: view === 'pid' && pidFileCount > 0 && !extractionComplete },
    { label: 'TDE', done: false, active: view === 'aigrid' },
  ];

  return (
  <header className="shrink-0 border-b border-[#d4dbe3] bg-white text-[#1f2933]">
    <div className="flex h-16 items-center gap-4 px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <img src="/Bilfinger_log.png" alt="" className="h-7 w-7 object-contain" />
        <div className="min-w-0">
          <div className="text-sm font-semibold">Instrumentation Data Builder</div>
          <div className="truncate text-xs text-[#64748b]" title={selectedPath}>
            {selectedPath}
          </div>
        </div>
      </div>

      <div className="hidden min-w-0 items-center gap-1 rounded border border-[#d4dbe3] bg-[#f8fafc] px-2 py-1.5 lg:flex">
        {steps.map((step, index) => (
          <React.Fragment key={step.label}>
            <div
              className={`flex h-7 items-center gap-1.5 rounded px-2 text-xs font-semibold ${
                step.active
                  ? 'bg-white text-[#0f5f99] shadow-sm'
                  : step.done
                    ? 'text-[#1f7a4d]'
                    : 'text-[#64748b]'
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${
                  step.done
                    ? 'border-[#1f9d61] bg-[#e7f7ef] text-[#167246]'
                    : step.active
                      ? 'border-[#0f5f99] bg-[#eaf4fb] text-[#0f5f99]'
                      : 'border-[#cbd5e1] text-[#94a3b8]'
                }`}
              >
                {step.done ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              {step.label}
            </div>
            {index < steps.length - 1 && <span className="text-[#cbd5e1]">/</span>}
          </React.Fragment>
        ))}
      </div>

      <div className="hidden min-w-[220px] max-w-[360px] rounded border border-[#d4dbe3] bg-[#f8fafc] px-3 py-2 xl:block">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[#64748b]">Next</div>
        <div className="truncate text-xs font-semibold text-[#0f3554]" title={currentAction}>
          {currentAction}
        </div>
      </div>

      <div className="flex h-9 rounded border border-[#d4dbe3] bg-[#f8fafc] p-0.5">
        <button
          onClick={() => onViewChange('pid')}
          className={`flex items-center gap-2 rounded px-3 text-sm font-medium ${
            view === 'pid' ? 'bg-white text-[#0f5f99] shadow-sm' : 'text-[#64748b] hover:text-[#1f2933]'
          }`}
        >
          <FileUp className="h-4 w-4" />
          P&ID Extraction
        </button>
        <button
          onClick={() => onViewChange('aigrid')}
          className={`flex items-center gap-2 rounded px-3 text-sm font-medium ${
            view === 'aigrid' ? 'bg-white text-[#0f5f99] shadow-sm' : 'text-[#64748b] hover:text-[#1f2933]'
          }`}
        >
          <Rows3 className="h-4 w-4" />
          TDE
        </button>
      </div>

      <button
        onClick={onOpenFiles}
        disabled={openFilesDisabled}
        className="flex h-9 items-center gap-2 rounded bg-[#0f5f99] px-4 text-sm font-semibold text-white hover:bg-[#0b4f80] disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Database className="h-4 w-4" />
        {pidFileCount ? 'Change P&ID' : 'Upload P&ID'}
      </button>
    </div>
  </header>
  );
};

export default WorkflowHeader;
