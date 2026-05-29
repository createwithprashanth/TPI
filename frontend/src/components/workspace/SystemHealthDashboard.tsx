import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  Boxes,
  Cpu,
  Database,
  Gauge,
  Network,
  Power,
  RefreshCw,
  Server,
  X,
  Zap,
} from 'lucide-react';
import SystemHealthDataFabric from './SystemHealthDataFabric';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ServiceStatus {
  label: string;
  ok: boolean;
  role?: string;
  scope?: string;
  detail?: string;
  params?: string;
  quant?: string;
  size_gb?: number;
  family?: string;
  queue_depth?: number;
  active_workers?: number;
  failed_jobs?: number;
}

interface HealthData {
  services: Record<string, ServiceStatus>;
  metrics?: {
    queue_depth?: number;
    failed_jobs?: number;
    active_workers?: number;
    read_only?: boolean;
    deployment?: string;
  };
  ts: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const INFRA_KEYS = ['backend', 'redis', 'rq_worker', 'ollama'] as const;
const MODEL_KEYS = ['pid_model', 'line_model', 'project_context_model'] as const;
const ALL_KEYS = [...INFRA_KEYS, ...MODEL_KEYS] as const;
const REFRESH_INTERVAL = 15_000;

const INFRA_META: Record<string, { icon: React.ReactNode; title: string }> = {
  backend: { icon: <Server className="w-3.5 h-3.5" />, title: 'API Core' },
  redis: { icon: <Database className="w-3.5 h-3.5" />, title: 'State Bus' },
  rq_worker: { icon: <Zap className="w-3.5 h-3.5" />, title: 'Worker Engine' },
  ollama: { icon: <Cpu className="w-3.5 h-3.5" />, title: 'LLM Runtime' },
};

const MODEL_META: Record<string, { desc: string; accent: string }> = {
  pid_model: {
    desc: 'Instrument classification and ISA-5.1 reasoning',
    accent: 'from-white to-zinc-400',
  },
  line_model: {
    desc: 'Instrument-to-line connection reasoning',
    accent: 'from-zinc-200 to-zinc-500',
  },
  project_context_model: {
    desc: 'Project, scope, title-block, and cover-sheet context',
    accent: 'from-zinc-500 to-zinc-200',
  },
};

function serviceDetail(svc: ServiceStatus | undefined, fallback: string) {
  return svc?.detail || svc?.scope || svc?.role || fallback;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

function useCountUp(target: number, active: boolean, ms = 850) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) {
      setVal(0);
      return;
    }
    let start: number | null = null;
    let raf = 0;
    const step = (ts: number) => {
      if (!start) start = ts;
      const t = Math.min((ts - start) / ms, 1);
      const eased = 1 - (1 - t) ** 3;
      setVal(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, active, ms]);
  return val;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function elapsed(ts: number): string {
  const s = Math.round((Date.now() - ts * 1000) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

function statusTone(ok: boolean | undefined) {
  if (ok === undefined) return 'border-zinc-700 bg-black text-zinc-500';
  return ok
    ? 'border-white bg-white text-black'
    : 'border-zinc-500 bg-black text-zinc-300';
}

// ── Sub-components ────────────────────────────────────────────────────────────

const StatusPill: React.FC<{ ok: boolean | undefined }> = ({ ok }) => (
  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold tracking-widest ${statusTone(ok)}`}>
    {ok === undefined ? 'SCAN' : ok ? 'LIVE' : 'DOWN'}
  </span>
);

const PulseNode: React.FC<{ ok: boolean | undefined }> = ({ ok }) => (
  <span className="relative inline-flex h-2.5 w-2.5 shrink-0">
    {ok && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-35" />}
    <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${ok ? 'bg-white' : ok === false ? 'bg-zinc-500' : 'bg-zinc-700'}`} />
  </span>
);

const FillBar: React.FC<{ pct: number; color: string }> = ({ pct, color }) => {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setWidth(pct), 120);
    return () => clearTimeout(t);
  }, [pct]);
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-all duration-1000 ease-out`} style={{ width: `${width}%` }} />
    </div>
  );
};

const MetricTile: React.FC<{ icon: React.ReactNode; value: string; label: string; strong?: boolean }> = ({
  icon,
  value,
  label,
  strong,
}) => (
  <div className={`rounded border px-2 py-1.5 ${strong ? 'border-white bg-white text-black' : 'border-zinc-800 bg-[#050505] text-zinc-100'}`}>
    <div className={`mb-1 flex items-center justify-between ${strong ? 'text-black/60' : 'text-zinc-500'}`}>
      {icon}
    </div>
    <p className={`font-mono text-[17px] font-semibold leading-none tabular-nums ${strong ? 'text-black' : 'text-zinc-100'}`}>{value}</p>
    <p className={`mt-1 truncate text-[8px] uppercase tracking-wider ${strong ? 'text-black/55' : 'text-zinc-500'}`}>{label}</p>
  </div>
);

// ── Main component ────────────────────────────────────────────────────────────

const SystemHealthDashboard: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL / 1000);
  const [booting, setBooting] = useState(false);
  const [bootMsg, setBootMsg] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/v1/system/health');
      if (!resp.ok) throw new Error(`health ${resp.status}`);
      setData((await resp.json()) as HealthData);
    } catch {
      // Keep stale data visible; the badge will show degraded on next good read.
    } finally {
      setLoading(false);
      setCountdown(REFRESH_INTERVAL / 1000);
    }
  }, []);

  const bootSystem = useCallback(async () => {
    setBooting(true);
    setBootMsg(null);
    try {
      const resp = await fetch('/api/v1/system/start', { method: 'POST' });
      if (resp.status === 403) {
        setBootMsg('Boot disabled — set ALLOW_SYSTEM_WORKER_START=true in .env');
        return;
      }
      const json = await resp.json() as { results: Record<string, string> };
      const r = json.results ?? {};
      const started = Object.values(r).filter(v => v === 'started').length;
      const already = Object.values(r).filter(v => v === 'already_running').length;
      setBootMsg(
        started > 0
          ? `Started ${started} service${started > 1 ? 's' : ''}${already > 0 ? `, ${already} already live` : ''}`
          : 'All services already running',
      );
      // Refresh health after services have had time to settle
      setTimeout(() => fetchHealth(), 3000);
    } catch {
      setBootMsg('Boot request failed — backend may be down');
    } finally {
      setBooting(false);
      setTimeout(() => setBootMsg(null), 6000);
    }
  }, [fetchHealth]);

  useEffect(() => {
    fetchHealth();
    const schedule = () => {
      timerRef.current = setTimeout(() => fetchHealth().then(schedule), REFRESH_INTERVAL);
    };
    schedule();
    countdownRef.current = setInterval(() => setCountdown(c => (c > 0 ? c - 1 : 0)), 1000);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [fetchHealth]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);

  const liveCount = data ? ALL_KEYS.filter(k => data.services[k]?.ok).length : 0;
  const totalGb = data ? MODEL_KEYS.reduce((s, k) => s + (data.services[k]?.size_gb ?? 0), 0) : 0;
  const healthPct = Math.round((liveCount / ALL_KEYS.length) * 100);
  const allOk = liveCount === ALL_KEYS.length;
  const critDown = data ? ['backend', 'redis', 'rq_worker'].some(k => !data.services[k]?.ok) : true;
  const degraded = !!data && !allOk && !critDown;
  const queueDepth = data?.metrics?.queue_depth ?? data?.services.rq_worker?.queue_depth ?? 0;
  const activeWorkers = data?.metrics?.active_workers ?? data?.services.rq_worker?.active_workers ?? 0;
  const failedJobs = data?.metrics?.failed_jobs ?? data?.services.rq_worker?.failed_jobs ?? 0;

  const liveAnim = useCountUp(liveCount, open);
  const gbAnim = useCountUp(Math.round(totalGb * 10), open);
  const pctAnim = useCountUp(healthPct, open);
  const queueAnim = useCountUp(queueDepth, open);

  const badgeClass = !data
    ? 'border-zinc-700 bg-black text-zinc-500'
    : critDown
      ? 'border-zinc-500 bg-black text-zinc-300'
      : degraded
        ? 'border-white bg-black text-white'
        : 'border-white bg-white text-black';
  const badgeLabel = !data ? 'scanning fabric' : critDown ? 'core service down' : degraded ? 'running degraded' : 'compute fabric online';
  const triggerDot = !data ? 'bg-zinc-600' : critDown ? 'bg-zinc-400' : degraded ? 'bg-white' : 'bg-white animate-pulse';

  const overlay = open && typeof document !== 'undefined'
    ? createPortal(
        <>
          <div
            className="fixed bg-black"
            style={{ inset: 0, zIndex: 2147483000 }}
            onClick={() => setOpen(false)}
          />

          <div
            className="fixed flex min-h-0 flex-col overflow-hidden bg-black shadow-2xl"
            style={{
              top: 12,
              right: 12,
              bottom: 12,
              left: 12,
              width: 'calc(100vw - 24px)',
              height: 'calc(100vh - 24px)',
              zIndex: 2147483001,
            }}
          >
            <SystemHealthDataFabric active={open} />

            <div className="relative h-px shrink-0 bg-gradient-to-r from-transparent via-white/70 to-transparent" />

            <div className="relative flex shrink-0 items-center justify-between border-b border-white/15 bg-black px-3 py-2">
              <div className="flex items-center gap-2">
                <Activity className="h-3.5 w-3.5 text-white" />
                <div>
                  <p className="text-[12px] font-semibold leading-none text-white">XYRA System Core</p>
                  <p className="mt-0.5 font-mono text-[8px] uppercase tracking-wider text-zinc-500">
                    {data?.metrics?.deployment ?? 'client'} deployment · internal compute · read-only telemetry
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] ${badgeClass}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${triggerDot}`} />
                  {badgeLabel}
                </span>
                <button
                  onClick={() => setOpen(false)}
                  className="flex h-5 w-5 items-center justify-center rounded text-zinc-500 transition-colors hover:bg-white hover:text-black"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>

            <div
              className="relative grid shrink-0 gap-1.5 border-b border-white/15 px-3 py-2"
              style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}
            >
              <MetricTile icon={<Activity className="h-3 w-3" />} value={`${liveAnim}/${ALL_KEYS.length}`} label="services" strong />
              <MetricTile icon={<Cpu className="h-3 w-3" />} value={`${(gbAnim / 10).toFixed(1)} GB`} label="models" />
              <MetricTile icon={<Boxes className="h-3 w-3" />} value={`${MODEL_KEYS.length}`} label="AI engines" />
              <MetricTile icon={<Database className="h-3 w-3" />} value={`${queueAnim}`} label="queue" />
              <MetricTile icon={<Gauge className="h-3 w-3" />} value={`${pctAnim}%`} label="health" />
            </div>

            <div
              className="relative grid min-h-0 flex-1 overflow-hidden"
              style={{ gridTemplateColumns: '0.82fr 1.25fr' }}
            >
              <div className="min-h-0 px-3 py-2">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Network className="h-3 w-3 text-zinc-500" />
                    <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Service Mesh</span>
                  </div>
                  <span className="font-mono text-[9px] text-zinc-500">{activeWorkers} worker{activeWorkers === 1 ? '' : 's'} active</span>
                </div>

                <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
                  {INFRA_KEYS.map((key, i) => {
                    const svc = data?.services[key];
                    const meta = INFRA_META[key];
                    const ok = svc?.ok;
                    return (
                      <div
                        key={key}
                        className="rounded border border-zinc-800 bg-[#050505] px-2 py-1.5 transition-colors hover:border-white hover:bg-[#0b0b0b]"
                        style={{ animation: 'xyraFadeUp 0.25s ease both', animationDelay: `${i * 55}ms` }}
                      >
                        <div className="flex items-center gap-2">
                          <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border ${statusTone(ok)}`}>
                            {meta.icon}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-[11px] font-semibold text-zinc-100">{meta.title}</p>
                              <StatusPill ok={ok} />
                            </div>
                            <p className="mt-0.5 truncate font-mono text-[8px] text-zinc-500">{svc?.role ?? svc?.label ?? key}</p>
                            <p className="mt-0.5 truncate text-[8px] text-zinc-600">{serviceDetail(svc, 'waiting for telemetry')}</p>
                          </div>
                          <PulseNode ok={ok} />
                        </div>

                        {key === 'rq_worker' && (
                          <div className="mt-1.5 grid gap-1" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                            {[
                              ['queue', queueDepth],
                              ['failed', failedJobs],
                              ['workers', activeWorkers],
                            ].map(([label, value]) => (
                              <div key={label} className="rounded border border-zinc-800 bg-black px-1.5 py-1">
                                <p className="font-mono text-[11px] font-semibold text-zinc-100">{value}</p>
                                <p className="text-[7px] uppercase tracking-wider text-zinc-600">{label}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="relative min-h-0 px-3 py-2">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Boxes className="h-3 w-3 text-zinc-500" />
                    <span className="font-mono text-[9px] font-semibold uppercase tracking-wider text-zinc-500">AI Engine Array</span>
                  </div>
                  <span className="font-mono text-[8px] text-zinc-500">local models</span>
                </div>

                <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                  {MODEL_KEYS.map((key, i) => {
                    const svc = data?.services[key];
                    const meta = MODEL_META[key];
                    const footprintMax = 6;
                    const footprintPct = svc?.size_gb ? Math.min((svc.size_gb / footprintMax) * 100, 100) : 0;
                    return (
                      <div
                        key={key}
                        className="overflow-hidden rounded border border-zinc-800 bg-[#050505]"
                        style={{ animation: 'xyraFadeUp 0.28s ease both', animationDelay: `${i * 70 + 100}ms` }}
                      >
                        <div className={`h-px bg-gradient-to-r ${meta.accent}`} />
                        <div className="flex items-center gap-2 px-2.5 py-1.5">
                          <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded border ${statusTone(svc?.ok)}`}>
                            <Cpu className="h-3.5 w-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate font-mono text-[11px] font-semibold text-zinc-100">{svc?.label ?? key}</p>
                              <StatusPill ok={svc?.ok} />
                            </div>
                            <p className="mt-0.5 truncate text-[8px] text-zinc-500">{meta.desc}</p>
                            <p className="mt-0.5 truncate text-[8px] text-zinc-600">{serviceDetail(svc, 'model status pending')}</p>
                          </div>
                          <PulseNode ok={svc?.ok} />
                        </div>

                        <div className="grid gap-1 px-2.5 pb-1.5" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
                          <div className="rounded border border-zinc-800 bg-black px-2 py-1">
                            <p className="truncate font-mono text-[12px] font-semibold text-zinc-100">{svc?.params || '-'}</p>
                            <p className="text-[7px] uppercase tracking-wider text-zinc-600">params</p>
                          </div>
                          <div className="rounded border border-zinc-800 bg-black px-2 py-1">
                            <p className="truncate font-mono text-[12px] font-semibold text-zinc-200">{svc?.quant || '-'}</p>
                            <p className="text-[7px] uppercase tracking-wider text-zinc-600">quant</p>
                          </div>
                          <div className="rounded border border-zinc-800 bg-black px-2 py-1">
                            <p className="font-mono text-[12px] font-semibold text-zinc-100">
                              {svc?.size_gb ?? '-'}<span className="text-[8px] font-normal text-zinc-600"> GB</span>
                            </p>
                            <p className="text-[7px] uppercase tracking-wider text-zinc-600">disk</p>
                          </div>
                        </div>

                        <div className="px-2.5 pb-1.5">
                          <div className="mb-1 flex items-center justify-between font-mono text-[7px] text-zinc-600">
                            <span>model footprint</span>
                            <span>{svc?.size_gb ?? 0} / {footprintMax} GB</span>
                          </div>
                          <FillBar pct={footprintPct} color={meta.accent} />
                          {svc?.family && (
                            <span className="mt-1 inline-flex rounded border border-zinc-800 bg-black px-1 py-0.5 font-mono text-[7px] text-zinc-500">
                              arch/{svc.family}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="relative flex shrink-0 items-center justify-between border-t border-white/15 bg-black px-3 py-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[8px] text-zinc-600">{data ? `updated ${elapsed(data.ts)}` : 'fetching telemetry'}</span>
                {bootMsg && (
                  <span className="font-mono text-[8px] text-zinc-400">{bootMsg}</span>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={bootSystem}
                  disabled={booting || allOk}
                  title={allOk ? 'All systems live' : 'Start Redis, Ollama and Worker'}
                  className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[8px] transition-colors disabled:opacity-40 ${
                    allOk
                      ? 'border-white/20 text-zinc-600 cursor-default'
                      : 'border-white/40 text-zinc-300 hover:bg-white hover:text-black'
                  }`}
                >
                  <Power className={`h-3 w-3 ${booting ? 'animate-pulse' : ''}`} />
                  {booting ? 'booting…' : allOk ? 'all live' : 'boot system'}
                </button>

                <button
                  onClick={fetchHealth}
                  disabled={loading}
                  className="flex items-center gap-1 rounded px-1 py-0.5 font-mono text-[8px] text-zinc-500 transition-colors hover:bg-white hover:text-black disabled:opacity-40"
                >
                  <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
                  {loading ? 'refreshing' : `refresh in ${countdown}s`}
                </button>
              </div>
            </div>
          </div>
        </>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        onClick={() => setOpen(o => !o)}
        title="System Health"
        style={{ zIndex: 2147482999 }}
        className={`fixed bottom-3 left-3 flex select-none items-center gap-1.5 rounded-md border bg-[#101115] px-2.5 py-1 shadow-lg transition-all duration-100 hover:bg-[#17191f] ${
          open ? 'border-white/60 bg-black' : 'border-white/[0.08] hover:border-white/[0.14]'
        }`}
      >
        <Activity className="h-3 w-3 text-gray-500" />
        <span className={`h-1.5 w-1.5 rounded-full ${triggerDot}`} />
        <span className="font-mono text-[10px] text-gray-400">{data ? `${liveCount}/${ALL_KEYS.length}` : 'sys'}</span>
      </button>
      {overlay}

      <style>{`
        @keyframes xyraFadeUp {
          from { opacity: 0; transform: translateY(7px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
};

export default SystemHealthDashboard;
