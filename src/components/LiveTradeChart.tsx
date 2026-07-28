import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Link2, Link2Off } from 'lucide-react';
import ReactECharts from 'echarts-for-react';
import type { EChartsType } from 'echarts';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import {
  CHART_VOLUME_SPIKE_FLASH_MS,
  detectChartVolumeSpike,
  MIN_CHART_CANDLES_FOR_VOLUME_SPIKE_SOUND,
  playChartVolumeSpikeRing,
  type ChartVolumeSpikeSide,
} from '../lib/chartVolumeSpikeAlert';
import type { ChartTradeMarker } from '../lib/chartTradeMarkers';
import type { CandleObSnapshot } from '../lib/candleObSnapshot';
import type { CexObCandleSnapshot } from '../lib/cexObSnapshot';
import type { GexAssetSnapshot } from '../lib/deribitGexFeed';
import { prepareCandleObDisplay } from '../lib/candleObDisplay';
import type {
  ChartOrderReplaceParams,
  SidebarChartOrderLevel,
  SidebarChartPositionLevel,
} from '../lib/sidebarOrderbookAggregate';
import { chartViewCentsToTokenPriceCents } from '../lib/sidebarOrderbookAggregate';
import { SidebarOrderbookBookGrid } from './SidebarOrderbookBookGrid';
import type { CandleBsEnrichment } from '../lib/chartCandleEnrichment';
import { ChartObHoverEnrichmentStrip } from './ChartObHoverEnrichmentStrip';
import { ChartObHoverOhlcvStrip, type ChartObHoverOhlcv } from './ChartObHoverOhlcvStrip';
import { ChartCexObHoverGrid } from './ChartCexObHoverGrid';
import { ChartGexHoverGrid } from './ChartGexHoverGrid';
import { ChartWeatherHoverPanel } from './ChartWeatherHoverPanel';
import { useLiveTradeCandles } from '../hooks/useLiveTradeCandles';
import type { CandleWeatherSnapshot } from '../lib/candleWeatherSnapshot';
import {
  buildLiveTradeChartOption,
  centsFromPixelY,
  findCandleIndexAtPixel,
  resolveCandleIndexFromAxisValue,
  type LiveTradeDataZoomState,
} from '../lib/liveTradeChartEchartsOption';

export type { ChartTradeMarker } from '../lib/chartTradeMarkers';

const EMPTY_PRICE_SET = new Set<string>();
const ORDER_LINE_HANDLE_W = 12;
const ORDER_LINE_HANDLE_H = 14;

const INTERVAL_MS: Record<string, number> = {
  '5s': 5000,
  '1m': 60000,
  '5m': 300000,
  '15m': 900000,
  '1h': 3600000,
  '4h': 14400000,
};
const CHART_INTERVALS = ['5s', '1m', '5m', '15m'] as const;
type ChartInterval = (typeof CHART_INTERVALS)[number];
const LIVE_TRADE_CHART_INTERVAL_LS_KEY = 'polybot-live-trade-chart-interval';

function readStoredChartInterval(): ChartInterval | null {
  try {
    const v = localStorage.getItem(LIVE_TRADE_CHART_INTERVAL_LS_KEY);
    if (v && (CHART_INTERVALS as readonly string[]).includes(v)) return v as ChartInterval;
  } catch {
    /* ignore */
  }
  return null;
}

function persistChartInterval(iv: ChartInterval) {
  try {
    localStorage.setItem(LIVE_TRADE_CHART_INTERVAL_LS_KEY, iv);
  } catch {
    /* ignore */
  }
}

interface LiveTradeChartProps {
  trades: LiveTrade[];
  isNo: boolean;
  tokenId?: string;
  startTime?: number;
  endTime?: number;
  intervalContext?: string;
  defaultIntervalOverride?: string;
  chainlinkAsset?: string;
  targetPrice?: number | null;
  hidePriceLines?: boolean;
  tradeMarkers?: ChartTradeMarker[];
  intervalSelector?: 'buttons' | 'dropdown';
  outcomeToggle?: {
    value: 'YES' | 'NO';
    onChange: (value: 'YES' | 'NO') => void;
    yesLabel: string;
    noLabel: string;
    noDisabled?: boolean;
  };
  outcomeSync?: {
    enabled: boolean;
    onToggle: () => void;
  };
  soundMuteYesTokenId?: string;
  soundMuteNoTokenId?: string;
  volumeSpikeAlerts?: boolean;
  candleObHover?: boolean;
  obHeatmap?: boolean;
  sidebarUserBidPrices?: Set<string>;
  sidebarUserAskPrices?: Set<string>;
  sidebarChartOrderLevels?: SidebarChartOrderLevel[];
  onChartOrderReplace?: (params: ChartOrderReplaceParams) => void;
  sidebarChartPositionLevels?: SidebarChartPositionLevel[];
}

function defaultInterval(context?: string): string {
  if (!context) return '1m';
  const s = context.toLowerCase();
  if (s.match(/updown-4h/) || s.match(/\b4[- ]?h\b/)) return '15m';
  if (s.match(/up-or-down-on-/) || s.match(/\b24[- ]?h\b/)) return '15m';
  if (s.match(/updown-1h/) || s.match(/(?:^|[^0-9])1[- ]?h\b/) || s.match(/\b1[- ]?hour\b/)) return '5m';
  return '1m';
}

type OrderHandleLayout = {
  orderId: string;
  chartCents: number;
  y: number;
  handleX: number;
};

export function LiveTradeChart({
  trades,
  isNo,
  tokenId,
  startTime,
  endTime,
  intervalContext,
  defaultIntervalOverride,
  chainlinkAsset,
  hidePriceLines,
  tradeMarkers,
  intervalSelector = 'buttons',
  outcomeToggle,
  outcomeSync,
  soundMuteYesTokenId,
  soundMuteNoTokenId,
  volumeSpikeAlerts = false,
  candleObHover = false,
  obHeatmap = false,
  sidebarUserBidPrices,
  sidebarUserAskPrices,
  sidebarChartOrderLevels,
  onChartOrderReplace,
  sidebarChartPositionLevels,
}: LiveTradeChartProps) {
  void chainlinkAsset; // spot overlay unused when hidePriceLines (sidebar/market)

  const chartRef = useRef<ReactECharts>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const resolvedDefaultInterval = defaultIntervalOverride || defaultInterval(intervalContext);
  const [interval, setInterval_] = useState<ChartInterval>(
    () => readStoredChartInterval() ?? (resolvedDefaultInterval as ChartInterval),
  );
  const [hideTrades, setHideTrades] = useState(false);
  const [volumeSpikeFlashSide, setVolumeSpikeFlashSide] = useState<ChartVolumeSpikeSide | null>(null);
  const lastVolumeSpikeBarRef = useRef<number | null>(null);
  const volumeSpikeFlashGenRef = useRef(0);
  const [hoverOhlcv, setHoverOhlcv] = useState<ChartObHoverOhlcv | null>(null);
  const [hoverOb, setHoverOb] = useState<{
    clientX: number;
    clientY: number;
    ob?: CandleObSnapshot;
    cexOb?: CexObCandleSnapshot;
    gex?: GexAssetSnapshot;
    gexBinance?: GexAssetSnapshot;
    gexOkx?: GexAssetSnapshot;
    weather?: CandleWeatherSnapshot;
    ohlcv: ChartObHoverOhlcv;
    enrichment?: CandleBsEnrichment;
  } | null>(null);
  const [hoverObPos, setHoverObPos] = useState<{ left: number; top: number } | null>(null);
  const hoverObPopupRef = useRef<HTMLDivElement>(null);
  const pointerClientRef = useRef({ x: 0, y: 0 });
  const orderDragLevelRef = useRef<SidebarChartOrderLevel | null>(null);
  const [orderDrag, setOrderDrag] = useState<{ orderId: string; chartCents: number } | null>(null);
  const [orderHandleHover, setOrderHandleHover] = useState(false);
  const [orderHandles, setOrderHandles] = useState<OrderHandleLayout[]>([]);
  const dataZoomRef = useRef<LiveTradeDataZoomState | null>(null);
  const [dataZoomTick, setDataZoomTick] = useState(0);
  const chartOrderDragEnabled = !!(sidebarChartOrderLevels?.length && onChartOrderReplace);

  const setChartInterval = useCallback((iv: ChartInterval) => {
    setInterval_(iv);
    persistChartInterval(iv);
    dataZoomRef.current = null;
  }, []);

  const candleMs = INTERVAL_MS[interval] || 60000;
  const enrichmentPriceDec = chainlinkAsset?.toUpperCase() === 'XRP' ? 4 : 2;

  const { candles, ready, wsTick, candleMapRef } = useLiveTradeCandles({
    tokenId,
    isNo,
    startTime,
    endTime,
    interval,
    candleMs,
  });

  const displayChartOrderLevels = useMemo(() => {
    if (!sidebarChartOrderLevels?.length) return undefined;
    if (!orderDrag) return sidebarChartOrderLevels;
    return sidebarChartOrderLevels.map((lv) =>
      lv.orderId === orderDrag.orderId ? { ...lv, priceCents: orderDrag.chartCents } : lv,
    );
  }, [sidebarChartOrderLevels, orderDrag]);

  const emptyMessage = useMemo(() => {
    const now = Date.now();
    if (startTime && now < startTime) return 'Market not started yet';
    return 'Waiting for data...';
  }, [startTime]);

  const option = useMemo(
    () =>
      buildLiveTradeChartOption({
        candles,
        candleMs,
        interval,
        startTime,
        endTime,
        // Stake buckets keyed by YES token id (weather market_buckets.tokenId).
        tokenId: soundMuteYesTokenId || tokenId,
        obHeatmap,
        hideTrades,
        tradeMarkers,
        chartOutcome: outcomeToggle?.value ?? 'YES',
        orderLevels: displayChartOrderLevels,
        positionLevels: sidebarChartPositionLevels,
        hidePriceLines,
        dataZoom: dataZoomRef.current,
        emptyMessage,
      }),
    // dataZoomTick forces rebuild after user zoom without resetting ref mid-drag
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      candles,
      candleMs,
      interval,
      startTime,
      endTime,
      tokenId,
      soundMuteYesTokenId,
      obHeatmap,
      hideTrades,
      tradeMarkers,
      outcomeToggle?.value,
      displayChartOrderLevels,
      sidebarChartPositionLevels,
      hidePriceLines,
      emptyMessage,
      dataZoomTick,
    ],
  );

  const getChart = useCallback((): EChartsType | undefined => {
    return chartRef.current?.getEchartsInstance();
  }, []);

  const syncOrderHandles = useCallback(() => {
    const chart = getChart();
    const levels = displayChartOrderLevels;
    if (!chart || !levels?.length) {
      setOrderHandles([]);
      return;
    }
    const width = wrapRef.current?.clientWidth ?? 0;
    const next: OrderHandleLayout[] = [];
    for (const lv of levels) {
      try {
        const pt = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [candles.length - 1, lv.priceCents]);
        if (!Array.isArray(pt) || !Number.isFinite(pt[1])) continue;
        next.push({
          orderId: lv.orderId,
          chartCents: lv.priceCents,
          y: pt[1],
          handleX: Math.max(ORDER_LINE_HANDLE_W, width - 6),
        });
      } catch {
        /* ignore */
      }
    }
    setOrderHandles(next);
  }, [getChart, displayChartOrderLevels, candles.length]);

  useEffect(() => {
    let raf: number | null = null;
    raf = requestAnimationFrame(() => {
      raf = null;
      syncOrderHandles();
    });
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [syncOrderHandles, option]);

  const onDataZoom = useCallback(() => {
    const chart = getChart();
    if (!chart) return;
    const opt = chart.getOption() as {
      dataZoom?: { start?: number; end?: number; xAxisIndex?: number | number[]; yAxisIndex?: number | number[] }[];
    };
    const zooms = opt.dataZoom || [];
    const xDz = zooms.find((z) => z.xAxisIndex != null) || zooms[0];
    const yDz = zooms.find((z) => z.yAxisIndex != null);
    const next: LiveTradeDataZoomState = {
      start: typeof xDz?.start === 'number' ? xDz.start : dataZoomRef.current?.start ?? 0,
      end: typeof xDz?.end === 'number' ? xDz.end : dataZoomRef.current?.end ?? 100,
    };
    if (typeof yDz?.start === 'number' && typeof yDz?.end === 'number') {
      next.yStart = yDz.start;
      next.yEnd = yDz.end;
    }
    dataZoomRef.current = next;
    syncOrderHandles();
  }, [getChart, syncOrderHandles]);

  const hitTestOrderHandle = useCallback(
    (mx: number, my: number): OrderHandleLayout | null => {
      for (const L of orderHandles) {
        if (
          mx >= L.handleX - ORDER_LINE_HANDLE_W / 2 &&
          mx <= L.handleX + ORDER_LINE_HANDLE_W / 2 &&
          my >= L.y - ORDER_LINE_HANDLE_H / 2 &&
          my <= L.y + ORDER_LINE_HANDLE_H / 2
        ) {
          return L;
        }
      }
      return null;
    },
    [orderHandles],
  );

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      if (!chartOrderDragEnabled) return;
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = hitTestOrderHandle(mx, my);
      if (!hit) return;
      const lv = sidebarChartOrderLevels?.find((l) => l.orderId === hit.orderId);
      if (!lv) return;
      orderDragLevelRef.current = lv;
      setOrderDrag({ orderId: hit.orderId, chartCents: hit.chartCents });
      e.preventDefault();
      e.stopPropagation();
    },
    [chartOrderDragEnabled, hitTestOrderHandle, sidebarChartOrderLevels],
  );

  const orderDragRef = useRef(orderDrag);
  orderDragRef.current = orderDrag;

  useEffect(() => {
    if (!orderDrag || !chartOrderDragEnabled) return;
    const onPointerMove = (e: PointerEvent) => {
      const rect = wrapRef.current?.getBoundingClientRect();
      const chart = getChart();
      if (!rect || !chart) return;
      const my = e.clientY - rect.top;
      const cents = centsFromPixelY(chart, my);
      if (cents == null) return;
      setOrderDrag((prev) => (prev ? { ...prev, chartCents: cents } : null));
    };
    const onPointerUp = () => {
      const drag = orderDragRef.current;
      const lv = orderDragLevelRef.current;
      orderDragLevelRef.current = null;
      setOrderDrag(null);
      if (!drag || !lv || !onChartOrderReplace) return;
      const viewOutcome = outcomeToggle?.value ?? 'YES';
      const newTokenCents = chartViewCentsToTokenPriceCents(
        drag.chartCents,
        lv.tokenId,
        viewOutcome,
        soundMuteYesTokenId || '',
        soundMuteNoTokenId || '',
      );
      if (Math.abs(newTokenCents - lv.tokenPriceCents) < 0.05) return;
      onChartOrderReplace({
        orderId: lv.orderId,
        tokenId: lv.tokenId,
        side: lv.side,
        remainingSize: lv.remainingSize,
        newPriceCents: newTokenCents,
      });
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [
    orderDrag,
    chartOrderDragEnabled,
    onChartOrderReplace,
    outcomeToggle?.value,
    soundMuteYesTokenId,
    soundMuteNoTokenId,
    getChart,
  ]);

  useEffect(() => {
    setOrderDrag(null);
    orderDragLevelRef.current = null;
  }, [sidebarChartOrderLevels, tokenId]);

  const candleTimes = useMemo(() => candles.map((c) => c.time), [candles]);

  const applyCandleHover = useCallback(
    (idx: number | null, clientX: number, clientY: number) => {
      if (idx == null || idx < 0 || idx >= candles.length) {
        setHoverOhlcv(null);
        setHoverOb(null);
        return;
      }
      const nearest = candles[idx];
      const ohlcv: ChartObHoverOhlcv = {
        timeMs: nearest.time,
        o: nearest.o,
        h: nearest.h,
        l: nearest.l,
        c: nearest.c,
        v: nearest.v,
      };
      setHoverOhlcv(ohlcv);

      if (!candleObHover) {
        setHoverOb(null);
        return;
      }

      const hasPolyOb =
        nearest.ob != null && (nearest.ob.bids.length > 0 || nearest.ob.asks.length > 0);
      const hasCexOb = nearest.cexOb != null;
      const hasGex = nearest.gex != null;
      const hasGexBinance = nearest.gexBinance != null;
      const hasGexOkx = nearest.gexOkx != null;
      const hasWeather = nearest.weather != null && interval === '5m';
      // Always show popup (OHLCV at minimum) — don't require OB/GEX/weather on that bar.
      setHoverOb({
        clientX,
        clientY,
        ...(hasPolyOb ? { ob: nearest.ob } : {}),
        ...(hasCexOb ? { cexOb: nearest.cexOb } : {}),
        ...(hasGex ? { gex: nearest.gex } : {}),
        ...(hasGexBinance ? { gexBinance: nearest.gexBinance } : {}),
        ...(hasGexOkx ? { gexOkx: nearest.gexOkx } : {}),
        ...(hasWeather ? { weather: nearest.weather } : {}),
        ohlcv,
        enrichment: nearest.enrichment,
      });
    },
    [candles, candleObHover, interval],
  );

  const handleMouseMove = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      pointerClientRef.current = { x: e.clientX, y: e.clientY };
      const rect = wrapRef.current?.getBoundingClientRect();
      const chart = getChart();
      if (!rect || !chart) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (chartOrderDragEnabled && !orderDrag) {
        const onHandle = !!hitTestOrderHandle(mx, my);
        setOrderHandleHover(onHandle);
        if (onHandle) {
          setHoverOhlcv(null);
          setHoverOb(null);
          return;
        }
      }
      if (orderDrag) {
        setHoverOhlcv(null);
        setHoverOb(null);
        return;
      }

      const idx = findCandleIndexAtPixel(chart, mx, candleTimes, my);
      applyCandleHover(idx, e.clientX, e.clientY);
    },
    [
      getChart,
      chartOrderDragEnabled,
      orderDrag,
      hitTestOrderHandle,
      candleTimes,
      applyCandleHover,
    ],
  );

  const onUpdateAxisPointer = useCallback(
    (event: {
      axesInfo?: { axisDim?: string; axisIndex?: number; value?: unknown }[];
    }) => {
      if (orderDrag) return;
      const xInfo =
        event.axesInfo?.find((a) => a.axisDim === 'x' && (a.axisIndex == null || a.axisIndex === 0)) ??
        event.axesInfo?.find((a) => a.axisDim === 'x');
      if (!xInfo || xInfo.value == null) return;
      const idx = resolveCandleIndexFromAxisValue(xInfo.value, candleTimes);
      const { x, y } = pointerClientRef.current;
      applyCandleHover(idx, x, y);
    },
    [orderDrag, candleTimes, applyCandleHover],
  );

  const handleMouseLeave = useCallback(() => {
    setHoverOhlcv(null);
    setHoverOb(null);
    setOrderHandleHover(false);
  }, []);

  const chartCursor = orderDrag ? 'grabbing' : orderHandleHover ? 'ns-resize' : 'crosshair';

  useEffect(() => {
    if (!volumeSpikeAlerts) {
      lastVolumeSpikeBarRef.current = null;
      setVolumeSpikeFlashSide(null);
    }
  }, [volumeSpikeAlerts]);

  useEffect(() => {
    lastVolumeSpikeBarRef.current = null;
    setVolumeSpikeFlashSide(null);
    setHoverOhlcv(null);
    setHoverOb(null);
    dataZoomRef.current = null;
    setDataZoomTick((n) => n + 1);
  }, [tokenId, interval]);

  useLayoutEffect(() => {
    if (!hoverOb) {
      setHoverObPos(null);
      return;
    }
    const el = hoverObPopupRef.current;
    if (!el) return;
    const margin = 10;
    const offset = 10;
    const w = el.offsetWidth || 320;
    const h = el.offsetHeight;
    let left = hoverOb.clientX + offset;
    if (left + w > window.innerWidth - margin) {
      left = hoverOb.clientX - w - offset;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
    let top = hoverOb.clientY - Math.min(100, h * 0.25);
    if (top + h > window.innerHeight - margin) {
      top = window.innerHeight - h - margin;
    }
    top = Math.max(margin, top);
    setHoverObPos({ left, top });
  }, [hoverOb]);

  useEffect(() => {
    if (!volumeSpikeAlerts || !ready || !tokenId) return;
    const sorted = [...candleMapRef.current.values()].sort((a, b) => a.time - b.time);
    const spike = detectChartVolumeSpike(sorted, candleMs, trades);
    if (!spike) return;
    if (lastVolumeSpikeBarRef.current === spike.barTime) return;
    lastVolumeSpikeBarRef.current = spike.barTime;

    const gen = volumeSpikeFlashGenRef.current + 1;
    volumeSpikeFlashGenRef.current = gen;
    setVolumeSpikeFlashSide(spike.side);
    const endMs = endTime != null && Number.isFinite(endTime) ? endTime : null;
    if (endMs == null || endMs > Date.now()) {
      if (sorted.length >= MIN_CHART_CANDLES_FOR_VOLUME_SPIKE_SOUND) {
        void playChartVolumeSpikeRing(soundMuteYesTokenId, soundMuteNoTokenId);
      }
    }

    const t = window.setTimeout(() => {
      if (volumeSpikeFlashGenRef.current === gen) setVolumeSpikeFlashSide(null);
    }, CHART_VOLUME_SPIKE_FLASH_MS);
    return () => clearTimeout(t);
  }, [
    volumeSpikeAlerts,
    ready,
    wsTick,
    trades,
    tokenId,
    interval,
    candleMs,
    endTime,
    soundMuteYesTokenId,
    soundMuteNoTokenId,
    candleMapRef,
  ]);

  if (!tokenId) return null;

  return (
    <div className="sidebar-section">
      <div className="flex items-center justify-between mb-1 gap-2">
        {outcomeToggle ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-xs text-gray-400 shrink-0">Price</span>
            <div className="inline-flex items-center gap-0.5">
              <div className="inline-flex rounded border border-gray-700 bg-gray-900 p-0.5">
                <button
                  type="button"
                  className={`px-1.5 py-0 text-[9px] font-bold rounded-sm transition ${
                    outcomeToggle.value === 'YES'
                      ? 'bg-emerald-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                  onClick={() => outcomeToggle.onChange('YES')}
                >
                  {outcomeToggle.yesLabel}
                </button>
                <button
                  type="button"
                  disabled={outcomeToggle.noDisabled}
                  className={`px-1.5 py-0 text-[9px] font-bold rounded-sm transition disabled:opacity-40 disabled:pointer-events-none ${
                    outcomeToggle.value === 'NO'
                      ? 'bg-rose-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                  onClick={() => outcomeToggle.onChange('NO')}
                >
                  {outcomeToggle.noLabel}
                </button>
              </div>
              {outcomeSync ? (
                <button
                  type="button"
                  title={
                    outcomeSync.enabled
                      ? 'Synced with order YES/NO — click to unlink'
                      : 'Sync chart with order YES/NO'
                  }
                  aria-pressed={outcomeSync.enabled}
                  aria-label={outcomeSync.enabled ? 'Unsync chart from order side' : 'Sync chart to order side'}
                  className={`shrink-0 rounded p-0 transition ${
                    outcomeSync.enabled
                      ? 'text-cyan-400 hover:text-cyan-300'
                      : 'text-gray-600 hover:text-gray-400'
                  }`}
                  onClick={outcomeSync.onToggle}
                >
                  {outcomeSync.enabled ? (
                    <Link2 className="h-3 w-3" strokeWidth={2.25} aria-hidden />
                  ) : (
                    <Link2Off className="h-3 w-3" strokeWidth={2.25} aria-hidden />
                  )}
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <span className="text-xs text-gray-400">Price YES</span>
        )}
        {intervalSelector === 'dropdown' ? (
          <select
            value={interval}
            onChange={(e) => setChartInterval(e.target.value as ChartInterval)}
            className="min-w-[3.5rem] w-16 shrink-0 rounded border border-gray-600 bg-gray-800 py-0 pl-1.5 pr-6 text-[10px] font-medium text-gray-200 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
            aria-label="Chart resolution"
          >
            {CHART_INTERVALS.map((iv) => (
              <option key={iv} value={iv}>
                {iv}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex gap-0.5">
            {CHART_INTERVALS.map((iv) => (
              <button
                key={iv}
                onClick={() => setChartInterval(iv)}
                className={`px-1.5 py-0 text-[10px] rounded ${interval === iv ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400 hover:bg-gray-600'}`}
              >
                {iv}
              </button>
            ))}
          </div>
        )}
      </div>
      {tradeMarkers != null ? (
        <div className="mb-0.5 flex items-center gap-2.5 text-[9px] text-gray-500">
          {(() => {
            const invertLegend = outcomeToggle?.value === 'NO';
            return (
              <>
                <span className="inline-flex items-center gap-1">
                  <span
                    className={`inline-block shrink-0 border-x-[4px] border-x-transparent border-b-[7px]${invertLegend ? ' rotate-180' : ''}`}
                    style={{ borderBottomColor: '#2563eb' }}
                    aria-hidden
                  />
                  long
                </span>
                <span className="inline-flex items-center gap-1">
                  <span
                    className={`inline-block shrink-0 border-x-[4px] border-x-transparent border-t-[7px]${invertLegend ? ' rotate-180' : ''}`}
                    style={{ borderTopColor: '#facc15' }}
                    aria-hidden
                  />
                  short
                </span>
              </>
            );
          })()}
          <label className="inline-flex items-center gap-1 cursor-pointer select-none text-gray-400 hover:text-gray-300">
            <input
              type="checkbox"
              checked={hideTrades}
              onChange={(e) => setHideTrades(e.target.checked)}
              className="h-3 w-3 rounded border-gray-600 bg-gray-800 text-blue-600 focus:ring-0 focus:ring-offset-0"
            />
            Hide Trades
          </label>
        </div>
      ) : null}
      <div
        ref={wrapRef}
        className="relative rounded-[6px]"
        style={{ cursor: chartCursor }}
        onMouseDown={chartOrderDragEnabled ? handleMouseDown : undefined}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        <ReactECharts
          ref={chartRef}
          option={option}
          style={{ width: '100%', height: 128, borderRadius: 6 }}
          opts={{ renderer: 'canvas' }}
          notMerge
          lazyUpdate
          onEvents={{
            datazoom: onDataZoom,
            finished: syncOrderHandles,
            updateAxisPointer: onUpdateAxisPointer,
          }}
        />
        {hoverOhlcv ? (
          <div
            className="pointer-events-none absolute left-9 top-1 z-[5] text-[9px] font-bold font-mono tabular-nums whitespace-nowrap"
            style={{ color: hoverOhlcv.c >= hoverOhlcv.o ? '#10b981' : '#ef4444' }}
          >
            {`O ${hoverOhlcv.o.toFixed(1)}  H ${hoverOhlcv.h.toFixed(1)}  L ${hoverOhlcv.l.toFixed(1)}  C ${hoverOhlcv.c.toFixed(1)}  V ${
              hoverOhlcv.v >= 1_000_000
                ? `${(hoverOhlcv.v / 1_000_000).toFixed(2)}M`
                : hoverOhlcv.v >= 1_000
                  ? `${(hoverOhlcv.v / 1_000).toFixed(1)}K`
                  : hoverOhlcv.v >= 100
                    ? hoverOhlcv.v.toFixed(0)
                    : hoverOhlcv.v >= 1
                      ? hoverOhlcv.v.toFixed(1)
                      : hoverOhlcv.v.toFixed(2)
            }`}
          </div>
        ) : null}
        {orderHandles.map((h) => {
          const lv = displayChartOrderLevels?.find((l) => l.orderId === h.orderId);
          const color = lv?.direction === 'long' ? '#2563eb' : '#facc15';
          return (
            <div
              key={h.orderId}
              className="absolute z-10"
              style={{
                left: h.handleX - ORDER_LINE_HANDLE_W / 2,
                top: h.y - ORDER_LINE_HANDLE_H / 2,
                width: ORDER_LINE_HANDLE_W,
                height: ORDER_LINE_HANDLE_H,
                background: color,
                border: '1px solid rgba(255,255,255,0.85)',
                boxSizing: 'border-box',
                cursor: orderDrag?.orderId === h.orderId ? 'grabbing' : 'ns-resize',
              }}
              onMouseDown={(e) => {
                if (!chartOrderDragEnabled) return;
                const level = sidebarChartOrderLevels?.find((l) => l.orderId === h.orderId);
                if (!level) return;
                orderDragLevelRef.current = level;
                setOrderDrag({ orderId: h.orderId, chartCents: h.chartCents });
                e.preventDefault();
                e.stopPropagation();
              }}
              onMouseEnter={() => setOrderHandleHover(true)}
              onMouseLeave={() => {
                if (!orderDrag) setOrderHandleHover(false);
              }}
            />
          );
        })}
        {volumeSpikeFlashSide ? (
          <div
            className={`pointer-events-none absolute inset-0 rounded-[6px] ${
              volumeSpikeFlashSide === 'BUY'
                ? 'live-trade-chart-volume-spike-flash-buy'
                : 'live-trade-chart-volume-spike-flash-sell'
            }`}
            title={`Volume spike — ${volumeSpikeFlashSide === 'BUY' ? 'buy' : 'sell'} (≥5× prior average)`}
            aria-hidden
          />
        ) : null}
        {hoverOb && candleObHover && typeof document !== 'undefined'
          ? createPortal(
              <div
                ref={hoverObPopupRef}
                className="fixed z-[60150] bg-gray-900/95 border border-gray-600 rounded-lg shadow-xl p-2 pointer-events-none"
                style={{
                  left: hoverObPos?.left ?? hoverOb.clientX + 10,
                  top: hoverObPos?.top ?? Math.max(10, hoverOb.clientY - 100),
                  width: hoverOb.weather ? 520 : 320,
                  maxHeight: '80vh',
                  overflowY: 'auto',
                }}
              >
                {(() => {
                  const step = '5' as const;
                  const chartOutcome = outcomeToggle?.value ?? 'YES';
                  const hasPolyOb =
                    hoverOb.ob != null &&
                    (hoverOb.ob.bids.length > 0 || hoverOb.ob.asks.length > 0);
                  const polyDisplay = hasPolyOb
                    ? prepareCandleObDisplay(hoverOb.ob!, step)
                    : null;
                  return (
                    <>
                      <ChartObHoverOhlcvStrip
                        ohlcv={hoverOb.ohlcv}
                        interval={interval}
                        expiryMs={endTime}
                      />
                      <ChartObHoverEnrichmentStrip
                        enrichment={hoverOb.enrichment}
                        priceDec={enrichmentPriceDec}
                        chartOutcome={chartOutcome}
                      />
                      {polyDisplay ? (
                        <SidebarOrderbookBookGrid
                          displayBids={polyDisplay.displayBids}
                          displayAsks={polyDisplay.displayAsks}
                          obAggStep={step}
                          yesBidUsd={polyDisplay.yesBidUsd}
                          noBidUsd={polyDisplay.noBidUsd}
                          displayBidFullUsd={polyDisplay.displayBidFullUsd}
                          displayAskFullUsd={polyDisplay.displayAskFullUsd}
                          orderOutcome={chartOutcome}
                          sidebarUserBidPrices={sidebarUserBidPrices ?? EMPTY_PRICE_SET}
                          sidebarUserAskPrices={sidebarUserAskPrices ?? EMPTY_PRICE_SET}
                          readOnly
                        />
                      ) : null}
                      {hoverOb.cexOb ? <ChartCexObHoverGrid snapshot={hoverOb.cexOb} /> : null}
                      {hoverOb.gex ? <ChartGexHoverGrid gex={hoverOb.gex} source="Deribit" /> : null}
                      {hoverOb.gexBinance ? (
                        <ChartGexHoverGrid gex={hoverOb.gexBinance} source="Binance" />
                      ) : null}
                      {hoverOb.gexOkx ? <ChartGexHoverGrid gex={hoverOb.gexOkx} source="OKX" /> : null}
                      {hoverOb.weather ? <ChartWeatherHoverPanel weather={hoverOb.weather} /> : null}
                    </>
                  );
                })()}
              </div>,
              document.body,
            )
          : null}
      </div>
    </div>
  );
}
