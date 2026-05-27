import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import ProjectModal from './ProjectModal';

const WorkspaceBar: React.FC = () => {
  const { project } = useProject();
  const [modalOpen, setModalOpen] = useState(false);

  const hasProject = !!project.project_name;

  // Build the visible chips from whatever fields are set
  const chips = [
    project.project_name,
    project.project_no,
    project.client_name,
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="h-9 shrink-0 flex items-center justify-between bg-[#09090c] border-b border-white/[0.05] select-none px-4">

        {/* Left — brand */}
        <div className="flex items-center gap-2.5">
          <img src="/favicon.png" alt="XYRA" className="w-4 h-4 opacity-70" />
          <span className="text-[12px] font-bold text-gray-300 tracking-tight">XYRA Studio</span>
        </div>

        {/* Right — project chip */}
        <button
          onClick={() => setModalOpen(true)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-colors group ${
            hasProject
              ? 'hover:bg-white/[0.05]'
              : 'hover:bg-white/[0.04]'
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

      <ProjectModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
};

export default WorkspaceBar;
