import { useEffect, useRef, useState } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Box { x1: number; y1: number; x2: number; y2: number; }

export interface FileResult {
  fileName: string;
  count: number;
  matches: { x1: number; y1: number; x2: number; y2: number; score: number }[];
  pageCounts: { page: number; count: number }[];
  imageWidth: number;
  imageHeight: number;
}

export interface MtoSession {
  id: string;
  label: string;
  color: string;
  templateBox: Box;
  templateImage?: string;
  thumbnail?: string;
  count: number;
  fileResults: FileResult[];
}

export interface StagedTemplate {
  id: string;
  label: string;
  box?: Box;
  templateImage?: string;
  thumbnail?: string;
}

export type MtoStep = 'pick_template' | 'labeling' | 'running';

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useMtoSessions(pidFiles: File[]) {
  const [mtoStep, setMtoStep] = useState<MtoStep>('pick_template');
  const [mtoSessions, setMtoSessions] = useState<MtoSession[]>([]);
  const [stagedTemplates, setStagedTemplates] = useState<StagedTemplate[]>([]);
  const [pendingBox, setPendingBox] = useState<Box | null>(null);
  const [pendingLabel, setPendingLabel] = useState('');
  const [showMatchZone, setShowMatchZone] = useState<string | null>(null);
  const dragAnchorRef = useRef<{ px: number; py: number; ix: number; iy: number } | null>(null);
  const [dragAnchor, setDragAnchor] = useState<{ px: number; py: number; ix: number; iy: number } | null>(null);
  const [dragHead, setDragHead] = useState<{ px: number; py: number } | null>(null);

  // Reset everything when files change
  useEffect(() => {
    setMtoStep('pick_template');
    setPendingBox(null);
    setPendingLabel('');
    setStagedTemplates([]);
    setMtoSessions([]);
    setShowMatchZone(null);
    dragAnchorRef.current = null;
    setDragAnchor(null);
    setDragHead(null);
  }, [pidFiles]);

  const addSessions = (sessions: MtoSession[]) =>
    setMtoSessions(prev => [...prev, ...sessions]);

  const updateSession = (id: string, update: Partial<MtoSession>) =>
    setMtoSessions(prev => prev.map(s => s.id === id ? { ...s, ...update } : s));

  const removeMatch = (sessionId: string, fileIndex: number, matchIndex: number) => {
    setMtoSessions(prev => prev.map(s => {
      if (s.id !== sessionId) return s;
      const newFileResults = s.fileResults.map((fr, fi) => {
        if (fi !== fileIndex) return fr;
        const newMatches = fr.matches.filter((_, mi) => mi !== matchIndex);
        const newPageCounts = fr.pageCounts.map(pc =>
          pc.page === 1 ? { ...pc, count: Math.max(0, pc.count - 1) } : pc,
        );
        return { ...fr, matches: newMatches, count: Math.max(0, fr.count - 1), pageCounts: newPageCounts };
      });
      return { ...s, fileResults: newFileResults, count: newFileResults.reduce((n, fr) => n + fr.count, 0) };
    }));
  };

  const clearAllSessions = () => {
    setMtoSessions([]);
    setMtoStep('pick_template');
    setPendingBox(null);
    setPendingLabel('');
    setStagedTemplates([]);
    setShowMatchZone(null);
    dragAnchorRef.current = null;
    setDragAnchor(null);
    setDragHead(null);
  };

  const cancelPending = () => {
    setPendingBox(null);
    setPendingLabel('');
    setMtoStep('pick_template');
  };

  return {
    mtoStep, setMtoStep,
    mtoSessions, setMtoSessions, addSessions, updateSession,
    stagedTemplates, setStagedTemplates,
    pendingBox, setPendingBox,
    pendingLabel, setPendingLabel,
    showMatchZone, setShowMatchZone,
    dragAnchor, setDragAnchor,
    dragHead, setDragHead,
    dragAnchorRef,
    removeMatch,
    clearAllSessions,
    cancelPending,
    totalCount: mtoSessions.reduce((s, sess) => s + sess.count, 0),
  };
}
