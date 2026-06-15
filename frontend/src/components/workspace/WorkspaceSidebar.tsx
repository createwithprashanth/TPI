import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileUp, BoxSelect, FileText, ChevronDown, ChevronUp, TableProperties, Gauge, Database, GitCompare, Layers3, LibraryBig, GitBranch, Layers } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import type { ProjectInfo } from '../../services/pid';

export type WorkspaceView = 'pid' | 'piping' | 'precisionpdf' | 'knowledge' | 'aigrid' | 'flowsizing' | 'datapump' | 'datadiff' | 'datasheet' | 'cne';

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

type NavEntry =
  | { kind: 'group'; label: string }
  | { kind: 'item'; view: WorkspaceView; icon: React.ElementType; label: string };

const NAV_ENTRIES: NavEntry[] = [
  { kind: 'group', label: 'Instrumentation' },
  { kind: 'item', view: 'pid',          icon: FileUp,          label: 'Instrumentation' },
  { kind: 'item', view: 'aigrid',       icon: TableProperties, label: 'AI Grid' },
  { kind: 'item', view: 'datasheet',    icon: Layers3,         label: 'Datasheet' },
  { kind: 'item', view: 'flowsizing',   icon: Gauge,           label: 'FlowSizing' },
  { kind: 'item', view: 'cne',          icon: GitBranch,       label: 'C&E Matrix' },
  { kind: 'group', label: 'Piping' },
  { kind: 'item', view: 'piping',       icon: Layers,          label: 'Piping MTO' },
  { kind: 'group', label: 'Reference' },
  { kind: 'item', view: 'knowledge',    icon: LibraryBig,      label: 'Project Knowledge' },
  { kind: 'item', view: 'precisionpdf', icon: FileText,        label: 'PrecisionPDF' },
  { kind: 'group', label: 'Data Ops' },
  { kind: 'item', view: 'datapump',     icon: Database,        label: 'DataPump' },
  { kind: 'item', view: 'datadiff',     icon: GitCompare,      label: 'DataDiff' },
];

interface WorkspaceSidebarProps {
  view: WorkspaceView;
  onViewChange: (v: WorkspaceView) => void;
  appName?: string;
}

const WorkspaceSidebar: React.FC<WorkspaceSidebarProps> = ({
  view, onViewChange, appName = 'XYRA Studio',
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
      <nav className="flex-1 py-2 px-2 overflow-y-auto">
        {NAV_ENTRIES.map((entry, i) =>
          entry.kind === 'group' ? (
            <div
              key={`g-${i}`}
              className={`px-1 pb-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-gray-700 ${i > 0 ? 'mt-3' : 'mt-1'}`}
            >
              {entry.label}
            </div>
          ) : (
            <NavItem
              key={entry.view}
              icon={entry.icon}
              label={entry.label}
              active={view === entry.view}
              onClick={() => onViewChange(entry.view)}
            />
          )
        )}
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
                <textarea
                  value={project.project_legend_notes}
                  onChange={e => setProject({ ...project, project_legend_notes: e.target.value })}
                  placeholder="Project tag legend / notes"
                  rows={3}
                  className="w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white placeholder:text-gray-600 outline-none focus:border-white/[0.18] transition-colors"
                />
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
