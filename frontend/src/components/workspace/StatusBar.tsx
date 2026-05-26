import React from 'react';

type DotColor = 'blue' | 'green' | 'emerald' | 'gray';

interface StatusBarProps {
  label: string;
  dim?: string;
  accent?: boolean;
  loading?: boolean;
  dot?: DotColor;
  rightLabel?: string;
}

const DOT_CLASS: Record<DotColor, string> = {
  blue:    'bg-blue-400 animate-pulse',
  green:   'bg-green-500',
  emerald: 'bg-emerald-500',
  gray:    'bg-gray-600',
};

const StatusBar: React.FC<StatusBarProps> = ({ label, dim, accent, loading, dot, rightLabel }) => (
  <div className="h-6 shrink-0 flex items-center justify-between px-4 bg-gray-950 border-t border-white/[0.05]">
    <div className="flex items-center gap-1.5 min-w-0">
      {loading && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />}
      {!loading && dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${DOT_CLASS[dot]}`} />}
      <span className={`text-[11px] truncate ${accent ? 'text-emerald-400' : 'text-gray-400'}`}>
        {label}
      </span>
      {dim && <span className="text-[11px] text-gray-600 truncate shrink-0">{dim}</span>}
    </div>
    {rightLabel && (
      <span className="text-[11px] text-gray-700 shrink-0 ml-4">{rightLabel}</span>
    )}
  </div>
);

export default StatusBar;
