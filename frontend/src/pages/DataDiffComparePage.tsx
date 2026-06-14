import { FC, useState, useRef, useCallback, useEffect } from "react";
import {
  Upload, FileSpreadsheet, X, AlertCircle, Download,
  ChevronLeft, GitCompare, CheckCircle2,
  ArrowRight, ChevronDown, Info, Shuffle, TriangleAlert,
  TrendingUp, TrendingDown, Minus, Loader2,
} from "lucide-react";
import { downloadBlob } from "../utils/downloadBlob";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface FileInfo {
  sheets: string[];
  columns_by_sheet: Record<string, string[]>;
}

interface CompareStats {
  total_file1:       number;
  total_file2:       number;
  matched_keys:      number;
  records_changed:   number;
  records_matched:   number;
  records_removed:   number;
  records_added:     number;
  match_pct:         number;
  top_changed_cols:  { col: string; count: number }[];
  elapsed_ms:        number;
  total_cols:        number;
}

type Stage = "upload" | "configure" | "comparing" | "done";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const API_BASE = import.meta.env.VITE_API_URL || "";

function buildAutoMap(cols1: string[], cols2: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const u2 = cols2.map((c) => ({ orig: c, up: c.toUpperCase() }));
  for (const c1 of cols1) {
    const hit = u2.find((c) => c.up === c1.toUpperCase());
    if (hit) map[c1] = hit.orig;
  }
  return map;
}

async function parseFile(file: File): Promise<FileInfo> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch(`${API_BASE}/api/v1/datadiff/parse`, { method: "POST", body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? res.statusText);
  }
  return res.json();
}

function fmt(n: number): string {
  return n.toLocaleString();
}

// ---------------------------------------------------------------------------
// Match score ring — dark theme version
// ---------------------------------------------------------------------------
const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;

const MatchRing: FC<{ pct: number }> = ({ pct }) => {
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(pct), 60);
    return () => clearTimeout(t);
  }, [pct]);

  const color =
    pct >= 95 ? "#34d399" :
    pct >= 80 ? "#fbbf24" :
                "#f87171";
  const dash = (animated / 100) * RING_C;

  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle cx="70" cy="70" r={RING_R} fill="none" stroke="#1a1a24" strokeWidth="10" />
      <circle
        cx="70" cy="70" r={RING_R}
        fill="none" stroke={color} strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${dash} ${RING_C}`}
        transform="rotate(-90 70 70)"
        style={{ transition: "stroke-dasharray 1.2s cubic-bezier(0.4,0,0.2,1)" }}
      />
      <text x="70" y="65" textAnchor="middle" fontSize="22" fontWeight="700" fill="#ffffff">
        {pct.toFixed(1)}%
      </text>
      <text x="70" y="82" textAnchor="middle" fontSize="10" fill="#6b7280">
        Match Score
      </text>
    </svg>
  );
};

// ---------------------------------------------------------------------------
// Stat card — dark
// ---------------------------------------------------------------------------
const StatCard: FC<{
  label: string; value: number;
  borderCls: string; icon: React.ReactNode; sub?: string;
}> = ({ label, value, borderCls, icon, sub }) => {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    const step = Math.ceil(value / 30);
    let cur = 0;
    const id = setInterval(() => {
      cur = Math.min(cur + step, value);
      setDisplay(cur);
      if (cur >= value) clearInterval(id);
    }, 30);
    return () => clearInterval(id);
  }, [value]);

  return (
    <div className={`rounded-md border p-4 flex flex-col gap-1 bg-white/[0.03] ${borderCls}`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-gray-500 font-medium">{label}</span>
        <span className="text-gray-500">{icon}</span>
      </div>
      <span className="text-2xl font-bold text-white">{fmt(display)}</span>
      {sub && <span className="text-[11px] text-gray-600">{sub}</span>}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Top changed columns chart — dark
// ---------------------------------------------------------------------------
const ChangedColsChart: FC<{ cols: { col: string; count: number }[]; total: number }> = ({ cols, total }) => {
  const max = cols[0]?.count ?? 1;
  return (
    <div className="space-y-3">
      {cols.map(({ col, count }, i) => {
        const pct   = (count / max) * 100;
        const share = total > 0 ? ((count / total) * 100).toFixed(1) : "0";
        return (
          <div key={col}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-mono text-gray-400 truncate max-w-[60%]">{col}</span>
              <span className="text-[11px] text-gray-500 shrink-0 ml-2">
                {fmt(count)} <span className="text-gray-700">({share}%)</span>
              </span>
            </div>
            <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-red-400"
                style={{
                  width: `${pct}%`,
                  transition: `width ${0.6 + i * 0.1}s cubic-bezier(0.4,0,0.2,1)`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Loading animation — dark
// ---------------------------------------------------------------------------
const LOADING_STEPS = [
  { pct: 8,  msg: "Reading both Excel files…" },
  { pct: 18, msg: "Parsing sheet structure…" },
  { pct: 30, msg: "Indexing lookup keys…" },
  { pct: 44, msg: "Running vectorized merge…" },
  { pct: 58, msg: "Comparing columns…" },
  { pct: 70, msg: "Computing change statistics…" },
  { pct: 80, msg: "Building colour-coded Excel…" },
  { pct: 88, msg: "Applying conditional formatting…" },
  { pct: 93, msg: "Almost there…" },
];

const LoadingView: FC<{ file1Label: string; file2Label: string }> = ({ file1Label, file2Label }) => {
  const [step,   setStep]   = useState(0);
  const [barPct, setBarPct] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => {
        const next = Math.min(s + 1, LOADING_STEPS.length - 1);
        setBarPct(LOADING_STEPS[next].pct);
        return next;
      });
    }, 2200);
    setBarPct(LOADING_STEPS[0].pct);
    return () => clearInterval(id);
  }, []);

  const { msg } = LOADING_STEPS[step];

  return (
    <div className="flex flex-col items-center justify-center py-24 gap-8 max-w-lg mx-auto text-center">
      <div className="relative w-20 h-20">
        <div className="absolute inset-0 rounded-full bg-white/[0.04] animate-ping opacity-40" />
        <div className="relative w-20 h-20 rounded-full bg-white/[0.06] border border-white/[0.10] flex items-center justify-center">
          <GitCompare className="w-8 h-8 text-white/60 animate-pulse" />
        </div>
      </div>
      <div className="w-full">
        <div className="flex items-center justify-between text-[11px] text-gray-500 mb-2">
          <span>{msg}</span>
          <span>{barPct}%</span>
        </div>
        <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
          <div
            className="h-full bg-white rounded-full"
            style={{ width: `${barPct}%`, transition: "width 1.8s cubic-bezier(0.4,0,0.2,1)" }}
          />
        </div>
      </div>
      <div className="text-xs text-gray-500">
        Comparing <strong className="text-gray-300">{file1Label}</strong> vs{" "}
        <strong className="text-gray-300">{file2Label}</strong>
      </div>
      <p className="text-[11px] text-gray-700">
        Large files (&gt;50k rows) may take up to 30s — all processing is vectorized.
      </p>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Results dashboard — dark
// ---------------------------------------------------------------------------
const ResultsDashboard: FC<{
  stats:      CompareStats;
  filename:   string;
  jobId:      string;
  file1Label: string;
  file2Label: string;
  onReset:    () => void;
}> = ({ stats, filename, jobId, file1Label, file2Label, onReset }) => {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/datadiff/download/${jobId}`);
      if (!res.ok) throw new Error("Result may have expired — re-run the comparison.");
      downloadBlob(await res.blob(), filename);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Download failed.");
    } finally {
      setDownloading(false);
    }
  };

  const secs = (stats.elapsed_ms / 1000).toFixed(1);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-base font-semibold text-white">Comparison complete</p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {fmt(stats.total_file1)} rows · {stats.total_cols} columns · {secs}s
          </p>
        </div>
        <button
          onClick={handleDownload} disabled={downloading}
          className="flex items-center gap-2 h-8 px-4 rounded-md bg-white text-black text-xs font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40"
        >
          {downloading
            ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Downloading…</>
            : <><Download className="w-3.5 h-3.5" /> Download Report</>}
        </button>
      </div>

      {/* Score + stat cards */}
      <div className="rounded-md border border-white/[0.08] bg-[#0d0d11] p-5">
        <div className="flex flex-col md:flex-row items-center gap-8">
          <div className="flex flex-col items-center gap-2 shrink-0">
            <MatchRing pct={stats.match_pct} />
            <div className="flex items-center gap-1.5 text-[11px] text-gray-600">
              {stats.match_pct >= 95
                ? <TrendingUp  className="w-3 h-3 text-emerald-400" />
                : stats.match_pct >= 80
                ? <Minus       className="w-3 h-3 text-amber-400" />
                : <TrendingDown className="w-3 h-3 text-red-400" />}
              {file1Label} vs {file2Label}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 flex-1 w-full">
            <StatCard label="Fully Matched"     value={stats.records_matched}  borderCls="border-emerald-400/20" icon={<CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />} sub={`of ${fmt(stats.matched_keys)} compared`} />
            <StatCard label="Differences Found" value={stats.records_changed}  borderCls="border-red-400/20"     icon={<AlertCircle  className="w-3.5 h-3.5 text-red-400" />}     sub="records with changes" />
            <StatCard label="Added"             value={stats.records_added}    borderCls="border-amber-400/20"   icon={<TrendingUp   className="w-3.5 h-3.5 text-amber-400" />}   sub={`only in ${file2Label}`} />
            <StatCard label="Removed"           value={stats.records_removed}  borderCls="border-white/[0.08]"   icon={<TrendingDown className="w-3.5 h-3.5 text-gray-500" />}   sub={`only in ${file1Label}`} />
          </div>
        </div>
      </div>

      {/* Top changed columns */}
      {stats.top_changed_cols.length > 0 && (
        <div className="rounded-md border border-white/[0.08] bg-[#0d0d11] p-5">
          <p className="text-xs font-semibold text-white mb-1">Most changed columns</p>
          <p className="text-[11px] text-gray-600 mb-4">
            Columns with the highest number of cell-level differences across matched records.
          </p>
          <ChangedColsChart cols={stats.top_changed_cols} total={stats.records_changed || 1} />
        </div>
      )}

      {/* Excel colour legend */}
      <div className="rounded-md border border-white/[0.06] bg-white/[0.02] px-5 py-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600 mb-3">
          Report colour key
        </p>
        <div className="flex flex-wrap gap-4">
          {[
            { color: "#CCFFCC", label: "Matched" },
            { color: "#FFCCCC", label: "Not Matched / Removed" },
            { color: "#FFF3CD", label: "Added" },
            { color: "#B3CDE0", label: `${file1Label} headers` },
            { color: "#FEEBAD", label: `${file2Label} headers` },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className="w-3 h-3 rounded-sm border border-white/[0.10] shrink-0" style={{ backgroundColor: color }} />
              {label}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-gray-700 mt-3">
          Report available for 10 minutes. Download before it expires.
        </p>
      </div>

      <div className="flex justify-between items-center">
        <button onClick={onReset} className="text-xs text-gray-600 hover:text-gray-200 transition-colors">
          ← Compare another pair
        </button>
        <button onClick={handleDownload} disabled={downloading}
          className="flex items-center gap-1.5 h-8 px-4 rounded-md border border-white/[0.08] bg-white/[0.03] text-xs text-gray-300 hover:bg-white/[0.07] transition-colors disabled:opacity-40">
          {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Download again
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Drop zone — dark
// ---------------------------------------------------------------------------
interface DropZoneProps {
  label: string; file: File | null;
  onFile: (f: File) => void; onClear: () => void;
  accent: "blue" | "amber";
}

const DropZone: FC<DropZoneProps> = ({ label, file, onFile, onClear, accent }) => {
  const ref  = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const handle = (f: File) => { if (f.name.match(/\.(xlsx|xls)$/i)) onFile(f); };

  const border = accent === "blue"
    ? drag
      ? "border-blue-400/60 bg-blue-500/[0.08]"
      : "border-white/[0.08] hover:border-blue-400/40 hover:bg-blue-500/[0.05]"
    : drag
      ? "border-amber-400/60 bg-amber-500/[0.08]"
      : "border-white/[0.08] hover:border-amber-400/40 hover:bg-amber-500/[0.05]";

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600">{label}</span>
      {file ? (
        <div className="flex items-center gap-3 border border-white/[0.08] rounded-md px-3 py-2.5 bg-white/[0.03]">
          <FileSpreadsheet className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs text-gray-200 font-medium truncate flex-1">{file.name}</span>
          <button onClick={onClear} className="text-gray-600 hover:text-red-400 transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          className={`border-2 border-dashed rounded-md p-7 flex flex-col items-center gap-3 transition-colors cursor-pointer w-full ${border}`}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handle(f); }}
          onClick={() => ref.current?.click()}
        >
          <Upload className="w-6 h-6 text-gray-600" />
          <span className="text-xs text-gray-500 text-center">
            Drop .xlsx / .xls<br />
            <span className="text-[11px] text-gray-700">or click to browse</span>
          </span>
          <input ref={ref} type="file" accept=".xlsx,.xls" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handle(f); }} />
        </button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Toggle — dark
// ---------------------------------------------------------------------------
interface ToggleProps { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; }

const Toggle: FC<ToggleProps> = ({ label, hint, checked, onChange }) => (
  <label className="flex items-start gap-3 cursor-pointer select-none">
    <button
      role="switch" aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`mt-0.5 w-9 h-5 rounded-full relative shrink-0 transition-colors
        ${checked ? "bg-white/80" : "bg-white/[0.10]"}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow transition-transform
        ${checked ? "translate-x-4 bg-black" : "bg-white/60"}`} />
    </button>
    <div>
      <span className="text-xs font-medium text-gray-300">{label}</span>
      {hint && <p className="text-[11px] text-gray-600 mt-0.5">{hint}</p>}
    </div>
  </label>
);

// ---------------------------------------------------------------------------
// Select — dark
// ---------------------------------------------------------------------------
interface SelectProps { value: string; onChange: (v: string) => void; options: string[]; placeholder?: string; }

const Select: FC<SelectProps> = ({ value, onChange, options, placeholder }) => (
  <div className="relative">
    <select
      value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full appearance-none h-8 bg-black border border-white/[0.08] rounded-md px-2.5 pr-8
        text-xs text-gray-200 outline-none focus:border-white/[0.18] transition-colors"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
    <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-600 pointer-events-none" />
  </div>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
interface DataDiffComparePageProps { onBack: () => void; }

export const DataDiffComparePage: FC<DataDiffComparePageProps> = ({ onBack }) => {
  const [file1, setFile1] = useState<File | null>(null);
  const [file2, setFile2] = useState<File | null>(null);
  const [file1Label, setFile1Label] = useState("Rev-A");
  const [file2Label, setFile2Label] = useState("Rev-B");

  const [info1, setInfo1]       = useState<FileInfo | null>(null);
  const [info2, setInfo2]       = useState<FileInfo | null>(null);
  const [parsing, setParsing]   = useState(false);
  const [parseErr, setParseErr] = useState<string | null>(null);

  const [sheet1, setSheet1]         = useState("");
  const [sheet2, setSheet2]         = useState("");
  const [lookupCol1, setLookupCol1] = useState("");
  const [lookupCol2, setLookupCol2] = useState("");
  const [columnMap, setColumnMap]   = useState<Record<string, string>>({});
  const [ignoreSpaces,    setIgnoreSpaces]    = useState(true);
  const [ignoreHyphens,   setIgnoreHyphens]   = useState(false);
  const [caseInsensitive, setCaseInsensitive] = useState(false);
  const [ignoreSpecial,   setIgnoreSpecial]   = useState(false);
  const [showColMap,      setShowColMap]      = useState(false);

  const [stage,      setStage]      = useState<Stage>("upload");
  const [compareErr, setCompareErr] = useState<string | null>(null);
  const [stats,      setStats]      = useState<CompareStats | null>(null);
  const [jobId,      setJobId]      = useState("");
  const [filename,   setFilename]   = useState("datadiff_report.xlsx");

  const cols1 = info1?.columns_by_sheet[sheet1] ?? [];
  const cols2 = info2?.columns_by_sheet[sheet2] ?? [];

  useEffect(() => { if (info1 && !sheet1) setSheet1(info1.sheets[0] ?? ""); }, [info1]);
  useEffect(() => { if (info2 && !sheet2) setSheet2(info2.sheets[0] ?? ""); }, [info2]);

  useEffect(() => {
    if (!lookupCol1 || !cols2.length) return;
    const match = cols2.find((c) => c.toUpperCase() === lookupCol1.toUpperCase());
    setLookupCol2(match ?? "");
  }, [lookupCol1, cols2]);

  useEffect(() => {
    if (cols1.length && cols2.length) setColumnMap(buildAutoMap(cols1, cols2));
  }, [cols1, cols2]);

  const handleContinue = useCallback(async () => {
    if (!file1 || !file2) return;
    setParsing(true); setParseErr(null);
    try {
      const [i1, i2] = await Promise.all([parseFile(file1), parseFile(file2)]);
      setInfo1(i1); setInfo2(i2);
      setStage("configure");
    } catch (e: unknown) {
      setParseErr(e instanceof Error ? e.message : "Failed to read files.");
    } finally {
      setParsing(false);
    }
  }, [file1, file2]);

  const handleCompare = useCallback(async () => {
    if (!file1 || !file2 || !sheet1 || !sheet2 || !lookupCol1 || !lookupCol2) return;
    setStage("comparing"); setCompareErr(null);
    try {
      const config = {
        sheet1, sheet2,
        lookup_col1: lookupCol1, lookup_col2: lookupCol2,
        file1_name: file1Label || "File1", file2_name: file2Label || "File2",
        column_map: columnMap,
        ignore_spaces: ignoreSpaces, ignore_hyphens: ignoreHyphens,
        case_insensitive: caseInsensitive, ignore_special: ignoreSpecial,
      };
      const fd = new FormData();
      fd.append("file1", file1);
      fd.append("file2", file2);
      fd.append("config", JSON.stringify(config));

      const res = await fetch(`${API_BASE}/api/v1/datadiff/compare`, { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail ?? res.statusText);
      }
      const data = await res.json();
      setJobId(data.job_id);
      setStats(data.stats);
      setFilename(data.filename);
      setStage("done");
    } catch (e: unknown) {
      setCompareErr(e instanceof Error ? e.message : "Comparison failed.");
      setStage("configure");
    }
  }, [file1, file2, sheet1, sheet2, lookupCol1, lookupCol2, file1Label, file2Label,
      columnMap, ignoreSpaces, ignoreHyphens, caseInsensitive, ignoreSpecial]);

  const resetAll = () => {
    setFile1(null); setFile2(null);
    setInfo1(null); setInfo2(null);
    setSheet1(""); setSheet2("");
    setLookupCol1(""); setLookupCol2("");
    setColumnMap({}); setStats(null); setJobId("");
    setParseErr(null); setCompareErr(null);
    setStage("upload");
  };

  const unmappedCols = cols1.filter((c) => c !== lookupCol1 && !columnMap[c]);

  const steps   = ["Upload", "Configure", "Results"];
  const stepIdx = stage === "upload" ? 0 : stage === "configure" ? 1 : 2;

  const sectionLabel = "text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-600";

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#09090c] text-gray-200">

      {/* Header */}
      <div className="shrink-0 border-b border-white/[0.06] bg-[#0d0d11] px-5 py-3 flex items-center gap-3">
        <button onClick={onBack}
          className="flex items-center gap-1.5 text-gray-500 hover:text-gray-200 text-xs transition-colors">
          <ChevronLeft className="w-3.5 h-3.5" />
          DataDiff
        </button>
        <span className="text-white/[0.15]">/</span>
        <div className="flex items-center gap-2">
          <GitCompare className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-sm font-semibold text-white">Comparison Wizard</span>
        </div>

        {/* Step pills */}
        <div className="ml-auto hidden md:flex items-center gap-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full transition-colors ${
                i < stepIdx  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-400/20" :
                i === stepIdx ? "bg-white text-black" :
                                "bg-white/[0.04] text-gray-600"}`}>
                {i < stepIdx && <CheckCircle2 className="w-3 h-3" />}
                {s}
              </div>
              {i < steps.length - 1 && <div className="w-5 h-px bg-white/[0.08]" />}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto xyra-scroll-contained">
        <div className="max-w-3xl mx-auto px-5 py-6">

          {/* ── STEP 1 — Upload ──────────────────────────────────────────── */}
          {stage === "upload" && (
            <div>
              <p className="text-sm font-semibold text-white mb-0.5">Upload both files</p>
              <p className="text-[11px] text-gray-500 mb-6">
                Supports .xlsx / .xls up to 50 MB. Handles 50,000+ rows.
              </p>

              <div className="grid md:grid-cols-2 gap-5 mb-6">
                {([
                  { file: file1, setFile: setFile1, label: file1Label, setLabel: setFile1Label, side: "File 1 — Base revision",    accent: "blue"  as const },
                  { file: file2, setFile: setFile2, label: file2Label, setLabel: setFile2Label, side: "File 2 — Updated revision", accent: "amber" as const },
                ] as const).map(({ file, setFile, label, setLabel, side, accent }) => (
                  <div key={side} className="flex flex-col gap-3">
                    <DropZone label={side} file={file} onFile={setFile} onClear={() => setFile(null)} accent={accent} />
                    {file && (
                      <div>
                        <label className="text-[11px] text-gray-600 mb-1 block">Short label (e.g. Rev-A)</label>
                        <input
                          value={label} onChange={(e) => setLabel(e.target.value)}
                          placeholder={accent === "blue" ? "Rev-A" : "Rev-B"}
                          className="h-8 w-full rounded-md border border-white/[0.08] bg-black px-2.5 text-xs text-gray-200 placeholder:text-gray-700 outline-none focus:border-white/[0.18] transition-colors"
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {parseErr && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-400/20 rounded-md px-4 py-3 mb-5 text-xs text-red-300">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{parseErr}
                </div>
              )}

              <div className="flex justify-end">
                <button
                  onClick={handleContinue} disabled={!file1 || !file2 || parsing}
                  className="flex items-center gap-2 h-8 px-5 rounded-md bg-white text-black text-xs font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40"
                >
                  {parsing
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading…</>
                    : <>Continue <ArrowRight className="w-3.5 h-3.5" /></>}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP 2 — Configure ───────────────────────────────────────── */}
          {stage === "configure" && info1 && info2 && (
            <div className="flex flex-col gap-4">
              <div>
                <p className="text-sm font-semibold text-white mb-0.5">Configure comparison</p>
                <p className="text-[11px] text-gray-500">Select sheets, pick the lookup key, tweak options.</p>
              </div>

              {/* Sheet selection */}
              <div className="rounded-md border border-white/[0.08] bg-[#0d0d11] p-4">
                <p className="text-xs font-semibold text-white mb-3">Sheet selection</p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[11px] text-gray-600 mb-1.5 block">File 1 sheet ({file1Label})</label>
                    <Select value={sheet1} onChange={setSheet1} options={info1.sheets} />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-600 mb-1.5 block">File 2 sheet ({file2Label})</label>
                    <Select value={sheet2} onChange={setSheet2} options={info2.sheets} />
                  </div>
                </div>
              </div>

              {/* Lookup key */}
              <div className="rounded-md border border-white/[0.08] bg-[#0d0d11] p-4">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs font-semibold text-white">Lookup key</p>
                  <div className="group relative">
                    <Info className="w-3 h-3 text-gray-600 cursor-help" />
                    <div className="absolute left-5 -top-1 w-52 bg-[#0d0d11] border border-white/[0.10] text-gray-400 text-[11px] rounded-md p-2.5 hidden group-hover:block z-10 shadow-xl">
                      The unique identifier column — e.g. TAG_NUMBER, ITEM_NO. Records are matched across both files using this key.
                    </div>
                  </div>
                </div>
                <p className="text-[11px] text-gray-600 mb-4">Must be unique per row. Used to match records between revisions.</p>
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-[11px] text-gray-600 mb-1.5 block">Key column in File 1</label>
                    <Select value={lookupCol1} onChange={setLookupCol1} options={cols1} placeholder="— select lookup key —" />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-600 mb-1.5 block">Key column in File 2</label>
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Select value={lookupCol2} onChange={setLookupCol2} options={cols2} placeholder="— select lookup key —" />
                      </div>
                      {lookupCol2 && lookupCol2.toUpperCase() === lookupCol1.toUpperCase() && (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Options */}
              <div className="rounded-md border border-white/[0.08] bg-[#0d0d11] p-4">
                <p className="text-xs font-semibold text-white mb-4">Comparison options</p>
                <div className="grid sm:grid-cols-2 gap-4">
                  <Toggle label="Ignore extra spaces"  hint="'10 PSI' = '10PSI'"   checked={ignoreSpaces}     onChange={setIgnoreSpaces} />
                  <Toggle label="Ignore hyphens ( - )" hint="'FT-101' = 'FT101'"   checked={ignoreHyphens}    onChange={setIgnoreHyphens} />
                  <Toggle label="Case-insensitive"     hint="'Open' = 'OPEN'"      checked={caseInsensitive}  onChange={setCaseInsensitive} />
                  <Toggle label="Ignore / _ ."         hint="'N/A' = 'NA'"         checked={ignoreSpecial}    onChange={setIgnoreSpecial} />
                </div>
              </div>

              {/* Column mapping */}
              <div className="rounded-md border border-white/[0.08] bg-[#0d0d11] overflow-hidden">
                <button onClick={() => setShowColMap(!showColMap)}
                  className="w-full flex items-center justify-between px-4 py-3 text-xs font-semibold text-white hover:bg-white/[0.02] transition-colors">
                  <div className="flex items-center gap-2">
                    <Shuffle className="w-3.5 h-3.5 text-gray-500" />
                    Column mapping
                    {unmappedCols.length > 0 && (
                      <span className="ml-1 inline-flex items-center gap-1 text-[10px] bg-amber-500/10 border border-amber-400/20 text-amber-300 px-2 py-0.5 rounded-full">
                        <TriangleAlert className="w-2.5 h-2.5" />{unmappedCols.length} unmapped
                      </span>
                    )}
                    {Object.keys(columnMap).length > 0 && unmappedCols.length === 0 && (
                      <span className="ml-1 text-[10px] text-emerald-300 bg-emerald-500/10 border border-emerald-400/20 px-2 py-0.5 rounded-full">
                        All matched
                      </span>
                    )}
                  </div>
                  <ChevronDown className={`w-3.5 h-3.5 text-gray-600 transition-transform ${showColMap ? "rotate-180" : ""}`} />
                </button>

                {showColMap && (
                  <div className="border-t border-white/[0.06] px-4 pb-4">
                    <p className="text-[11px] text-gray-600 mt-3 mb-3">
                      Columns with identical names are auto-mapped. Manually map any renamed headers.
                    </p>
                    <div className="flex justify-end mb-3">
                      <button onClick={() => setColumnMap(buildAutoMap(cols1, cols2))}
                        className="text-[11px] text-gray-500 border border-white/[0.08] rounded-md px-3 h-6 hover:bg-white/[0.04] transition-colors">
                        Reset auto-map
                      </button>
                    </div>
                    <div className="space-y-2 max-h-64 overflow-y-auto xyra-scroll-contained pr-1">
                      {cols1.filter((c) => c !== lookupCol1).map((c1) => {
                        const mapped    = columnMap[c1] ?? "";
                        const isAutoMap = cols2.some((c2) => c2.toUpperCase() === c1.toUpperCase());
                        return (
                          <div key={c1} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                            <div className={`text-[11px] font-mono rounded-md px-2 py-1 truncate ${
                              isAutoMap && mapped ? "bg-blue-500/10 text-blue-300" : "bg-white/[0.04] text-gray-500"}`}>
                              {c1}
                            </div>
                            <ArrowRight className="w-3 h-3 text-gray-700 shrink-0" />
                            <div className="relative">
                              <select
                                value={mapped}
                                onChange={(e) => setColumnMap((p) => ({ ...p, [c1]: e.target.value }))}
                                className="w-full appearance-none text-[11px] h-7 border border-white/[0.08] rounded-md px-2 pr-6 bg-amber-500/[0.06] text-amber-200 outline-none focus:border-white/[0.18]"
                              >
                                <option value="">— skip —</option>
                                {cols2.map((c2) => <option key={c2} value={c2}>{c2}</option>)}
                              </select>
                              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-600 pointer-events-none" />
                              {mapped && isAutoMap && (
                                <CheckCircle2 className="absolute right-6 top-1/2 -translate-y-1/2 w-3 h-3 text-emerald-400 pointer-events-none" />
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {compareErr && (
                <div className="flex items-start gap-2 bg-red-500/10 border border-red-400/20 rounded-md px-4 py-3 text-xs text-red-300">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{compareErr}
                </div>
              )}

              <div className="flex justify-between pt-1">
                <button onClick={() => setStage("upload")}
                  className="flex items-center gap-1.5 h-8 px-4 rounded-md border border-white/[0.08] bg-white/[0.03] text-xs text-gray-300 hover:bg-white/[0.07] transition-colors">
                  <ChevronLeft className="w-3.5 h-3.5" /> Back
                </button>
                <button onClick={handleCompare} disabled={!lookupCol1 || !lookupCol2}
                  className="flex items-center gap-1.5 h-8 px-5 rounded-md bg-white text-black text-xs font-semibold hover:bg-gray-200 transition-colors disabled:opacity-40">
                  Compare <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* ── COMPARING ─────────────────────────────────────────────────── */}
          {stage === "comparing" && (
            <LoadingView file1Label={file1Label} file2Label={file2Label} />
          )}

          {/* ── STEP 3 — Results ──────────────────────────────────────────── */}
          {stage === "done" && stats && (
            <ResultsDashboard
              stats={stats}
              filename={filename}
              jobId={jobId}
              file1Label={file1Label}
              file2Label={file2Label}
              onReset={resetAll}
            />
          )}

          {/* Unused — suppress TS warning */}
          <span className="hidden">{sectionLabel}</span>
        </div>
      </div>
    </div>
  );
};

export default DataDiffComparePage;
