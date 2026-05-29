import React, { createContext, useContext, useState } from 'react';
import type { ProjectInfo } from '../services/pid';

const STORAGE_KEY = 'instrumap_project';
const EMPTY_PROJECT: ProjectInfo = {
  project_name: '',
  project_no: '',
  client_name: '',
  contractor_name: '',
  location: '',
  project_legend_notes: '',
};

function loadProject(): ProjectInfo {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...EMPTY_PROJECT, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return EMPTY_PROJECT;
}

interface ProjectContextType {
  project: ProjectInfo;
  setProject: (p: ProjectInfo) => void;
}

const ProjectContext = createContext<ProjectContextType | null>(null);

export const ProjectProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [project, setProjectState] = useState<ProjectInfo>(loadProject);

  const setProject = (p: ProjectInfo) => {
    setProjectState(p);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  };

  return (
    <ProjectContext.Provider value={{ project, setProject }}>
      {children}
    </ProjectContext.Provider>
  );
};

export const useProject = (): ProjectContextType => {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProject must be used within ProjectProvider');
  return ctx;
};
