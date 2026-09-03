import React from 'react';
import { Check, Database, FileUp, Rows3, ShieldCheck, Sparkles } from 'lucide-react';

export type WorkspaceView = 'pid' | 'data-editor';

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
    ? 'Review and correct rows in Data Editor'
    : pidFileCount > 0
      ? referenceReady
        ? 'Extract selected drawing to Data Editor'
        : 'Click one instrument bubble on the drawing'
      : 'Upload a P&ID into the selected unit';

  const steps = [
    { label: 'Unit', done: true, active: false },
    { label: 'P&ID', done: pidFileCount > 0, active: view === 'pid' && pidFileCount === 0 },
    { label: 'Extract', done: extractionComplete, active: view === 'pid' && pidFileCount > 0 && !extractionComplete },
    { label: 'Data Editor', done: false, active: view === 'data-editor' },
  ];

  return (
  <header className="tpi-command-header relative z-20 shrink-0 text-slate-900">
    <div className="flex h-[72px] items-center gap-4 px-5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <div className="tpi-brand-mark">
          <img src="/Bilfinger_log.png" alt="" className="h-7 w-7 object-contain" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold tracking-[-0.01em]">Instrumentation Data Builder</span>
            <span className="hidden rounded-full border border-sky-200 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-sky-700 xl:inline">Workspace</span>
          </div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500" title={selectedPath}>
            {selectedPath}
          </div>
        </div>
      </div>

      <div className="hidden min-w-0 items-center gap-1 rounded-xl border border-slate-200 p-1 lg:flex">
        {steps.map((step, index) => (
          <React.Fragment key={step.label}>
            <div
              className={`flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-all ${
                step.active
                  ? 'text-sky-700 shadow-sm ring-1 ring-slate-200'
                  : step.done
                    ? 'text-emerald-700'
                    : 'text-slate-500'
              }`}
            >
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full border text-[10px] ${
                  step.done
                    ? 'border-emerald-300 text-emerald-700'
                    : step.active
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-700'
                      : 'border-slate-300 text-slate-500'
                }`}
              >
                {step.done ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              {step.label}
            </div>
            {index < steps.length - 1 && <span className="text-slate-300">/</span>}
          </React.Fragment>
        ))}
      </div>

      <div className="hidden min-w-[220px] max-w-[340px] rounded-xl border border-slate-200 px-3 py-2 xl:block">
        <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-sky-700"><Sparkles className="h-3 w-3" /> Next action</div>
        <div className="mt-0.5 truncate text-[11px] font-medium text-slate-700" title={currentAction}>
          {currentAction}
        </div>
      </div>

      <div className="flex h-10 rounded-xl border border-slate-200 p-1">
        <button
          onClick={() => onViewChange('pid')}
          className={`flex items-center gap-2 rounded px-3 text-sm font-medium ${
            view === 'pid' ? 'text-sky-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <FileUp className="h-4 w-4" />
          P&ID Extraction
        </button>
        <button
          onClick={() => onViewChange('data-editor')}
          className={`flex items-center gap-2 rounded px-3 text-sm font-medium ${
            view === 'data-editor' ? 'text-sky-700 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-900'
          }`}
        >
          <Rows3 className="h-4 w-4" />
          Data Editor
        </button>
      </div>

      <button
        onClick={onOpenFiles}
        disabled={openFilesDisabled}
        className="tpi-primary-action flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Database className="h-4 w-4" />
        {pidFileCount ? 'Change P&ID' : 'Upload P&ID'}
      </button>
      <div className="hidden items-center gap-1.5 rounded-full border border-emerald-200 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 2xl:flex">
        <ShieldCheck className="h-3.5 w-3.5" /> Local & secure
      </div>
    </div>
  </header>
  );
};

export default WorkflowHeader;
