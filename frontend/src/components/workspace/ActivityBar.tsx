import React from 'react';
import {
  Activity, Layers, BookOpen, TableProperties, Gauge,
  Database, GitCompare, Layers3, GitBranch, LibraryBig,
} from 'lucide-react';
import type { WorkspaceView } from './WorkspaceSidebar';

interface ActivityBarProps {
  view: WorkspaceView;
  onViewChange: (v: WorkspaceView) => void;
}

type ToolItem =
  | { kind: 'tool'; view: WorkspaceView; icon: React.ElementType; label: string }
  | { kind: 'divider' };

const TOOLS: ToolItem[] = [
  // ── Instrument workflow ────────────────────────────────────────────────────
  { kind: 'tool', view: 'pid',          icon: Activity,        label: 'Instrumentation' },
  { kind: 'tool', view: 'aigrid',       icon: TableProperties, label: 'AI Grid' },
  { kind: 'tool', view: 'datasheet',    icon: Layers3,         label: 'Datasheet' },
  { kind: 'tool', view: 'flowsizing',   icon: Gauge,           label: 'FlowSizing' },
  { kind: 'tool', view: 'cne',          icon: GitBranch,       label: 'C&E Matrix' },
  { kind: 'divider' },
  // ── Piping ────────────────────────────────────────────────────────────────
  { kind: 'tool', view: 'piping',       icon: Layers,          label: 'Piping MTO' },
  { kind: 'divider' },
  // ── Reference & docs ──────────────────────────────────────────────────────
  { kind: 'tool', view: 'knowledge',    icon: LibraryBig,      label: 'Project Knowledge' },
  { kind: 'tool', view: 'precisionpdf', icon: BookOpen,        label: 'PrecisionPDF' },
  { kind: 'divider' },
  // ── Data ops ──────────────────────────────────────────────────────────────
  { kind: 'tool', view: 'datapump',     icon: Database,        label: 'DataPump' },
  { kind: 'tool', view: 'datadiff',     icon: GitCompare,      label: 'DataDiff' },
];

const ActivityBar: React.FC<ActivityBarProps> = ({ view, onViewChange }) => (
  <div className="w-12 shrink-0 flex flex-col items-center bg-[#0c0c0e] border-r border-white/[0.05] select-none py-2">
    <nav className="flex-1 flex flex-col items-center gap-0.5 w-full px-1">
      {TOOLS.map((item, i) =>
        item.kind === 'divider' ? (
          <div key={`d-${i}`} className="w-6 h-px bg-white/[0.06] my-1" />
        ) : (
          <button
            key={item.view}
            title={item.label}
            onClick={() => onViewChange(item.view)}
            className={`relative w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-150 ${
              view === item.view
                ? 'text-white bg-white/[0.08]'
                : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.04]'
            }`}
          >
            {view === item.view && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-white/60 rounded-r-full" />
            )}
            <item.icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
          </button>
        )
      )}
    </nav>
  </div>
);

export default ActivityBar;
