import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import {
  fetchLibrary,
  saveLibrarySymbol,
  updateLibrarySymbol,
  deleteLibrarySymbol,
  type LibrarySymbol,
} from '../../services/mto';
import PDFViewer from '../../components/workspace/PDFViewer';
import StatusBar from '../../components/workspace/StatusBar';
import { useWorkspace } from '../../contexts/WorkspaceContext';
import { useProject } from '../../contexts/ProjectContext';
import { useMtoSessions } from './hooks/useMtoSessions';
import { useMtoDetection } from './hooks/useMtoDetection';
import { useMtoExports } from './hooks/useMtoExports';

// ── Utilities ─────────────────────────────────────────────────────────────────

const truncate = (name: string, max = 36) =>
  name.length > max ? `${name.slice(0, max - 1)}…` : name;

// ── Component ─────────────────────────────────────────────────────────────────

interface PipingMTOPageProps {
  onOpenFiles: () => void;
  onDropFiles?: (files: File[]) => void;
}

const PipingMTOPage: React.FC<PipingMTOPageProps> = ({ onOpenFiles, onDropFiles }) => {
  const { pidFiles, currentPidIndex, pageCount, isPreviewLoading, zoom, setZoom, baseDims } = useWorkspace();
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
    clearAllSessions,
    cancelPending,
    totalCount: totalMtoCount,
  } = useMtoSessions(pidFiles);

  const [mtoThreshold, setMtoThreshold] = useState(0.70);
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

  const { exportAllMtoCsv, exportMtoExcel, downloadMtoImage, exportMtoPDF, mtoExportingPdf, mtoImageDownloading } = useMtoExports({
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

  const mtoRunningCountRef = useRef(0);

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

  const cropBoxToBase64 = (box: { x1: number; y1: number; x2: number; y2: number }, opts?: { maxDim?: number; format?: 'png' | 'jpeg'; quality?: number }): string => {
    try {
      const img = imageRef.current;
      if (!img || !img.complete) return '';
      const bw = box.x2 - box.x1, bh = box.y2 - box.y1;
      if (bw < 2 || bh < 2) return '';
      const scale = opts?.maxDim ? Math.min(1, opts.maxDim / Math.max(bw, bh)) : 1;
      const canvas = document.createElement('canvas');
      canvas.width  = Math.max(1, Math.round(bw * scale));
      canvas.height = Math.max(1, Math.round(bh * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(img, box.x1, box.y1, bw, bh, 0, 0, canvas.width, canvas.height);
      const mime = opts?.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      return canvas.toDataURL(mime, opts?.quality ?? 0.92).split(',')[1] ?? '';
    } catch { return ''; }
  };

  // ── MTO handlers ────────────────────────────────────────────────────────────

  const addStagedTemplate = () => {
    if (!pendingBox) return;
    const n = stagedTemplates.length + mtoSessions.length + 1;
    const label = pendingLabel.trim() || `Symbol ${n}`;

    if (recaptureTarget) {
      const templateImage = cropBoxToBase64(pendingBox, { format: 'jpeg', quality: 0.92 });
      const thumbnail     = cropBoxToBase64(pendingBox, { maxDim: 96, format: 'png' });
      if (templateImage) {
        updateLibrarySymbol(recaptureTarget.id, { name: label, thumbnail, templateImage })
          .then(updated => setLibrarySymbols(prev => prev.map(s => s.id === updated.id ? updated : s)))
          .catch(() => setMtoError('Library update failed.'));
      } else {
        setMtoError('Could not crop symbol image — try drawing the box again.');
      }
      setRecaptureTarget(null);
    } else if (saveToLibrary) {
      const templateImage = cropBoxToBase64(pendingBox, { format: 'jpeg', quality: 0.92 });
      const thumbnail     = cropBoxToBase64(pendingBox, { maxDim: 96, format: 'png' });
      if (templateImage) {
        const entry: LibrarySymbol = {
          id: Date.now().toString(), name: label, thumbnail,
          templateImage, createdAt: new Date().toISOString(),
        };
        saveLibrarySymbol(entry)
          .then(saved => setLibrarySymbols(prev => [...prev, saved]))
          .catch(() => setMtoError('Symbol added to queue but library save failed.'));
      } else {
        setMtoError('Could not crop symbol image — try drawing the box again.');
      }
    }

    const drawnThumbnail = cropBoxToBase64(pendingBox, { maxDim: 96, format: 'png' });
    setStagedTemplates(prev => [...prev, { id: Date.now().toString(), label, box: pendingBox!, thumbnail: drawnThumbnail || undefined }]);
    setPendingBox(null); setPendingLabel('');
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
    setPendingBox(box);
    setPendingLabel(recaptureTarget ? recaptureTarget.name : `Symbol ${n}`);
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
      .map(sym => ({ id: sym.id, label: sym.name, templateImage: sym.templateImage, thumbnail: sym.thumbnail }));
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

  // ── Status text ─────────────────────────────────────────────────────────────

  const statusText = (() => {
    if (!pidFiles.length) return { label: 'Open a P&ID file to begin' };
    if (isPreviewLoading) return { label: 'Loading…' };
    if (mtoLoading) {
      const filePart = pidFiles.length > 1 ? `${mtoProgress} / ${pidFiles.length} drawings` : '';
      return { label: 'Searching…', dim: filePart || undefined };
    }
    if (mtoStep === 'labeling') return { label: 'Label this symbol', dim: '· Enter a name then click Add' };
    if (mtoStep === 'pick_template') {
      if (recaptureTarget) return { label: `Re-capturing: ${recaptureTarget.name}`, dim: '· Drag a new box — press Esc to cancel' };
      if (stagedTemplates.length > 0) return { label: `${stagedTemplates.length} symbol${stagedTemplates.length > 1 ? 's' : ''} queued`, dim: '· Draw another, or Search Whole Page' };
      if (mtoSessions.length > 0) return { label: 'Add another symbol type', dim: '· Drag a box around a new template' };
      return { label: 'Step 1', dim: '· Drag a box around one symbol to use as template' };
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
      {/* Detected session boxes */}
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
              return (fr?.matches ?? []).map((m, i) => (
                <rect
                  key={`${session.id}-${i}`}
                  x={m.x1} y={m.y1} width={m.x2 - m.x1} height={m.y2 - m.y1}
                  fill={mtoEditMode ? `${session.color}18` : 'none'}
                  stroke={session.color} strokeWidth={10}
                  strokeOpacity={m.score >= 0.85 ? 1.0 : m.score >= 0.75 ? 0.65 : 0.4}
                  onClick={mtoEditMode ? (e) => { e.stopPropagation(); removeMatch(session.id, currentPidIndex, i); } : undefined}
                >
                  <title>{session.label} — score {m.score.toFixed(3)}{mtoEditMode ? ' · click to remove' : ''}</title>
                </rect>
              ));
            })}
            {/* Match zone: dashed bounding box */}
            {mtoSessions.map(session => {
              if (showMatchZone !== session.id) return null;
              const fr = session.fileResults[currentPidIndex];
              if (!fr?.matches.length) return null;
              const allX = fr.matches.flatMap(m => [m.x1, m.x2]), allY = fr.matches.flatMap(m => [m.y1, m.y2]);
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

      {/* Staged template boxes */}
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
        const popupW = 232;
        const cx = bLeft + (bRight - bLeft) / 2;
        const popupLeft = Math.max(4, Math.min(cx - popupW / 2, img.clientWidth - popupW - 4));
        const popupTop = Math.min(bBottom + 10, img.clientHeight - 120);
        return (
          <div
            className="absolute z-30 bg-gray-950 border border-white/[0.12] rounded-xl shadow-2xl p-3.5"
            style={{ left: popupLeft, top: popupTop, width: popupW }}
            onMouseDown={e => e.stopPropagation()}
          >
            <p className="text-[11px] text-gray-500 mb-2">
              {recaptureTarget ? `Re-capturing: ${recaptureTarget.name}` : 'Label this symbol'}
            </p>
            <input
              autoFocus type="text" value={pendingLabel}
              onChange={e => setPendingLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addStagedTemplate(); } if (e.key === 'Escape') cancelPending(); }}
              placeholder='e.g. Ball Valve 1"'
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-2 text-xs text-white placeholder:text-gray-600 outline-none focus:border-white/[0.22] mb-2.5"
            />
            {!recaptureTarget && (
              <label className="flex items-center gap-2 mb-2.5 cursor-pointer select-none">
                <input type="checkbox" checked={saveToLibrary} onChange={e => setSaveToLibrary(e.target.checked)} className="w-3 h-3 accent-emerald-400" />
                <span className="text-[11px] text-gray-400">Save to symbol library</span>
              </label>
            )}
            <div className="flex gap-1.5">
              <button onClick={addStagedTemplate} className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors ${recaptureTarget ? 'text-white bg-emerald-600 hover:bg-emerald-500' : 'text-gray-900 bg-white hover:bg-gray-100'}`}>
                {recaptureTarget ? 'Update Library Symbol' : 'Add Symbol'}
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
              <p className="text-white font-semibold text-sm">Searching for symbols…</p>
              <p className="text-gray-500 text-xs mt-1">
                {mtoRunningCountRef.current > 0 ? `${mtoRunningCountRef.current} symbol type${mtoRunningCountRef.current > 1 ? 's' : ''}` : ''}
                {pidFiles.length > 1 ? ` · ${mtoProgress} / ${pidFiles.length} drawings` : pageCount > 1 ? ` · ${pageCount} pages` : ''}
              </p>
              <button onClick={cancelDetection} className="mt-3 text-[11px] text-red-400 hover:text-red-300 border border-red-900 hover:border-red-700 px-3 py-1 rounded-lg transition-colors">Stop</button>
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
            <div className="bg-gray-950/95 backdrop-blur-sm border border-white/[0.10] rounded-xl overflow-hidden min-w-[230px] max-w-[268px]">

              {/* Library section */}
              {librarySymbols.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-2">
                    <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider mb-2">Symbol Library · {librarySymbols.length}</p>
                    <div className="space-y-1">
                      {librarySymbols.map(sym => {
                        const selected = selectedLibraryIds.has(sym.id);
                        return (
                          <div key={sym.id} className={`flex items-center gap-2 rounded-lg px-2 py-1 transition-colors ${selected ? 'bg-emerald-500/15 border border-emerald-500/30' : 'hover:bg-white/[0.04] border border-transparent'}`}>
                            <button onClick={() => toggleLibrarySelection(sym.id)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                              {sym.thumbnail && <img src={`data:image/png;base64,${sym.thumbnail}`} alt={sym.name} className="w-8 h-8 object-contain rounded border border-white/[0.08] bg-white/[0.03] shrink-0" />}
                              <span className={`text-xs flex-1 truncate ${selected ? 'text-emerald-300' : 'text-gray-300'}`}>{sym.name}</span>
                              {selected && <span className="text-emerald-400 text-[10px] font-bold shrink-0">✓</span>}
                            </button>
                            <button onClick={() => deleteFromLibrary(sym.id)} className="text-gray-700 hover:text-red-400 transition-colors shrink-0" title="Remove from library"><X className="w-3 h-3" /></button>
                          </div>
                        );
                      })}
                    </div>
                    {selectedLibraryIds.size > 0 && (
                      <button onClick={searchSelectedLibrarySymbols} className="w-full mt-2 text-xs font-bold text-gray-900 bg-emerald-400 hover:bg-emerald-300 px-3 py-1.5 rounded-lg transition-colors">
                        Stage {selectedLibraryIds.size} Selected →
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
                    <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider mb-2">Queued · {stagedTemplates.length}</p>
                    <div className="space-y-1.5">
                      {stagedTemplates.map(t => (
                        <div key={t.id} className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                          <span className="text-xs text-gray-300 flex-1 truncate">{t.label}</span>
                          <button onClick={() => removeStagedTemplate(t.id)} className="text-gray-600 hover:text-red-400 transition-colors"><X className="w-3 h-3" /></button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="px-4 pt-1 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-600 shrink-0">Threshold</span>
                      <input type="number" min={0.40} max={0.95} step={0.01} value={mtoThreshold}
                        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0.40 && v <= 0.95) setMtoThreshold(+v.toFixed(2)); }}
                        className="w-20 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-xs text-white font-mono outline-none focus:border-emerald-500 transition-colors"
                      />
                      <span className="text-[10px] text-gray-600">(0.40 – 0.95)</span>
                    </div>
                  </div>
                  <div className="px-4 pt-1 pb-3">
                    <button onClick={handleMtoRunAll} disabled={mtoLoading} className="w-full text-xs font-bold text-gray-900 bg-white hover:bg-gray-100 disabled:opacity-50 px-3 py-2 rounded-lg transition-colors">
                      {pidFiles.length > 1 ? `Search All ${pidFiles.length} Drawings` : pageCount > 1 ? `Search All ${pageCount} Pages` : 'Search Whole Page'}
                    </button>
                  </div>
                </>
              )}

              {stagedTemplates.length > 0 && mtoSessions.length > 0 && <div className="border-t border-white/[0.06]" />}

              {/* Results section */}
              {mtoSessions.length > 0 && (
                <>
                  <div className="px-4 pt-3 pb-2 space-y-2">
                    {mtoSessions.map(session => (
                      <div key={session.id}>
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: session.color }} />
                          <span className="text-xs text-gray-300 flex-1 truncate">{session.label}</span>
                          <span className={`text-xs font-bold tabular-nums w-6 text-right ${session.count === 0 ? 'text-amber-400' : 'text-white'}`}>{session.count === 0 ? '!' : session.count}</span>
                          <button onClick={() => setShowMatchZone(v => v === session.id ? null : session.id)} title={showMatchZone === session.id ? 'Hide match zone' : 'Show match zone on drawing'} className={`text-[12px] transition-colors ${showMatchZone === session.id ? 'text-yellow-400' : 'text-gray-600 hover:text-yellow-400'}`}>⊡</button>
                          <button onClick={() => rerunSession(session)} disabled={mtoLoading} title="Re-run with current sensitivity" className="text-gray-600 hover:text-emerald-400 disabled:opacity-30 transition-colors">↺</button>
                          <button onClick={() => setMtoSessions(prev => prev.filter(s => s.id !== session.id))} className="text-gray-600 hover:text-red-400 transition-colors"><X className="w-3 h-3" /></button>
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
                      <button onClick={() => setMtoEditMode(v => !v)} title={mtoEditMode ? 'Exit edit mode' : 'Click detected boxes to remove false positives'}
                        className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${mtoEditMode ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : 'border-white/[0.08] text-gray-600 hover:text-gray-400 hover:border-white/20'}`}>
                        {mtoEditMode ? '✓ editing' : 'edit'}
                      </button>
                      <span className="text-sm font-bold text-white tabular-nums">{totalMtoCount}</span>
                    </div>
                  </div>

                  <div className="px-4 pb-3 border-t border-white/[0.06] pt-2">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] text-gray-600 shrink-0">Threshold</span>
                      <input type="number" min={0.40} max={0.95} step={0.01} value={mtoThreshold}
                        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0.40 && v <= 0.95) setMtoThreshold(+v.toFixed(2)); }}
                        className="w-20 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-xs text-white font-mono outline-none focus:border-emerald-500 transition-colors"
                      />
                      <span className="text-[10px] text-gray-600">(0.40 – 0.95)</span>
                    </div>
                    <button onClick={() => { mtoSessions.forEach(s => rerunSession(s)); }} disabled={mtoLoading} className="w-full text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 disabled:opacity-30 border border-emerald-900 hover:border-emerald-700 py-1.5 rounded-lg transition-colors">
                      ↺ Re-run All
                    </button>
                  </div>

                  <div className="px-4 pb-3 border-t border-white/[0.06] pt-2 flex flex-col gap-1.5">
                    <button onClick={exportMtoExcel} className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors text-right">Export Excel (with images)</button>
                    <button onClick={exportAllMtoCsv} className="text-xs font-semibold text-gray-500 hover:text-gray-300 transition-colors text-right">Export CSV</button>
                    <button onClick={exportMtoPDF} disabled={mtoExportingPdf} className="text-xs font-semibold text-purple-400 hover:text-purple-300 disabled:opacity-40 transition-colors text-right">
                      {mtoExportingPdf ? 'Building PDF…' : 'Export PDF Report'}
                    </button>
                    <button onClick={downloadMtoImage} disabled={mtoImageDownloading} className="text-xs font-semibold text-blue-400 hover:text-blue-300 disabled:opacity-40 transition-colors text-right">
                      {mtoImageDownloading ? 'Preparing images…' : pidFiles.length > 1 ? `Download Images (${pidFiles.length})` : 'Download Image'}
                    </button>
                    <button onClick={clearAllSessions} className="text-xs text-gray-600 hover:text-red-400 transition-colors text-right">Clear All</button>
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
      {/* Library button bar */}
      {librarySymbols.length > 0 && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.06] bg-gray-950 overflow-x-auto">
          <span className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider shrink-0">Library</span>
          {librarySymbols.map(sym => {
            const selected = selectedLibraryIds.has(sym.id);
            const isRecapturing = recaptureTarget?.id === sym.id;
            return (
              <div key={sym.id} className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => toggleLibrarySelection(sym.id)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-medium transition-colors ${isRecapturing ? 'bg-amber-500/20 border-amber-500/50 text-amber-300' : selected ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300' : 'bg-white/[0.04] border-white/[0.08] text-gray-400 hover:text-white hover:border-white/20'}`}
                >
                  {sym.thumbnail && <img src={`data:image/png;base64,${sym.thumbnail}`} alt="" className="w-5 h-5 object-contain rounded shrink-0" />}
                  {sym.name}
                  {selected && !isRecapturing && <span className="text-emerald-400 text-[10px]">✓</span>}
                  {isRecapturing && <span className="text-amber-400 text-[10px]">draw…</span>}
                </button>
                <button onClick={() => { setRecaptureTarget(sym); setMtoStep('pick_template'); setMtoError(null); }} title="Re-draw template" className="text-gray-600 hover:text-amber-400 transition-colors text-xs px-0.5">✏</button>
              </div>
            );
          })}
          {selectedLibraryIds.size > 0 && (
            <button onClick={searchSelectedLibrarySymbols} className="shrink-0 ml-1 px-3 py-1 rounded-lg text-xs font-bold text-gray-900 bg-emerald-400 hover:bg-emerald-300 transition-colors">
              Search {selectedLibraryIds.size} →
            </button>
          )}
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
