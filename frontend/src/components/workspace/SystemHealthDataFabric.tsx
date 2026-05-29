import React, { useEffect, useRef } from 'react';

const PID_FLOATERS = [
  'PT',
  'PIT',
  'PDT',
  'PDIT',
  'PIC',
  'FT',
  'FIT',
  'FIC',
  'FY',
  'LT',
  'LIT',
  'LIC',
  'TT',
  'TIT',
  'TIC',
  'TY',
  'AT',
  'AIT',
  'pH',
  'O2',
  'LEL',
  'XV',
  'SDV',
  'MOV',
  'ESDV',
  'PSV',
  'LSH',
  'LSL',
  'PAHH',
  'FAL',
] as const;

const FABRIC = {
  dprCap: 2,
  gridStep: 48,
  pointColWidth: 44,
  pointRowHeight: 78,
  minCols: 36,
  minRows: 10,
  waveStartRatio: 0.32,
  horizonRatio: 0.35,
  waveCenterRatio: 0.62,
  particleCount: 180,
  floaterCount: 34,
  packetCount: 18,
  pointerRadius: 190,
  pointerEase: 0.08,
};

type DataPoint = {
  x: number;
  y: number;
  phase: number;
  size: number;
};

type PointerState = {
  x: number;
  y: number;
  tx: number;
  ty: number;
  active: boolean;
};

const createPointer = (): PointerState => ({
  x: -1000,
  y: -1000,
  tx: -1000,
  ty: -1000,
  active: false,
});

function pointerInfluence(pointer: PointerState, x: number, y: number) {
  if (!pointer.active) return 0;
  const dx = x - pointer.x;
  const dy = y - pointer.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0, 1 - dist / FABRIC.pointerRadius);
}

function waveY(x: number, width: number, height: number, t: number, pointer: PointerState, layer = 0) {
  const nx = x / Math.max(width, 1);
  const center = height * FABRIC.waveCenterRatio;
  const envelope = Math.sin(nx * Math.PI) * 0.75 + 0.25;
  const primary = Math.sin(nx * Math.PI * 5.1 + t * 0.26 + layer * 0.42) * height * 0.1;
  const secondary = Math.sin(nx * Math.PI * 13.4 - t * 0.38 + layer * 0.7) * height * 0.035;
  const tertiary = Math.sin(nx * Math.PI * 23.8 + t * 0.18 + layer) * height * 0.016;
  const base = center + (primary + secondary + tertiary) * envelope + layer * 4.5;
  const pull = pointerInfluence(pointer, x, base);
  const ripple = Math.sin((x - pointer.x) * 0.055 - t * 1.1) * pull * 18;
  return base + (pointer.y - base) * pull * 0.18 + ripple;
}

function resizeCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, FABRIC.dprCap);
  canvas.width = Math.max(1, Math.floor(rect.width * dpr));
  canvas.height = Math.max(1, Math.floor(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return rect;
}

function buildPoints(width: number, height: number): DataPoint[] {
  const cols = Math.max(FABRIC.minCols, Math.floor(width / FABRIC.pointColWidth));
  const rows = Math.max(FABRIC.minRows, Math.floor(height / FABRIC.pointRowHeight));
  const points: DataPoint[] = [];

  for (let y = 0; y <= rows; y += 1) {
    for (let x = 0; x <= cols; x += 1) {
      const seed = x * 37 + y * 71;
      points.push({
        x: (x / cols) * width,
        y: height * 0.36 + (y / rows) * height * 0.6,
        phase: seed * 0.17,
        size: 0.6 + (seed % 8) * 0.16,
      });
    }
  }

  return points;
}

function drawGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const grid = ctx.createLinearGradient(0, 0, width, height);
  grid.addColorStop(0, 'rgba(255,255,255,0.055)');
  grid.addColorStop(0.5, 'rgba(255,255,255,0.025)');
  grid.addColorStop(1, 'rgba(255,255,255,0.045)');
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;

  for (let x = 0; x < width; x += FABRIC.gridStep) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = 0; y < height; y += FABRIC.gridStep) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawTopFade(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const topFade = ctx.createLinearGradient(0, 0, 0, height);
  topFade.addColorStop(0, 'rgba(0,0,0,0.78)');
  topFade.addColorStop(0.32, 'rgba(0,0,0,0.62)');
  topFade.addColorStop(0.52, 'rgba(0,0,0,0.08)');
  topFade.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topFade;
  ctx.fillRect(0, 0, width, height);
}

function drawAmbientParticles(ctx: CanvasRenderingContext2D, width: number, height: number, t: number, pointer: PointerState) {
  const horizon = height * FABRIC.horizonRatio;
  for (let i = 0; i < FABRIC.particleCount; i += 1) {
    const seed = i * 97;
    const x = ((seed % 997) / 997) * width;
    const y = horizon + (((seed * 13) % 1000) / 1000) * height * 0.62;
    const hover = pointerInfluence(pointer, x, y);
    const pulse = 0.28 + Math.abs(Math.sin(t * 0.28 + seed)) * 0.48;
    ctx.fillStyle = `rgba(255,255,255,${pulse * 0.18 + hover * 0.26})`;
    ctx.beginPath();
    ctx.arc(x, y, (seed % 11 === 0 ? 1.8 : 0.9) + hover * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawWaveLines(ctx: CanvasRenderingContext2D, width: number, height: number, t: number, pointer: PointerState) {
  ctx.save();
  ctx.shadowColor = 'rgba(255,255,255,0.55)';
  ctx.shadowBlur = 10;

  for (let layer = -7; layer <= 7; layer += 1) {
    const layerGlow = pointer.active ? 0.04 : 0;
    const alpha = layer === 0 ? 0.76 + layerGlow : Math.max(0.08, 0.28 - Math.abs(layer) * 0.022 + layerGlow);
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = layer === 0 ? 1.5 : 0.65;
    ctx.beginPath();

    for (let x = -20; x <= width + 20; x += 12) {
      const y = waveY(x, width, height, t, pointer, layer);
      if (x === -20) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }

    ctx.stroke();
  }

  ctx.restore();
}

function drawDataPoints(ctx: CanvasRenderingContext2D, points: DataPoint[], width: number, height: number, t: number, pointer: PointerState) {
  points.forEach(point => {
    let x = point.x + Math.sin(t * 0.16 + point.phase) * 8;
    let y = point.y + Math.cos(t * 0.18 + point.phase) * 5;
    const hover = pointerInfluence(pointer, x, y);
    x += (x - pointer.x) * hover * 0.06;
    y += (y - pointer.y) * hover * 0.06;

    const waveDistance = Math.abs(y - waveY(x, width, height, t, pointer));
    const nearWave = Math.max(0, 1 - waveDistance / 90);
    const alpha = 0.05 + nearWave * 0.48 + hover * 0.3;

    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, point.size + nearWave * 1.4 + hover * 1.6, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPackets(ctx: CanvasRenderingContext2D, width: number, height: number, t: number, pointer: PointerState) {
  const packetX = ((t * 48) % (width + 240)) - 120;
  for (let i = 0; i < FABRIC.packetCount; i += 1) {
    const x = packetX - i * 22;
    const y = waveY(x, width, height, t, pointer);
    const alpha = Math.max(0, 0.85 - i * 0.045);
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawInstrumentLabels(ctx: CanvasRenderingContext2D, width: number, height: number, t: number, frame: number, pointer: PointerState) {
  ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';

  for (let i = 0; i < FABRIC.floaterCount; i += 1) {
    const x = (i * 151 + frame * 0.18) % (width + 160) - 80;
    const base = waveY(x, width, height, t, pointer, (i % 7) - 3);
    const y = base + ((i * 41) % 90) - 45;
    const alpha = 0.12 + (i % 5) * 0.035 + pointerInfluence(pointer, x, y) * 0.28;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillText(PID_FLOATERS[(i + Math.floor(frame / 90)) % PID_FLOATERS.length], x, y);
  }
}

const DataFabricCanvas: React.FC<{ active: boolean }> = ({ active }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rect = resizeCanvas(canvas, ctx);
    let points = buildPoints(rect.width, rect.height);
    let frame = 0;
    let raf = 0;
    const pointer = createPointer();

    const handleResize = () => {
      rect = resizeCanvas(canvas, ctx);
      points = buildPoints(rect.width, rect.height);
    };

    const handlePointerMove = (event: PointerEvent) => {
      rect = canvas.getBoundingClientRect();
      pointer.tx = event.clientX - rect.left;
      pointer.ty = event.clientY - rect.top;
      pointer.active =
        pointer.tx >= 0 &&
        pointer.tx <= rect.width &&
        pointer.ty >= rect.height * FABRIC.waveStartRatio &&
        pointer.ty <= rect.height;

      if (pointer.x < -900) {
        pointer.x = pointer.tx;
        pointer.y = pointer.ty;
      }
    };

    const handlePointerLeave = () => {
      pointer.active = false;
    };

    const draw = (ts: number) => {
      const width = rect.width;
      const height = rect.height;
      const t = ts * 0.001;
      pointer.x += (pointer.tx - pointer.x) * FABRIC.pointerEase;
      pointer.y += (pointer.ty - pointer.y) * FABRIC.pointerEase;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, width, height);

      drawGrid(ctx, width, height);
      drawTopFade(ctx, width, height);
      drawAmbientParticles(ctx, width, height, t, pointer);
      drawWaveLines(ctx, width, height, t, pointer);
      drawDataPoints(ctx, points, width, height, t, pointer);
      drawPackets(ctx, width, height, t, pointer);
      drawInstrumentLabels(ctx, width, height, t, frame, pointer);

      frame += 1;
      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    window.addEventListener('resize', handleResize);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [active]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
};

const SystemHealthDataFabric: React.FC<{ active: boolean }> = ({ active }) => (
  <div className="pointer-events-none absolute inset-0 overflow-hidden bg-black">
    <DataFabricCanvas active={active} />
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.08),transparent_24%),linear-gradient(180deg,rgba(0,0,0,0)_0%,rgba(0,0,0,0.38)_100%)]" />
  </div>
);

export default SystemHealthDataFabric;
