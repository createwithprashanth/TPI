import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  processInstruMapFilesAsync,
  getJobStatus,
  generateInstruMapPreview,
  downloadBatchResults,
  detectPipingSymbolAllPages,
  detectFromLibraryTemplate,
  fetchLibrary,
  saveLibrarySymbol,
  deleteLibrarySymbol,
  downloadHighlightedImage,
  JobStatusResponse,
  ProjectInfo,
} from '../services/instrumap';
import {
  FolderOpen, X, FileUp, ChevronDown, ChevronUp, BoxSelect,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

interface AnchorPoint { x: number; y: number; }
interface Box { x1: number; y1: number; x2: number; y2: number; }

interface BatchResult {
  fileName: string;
  results: any[];
  error: string | null;
}

interface LibrarySymbol {
  id: string;
  name: string;
  thumbnail: string;     // small base64 PNG for display
  templateImage: string; // full-res base64 PNG for matching
  createdAt: string;
}

interface StagedTemplate {
  id: string;
  label: string;
  box?: Box;             // user-drawn selection
  templateImage?: string; // from library
}

interface MtoSession {
  id: string;
  label: string;
  color: string;
  templateBox: Box;
  matches: { x1: number; y1: number; x2: number; y2: number; score: number }[];
  count: number;
  imageWidth: number;
  imageHeight: number;
  pageCounts: { page: number; count: number }[];
}

type WorkspaceView = 'pid' | 'piping';
type MtoStep = 'pick_template' | 'labeling' | 'running';

const SESSION_COLORS = [
  '#ef4444', '#3b82f6', '#22c55e', '#f59e0b',
  '#a855f7', '#ec4899', '#14b8a6', '#f97316',
];

// ── Project details ──────────────────────────────────────────────────────────

const STORAGE_KEY = 'instrumap_project';

function loadProject(): ProjectInfo {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { project_name: '', project_no: '', client_name: '', contractor_name: '', location: '' };
}

function saveProject(p: ProjectInfo) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}


// ── NavItem ──────────────────────────────────────────────────────────────────

const NavItem: React.FC<{
  icon: React.ElementType;
  label: string;
  active: boolean;
  onClick: () => void;
}> = ({ icon: Icon, label, active, onClick }) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
      active
        ? 'bg-white/[0.08] text-white font-medium'
        : 'text-gray-500 hover:text-gray-300 hover:bg-white/[0.04]'
    }`}
  >
    <Icon className="w-4 h-4 shrink-0" />
    {label}
  </button>
);

// ── Main Page ─────────────────────────────────────────────────────────────────

const InstruMapPage: React.FC = () => {
  const [view, setView] = useState<WorkspaceView>('pid');
  const [project, setProjectState] = useState<ProjectInfo>(loadProject);
  const [showProjectForm, setShowProjectForm] = useState(false);

  // P&ID state
  const [pidFiles, setPidFiles] = useState<File[]>([]);
  const [hdPreviewBase64, setHdPreviewBase64] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [anchorPoint, setAnchorPoint] = useState<AnchorPoint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [batchResults, setBatchResults] = useState<BatchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [areaCode, setAreaCode] = useState('');
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [currentFileName, setCurrentFileName] = useState('');
  const [jobStatus, setJobStatus] = useState<'queued' | 'started' | 'finished' | 'failed' | null>(null);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [progressStage, setProgressStage] = useState<string | null>(null);
  const [estimatedSecondsRemaining, setEstimatedSecondsRemaining] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Piping MTO state
  const [mtoStep, setMtoStep] = useState<MtoStep>('pick_template');
  const [stagedTemplates, setStagedTemplates] = useState<StagedTemplate[]>([]);
  const [pendingBox, setPendingBox] = useState<Box | null>(null);
  const [pendingLabel, setPendingLabel] = useState('');
  const [mtoSessions, setMtoSessions] = useState<MtoSession[]>([]);
  const [mtoError, setMtoError] = useState<string | null>(null);
  const [mtoLoading, setMtoLoading] = useState(false);
  const [mtoThreshold, setMtoThreshold] = useState(0.70);

  // Symbol library
  const [librarySymbols, setLibrarySymbols] = useState<LibrarySymbol[]>([]);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<Set<string>>(new Set());
  const [saveToLibrary, setSaveToLibrary] = useState(false);

  // Rubber-band drag
  const [dragAnchor, setDragAnchor] = useState<{ px: number; py: number; ix: number; iy: number } | null>(null);
  const [dragHead, setDragHead] = useState<{ px: number; py: number } | null>(null);

  // Zoom
  const [zoom, setZoom] = useState(1.0);
  const [baseDims, setBaseDims] = useState<{ w: number; h: number } | null>(null);

  // PDF page count (for multi-page detection)
  const [pageCount, setPageCount] = useState(1);
  const mtoRunningCountRef = useRef(0);

  const imageRef = useRef<HTMLImageElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedTimerRef = useRef<NodeJS.Timeout | null>(null);
  const processingStartRef = useRef<number | null>(null);
  const progressReceivedAtRef = useRef<number | null>(null);
  const dragAnchorRef = useRef<{ px: number; py: number; ix: number; iy: number } | null>(null);

  const totalInstruments = batchResults.reduce((s, r) => s + (r.results?.length || 0), 0);
  const totalMtoCount = mtoSessions.reduce((s, sess) => s + sess.count, 0);

  const setProject = (p: ProjectInfo) => { setProjectState(p); saveProject(p); };

  // Auto-load preview
  useEffect(() => {
    if (!pidFiles.length) { setHdPreviewBase64(null); setAnchorPoint(null); return; }
    const load = async () => {
      setIsPreviewLoading(true);
      setAnchorPoint(null);
      setError(null);
      try {
        const { image, pageCount: pc } = await generateInstruMapPreview(pidFiles[0]);
        setHdPreviewBase64(image);
        setPageCount(pc);
      } catch (e: any) {
        setError(e.message || 'Failed to load preview.');
      } finally {
        setIsPreviewLoading(false);
      }
    };
    load();
  }, [pidFiles]);

  // Escape key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (view === 'pid' && anchorPoint && !isLoading) setAnchorPoint(null);
      if (view === 'piping' && !mtoLoading) {
        if (mtoStep === 'labeling') cancelPending();
        else resetMto();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [anchorPoint, isLoading, view, mtoLoading, mtoStep]);

  // Cleanup
  useEffect(() => () => {
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
  }, []);

  // Load symbol library from backend on mount
  useEffect(() => {
    fetchLibrary().then(setLibrarySymbols).catch(() => {/* silent — library panel just stays empty */});
  }, []);

  // Ctrl+scroll zoom — locked during rubber-band drag
  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      if (dragAnchorRef.current) return;
      e.preventDefault();
      setZoom(z => Math.max(0.5, Math.min(4, +(z - e.deltaY * 0.002).toFixed(2))));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const truncate = (name: string, max = 36) =>
    name.length > max ? `${name.slice(0, max - 1)}…` : name;

  const handleImgLoad = () => {
    if (imageRef.current) {
      setBaseDims({ w: imageRef.current.clientWidth, h: imageRef.current.clientHeight });
    }
  };

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

  // ── MTO handlers ──────────────────────────────────────────────────────────

  const cropBoxToBase64 = (box: Box, opts?: { maxDim?: number; format?: 'png' | 'jpeg'; quality?: number }): string => {
    try {
      const img = imageRef.current;
      if (!img || !img.complete) return '';
      const bw = box.x2 - box.x1;
      const bh = box.y2 - box.y1;
      if (bw < 2 || bh < 2) return '';
      const scale = opts?.maxDim ? Math.min(1, opts.maxDim / Math.max(bw, bh)) : 1;
      const canvas = document.createElement('canvas');
      canvas.width  = Math.max(1, Math.round(bw * scale));
      canvas.height = Math.max(1, Math.round(bh * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.drawImage(img, box.x1, box.y1, bw, bh, 0, 0, canvas.width, canvas.height);
      const mime = opts?.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      const dataUrl = canvas.toDataURL(mime, opts?.quality ?? 0.92);
      const b64 = dataUrl.split(',')[1];
      return b64 ?? '';
    } catch {
      return '';
    }
  };

  const cancelPending = () => {
    setPendingBox(null);
    setPendingLabel('');
    setMtoStep('pick_template');
  };

  const addStagedTemplate = () => {
    if (!pendingBox) return;
    const n = stagedTemplates.length + mtoSessions.length + 1;
    const label = pendingLabel.trim() || `Symbol ${n}`;

    if (saveToLibrary) {
      const templateImage = cropBoxToBase64(pendingBox, { format: 'jpeg', quality: 0.92 });
      const thumbnail     = cropBoxToBase64(pendingBox, { maxDim: 96, format: 'png' });
      if (templateImage) {
        const entry: LibrarySymbol = {
          id: Date.now().toString(),
          name: label,
          thumbnail,
          templateImage,
          createdAt: new Date().toISOString(),
        };
        saveLibrarySymbol(entry)
          .then(saved => setLibrarySymbols(prev => [...prev, saved]))
          .catch(() => setMtoError('Symbol added to queue but library save failed.'));
      } else {
        setMtoError('Could not crop symbol image — try drawing the box again.');
      }
    }

    setStagedTemplates(prev => [...prev, { id: Date.now().toString(), label, box: pendingBox }]);
    setPendingBox(null);
    setPendingLabel('');
    setSaveToLibrary(false);
    setMtoStep('pick_template');
  };

  const removeStagedTemplate = (id: string) => {
    setStagedTemplates(prev => prev.filter(t => t.id !== id));
  };

  const resetMto = () => {
    setMtoStep('pick_template');
    setPendingBox(null);
    setPendingLabel('');
    setStagedTemplates([]);
    setMtoError(null);
    dragAnchorRef.current = null;
    setDragAnchor(null);
    setDragHead(null);
    setZoom(1.0);
  };

  const clearAllSessions = () => {
    setMtoSessions([]);
    resetMto();
    setMtoThreshold(0.70);
    setBaseDims(null);
  };

  const switchView = (v: WorkspaceView) => {
    setView(v);
    if (v === 'piping') {
      setPendingBox(null);
      setPendingLabel('');
      setMtoStep('pick_template');
    }
  };

  const handleMtoMouseDown = (e: React.MouseEvent) => {
    if (mtoStep !== 'pick_template' || mtoLoading) return;
    e.preventDefault();
    const coords = toImageCoords(e.clientX, e.clientY);
    if (!coords) return;
    dragAnchorRef.current = coords;
    setDragAnchor(coords);
    setDragHead({ px: coords.px, py: coords.py });
  };

  const handleMtoMouseMove = (e: React.MouseEvent) => {
    if (!dragAnchorRef.current || !imageRef.current) return;
    const img = imageRef.current;
    const rect = img.getBoundingClientRect();
    setDragHead({
      px: Math.max(0, Math.min(e.clientX - rect.left, img.clientWidth)),
      py: Math.max(0, Math.min(e.clientY - rect.top, img.clientHeight)),
    });
  };

  const handleMtoMouseUp = (e: React.MouseEvent) => {
    if (!dragAnchorRef.current) return;
    const anchor = dragAnchorRef.current;
    const coords = toImageCoords(e.clientX, e.clientY);
    dragAnchorRef.current = null;
    setDragAnchor(null);
    setDragHead(null);
    if (!coords) return;

    const box: Box = {
      x1: Math.min(anchor.ix, coords.ix),
      y1: Math.min(anchor.iy, coords.iy),
      x2: Math.max(anchor.ix, coords.ix),
      y2: Math.max(anchor.iy, coords.iy),
    };
    if (box.x2 - box.x1 < 5 || box.y2 - box.y1 < 5) return;

    const n = stagedTemplates.length + mtoSessions.length + 1;
    setPendingBox(box);
    setPendingLabel(`Symbol ${n}`);
    setMtoStep('labeling');
  };

  const handleMtoRunAll = async () => {
    if (!stagedTemplates.length || !pidFiles.length) return;
    setMtoLoading(true);
    setMtoError(null);
    setMtoStep('running');
    const toRun = [...stagedTemplates];
    mtoRunningCountRef.current = toRun.length;
    setStagedTemplates([]);

    try {
      const newSessions: MtoSession[] = [];
      for (const tmpl of toRun) {
        const colorIdx = (mtoSessions.length + newSessions.length) % SESSION_COLORS.length;
        const result = tmpl.templateImage
          ? await detectFromLibraryTemplate({
              pidFile: pidFiles[0],
              templateImageBase64: tmpl.templateImage,
              threshold: mtoThreshold,
              label: tmpl.label,
            })
          : await detectPipingSymbolAllPages({
              pidFile: pidFiles[0],
              templateBox: tmpl.box!,
              threshold: mtoThreshold,
              label: tmpl.label,
            });
        newSessions.push({
          id: `${Date.now()}-${newSessions.length}`,
          label: tmpl.label,
          color: SESSION_COLORS[colorIdx],
          templateBox: tmpl.box ?? { x1: 0, y1: 0, x2: 0, y2: 0 },
          matches: result.matches,
          count: result.total_count,
          imageWidth: result.image_width,
          imageHeight: result.image_height,
          pageCounts: result.pages.map(p => ({ page: p.page, count: p.count })),
        });
      }
      setMtoSessions(prev => [...prev, ...newSessions]);
    } catch (err: any) {
      setMtoError(err.response?.data?.detail || err.message || 'Detection failed.');
      setStagedTemplates(toRun);
    }

    mtoRunningCountRef.current = 0;
    setMtoStep('pick_template');
    setMtoLoading(false);
  };

  const toggleLibrarySelection = (id: string) => {
    setSelectedLibraryIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const stageSelectedLibrarySymbols = () => {
    const toStage = librarySymbols.filter(s => selectedLibraryIds.has(s.id));
    const newStaged: StagedTemplate[] = toStage.map(s => ({
      id: `lib-${s.id}-${Date.now()}`,
      label: s.name,
      templateImage: s.templateImage,
    }));
    setStagedTemplates(prev => [...prev, ...newStaged]);
    setSelectedLibraryIds(new Set());
  };

  const deleteFromLibrary = (id: string) => {
    setLibrarySymbols(prev => prev.filter(s => s.id !== id));
    setSelectedLibraryIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    deleteLibrarySymbol(id).catch(() => {/* best-effort */});
  };

  const removeSession = (id: string) => {
    setMtoSessions(prev => prev.filter(s => s.id !== id));
  };

  const rerunSession = async (session: MtoSession) => {
    if (!pidFiles.length || mtoLoading) return;
    setMtoLoading(true);
    setMtoError(null);
    try {
      const result = await detectPipingSymbolAllPages({
        pidFile: pidFiles[0],
        templateBox: session.templateBox,
        threshold: mtoThreshold,
        label: session.label,
      });
      setMtoSessions(prev => prev.map(s =>
        s.id === session.id
          ? { ...s, matches: result.matches, count: result.total_count, imageWidth: result.image_width, imageHeight: result.image_height, pageCounts: result.pages.map(p => ({ page: p.page, count: p.count })) }
          : s
      ));
    } catch (err: any) {
      setMtoError(err.response?.data?.detail || err.message || 'Re-run failed.');
    }
    setMtoLoading(false);
  };

  const exportAllMtoCsv = () => {
    if (!mtoSessions.length) return;

    // Collect all page numbers that appear across any session
    const allPages = Array.from(
      new Set(mtoSessions.flatMap(s => s.pageCounts.map(pc => pc.page)))
    ).sort((a, b) => a - b);

    const multiPage = allPages.length > 1;

    // Project info header rows
    const meta: (string | number)[][] = [];
    if (project.project_name) meta.push(['Project', project.project_name]);
    if (project.project_no)   meta.push(['Project No.', project.project_no]);
    if (project.client_name)  meta.push(['Client', project.client_name]);
    if (project.contractor_name) meta.push(['Contractor', project.contractor_name]);
    if (project.location)     meta.push(['Location', project.location]);
    if (meta.length) meta.push([]);

    // Column headers
    const headers = multiPage
      ? ['No.', 'Symbol', ...allPages.map(p => `Page ${p}`), 'Total Count']
      : ['No.', 'Symbol', 'Count'];

    // Data rows — one per symbol
    const dataRows = mtoSessions.map((s, i) => {
      if (multiPage) {
        const pageCols = allPages.map(p => {
          const found = s.pageCounts.find(pc => pc.page === p);
          return found ? found.count : 0;
        });
        return [i + 1, s.label, ...pageCols, s.count];
      }
      return [i + 1, s.label, s.count];
    });

    // Total row
    const totalRow = multiPage
      ? ['', 'TOTAL', ...allPages.map(p => mtoSessions.reduce((sum, s) => sum + (s.pageCounts.find(pc => pc.page === p)?.count ?? 0), 0)), totalMtoCount]
      : ['', 'TOTAL', totalMtoCount];

    const escapeCell = (v: string | number) => {
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const allRows = [...meta, headers, ...dataRows, [], totalRow];
    const csv = allRows.map(r => r.map(escapeCell).join(',')).join('\n');

    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `piping_mto_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportMtoExcel = async () => {
    if (!mtoSessions.length || !imageRef.current) return;
    const img = imageRef.current;

    // Draw the full P&ID onto an offscreen canvas once
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = img.naturalWidth;
    srcCanvas.height = img.naturalHeight;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) return;
    srcCtx.drawImage(img, 0, 0);

    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'InstruMap – Piping MTO';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Piping MTO', {
      pageSetup: { fitToPage: true, fitToWidth: 1 },
    });

    // ── Column widths ──────────────────────────────────────────────────
    const multiPage = mtoSessions.some(s => s.pageCounts.length > 1);
    sheet.columns = [
      { key: 'no',     width: 6 },
      { key: 'symbol', width: 28 },
      { key: 'image',  width: 14 },
      ...(multiPage ? [{ key: 'page', width: 8 }] : []),
      { key: 'count',  width: 8 },
    ];

    // ── Project info header ────────────────────────────────────────────
    const addMeta = (label: string, value: string) => {
      const r = sheet.addRow([label, value]);
      r.getCell(1).font = { bold: true, size: 9, color: { argb: 'FF888888' } };
      r.getCell(2).font = { size: 9 };
      r.height = 14;
    };
    if (project.project_name)     addMeta('Project',    project.project_name);
    if (project.project_no)       addMeta('Project No.', project.project_no);
    if (project.client_name)      addMeta('Client',     project.client_name);
    if (project.contractor_name)  addMeta('Contractor', project.contractor_name);
    if (project.location)         addMeta('Location',   project.location);
    if (sheet.rowCount > 0) sheet.addRow([]);

    // ── Column header row ──────────────────────────────────────────────
    const hdrValues = ['No.', 'Symbol', 'Image', ...(multiPage ? ['Page'] : []), 'Count'];
    const hdrRow = sheet.addRow(hdrValues);
    hdrRow.height = 18;
    hdrRow.eachCell(cell => {
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FF374151' } },
      };
    });

    // ── Data rows ─────────────────────────────────────────────────────
    const THUMB_W = 80;
    const THUMB_H = 60;
    const ROW_H   = 48;
    const PAD_RATIO = 0.35; // padding around the tight box

    let rowNo = 1;
    const imgColIdx = multiPage ? 3 : 3; // 1-based column C
    const countColLetter = multiPage ? 'E' : 'D';
    let firstDataRow = -1;
    let lastDataRow  = -1;

    for (const session of mtoSessions) {
      const scaleX = img.naturalWidth  / session.imageWidth;
      const scaleY = img.naturalHeight / session.imageHeight;

      // Determine page for each match (matches are page-1 only from backend)
      for (const match of session.matches) {
        const bw = (match.x2 - match.x1) * scaleX;
        const bh = (match.y2 - match.y1) * scaleY;
        const pad = Math.round(Math.min(bw, bh) * PAD_RATIO);
        const sx = Math.max(0, Math.round(match.x1 * scaleX) - pad);
        const sy = Math.max(0, Math.round(match.y1 * scaleY) - pad);
        const sw = Math.min(img.naturalWidth  - sx, Math.round(bw) + pad * 2);
        const sh = Math.min(img.naturalHeight - sy, Math.round(bh) + pad * 2);

        const crop = document.createElement('canvas');
        crop.width  = THUMB_W;
        crop.height = THUMB_H;
        const cCtx = crop.getContext('2d');
        if (!cCtx) continue;
        cCtx.fillStyle = '#ffffff';
        cCtx.fillRect(0, 0, THUMB_W, THUMB_H);
        cCtx.drawImage(srcCanvas, sx, sy, sw, sh, 0, 0, THUMB_W, THUMB_H);

        const base64 = crop.toDataURL('image/png').split(',')[1];
        const imgId  = workbook.addImage({ base64, extension: 'png' });

        const values = [rowNo++, session.label, '', ...(multiPage ? [1] : []), 1];
        const dataRow = sheet.addRow(values);
        dataRow.height = ROW_H;
        if (firstDataRow === -1) firstDataRow = dataRow.number;
        lastDataRow = dataRow.number;

        // Style data cells
        dataRow.eachCell((cell, col) => {
          cell.alignment = { vertical: 'middle', horizontal: col === 2 ? 'left' : 'center' };
          cell.font = { size: 9 };
          cell.border = { bottom: { style: 'hair', color: { argb: 'FFE5E7EB' } } };
        });
        // Color swatch in symbol cell
        dataRow.getCell(2).font = { size: 9, color: { argb: 'FF' + session.color.replace('#', '') } };

        // Embed thumbnail — anchor to image column
        sheet.addImage(imgId, {
          tl: { col: imgColIdx - 1, row: dataRow.number - 1 },
          br: { col: imgColIdx,     row: dataRow.number },
          editAs: 'oneCell',
        } as any);
      }
    }

    // ── Total row ──────────────────────────────────────────────────────
    sheet.addRow([]);
    const totalRow = sheet.addRow(['', 'TOTAL', '', ...(multiPage ? [''] : []), '']);
    totalRow.height = 18;
    totalRow.getCell(2).font = { bold: true, size: 10 };
    const totalCell = totalRow.getCell(multiPage ? 5 : 4);
    totalCell.font = { bold: true, size: 11 };
    // SUM formula — user can delete false-positive rows and total updates automatically
    if (firstDataRow > 0) {
      totalCell.value = {
        formula: `SUM(${countColLetter}${firstDataRow}:${countColLetter}${lastDataRow})`,
        result: totalMtoCount,
      } as any;
    } else {
      totalCell.value = 0;
    }
    totalCell.border = { top: { style: 'thin', color: { argb: 'FF374151' } } };

    // ── Write ──────────────────────────────────────────────────────────
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `piping_mto_${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadMtoImage = () => {
    const img = imageRef.current;
    if (!img || !mtoSessions.length) return;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight);

    ctx.lineWidth = 10;
    for (const session of mtoSessions) {
      ctx.strokeStyle = session.color;
      for (const m of session.matches) {
        ctx.strokeRect(m.x1, m.y1, m.x2 - m.x1, m.y2 - m.y1);
      }
    }

    const pad = 24, swatchW = 40, swatchH = 28, lineH = 44, fontSize = 28;
    ctx.font = `bold ${fontSize}px sans-serif`;
    let ly = pad;
    for (const session of mtoSessions) {
      ctx.fillStyle = session.color;
      ctx.fillRect(pad, ly, swatchW, swatchH);
      ctx.fillStyle = '#000000';
      ctx.fillText(`${session.label}: ${session.count}`, pad + swatchW + 10, ly + swatchH - 4);
      ly += lineH;
    }
    ctx.fillStyle = '#000000';
    ctx.fillText(`Total: ${totalMtoCount}`, pad, ly + swatchH - 4);

    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'piping_mto_annotated.jpg';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/jpeg', 0.92);
  };

  // ── P&ID handlers ─────────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setPidFiles(files);
    setBatchResults([]);
    setError(null);
    setBatchId(null);
    setJobStatus(null);
    setZoom(1.0);
    setBaseDims(null);
    setPageCount(1);
    clearAllSessions();
    e.target.value = '';
  };

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
      setJobStatus(null);
      setQueuePosition(null);
      setProgressMessage(null);
      setProgressStage(null);
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

  // ── Status bar text ────────────────────────────────────────────────────────

  const STEPS = [
    { label: 'Extract', stages: ['calibration', 'extraction'] },
    { label: 'Package', stages: ['excel', 'zip'] },
  ];
  const currentStepIdx = STEPS.findIndex(s => s.stages.includes(progressStage ?? ''));

  const liveRemaining = estimatedSecondsRemaining !== null && progressReceivedAtRef.current !== null
    ? Math.max(0, estimatedSecondsRemaining - Math.floor((Date.now() - progressReceivedAtRef.current) / 1000))
    : estimatedSecondsRemaining;

  const formatDuration = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
  };

  const pidStatusText = (): { label: string; dim?: string; accent?: boolean } => {
    if (!pidFiles.length) return { label: 'Open P&ID files to begin' };
    if (isPreviewLoading) return { label: 'Loading…', dim: truncate(pidFiles[0].name) };
    if (isLoading) {
      const base = jobStatus === 'queued' ? 'In queue…' : jobStatus === 'started' ? 'Analysing…' : 'Submitting…';
      const fileInfo = pidFiles.length > 1 ? `file ${currentFileIndex + 1} of ${pidFiles.length}` : truncate(currentFileName || pidFiles[0].name);
      const countPart = totalInstruments > 0 ? `· ${totalInstruments} found` : '';
      return { label: base, dim: `${fileInfo} ${countPart}`.trim() };
    }
    if (totalInstruments > 0) return { label: `${totalInstruments} instrument${totalInstruments !== 1 ? 's' : ''} extracted`, accent: true };
    if (anchorPoint) return { label: truncate(pidFiles[0].name), dim: '· Ready to extract — press Esc to reselect' };
    return { label: truncate(pidFiles[0].name), dim: '· Click an instrument symbol to continue' };
  };

  const mtoStatusText = (): { label: string; dim?: string; accent?: boolean } => {
    if (!pidFiles.length) return { label: 'Open a P&ID file to begin' };
    if (isPreviewLoading) return { label: 'Loading…' };
    if (mtoLoading) return { label: `Searching ${stagedTemplates.length || ''}…`.trim() };
    if (mtoStep === 'labeling') return { label: 'Label this symbol', dim: '· Enter a name then click Add' };
    if (mtoStep === 'pick_template') {
      if (stagedTemplates.length > 0)
        return { label: `${stagedTemplates.length} symbol${stagedTemplates.length > 1 ? 's' : ''} queued`, dim: '· Draw another, or Search Whole Page' };
      if (mtoSessions.length > 0)
        return { label: 'Add another symbol type', dim: '· Drag a box around a new template' };
      return { label: 'Step 1', dim: '· Drag a box around one symbol to use as template' };
    }
    return { label: 'Piping MTO' };
  };

  const statusText = view === 'pid' ? pidStatusText() : mtoStatusText();

  // ── Computed display coords for overlays ─────────────────────────────────

  const toDisplay = (box: Box) => {
    const img = imageRef.current;
    if (!img) return null;
    return {
      left: (box.x1 / img.naturalWidth) * img.clientWidth,
      top: (box.y1 / img.naturalHeight) * img.clientHeight,
      width: ((box.x2 - box.x1) / img.naturalWidth) * img.clientWidth,
      height: ((box.y2 - box.y1) / img.naturalHeight) * img.clientHeight,
    };
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex bg-gray-950 overflow-hidden">

      {/* ── Left Sidebar ──────────────────────────────── */}
      <div className="w-52 shrink-0 flex flex-col border-r border-white/[0.06] bg-gray-950">
        <div className="h-11 flex items-center px-4 border-b border-white/[0.06]">
          <span className="text-white font-bold text-sm tracking-tight">InstruMap</span>
        </div>

        <nav className="flex-1 py-2 space-y-0.5 px-2">
          <NavItem icon={FileUp} label="P&ID Analyser" active={view === 'pid'} onClick={() => switchView('pid')} />
          <NavItem icon={BoxSelect} label="Piping MTO" active={view === 'piping'} onClick={() => switchView('piping')} />
        </nav>

        <div className="border-t border-white/[0.06]">
          <button
            onClick={() => setShowProjectForm(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            <span className="font-semibold uppercase tracking-wider">Project Details</span>
            {showProjectForm ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          <AnimatePresence>
            {showProjectForm && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="overflow-hidden"
              >
                <div className="px-3 pb-3 space-y-1.5">
                  {([
                    ['project_name', 'Project name'],
                    ['project_no', 'Project No.'],
                    ['client_name', 'Client'],
                    ['contractor_name', 'Contractor'],
                    ['location', 'Location'],
                  ] as [keyof ProjectInfo, string][]).map(([k, ph]) => (
                    <input
                      key={k}
                      type="text"
                      value={project[k]}
                      onChange={e => setProject({ ...project, [k]: e.target.value })}
                      placeholder={ph}
                      className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1.5 text-xs text-white placeholder:text-gray-600 outline-none focus:border-white/[0.18] transition-colors"
                    />
                  ))}
                  {project.project_name && (
                    <p className="text-[10px] text-gray-600 pt-0.5">Printed on Excel deliverables</p>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!showProjectForm && project.project_name && (
            <div className="px-4 pb-3">
              <p className="text-xs text-gray-300 font-medium truncate">{project.project_name}</p>
              {project.project_no && <p className="text-[10px] text-gray-600 truncate mt-0.5">{project.project_no}</p>}
            </div>
          )}
        </div>
      </div>

      {/* ── Main Area ──────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top bar */}
        <div className="h-11 shrink-0 flex items-center justify-between px-4 border-b border-white/[0.06] bg-gray-950 z-20">
          <div className="flex items-center gap-2.5">
            <span className="text-white font-semibold text-sm tracking-tight">
              {view === 'pid' ? 'P&ID Analyser' : 'Piping MTO'}
            </span>
            {view === 'pid' && pidFiles.length === 1 && (
              <span className="text-[11px] text-gray-500 bg-white/[0.06] px-2 py-0.5 rounded-full max-w-[220px] truncate">
                {truncate(pidFiles[0].name)}
              </span>
            )}
            {view === 'pid' && pidFiles.length > 1 && (
              <span className="text-[11px] text-gray-500 bg-white/[0.06] px-2 py-0.5 rounded-full">
                {pidFiles.length} files
              </span>
            )}
            {view === 'piping' && pidFiles.length === 1 && (
              <span className="text-[11px] text-gray-500 bg-white/[0.06] px-2 py-0.5 rounded-full max-w-[220px] truncate">
                {truncate(pidFiles[0].name)}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {view === 'pid' && (
              <input
                type="text"
                value={areaCode}
                onChange={e => setAreaCode(e.target.value)}
                placeholder="Area code"
                className="h-8 w-28 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-xs text-white placeholder:text-gray-500 outline-none transition-colors focus:border-white/[0.16]"
              />
            )}

            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-900 bg-white hover:bg-gray-100 px-3 py-1.5 rounded-md transition-colors"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              Open Files
            </button>

            {pidFiles.length > 0 && !isLoading && !mtoLoading && (
              <button
                onClick={() => {
                  setPidFiles([]);
                  setHdPreviewBase64(null);
                  setAnchorPoint(null);
                  setBatchResults([]);
                  setBatchId(null);
                  setError(null);
                  clearAllSessions();
                }}
                className="flex items-center justify-center w-7 h-7 rounded-md text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
                title="Close P&ID"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}

            <input ref={fileInputRef} type="file" accept=".pdf" multiple onChange={handleFileChange} className="hidden" />
          </div>
        </div>

        {/* ── Library button bar (piping view) ── */}
        {view === 'piping' && librarySymbols.length > 0 && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-white/[0.06] bg-gray-950 overflow-x-auto">
            <span className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider shrink-0">Library</span>
            {librarySymbols.map(sym => {
              const selected = selectedLibraryIds.has(sym.id);
              return (
                <button
                  key={sym.id}
                  onClick={() => toggleLibrarySelection(sym.id)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-xs font-medium transition-colors shrink-0 ${
                    selected
                      ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                      : 'bg-white/[0.04] border-white/[0.08] text-gray-400 hover:text-white hover:border-white/20'
                  }`}
                >
                  {sym.thumbnail && (
                    <img
                      src={`data:image/png;base64,${sym.thumbnail}`}
                      alt=""
                      className="w-5 h-5 object-contain rounded shrink-0"
                    />
                  )}
                  {sym.name}
                  {selected && <span className="text-emerald-400 text-[10px]">✓</span>}
                </button>
              );
            })}
            {selectedLibraryIds.size > 0 && (
              <button
                onClick={stageSelectedLibrarySymbols}
                className="shrink-0 ml-1 px-3 py-1 rounded-lg text-xs font-bold text-gray-900 bg-emerald-400 hover:bg-emerald-300 transition-colors"
              >
                Search {selectedLibraryIds.size} →
              </button>
            )}
          </div>
        )}

        {/* Viewer */}
        <div
          ref={viewerRef}
          className="flex-1 relative bg-gray-900 min-h-0"
          style={{
            overflow: zoom > 1 ? 'auto' : 'hidden',
            display: 'flex',
            alignItems: zoom > 1 ? 'flex-start' : 'center',
            justifyContent: zoom > 1 ? 'flex-start' : 'center',
          }}
          onMouseMove={view === 'piping' ? handleMtoMouseMove : undefined}
          onMouseUp={view === 'piping' ? handleMtoMouseUp : undefined}
          onMouseLeave={view === 'piping' ? () => { dragAnchorRef.current = null; setDragAnchor(null); setDragHead(null); } : undefined}
        >
          {/* Empty state */}
          {!hdPreviewBase64 && !isPreviewLoading && (
            <div className="flex flex-col items-center gap-4">
              <div className="w-16 h-16 rounded-2xl border-2 border-dashed border-gray-700 flex items-center justify-center">
                <FolderOpen className="w-7 h-7 text-gray-600" />
              </div>
              <div className="text-center">
                <p className="text-gray-300 font-medium text-sm">Open P&ID files to begin</p>
                <p className="text-gray-600 text-xs mt-1">PDF · single file or batch</p>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-xs font-semibold text-white bg-white/10 hover:bg-white/20 px-4 py-2 rounded-lg transition-colors"
              >
                Open Files
              </button>
            </div>
          )}

          {/* Preview loading */}
          {isPreviewLoading && (
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-700 border-t-gray-300" />
              <p className="text-gray-500 text-xs">Loading P&ID…</p>
            </div>
          )}

          {/* Image + overlays */}
          {hdPreviewBase64 && (
            <>
              <div
                className="relative select-none"
                style={{ lineHeight: 0 }}
                onMouseDown={view === 'piping' ? handleMtoMouseDown : undefined}
              >
                <img
                  ref={imageRef}
                  src={hdPreviewBase64}
                  alt="P&ID diagram"
                  onLoad={handleImgLoad}
                  className={`block ${
                    view === 'pid' && !isLoading ? 'cursor-crosshair'
                    : view === 'piping' && mtoStep === 'pick_template' && !mtoLoading ? 'cursor-crosshair'
                    : 'cursor-default'
                  }`}
                  style={
                    baseDims
                      ? { width: baseDims.w * zoom, height: baseDims.h * zoom }
                      : {
                          maxWidth: viewerRef.current ? viewerRef.current.clientWidth : 'calc(100vw - 14rem)',
                          maxHeight: viewerRef.current ? viewerRef.current.clientHeight : 'calc(100vh - 5rem)',
                        }
                  }
                  onClick={view === 'pid' ? handleImageClick : undefined}
                  draggable={false}
                />

                {/* ── P&ID overlays ── */}

                {view === 'pid' && anchorPoint && imageRef.current && !isLoading && (
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

                {view === 'pid' && isLoading && (
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

                {/* ── MTO overlays ── */}

                {/* Detected session boxes (SVG) */}
                {view === 'piping' && mtoSessions.length > 0 && imageRef.current && (
                  <svg
                    className="absolute top-0 left-0 pointer-events-none z-10"
                    width={imageRef.current.clientWidth}
                    height={imageRef.current.clientHeight}
                    viewBox={`0 0 ${mtoSessions[0].imageWidth} ${mtoSessions[0].imageHeight}`}
                    preserveAspectRatio="none"
                  >
                    {mtoSessions.flatMap(session =>
                      session.matches.map((m, i) => (
                        <rect
                          key={`${session.id}-${i}`}
                          x={m.x1} y={m.y1}
                          width={m.x2 - m.x1} height={m.y2 - m.y1}
                          fill="none"
                          stroke={session.color}
                          strokeWidth={10}
                        />
                      ))
                    )}
                  </svg>
                )}

                {/* Staged template boxes (solid green) */}
                {view === 'piping' && stagedTemplates.map(t => {
                  const d = toDisplay(t.box);
                  if (!d) return null;
                  return (
                    <div
                      key={t.id}
                      className="absolute pointer-events-none border-2 border-green-400 z-10"
                      style={d}
                    >
                      <span className="absolute -top-5 left-0 text-[9px] bg-green-500 text-white px-1 py-0.5 rounded whitespace-nowrap font-medium">
                        {t.label}
                      </span>
                    </div>
                  );
                })}

                {/* Pending box (dashed green while labeling) */}
                {view === 'piping' && pendingBox && (() => {
                  const d = toDisplay(pendingBox);
                  if (!d) return null;
                  return (
                    <div
                      className="absolute pointer-events-none border-2 border-dashed border-green-300 bg-green-400/10 z-10"
                      style={d}
                    />
                  );
                })()}

                {/* Label popup */}
                {view === 'piping' && mtoStep === 'labeling' && pendingBox && imageRef.current && (() => {
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
                      <p className="text-[11px] text-gray-500 mb-2">Label this symbol</p>
                      <input
                        autoFocus
                        type="text"
                        value={pendingLabel}
                        onChange={e => setPendingLabel(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); addStagedTemplate(); }
                          if (e.key === 'Escape') cancelPending();
                        }}
                        placeholder='e.g. Ball Valve 1"'
                        className="w-full rounded-lg border border-white/[0.08] bg-white/[0.05] px-2.5 py-2 text-xs text-white placeholder:text-gray-600 outline-none focus:border-white/[0.22] mb-2.5"
                      />
                      <label className="flex items-center gap-2 mb-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={saveToLibrary}
                          onChange={e => setSaveToLibrary(e.target.checked)}
                          className="w-3 h-3 accent-emerald-400"
                        />
                        <span className="text-[11px] text-gray-400">Save to symbol library</span>
                      </label>
                      <div className="flex gap-1.5">
                        <button
                          onClick={addStagedTemplate}
                          className="flex-1 text-xs font-semibold text-gray-900 bg-white hover:bg-gray-100 py-1.5 rounded-lg transition-colors"
                        >
                          Add Symbol
                        </button>
                        <button
                          onClick={cancelPending}
                          className="flex-1 text-xs text-gray-500 hover:text-gray-300 border border-white/[0.08] py-1.5 rounded-lg transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {/* Rubber band */}
                {view === 'piping' && dragAnchor && dragHead && (
                  <div
                    className="absolute pointer-events-none border-2 border-dashed border-yellow-400 bg-yellow-400/10 z-20"
                    style={{
                      left: Math.min(dragAnchor.px, dragHead.px),
                      top: Math.min(dragAnchor.py, dragHead.py),
                      width: Math.abs(dragHead.px - dragAnchor.px),
                      height: Math.abs(dragHead.py - dragAnchor.py),
                    }}
                  />
                )}

                {/* MTO loading */}
                {view === 'piping' && mtoLoading && (
                  <>
                    <div className="absolute inset-0 bg-gray-950/55" />
                    <motion.div
                      className="absolute left-0 right-0 h-[2px] bg-emerald-400 pointer-events-none z-10"
                      style={{ boxShadow: '0 0 14px 4px rgba(52,211,153,0.55)' }}
                      animate={{ top: ['0%', '100%'] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
                      <div className="bg-gray-950/90 backdrop-blur-sm border border-white/10 rounded-2xl px-6 py-5 text-center">
                        <p className="text-white font-semibold text-sm">Searching for symbols…</p>
                        <p className="text-gray-500 text-xs mt-1">
                          {mtoRunningCountRef.current > 0 ? `${mtoRunningCountRef.current} symbol type${mtoRunningCountRef.current > 1 ? 's' : ''}` : ''}
                          {pageCount > 1 ? ` · ${pageCount} pages` : ''}
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* ── P&ID: Extract button ── */}
              <AnimatePresence>
                {view === 'pid' && anchorPoint && !isLoading && (
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

              {/* ── MTO: Floating panel (staged + results) ── */}
              <AnimatePresence>
                {view === 'piping' && (librarySymbols.length > 0 || stagedTemplates.length > 0 || mtoSessions.length > 0) && (
                  <motion.div
                    initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.18 }}
                    className="absolute top-4 right-4 z-20"
                  >
                    <div className="bg-gray-950/95 backdrop-blur-sm border border-white/[0.10] rounded-xl overflow-hidden min-w-[230px] max-w-[268px]">

                      {/* ── Library section ── */}
                      {librarySymbols.length > 0 && (
                        <>
                          <div className="px-4 pt-3 pb-2">
                            <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider mb-2">
                              Symbol Library · {librarySymbols.length}
                            </p>
                            <div className="space-y-1">
                              {librarySymbols.map(sym => {
                                const selected = selectedLibraryIds.has(sym.id);
                                return (
                                  <div
                                    key={sym.id}
                                    className={`flex items-center gap-2 rounded-lg px-2 py-1 cursor-pointer transition-colors ${
                                      selected ? 'bg-emerald-500/15 border border-emerald-500/30' : 'hover:bg-white/[0.04] border border-transparent'
                                    }`}
                                    onClick={() => toggleLibrarySelection(sym.id)}
                                  >
                                    {sym.thumbnail && (
                                      <img
                                        src={`data:image/png;base64,${sym.thumbnail}`}
                                        alt={sym.name}
                                        className="w-8 h-8 object-contain rounded border border-white/[0.08] bg-white/[0.03] shrink-0"
                                      />
                                    )}
                                    <span className={`text-xs flex-1 truncate ${selected ? 'text-emerald-300' : 'text-gray-300'}`}>
                                      {sym.name}
                                    </span>
                                    {selected && <span className="text-emerald-400 text-[10px] font-bold shrink-0">✓</span>}
                                    <button
                                      onClick={e => { e.stopPropagation(); deleteFromLibrary(sym.id); }}
                                      className="text-gray-700 hover:text-red-400 transition-colors shrink-0"
                                      title="Remove from library"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                            {selectedLibraryIds.size > 0 && (
                              <button
                                onClick={stageSelectedLibrarySymbols}
                                className="w-full mt-2 text-xs font-bold text-gray-900 bg-emerald-400 hover:bg-emerald-300 px-3 py-1.5 rounded-lg transition-colors"
                              >
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
                            <p className="text-[10px] text-gray-600 font-semibold uppercase tracking-wider mb-2">
                              Queued · {stagedTemplates.length}
                            </p>
                            <div className="space-y-1.5">
                              {stagedTemplates.map(t => (
                                <div key={t.id} className="flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                                  <span className="text-xs text-gray-300 flex-1 truncate">{t.label}</span>
                                  <button
                                    onClick={() => removeStagedTemplate(t.id)}
                                    className="text-gray-600 hover:text-red-400 transition-colors"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                          {/* Threshold number input — set before running */}
                          <div className="px-4 pt-1 pb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] text-gray-600 shrink-0">Threshold</span>
                              <input
                                type="number" min={0.40} max={0.95} step={0.01}
                                value={mtoThreshold}
                                onChange={e => {
                                  const v = parseFloat(e.target.value);
                                  if (!isNaN(v) && v >= 0.40 && v <= 0.95) setMtoThreshold(+v.toFixed(2));
                                }}
                                className="w-20 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-xs text-white font-mono outline-none focus:border-emerald-500 transition-colors"
                              />
                              <span className="text-[10px] text-gray-600">(0.40 – 0.95)</span>
                            </div>
                          </div>
                          <div className="px-4 pt-1 pb-3">
                            <button
                              onClick={handleMtoRunAll}
                              disabled={mtoLoading}
                              className="w-full text-xs font-bold text-gray-900 bg-white hover:bg-gray-100 disabled:opacity-50 px-3 py-2 rounded-lg transition-colors"
                            >
                              Search {pageCount > 1 ? `All ${pageCount} Pages` : 'Whole Page'}
                            </button>
                          </div>
                        </>
                      )}

                      {/* Divider between queued and results */}
                      {stagedTemplates.length > 0 && mtoSessions.length > 0 && (
                        <div className="border-t border-white/[0.06]" />
                      )}

                      {/* Results section */}
                      {mtoSessions.length > 0 && (
                        <>
                          <div className="px-4 pt-3 pb-2 space-y-2">
                            {mtoSessions.map(session => (
                              <div key={session.id}>
                                <div className="flex items-center gap-2">
                                  <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: session.color }} />
                                  <span className="text-xs text-gray-300 flex-1 truncate">{session.label}</span>
                                  <span className="text-xs font-bold text-white tabular-nums w-6 text-right">{session.count}</span>
                                  <button
                                    onClick={() => rerunSession(session)}
                                    disabled={mtoLoading}
                                    title="Re-run with current sensitivity"
                                    className="text-gray-600 hover:text-emerald-400 disabled:opacity-30 transition-colors"
                                  >
                                    ↺
                                  </button>
                                  <button
                                    onClick={() => removeSession(session.id)}
                                    className="text-gray-600 hover:text-red-400 transition-colors"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                                {session.pageCounts.length > 1 && (
                                  <div className="flex flex-wrap gap-x-2.5 gap-y-0 mt-0.5 pl-5">
                                    {session.pageCounts.map(pc => (
                                      <span key={pc.page} className="text-[10px] text-gray-600">
                                        P{pc.page}:<span className="text-gray-500 ml-0.5">{pc.count}</span>
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>

                          <div className="mx-4 border-t border-white/[0.06] py-2 flex items-center justify-between">
                            <span className="text-[11px] text-gray-500 font-semibold uppercase tracking-wider">Total</span>
                            <span className="text-sm font-bold text-white tabular-nums">{totalMtoCount}</span>
                          </div>

                          {/* Threshold + Re-run All */}
                          <div className="px-4 pb-3 border-t border-white/[0.06] pt-2">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-[10px] text-gray-600 shrink-0">Threshold</span>
                              <input
                                type="number" min={0.40} max={0.95} step={0.01}
                                value={mtoThreshold}
                                onChange={e => {
                                  const v = parseFloat(e.target.value);
                                  if (!isNaN(v) && v >= 0.40 && v <= 0.95) setMtoThreshold(+v.toFixed(2));
                                }}
                                className="w-20 rounded-md border border-white/[0.08] bg-white/[0.05] px-2 py-1 text-xs text-white font-mono outline-none focus:border-emerald-500 transition-colors"
                              />
                              <span className="text-[10px] text-gray-600">(0.40 – 0.95)</span>
                            </div>
                            <button
                              onClick={() => { mtoSessions.forEach(s => rerunSession(s)); }}
                              disabled={mtoLoading}
                              className="w-full text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 disabled:opacity-30 border border-emerald-900 hover:border-emerald-700 py-1.5 rounded-lg transition-colors"
                            >
                              ↺ Re-run All
                            </button>
                          </div>

                          {/* Actions */}
                          <div className="px-4 pb-3 border-t border-white/[0.06] pt-2 flex flex-col gap-1.5">
                            <button onClick={exportMtoExcel} className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors text-right">
                              Export Excel (with images)
                            </button>
                            <button onClick={exportAllMtoCsv} className="text-xs font-semibold text-gray-500 hover:text-gray-300 transition-colors text-right">
                              Export CSV
                            </button>
                            <button onClick={downloadMtoImage} className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors text-right">
                              Download Image
                            </button>
                            <button onClick={clearAllSessions} className="text-xs text-gray-600 hover:text-red-400 transition-colors text-right">
                              Clear All
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
                {(error || mtoError) && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30"
                  >
                    <div className="bg-red-950 border border-red-800 text-red-300 text-xs px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2">
                      <span>{error || mtoError}</span>
                      <button onClick={() => { setError(null); setMtoError(null); }} className="text-red-500 hover:text-red-300">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Zoom controls */}
              <div className="absolute bottom-4 left-4 z-20 flex items-center gap-1 bg-gray-950/80 backdrop-blur-sm border border-white/[0.08] rounded-lg px-1.5 py-1">
                <button
                  onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                  className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors text-sm font-bold"
                >−</button>
                <button
                  onClick={() => setZoom(1.0)}
                  className="px-2 h-6 text-[11px] text-gray-400 hover:text-white hover:bg-white/10 rounded transition-colors font-mono"
                >{zoom === 1.0 ? 'fit' : `${Math.round(zoom * 100)}%`}</button>
                <button
                  onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}
                  className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors text-sm font-bold"
                >+</button>
              </div>

              {/* P&ID: Download marked image */}
              <AnimatePresence>
                {view === 'pid' && !isLoading && batchId && batchResults.some(r => r.results.length > 0) && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="absolute bottom-4 right-4 z-20"
                  >
                    <button
                      onClick={() => downloadHighlightedImage(batchId)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-gray-300 bg-gray-950/80 backdrop-blur-sm border border-white/[0.08] hover:border-white/20 hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                    >
                      ↓ Marked Image
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>

        {/* Status bar */}
        <div className="h-6 shrink-0 flex items-center justify-between px-4 bg-gray-950 border-t border-white/[0.05]">
          <div className="flex items-center gap-1.5 min-w-0">
            {(isLoading || mtoLoading) && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />}
            {!isLoading && !mtoLoading && view === 'pid' && anchorPoint && <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />}
            {!isLoading && !mtoLoading && view === 'piping' && mtoSessions.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />}
            {!isLoading && !mtoLoading && view === 'piping' && stagedTemplates.length > 0 && mtoSessions.length === 0 && <span className="w-1.5 h-1.5 rounded-full bg-green-600 animate-pulse shrink-0" />}
            {!isLoading && !mtoLoading && !anchorPoint && mtoSessions.length === 0 && stagedTemplates.length === 0 && pidFiles.length > 0 && <span className="w-1.5 h-1.5 rounded-full bg-gray-600 shrink-0" />}
            <span className={`text-[11px] truncate ${statusText.accent ? 'text-emerald-400' : 'text-gray-400'}`}>
              {statusText.label}
            </span>
            {statusText.dim && <span className="text-[11px] text-gray-600 truncate shrink-0">{statusText.dim}</span>}
          </div>
          <span className="text-[11px] text-gray-700 shrink-0 ml-4">
            {view === 'piping' ? 'Piping MTO' : 'InstruMap'}
          </span>
        </div>

      </div>
    </div>
  );
};

export default InstruMapPage;
