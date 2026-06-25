import React from 'react';
import { Activity, TableProperties } from 'lucide-react';

export type WorkspaceView = 'pid' | 'aigrid';

interface ActivityBarProps {
  view: WorkspaceView;
  onViewChange: (v: WorkspaceView) => void;
}

type ToolItem = { kind: 'tool'; view: WorkspaceView; icon: React.ElementType; label: string };

const TOOLS: ToolItem[] = [
  { kind: 'tool', view: 'pid',    icon: Activity,        label: 'Instrumentation' },
  { kind: 'tool', view: 'aigrid', icon: TableProperties, label: 'AI Grid' },
];

const ActivityBar: React.FC<ActivityBarProps> = ({ view, onViewChange }) => (
  <div className="w-12 shrink-0 flex flex-col items-center bg-[#0c0c0e] border-r border-white/[0.05] select-none py-2">
    <nav className="flex-1 flex flex-col items-center gap-0.5 w-full px-1">
      {TOOLS.map(item => (
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
      ))}
    </nav>
  </div>
);

export default ActivityBar;
