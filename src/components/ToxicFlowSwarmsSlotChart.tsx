import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import type { ToxicFlowSwarm } from '../api';
import { buildSwarmSlotChartLayout, type SwarmSlotChartLayout } from '../lib/toxicFlowStakeCohort';

const CHART_H = 88;
const PAD_L = 36;
const PAD_R = 6;
const PAD_T = 6;
const PAD_B = 16;
const SWARM_SLOT_SEC = 5;

function slotCenterX(
  slot: number,
  layout: SwarmSlotChartLayout,
  plotL: number,
  plotW: number,
): number {
  const cols = (layout.showPreOpen ? 1 : 0) + layout.postSlotCount;
  if (cols <= 0) return plotL + plotW / 2;
  const colIdx = slot < 0 ? 0 : (layout.showPreOpen ? 1 : 0) + slot;
  return plotL + ((colIdx + 0.5) / cols) * plotW;
}

function slotBarWidth(layout: SwarmSlotChartLayout, plotW: number): number {
  const cols = (layout.showPreOpen ? 1 : 0) + layout.postSlotCount;
  if (cols <= 0) return 8;
  const groupW = plotW / cols;
  return Math.max(2, Math.min(12, groupW * 0.32));
}

function slotTimeLabel(slot: number, marketDurationSec: number): string {
  if (slot < 0) return '−1';
  const sec = slot * SWARM_SLOT_SEC;
  if (marketDurationSec <= 300) return `${sec}s`;
  if (marketDurationSec <= 3600) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return s === 0 ? `${m}m` : `${m}:${String(s).padStart(2, '0')}`;
  }
  const m = Math.floor(sec / 60);
  return `${m}m`;
}

function fmtUsdK(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${Math.round(v)}`;
}

function drawChart(
  canvas: HTMLCanvasElement,
  layout: SwarmSlotChartLayout,
  marketDurationSec: number,
) {
  const points = layout.points;
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

  if (points.length === 0 || layout.postSlotCount <= 0) {
    ctx.fillStyle = 'rgba(156,163,175,0.5)';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No market window', W / 2, H / 2);
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

  const barW = slotBarWidth(layout, plotW);
  const gap = 2;

  for (const p of points) {
    const cx = slotCenterX(p.slot, layout, plotL, plotW);
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
  }

  const labelSlots: number[] = [];
  if (layout.showPreOpen) labelSlots.push(-1);
  const tickEvery = marketDurationSec <= 300 ? 12 : marketDurationSec <= 900 ? 12 : 24;
  for (let i = 0; i < layout.postSlotCount; i += tickEvery) labelSlots.push(i);
  if (layout.postSlotCount > 1 && labelSlots[labelSlots.length - 1] !== layout.postSlotCount - 1) {
    labelSlots.push(layout.postSlotCount - 1);
  }

  ctx.fillStyle = 'rgba(156,163,175,0.45)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = '8px monospace';
  for (const slot of labelSlots) {
    const cx = slotCenterX(slot, layout, plotL, plotW);
    ctx.fillText(slotTimeLabel(slot, marketDurationSec), cx, plotB + 2);
  }
}

export const ToxicFlowSwarmsSlotChart = memo(function ToxicFlowSwarmsSlotChart({
  swarms,
  marketActiveUnix,
  marketDurationSec,
}: {
  swarms: readonly ToxicFlowSwarm[];
  marketActiveUnix: number;
  marketDurationSec: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layout = useMemo(
    () => buildSwarmSlotChartLayout(swarms, marketActiveUnix, marketDurationSec),
    [swarms, marketActiveUnix, marketDurationSec],
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawChart(canvas, layout, marketDurationSec);
  }, [layout, marketDurationSec]);

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
    <div
      className="shrink-0 w-full min-w-0 px-0.5 py-1 border-b border-gray-800/90 bg-gray-950/80"
      title="Full market window · YES above · NO below · 5s slots"
    >
      <canvas ref={canvasRef} className="block w-full" style={{ height: CHART_H }} />
    </div>
  );
});
