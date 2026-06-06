import React, { useState, useEffect } from 'react';
import { ChevronDown, FolderOpen, Moon, Sun } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import { useTheme } from '../../contexts/ThemeContext';
import ProjectModal from './ProjectModal';

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
  const { project } = useProject();
  const { theme, toggleTheme } = useTheme();
  const [modalOpen, setModalOpen] = useState(false);
  const [llmLive, setLlmLive] = useState<boolean | null>(null);

  useEffect(() => {
    const check = () => {
      fetch('/api/v1/llm/status')
        .then(r => r.json())
        .then(d => setLlmLive(!!d.available))
        .catch(() => setLlmLive(false));
    };
    check();
    const id = setInterval(check, 30_000);
    return () => clearInterval(id);
  }, []);

  const hasProject = !!project.project_name;

  // Build the visible chips from whatever fields are set
  const chips = [
    project.project_name,
    project.project_no,
    project.client_name,
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="h-10 shrink-0 flex items-center justify-between bg-[#09090c] border-b border-white/[0.05] select-none px-4">

        {/* Left — brand + active tool */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2.5 shrink-0">
            <img src="/favicon.png" alt="XYRA" className="w-4 h-4 opacity-70" />
            <span className="text-[12px] font-bold text-gray-300 tracking-tight">XYRA Studio</span>
          </div>
          {toolLabel && (
            <>
              <span className="h-4 w-px bg-white/[0.08] shrink-0" />
              <span className="text-[13px] font-semibold text-white tracking-tight truncate">
                {toolLabel}
              </span>
            </>
          )}
        </div>

        {/* Right — tool controls + LLM status + project chip */}
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
            className={`xyra-theme-toggle relative h-6 w-11 shrink-0 rounded-full border transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/20 ${
              theme === 'dark'
                ? 'border-white/[0.08] bg-white/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.02)]'
                : 'border-black/[0.08] bg-gray-200 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7)]'
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

          {/* LLM live indicator */}
          {llmLive !== null && (
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${llmLive ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`} />
              <span className={`text-[11px] font-medium ${llmLive ? 'text-emerald-400' : 'text-gray-600'}`}>
                {llmLive ? 'XYRA AI LLM live' : 'XYRA AI LLM offline'}
              </span>
            </div>
          )}

          {/* Project chip */}
          <button
            onClick={() => setModalOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors group ${
              hasProject ? 'hover:bg-white/[0.05]' : 'hover:bg-white/[0.04]'
            }`}
          >
            {hasProject ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="text-[11px] text-gray-300 font-medium">
                  {chips.join(' · ')}
                </span>
                <ChevronDown className="w-3 h-3 text-gray-600 group-hover:text-gray-400 transition-colors" />
              </>
            ) : (
              <span className="text-[11px] text-gray-600 hover:text-gray-400 transition-colors">
                + Set project
              </span>
            )}
          </button>

        </div>
      </div>

      <ProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
};

export default WorkspaceBar;
