import React, { useRef, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import { useWorkspace } from '../../contexts/WorkspaceContext';

interface FileTabsProps {
  onOpenFiles: () => void;
}

const truncateName = (name: string, max = 22) =>
  name.length > max ? `${name.slice(0, max - 1)}…` : name;

const FileTabs: React.FC<FileTabsProps> = ({ onOpenFiles }) => {
  const { pidFiles, currentPidIndex, setCurrentPidIndex, closeFile } = useWorkspace();
  const tabsRef = useRef<HTMLDivElement>(null);

  // Scroll active tab into view when it changes
  useEffect(() => {
    const container = tabsRef.current;
    if (!container) return;
    const activeTab = container.querySelector('[data-active="true"]') as HTMLElement | null;
    activeTab?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [currentPidIndex]);

  if (!pidFiles.length) return null;

  return (
    <div className="h-9 shrink-0 flex items-stretch bg-[#0c0c0e] border-b border-white/[0.05] overflow-hidden">
      {/* Tab list */}
      <div
        ref={tabsRef}
        className="flex-1 flex items-stretch overflow-x-auto scrollbar-none"
      >
        {pidFiles.map((file, i) => {
          const active = i === currentPidIndex;
          return (
            <button
              key={`${file.name}-${i}`}
              data-active={active}
              onClick={() => setCurrentPidIndex(i)}
              className={`relative flex items-center gap-1.5 px-3 h-full shrink-0 border-r border-white/[0.05] transition-colors group ${
                active
                  ? 'text-white bg-[#18181c]'
                  : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.03]'
              }`}
            >
              {/* Top accent on active tab */}
              {active && (
                <span className="absolute top-0 left-0 right-0 h-[1.5px] bg-blue-400/80 rounded-b-sm" />
              )}

              <span className="text-[12px] max-w-[150px] truncate leading-none">
                {truncateName(file.name)}
              </span>

              {/* Close button */}
              <span
                role="button"
                tabIndex={-1}
                onClick={e => { e.stopPropagation(); closeFile(i); }}
                className={`flex items-center justify-center w-4 h-4 rounded transition-colors shrink-0 ${
                  active
                    ? 'text-gray-500 hover:text-white hover:bg-white/10'
                    : 'text-transparent group-hover:text-gray-600 group-hover:hover:text-white group-hover:hover:bg-white/10'
                }`}
              >
                <X className="w-2.5 h-2.5" />
              </span>
            </button>
          );
        })}
      </div>

      {/* Add more files */}
      <button
        onClick={onOpenFiles}
        title="Open more files"
        className="w-9 shrink-0 flex items-center justify-center text-gray-600 hover:text-gray-300 hover:bg-white/[0.04] border-l border-white/[0.05] transition-colors"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
};

export default FileTabs;
