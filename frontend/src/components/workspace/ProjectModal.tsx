import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useProject } from '../../contexts/ProjectContext';
import type { ProjectInfo } from '../../services/pid';

const FIELDS: { key: keyof ProjectInfo; label: string; placeholder: string }[] = [
  { key: 'project_name',    label: 'Project name',  placeholder: 'e.g. Liverpool LNG Terminal' },
  { key: 'project_no',      label: 'Project number', placeholder: 'e.g. PROJ-2024-001' },
  { key: 'client_name',     label: 'Client',         placeholder: 'Client organisation' },
  { key: 'contractor_name', label: 'Contractor',     placeholder: 'Contractor / engineering firm' },
  { key: 'location',        label: 'Location',       placeholder: 'Site or country' },
];

interface ProjectModalProps {
  open: boolean;
  onClose: () => void;
}

const ProjectModal: React.FC<ProjectModalProps> = ({ open, onClose }) => {
  const { project, setProject } = useProject();
  const firstInputRef = useRef<HTMLInputElement>(null);

  // Focus first field on open
  useEffect(() => {
    if (open) setTimeout(() => firstInputRef.current?.focus(), 80);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal card */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: -8 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            className="fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[420px] bg-[#141417] border border-white/[0.08] rounded-2xl shadow-2xl overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-white/[0.06]">
              <div>
                <h2 className="text-sm font-semibold text-white">Project Details</h2>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Applied across all tools and printed on deliverables
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-600 hover:text-white hover:bg-white/[0.07] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Fields */}
            <div className="px-6 py-5 space-y-4">
              {FIELDS.map(({ key, label, placeholder }, i) => (
                <div key={key}>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-[0.1em] mb-1.5">
                    {label}
                  </label>
                  <input
                    ref={i === 0 ? firstInputRef : undefined}
                    type="text"
                    value={project[key]}
                    onChange={e => setProject({ ...project, [key]: e.target.value })}
                    placeholder={placeholder}
                    className="w-full bg-white/[0.04] border border-white/[0.07] rounded-lg px-3 py-2 text-[13px] text-white placeholder:text-gray-700 outline-none focus:border-white/[0.2] focus:bg-white/[0.06] transition-all"
                  />
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 pb-5 flex items-center justify-between">
              <p className="text-[11px] text-gray-700">
                Saved automatically · used in all exports
              </p>
              <button
                onClick={onClose}
                className="text-[13px] font-semibold text-gray-900 bg-white hover:bg-gray-100 px-4 py-1.5 rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default ProjectModal;
