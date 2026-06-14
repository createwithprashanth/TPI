import React, {
  useState, useRef, useCallback, useEffect, useMemo,
} from "react";
import {
  Upload, FileSpreadsheet, X, AlertCircle, Download,
  ChevronLeft, Loader2, Database, AlertTriangle,
  ArrowRight, Tag, Search, Plus, CheckCircle,
  BookMarked, Trash2, Eye, Sparkles,
} from "lucide-react";
import { downloadBlob } from "../utils/downloadBlob";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface MappingRow {
  column:     string;
  spi_column: string | null;
  table:      string | null;
  category:   "identifier" | "system" | "data";
  data_type?: "NUMBER" | "DATE" | "TIMESTAMP" | "STRING" | null;
}

interface ZipStats {
  tables:     number;
  statements: number;
  errors:     number;
}

interface PreviewData {
  total_rows:      number;
  stmt_count:      number;
  table_counts:    Record<string, number>;
  error_count:     number;
  errors:          { row: number; table: string; message: string }[];
  unknown_columns: string[];
  duplicates:      Record<string, [string, number][]>;
  sql_preview:     Record<string, string[]>;
}

interface Profile {
  id:               string;
  name:             string;
  createdAt:        string;
  rowTable:         Record<string, string>;
  rowCol:           Record<string, string>;
  rowEnabled:       Record<string, boolean>;
  nullBehavior:     Record<string, "skip" | "null" | "dash" | "na">;
  selectedTables:   string[];
  tableWhereCol:    Record<string, string>;
  tableWhereSpiCol: Record<string, string>;
  headers:          string[];
}

// ---------------------------------------------------------------------------
// Profile helpers — localStorage
// ---------------------------------------------------------------------------
const PROFILES_KEY = "datapump_profiles";

function _loadProfiles(): Profile[] {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || "[]"); }
  catch { return []; }
}

function _saveProfile(p: Profile) {
  const others = _loadProfiles().filter((x) => x.id !== p.id);
  localStorage.setItem(PROFILES_KEY, JSON.stringify([p, ...others].slice(0, 20)));
}

function _deleteProfile(id: string) {
  localStorage.setItem(
    PROFILES_KEY,
    JSON.stringify(_loadProfiles().filter((p) => p.id !== id)),
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function StepBadge({ n, done }: { n: number; done: boolean }) {
  return (
    <span className={`text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center shrink-0
      ${done ? "bg-emerald-500 text-white" : "bg-white/[0.08] text-gray-400"}`}>
      {n}
    </span>
  );
}

function Badge({ color, children }: { color: "green" | "blue" | "amber" | "gray"; children: React.ReactNode }) {
  const cls = {
    green: "bg-emerald-500/10 text-emerald-300 border border-emerald-400/20",
    blue:  "bg-blue-500/10 text-blue-300 border border-blue-400/20",
    amber: "bg-amber-500/10 text-amber-300 border border-amber-400/20",
    gray:  "bg-white/[0.04] text-gray-500 border border-white/[0.06]",
  }[color];
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}>
      {children}
    </span>
  );
}

function ErrorBanner({ message, className = "" }: { message: string; className?: string }) {
  return (
    <div className={`flex items-start gap-2 text-red-300 bg-red-500/10 border border-red-400/20 rounded-md px-4 py-3 text-xs ${className}`}>
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}

function DownloadSuccessBanner({ stats, className = "" }: { stats: ZipStats; className?: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-md px-4 py-3 text-xs border
      ${stats.errors > 0
        ? "text-amber-300 bg-amber-500/10 border-amber-400/20"
        : "text-emerald-300 bg-emerald-500/10 border-emerald-400/20"} ${className}`}>
      {stats.errors > 0
        ? <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        : <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />}
      <span>
        ZIP downloaded —{" "}
        <span className="font-medium">{stats.statements.toLocaleString()} UPDATE statements</span>{" "}
        across <span className="font-medium">{stats.tables} table{stats.tables !== 1 ? "s" : ""}</span>.
        {stats.errors > 0 && (
          <span className="ml-1 text-amber-400">
            {stats.errors} row{stats.errors !== 1 ? "s" : ""} had errors (missing identifier) — check source data.
          </span>
        )}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface DataPumpGeneratePageProps {
  onBack: () => void;
}

export function DataPumpGeneratePage({ onBack }: DataPumpGeneratePageProps) {
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const tableDropRef   = useRef<HTMLDivElement>(null);
  const profileDropRef = useRef<HTMLDivElement>(null);

  const [dragOver,      setDragOver]      = useState(false);
  const [selectedFile,  setSelectedFile]  = useState<File | null>(null);
  const [stage,         setStage]         = useState<"upload" | "mapping">("upload");
  const [mappings,      setMappings]      = useState<MappingRow[]>([]);
  const [allTables,     setAllTables]     = useState<string[]>([]);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [tableSearch,   setTableSearch]   = useState("");
  const [tableOpen,     setTableOpen]     = useState(false);
  const [tableColumns,  setTableColumns]  = useState<Record<string, string[]>>({});
  const [loadingCols,   setLoadingCols]   = useState(false);
  const [rowTable,      setRowTable]      = useState<Record<string, string>>({});
  const [rowCol,        setRowCol]        = useState<Record<string, string>>({});
  const [rowEnabled,    setRowEnabled]    = useState<Record<string, boolean>>({});
  const [rowNullBehavior, setRowNullBehavior] = useState<Record<string, "skip" | "null" | "dash" | "na">>({});
  const [tableWhereCol,    setTableWhereCol]    = useState<Record<string, string>>({});
  const [tableWhereSpiCol, setTableWhereSpiCol] = useState<Record<string, string>>({});
  const [autoMappedCount,  setAutoMappedCount]  = useState(0);
  const [showUnmappedOnly, setShowUnmappedOnly] = useState(false);
  const [previewData,    setPreviewData]    = useState<PreviewData | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [previewTable,   setPreviewTable]   = useState("");
  const [profiles,       setProfiles]       = useState<Profile[]>(() => _loadProfiles());
  const [showProfiles,   setShowProfiles]   = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [profileBanner,  setProfileBanner]  = useState<Profile | null>(null);
  const [loadingHeaders, setLoadingHeaders] = useState(false);
  const [loadingZip,     setLoadingZip]     = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [zipStats,       setZipStats]       = useState<ZipStats | null>(null);

  const API_BASE = import.meta.env.VITE_API_URL || "";

  // ── Derived ──────────────────────────────────────────────────────────────
  const whereExcelCols = new Set(Object.values(tableWhereCol).filter(Boolean));
  const dataRows       = mappings.filter((m) => m.category === "data" && !whereExcelCols.has(m.column));
  const enabledRows    = dataRows.filter((m) => rowEnabled[m.column] !== false);
  const mappedCount    = enabledRows.filter((m) => (rowCol[m.column] || "").trim()).length;
  const pendingCount   = enabledRows.filter((m) => !(rowCol[m.column] || "").trim()).length;
  const ignoredCount   = dataRows.length - enabledRows.length;
  const allChecked     = enabledRows.length === dataRows.length && dataRows.length > 0;
  const someChecked    = enabledRows.length > 0 && enabledRows.length < dataRows.length;
  const visibleRows    = showUnmappedOnly
    ? dataRows.filter((m) => rowEnabled[m.column] !== false && !(rowCol[m.column] || "").trim())
    : dataRows;

  useEffect(() => {
    if (showUnmappedOnly && pendingCount === 0) setShowUnmappedOnly(false);
  }, [pendingCount, showUnmappedOnly]);

  useEffect(() => {
    if (!tableOpen) return;
    const h = (e: MouseEvent) => {
      if (tableDropRef.current && !tableDropRef.current.contains(e.target as Node)) {
        setTableOpen(false); setTableSearch("");
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [tableOpen]);

  useEffect(() => {
    if (!showProfiles) return;
    const h = (e: MouseEvent) => {
      if (profileDropRef.current && !profileDropRef.current.contains(e.target as Node)) {
        setShowProfiles(false); setShowSaveDialog(false); setNewProfileName("");
      }
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showProfiles]);

  useEffect(() => {
    if (selectedTables.length === 0) { setTableColumns({}); return; }
    const load = async () => {
      setLoadingCols(true);
      try {
        const q   = selectedTables.join(",");
        const res = await fetch(
          `${API_BASE}/api/v1/datapump/schema/columns?tables=${encodeURIComponent(q)}`,
          { cache: "no-store" },
        );
        if (res.ok) {
          const data = await res.json();
          const loadedCols: Record<string, string[]> = data.columns || {};
          setTableColumns(loadedCols);

          const CANONICAL_IDS = ["CMPNT_NAME", "LOOP_NAME", "LINE_NUM", "PANEL_NAME", "CMPNT_ID", "LOOP_ID"];
          setTableWhereSpiCol((prev) => {
            const updates: Record<string, string> = {};
            for (const tbl of selectedTables) {
              if (prev[tbl]) continue;
              const cols = new Set(loadedCols[tbl] || []);
              const pick = CANONICAL_IDS.find(id => cols.has(id));
              if (pick) updates[tbl] = pick;
            }
            return Object.keys(updates).length ? { ...prev, ...updates } : prev;
          });

          const norm = (s: string) => s.toLowerCase().replace(/[\s_]/g, "");
          const autoTable: Record<string, string> = {};
          const autoCol:   Record<string, string> = {};
          let   count = 0;

          setRowCol((prevCol) => {
            setRowTable((prevTable) => {
              for (const m of mappings) {
                if (m.category !== "data") continue;
                if ((prevCol[m.column] || "").trim()) continue;
                const normExcel = norm(m.column);
                for (const tbl of selectedTables) {
                  const match = (loadedCols[tbl] || []).find(c => norm(c) === normExcel);
                  if (match) {
                    autoTable[m.column] = tbl;
                    autoCol[m.column]   = match;
                    count++;
                    break;
                  }
                }
              }
              return count > 0 ? { ...prevTable, ...autoTable } : prevTable;
            });
            if (count > 0) setAutoMappedCount(count);
            return count > 0 ? { ...prevCol, ...autoCol } : prevCol;
          });
        }
      } finally { setLoadingCols(false); }
    };
    load();
  }, [selectedTables]);

  useEffect(() => {
    if (mappings.length === 0) { setProfileBanner(null); return; }
    const currentHeaders = mappings.filter((m) => m.category === "data").map((m) => m.column);
    for (const p of _loadProfiles()) {
      const overlap = p.headers.filter((h) => currentHeaders.includes(h)).length;
      if (overlap >= Math.max(2, Math.floor(p.headers.length * 0.5))) {
        setProfileBanner(p); return;
      }
    }
    setProfileBanner(null);
  }, [mappings]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const resetState = () => {
    setMappings([]); setRowTable({}); setRowCol({});
    setRowEnabled({}); setRowNullBehavior({});
    setSelectedTables([]); setTableWhereCol({}); setTableWhereSpiCol({});
    setZipStats(null); setError(null);
    setPreviewData(null); setPreviewTable("");
    setProfileBanner(null); setAutoMappedCount(0); setShowUnmappedOnly(false);
  };

  const acceptFile = (file: File) => {
    if (!file.name.toLowerCase().match(/\.(xlsx|xls)$/)) {
      setError("Only .xlsx and .xls files are supported."); return;
    }
    resetState(); setStage("upload"); setSelectedFile(file);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0]; if (f) acceptFile(f);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) acceptFile(f);
  };

  const handleClear = () => {
    setSelectedFile(null); setAllTables([]); setTableColumns({});
    resetState(); setStage("upload");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const buildFormData = (): FormData => {
    const columnMap:      Record<string, string> = {};
    const nullCols:       string[]               = [];
    const emptyValueCols: Record<string, string> = {};
    for (const m of mappings) {
      if (m.category !== "data" || !rowEnabled[m.column]) continue;
      const col = rowCol[m.column]?.trim();
      if (col) columnMap[m.column] = col;
      const nb = rowNullBehavior[m.column];
      if (nb === "null")       nullCols.push(m.column);
      else if (nb === "dash")  emptyValueCols[m.column] = "-";
      else if (nb === "na")    emptyValueCols[m.column] = "N/A";
    }
    const whereMap: Record<string, string> = {};
    for (const tbl of selectedTables) {
      if (tableWhereCol[tbl]) whereMap[tbl] = tableWhereCol[tbl];
    }
    const tableMap: Record<string, string> = {};
    for (const m of mappings) {
      if (m.category !== "data" || !rowEnabled[m.column]) continue;
      const tbl = rowTable[m.column]?.trim();
      if (tbl) tableMap[m.column] = tbl;
    }
    const fd = new FormData();
    fd.append("file",             selectedFile!);
    fd.append("column_map",       JSON.stringify(columnMap));
    fd.append("where_map",        JSON.stringify(whereMap));
    fd.append("where_spi_map",    JSON.stringify(tableWhereSpiCol));
    fd.append("null_cols",        JSON.stringify(nullCols));
    fd.append("empty_value_cols", JSON.stringify(emptyValueCols));
    fd.append("table_map",        JSON.stringify(tableMap));
    return fd;
  };

  const handleReadHeaders = async () => {
    if (!selectedFile) return;
    setLoadingHeaders(true); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", selectedFile);

      const [headersRes, tablesRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/datapump/headers`, { method: "POST", body: fd }),
        fetch(`${API_BASE}/api/v1/datapump/schema/tables`),
      ]);

      if (!headersRes.ok) {
        const d = await headersRes.json().catch(() => ({}));
        throw new Error(d?.detail || `Server error ${headersRes.status}`);
      }

      const headersData = await headersRes.json();
      const tablesData  = tablesRes.ok ? await tablesRes.json() : { tables: [] };

      setMappings(headersData.mapping);
      setAllTables(tablesData.tables || []);

      const preFillTable: Record<string, string>                          = {};
      const preFillCol:   Record<string, string>                          = {};
      const enabledInit:  Record<string, boolean>                         = {};
      const nullInit:     Record<string, "skip" | "null" | "dash" | "na"> = {};
      const autoTables    = new Set<string>();

      for (const m of headersData.mapping) {
        if (m.category === "data") {
          enabledInit[m.column] = true;
          nullInit[m.column]    = "skip";
          if (m.spi_column && m.table) {
            preFillTable[m.column] = m.table;
            preFillCol[m.column]   = m.spi_column;
            autoTables.add(m.table);
          }
        }
      }

      setRowTable(preFillTable);
      setRowCol(preFillCol);
      setRowEnabled(enabledInit);
      setRowNullBehavior(nullInit);

      const whereExcelFill: Record<string, string> = {};
      const whereSpiFill:   Record<string, string> = {};
      for (const m of headersData.mapping) {
        if (m.category === "identifier" && m.table && m.spi_column && m.column) {
          whereExcelFill[m.table] = m.column;
          whereSpiFill[m.table]   = m.spi_column;
        }
      }
      setTableWhereCol(whereExcelFill);
      setTableWhereSpiCol(whereSpiFill);
      setAutoMappedCount(0);
      setSelectedTables(Array.from(autoTables).slice(0, 5));
      setStage("mapping");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to read headers.");
    } finally {
      setLoadingHeaders(false);
    }
  };

  const addTable = (t: string) => {
    if (selectedTables.includes(t) || selectedTables.length >= 5) return;
    setSelectedTables((prev) => [...prev, t]);
    setTableSearch(""); setTableOpen(false);
  };

  const removeTable = (t: string) => {
    setSelectedTables((prev) => prev.filter((x) => x !== t));
    setTableWhereCol((prev)    => { const n = { ...prev }; delete n[t]; return n; });
    setTableWhereSpiCol((prev) => { const n = { ...prev }; delete n[t]; return n; });
    setRowTable((prev) => {
      const n = { ...prev };
      for (const [k, v] of Object.entries(n)) { if (v === t) delete n[k]; }
      return n;
    });
    setRowCol((prev) => {
      const cols = new Set(tableColumns[t] || []);
      const n = { ...prev };
      for (const [k, v] of Object.entries(n)) { if (cols.has(v)) delete n[k]; }
      return n;
    });
  };

  const filteredTables = useMemo(
    () => allTables.filter(
      (t) => !selectedTables.includes(t) &&
             t.toLowerCase().includes(tableSearch.toLowerCase()),
    ),
    [allTables, selectedTables, tableSearch],
  );

  const handlePreview = async () => {
    if (!selectedFile) return;
    setLoadingPreview(true); setError(null); setPreviewData(null); setZipStats(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/datapump/preview`, { method: "POST", body: buildFormData() });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.detail || `Server error ${res.status}`);
      }
      const data: PreviewData = await res.json();
      setPreviewData(data);
      setPreviewTable(Object.keys(data.sql_preview)[0] || "");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate preview.");
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleGenerateZip = async () => {
    if (!selectedFile) return;
    setLoadingZip(true); setError(null); setZipStats(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/datapump/generate-zip`, { method: "POST", body: buildFormData() });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.detail || `Server error ${res.status}`);
      }
      const tables     = parseInt(res.headers.get("X-Table-Count")     ?? "0", 10);
      const statements = parseInt(res.headers.get("X-Statement-Count") ?? "0", 10);
      const errors     = parseInt(res.headers.get("X-Error-Count")     ?? "0", 10);
      downloadBlob(await res.blob(), `${selectedFile.name.replace(/\.[^.]+$/, "")}_SQL_Updates.zip`);
      setZipStats({ tables, statements, errors });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to generate ZIP.");
    } finally {
      setLoadingZip(false);
    }
  };

  const handleSaveProfile = () => {
    const name = newProfileName.trim();
    if (!name) return;
    const p: Profile = {
      id:               Date.now().toString(),
      name,
      createdAt:        new Date().toISOString().split("T")[0],
      rowTable:         { ...rowTable },
      rowCol:           { ...rowCol },
      rowEnabled:       { ...rowEnabled },
      nullBehavior:     { ...rowNullBehavior },
      selectedTables:   [...selectedTables],
      tableWhereCol:    { ...tableWhereCol },
      tableWhereSpiCol: { ...tableWhereSpiCol },
      headers:          mappings.filter((m) => m.category === "data").map((m) => m.column),
    };
    _saveProfile(p);
    setProfiles(_loadProfiles());
    setShowSaveDialog(false); setNewProfileName(""); setShowProfiles(false);
  };

  const handleApplyProfile = (p: Profile) => {
    const currentDataCols = new Set(mappings.filter((m) => m.category === "data").map((m) => m.column));
    const newRowTable:   Record<string, string>                          = { ...rowTable };
    const newRowCol:     Record<string, string>                          = { ...rowCol };
    const newRowEnabled: Record<string, boolean>                         = { ...rowEnabled };
    const newNullBeh:    Record<string, "skip" | "null" | "dash" | "na"> = { ...rowNullBehavior };
    for (const col of currentDataCols) {
      if (p.rowCol[col]) {
        newRowTable[col]   = p.rowTable[col]    || "";
        newRowCol[col]     = p.rowCol[col]       || "";
        newRowEnabled[col] = p.rowEnabled[col]   ?? true;
        newNullBeh[col]    = p.nullBehavior[col] || "skip";
      }
    }
    setRowTable(newRowTable); setRowCol(newRowCol);
    setRowEnabled(newRowEnabled); setRowNullBehavior(newNullBeh);
    const validTables = p.selectedTables.filter((t) => allTables.includes(t));
    if (validTables.length > 0) {
      setSelectedTables(validTables.slice(0, 5));
      setTableWhereCol({ ...p.tableWhereCol });
      setTableWhereSpiCol({ ...(p.tableWhereSpiCol || {}) });
    }
    setShowProfiles(false); setShowSaveDialog(false); setProfileBanner(null);
  };

  const handleDeleteProfile = (id: string) => {
    _deleteProfile(id); setProfiles(_loadProfiles());
  };

  // ── Shared class strings ─────────────────────────────────────────────────
  const inputCls = "h-8 w-full rounded-md border border-white/[0.08] bg-black px-2.5 text-xs text-gray-200 font-mono outline-none focus:border-white/[0.18] placeholder:text-gray-700 transition-colors";
  const selectCls = "h-8 w-full rounded-md border border-white/[0.08] bg-black px-2 text-xs text-gray-200 font-mono outline-none focus:border-white/[0.18] transition-colors";
  const sectionLabel = "text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#09090c] text-gray-200">

      {/* Header */}
      <div className="shrink-0 border-b border-white/[0.06] bg-[#0d0d11] px-5 py-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-gray-500 hover:text-gray-200 text-xs transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          DataPump
        </button>
        <span className="text-white/[0.15]">/</span>
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-sm font-semibold text-white">Generate SQL</span>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto xyra-scroll-contained">
        <div className="max-w-4xl mx-auto px-5 py-6 space-y-4">

          {/* ── Step 1: Upload ──────────────────────────────────────────── */}
          <div className="rounded-md border border-white/[0.08] bg-[#0d0d11]">
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
              <StepBadge n={1} done={stage === "mapping"} />
              <span className="text-xs font-semibold text-white">Upload your Excel file</span>
            </div>
            <div className="p-4">
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`cursor-pointer rounded-md border-2 border-dashed transition-colors
                  flex flex-col items-center justify-center gap-3 py-8 px-6
                  ${dragOver      ? "border-white/[0.2] bg-white/[0.04]"
                  : selectedFile  ? "border-emerald-400/30 bg-emerald-500/[0.06]"
                  :                 "border-white/[0.08] hover:border-white/[0.15] hover:bg-white/[0.02]"}`}
              >
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileChange} />
                {selectedFile ? (
                  <>
                    <FileSpreadsheet className="w-8 h-8 text-emerald-400" />
                    <div className="text-center">
                      <p className="text-xs font-medium text-white">{selectedFile.name}</p>
                      <p className="text-[11px] text-gray-500 mt-0.5">
                        {(selectedFile.size / 1024).toFixed(1)} KB — click to change
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-gray-600" />
                    <div className="text-center">
                      <p className="text-xs font-medium text-gray-300">Drag & drop your Excel file here</p>
                      <p className="text-[11px] text-gray-600 mt-1">.xlsx or .xls · max 50 MB</p>
                    </div>
                  </>
                )}
              </div>

              {stage === "upload" && error && <ErrorBanner message={error} className="mt-3" />}

              <div className="mt-4 flex items-center gap-3">
                <button
                  onClick={handleReadHeaders}
                  disabled={!selectedFile || loadingHeaders || loadingZip}
                  className="flex items-center gap-2 h-8 px-4 rounded-md bg-white text-black text-xs font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loadingHeaders
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading…</>
                    : <><ArrowRight className="w-3.5 h-3.5" /> Read Headers</>}
                </button>
                {selectedFile && !loadingHeaders && !loadingZip && (
                  <button onClick={handleClear}
                    className="flex items-center gap-1 text-[11px] text-gray-600 hover:text-gray-300 transition-colors">
                    <X className="w-3 h-3" /> Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Step 2: Tables + WHERE + Profiles ───────────────────────── */}
          {stage === "mapping" && (
            <div className="rounded-md border border-white/[0.08] bg-[#0d0d11]">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                <div className="flex items-center gap-2">
                  <StepBadge n={2} done={selectedTables.length > 0} />
                  <span className="text-xs font-semibold text-white">Select SPI tables</span>
                  <span className="text-[11px] text-gray-600">max 5</span>
                </div>

                {/* Profiles dropdown */}
                <div className="relative shrink-0" ref={profileDropRef}>
                  <button
                    onClick={() => { setShowProfiles((o) => !o); setShowSaveDialog(false); setNewProfileName(""); }}
                    className="flex items-center gap-1.5 text-[11px] text-gray-500 hover:text-gray-200 border border-white/[0.08] rounded-md px-2.5 h-7 transition-colors"
                  >
                    <BookMarked className="w-3 h-3" />
                    Profiles
                    {profiles.length > 0 && (
                      <span className="bg-white/[0.08] text-gray-400 rounded-full px-1.5 text-[10px] font-medium">
                        {profiles.length}
                      </span>
                    )}
                  </button>

                  {showProfiles && (
                    <div className="absolute right-0 top-full mt-1 z-50 bg-[#0d0d11] border border-white/[0.10] rounded-md shadow-xl w-64">
                      <div className="p-3 border-b border-white/[0.06]">
                        {!showSaveDialog ? (
                          <button
                            onClick={() => setShowSaveDialog(true)}
                            disabled={mappedCount === 0}
                            className="w-full flex items-center gap-2 text-[11px] text-gray-400 hover:text-gray-200 px-2 py-1.5 rounded-md hover:bg-white/[0.04] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Plus className="w-3 h-3" />
                            Save current mapping as profile…
                          </button>
                        ) : (
                          <div>
                            <p className="text-[11px] font-medium text-gray-300 mb-2">Profile name</p>
                            <input
                              autoFocus type="text" value={newProfileName}
                              onChange={(e) => setNewProfileName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleSaveProfile();
                                if (e.key === "Escape") { setShowSaveDialog(false); setNewProfileName(""); }
                              }}
                              placeholder="e.g. Vendor Tag List v3"
                              className="h-7 w-full text-[11px] border border-white/[0.08] bg-black rounded-md px-2.5 text-gray-200 outline-none focus:border-white/[0.18] placeholder:text-gray-700 mb-2"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={handleSaveProfile}
                                disabled={!newProfileName.trim()}
                                className="flex-1 text-[11px] bg-white text-black rounded-md py-1.5 hover:bg-gray-200 transition-colors disabled:opacity-40"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => { setShowSaveDialog(false); setNewProfileName(""); }}
                                className="text-[11px] text-gray-500 hover:text-gray-300 px-3"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      {profiles.length === 0 ? (
                        <p className="text-[11px] text-gray-600 px-4 py-3 text-center">No saved profiles yet</p>
                      ) : (
                        <div className="max-h-48 overflow-y-auto py-1">
                          {profiles.map((p) => (
                            <div key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-white/[0.03]">
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-medium text-gray-200 truncate">{p.name}</p>
                                <p className="text-[10px] text-gray-600">{p.headers.length} cols · {p.createdAt}</p>
                              </div>
                              <button onClick={() => handleApplyProfile(p)}
                                className="text-[10px] text-blue-400 hover:text-blue-200 font-medium shrink-0 px-1">
                                Load
                              </button>
                              <button onClick={() => handleDeleteProfile(p.id)}
                                className="text-gray-600 hover:text-red-400 shrink-0 transition-colors">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div className="p-4 space-y-4">
                {/* Profile auto-detect banner */}
                {profileBanner && (
                  <div className="flex items-center gap-2 bg-blue-500/10 border border-blue-400/20 rounded-md px-3 py-2 text-[11px] text-blue-300">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span className="flex-1">
                      Profile <span className="font-medium">"{profileBanner.name}"</span> matches your headers — load it?
                    </span>
                    <button onClick={() => handleApplyProfile(profileBanner)} className="font-medium underline underline-offset-2 shrink-0">
                      Load
                    </button>
                    <button onClick={() => setProfileBanner(null)} className="ml-1 text-blue-500 hover:text-blue-200">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                <p className="text-[11px] text-gray-600">Only columns from these tables will appear in the mapping below.</p>

                {/* Selected table chips + Add */}
                <div className="flex flex-wrap gap-2">
                  {selectedTables.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 bg-white/[0.06] text-gray-200 text-[11px] font-mono px-2.5 h-7 rounded-md">
                      {t}
                      <button onClick={() => removeTable(t)} className="ml-1 text-gray-500 hover:text-gray-200 transition-colors">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}

                  {selectedTables.length < 5 && (
                    <div className="relative" ref={tableDropRef}>
                      <button
                        onClick={() => setTableOpen((o) => !o)}
                        className="inline-flex items-center gap-1 border border-dashed border-white/[0.12] text-gray-500 text-[11px] px-2.5 h-7 rounded-md hover:border-white/[0.25] hover:text-gray-300 transition-colors"
                      >
                        <Plus className="w-3 h-3" /> Add table
                      </button>

                      {tableOpen && (
                        <div className="absolute top-full mt-1 left-0 z-50 bg-[#0d0d11] border border-white/[0.10] rounded-md shadow-xl w-64">
                          <div className="p-2 border-b border-white/[0.06]">
                            <div className="flex items-center gap-2 px-2 py-1.5 bg-black rounded-md">
                              <Search className="w-3 h-3 text-gray-600 shrink-0" />
                              <input
                                autoFocus type="text" value={tableSearch}
                                onChange={(e) => setTableSearch(e.target.value)}
                                placeholder="Search tables…"
                                className="bg-transparent text-[11px] text-gray-200 placeholder:text-gray-700 outline-none w-full"
                              />
                            </div>
                          </div>
                          <div className="max-h-48 overflow-y-auto py-1">
                            {filteredTables.length === 0 ? (
                              <p className="text-[11px] text-gray-600 px-4 py-3">No tables found</p>
                            ) : (
                              filteredTables.slice(0, 100).map((t) => (
                                <button key={t} onClick={() => addTable(t)}
                                  className="w-full text-left text-[11px] px-4 py-1.5 hover:bg-white/[0.04] text-gray-400 font-mono">
                                  {t}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* WHERE condition per table */}
                {selectedTables.length > 0 && (
                  <div className="rounded-md border border-white/[0.06] overflow-hidden">
                    <div className="bg-white/[0.02] border-b border-white/[0.06] px-3 py-2 flex items-center gap-2">
                      <Tag className="w-3 h-3 text-gray-600 shrink-0" />
                      <span className={sectionLabel}>WHERE condition</span>
                      <span className="text-[10px] text-gray-700 hidden sm:inline">
                        — identifier column per table
                      </span>
                    </div>
                    <div className="divide-y divide-white/[0.04]">
                      {selectedTables.map((tbl) => {
                        const currentExcel = tableWhereCol[tbl]    ?? "";
                        const currentSpi   = tableWhereSpiCol[tbl] ?? "";
                        return (
                          <div key={tbl} className="flex items-center gap-2 px-3 py-2 flex-wrap sm:flex-nowrap">
                            <span className="text-[11px] font-mono font-medium text-gray-400 w-40 shrink-0 truncate" title={tbl}>
                              {tbl}
                            </span>
                            <span className="text-[11px] text-gray-700 shrink-0">WHERE</span>
                            <select
                              value={currentSpi}
                              onChange={(e) => setTableWhereSpiCol((prev) => ({ ...prev, [tbl]: e.target.value }))}
                              className={`w-36 shrink-0 ${selectCls} ${!currentSpi ? "border-amber-400/30 bg-amber-500/[0.08]" : ""}`}
                            >
                              <option value="">— SPI col —</option>
                              {(tableColumns[tbl] || []).map((c) => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <span className="text-[11px] text-gray-700 shrink-0">=</span>
                            <select
                              value={currentExcel}
                              onChange={(e) => setTableWhereCol((prev) => ({ ...prev, [tbl]: e.target.value }))}
                              className={`flex-1 min-w-0 ${selectCls} ${!currentExcel ? "border-amber-400/30 bg-amber-500/[0.08]" : ""}`}
                            >
                              <option value="">— Excel col —</option>
                              {[...mappings]
                                .sort((a, b) => (a.category === "identifier" ? 0 : 1) - (b.category === "identifier" ? 0 : 1))
                                .map((m) => <option key={m.column} value={m.column}>{m.column}</option>)}
                            </select>
                            {(!currentSpi || !currentExcel) && (
                              <span className="text-[10px] text-amber-500 shrink-0">required</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedTables.length > 0 && selectedTables.some((t) => !tableWhereCol[t] || !tableWhereSpiCol[t]) && (
                  <div className="flex items-start gap-2 text-amber-300 bg-amber-500/10 border border-amber-400/20 rounded-md px-3 py-2 text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>Some tables still need both a SPI column and an Excel column for the WHERE condition.</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Step 3: Map columns ──────────────────────────────────────── */}
          {stage === "mapping" && selectedTables.length > 0 && (
            <div className="rounded-md border border-white/[0.08] bg-[#0d0d11]">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                <div className="flex items-center gap-2">
                  <StepBadge n={3} done={mappedCount > 0} />
                  <div>
                    <span className="text-xs font-semibold text-white">Map columns</span>
                    {dataRows.length > 0 && (
                      <span className="ml-2 text-[11px] text-gray-600">{dataRows.length} columns</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] shrink-0 flex-wrap justify-end">
                  {mappedCount > 0 && (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                      {mappedCount} mapped
                    </span>
                  )}
                  {pendingCount > 0 && (
                    <span className="flex items-center gap-1 text-amber-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                      {pendingCount} pending
                    </span>
                  )}
                  {ignoredCount > 0 && (
                    <span className="flex items-center gap-1 text-gray-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-gray-700 inline-block" />
                      {ignoredCount} ignored
                    </span>
                  )}
                  {pendingCount > 0 && (
                    <button
                      onClick={() => setShowUnmappedOnly((o) => !o)}
                      className={`flex items-center gap-1.5 px-2 h-6 rounded-md border text-[10px] font-medium transition-colors
                        ${showUnmappedOnly
                          ? "bg-amber-500/10 border-amber-400/30 text-amber-300"
                          : "border-white/[0.08] bg-white/[0.02] text-gray-500 hover:text-gray-200"}`}
                    >
                      {showUnmappedOnly ? "Show all" : `Show unmapped (${pendingCount})`}
                    </button>
                  )}
                </div>
              </div>

              <div className="p-4">
                {selectedTables.map((tbl) => (
                  <datalist key={tbl} id={`spi-cols-${tbl}`}>
                    {(tableColumns[tbl] || []).map((c) => <option key={c} value={c} />)}
                  </datalist>
                ))}

                {loadingCols ? (
                  <div className="flex items-center gap-2 text-[11px] text-gray-600 py-8 justify-center">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading columns…
                  </div>
                ) : (
                  <div className="rounded-md border border-white/[0.06] overflow-hidden">
                    <div className="overflow-x-auto">
                      <div className="max-h-[420px] overflow-y-auto xyra-scroll-contained">
                        <table className="w-full text-[11px] min-w-[680px]">
                          <thead className="sticky top-0 z-10">
                            <tr className="bg-white/[0.02] border-b border-white/[0.06]">
                              <th className="px-3 py-2 w-9">
                                <input
                                  type="checkbox" title="Toggle all" checked={allChecked}
                                  ref={(el) => { if (el) el.indeterminate = someChecked; }}
                                  onChange={(e) => {
                                    const next: Record<string, boolean> = {};
                                    for (const m of dataRows) next[m.column] = e.target.checked;
                                    setRowEnabled(next);
                                  }}
                                  className="w-3.5 h-3.5 cursor-pointer accent-white"
                                />
                              </th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600 uppercase tracking-[0.1em] text-[10px] w-44">Excel column</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600 uppercase tracking-[0.1em] text-[10px] w-32">Table</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600 uppercase tracking-[0.1em] text-[10px]">SPI column</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600 uppercase tracking-[0.1em] text-[10px] w-24">If empty</th>
                              <th className="text-left px-3 py-2 font-semibold text-gray-600 uppercase tracking-[0.1em] text-[10px] w-16">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/[0.03]">
                            {visibleRows.map((m) => {
                              const tbl          = rowTable[m.column] ?? "";
                              const col          = rowCol[m.column]   ?? "";
                              const enabled      = rowEnabled[m.column] !== false;
                              const isAuto       = !!m.spi_column && col === m.spi_column;
                              const nullBehavior = rowNullBehavior[m.column] ?? "skip";
                              return (
                                <tr key={m.column}
                                  className={`transition-colors ${enabled ? "hover:bg-white/[0.02]" : "opacity-40"}`}>

                                  <td className="px-3 py-1.5 text-center">
                                    <input type="checkbox" checked={enabled}
                                      onChange={(e) => setRowEnabled((prev) => ({ ...prev, [m.column]: e.target.checked }))}
                                      className="w-3.5 h-3.5 cursor-pointer accent-white"
                                    />
                                  </td>

                                  <td className="px-3 py-1.5 font-mono text-gray-300 max-w-[11rem]">
                                    <span className="block truncate" title={m.column}>{m.column}</span>
                                  </td>

                                  <td className="px-3 py-1.5">
                                    <select
                                      value={tbl} disabled={!enabled}
                                      onChange={(e) => {
                                        setRowTable((prev) => ({ ...prev, [m.column]: e.target.value }));
                                        setRowCol((prev)   => ({ ...prev, [m.column]: "" }));
                                      }}
                                      className={`w-full h-7 rounded-md px-2 text-[11px] font-mono outline-none border transition-colors
                                        ${!enabled ? "cursor-not-allowed bg-white/[0.02] border-white/[0.04] text-gray-700"
                                          : tbl    ? "bg-black border-white/[0.08] text-gray-200"
                                          :          "bg-white/[0.02] border-white/[0.06] text-gray-600"}`}
                                    >
                                      <option value="">— Table —</option>
                                      {selectedTables.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                  </td>

                                  <td className="px-3 py-1.5">
                                    <input
                                      type="text"
                                      list={tbl ? `spi-cols-${tbl}` : undefined}
                                      value={col}
                                      disabled={!enabled || !tbl}
                                      placeholder={!tbl ? "pick table first" : "type to search…"}
                                      onChange={(e) => setRowCol((prev) => ({ ...prev, [m.column]: e.target.value }))}
                                      className={`w-full h-7 rounded-md px-2 text-[11px] font-mono outline-none border transition-colors
                                        ${!enabled || !tbl
                                          ? "bg-white/[0.02] border-white/[0.04] text-gray-700 cursor-not-allowed placeholder:text-gray-800"
                                          : col
                                            ? "bg-black border-white/[0.08] text-gray-200"
                                            : "bg-amber-500/[0.06] border-amber-400/25 text-gray-400 placeholder:text-gray-700"}`}
                                    />
                                  </td>

                                  <td className="px-3 py-1.5">
                                    <select
                                      value={nullBehavior} disabled={!enabled || !col}
                                      onChange={(e) =>
                                        setRowNullBehavior((prev) => ({
                                          ...prev,
                                          [m.column]: e.target.value as "skip" | "null" | "dash" | "na",
                                        }))
                                      }
                                      className={`w-full h-7 rounded-md px-2 text-[11px] outline-none border transition-colors
                                        ${!enabled || !col
                                          ? "bg-white/[0.02] border-white/[0.04] text-gray-700 cursor-not-allowed"
                                          : nullBehavior === "null"
                                            ? "bg-orange-500/10 border-orange-400/25 text-orange-300"
                                            : nullBehavior === "dash" || nullBehavior === "na"
                                              ? "bg-blue-500/10 border-blue-400/25 text-blue-300"
                                              : "bg-black border-white/[0.08] text-gray-400"}`}
                                    >
                                      <option value="skip">Skip</option>
                                      <option value="null">Set NULL</option>
                                      {m.data_type !== "NUMBER" && (
                                        <>
                                          <option value="dash">Set '-'</option>
                                          <option value="na">Set 'N/A'</option>
                                        </>
                                      )}
                                    </select>
                                  </td>

                                  <td className="px-3 py-1.5">
                                    {!enabled ? <Badge color="gray">Ignored</Badge>
                                    : !col      ? <Badge color="amber">Pending</Badge>
                                    : isAuto    ? <Badge color="green">Auto</Badge>
                                    :             <Badge color="blue">Mapped</Badge>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {autoMappedCount > 0 && !loadingCols && (
                  <div className="mt-3 flex items-center gap-2 text-emerald-300 bg-emerald-500/10 border border-emerald-400/20 rounded-md px-3 py-2 text-[11px]">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span>
                      <span className="font-medium">{autoMappedCount} column{autoMappedCount !== 1 ? "s" : ""} auto-mapped</span>
                      {" "}by name match — review and adjust if needed.
                    </span>
                    <button onClick={() => setAutoMappedCount(0)} className="ml-auto text-emerald-600 hover:text-emerald-300 transition-colors shrink-0">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {pendingCount > 0 && !loadingCols && (
                  <div className="mt-3 flex items-start gap-2 text-amber-300 bg-amber-500/10 border border-amber-400/20 rounded-md px-3 py-2 text-[11px]">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>
                      {pendingCount} column{pendingCount !== 1 ? "s" : ""} still need{pendingCount === 1 ? "s" : ""} a SPI column — will be skipped unless mapped or ignored.
                    </span>
                  </div>
                )}

                {/* Action buttons */}
                <div className="mt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-4 border-t border-white/[0.06]">
                  <div>
                    <p className="text-xs font-semibold text-white">Generate SQL updates</p>
                    <p className="text-[11px] text-gray-600 mt-0.5">
                      {selectedTables.some((t) => !tableWhereCol[t] || !tableWhereSpiCol[t])
                        ? "Select WHERE columns for each table above to continue"
                        : mappedCount === 0
                        ? "Map at least one column to continue"
                        : `${mappedCount} column${mappedCount !== 1 ? "s" : ""} included · one .sql file per SPI table`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={handlePreview}
                      disabled={loadingPreview || loadingZip || mappedCount === 0 || selectedTables.some((t) => !tableWhereCol[t] || !tableWhereSpiCol[t])}
                      className="flex items-center gap-1.5 h-8 px-4 rounded-md border border-white/[0.08] bg-white/[0.03] text-xs text-gray-300 hover:bg-white/[0.07] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {loadingPreview
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Previewing…</>
                        : <><Eye className="w-3.5 h-3.5" /> Preview SQL</>}
                    </button>
                    <button
                      onClick={handleGenerateZip}
                      disabled={loadingZip || loadingPreview || mappedCount === 0 || selectedTables.some((t) => !tableWhereCol[t] || !tableWhereSpiCol[t])}
                      className="flex items-center gap-1.5 h-8 px-4 rounded-md bg-white text-black text-xs font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {loadingZip
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                        : <><Download className="w-3.5 h-3.5" /> Download ZIP</>}
                    </button>
                  </div>
                </div>

                {loadingZip && (
                  <div className="mt-3 flex items-center gap-2 text-blue-300 bg-blue-500/10 border border-blue-400/20 rounded-md px-3 py-2 text-[11px]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span>Parsing your file and generating SQL — do not close this tab.</span>
                  </div>
                )}

                {stage === "mapping" && error && <ErrorBanner message={error} className="mt-3" />}
                {zipStats && !loadingZip && !previewData && <DownloadSuccessBanner stats={zipStats} className="mt-3" />}
              </div>
            </div>
          )}

          {/* ── Step 4: Preview panel ─────────────────────────────────────── */}
          {previewData && !loadingPreview && stage === "mapping" && (
            <div className="rounded-md border border-white/[0.08] bg-[#0d0d11]">
              <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
                <div className="flex items-center gap-2">
                  <StepBadge n={4} done={!!zipStats} />
                  <div>
                    <span className="text-xs font-semibold text-white">Preview &amp; Download</span>
                    <span className="ml-2 text-[11px] text-gray-600">Review before downloading</span>
                  </div>
                </div>
                <button onClick={() => { setPreviewData(null); setZipStats(null); }}
                  className="text-gray-600 hover:text-gray-300 transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="p-4 space-y-4">
                {/* Pre-flight summary */}
                <div className="rounded-md border border-white/[0.06] overflow-hidden">
                  <div className="bg-white/[0.02] border-b border-white/[0.06] px-3 py-2">
                    <span className={sectionLabel}>Pre-flight summary</span>
                  </div>
                  <div className="px-4 py-3 flex flex-wrap gap-x-8 gap-y-2 border-b border-white/[0.04]">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.12em] text-gray-600">Total rows</p>
                      <p className="text-lg font-semibold text-white mt-0.5">{previewData.total_rows.toLocaleString()}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.12em] text-gray-600">UPDATE statements</p>
                      <p className="text-lg font-semibold text-white mt-0.5">{previewData.stmt_count.toLocaleString()}</p>
                    </div>
                    {Object.entries(previewData.table_counts).map(([tbl, cnt]) => (
                      <div key={tbl}>
                        <p className="text-[10px] uppercase tracking-[0.12em] text-gray-600 font-mono">{tbl}</p>
                        <p className="text-lg font-semibold text-gray-300 mt-0.5">{cnt.toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                  <div className="divide-y divide-white/[0.04]">
                    {previewData.error_count > 0 && (
                      <div className="flex items-start gap-2 px-4 py-2.5 text-[11px] text-amber-300">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>
                          <span className="font-medium">{previewData.error_count} row{previewData.error_count !== 1 ? "s" : ""} will be skipped</span>
                          {" "}— identifier column empty or unresolvable.
                          {previewData.errors.length > 0 && (
                            <span className="ml-1 text-amber-500"> First: row {previewData.errors[0].row} ({previewData.errors[0].table}): {previewData.errors[0].message}</span>
                          )}
                        </span>
                      </div>
                    )}
                    {Object.entries(previewData.duplicates).map(([tbl, dups]) => (
                      <div key={tbl} className="flex items-start gap-2 px-4 py-2.5 text-[11px] text-amber-300">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>
                          <span className="font-medium">{dups.length} duplicate identifier{dups.length !== 1 ? "s" : ""} in {tbl}</span>
                          {" "}— multiple rows update the same record.
                          <span className="ml-1 font-mono text-amber-500">
                            e.g. {dups[0][0].length > 50 ? dups[0][0].slice(0, 50) + "…" : dups[0][0]} (×{dups[0][1]})
                          </span>
                        </span>
                      </div>
                    ))}
                    {previewData.unknown_columns.length > 0 && (
                      <div className="flex items-start gap-2 px-4 py-2.5 text-[11px] text-gray-500">
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                        <span>
                          <span className="font-medium">{previewData.unknown_columns.length} column{previewData.unknown_columns.length !== 1 ? "s" : ""} not in schema</span>
                          {" "}(ignored): {previewData.unknown_columns.slice(0, 5).join(", ")}{previewData.unknown_columns.length > 5 ? "…" : ""}
                        </span>
                      </div>
                    )}
                    {previewData.error_count === 0 && Object.keys(previewData.duplicates).length === 0 && (
                      <div className="flex items-center gap-2 px-4 py-2.5 text-[11px] text-emerald-300">
                        <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>No issues detected — all rows have valid identifiers.</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* SQL sample */}
                {Object.keys(previewData.sql_preview).length > 0 && (
                  <div className="rounded-md border border-white/[0.06] overflow-hidden">
                    <div className="bg-white/[0.02] border-b border-white/[0.06] px-3 py-2 flex items-center gap-3">
                      <span className={sectionLabel}>SQL sample</span>
                      <span className="text-[10px] text-gray-700">first 5 statements per table</span>
                      <div className="ml-auto flex items-center gap-1">
                        {Object.keys(previewData.sql_preview).map((tbl) => (
                          <button
                            key={tbl} onClick={() => setPreviewTable(tbl)}
                            className={`text-[10px] font-mono px-2 py-1 rounded-md transition-colors
                              ${previewTable === tbl
                                ? "bg-white text-black"
                                : "text-gray-500 hover:text-gray-200 hover:bg-white/[0.06]"}`}
                          >
                            {tbl}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="bg-black p-4 overflow-x-auto">
                      <pre className="text-[11px] text-emerald-400 font-mono leading-relaxed whitespace-pre-wrap">
                        {(previewData.sql_preview[previewTable] || []).join("\n\n")}
                      </pre>
                    </div>
                  </div>
                )}

                {/* Download CTA */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <p className="text-[11px] text-gray-600">
                    {previewData.stmt_count.toLocaleString()} statements · {Object.keys(previewData.table_counts).length} table{Object.keys(previewData.table_counts).length !== 1 ? "s" : ""} · one .sql file per table in the ZIP
                  </p>
                  <button
                    onClick={handleGenerateZip} disabled={loadingZip}
                    className="shrink-0 flex items-center gap-1.5 h-8 px-4 rounded-md bg-white text-black text-xs font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {loadingZip
                      ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</>
                      : <><Download className="w-3.5 h-3.5" /> Download ZIP</>}
                  </button>
                </div>

                {loadingZip && (
                  <div className="flex items-center gap-2 text-blue-300 bg-blue-500/10 border border-blue-400/20 rounded-md px-3 py-2 text-[11px]">
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                    <span>Generating ZIP — do not close this tab.</span>
                  </div>
                )}
                {zipStats && !loadingZip && <DownloadSuccessBanner stats={zipStats} />}
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
