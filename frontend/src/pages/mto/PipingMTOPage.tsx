import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RotateCcw, ScanLine, Pencil, FileSpreadsheet, FileDown, FileText, Image, Trash2, PackageCheck, Filter, Play, Layers, AlertTriangle, ShieldCheck } from 'lucide-react';
import {
  emptyMtoMetadata,
  fetchLibrary,
  inferMtoMetadata,
  saveLibrarySymbol,
  updateLibrarySymbol,
  deleteLibrarySymbol,
  type LibrarySymbol,
  type MtoMetadata,
} from '../../services/mto';
import PDFViewer from '../../components/workspace/PDFViewer';
import StatusBar from '../../components/workspace/StatusBar';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useProject } from '../../contexts/ProjectContext';
import { useMtoSessions } from './hooks/useMtoSessions';
import { useMtoDetection } from './hooks/useMtoDetection';
import { useMtoExports } from './hooks/useMtoExports';

// ── Utilities ─────────────────────────────────────────────────────────────────

// ── Component ─────────────────────────────────────────────────────────────────

interface PipingMTOPageProps {
  onOpenFiles: () => void;
  onDropFiles?: (files: File[]) => void;
}

const PipingMTOPage: React.FC<PipingMTOPageProps> = ({ onOpenFiles, onDropFiles }) => {
  const { pidFiles, currentPidIndex, currentPage, pageCount, isPreviewLoading } = useWorkspace();
  const { project } = useProject();

  // ── Hooks ──────────────────────────────────────────────────────────────────

  const {
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
    totalCount: totalMtoCount,
  } = useMtoSessions(pidFiles);

  const [mtoThreshold, setMtoThreshold] = useState(0.80);
  const [mtoError, setMtoError] = useState<string | null>(null);
  const [mtoEditMode, setMtoEditMode] = useState(false);

  const { mtoLoading, mtoProgress, runTemplates, rerunSession, cancel: cancelDetection } = useMtoDetection({
    pidFiles,
    mtoThreshold,
    mtoSessions,
    onAddSessions: addSessions,
    onUpdateSession: updateSession,
    onError: setMtoError,
  });

  const imageRef = useRef<HTMLImageElement>(null);

  const { exportAllMtoCsv, exportMtoExcel, exportClientMtoPackage, downloadMtoImage, exportMtoPDF, mtoExportingPdf, mtoExportingPackage, mtoImageDownloading } = useMtoExports({
    mtoSessions,
    pidFiles,
    currentPidIndex,
    imageRef,
    project,
    totalCount: totalMtoCount,
  });

  // ── Library state ──────────────────────────────────────────────────────────

  const [librarySymbols, setLibrarySymbols] = useState<LibrarySymbol[]>([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<string>>(new Set());
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [recaptureTarget, setRecaptureTarget] = useState<LibrarySymbol | null>(null);
  const [pendingMetadata, setPendingMetadata] = useState<MtoMetadata>(emptyMtoMetadata());
  const [showMtoDetails, setShowMtoDetails] = useState(false);
  const [componentFilter, setComponentFilter] = useState('');

  const mtoRunningCountRef = useRef(0);
  const filteredLibrarySymbols = useMemo(() => {
    const q = componentFilter.trim().toLowerCase();
    if (!q) return librarySymbols;
    return librarySymbols.filter(sym => {
      const meta = sym.metadata;
      return [
        sym.name,
        meta?.itemType,
        meta?.categoryName,
        meta?.pipingClass,
        meta?.sizeInch,
        meta?.rating,
      ].some(value => String(value ?? '').toLowerCase().includes(q));
    });
  }, [librarySymbols, componentFilter]);
  const selectedCount = selectedLibraryIds.size;
  const visibleSelectedCount = filteredLibrarySymbols.filter(sym => selectedLibraryIds.has(sym.id)).length;
  const readyCount = stagedTemplates.length;
  const reviewStats = useMemo(() => {
    const lowConfidence = mtoSessions.reduce(
      (sum, session) => sum + session.fileResults.reduce(
        (n, fr) => n + fr.matches.filter(m => m.score < 0.75).length,
        0,
      ),
      0,
    );
    const zeroCount = mtoSessions.filter(session => session.count === 0).length;
    const missingSize = mtoSessions.reduce(
      (sum, session) => sum + session.fileResults.reduce(
        (n, fr) => n + fr.matches.filter(m => !m.sizeInch).length,
        0,
      ),
      0,
    );
    const aiReview = mtoSessions.reduce(
      (sum, session) => sum + session.fileResults.reduce(
        (n, fr) => n + fr.matches.filter(m => m.aiDecision === 'REVIEW').length,
        0,
      ),
      0,
    );
    const aiRejected = mtoSessions.reduce(
      (sum, session) => sum + session.fileResults.reduce(
        (n, fr) => n + fr.matches.filter(m => m.aiDecision === 'REJECT').length,
        0,
      ),
      0,
    );
    const incomplete = mtoSessions.filter(session => {
      const meta = session.metadata;
      return !meta?.itemType || !meta?.categoryName;
    }).length;
    let overlaps = 0;
    for (let fileIndex = 0; fileIndex < pidFiles.length; fileIndex += 1) {
      const matches = mtoSessions.flatMap(session =>
        (session.fileResults[fileIndex]?.matches ?? []).map(match => ({ sessionId: session.id, match })),
      );
      for (let i = 0; i < matches.length; i += 1) {
        for (let j = i + 1; j < matches.length; j += 1) {
          if ((matches[i].match.page ?? 1) !== (matches[j].match.page ?? 1)) continue;
          const a = matches[i].match, b = matches[j].match;
          const ix1 = Math.max(a.x1, b.x1), iy1 = Math.max(a.y1, b.y1);
          const ix2 = Math.min(a.x2, b.x2), iy2 = Math.min(a.y2, b.y2);
          const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
          const areaA = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
          const areaB = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
          const union = areaA + areaB - inter;
          if (union > 0 && inter / union >= 0.45) overlaps += 1;
        }
      }
    }
    return {
      lowConfidence,
      zeroCount,
      incomplete,
      overlaps,
      missingSize,
      aiReview,
      aiRejected,
      issueCount: lowConfidence + zeroCount + incomplete + overlaps + missingSize + aiReview + aiRejected,
    };
  }, [mtoSessions, pidFiles.length]);

  // Load library on mount
  useEffect(() => {
    fetchLibrary().then(setLibrarySymbols).catch(() => {});
  }, []);

  // Reset edit mode when files change
  useEffect(() => {
    setMtoError(null);
    setMtoEditMode(false);
    setSelectedLibraryIds(new Set());
    setRecaptureTarget(null);
    setPendingMetadata(emptyMtoMetadata());
    setShowMtoDetails(false);
    setComponentFilter('');
  }, [pidFiles]);

  // Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || mtoLoading) return;
      if (mtoStep === 'labeling') cancelPending();
      else if (recaptureTarget) setRecaptureTarget(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mtoLoading, mtoStep, recaptureTarget, cancelPending]);

  // ── Coordinate helpers ──────────────────────────────────────────────────────

  const toImageCoords = (clientX: number, clientY: number) => {
    if (!imageRef.current) return null;
    const img = imageRef.current;
    const rect = img.getBoundingClientRect();
    const px = Math.max(0, Math.min(clientX - rect.left, img.clientWidth));
    const py = Math.max(0, Math.min(clientY - rect.top, img.clientHeight));
    const scaleX = img.naturalWidth / img.clientWidth;
    const scaleY = img.naturalHeight / img.clientHeight;
    return { px, py, ix: Math.round(px * scaleX), iy: Math.round(py * scaleY) };
  };

  const toDisplay = (box: { x1: number; y1: number; x2: number; y2: number }) => {
    const img = imageRef.current;
    if (!img) return null;
    return {
      left: (box.x1 / img.naturalWidth) * img.clientWidth,
      top: (box.y1 / img.naturalHeight) * img.clientHeight,
      width: ((box.x2 - box.x1) / img.naturalWidth) * img.clientWidth,
      height: ((box.y2 - box.y1) / img.naturalHeight) * img.clientHeight,
    };
  };

  // ── Canvas crop helper ──────────────────────────────────────────────────────

  const cropBoxToBase64 = (box: { x1: number; y1: number; x2: number; y2: number }, opts?: { maxDim?: number; format?: 'png' | 'jpeg'; quality?: number; trimWhitespace?: boolean }): string => {
    try {
      const img = imageRef.current;
      if (!img || !img.complete) return '';
      const bw = box.x2 - box.x1, bh = box.y2 - box.y1;
      if (bw < 2 || bh < 2) return '';

      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bw));
      canvas.height = Math.max(1, Math.round(bh));
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(img, box.x1, box.y1, bw, bh, 0, 0, canvas.width, canvas.height);

      let sourceCanvas = canvas;
      if (opts?.trimWhitespace !== false) {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let minX = canvas.width, minY = canvas.height, maxX = -1, maxY = -1;
        for (let y = 0; y < canvas.height; y += 1) {
          for (let x = 0; x < canvas.width; x += 1) {
            const i = (y * canvas.width + x) * 4;
            const alpha = data[i + 3];
            if (alpha === 0) continue;
            const luminance = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
            if (luminance >= 245) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
        if (maxX >= minX && maxY >= minY) {
          const pad = 2;
          const sx = Math.max(0, minX - pad);
          const sy = Math.max(0, minY - pad);
          const sw = Math.min(canvas.width, maxX + pad + 1) - sx;
          const sh = Math.min(canvas.height, maxY + pad + 1) - sy;
          const trimmed = document.createElement('canvas');
          trimmed.width = Math.max(1, sw);
          trimmed.height = Math.max(1, sh);
          const trimmedCtx = trimmed.getContext('2d');
          if (!trimmedCtx) return '';
          trimmedCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, trimmed.width, trimmed.height);
          sourceCanvas = trimmed;
        }
      }

      const scale = opts?.maxDim ? Math.min(1, opts.maxDim / Math.max(sourceCanvas.width, sourceCanvas.height)) : 1;
      const output = document.createElement('canvas');
      output.width = Math.max(1, Math.round(sourceCanvas.width * scale));
      output.height = Math.max(1, Math.round(sourceCanvas.height * scale));
      const outputCtx = output.getContext('2d');
      if (!outputCtx) return '';
      outputCtx.drawImage(sourceCanvas, 0, 0, sourceCanvas.width, sourceCanvas.height, 0, 0, output.width, output.height);
      const mime = opts?.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      return output.toDataURL(mime, opts?.quality ?? 0.92).split(',')[1] ?? '';
    } catch { return ''; }
  };

  // ── MTO handlers ────────────────────────────────────────────────────────────

  const addStagedTemplate = () => {
    if (!pendingBox) return;
    const n = stagedTemplates.length + mtoSessions.length + 1;
    const label = pendingLabel.trim() || `Component ${n}`;
    const metadata = inferMtoMetadata(label, pendingMetadata);
    const templateImage = cropBoxToBase64(pendingBox, { format: 'jpeg', quality: 0.92 });
    const thumbnail = cropBoxToBase64(pendingBox, { maxDim: 96, format: 'png' });

    if (recaptureTarget) {
      if (templateImage) {
        updateLibrarySymbol(recaptureTarget.id, { name: label, thumbnail, templateImage, metadata })
          .then(updated => setLibrarySymbols(prev => prev.map(s => s.id === updated.id ? updated : s)))
          .catch(() => setMtoError('Library update failed.'));
      } else {
        setMtoError('Could not capture component image — try drawing the box again.');
      }
      setRecaptureTarget(null);
    } else if (saveToLibrary) {
      if (templateImage) {
        const entry: LibrarySymbol = {
          id: Date.now().toString(), name: label, thumbnail,
          templateImage, createdAt: new Date().toISOString(), metadata,
        };
        saveLibrarySymbol(entry)
          .then(saved => setLibrarySymbols(prev => [...prev, saved]))
          .catch(() => setMtoError('Component added to MTO but library save failed.'));
      } else {
        setMtoError('Could not capture component image — try drawing the box again.');
      }
    }

    setStagedTemplates(prev => [...prev, { id: Date.now().toString(), label, box: pendingBox!, templateImage: templateImage || undefined, thumbnail: thumbnail || undefined, metadata }]);
    setPendingBox(null); setPendingLabel('');
    setPendingMetadata(emptyMtoMetadata());
    setShowMtoDetails(false);
    setSaveToLibrary(false); setMtoStep('pick_template');
  };

  const removeStagedTemplate = (id: string) => setStagedTemplates(prev => prev.filter(t => t.id !== id));

  // ── Mouse handlers ──────────────────────────────────────────────────────────

  const handleMouseDown = (e: React.MouseEvent) => {
    if (mtoStep !== 'pick_template' || mtoLoading) return;
    e.preventDefault();
    const coords = toImageCoords(e.clientX, e.clientY);
    if (!coords) return;
    dragAnchorRef.current = coords;
    setDragAnchor(coords);
    setDragHead({ px: coords.px, py: coords.py });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragAnchorRef.current || !imageRef.current) return;
    const img = imageRef.current;
    const rect = img.getBoundingClientRect();
    setDragHead({
      px: Math.max(0, Math.min(e.clientX - rect.left, img.clientWidth)),
      py: Math.max(0, Math.min(e.clientY - rect.top, img.clientHeight)),
    });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (!dragAnchorRef.current) return;
    const anchor = dragAnchorRef.current;
    const coords = toImageCoords(e.clientX, e.clientY);
    dragAnchorRef.current = null; setDragAnchor(null); setDragHead(null);
    if (!coords) return;
    const box = {
      x1: Math.min(anchor.ix, coords.ix), y1: Math.min(anchor.iy, coords.iy),
      x2: Math.max(anchor.ix, coords.ix), y2: Math.max(anchor.iy, coords.iy),
    };
    if (box.x2 - box.x1 < 5 || box.y2 - box.y1 < 5) return;
    const n = stagedTemplates.length + mtoSessions.length + 1;
    const initialLabel = recaptureTarget ? recaptureTarget.name : `Component ${n}`;
    setPendingBox(box);
    setPendingLabel(initialLabel);
    setPendingMetadata(inferMtoMetadata(initialLabel, recaptureTarget?.metadata));
    setMtoStep('labeling');
  };

  // ── Detection runners ───────────────────────────────────────────────────────

  const handleMtoRunAll = async () => {
    if (!stagedTemplates.length || !pidFiles.length) return;
    setMtoError(null);
    setMtoStep('running');
    const toRun = [...stagedTemplates];
    mtoRunningCountRef.current = toRun.length;
    setStagedTemplates([]);
    try {
      await runTemplates(toRun);
    } catch {
      setStagedTemplates(toRun);
    }
    mtoRunningCountRef.current = 0;
    setMtoStep('pick_template');
  };

  const searchSelectedLibrarySymbols = async () => {
    if (!pidFiles.length || mtoLoading) return;
    const toRun = librarySymbols
      .filter(s => selectedLibraryIds.has(s.id))
      .map(sym => ({ id: sym.id, label: sym.name, templateImage: sym.templateImage, thumbnail: sym.thumbnail, metadata: inferMtoMetadata(sym.name, sym.metadata) }));
    if (!toRun.length) return;
    setSelectedLibraryIds(new Set());
    setMtoError(null);
    mtoRunningCountRef.current = toRun.length;
    try {
      await runTemplates(toRun);
    } catch { /* error set by hook */ }
    mtoRunningCountRef.current = 0;
  };

  // ── Library helpers ─────────────────────────────────────────────────────────

  const toggleLibrarySelection = (id: string) => {
    setSelectedLibraryIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const deleteFromLibrary = (id: string) => {
    setLibrarySymbols(prev => prev.filter(s => s.id !== id));
    setSelectedLibraryIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    deleteLibrarySymbol(id).catch(() => {});
  };

  const updatePendingMetadata = (key: keyof MtoMetadata, value: string) => {
    setPendingMetadata(prev => ({ ...prev, [key]: value }));
  };

  // ── Status text ─────────────────────────────────────────────────────────────

  const statusText = (() => {
    if (!pidFiles.length) return { label: 'Open a P&ID file to begin' };
    if (isPreviewLoading) return { label: 'Loading…' };
    if (mtoLoading) {
      const filePart = pidFiles.length > 1 ? `${mtoProgress} / ${pidFiles.length} drawings` : '';
      return { label: 'Preparing MTO…', dim: filePart || undefined };
    }
    if (mtoStep === 'labeling') return { label: 'Define component', dim: '· Name the item and add MTO details' };
    if (mtoStep === 'pick_template') {
      if (recaptureTarget) return { label: `Updating component: ${recaptureTarget.name}`, dim: '· Drag a new box — press Esc to cancel' };
      if (stagedTemplates.length > 0) return { label: `${stagedTemplates.length} component${stagedTemplates.length > 1 ? 's' : ''} ready`, dim: '· Add another, or Prepare MTO' };
      if (mtoSessions.length > 0) return { label: 'Add another component type', dim: '· Drag a box around a valve, instrument, or fitting' };
      return { label: 'Step 1', dim: '· Pick one valve, instrument, or fitting tightly from the drawing' };
    }
    return { label: 'Piping MTO' };
  })();

  const dotColor = (() => {
    if (mtoLoading || isPreviewLoading) return 'blue' as const;
    if (mtoSessions.length > 0) return 'emerald' as const;
    if (stagedTemplates.length > 0) return 'green' as const;
    if (pidFiles.length > 0) return 'gray' as const;
    return undefined;
  })();

  // ── SVG overlays ─────────────────────────────────────────────────────────────

  const mtoOverlays = (
    <>
      {/* Detected item boxes */}
      {mtoSessions.length > 0 && imageRef.current && (() => {
        const fr0 = mtoSessions.find(s => s.fileResults[currentPidIndex])?.fileResults[currentPidIndex];
        if (!fr0) return null;
        return (
          <svg
            className={`absolute top-0 left-0 z-10 ${mtoEditMode ? 'cursor-pointer' : 'pointer-events-none'}`}
            width={imageRef.current!.clientWidth} height={imageRef.current!.clientHeight}
            viewBox={`0 0 ${fr0.imageWidth} ${fr0.imageHeight}`} preserveAspectRatio="none"
          >
            {mtoSessions.flatMap(session => {
              const fr = session.fileResults[currentPidIndex];
              return (fr?.matches ?? [])
                .map((m, originalIndex) => ({ m, originalIndex }))
                .filter(({ m }) => (m.page ?? 1) === currentPage)
                .map(({ m, originalIndex }, i) => (
                <rect
                  key={`${session.id}-${i}`}
                  x={m.x1} y={m.y1} width={m.x2 - m.x1} height={m.y2 - m.y1}
                  fill={mtoEditMode ? `${session.color}18` : 'none'}
                  stroke={session.color} strokeWidth={10}
                  strokeOpacity={m.score >= 0.85 ? 1.0 : m.score >= 0.75 ? 0.65 : 0.4}
                  onClick={mtoEditMode ? (e) => { e.stopPropagation(); removeMatch(session.id, currentPidIndex, originalIndex); } : undefined}
                >
                  <title>{session.label} — page {m.page ?? 1}{m.sizeInch ? ` — size ${m.sizeInch}"${m.sizeConfidence ? ` (${Math.round(m.sizeConfidence * 100)}% size confidence)` : ''}` : ' — size not read'} — confidence {m.score.toFixed(3)}{mtoEditMode ? ' · click to remove' : ''}</title>
                </rect>
              ));
            })}
            {/* Match zone: dashed bounding box */}
            {mtoSessions.map(session => {
              if (showMatchZone !== session.id) return null;
              const fr = session.fileResults[currentPidIndex];
              if (!fr?.matches.length) return null;
              const pageMatches = fr.matches.filter(m => (m.page ?? 1) === currentPage);
              if (!pageMatches.length) return null;
              const allX = pageMatches.flatMap(m => [m.x1, m.x2]), allY = pageMatches.flatMap(m => [m.y1, m.y2]);
              const pad = 30;
              const zx1 = Math.max(0, Math.min(...allX) - pad), zy1 = Math.max(0, Math.min(...allY) - pad);
              const zx2 = Math.min(fr.imageWidth, Math.max(...allX) + pad), zy2 = Math.min(fr.imageHeight, Math.max(...allY) + pad);
              return (
                <rect key={`zone-${session.id}`} x={zx1} y={zy1} width={zx2 - zx1} height={zy2 - zy1}
                  fill="none" stroke={session.color} strokeWidth={24} strokeDasharray="70 35"
                  strokeOpacity={0.65} className="pointer-events-none" />
              );
            })}
          </svg>
        );
      })()}

      {/* Prepared component boxes */}
      {stagedTemplates.map(t => {
        if (!t.box) return null;
        const d = toDisplay(t.box); if (!d) return null;
        return (
          <div key={t.id} className="absolute pointer-events-none border-2 border-green-400 z-10" style={d}>
            <span className="absolute -top-5 left-0 text-[9px] bg-green-500 text-white px-1 py-0.5 rounded whitespace-nowrap font-medium">{t.label}</span>
          </div>
        );
      })}

      {/* Pending box (dashed) */}
      {pendingBox && (() => { const d = toDisplay(pendingBox); if (!d) return null; return (
        <div className="absolute pointer-events-none border-2 border-dashed border-green-300 bg-green-400/10 z-10" style={d} />
      ); })()}

      {/* Label popup */}
      {mtoStep === 'labeling' && pendingBox && imageRef.current && (() => {
        const img = imageRef.current!;
        const bLeft = (pendingBox.x1 / img.naturalWidth) * img.clientWidth;
        const bRight = (pendingBox.x2 / img.naturalWidth) * img.clientWidth;
        const bBottom = (pendingBox.y2 / img.naturalHeight) * img.clientHeight;
        const popupW = showMtoDetails ? 390 : 232;
        const popupH = showMtoDetails ? 420 : 120;
        const cx = bLeft + (bRight - bLeft) / 2;
        const popupLeft = Math.max(4, Math.min(cx - popupW / 2, img.clientWidth - popupW - 4));
        const popupTop = Math.min(bBottom + 10, Math.max(4, img.clientHeight - popupH - 4));
        return (
          <div
            className="absolute z-30 bg-gray-950 border border-white/[0.12] rounded-xl shadow-2xl p-3.5 overflow-auto"
            style={{ left: popupLeft, top: popupTop, width: popupW, maxHeight: popupH }}
            onMouseDown={e => e.stopPropagation()}
          >
            <p className="text-[11px] text-gray-500 mb-2">
              {recaptureTarget ? `Updating: ${recaptureTarget.name}` : 'Define component'}
            </p>
            <input
              autoFocus type="text" value={pendingLabel}
              onChange={e => {
                setPendingLabel(e.target.value);
                setPendingMetadata(prev => inferMtoMetadata(e.target.value, prev));
              }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addStagedTemplate(); } if (e.key === 'Escape') cancelPending(); }}
              placeholder='e.g. Ball Valve 1"'
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-2 text-xs text-white placeholder:text-gray-600 outline-none focus:border-white/[0.22] mb-2.5"
            />
            <button
              onClick={() => setShowMtoDetails(v => !v)}
              className="w-full flex items-center justify-between text-[11px] text-gray-400 hover:text-white border border-white/[0.08] hover:border-white/[0.18] rounded-lg px-2.5 py-1.5 mb-2.5 transition-colors"
            >
              <span>MTO deliverable fields</span>
              <span className="text-gray-600">{showMtoDetails ? 'hide' : 'show'}</span>
            </button>
            {showMtoDetails && (
              <div className="grid grid-cols-2 gap-1.5 mb-2.5">
                {[
                  ['categoryCode', 'Cat. Code'],
                  ['categoryName', 'Category'],
                  ['itemType', 'Item Type'],
                  ['pipingClass', 'Piping Class'],
                  ['sizeInch', 'Size'],
                  ['rating', 'Rating'],
                  ['valveBore', 'Bore'],
                  ['endConnection', 'End Conn.'],
                  ['dataSheetDocumentNo', 'Data Sheet Doc'],
                  ['dataSheetReferenceNo', 'Data Sheet Ref'],
                ].map(([key, label]) => (
                  <input
                    key={key}
                    value={pendingMetadata[key as keyof MtoMetadata] ?? ''}
                    onChange={e => updatePendingMetadata(key as keyof MtoMetadata, e.target.value)}
                    placeholder={label}
                    className="min-w-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-[11px] text-white placeholder:text-gray-700 outline-none focus:border-white/[0.2]"
                  />
                ))}
                <textarea
                  value={pendingMetadata.materialDescription}
                  onChange={e => updatePendingMetadata('materialDescription', e.target.value)}
                  placeholder="Material Description"
                  rows={2}
                  className="col-span-2 min-w-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-[11px] text-white placeholder:text-gray-700 outline-none focus:border-white/[0.2] resize-none"
                />
                <input
                  value={pendingMetadata.remarks}
                  onChange={e => updatePendingMetadata('remarks', e.target.value)}
                  placeholder="Remarks"
                  className="col-span-2 min-w-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-1.5 text-[11px] text-white placeholder:text-gray-700 outline-none focus:border-white/[0.2]"
                />
              </div>
            )}
            {!recaptureTarget && (
              <label className="flex items-center gap-2 mb-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={saveToLibrary} onChange={e => setSaveToLibrary(e.target.checked)} className="w-3 h-3 accent-emerald-400" />
                <span className="text-[11px] text-gray-400">Save to component library</span>
              </label>
            )}
            <div className="flex gap-1.5">
              <button onClick={addStagedTemplate} className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors ${recaptureTarget ? 'text-white bg-emerald-600 hover:bg-emerald-500' : 'text-gray-900 bg-white hover:bg-gray-100'}`}>
                {recaptureTarget ? 'Update Component' : 'Add Component'}
              </button>
              <button onClick={cancelPending} className="flex-1 text-xs text-gray-500 hover:text-gray-300 border border-white/[0.08] py-1.5 rounded-lg transition-colors">Cancel</button>
            </div>
          </div>
        );
      })()}

      {/* Rubber band */}
      {dragAnchor && dragHead && (
        <div
          className="absolute pointer-events-none border-2 border-dashed border-yellow-400 bg-yellow-400/10 z-20"
          style={{ left: Math.min(dragAnchor.px, dragHead.px), top: Math.min(dragAnchor.py, dragHead.py), width: Math.abs(dragHead.px - dragAnchor.px), height: Math.abs(dragHead.py - dragAnchor.py) }}
        />
      )}

      {/* MTO loading overlay */}
      {mtoLoading && (
        <>
          <div className="absolute inset-0 bg-gray-950/55" />
          <motion.div
            className="absolute left-0 right-0 h-[2px] bg-emerald-400 pointer-events-none z-10"
            style={{ boxShadow: '0 0 14px 4px rgba(52,211,153,0.55)' }}
            animate={{ top: ['0%', '100%'] }} transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
          />
          <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
            <div className="bg-gray-950/90 backdrop-blur-sm border border-white/10 rounded-2xl px-6 py-5 text-center min-w-[220px]">
              <p className="text-white font-semibold text-sm">Preparing MTO…</p>
              <p className="text-gray-500 text-xs mt-1">
                {mtoRunningCountRef.current > 0 ? `${mtoRunningCountRef.current} component type${mtoRunningCountRef.current > 1 ? 's' : ''}` : ''}
                {pidFiles.length > 1 ? ` · ${mtoProgress} / ${pidFiles.length} drawings` : pageCount > 1 ? ` · ${pageCount} pages` : ''}
              </p>
              <button onClick={cancelDetection} className="mt-4 text-xs font-semibold text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 px-4 py-1.5 rounded-lg transition-colors">Stop MTO</button>
            </div>
          </div>
        </>
      )}
    </>
  );

  const mtoFloats = (
    <>
      {/* Results panel */}
      <AnimatePresence>
        {(librarySymbols.length > 0 || stagedTemplates.length > 0 || mtoSessions.length > 0) && (
          <motion.div
            initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.18 }}
            className="absolute top-4 right-4 z-20"
          >
            <div className="bg-gray-950/95 backdrop-blur-sm border border-white/[0.10] rounded-xl overflow-hidden min-w-[260px] max-w-[310px] max-h-[calc(100vh-132px)] overflow-y-auto shadow-2xl [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.35)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/20">
              <div className="px-4 py-3 border-b border-white/[0.06]">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider">Piping MTO</p>
                    <p className="text-xs text-gray-300 truncate">
                      {mtoSessions.length > 0 ? `${mtoSessions.length} component group${mtoSessions.length > 1 ? 's' : ''}` : readyCount > 0 ? `${readyCount} ready` : `${librarySymbols.length} in library`}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-right">
                    <p className="text-[9px] text-gray-600 uppercase">Total</p>
                    <p className="text-sm text-white font-bold tabular-nums leading-4">{totalMtoCount}</p>
                  </div>
                </div>
              </div>

              {/* Component setup section */}
              {librarySymbols.length > 0 && stagedTemplates.length === 0 && mtoSessions.length === 0 && (
                <>
                  <div className="px-4 pt-3 pb-3">
                    <div className="flex items-center justify-between mb-2.5">
                      <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider">Component Selection</p>
                      <button
                        onClick={() => setSelectedLibraryIds(prev => {
                          if (visibleSelectedCount === filteredLibrarySymbols.length && filteredLibrarySymbols.length > 0) {
                            const next = new Set(prev);
                            filteredLibrarySymbols.forEach(s => next.delete(s.id));
                            return next;
                          }
                          return new Set([...Array.from(prev), ...filteredLibrarySymbols.map(s => s.id)]);
                        })}
                        className="text-[10px] text-gray-600 hover:text-gray-300 transition-colors"
                      >
                        {visibleSelectedCount === filteredLibrarySymbols.length && filteredLibrarySymbols.length > 0 ? 'clear' : 'all visible'}
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 mb-2.5">
                      <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-2">
                        <p className="text-[10px] text-gray-600 uppercase">Available</p>
                        <p className="text-sm text-white font-bold tabular-nums">{librarySymbols.length}</p>
                      </div>
                      <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-2">
                        <p className="text-[10px] text-gray-600 uppercase">Selected</p>
                        <p className="text-sm text-emerald-300 font-bold tabular-nums">{selectedLibraryIds.size}</p>
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-2 py-2 mb-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] text-gray-600 uppercase">Visible</span>
                        <span className="text-xs text-gray-300 tabular-nums">{filteredLibrarySymbols.length}</span>
                      </div>
                      {componentFilter && (
                        <button onClick={() => setComponentFilter('')} className="mt-1 text-[10px] text-gray-600 hover:text-gray-300 transition-colors">clear filter</button>
                      )}
                    </div>
                    {selectedLibraryIds.size > 0 && (
                      <button onClick={searchSelectedLibrarySymbols} className="w-full mt-2 text-xs font-bold text-gray-900 bg-emerald-400 hover:bg-emerald-300 px-3 py-1.5 rounded-lg transition-colors">
                        Add {selectedLibraryIds.size} to MTO →
                      </button>
                    )}
                  </div>
                  <div className="border-t border-white/[0.06]" />
                </>
              )}

              {/* Staged section */}
              {stagedTemplates.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-1">
                    <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider mb-2">Ready for MTO · {stagedTemplates.length}</p>
                    <div className="space-y-1.5">
                      {stagedTemplates.map(t => (
                        <div key={t.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-1.5">
                          {t.thumbnail ? (
                            <img src={`data:image/png;base64,${t.thumbnail}`} alt="" className="w-8 h-8 object-contain rounded bg-white/[0.04] border border-white/[0.06] shrink-0" />
                          ) : (
                            <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                          )}
                          <span className="text-xs text-gray-300 flex-1 truncate">{t.label}</span>
                          <button onClick={() => removeStagedTemplate(t.id)} className="text-gray-600 hover:text-red-400 transition-colors"><X className="w-3 h-3" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="px-4 pt-1 pb-2">
                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2 py-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[10px] text-gray-600 uppercase">Pixel exactness</span>
                        <span className="text-xs text-gray-300 font-mono">{mtoThreshold.toFixed(2)}</span>
                      </div>
                      <input type="range" min={0.55} max={0.95} step={0.01} value={mtoThreshold}
                        onChange={e => setMtoThreshold(+parseFloat(e.target.value).toFixed(2))}
                        className="w-full accent-emerald-400"
                      />
                      <input type="number" min={0.55} max={0.95} step={0.01} value={mtoThreshold}
                        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0.55 && v <= 0.95) setMtoThreshold(+v.toFixed(2)); }}
                        className="mt-1.5 w-full rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-xs text-white font-mono outline-none focus:border-emerald-500 transition-colors"
                      />
                    </div>
                  </div>
                  <div className="px-4 pt-1 pb-3">
                    <button onClick={handleMtoRunAll} disabled={mtoLoading} className="w-full flex items-center justify-center gap-1.5 text-xs font-bold text-gray-900 bg-white hover:bg-gray-100 disabled:opacity-50 px-3 py-2 rounded-lg transition-colors">
                      <Play className="w-3.5 h-3.5" />
                      {pidFiles.length > 1 ? `Prepare MTO for ${pidFiles.length} Drawings` : pageCount > 1 ? `Prepare MTO for ${pageCount} Pages` : 'Prepare MTO'}
                    </button>
                  </div>
                </>
              )}

              {stagedTemplates.length > 0 && mtoSessions.length > 0 && <div className="border-t border-white/[0.06]" />}

              {/* Results section */}
              {mtoSessions.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-2">
                    <div className={`rounded-lg border px-2.5 py-2 ${reviewStats.issueCount ? 'border-amber-500/25 bg-amber-500/[0.07]' : 'border-emerald-500/25 bg-emerald-500/[0.06]'}`}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {reviewStats.issueCount ? <AlertTriangle className="w-3.5 h-3.5 text-amber-300 shrink-0" /> : <ShieldCheck className="w-3.5 h-3.5 text-emerald-300 shrink-0" />}
                          <span className={`text-[11px] font-semibold ${reviewStats.issueCount ? 'text-amber-200' : 'text-emerald-200'}`}>
                            {reviewStats.issueCount ? 'Review required' : 'Ready to export'}
                          </span>
                        </div>
                        {reviewStats.overlaps > 0 && (
                          <button
                            onClick={() => resolveOverlaps()}
                            className="shrink-0 rounded-md bg-white text-gray-950 hover:bg-gray-200 px-2 py-1 text-[10px] font-bold transition-colors"
                          >
                            Resolve overlaps
                          </button>
                        )}
                      </div>
                      {reviewStats.issueCount > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-amber-100/75">
                          {reviewStats.overlaps > 0 && <span>{reviewStats.overlaps} overlap{reviewStats.overlaps > 1 ? 's' : ''}</span>}
                          {reviewStats.lowConfidence > 0 && <span>{reviewStats.lowConfidence} low confidence</span>}
                          {reviewStats.zeroCount > 0 && <span>{reviewStats.zeroCount} zero count</span>}
                          {reviewStats.incomplete > 0 && <span>{reviewStats.incomplete} incomplete data</span>}
                          {reviewStats.missingSize > 0 && <span>{reviewStats.missingSize} size not read</span>}
                          {reviewStats.aiReview > 0 && <span>{reviewStats.aiReview} AI review</span>}
                          {reviewStats.aiRejected > 0 && <span>{reviewStats.aiRejected} AI rejected</span>}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="px-4 pt-1 pb-2 space-y-2">
                    {mtoSessions.map(session => (
                      <div key={session.id}>
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: session.color }} />
                          <span className="text-xs text-gray-300 flex-1 truncate">{session.label}</span>
                          {(() => {
                            const sizes = Array.from(new Set(session.fileResults.flatMap(fr => fr.matches.map(m => m.sizeInch).filter(Boolean)))) as string[];
                            return sizes.length > 0 ? (
                              <span className="text-[10px] text-gray-500 max-w-[96px] truncate" title={sizes.join(', ')}>{sizes.slice(0, 3).join(', ')}{sizes.length > 3 ? '…' : ''}</span>
                            ) : null;
                          })()}
                          {(() => {
                            const decisions = session.fileResults.flatMap(fr => fr.matches.map(m => m.aiDecision).filter(Boolean));
                            if (decisions.includes('REJECT')) return <span className="text-[9px] font-bold text-red-300 border border-red-400/30 rounded px-1">AI reject</span>;
                            if (decisions.includes('REVIEW')) return <span className="text-[9px] font-bold text-amber-300 border border-amber-400/30 rounded px-1">AI review</span>;
                            if (decisions.includes('ACCEPT')) return <span className="text-[9px] font-bold text-emerald-300 border border-emerald-400/30 rounded px-1">AI ok</span>;
                            return null;
                          })()}
                          <span className={`text-xs font-bold tabular-nums w-6 text-right ${session.count === 0 ? 'text-amber-400' : 'text-white'}`}>{session.count === 0 ? '!' : session.count}</span>
                          <button onClick={() => setShowMatchZone(v => v === session.id ? null : session.id)} title={showMatchZone === session.id ? 'Hide item extent' : 'Show item extent'} className={`transition-colors ${showMatchZone === session.id ? 'text-yellow-400' : 'text-gray-600 hover:text-yellow-400'}`}><ScanLine className="w-3 h-3" /></button>
                          <button onClick={() => rerunSession(session)} disabled={mtoLoading} title="Re-prepare this item" className="text-gray-600 hover:text-emerald-400 disabled:opacity-30 transition-colors"><RotateCcw className="w-3 h-3" /></button>
                          <button onClick={() => setMtoSessions(prev => prev.filter(s => s.id !== session.id))} title="Remove" className="text-gray-600 hover:text-red-400 transition-colors"><X className="w-3 h-3" /></button>
                        </div>
                        {session.fileResults.length > 1 && (
                          <div className="flex flex-wrap gap-x-2.5 gap-y-0 mt-0.5 pl-5">
                            {session.fileResults.map((fr, fi) => (
                              <span key={fi} className={`text-[10px] ${fi === currentPidIndex ? 'text-gray-400' : 'text-gray-600'}`}>D{fi + 1}:<span className="ml-0.5">{fr.count}</span></span>
                            ))}
                          </div>
                        )}
                        {session.fileResults.length === 1 && (session.fileResults[0]?.pageCounts.length ?? 0) > 1 && (
                          <div className="flex flex-wrap gap-x-2.5 gap-y-0 mt-0.5 pl-5">
                            {session.fileResults[0].pageCounts.map(pc => (
                              <span key={pc.page} className="text-[10px] text-gray-600">P{pc.page}:<span className="text-gray-500 ml-0.5">{pc.count}</span></span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <div className="mx-4 border-t border-white/[0.06] py-2 flex items-center justify-between">
                    <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider">Total</span>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setMtoEditMode(v => !v)} title={mtoEditMode ? 'Exit edit mode' : 'Click detected items to remove false positives'}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${mtoEditMode ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'border-white/[0.08] text-gray-600 hover:text-gray-400 hover:border-white/20'}`}>
                        {mtoEditMode ? '✓ editing' : 'edit'}
                      </button>
                      <span className="text-sm font-bold text-white tabular-nums">{totalMtoCount}</span>
                    </div>
                  </div>

                  <div className="px-4 pb-3 border-t border-white/[0.06] pt-2">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] text-gray-600 shrink-0">Pixel exactness</span>
                      <input type="number" min={0.55} max={0.95} step={0.01} value={mtoThreshold}
                        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0.55 && v <= 0.95) setMtoThreshold(+v.toFixed(2)); }}
                        className="w-20 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-xs text-white font-mono outline-none focus:border-emerald-500 transition-colors"
                      />
                      <span className="text-[10px] text-gray-600">(0.55-0.95)</span>
                    </div>
                    <button
                      onClick={() => { mtoSessions.forEach(s => rerunSession(s)); }}
                      disabled={mtoLoading}
                      className="w-full flex items-center justify-center gap-1.5 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 disabled:opacity-30 bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/25 hover:border-emerald-500/40 py-1.5 rounded-lg transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" /> Re-prepare All
                    </button>
                  </div>

                  <div className="px-4 pb-3 border-t border-white/[0.06] pt-2 space-y-1">
                    <p className="text-[10px] font-semibold text-gray-600 uppercase tracking-wider mb-2">Export</p>
                    {[
                      { icon: PackageCheck,   label: mtoExportingPackage ? 'Packaging…' : 'EPC Package', sub: 'xlsx + QA', onClick: () => exportClientMtoPackage(mtoThreshold), disabled: mtoExportingPackage },
                      { icon: FileSpreadsheet, label: 'Excel', sub: 'with images', onClick: exportMtoExcel, disabled: false },
                      { icon: FileText,        label: 'CSV',   sub: undefined,       onClick: exportAllMtoCsv,  disabled: false },
                      { icon: FileDown,        label: mtoExportingPdf ? 'Building…' : 'PDF Report', sub: undefined, onClick: exportMtoPDF, disabled: mtoExportingPdf },
                      { icon: Image,           label: mtoImageDownloading ? 'Preparing…' : pidFiles.length > 1 ? `Images (${pidFiles.length})` : 'Image', sub: 'marked up', onClick: downloadMtoImage, disabled: mtoImageDownloading },
                    ].map(({ icon: Icon, label, sub, onClick, disabled }) => (
                      <button
                        key={label}
                        onClick={onClick}
                        disabled={disabled}
                        className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-white/[0.05] disabled:opacity-40 transition-colors group"
                      >
                        <Icon className="w-3.5 h-3.5 text-gray-500 group-hover:text-gray-300 shrink-0 transition-colors" />
                        <span className="text-xs text-gray-400 group-hover:text-gray-200 transition-colors flex-1">{label}</span>
                        {sub && <span className="text-[10px] text-gray-700">{sub}</span>}
                      </button>
                    ))}
                    <button
                      onClick={clearAllSessions}
                      className="w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg text-left hover:bg-red-500/10 transition-colors group mt-1"
                    >
                      <Trash2 className="w-3.5 h-3.5 text-gray-700 group-hover:text-red-400 shrink-0 transition-colors" />
                      <span className="text-xs text-gray-600 group-hover:text-red-400 transition-colors">Clear MTO</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error toast */}
      <AnimatePresence>
        {mtoError && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30">
            <div className="bg-red-950 border border-red-800 text-red-300 text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
              <span>{mtoError}</span>
              <button onClick={() => setMtoError(null)} className="text-red-500 hover:text-red-300"><X className="w-3.5 h-3.5" /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Component library tray */}
      {librarySymbols.length > 0 && (
        <div className="shrink-0 flex items-start gap-2 px-3 py-2 border-b border-white/[0.06] bg-gray-950 overflow-hidden">
          <div className="shrink-0 min-w-[96px]">
            <div className="flex items-center gap-1.5 h-7">
              <Layers className="w-3.5 h-3.5 text-gray-600" />
              <span className="text-[10px] text-gray-500 font-semibold uppercase tracking-wider">Components</span>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-gray-700">
              <span>{librarySymbols.length} saved</span>
              {readyCount > 0 && <span>{readyCount} ready</span>}
            </div>
          </div>
          <div className="shrink-0 relative">
            <Filter className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-700 pointer-events-none" />
            <input
              value={componentFilter}
              onChange={e => setComponentFilter(e.target.value)}
              placeholder="Filter"
              className="h-7 w-28 rounded-md border border-white/[0.08] bg-white/[0.04] pl-7 pr-2 text-[11px] text-gray-300 placeholder:text-gray-700 outline-none focus:border-white/[0.18]"
            />
          </div>
          <div className="flex-1 min-w-0 flex flex-wrap content-start items-center gap-1.5 max-h-[74px] overflow-y-auto overflow-x-hidden pr-2 pb-1 [scrollbar-width:thin] [scrollbar-color:rgba(148,163,184,0.45)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-white/25 hover:[&::-webkit-scrollbar-thumb]:bg-white/35">
            {filteredLibrarySymbols.map(sym => {
              const selected = selectedLibraryIds.has(sym.id);
              const isRecapturing = recaptureTarget?.id === sym.id;
              return (
                <div key={sym.id} className="flex items-center gap-0.5 min-w-0 max-w-[184px]">
                  <button
                    onClick={() => toggleLibrarySelection(sym.id)}
                    title={sym.name}
                    className={`min-w-0 flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[11px] font-medium transition-colors ${isRecapturing ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : selected ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-white/[0.04] border-white/[0.08] text-gray-400 hover:text-white hover:border-white/20'}`}
                  >
                    {sym.thumbnail && <img src={`data:image/png;base64,${sym.thumbnail}`} alt="" className="w-5 h-5 object-contain rounded-sm shrink-0" />}
                    <span className="truncate">{sym.name}</span>
                    {selected && !isRecapturing && <span className="text-emerald-400 text-[10px] shrink-0">✓</span>}
                    {isRecapturing && <span className="text-amber-400 text-[10px] shrink-0">draw</span>}
                  </button>
                  <button onClick={() => { setRecaptureTarget(sym); setPendingMetadata(inferMtoMetadata(sym.name, sym.metadata)); setShowMtoDetails(true); setMtoStep('pick_template'); setMtoError(null); }} title="Re-capture component / edit MTO fields" className="w-5 h-5 flex items-center justify-center rounded text-gray-600 hover:text-amber-400 hover:bg-white/[0.05] transition-colors shrink-0"><Pencil className="w-3 h-3" /></button>
                  <button onClick={() => deleteFromLibrary(sym.id)} title="Remove component" className="w-5 h-5 flex items-center justify-center rounded text-gray-700 hover:text-red-400 hover:bg-white/[0.05] transition-colors shrink-0"><X className="w-3 h-3" /></button>
                </div>
              );
            })}
            {filteredLibrarySymbols.length === 0 && (
              <span className="text-[11px] text-gray-700 h-7 flex items-center">No matching components</span>
            )}
          </div>
          <button
            onClick={() => setSelectedLibraryIds(prev => {
              if (visibleSelectedCount === filteredLibrarySymbols.length && filteredLibrarySymbols.length > 0) {
                const next = new Set(prev);
                filteredLibrarySymbols.forEach(s => next.delete(s.id));
                return next;
              }
              return new Set([...Array.from(prev), ...filteredLibrarySymbols.map(s => s.id)]);
            })}
            disabled={filteredLibrarySymbols.length === 0}
            className="shrink-0 px-2 py-1.5 rounded-md text-[11px] font-semibold text-gray-500 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            {visibleSelectedCount === filteredLibrarySymbols.length && filteredLibrarySymbols.length > 0 ? 'Clear' : 'All'}
          </button>
          <button
            onClick={searchSelectedLibrarySymbols}
            disabled={selectedLibraryIds.size === 0}
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-gray-950 bg-white hover:bg-gray-200 disabled:bg-white/[0.08] disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
          >
            <Play className="w-3.5 h-3.5" />
            Prepare MTO {selectedLibraryIds.size || ''}
          </button>
        </div>
      )}

      <PDFViewer
        imageRef={imageRef}
        cursor={mtoStep === 'pick_template' && !mtoLoading ? 'crosshair' : 'default'}
        overlays={mtoOverlays}
        floats={mtoFloats}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { dragAnchorRef.current = null; setDragAnchor(null); setDragHead(null); }}
        onOpenFiles={onOpenFiles}
        onDropFiles={onDropFiles}
      />

      <StatusBar
        label={statusText.label}
        dim={(statusText as any).dim}
        loading={mtoLoading || isPreviewLoading}
        dot={dotColor}
        rightLabel="Piping MTO"
      />
    </div>
  );
};

export default PipingMTOPage;
