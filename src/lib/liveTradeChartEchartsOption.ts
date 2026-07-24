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
import { chartEnrichmentMathCents, CHART_MATH_PROB_COLOR } from './chartCandleEnrichment';
import type { LiveTradeCandle } from '../hooks/useLiveTradeCandles';
import type { SidebarChartOrderLevel, SidebarChartPositionLevel } from './sidebarOrderbookAggregate';

const BULL = '#10b981';
const BEAR = '#ef4444';
const OB_HEATMAP_TAIL_OPACITY_WEIGHT = 0.1;

export type LiveTradeDataZoomState = {
  start: number;
  end: number;
};

export type BuildLiveTradeChartOptionArgs = {
  candles: LiveTradeCandle[];
  candleMs: number;
  interval: string;
  startTime?: number;
  endTime?: number;
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

  const markLineData: { yAxis: number; name?: string; lineStyle?: object; label?: object }[] = [];
  if (positionLevels?.length) {
    for (const lv of positionLevels) {
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

  const mathLine: [number, number][] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (c.time < minT - candleMs || c.time > maxT + candleMs) continue;
    const cents = chartEnrichmentMathCents(c.enrichment?.bsProb, chartOutcome);
    if (cents == null) continue;
    mathLine.push([i, cents]);
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
    markLine:
      markLineData.length > 0
        ? {
            symbol: 'none',
            animation: false,
            data: markLineData,
            silent: true,
          }
        : undefined,
    z: 3,
  });

  if (mathLine.length > 0) {
    series.push({
      type: 'line',
      name: 'math',
      data: mathLine,
      showSymbol: mathLine.length === 1,
      symbolSize: 4,
      lineStyle: { color: CHART_MATH_PROB_COLOR, width: 1.5, type: 'dashed' },
      itemStyle: { color: CHART_MATH_PROB_COLOR },
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
    tooltip: { show: false },
    axisPointer: { show: false },
    grid: [
      { left: 36, right: 8, top: 4, bottom: 28 },
      { left: 36, right: 8, top: '72%', bottom: 16, height: '18%' },
    ],
    dataZoom: [
      {
        type: 'inside',
        xAxisIndex: [0, 1],
        start: dzStart,
        end: dzEnd,
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
      },
    ],
    yAxis: [
      {
        type: 'value',
        min: 0,
        max: 100,
        interval: 10,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } },
        axisLabel: {
          color: 'rgba(255,255,255,0.3)',
          fontSize: 9,
          fontFamily: 'monospace',
          formatter: (v: number) => `${v}¢`,
        },
      },
      {
        type: 'value',
        gridIndex: 1,
        scale: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { show: false },
        splitLine: { show: false },
      },
    ],
    series,
  };
}

/** Find candle index nearest to category pixel x (chart-local). */
export function findCandleIndexAtPixel(
  chart: {
    convertFromPixel: (finder: object, point: number[]) => number[] | number;
  },
  offsetX: number,
): number | null {
  try {
    const point = chart.convertFromPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [offsetX, 0]);
    const arr = Array.isArray(point) ? point : [point];
    const idx = Math.round(Number(arr[0]));
    if (!Number.isFinite(idx)) return null;
    return idx;
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
