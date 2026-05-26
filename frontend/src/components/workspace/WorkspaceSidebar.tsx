import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileUp, BoxSelect, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import type { ProjectInfo } from '../../services/pid';

export type WorkspaceView = 'pid' | 'piping' | 'precisionpdf';

interface NavItemProps {
  icon: React.ElementType;
  label: string;
  active: boolean;
  onClick: () => void;
}

const NavItem: React.FC<NavItemProps> = ({ icon: Icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
      active
        ? 'bg-white/[0.08] text-white font-medium'
        : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]'
    }`}
  >
    <Icon className="w-4 h-4 shrink-0" />
    {label}
  </button>
);

// Registry — add new products here only
const NAV_ITEMS: { view: WorkspaceView; icon: React.ElementType; label: string }[] = [
  { view: 'pid',          icon: FileUp,      label: 'P&ID Analyser' },
  { view: 'piping',       icon: BoxSelect,   label: 'Piping MTO' },
  { view: 'precisionpdf', icon: FileText,    label: 'PrecisionPDF' },
];

interface WorkspaceSidebarProps {
  view: WorkspaceView;
  onViewChange: (v: WorkspaceView) => void;
  appName?: string;
}

const WorkspaceSidebar: React.FC<WorkspaceSidebarProps> = ({
  view, onViewChange, appName = 'InstruMap',
}) => {
  const { project, setProject } = useProject();
  const [showProjectForm, setShowProjectForm] = useState(false);

  return (
    <div className="w-52 shrink-0 flex flex-col border-r border-white/[0.06] bg-gray-950">
      {/* Brand */}
      <div className="h-11 flex items-center px-4 border-b border-white/[0.06]">
        <span className="text-white font-bold text-sm tracking-tight">{appName}</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 space-y-0.5 px-2">
        {NAV_ITEMS.map(({ view: v, icon, label }) => (
          <NavItem key={v} icon={icon} label={label} active={view === v} onClick={() => onViewChange(v)} />
        ))}
      </nav>

      {/* Project details */}
      <div className="border-t border-white/[0.06]">
        <button
          onClick={() => setShowProjectForm(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          <span className="font-semibold uppercase tracking-wider">Project Details</span>
          {showProjectForm ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        <AnimatePresence>
          {showProjectForm && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="px-3 pb-3 space-y-1.5">
                {([
                  ['project_name', 'Project name'],
                  ['project_no', 'Project No.'],
                  ['client_name', 'Client'],
                  ['contractor_name', 'Contractor'],
                  ['location', 'Location'],
                ] as [keyof ProjectInfo, string][]).map(([k, ph]) => (
                  <input
                    key={k} type="text" value={project[k]}
                    onChange={e => setProject({ ...project, [k]: e.target.value })}
                    placeholder={ph}
                    className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white placeholder:text-gray-600 outline-none focus:border-white/[0.18] transition-colors"
                  />
                ))}
                {project.project_name && (
                  <p className="text-[10px] text-gray-600 pt-0.5">Printed on deliverables</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!showProjectForm && project.project_name && (
          <div className="px-4 pb-3">
            <p className="text-xs text-gray-300 font-medium truncate">{project.project_name}</p>
            {project.project_no && (
              <p className="text-[10px] text-gray-600 truncate mt-0.5">{project.project_no}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default WorkspaceSidebar;
