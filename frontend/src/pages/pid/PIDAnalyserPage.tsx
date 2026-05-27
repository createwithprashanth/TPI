import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import {
  processAsync as processInstruMapFilesAsync,
  getJobStatus,
  downloadBatchResults,
  downloadHighlightedImage,
  type JobStatusResponse,
} from '../../services/pid';
import PDFViewer from '../../components/workspace/PDFViewer';
import StatusBar from '../../components/workspace/StatusBar';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useProject } from '../../contexts/ProjectContext';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AnchorPoint { x: number; y: number; }

interface BatchResult {
  fileName: string;
  results: any[];
  error: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const truncate = (name: string, max = 36) =>
  name.length > max ? `${name.slice(0, max - 1)}…` : name;

const formatDuration = (s: number) => {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
};

const STEPS = [
  { label: 'Extract', stages: ['calibration', 'extraction'] },
  { label: 'Package', stages: ['excel', 'zip'] },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface PIDAnalyserPageProps {
  areaCode: string;
  onOpenFiles: () => void;
  onDropFiles?: (files: File[]) => void;
}

const PIDAnalyserPage: React.FC<PIDAnalyserPageProps> = ({ areaCode, onOpenFiles, onDropFiles }) => {
  const { pidFiles, currentPidIndex, isPreviewLoading } = useWorkspace();
  const { project } = useProject();

  const [anchorPoint, setAnchorPoint] = useState<AnchorPoint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [currentFileName, setCurrentFileName] = useState('');
  const [jobStatus, setJobStatus] = useState<'queued' | 'started' | 'finished' | 'failed' | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [progressStage, setProgressStage] = useState<string | null>(null);
  const [estimatedSecondsRemaining, setEstimatedSecondsRemaining] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const imageRef = useRef<HTMLImageElement>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedTimerRef = useRef<NodeJS.Timeout | null>(null);
  const processingStartRef = useRef<number | null>(null);
  const progressReceivedAtRef = useRef<number | null>(null);

  const totalInstruments = batchResults.reduce((s, r) => s + (r.results?.length || 0), 0);
  const currentStepIdx = STEPS.findIndex(s => s.stages.includes(progressStage ?? ''));

  const liveRemaining = estimatedSecondsRemaining !== null && progressReceivedAtRef.current !== null
    ? Math.max(0, estimatedSecondsRemaining - Math.floor((Date.now() - progressReceivedAtRef.current) / 1000))
    : estimatedSecondsRemaining;

  // Reset when files change
  useEffect(() => {
    setAnchorPoint(null);
    setBatchResults([]);
    setError(null);
    setBatchId(null);
    setJobStatus(null);
    setQueuePosition(null);
    setProgressMessage(null);
    setProgressStage(null);
    setEstimatedSecondsRemaining(null);
    setElapsedSeconds(0);
    processingStartRef.current = null;
    progressReceivedAtRef.current = null;
  }, [pidFiles]);

  // Cleanup timers on unmount
  useEffect(() => () => {
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
  }, []);

  // Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && anchorPoint && !isLoading) setAnchorPoint(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [anchorPoint, isLoading]);

  const handleImageClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    if (!imageRef.current || isLoading) return;
    const img = imageRef.current;
    const rect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    setAnchorPoint({
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY),
    });
    setError(null);
  }, [isLoading]);

  const pollJobStatus = (jobId: string): Promise<JobStatusResponse> =>
    new Promise((resolve, reject) => {
      const poll = async () => {
        try {
          const s = await getJobStatus(jobId);
          setJobStatus(s.status);
          setQueuePosition(s.position_in_queue ?? null);
          if (s.progress) {
            setProgressMessage(s.progress.message);
            setProgressStage(s.progress.stage ?? null);
            if (s.progress.estimated_seconds_remaining != null) {
              setEstimatedSecondsRemaining(s.progress.estimated_seconds_remaining);
              progressReceivedAtRef.current = Date.now();
            }
          }
          if (s.status === 'started' && !processingStartRef.current) {
            processingStartRef.current = Date.now();
            elapsedTimerRef.current = setInterval(() => {
              if (processingStartRef.current)
                setElapsedSeconds(Math.floor((Date.now() - processingStartRef.current) / 1000));
            }, 1000);
          }
          if (s.status === 'finished' || s.status === 'failed') {
            if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null; }
            if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
            resolve(s);
          }
        } catch (err) {
          if (pollingIntervalRef.current) { clearInterval(pollingIntervalRef.current); pollingIntervalRef.current = null; }
          if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
          reject(err);
        }
      };
      poll();
      pollingIntervalRef.current = setInterval(poll, 3000);
    });

  const handleExtract = async () => {
    if (!anchorPoint || isLoading) return;
    setIsLoading(true);
    setError(null);
    setBatchResults([]);
    setJobStatus(null);
    setQueuePosition(null);
    setProgressMessage(null);
    setProgressStage(null);
    setEstimatedSecondsRemaining(null);
    setElapsedSeconds(0);
    processingStartRef.current = null;
    progressReceivedAtRef.current = null;
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }

    const currentBatchId = `batch_${Date.now()}`;
    setBatchId(currentBatchId);
    const newResults: BatchResult[] = [];
    let batchRadius: number | undefined;

    for (let i = 0; i < pidFiles.length; i++) {
      const file = pidFiles[i];
      setCurrentFileIndex(i);
      setCurrentFileName(file.name);
      setJobStatus(null); setQueuePosition(null);
      setProgressMessage(null); setProgressStage(null);
      setEstimatedSecondsRemaining(null);
      progressReceivedAtRef.current = null;

      const fr: BatchResult = { fileName: file.name, results: [], error: null };
      try {
        const resp = await processInstruMapFilesAsync({
          pidFile: file,
          calibration_x: batchRadius ? undefined : anchorPoint?.x,
          calibration_y: batchRadius ? undefined : anchorPoint?.y,
          user_selected_radius: batchRadius,
          area_code: areaCode,
          batch_id: currentBatchId,
          project: project.project_name ? project : undefined,
        });
        const result = await pollJobStatus(resp.job_id);
        if (result.status === 'finished' && result.result) {
          fr.results = result.result.results_table || [];
          if (!batchRadius && result.result.detected_radius)
            batchRadius = result.result.detected_radius;
        } else if (result.status === 'failed') {
          fr.error = result.error || 'Processing failed.';
        }
      } catch (err: any) {
        fr.error =
          err.response?.status === 503
            ? 'Service temporarily unavailable. Please try again.'
            : err.response?.data?.detail || err.message || 'Failed to process file.';
      }
      newResults.push(fr);
      setBatchResults([...newResults]);
    }

    setIsLoading(false);
    setJobStatus(null);
    setCurrentFileName('');
    setProgressMessage(null);
    setProgressStage(null);
    setEstimatedSecondsRemaining(null);
    setElapsedSeconds(0);
    processingStartRef.current = null;
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }

    if (currentBatchId) {
      try { await downloadBatchResults(currentBatchId); }
      catch { setError('Processing complete but download failed. Refresh and try again.'); }
    }
  };

  // ── Status text ─────────────────────────────────────────────────────────────

  const statusText = (() => {
    if (!pidFiles.length) return { label: 'Open P&ID files to begin' };
    const curFile = pidFiles[Math.min(currentPidIndex, pidFiles.length - 1)];
    if (isPreviewLoading) return { label: 'Loading…', dim: truncate(curFile.name) };
    if (isLoading) {
      const base = jobStatus === 'queued' ? 'In queue…' : jobStatus === 'started' ? 'Analysing…' : 'Submitting…';
      const fileInfo = pidFiles.length > 1 ? `file ${currentFileIndex + 1} of ${pidFiles.length}` : truncate(currentFileName || curFile.name);
      const countPart = totalInstruments > 0 ? `· ${totalInstruments} found` : '';
      return { label: base, dim: `${fileInfo} ${countPart}`.trim() };
    }
    if (totalInstruments > 0) return { label: `${totalInstruments} instrument${totalInstruments !== 1 ? 's' : ''} extracted`, accent: true };
    if (anchorPoint) return { label: truncate(curFile.name), dim: '· Ready to extract — press Esc to reselect' };
    return { label: truncate(curFile.name), dim: '· Click an instrument symbol to continue' };
  })();

  const dotColor = (() => {
    if (isLoading) return 'blue' as const;
    if (anchorPoint) return 'green' as const;
    if (pidFiles.length) return 'gray' as const;
    return undefined;
  })();

  // ── Render ──────────────────────────────────────────────────────────────────

  // Anchor dot overlay
  const overlays = (
    <>
      {anchorPoint && imageRef.current && !isLoading && (
        <div
          className="absolute z-10"
          style={{
            top: `${(anchorPoint.y / imageRef.current.naturalHeight) * 100}%`,
            left: `${(anchorPoint.x / imageRef.current.naturalWidth) * 100}%`,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="w-5 h-5 rounded-full border-2 border-red-500 bg-red-500/20 pointer-events-none" />
          <div className="absolute -top-7 left-1/2 -translate-x-1/2 flex items-center gap-1 whitespace-nowrap">
            <span className="text-[10px] bg-red-500 text-white px-1.5 py-0.5 rounded font-medium shadow">Reference set</span>
            <button
              onClick={e => { e.stopPropagation(); setAnchorPoint(null); }}
              className="text-[10px] bg-gray-800 hover:bg-gray-700 text-gray-300 hover:text-white px-1.5 py-0.5 rounded font-medium shadow transition-colors"
            >× clear</button>
          </div>
        </div>
      )}

      {isLoading && (
        <>
          <div className="absolute inset-0 bg-gray-950/55 rounded-sm" />
          <motion.div
            className="absolute left-0 right-0 h-[2px] bg-blue-400 pointer-events-none z-10"
            style={{ boxShadow: '0 0 14px 4px rgba(96,165,250,0.55)' }}
            animate={{ top: ['0%', '100%'] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'linear' }}
          />
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
            <div className="bg-gray-950/90 backdrop-blur-sm border border-white/10 rounded-2xl px-6 py-5 text-center min-w-[260px] max-w-xs">
              {jobStatus === 'started' && (
                <div className="flex items-center justify-center gap-2 mb-4">
                  {STEPS.map(({ label }, i) => {
                    const isDone = i < currentStepIdx;
                    const isCurrent = i === currentStepIdx;
                    return (
                      <React.Fragment key={label}>
                        <span className={`flex items-center gap-1 text-[11px] font-medium ${isDone ? 'text-green-400' : isCurrent ? 'text-white' : 'text-gray-600'}`}>
                          {isDone ? <span className="text-green-400">✓</span>
                            : isCurrent ? <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse inline-block" />
                            : <span className="w-1.5 h-1.5 rounded-full bg-gray-700 inline-block" />}
                          {label}
                        </span>
                        {i < STEPS.length - 1 && <span className="text-gray-700 text-[10px]">—</span>}
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
              <p className="text-white font-semibold text-sm">
                {jobStatus === 'queued' ? 'In queue…' : jobStatus === 'started' ? (progressMessage || 'Analysing P&ID…') : 'Submitting…'}
              </p>
              {currentFileName && (
                <p className="text-gray-500 text-xs mt-1">
                  {truncate(currentFileName, 28)}
                  {pidFiles.length > 1 && <span className="text-gray-600 ml-1.5">{currentFileIndex + 1}/{pidFiles.length}</span>}
                </p>
              )}
              {jobStatus === 'queued' && queuePosition !== null && queuePosition > 0 && (
                <p className="text-gray-500 text-xs mt-1">Position {queuePosition} in queue</p>
              )}
              {jobStatus === 'started' && (elapsedSeconds > 0 || (liveRemaining !== null && liveRemaining > 0)) && (
                <div className="flex items-center justify-center gap-3 mt-3 text-[11px]">
                  {elapsedSeconds > 0 && <span className="text-gray-500">{formatDuration(elapsedSeconds)} elapsed</span>}
                  {elapsedSeconds > 0 && liveRemaining !== null && liveRemaining > 5 && <span className="text-gray-700">·</span>}
                  {liveRemaining !== null && liveRemaining > 5 && <span className="text-gray-500">~{formatDuration(liveRemaining)} left</span>}
                </div>
              )}
              {totalInstruments > 0 && (
                <p className="text-blue-400 text-xs font-semibold mt-3">
                  {totalInstruments} instrument{totalInstruments !== 1 ? 's' : ''} found
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );

  const floats = (
    <>
      {/* Extract button */}
      <AnimatePresence>
        {anchorPoint && !isLoading && (
          <motion.div
            initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.18 }}
            className="absolute top-4 right-4 z-10"
          >
            <button
              onClick={handleExtract}
              className="flex items-center gap-2 bg-white text-gray-900 font-bold text-sm px-6 py-2.5 rounded-xl shadow-2xl hover:bg-gray-100 active:scale-95 transition-all"
            >
              Extract &amp; Download
              {pidFiles.length > 1 && <span className="text-gray-500 font-normal text-xs">({pidFiles.length} files)</span>}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Download marked image */}
      <AnimatePresence>
        {!isLoading && batchId && batchResults.some(r => r.results.length > 0) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-14 right-4 z-20"
          >
            <button
              onClick={() => downloadHighlightedImage(batchId!)}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-300 bg-gray-950/80 backdrop-blur-sm border border-white/[0.08] hover:border-white/20 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              ↓ Marked Image
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error toast */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30"
          >
            <div className="bg-red-950 border border-red-800 text-red-300 text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-500 hover:text-red-300">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <PDFViewer
        imageRef={imageRef}
        cursor={!isLoading ? 'crosshair' : 'default'}
        overlays={overlays}
        floats={floats}
        onClick={handleImageClick}
        onOpenFiles={onOpenFiles}
        onDropFiles={onDropFiles}
      />
      <StatusBar
        label={statusText.label}
        dim={(statusText as any).dim}
        accent={(statusText as any).accent}
        loading={isLoading || isPreviewLoading}
        dot={dotColor}
        rightLabel="Instrumentation"
      />
    </div>
  );
};

export default PIDAnalyserPage;
