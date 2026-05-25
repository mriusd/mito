import type { CandleObSnapshot } from './candleObSnapshot';

export const OB_HEATMAP_CENT_BUCKETS = 100;

/** 1–5¢ / 95–99¢ (+ 0¢ bucket) — dim tails, don't set opacity scale. */
const OB_HEATMAP_TAIL_CENTS = new Set([
  0, 1, 2, 3, 4, 5,
  95, 96, 97, 98, 99,
]);
const OB_HEATMAP_TAIL_OPACITY_WEIGHT = 0.1;

export type ObCentHeatmap = {
  bids: number[];
  asks: number[];
};

export function obSnapshotToCentHeatmap(ob: CandleObSnapshot): ObCentHeatmap {
  const bids = new Array<number>(OB_HEATMAP_CENT_BUCKETS).fill(0);
  const asks = new Array<number>(OB_HEATMAP_CENT_BUCKETS).fill(0);

  const add = (levels: { p: string; s: string }[], out: number[]) => {
    for (const l of levels) {
      const p = parseFloat(l.p);
      const s = parseFloat(l.s);
      if (!Number.isFinite(p) || !Number.isFinite(s) || s <= 0) continue;
      const idx = Math.min(OB_HEATMAP_CENT_BUCKETS - 1, Math.max(0, Math.floor(p * 100)));
      out[idx] += s;
    }
  };

  add(ob.bids, bids);
  add(ob.asks, asks);
  return { bids, asks };
}

export function isObHeatmapTailCent(cent: number): boolean {
  return OB_HEATMAP_TAIL_CENTS.has(cent);
}

/** Max size in 6–94¢ only — opacity scale for the tradeable book. */
export function maxInnerCentHeatmapSide(values: number[]): number {
  let max = 0;
  for (let i = 0; i < values.length; i++) {
    if (isObHeatmapTailCent(i)) continue;
    max = Math.max(max, values[i]);
  }
  return max;
}

function centHeatOpacityNumerator(cent: number, size: number): number {
  return isObHeatmapTailCent(cent) ? size * OB_HEATMAP_TAIL_OPACITY_WEIGHT : size;
}

function heatAlpha(numerator: number, opacityMax: number): number {
  if (opacityMax <= 0 || numerator <= 0) return 0;
  const t = Math.min(1, numerator / opacityMax);
  return 0.1 + 0.7 * t;
}

export function drawObHeatmapColumns(
  ctx: CanvasRenderingContext2D,
  candles: { time: number; ob?: CandleObSnapshot }[],
  opts: {
    chartTop: number;
    chartBot: number;
    candleMs: number;
    toX: (t: number) => number;
    toY: (p: number) => number;
  },
) {
  const heatmaps: { time: number; hm: ObCentHeatmap }[] = [];
  let maxBid = 0;
  let maxAsk = 0;

  for (const c of candles) {
    if (!c.ob) continue;
    const hm = obSnapshotToCentHeatmap(c.ob);
    maxBid = Math.max(maxBid, maxInnerCentHeatmapSide(hm.bids));
    maxAsk = Math.max(maxAsk, maxInnerCentHeatmapSide(hm.asks));
    heatmaps.push({ time: c.time, hm });
  }

  if (heatmaps.length === 0 || (maxBid <= 0 && maxAsk <= 0)) return;

  const { chartTop, chartBot, candleMs, toX, toY } = opts;

  for (const { time, hm } of heatmaps) {
    const x = toX(time);
    const w = Math.max(1, toX(time + candleMs) - x);
    for (let cent = 0; cent < OB_HEATMAP_CENT_BUCKETS; cent++) {
      const yTop = toY(cent + 1);
      const yBot = toY(cent);
      const h = Math.max(1, yBot - yTop);
      if (yBot <= chartTop || yTop >= chartBot) continue;

      const bid = hm.bids[cent];
      if (bid > 0 && maxBid > 0) {
        const alpha = heatAlpha(centHeatOpacityNumerator(cent, bid), maxBid);
        ctx.fillStyle = `rgba(16, 185, 129, ${alpha})`;
        ctx.fillRect(x, yTop, w, h);
      }

      const ask = hm.asks[cent];
      if (ask > 0 && maxAsk > 0) {
        const alpha = heatAlpha(centHeatOpacityNumerator(cent, ask), maxAsk);
        ctx.fillStyle = `rgba(239, 68, 68, ${alpha})`;
        ctx.fillRect(x, yTop, w, h);
      }
    }
  }
}
