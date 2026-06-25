import React, { useRef, useState, useEffect } from 'react';
import { ChevronDown, FolderOpen, Moon, Sun } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import { useTheme } from '../../contexts/ThemeContext';

interface WorkspaceBarProps {
  toolLabel?: string;
  areaCode?: string;
  onAreaCodeChange?: (value: string) => void;
  showAreaCode?: boolean;
  onOpenFiles?: () => void;
  openFilesDisabled?: boolean;
}

const WorkspaceBar: React.FC<WorkspaceBarProps> = ({
  toolLabel,
  areaCode = '',
  onAreaCodeChange,
  showAreaCode = false,
  onOpenFiles,
  openFilesDisabled = false,
}) => {
  const { project, setProject } = useProject();
  const { theme, toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const hasProject = !!project.project_name;
  const chips = [project.project_name, project.project_no, project.client_name].filter(Boolean) as string[];

  return (
    <div className="h-10 shrink-0 flex items-center justify-between bg-[#09090c] border-b border-white/[0.05] select-none px-4 relative z-10">

      {/* Left — brand + active tool */}
      <div className="flex items-center gap-3 min-w-0">
        {toolLabel && (
          <span className="text-[13px] font-semibold text-white tracking-tight truncate">{toolLabel}</span>
        )}
      </div>

      {/* Right — controls */}
      <div className="flex items-center gap-3">

        {showAreaCode && (
          <input
            type="text"
            value={areaCode}
            onChange={e => onAreaCodeChange?.(e.target.value)}
            placeholder="Area code"
            className="h-7 w-28 rounded-md border border-white/[0.07] bg-white/[0.04] px-2.5 text-xs text-white placeholder:text-gray-600 outline-none focus:border-white/[0.15] transition-colors"
          />
        )}

        {onOpenFiles && (
          <button
            onClick={onOpenFiles}
            disabled={openFilesDisabled}
            className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 bg-white hover:bg-gray-100 disabled:opacity-50 px-3 py-1.5 rounded-md transition-colors"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Open Files
          </button>
        )}

        <button
          type="button"
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-pressed={theme === 'light'}
          className={`relative h-6 w-11 shrink-0 rounded-full border transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/20 ${
            theme === 'dark'
              ? 'border-white/[0.08] bg-white/[0.08]'
              : 'border-black/[0.08] bg-gray-200'
          }`}
        >
          <span
            className={`absolute top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-gray-900 shadow-sm ring-1 ring-black/5 transition-transform duration-200 ease-out ${
              theme === 'light' ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          >
            {theme === 'dark' ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
          </span>
        </button>

        {/* Project chip — click to open inline form */}
        <div ref={ref} className="relative">
          <button
            onClick={() => setOpen(v => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-md hover:bg-white/[0.05] transition-colors group"
          >
            {hasProject ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-[11px] text-gray-300 font-medium">{chips.join(' · ')}</span>
              </>
            ) : (
              <span className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors">+ Set project</span>
            )}
            <ChevronDown className={`w-3 h-3 text-gray-600 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            <div className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-white/[0.1] bg-[#111114] shadow-2xl p-3 space-y-2">
              {([
                ['project_name',         'Project name'],
                ['project_no',           'Project No.'],
                ['client_name',          'Client'],
                ['contractor_name',      'Contractor'],
                ['location',             'Location'],
              ] as [keyof typeof project, string][]).map(([k, ph]) => (
                <input
                  key={k}
                  type="text"
                  value={(project[k] as string) || ''}
                  onChange={e => setProject({ ...project, [k]: e.target.value })}
                  placeholder={ph}
                  className="w-full rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white placeholder:text-gray-600 outline-none focus:border-white/[0.18] transition-colors"
                />
              ))}
              <textarea
                value={project.project_legend_notes || ''}
                onChange={e => setProject({ ...project, project_legend_notes: e.target.value })}
                placeholder="Project tag legend / notes"
                rows={2}
                className="w-full resize-none rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white placeholder:text-gray-600 outline-none focus:border-white/[0.18] transition-colors"
              />
              {project.project_name && (
                <p className="text-[10px] text-gray-600">Printed on deliverables</p>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
};

export default WorkspaceBar;
