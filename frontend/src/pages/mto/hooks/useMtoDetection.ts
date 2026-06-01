import { useRef, useState } from 'react';
import { detectSymbolAllPages, detectFromLibrary, reviewMtoSessions } from '../../../services/mto';
import type { MtoSession, StagedTemplate, FileResult } from './useMtoSessions';

export const SESSION_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b',
  '#a855f7', '#ec4899', '#14b8a6', '#f97316',
];

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
  shouldCancel: () => boolean,
): Promise<void> {
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      if (shouldCancel()) return;
      const i = nextIndex++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
}

interface UseDetectionOptions {
  pidFiles: File[];
  mtoThreshold: number;
  mtoSessions: MtoSession[];
  onAddSessions: (sessions: MtoSession[]) => void;
  onUpdateSession: (id: string, update: Partial<MtoSession>) => void;
  onError: (msg: string) => void;
}

export function useMtoDetection({
  pidFiles,
  mtoThreshold,
  mtoSessions,
  onAddSessions,
  onUpdateSession,
  onError,
}: UseDetectionOptions) {
  const [mtoLoading, setMtoLoading] = useState(false);
  const [mtoProgress, setMtoProgress] = useState(0);
  const mtoCancelRef = useRef(false);

  const runTemplates = async (
    templates: StagedTemplate[],
    onStarted?: () => void,
  ): Promise<void> => {
    if (!templates.length || !pidFiles.length) return;
    setMtoLoading(true);
    setMtoProgress(0);
    mtoCancelRef.current = false;
    onStarted?.();

    try {
      const newSessions: MtoSession[] = [];
      for (const tmpl of templates) {
        if (mtoCancelRef.current) break;
        const colorIdx = (mtoSessions.length + newSessions.length) % SESSION_COLORS.length;
        const fileResults: FileResult[] = [];
        let totalCount = 0;

        await runWithConcurrency(pidFiles, 3, async (pidFile, fi) => {
          const result = tmpl.templateImage
            ? await detectFromLibrary({ pidFile, templateImageBase64: tmpl.templateImage, threshold: mtoThreshold, label: tmpl.label, matchMode: 'exact' })
            : await detectSymbolAllPages({ pidFile, templateBox: tmpl.box!, threshold: mtoThreshold, label: tmpl.label, matchMode: 'exact' });
          fileResults[fi] = {
            fileName: pidFile.name,
            count: result.total_count,
            matches: result.pages.flatMap(p => p.matches.map(m => ({ ...m, page: p.page }))),
            pageCounts: result.pages.map(p => ({ page: p.page, count: p.count })),
            imageWidth: result.image_width,
            imageHeight: result.image_height,
          };
          totalCount += result.total_count;
          setMtoProgress(p => p + 1);
        }, () => mtoCancelRef.current);

        newSessions.push({
          id: `${Date.now()}-${newSessions.length}`,
          label: tmpl.label,
          color: SESSION_COLORS[colorIdx],
          templateBox: tmpl.box ?? { x1: 0, y1: 0, x2: 0, y2: 0 },
          templateImage: tmpl.templateImage,
          thumbnail: tmpl.thumbnail,
          metadata: tmpl.metadata,
          count: totalCount,
          fileResults: fileResults.filter(Boolean) as FileResult[],
        });
      }
      onAddSessions(newSessions);
      if (newSessions.length > 0) {
        void reviewMtoSessions({ sessions: newSessions, threshold: mtoThreshold })
          .then(reviewed => {
            ((reviewed.sessions ?? []) as MtoSession[]).forEach(session => {
              if (session?.id) onUpdateSession(session.id, session);
            });
          })
          .catch((reviewErr: any) => {
            onError(reviewErr.response?.data?.detail || 'AI review failed; deterministic MTO results are shown.');
          });
      }
    } catch (err: any) {
      onError(err.response?.data?.detail || err.message || 'Detection failed.');
      throw err;
    } finally {
      setMtoProgress(0);
      setMtoLoading(false);
    }
  };

  const rerunSession = async (session: MtoSession): Promise<void> => {
    if (!pidFiles.length || mtoLoading) return;
    setMtoLoading(true);
    setMtoProgress(0);
    try {
      const fileResults: FileResult[] = [];
      let totalCount = 0;
      await runWithConcurrency(pidFiles, 3, async (pidFile, fi) => {
        const result = session.templateImage
          ? await detectFromLibrary({ pidFile, templateImageBase64: session.templateImage, threshold: mtoThreshold, label: session.label, matchMode: 'exact' })
          : await detectSymbolAllPages({ pidFile, templateBox: session.templateBox, threshold: mtoThreshold, label: session.label, matchMode: 'exact' });
        fileResults[fi] = {
          fileName: pidFile.name,
          count: result.total_count,
          matches: result.pages.flatMap(p => p.matches.map(m => ({ ...m, page: p.page }))),
          pageCounts: result.pages.map(p => ({ page: p.page, count: p.count })),
          imageWidth: result.image_width,
          imageHeight: result.image_height,
        };
        totalCount += result.total_count;
        setMtoProgress(p => p + 1);
      }, () => false);
      const updatedSession = {
        ...session,
        count: totalCount,
        fileResults: fileResults.filter(Boolean) as FileResult[],
      };
      onUpdateSession(session.id, updatedSession);
      void reviewMtoSessions({ sessions: [updatedSession], threshold: mtoThreshold })
        .then(reviewed => {
          onUpdateSession(session.id, (reviewed.sessions?.[0] ?? updatedSession) as Partial<MtoSession>);
        })
        .catch((reviewErr: any) => {
          onError(reviewErr.response?.data?.detail || 'AI review failed; deterministic MTO results are shown.');
        });
    } catch (err: any) {
      onError(err.response?.data?.detail || err.message || 'Re-run failed.');
    } finally {
      setMtoProgress(0);
      setMtoLoading(false);
    }
  };

  const cancel = () => { mtoCancelRef.current = true; };

  return { mtoLoading, mtoProgress, runTemplates, rerunSession, cancel };
}
