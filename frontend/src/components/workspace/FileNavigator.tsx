import React from 'react';
import { useWorkspace } from '../../contexts/WorkspaceContext';

const truncate = (name: string, max = 50) =>
  name.length > max ? `${name.slice(0, max - 1)}…` : name;

const FileNavigator: React.FC = () => {
  const { pidFiles, currentPidIndex, setCurrentPidIndex, pageCount } = useWorkspace();
  if (pidFiles.length <= 1) return null;

  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-1 border-b border-white/[0.06] bg-gray-900/60">
      <button
        onClick={() => setCurrentPidIndex(i => Math.max(0, i - 1))}
        disabled={currentPidIndex === 0}
        className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-white/10 disabled:opacity-25 transition-colors font-bold text-base leading-none"
      >‹</button>
      <span className="text-[11px] text-gray-500 font-semibold tabular-nums shrink-0">
        {currentPidIndex + 1} / {pidFiles.length}
      </span>
      <span className="text-[11px] text-gray-400 truncate flex-1 min-w-0">
        {truncate(pidFiles[currentPidIndex].name)}
      </span>
      {pageCount > 1 && (
        <span className="text-[10px] text-gray-600 shrink-0">{pageCount} pages</span>
      )}
      <button
        onClick={() => setCurrentPidIndex(i => Math.min(pidFiles.length - 1, i + 1))}
        disabled={currentPidIndex === pidFiles.length - 1}
        className="w-6 h-6 flex items-center justify-center rounded text-gray-500 hover:text-white hover:bg-white/10 disabled:opacity-25 transition-colors font-bold text-base leading-none"
      >›</button>
    </div>
  );
};

export default FileNavigator;
