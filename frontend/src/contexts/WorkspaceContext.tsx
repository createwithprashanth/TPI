import React, {
  createContext, useContext, useState, useRef,
  useEffect, useCallback, type Dispatch, type SetStateAction,
} from 'react';
import { generatePreview as generateInstruMapPreview } from '../services/pid';

interface WorkspaceContextType {
  // Files
  pidFiles: File[];
  currentPidIndex: number;
  setCurrentPidIndex: Dispatch<SetStateAction<number>>;
  loadFiles: (files: File[]) => void;
  clearFiles: () => void;
  closeFile: (index: number) => void;
  // Preview (auto-loads when files or index change)
  hdPreviewBase64: string | null;
  pageCount: number;
  isPreviewLoading: boolean;
  // Zoom — preserved when switching between product tabs
  zoom: number;
  setZoom: Dispatch<SetStateAction<number>>;
  baseDims: { w: number; h: number } | null;
  setBaseDims: Dispatch<SetStateAction<{ w: number; h: number } | null>>;
}

const WorkspaceContext = createContext<WorkspaceContextType | null>(null);

export const WorkspaceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [pidFiles, setPidFiles] = useState<File[]>([]);
  const [currentPidIndex, setCurrentPidIndex] = useState(0);
  const [hdPreviewBase64, setHdPreviewBase64] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [zoom, setZoom] = useState(1.0);
  const [baseDims, setBaseDims] = useState<{ w: number; h: number } | null>(null);
  const cancelRef = useRef(false);

  // Auto-load preview whenever the active file changes
  useEffect(() => {
    if (!pidFiles.length) {
      setHdPreviewBase64(null);
      setPageCount(1);
      return;
    }
    cancelRef.current = true;
    cancelRef.current = false;
    const localCancelled = { value: false };

    const load = async () => {
      setIsPreviewLoading(true);
      try {
        const file = pidFiles[Math.min(currentPidIndex, pidFiles.length - 1)];
        const { image, pageCount: pc } = await generateInstruMapPreview(file);
        if (!localCancelled.value) {
          setHdPreviewBase64(image);
          setPageCount(pc);
        }
      } catch {
        if (!localCancelled.value) setHdPreviewBase64(null);
      } finally {
        if (!localCancelled.value) setIsPreviewLoading(false);
      }
    };

    load();
    return () => { localCancelled.value = true; };
  }, [pidFiles, currentPidIndex]);

  const loadFiles = useCallback((files: File[]) => {
    setPidFiles(files);
    setCurrentPidIndex(0);
    setZoom(1.0);
    setBaseDims(null);
  }, []);

  const clearFiles = useCallback(() => {
    setPidFiles([]);
    setCurrentPidIndex(0);
    setHdPreviewBase64(null);
    setPageCount(1);
    setZoom(1.0);
    setBaseDims(null);
  }, []);

  const closeFile = useCallback((index: number) => {
    setPidFiles(prev => {
      const next = prev.filter((_, i) => i !== index);
      if (!next.length) {
        setHdPreviewBase64(null);
        setPageCount(1);
        setZoom(1.0);
        setBaseDims(null);
      }
      return next;
    });
    setCurrentPidIndex(prev => {
      if (index < prev) return prev - 1;
      if (index === prev) return Math.max(0, prev - 1);
      return prev;
    });
  }, []);

  return (
    <WorkspaceContext.Provider value={{
      pidFiles, currentPidIndex, setCurrentPidIndex, loadFiles, clearFiles, closeFile,
      hdPreviewBase64, pageCount, isPreviewLoading,
      zoom, setZoom, baseDims, setBaseDims,
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = (): WorkspaceContextType => {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return ctx;
};
