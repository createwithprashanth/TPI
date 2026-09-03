import React from 'react';

export type DotColor = 'blue' | 'green' | 'emerald' | 'gray';

interface StatusBarProps {
  label: string;
  dim?: string;
  accent?: boolean;
  loading?: boolean;
  dot?: DotColor;
  rightLabel?: string;
}

const StatusBar: React.FC<StatusBarProps> = ({ label, dim, accent, loading, dot, rightLabel }) => {
  const isRunning = loading;
  const isDone = !loading && (accent || dot === 'green' || dot === 'emerald');
  const isActive = !loading && dot && dot !== 'gray';

  return (
    <div className="h-[24px] shrink-0 flex items-stretch bg-white border-t border-slate-200 text-[11px]">

      {/* Left accent segment — blue when running, green when done */}
      {(isRunning || isDone) && (
        <div
          className={`flex items-center gap-1.5 px-3 shrink-0 border-r border-slate-200 font-medium ${
            isRunning
              ? 'bg-blue-500/[0.15] text-blue-300'
              : 'bg-emerald-500/[0.12] text-emerald-400'
          }`}
        >
          {isRunning && (
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          )}
          {isDone && (
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          )}
          <span className="text-[10px] font-bold tracking-wider">
            {isRunning ? 'RUNNING' : 'DONE'}
          </span>
        </div>
      )}

      {/* Status message */}
      <div className="flex-1 flex items-center gap-1.5 px-3 min-w-0">
        {!isRunning && !isDone && isActive && (
          <span className="w-1.5 h-1.5 rounded-full bg-gray-600 shrink-0" />
        )}
        <span className={`truncate ${accent ? 'text-emerald-400' : 'text-gray-500'}`}>
          {label}
        </span>
        {dim && (
          <span className="text-gray-700 shrink-0 truncate">{dim}</span>
        )}
      </div>

      {/* Right label — tool identifier */}
      {rightLabel && (
        <div className="flex items-center px-3 border-l border-slate-200 shrink-0">
          <span className="text-[10px] text-gray-700 font-medium">{rightLabel}</span>
        </div>
      )}
    </div>
  );
};

export default StatusBar;
