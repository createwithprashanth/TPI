import React from 'react';
import { Activity, Layers, BookOpen } from 'lucide-react';
import type { WorkspaceView } from './WorkspaceSidebar';

interface ActivityBarProps {
  view: WorkspaceView;
  onViewChange: (v: WorkspaceView) => void;
}

const TOOLS: { view: WorkspaceView; icon: React.ElementType; label: string }[] = [
  { view: 'pid',          icon: Activity, label: 'Instrumentation' },
  { view: 'piping',       icon: Layers,   label: 'Piping MTO' },
  { view: 'precisionpdf', icon: BookOpen, label: 'PrecisionPDF' },
];

const ActivityBar: React.FC<ActivityBarProps> = ({ view, onViewChange }) => (
  <div className="w-12 shrink-0 flex flex-col items-center bg-[#0c0c0e] border-r border-white/[0.05] select-none py-2">
    <nav className="flex-1 flex flex-col items-center gap-0.5 w-full px-1">
      {TOOLS.map(({ view: v, icon: Icon, label }) => (
        <button
          key={v}
          title={label}
          onClick={() => onViewChange(v)}
          className={`relative w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-150 ${
            view === v
              ? 'text-white bg-white/[0.08]'
              : 'text-gray-500 hover:text-gray-200 hover:bg-white/[0.04]'
          }`}
        >
          {view === v && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-white/60 rounded-r-full" />
          )}
          <Icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </button>
      ))}
    </nav>
  </div>
);

export default ActivityBar;
