import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ToxicFlowSwarm } from '../api';
import { buildSwarmSlotChartPoints, type SwarmSlotChartPoint } from '../lib/toxicFlowStakeCohort';

const CHART_H = 88;
const PAD_L = 36;
const PAD_R = 6;
const PAD_T = 6;
const PAD_B = 16;

function slotLabel(slot: number): string {
  if (slot < 0) return `#${slot}`;
  return `#${slot}`;
}

function fmtUsdK(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

function drawChart(canvas: HTMLCanvasElement, points: SwarmSlotChartPoint[]) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const plotL = PAD_L;
  const plotR = W - PAD_R;
  const plotT = PAD_T;
  const plotB = H - PAD_B;
  const plotW = plotR - plotL;
  const plotH = plotB - plotT;

  if (points.length === 0) {
    ctx.fillStyle = 'rgba(156,163,175,0.5)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No swarm slots', W / 2, H / 2);
    return;
  }

  let maxGreen = 0;
  let minRed = 0;
  for (const p of points) {
    if (p.yesUsd > maxGreen) maxGreen = p.yesUsd;
    const neg = -p.noUsd;
    if (neg < minRed) minRed = neg;
  }
  if (maxGreen <= 0 && minRed >= 0) {
    maxGreen = 1;
    minRed = -1;
  } else if (maxGreen <= 0) {
    maxGreen = Math.max(1, -minRed * 0.15);
  } else if (minRed >= 0) {
    minRed = -Math.max(1, maxGreen * 0.15);
  }

  const yMin = minRed;
  const yMax = maxGreen;
  const ySpan = yMax - yMin || 1;
  const toY = (v: number) => plotB - ((v - yMin) / ySpan) * plotH;
  const zeroY = toY(0);

  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plotL, zeroY);
  ctx.lineTo(plotR, zeroY);
  ctx.stroke();

  ctx.font = '8px monospace';
  ctx.fillStyle = 'rgba(156,163,175,0.55)';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(fmtUsdK(yMax), plotL - 4, plotT + 4);
  ctx.fillText('0', plotL - 4, zeroY);
  ctx.fillText(fmtUsdK(yMin), plotL - 4, plotB - 2);

  const n = points.length;
  const groupW = plotW / n;
  const barW = Math.max(4, Math.min(14, groupW * 0.32));
  const gap = 2;

  for (let i = 0; i < n; i++) {
    const p = points[i];
    const cx = plotL + (i + 0.5) * groupW;

    if (p.yesUsd > 0) {
      const yTop = toY(p.yesUsd);
      const h = zeroY - yTop;
      if (h > 0.5) {
        ctx.fillStyle = 'rgba(34,197,94,0.85)';
        ctx.fillRect(cx - barW - gap / 2, yTop, barW, h);
      }
    }
    if (p.noUsd > 0) {
      const yBot = toY(-p.noUsd);
      const h = yBot - zeroY;
      if (h > 0.5) {
        ctx.fillStyle = 'rgba(239,68,68,0.85)';
        ctx.fillRect(cx + gap / 2, zeroY, barW, h);
      }
    }

    ctx.fillStyle = 'rgba(156,163,175,0.45)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '8px monospace';
    ctx.fillText(slotLabel(p.slot), cx, plotB + 2);
  }
}

export const ToxicFlowSwarmsSlotChart = memo(function ToxicFlowSwarmsSlotChart({
  swarms,
  marketActiveUnix,
}: {
  swarms: readonly ToxicFlowSwarm[];
  marketActiveUnix: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const points = useMemo(
    () => buildSwarmSlotChartPoints(swarms, marketActiveUnix),
    [swarms, marketActiveUnix],
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawChart(canvas, points);
  }, [points]);

  useEffect(() => {
    redraw();
  }, [redraw, swarms]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [redraw]);

  return (
    <div className="shrink-0 w-full min-w-0 px-0.5 py-1 border-b border-gray-800/90 bg-gray-950/80" title="YES staked above · NO staked below · 5s time slots">
      <canvas ref={canvasRef} className="block w-full" style={{ height: CHART_H }} />
    </div>
  );
});
