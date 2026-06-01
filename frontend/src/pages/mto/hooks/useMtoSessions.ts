import { useEffect, useRef, useState } from 'react';
import type { MtoMetadata } from '../../../services/mto';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Box { x1: number; y1: number; x2: number; y2: number; }

export interface FileResult {
  fileName: string;
  count: number;
  matches: {
    page: number;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    score: number;
    sizeInch?: string;
    sizeSource?: string;
    aiDecision?: string;
    aiConfidence?: number;
    aiReason?: string;
    aiFlags?: string[];
    aiNormalizedSizeInch?: string;
    aiLineNumber?: string;
    aiMaterialDescriptionHint?: string;
  }[];
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
  metadata?: MtoMetadata;
  count: number;
  fileResults: FileResult[];
}

export interface StagedTemplate {
  id: string;
  label: string;
  box?: Box;
  templateImage?: string;
  thumbnail?: string;
  metadata?: MtoMetadata;
}

export type MtoStep = 'pick_template' | 'labeling' | 'running';

type Match = FileResult['matches'][number];

const boxIou = (a: Match, b: Match) => {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
};

const recalcFileResult = (fr: FileResult, matches: Match[]): FileResult => {
  const counts = new Map<number, number>();
  for (const match of matches) counts.set(match.page ?? 1, (counts.get(match.page ?? 1) ?? 0) + 1);
  const pageCounts = fr.pageCounts.map(pc => ({ ...pc, count: counts.get(pc.page) ?? 0 }));
  for (const [page, count] of counts) {
    if (!pageCounts.some(pc => pc.page === page)) pageCounts.push({ page, count });
  }
  pageCounts.sort((a, b) => a.page - b.page);
  return { ...fr, matches, count: matches.length, pageCounts };
};

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
        const removed = fr.matches[matchIndex];
        const newMatches = fr.matches.filter((_, mi) => mi !== matchIndex);
        const newPageCounts = fr.pageCounts.map(pc =>
          pc.page === (removed?.page ?? 1) ? { ...pc, count: Math.max(0, pc.count - 1) } : pc,
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

  const resolveOverlaps = (iouThreshold = 0.45) => {
    setMtoSessions(prev => {
      const keptBySession = new Map<string, Map<number, Match[]>>();
      const candidates = prev.flatMap((session, sessionIndex) =>
        session.fileResults.flatMap((fr, fileIndex) =>
          fr.matches.map((match, matchIndex) => ({
            sessionId: session.id,
            sessionIndex,
            fileIndex,
            matchIndex,
            match,
          })),
        ),
      ).sort((a, b) => b.match.score - a.match.score);

      const kept: typeof candidates = [];
      for (const candidate of candidates) {
        const duplicate = kept.some(existing =>
          existing.fileIndex === candidate.fileIndex
          && (existing.match.page ?? 1) === (candidate.match.page ?? 1)
          && boxIou(existing.match, candidate.match) >= iouThreshold,
        );
        if (duplicate) continue;
        kept.push(candidate);
        if (!keptBySession.has(candidate.sessionId)) keptBySession.set(candidate.sessionId, new Map());
        const byFile = keptBySession.get(candidate.sessionId)!;
        if (!byFile.has(candidate.fileIndex)) byFile.set(candidate.fileIndex, []);
        byFile.get(candidate.fileIndex)!.push(candidate.match);
      }

      return prev.map(session => {
        const byFile = keptBySession.get(session.id) ?? new Map<number, Match[]>();
        const fileResults = session.fileResults.map((fr, fileIndex) =>
          recalcFileResult(fr, byFile.get(fileIndex) ?? []),
        );
        return { ...session, fileResults, count: fileResults.reduce((sum, fr) => sum + fr.count, 0) };
      });
    });
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
    resolveOverlaps,
    clearAllSessions,
    cancelPending,
    totalCount: mtoSessions.reduce((s, sess) => s + sess.count, 0),
  };
}
