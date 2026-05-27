import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import type { ProjectInfo } from '../../services/pid';

const FIELDS: { key: keyof ProjectInfo; label: string; placeholder: string }[] = [
  { key: 'project_name', label: 'Project',    placeholder: 'Project name' },
  { key: 'project_no',   label: 'Number',     placeholder: 'Project number' },
  { key: 'client_name',  label: 'Client',     placeholder: 'Client name' },
  { key: 'contractor_name', label: 'Contractor', placeholder: 'Contractor name' },
  { key: 'location',     label: 'Location',   placeholder: 'Site / location' },
];

interface SidePanelProps {
  open: boolean;
  onClose: () => void;
}

const SidePanel: React.FC<SidePanelProps> = ({ open, onClose }) => {
  const { project, setProject } = useProject();

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="side-panel"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 220, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
          className="shrink-0 flex flex-col bg-[#101013] border-r border-white/[0.05] overflow-hidden"
          style={{ minWidth: 0 }}
        >
          {/* Header */}
          <div className="h-11 flex items-center justify-between px-4 border-b border-white/[0.05] shrink-0">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.15em]">
              Project
            </span>
            <button
              onClick={onClose}
              className="w-5 h-5 flex items-center justify-center rounded text-gray-700 hover:text-gray-300 hover:bg-white/[0.06] transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>

          {/* Fields */}
          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3.5 scrollbar-none">
            {FIELDS.map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-[10px] font-semibold text-gray-600 uppercase tracking-[0.12em] mb-1.5">
                  {label}
                </label>
                <input
                  type="text"
                  value={project[key]}
                  onChange={e => setProject({ ...project, [key]: e.target.value })}
                  placeholder={placeholder}
                  className="w-full bg-white/[0.03] border border-white/[0.07] rounded-lg px-2.5 py-1.5 text-[12px] text-white placeholder:text-gray-700 outline-none focus:border-white/[0.18] focus:bg-white/[0.05] transition-all"
                />
              </div>
            ))}

            {project.project_name && (
              <p className="text-[10px] text-gray-700 pt-0.5">Printed on all deliverables</p>
            )}
          </div>

          {/* Active project footer */}
          {project.project_name && (
            <div className="px-4 py-3 border-t border-white/[0.05] shrink-0">
              <p className="text-[12px] text-gray-200 font-medium truncate">{project.project_name}</p>
              {project.project_no && (
                <p className="text-[10px] text-gray-600 mt-0.5 truncate">{project.project_no}</p>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default SidePanel;
