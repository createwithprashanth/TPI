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
  { kind: 'tool', view: 'aigrid', icon: TableProperties, label: 'TDE' },
];

const ActivityBar: React.FC<ActivityBarProps> = ({ view, onViewChange }) => (
  <div className="w-12 shrink-0 flex flex-col items-center bg-[#e7e7e7] border-r border-[#a8a8a8] select-none py-2">
    <nav className="flex-1 flex flex-col items-center gap-0.5 w-full px-1">
      {TOOLS.map(item => (
        <button
          key={item.view}
          title={item.label}
          onClick={() => onViewChange(item.view)}
          className={`relative w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-150 ${
            view === item.view
              ? 'text-[#114f86] bg-white border border-[#a8c6dc]'
              : 'text-gray-600 hover:text-black hover:bg-white'
          }`}
        >
          {view === item.view && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[#2d76b8] rounded-r-full" />
          )}
          <item.icon className="w-[18px] h-[18px]" strokeWidth={1.75} />
        </button>
      ))}
    </nav>
  </div>
);

export default ActivityBar;
