import type { EChartsOption } from 'echarts';
import type {
  CustomSeriesRenderItemAPI,
  CustomSeriesRenderItemReturn,
} from 'echarts/types/dist/shared';
import type { ChartTradeMarker } from './chartTradeMarkers';
import {
  OB_HEATMAP_CENT_BUCKETS,
  isObHeatmapTailCent,
  maxInnerCentHeatmapSide,
  obSnapshotToCentHeatmap,
} from './chartObHeatmap';
import {
  chartEnrichmentMathCents,
  despikeMathCentsSeries,
  CHART_MATH_PROB_COLOR,
  CHART_PRED_MATH_PROB_COLOR,
} from './chartCandleEnrichment';
import type { LiveTradeCandle } from '../hooks/useLiveTradeCandles';
import type { SidebarChartOrderLevel, SidebarChartPositionLevel } from './sidebarOrderbookAggregate';
import { normalizeClobTokenId } from '../utils/format';

const BULL = '#10b981';
const BEAR = '#ef4444';
const OB_HEATMAP_TAIL_OPACITY_WEIGHT = 0.1;

export type LiveTradeDataZoomState = {
  start: number;
  end: number;
  /** Price-axis zoom window (0–100%). */
  yStart?: number;
  yEnd?: number;
};

export type BuildLiveTradeChartOptionArgs = {
  candles: LiveTradeCandle[];
  candleMs: number;
  interval: string;
  startTime?: number;
  endTime?: number;
  /** Chart token — match weather stake bucket (YES id or selected). */
  tokenId?: string;
  obHeatmap: boolean;
  hideTrades: boolean;
  tradeMarkers?: ChartTradeMarker[];
  chartOutcome: 'YES' | 'NO';
  orderLevels?: SidebarChartOrderLevel[];
  positionLevels?: SidebarChartPositionLevel[];
  hidePriceLines?: boolean;
  dataZoom?: LiveTradeDataZoomState | null;
  emptyMessage?: string;
};

function stakeBucketForCandle(
  c: LiveTradeCandle,
  tokenId?: string,
): { yes: number; no: number } | null {
  const buckets = c.weather?.market_buckets;
  if (!buckets?.length) return null;
  const tid = normalizeClobTokenId(tokenId || '');
  let b = tid
    ? buckets.find((x) => normalizeClobTokenId(x.tokenId || '') === tid)
    : undefined;
  if (!b) b = buckets.find((x) => x.selected);
  if (!b) return null;
  // Omitted stake fields mean $0 for this bucket — still a real sample (keep line continuous).
  return { yes: b.stakedYesUsd ?? 0, no: b.stakedNoUsd ?? 0 };
}

function fmtStakeAxisUsd(v: number): string {
  const n = Math.abs(v);
  if (n >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function heatAlpha(numerator: number, opacityMax: number): number {
  if (opacityMax <= 0 || numerator <= 0) return 0;
  const t = Math.min(1, numerator / opacityMax);
  return 0.1 + 0.7 * t;
}

function centHeatOpacityNumerator(cent: number, size: number): number {
  return isObHeatmapTailCent(cent) ? size * OB_HEATMAP_TAIL_OPACITY_WEIGHT : size;
}

function fmtTimeLabel(t: number, interval: string): string {
  const d = new Date(t);
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (interval === '5s') return `${hm}:${String(d.getSeconds()).padStart(2, '0')}`;
  return hm;
}

function bucketTradeMarkers(
  candles: LiveTradeCandle[],
  candleMs: number,
  markers: ChartTradeMarker[],
  minT: number,
  maxT: number,
): Map<number, { buy: boolean; sell: boolean }> {
  const out = new Map<number, { buy: boolean; sell: boolean }>();
  const candleForTime = (t: number): LiveTradeCandle | undefined => {
    for (let i = candles.length - 1; i >= 0; i--) {
      const c = candles[i];
      if (t >= c.time && t < c.time + candleMs) return c;
    }
    return undefined;
  };
  for (const m of markers) {
    if (m.timeMs < minT - candleMs || m.timeMs > maxT + candleMs) continue;
    const c = candleForTime(m.timeMs);
    if (!c) continue;
    let slot = out.get(c.time);
    if (!slot) {
      slot = { buy: false, sell: false };
      out.set(c.time, slot);
    }
    if (m.side === 'BUY' && !slot.buy) slot.buy = true;
    else if (m.side === 'SELL' && !slot.sell) slot.sell = true;
  }
  return out;
}

export function buildLiveTradeChartOption(args: BuildLiveTradeChartOptionArgs): EChartsOption {
  const {
    candles,
    candleMs,
    interval,
    startTime,
    endTime,
    tokenId,
    obHeatmap,
    hideTrades,
    tradeMarkers,
    chartOutcome,
    orderLevels,
    positionLevels,
    hidePriceLines,
    dataZoom,
    emptyMessage,
  } = args;

  if (candles.length === 0) {
    return {
      backgroundColor: '#1a1a2e',
      animation: false,
      title: {
        text: emptyMessage || 'Waiting for data...',
        left: 'center',
        top: 'middle',
        textStyle: { color: 'rgba(255,255,255,0.2)', fontSize: 10, fontWeight: 'normal' },
      },
      xAxis: { show: false },
      yAxis: { show: false },
      series: [],
    };
  }

  const minT = startTime || candles[0].time;
  const maxT = endTime || candles[candles.length - 1].time + candleMs;
  const categories = candles.map((c) => c.time);
  const ohlc = candles.map((c) => [c.o, c.c, c.l, c.h]);
  const volumes = candles.map((c) => ({
    value: c.v,
    itemStyle: { color: c.c >= c.o ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)' },
  }));
  const stakeYes: (number | null)[] = [];
  const stakeNo: (number | null)[] = [];
  let stakePointCount = 0;
  let lastYes: number | null = null;
  let lastNo: number | null = null;
  for (const c of candles) {
    const s = stakeBucketForCandle(c, tokenId);
    if (!s) {
      // Forward-fill across candles missing weather so stk$ lines don't die mid-chart.
      stakeYes.push(lastYes);
      stakeNo.push(lastNo);
      continue;
    }
    lastYes = s.yes;
    lastNo = s.no;
    stakeYes.push(s.yes);
    stakeNo.push(s.no);
    stakePointCount++;
  }
  // Weather stake panel; else volume. CVD Δ/Σ bars render below the chart in React.
  const showStakePanel = stakePointCount > 0;
  const bottomLeftPad = showStakePanel ? 44 : 36;

  /** Order/position mark lines (price axis is fixed 0–100¢). */
  const levelPrices: number[] = [];
  const markLineData: {
    yAxis: number;
    name?: string;
    lineStyle?: object;
    label?: object;
  }[] = [];
  if (positionLevels?.length) {
    for (const lv of positionLevels) {
      if (!Number.isFinite(lv.priceCents)) continue;
      levelPrices.push(lv.priceCents);
      const color = lv.direction === 'long' ? '#2563eb' : '#facc15';
      markLineData.push({
        yAxis: lv.priceCents,
        lineStyle: { color, type: 'solid', width: 1 },
        label: {
          show: true,
          formatter: `${lv.priceCents.toFixed(1)}¢`,
          position: 'start',
          color,
          fontSize: 9,
          fontFamily: 'monospace',
        },
      });
    }
  }
  if (orderLevels?.length) {
    for (const lv of orderLevels) {
      if (!Number.isFinite(lv.priceCents)) continue;
      levelPrices.push(lv.priceCents);
      const color = lv.direction === 'long' ? '#2563eb' : '#facc15';
      markLineData.push({
        yAxis: lv.priceCents,
        name: lv.orderId,
        lineStyle: { color, type: 'dashed', width: 1.5 },
        label: {
          show: true,
          formatter: `${lv.priceCents.toFixed(1)}¢`,
          position: 'start',
          color,
          fontSize: 9,
          fontFamily: 'monospace',
          fontWeight: 'bold',
        },
      });
    }
  }

  const lastPrice = candles[candles.length - 1].c;
  if (!hidePriceLines) {
    markLineData.push({
      yAxis: lastPrice,
      lineStyle: { color: 'rgba(255,255,255,0.3)', type: 'dashed', width: 1 },
      label: { show: false },
    });
  }

  // Yellow dashed: BS from live settlement TWAP (twap_bs_prob / sidebar top Math).
  // Pink dashed (same pattern): BS from predicted TWAP (bs_prob / sidebar bottom Math).
  // Forward-fill last known value so lines do not vanish on expired markets
  // (last bars often lack a fresh bs_prob after T≤0). Despike isolated needles —
  // live open-bucket recompute can glitch one bar; full HTTP reload looks smooth.
  const twapRaw: Array<{ i: number; v: number | null }> = [];
  const predRaw: Array<{ i: number; v: number | null }> = [];
  let lastTwapMathCents: number | null = null;
  let lastPredMathCents: number | null = null;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.time < minT - candleMs || c.time > maxT + candleMs) continue;
    const twapCents = chartEnrichmentMathCents(c.enrichment?.twapBsProb, chartOutcome);
    if (twapCents != null) lastTwapMathCents = twapCents;
    twapRaw.push({ i, v: lastTwapMathCents });

    const predCents = chartEnrichmentMathCents(c.enrichment?.bsProb, chartOutcome);
    if (predCents != null) lastPredMathCents = predCents;
    predRaw.push({ i, v: lastPredMathCents });
  }
  const twapDespiked = despikeMathCentsSeries(twapRaw.map((p) => p.v));
  const predDespiked = despikeMathCentsSeries(predRaw.map((p) => p.v));
  const twapMathLine: [number, number][] = [];
  const predMathLine: [number, number][] = [];
  for (let k = 0; k < twapRaw.length; k++) {
    const v = twapDespiked[k];
    if (v != null) twapMathLine.push([twapRaw[k]!.i, v]);
  }
  for (let k = 0; k < predRaw.length; k++) {
    const v = predDespiked[k];
    if (v != null) predMathLine.push([predRaw[k]!.i, v]);
  }

  const markerSeriesData: {
    value: [number, number];
    itemStyle: { color: string };
    symbol: string;
    symbolSize: number;
    symbolRotate?: number;
    symbolOffset?: [number, number];
  }[] = [];
  if (!hideTrades && tradeMarkers?.length) {
    const buckets = bucketTradeMarkers(candles, candleMs, tradeMarkers, minT, maxT);
    const invert = chartOutcome === 'NO';
    const idxByTime = new Map(candles.map((c, i) => [c.time, i]));
    for (const [bucketOpen, slot] of buckets) {
      const idx = idxByTime.get(bucketOpen);
      if (idx == null) continue;
      const c = candles[idx];
      if (slot.buy) {
        // long: tip toward candle (up from low, or down from high when NO view)
        markerSeriesData.push({
          value: [idx, invert ? c.h : c.l],
          itemStyle: { color: '#2563eb' },
          symbol: 'triangle',
          symbolSize: 8,
          symbolRotate: invert ? 180 : 0,
          symbolOffset: invert ? [0, -5] : [0, 5],
        });
      }
      if (slot.sell) {
        markerSeriesData.push({
          value: [idx, invert ? c.l : c.h],
          itemStyle: { color: '#facc15' },
          symbol: 'triangle',
          symbolSize: 8,
          symbolRotate: invert ? 0 : 180,
          symbolOffset: invert ? [0, 5] : [0, -5],
        });
      }
    }
  }

  type HeatCell = [number, number, number, number]; // idx, cent, bid, ask
  const heatCells: HeatCell[] = [];
  let heatMaxBid = 0;
  let heatMaxAsk = 0;
  if (obHeatmap) {
    const prepared: { idx: number; bids: number[]; asks: number[] }[] = [];
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      if (!c.ob) continue;
      const hm = obSnapshotToCentHeatmap(c.ob);
      heatMaxBid = Math.max(heatMaxBid, maxInnerCentHeatmapSide(hm.bids));
      heatMaxAsk = Math.max(heatMaxAsk, maxInnerCentHeatmapSide(hm.asks));
      prepared.push({ idx: i, bids: hm.bids, asks: hm.asks });
    }
    for (const row of prepared) {
      for (let cent = 0; cent < OB_HEATMAP_CENT_BUCKETS; cent++) {
        const bid = row.bids[cent];
        const ask = row.asks[cent];
        if (bid <= 0 && ask <= 0) continue;
        heatCells.push([row.idx, cent, bid, ask]);
      }
    }
  }

  const dzStart = dataZoom?.start ?? 0;
  const dzEnd = dataZoom?.end ?? 100;

  const series: EChartsOption['series'] = [];

  if (obHeatmap && heatCells.length > 0) {
    series.push({
      type: 'custom',
      name: 'obHeatmap',
      clip: true,
      renderItem: (_params, api: CustomSeriesRenderItemAPI): CustomSeriesRenderItemReturn => {
        const idx = api.value(0) as number;
        const cent = api.value(1) as number;
        const bid = api.value(2) as number;
        const ask = api.value(3) as number;
        const x0 = api.coord([idx - 0.45, cent + 1]);
        const x1 = api.coord([idx + 0.45, cent]);
        if (!x0 || !x1) return;
        const x = x0[0];
        const y = x0[1];
        const w = Math.max(1, x1[0] - x0[0]);
        const h = Math.max(1, x1[1] - x0[1]);
        const kids: CustomSeriesRenderItemReturn[] = [];
        if (bid > 0 && heatMaxBid > 0) {
          const alpha = heatAlpha(centHeatOpacityNumerator(cent, bid), heatMaxBid);
          kids.push({
            type: 'rect',
            shape: { x, y, width: w, height: h },
            style: { fill: `rgba(16, 185, 129, ${alpha})` },
            silent: true,
          });
        }
        if (ask > 0 && heatMaxAsk > 0) {
          const alpha = heatAlpha(centHeatOpacityNumerator(cent, ask), heatMaxAsk);
          kids.push({
            type: 'rect',
            shape: { x, y, width: w, height: h },
            style: { fill: `rgba(239, 68, 68, ${alpha})` },
            silent: true,
          });
        }
        return { type: 'group', children: kids as never };
      },
      data: heatCells,
      z: 1,
      silent: true,
    });
  }

  if (showStakePanel) {
    series.push({
      type: 'line',
      name: 'stakedYes',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: stakeYes,
      showSymbol: false,
      symbolSize: 0,
      connectNulls: true,
      lineStyle: { color: BULL, width: 1.5 },
      itemStyle: { color: BULL },
      z: 2,
      silent: true,
    });
    series.push({
      type: 'line',
      name: 'stakedNo',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: stakeNo,
      showSymbol: false,
      symbolSize: 0,
      connectNulls: true,
      lineStyle: { color: BEAR, width: 1.5 },
      itemStyle: { color: BEAR },
      z: 2,
      silent: true,
    });
  } else {
    series.push({
      type: 'bar',
      name: 'volume',
      xAxisIndex: 1,
      yAxisIndex: 1,
      data: volumes,
      barWidth: '70%',
      z: 2,
      silent: true,
    });
  }

  series.push({
    type: 'candlestick',
    name: 'price',
    data: ohlc,
    itemStyle: {
      color: BULL,
      color0: BEAR,
      borderColor: BULL,
      borderColor0: BEAR,
    },
    z: 3,
  });

  // Dedicated series for order/position lines — candlestick markLine is unreliable.
  if (markLineData.length > 0) {
    const lastIdx = Math.max(0, categories.length - 1);
    series.push({
      type: 'line',
      name: 'levels',
      data: levelPrices.map((p) => [lastIdx, p]),
      showSymbol: false,
      symbolSize: 0,
      lineStyle: { width: 0, opacity: 0 },
      itemStyle: { opacity: 0 },
      markLine: {
        symbol: 'none',
        animation: false,
        silent: true,
        data: markLineData,
      },
      z: 8,
      silent: true,
      clip: false,
    });
  }

  if (twapMathLine.length > 0) {
    series.push({
      type: 'line',
      name: 'math',
      data: twapMathLine,
      showSymbol: twapMathLine.length === 1,
      symbolSize: 4,
      lineStyle: { color: CHART_MATH_PROB_COLOR, width: 1.5, type: 'dashed' },
      itemStyle: { color: CHART_MATH_PROB_COLOR },
      z: 4,
      silent: true,
    });
  }

  if (predMathLine.length > 0) {
    series.push({
      type: 'line',
      name: 'mathPred',
      data: predMathLine,
      showSymbol: predMathLine.length === 1,
      symbolSize: 4,
      // Same dash pattern / width as yellow TWAP math line (only color differs).
      lineStyle: { color: CHART_PRED_MATH_PROB_COLOR, width: 1.5, type: 'dashed' },
      itemStyle: { color: CHART_PRED_MATH_PROB_COLOR },
      z: 4,
      silent: true,
    });
  }

  if (markerSeriesData.length > 0) {
    series.push({
      type: 'scatter',
      name: 'trades',
      data: markerSeriesData,
      z: 5,
      silent: true,
    });
  }

  // Last price label via graphic-like markPoint
  series.push({
    type: 'scatter',
    name: 'lastLabel',
    data: [[candles.length - 1, lastPrice]],
    symbolSize: 0,
    label: {
      show: true,
      formatter: `${lastPrice.toFixed(1)}¢`,
      position: 'right',
      color: '#fff',
      fontSize: 9,
      fontFamily: 'monospace',
      fontWeight: 'bold',
      distance: 2,
    },
    z: 6,
    silent: true,
  });

  return {
    backgroundColor: '#1a1a2e',
    animation: false,
    // Crosshair only — no tooltip box (OHLC strip already on chart).
    tooltip: {
      show: true,
      trigger: 'axis',
      showContent: false,
      axisPointer: {
        type: 'cross',
        // Snap to candle category so hover/popup bind to timeline column, not body Y.
        snap: true,
        animation: false,
        crossStyle: {
          color: 'rgba(255,255,255,0.45)',
          width: 1,
          type: 'dashed',
        },
        lineStyle: {
          color: 'rgba(255,255,255,0.35)',
          width: 1,
          type: 'dashed',
        },
        label: {
          show: true,
          backgroundColor: 'rgba(30, 41, 59, 0.95)',
          borderColor: 'rgba(148, 163, 184, 0.5)',
          borderWidth: 1,
          color: '#e2e8f0',
          fontSize: 10,
          fontFamily: 'monospace',
          padding: [3, 5],
        },
      },
    },
    axisPointer: {
      link: [{ xAxisIndex: [0, 1] }],
    },
    grid: [
      { left: bottomLeftPad, right: 8, top: 4, bottom: 28 },
      { left: bottomLeftPad, right: 8, top: '72%', bottom: 16, height: '18%' },
    ],
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: [0, 1],
        start: dzStart,
        end: dzEnd,
        // Time-axis only — price Y is fixed 0–100¢ (no OHLC rescaling).
        filterMode: 'filter',
        zoomOnMouseWheel: true,
        moveOnMouseMove: true,
        moveOnMouseWheel: false,
        preventDefaultMouseMove: true,
      },
      {
        type: 'slider',
        xAxisIndex: [0, 1],
        start: dzStart,
        end: dzEnd,
        filterMode: 'filter',
        height: 12,
        bottom: 2,
        borderColor: 'rgba(255,255,255,0.12)',
        backgroundColor: 'rgba(0,0,0,0.2)',
        fillerColor: 'rgba(59,130,246,0.25)',
        handleStyle: { color: '#60a5fa' },
        textStyle: { color: 'rgba(255,255,255,0.35)', fontSize: 8 },
        dataBackground: {
          lineStyle: { color: 'rgba(255,255,255,0.15)' },
          areaStyle: { color: 'rgba(255,255,255,0.05)' },
        },
      },
    ],
    xAxis: [
      {
        type: 'category',
        data: categories,
        boundaryGap: true,
        axisLine: { lineStyle: { color: 'rgba(255,255,255,0.12)' } },
        axisTick: { show: false },
        axisLabel: {
          color: 'rgba(255,255,255,0.28)',
          fontSize: 9,
          formatter: (v: string | number) => fmtTimeLabel(Number(v), interval),
          hideOverlap: true,
        },
        min: 'dataMin',
        max: 'dataMax',
        axisPointer: {
          label: {
            formatter: (p) => fmtTimeLabel(Number(p.value), interval),
          },
        },
      },
      {
        type: 'category',
        gridIndex: 1,
        data: categories,
        boundaryGap: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        min: 'dataMin',
        max: 'dataMax',
        axisPointer: { label: { show: false } },
      },
    ],
    yAxis: [
      {
        type: 'value',
        // Fixed full probability axis — never auto-fit to candle/price range.
        scale: false,
        min: 0,
        max: 100,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        axisLabel: {
          color: 'rgba(255,255,255,0.3)',
          fontSize: 9,
          fontFamily: 'monospace',
          formatter: (v: number) => `${Number(v).toFixed(v % 1 === 0 ? 0 : 1)}¢`,
        },
        axisPointer: {
          label: {
            formatter: (p) => {
              const n = Number(p.value);
              if (!Number.isFinite(n)) return '';
              return `${n.toFixed(1)}¢`;
            },
          },
        },
      },
      {
        type: 'value',
        gridIndex: 1,
        scale: true,
        min: 0,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: showStakePanel
          ? {
              show: true,
              color: 'rgba(255,255,255,0.3)',
              fontSize: 8,
              fontFamily: 'monospace',
              formatter: (v: number) => fmtStakeAxisUsd(Number(v)),
            }
          : { show: false },
        splitLine: { show: false },
        axisPointer: showStakePanel
          ? {
              show: true,
              label: {
                formatter: (p) => {
                  const n = Number(p.value);
                  if (!Number.isFinite(n)) return '';
                  return fmtStakeAxisUsd(n);
                },
              },
            }
          : { show: false, label: { show: false } },
      },
    ],
    series,
  };
}

/**
 * Merge patch for live candle ticks — updates series/xAxis data without full notMerge rebuild.
 * Call via chart.setOption(patch, { lazyUpdate: true }) when only OHLC/volume changed.
 */
export function buildLiveTradeChartSeriesUpdate(args: BuildLiveTradeChartOptionArgs): EChartsOption {
  const full = buildLiveTradeChartOption(args);
  const xAxes = Array.isArray(full.xAxis) ? full.xAxis : full.xAxis != null ? [full.xAxis] : [];
  const seriesList = Array.isArray(full.series) ? full.series : full.series != null ? [full.series] : [];
  return {
    xAxis: xAxes.map((ax) => ({ data: (ax as { data?: unknown[] }).data })),
    series: seriesList.map((s) => {
      const row = s as {
        name?: string;
        data?: unknown;
        markLine?: object;
        label?: object;
      };
      return {
        name: row.name,
        data: row.data,
        ...(row.markLine != null ? { markLine: row.markLine } : {}),
        ...(row.name === 'lastLabel' && row.label != null ? { label: row.label } : {}),
      };
    }),
  } as EChartsOption;
}

/** Axis identity for structural rebuilds (length / window) — ignores last-bar OHLC churn. */
export function liveTradeCandleAxisSig(candles: LiveTradeCandle[]): string {
  if (candles.length === 0) return '0';
  return `${candles.length}:${candles[0]!.time}:${candles[candles.length - 1]!.time}`;
}

/** Map axis-pointer / convertFromPixel raw value → candle index (by time or ordinal). */
export function resolveCandleIndexFromAxisValue(
  raw: unknown,
  candleTimes: number[],
): number | null {
  if (candleTimes.length === 0) return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;

  // Category axis may yield the category label (open time ms).
  if (n > 1e11) {
    const exact = candleTimes.indexOf(n);
    if (exact >= 0) return exact;
    let best = 0;
    let bestDt = Math.abs(candleTimes[0] - n);
    for (let i = 1; i < candleTimes.length; i++) {
      const dt = Math.abs(candleTimes[i] - n);
      if (dt < bestDt) {
        best = i;
        bestDt = dt;
      }
    }
    return best;
  }

  const idx = Math.round(n);
  if (idx < 0 || idx >= candleTimes.length) return null;
  return idx;
}

/**
 * Find candle index for chart-local pixel X.
 * Uses a Y sample inside the price grid so hover works on the full vertical
 * timeline column (heatmap / empty space), not only on the candle body.
 */
export function findCandleIndexAtPixel(
  chart: {
    convertFromPixel: (finder: object, point: number[]) => number[] | number;
    convertToPixel: (finder: object, value: number | number[]) => number | number[];
    getHeight: () => number;
  },
  offsetX: number,
  candleTimes: number[],
  offsetY?: number,
): number | null {
  if (candleTimes.length === 0) return null;
  try {
    const h = chart.getHeight();
    // Keep Y inside the price grid (not the volume/stake strip) so category X resolves.
    const sampleY =
      offsetY != null && Number.isFinite(offsetY)
        ? Math.min(Math.max(8, offsetY), Math.max(8, h * 0.72))
        : Math.max(8, h * 0.35);
    const point = chart.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [offsetX, sampleY]);
    const arr = Array.isArray(point) ? point : [point];
    const fromAxis = resolveCandleIndexFromAxisValue(arr[0], candleTimes);
    if (fromAxis != null) return fromAxis;

    // Fallback: binary search nearest category by pixel X (off-body convertFromPixel flaky).
    const xAt = (i: number): number => {
      const px = chart.convertToPixel({ xAxisIndex: 0 }, i);
      return typeof px === 'number' ? px : Array.isArray(px) ? Number(px[0]) : NaN;
    };
    let lo = 0;
    let hi = candleTimes.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const x = xAt(mid);
      if (!Number.isFinite(x)) return null;
      if (x < offsetX) lo = mid + 1;
      else hi = mid;
    }
    const candidates = [lo, Math.max(0, lo - 1)];
    let best = lo;
    let bestDist = Infinity;
    for (const i of candidates) {
      const x = xAt(i);
      if (!Number.isFinite(x)) continue;
      const dist = Math.abs(x - offsetX);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    return Number.isFinite(bestDist) ? best : null;
  } catch {
    return null;
  }
}

export function centsFromPixelY(
  chart: {
    convertFromPixel: (finder: object, point: number[]) => number[] | number;
  },
  offsetY: number,
): number | null {
  try {
    const point = chart.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [0, offsetY]);
    const arr = Array.isArray(point) ? point : [0, point];
    const cents = Number(arr[1]);
    if (!Number.isFinite(cents)) return null;
    return Math.max(0.1, Math.min(99.9, Math.round(cents * 10) / 10));
  } catch {
    return null;
  }
}
