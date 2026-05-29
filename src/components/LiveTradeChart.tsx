import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Link2, Link2Off } from 'lucide-react';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import { API_BASE } from '../lib/env';
import { subscribeChartKline } from '../lib/chartWsShared';
import { resolveLiveTradeChartWindow } from '../lib/walletInfoChartMarket';
import {
  CHART_VOLUME_SPIKE_FLASH_MS,
  detectChartVolumeSpike,
  MIN_CHART_CANDLES_FOR_VOLUME_SPIKE_SOUND,
  playChartVolumeSpikeRing,
  type ChartVolumeSpikeSide,
} from '../lib/chartVolumeSpikeAlert';
import type { ChartTradeMarker } from '../lib/chartTradeMarkers';
import { parseCandleOb, type CandleObSnapshot } from '../lib/candleObSnapshot';
import { parseCexObSnapshot, type CexObCandleSnapshot } from '../lib/cexObSnapshot';
import { parseGexAssetSnapshot, type GexAssetSnapshot } from '../lib/deribitGexFeed';
import { prepareCandleObDisplay } from '../lib/candleObDisplay';
import type {
  ChartOrderReplaceParams,
  SidebarChartOrderLevel,
  SidebarChartPositionLevel,
} from '../lib/sidebarOrderbookAggregate';
import { chartViewCentsToTokenPriceCents } from '../lib/sidebarOrderbookAggregate';
import { SidebarOrderbookBookGrid } from './SidebarOrderbookBookGrid';
import { drawObHeatmapColumns } from '../lib/chartObHeatmap';
import {
  mergeCandleBsEnrichment,
  parseCandleBsEnrichment,
  parseHttpKlineEnrichment,
  chartEnrichmentMathCents,
  CHART_MATH_PROB_COLOR,
  type CandleBsEnrichment,
} from '../lib/chartCandleEnrichment';
import { ChartObHoverEnrichmentStrip } from './ChartObHoverEnrichmentStrip';
import { ChartObHoverOhlcvStrip, type ChartObHoverOhlcv } from './ChartObHoverOhlcvStrip';
import { ChartCexObHoverGrid } from './ChartCexObHoverGrid';
import { ChartGexHoverGrid } from './ChartGexHoverGrid';

export type { ChartTradeMarker } from '../lib/chartTradeMarkers';

const MAX_CHART_CANDLES = 2500;
const EMPTY_PRICE_SET = new Set<string>();
const ORDER_LINE_HANDLE_W = 12;
const ORDER_LINE_HANDLE_H = 14;

type ChartOrderLineLayout = {
  orderId: string;
  y: number;
  chartCents: number;
  handleX: number;
  handleW: number;
  handleH: number;
};

function snapChartCentsFromY(y: number, chartTop: number, chartBot: number): number {
  const span = chartBot - chartTop;
  if (span <= 0) return 50;
  const p = ((chartBot - y) / span) * 100;
  return Math.max(0.1, Math.min(99.9, Math.round(p * 10) / 10));
}

function drawSidebarChartPositionLines(
  ctx: CanvasRenderingContext2D,
  levels: SidebarChartPositionLevel[],
  chartLeft: number,
  chartRight: number,
  chartTop: number,
  chartBot: number,
  toY: (p: number) => number,
) {
  for (const lv of levels) {
    const y = toY(lv.priceCents);
    if (y < chartTop - 1 || y > chartBot + 1) continue;
    const color = lv.direction === 'long' ? '#2563eb' : '#facc15';
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.stroke();

    ctx.font = '9px monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${lv.priceCents.toFixed(1)}¢`, chartLeft - 3, y);
  }
}

function drawSidebarChartOrderLines(
  ctx: CanvasRenderingContext2D,
  levels: SidebarChartOrderLevel[],
  chartLeft: number,
  chartRight: number,
  chartTop: number,
  chartBot: number,
  toY: (p: number) => number,
  layoutOut: ChartOrderLineLayout[],
) {
  layoutOut.length = 0;
  for (const lv of levels) {
    const y = toY(lv.priceCents);
    if (y < chartTop - 1 || y > chartBot + 1) continue;
    const color = lv.direction === 'long' ? '#2563eb' : '#facc15';
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.moveTo(chartLeft, y);
    ctx.lineTo(chartRight, y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = 'bold 9px monospace';
    ctx.fillStyle = color;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${lv.priceCents.toFixed(1)}¢`, chartLeft - 3, y);

    const handleX = chartRight - 2;
    const hw = ORDER_LINE_HANDLE_W;
    const hh = ORDER_LINE_HANDLE_H;
    const hx = handleX - hw / 2;
    const hy = y - hh / 2;
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.fillRect(hx, hy, hw, hh);
    ctx.strokeRect(hx + 0.5, hy + 0.5, hw - 1, hh - 1);

    layoutOut.push({
      orderId: lv.orderId,
      y,
      chartCents: lv.priceCents,
      handleX,
      handleW: hw,
      handleH: hh,
    });
  }
}

function pruneCandleMap(map: Map<number, Candle>, startMs: number, endMs: number, padMs: number) {
  const lo = startMs - padMs;
  const hi = endMs + padMs;
  for (const t of map.keys()) {
    if (t < lo || t > hi) map.delete(t);
  }
  if (map.size <= MAX_CHART_CANDLES) return;
  const sorted = [...map.keys()].sort((a, b) => a - b);
  for (const t of sorted.slice(0, sorted.length - MAX_CHART_CANDLES)) map.delete(t);
}

interface Candle {
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  ob?: CandleObSnapshot;
  cexOb?: CexObCandleSnapshot;
  gex?: GexAssetSnapshot;
  enrichment?: CandleBsEnrichment;
}

interface LiveChartState {
  candles: Candle[];
  chartLeft: number;
  chartRight: number;
  chartTop: number;
  chartBot: number;
  candleMs: number;
  candleW: number;
  minT: number;
  maxT: number;
  rangeT: number;
  W: number;
  toX: (t: number) => number;
  toY: (p: number) => number;
  bullColor: string;
  bearColor: string;
  dpr: number;
  interval: string;
}

function toPrice(raw: number, isNo: boolean): number {
  return isNo ? 100 - raw : raw;
}

const INTERVAL_MS: Record<string, number> = { '5s': 5000, '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000 };
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
  /** Slug + question + group title — default candle resolution for longer Up/Down windows */
  intervalContext?: string;
  /** When set, wins over intervalContext parsing (e.g. sidebar Up/Down duration → kline size). */
  defaultIntervalOverride?: string;
  chainlinkAsset?: string; // e.g. 'BTC' -> fetches chainlink_btcusd candles
  targetPrice?: number | null; // target price in USD, placed at 50% Y-axis
  /** Hide dashed last-outcome-price line and spot (Binance/Chainlink) overlay — sidebar right chart */
  hidePriceLines?: boolean;
  /** Wallet fills — tiny buy/sell ticks to the right of candles. */
  tradeMarkers?: ChartTradeMarker[];
  /** Resolution picker UI — sidebar right uses dropdown. */
  intervalSelector?: 'buttons' | 'dropdown';
  /** YES/NO (or UP/DOWN) toggle beside Price title — uses native token klines per side. */
  outcomeToggle?: {
    value: 'YES' | 'NO';
    onChange: (value: 'YES' | 'NO') => void;
    yesLabel: string;
    noLabel: string;
    noDisabled?: boolean;
  };
  /** Sidebar: link chart YES/NO to order box outcome toggle. */
  outcomeSync?: {
    enabled: boolean;
    onToggle: () => void;
  };
  /** YES/NO token ids for global notification sound price mute. */
  soundMuteYesTokenId?: string;
  soundMuteNoTokenId?: string;
  /** Sidebar only: flash chart + volume spike beep. Off in wallet info / market view trades. */
  volumeSpikeAlerts?: boolean;
  /** Sidebar chart: candle OB popup on hover (sidebar book grid). */
  candleObHover?: boolean;
  /** Sidebar chart: OB liquidity heatmap per time column (100×1¢). */
  obHeatmap?: boolean;
  sidebarUserBidPrices?: Set<string>;
  sidebarUserAskPrices?: Set<string>;
  /** Sidebar: blue = long (BUY YES / SELL NO), yellow = short at limit price on chart Y. */
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

function fillTradeMarkerTriangle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  tipY: number,
  size: number,
  direction: 'up' | 'down',
) {
  ctx.beginPath();
  if (direction === 'up') {
    ctx.moveTo(cx, tipY);
    ctx.lineTo(cx - size, tipY + size * 1.4);
    ctx.lineTo(cx + size, tipY + size * 1.4);
  } else {
    ctx.moveTo(cx, tipY);
    ctx.lineTo(cx - size, tipY - size * 1.4);
    ctx.lineTo(cx + size, tipY - size * 1.4);
  }
  ctx.closePath();
  ctx.fill();
}

export function LiveTradeChart({
  trades,
  isNo,
  tokenId,
  startTime,
  endTime,
  intervalContext,
  defaultIntervalOverride,
  chainlinkAsset,
  targetPrice,
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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartStateRef = useRef<LiveChartState | null>(null);
  const baseImageRef = useRef<ImageData | null>(null);
  const candleMapRef = useRef<Map<number, Candle>>(new Map());
  const chainlinkCandleMapRef = useRef<Map<number, Candle>>(new Map());
  const lastTradeCountRef = useRef(0);
  const [ready, setReady] = useState(false);
  const [chainlinkReady, setChainlinkReady] = useState(false);
  const chainlinkWsRef = useRef<WebSocket | null>(null);
  const resolvedDefaultInterval = defaultIntervalOverride || defaultInterval(intervalContext);
  const [interval, setInterval_] = useState<ChartInterval>(
    () => readStoredChartInterval() ?? (resolvedDefaultInterval as ChartInterval),
  );
  const [wsTick, setWsTick] = useState(0);
  const [chainlinkTick, setChainlinkTick] = useState(0);
  const [hideTrades, setHideTrades] = useState(false);
  const [volumeSpikeFlashSide, setVolumeSpikeFlashSide] = useState<ChartVolumeSpikeSide | null>(null);
  const lastVolumeSpikeBarRef = useRef<number | null>(null);
  const volumeSpikeFlashGenRef = useRef(0);
  const hoverMxRef = useRef<number | null>(null);
  const [hoverOb, setHoverOb] = useState<{
    clientX: number;
    clientY: number;
    ob?: CandleObSnapshot;
    cexOb?: CexObCandleSnapshot;
    gex?: GexAssetSnapshot;
    ohlcv: ChartObHoverOhlcv;
    enrichment?: CandleBsEnrichment;
  } | null>(null);
  const [hoverObPos, setHoverObPos] = useState<{ left: number; top: number } | null>(null);
  const hoverObPopupRef = useRef<HTMLDivElement>(null);
  const drawRafRef = useRef<number | null>(null);
  const orderLineLayoutRef = useRef<ChartOrderLineLayout[]>([]);
  const orderDragLevelRef = useRef<SidebarChartOrderLevel | null>(null);
  const [orderDrag, setOrderDrag] = useState<{ orderId: string; chartCents: number } | null>(null);
  const [orderHandleHover, setOrderHandleHover] = useState(false);
  const chartOrderDragEnabled = !!(sidebarChartOrderLevels?.length && onChartOrderReplace);

  const displayChartOrderLevels = useMemo(() => {
    if (!sidebarChartOrderLevels?.length) return undefined;
    if (!orderDrag) return sidebarChartOrderLevels;
    return sidebarChartOrderLevels.map((lv) =>
      lv.orderId === orderDrag.orderId ? { ...lv, priceCents: orderDrag.chartCents } : lv,
    );
  }, [sidebarChartOrderLevels, orderDrag]);

  const scheduleDraw = useCallback((drawFn: () => void) => {
    if (drawRafRef.current != null) return;
    drawRafRef.current = requestAnimationFrame(() => {
      drawRafRef.current = null;
      drawFn();
    });
  }, []);

  const setChartInterval = useCallback((iv: ChartInterval) => {
    setInterval_(iv);
    persistChartInterval(iv);
  }, []);

  const candleMs = INTERVAL_MS[interval] || 60000;
  const enrichmentPriceDec = chainlinkAsset?.toUpperCase() === 'XRP' ? 4 : 2;

  // Reset candle map + fetch klines from Go backend + subscribe to WS (reconnect + tab visibility)
  useEffect(() => {
    candleMapRef.current = new Map();
    lastTradeCountRef.current = 0;
    setReady(false);

    if (!tokenId) return;

    let cancelled = false;

    const { startMs: st, endMs: et } = resolveLiveTradeChartWindow(tokenId, startTime, endTime);

    const applyKlines = (klines: any[][]) => {
      if (!Array.isArray(klines)) return;
      const map = candleMapRef.current;
      for (const k of klines) {
        const openTime = k[0] as number;
        const o = toPrice(parseFloat(k[1] as string) * 100, isNo);
        const h = toPrice(parseFloat(k[2] as string) * 100, isNo);
        const l = toPrice(parseFloat(k[3] as string) * 100, isNo);
        const c = toPrice(parseFloat(k[4] as string) * 100, isNo);
        const v = parseFloat(k[5] as string) || 0;
        const hi = Math.max(o, h, l, c);
        const lo = Math.min(o, h, l, c);
        const prev = map.get(openTime);
        const ob = parseCandleOb(k[12]);
        const cexOb = parseCexObSnapshot(k[17]) ?? prev?.cexOb;
        const gex = parseGexAssetSnapshot(k[18]) ?? prev?.gex;
        const enrichment = mergeCandleBsEnrichment(parseHttpKlineEnrichment(k), prev?.enrichment);
        map.set(openTime, {
          time: openTime,
          o,
          h: hi,
          l: lo,
          c,
          v,
          ...(ob ? { ob } : prev?.ob ? { ob: prev.ob } : {}),
          ...(cexOb ? { cexOb } : {}),
          ...(gex ? { gex } : {}),
          ...(enrichment ? { enrichment } : {}),
        });
      }
      pruneCandleMap(map, st, et, candleMs * 2);
    };

    const klineQuery = `symbol=${encodeURIComponent(tokenId)}&interval=${interval}&startTime=${st}&endTime=${et}&limit=900`;

    const loadKlines = () => {
      const applyHistory = () =>
        fetch(`${API_BASE}/api/v3/klines/history?${klineQuery}`)
          .then((r) => r.json())
          .then((hist: any[][]) => {
            if (cancelled) return;
            if (Array.isArray(hist) && hist.length > 0) applyKlines(hist);
          });

      return fetch(`${API_BASE}/api/v3/klines?${klineQuery}`)
        .then((r) => r.json())
        .then((klines: any[][]) => {
          if (cancelled) return;
          if (Array.isArray(klines) && klines.length > 0) {
            applyKlines(klines);
            return;
          }
          return applyHistory();
        })
        .catch(() => {
          if (cancelled) return;
          return applyHistory();
        })
        .finally(() => {
          if (!cancelled) setReady(true);
        });
    };

    void loadKlines();

    const applyWsKline = (k: Record<string, unknown>) => {
      const openTime = k.t as number;
      const o = toPrice(parseFloat(String(k.o)) * 100, isNo);
      const h = toPrice(parseFloat(String(k.h)) * 100, isNo);
      const l = toPrice(parseFloat(String(k.l)) * 100, isNo);
      const c = toPrice(parseFloat(String(k.c)) * 100, isNo);
      const v = parseFloat(String(k.v)) || 0;
      const hi = Math.max(o, h, l, c);
      const lo = Math.min(o, h, l, c);
      const prev = candleMapRef.current.get(openTime);
      const ob = parseCandleOb(k.ob) ?? prev?.ob;
      const cexOb = parseCexObSnapshot(k.cex_ob) ?? prev?.cexOb;
      const gex = parseGexAssetSnapshot(k.gex) ?? prev?.gex;
      const enrichment = mergeCandleBsEnrichment(parseCandleBsEnrichment(k), prev?.enrichment);
      candleMapRef.current.set(openTime, {
        time: openTime,
        o,
        h: hi,
        l: lo,
        c,
        v,
        ...(ob ? { ob } : {}),
        ...(cexOb ? { cexOb } : {}),
        ...(gex ? { gex } : {}),
        ...(enrichment ? { enrichment } : {}),
      });
      pruneCandleMap(candleMapRef.current, st, et, candleMs * 2);
    };

    const unsub = subscribeChartKline(tokenId, interval, {
      onMessage: (msg) => {
        if (msg.type === 'klineStreamSnapshot') {
          const klines = msg.data?.klines;
          if (!Array.isArray(klines)) return;
          for (const k of klines) {
            if (k && typeof k === 'object') applyWsKline(k as Record<string, unknown>);
          }
          setWsTick((n) => n + 1);
          return;
        }
        if (msg.type === 'klineStreamUpdate') {
          const k = msg.data?.data?.k;
          if (!k) return;
          applyWsKline(k as Record<string, unknown>);
          setWsTick((n) => n + 1);
        } else if (msg.type === 'klineStreamDelete') {
          const tRaw = msg.data?.data?.t;
          const t = typeof tRaw === 'number' ? tRaw : Number(tRaw);
          if (Number.isFinite(t) && t > 0) {
            candleMapRef.current.delete(t);
            setWsTick((n) => n + 1);
          }
        }
      },
      onReconnect: () => {
        void loadKlines().then(() => {
          if (!cancelled) setWsTick((n) => n + 1);
        });
      },
    });

    const onVisibility = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      void loadKlines().then(() => {
        if (!cancelled) setWsTick((n) => n + 1);
      });
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      unsub();
    };
  }, [tokenId, isNo, startTime, endTime, interval]);

  // Fetch Binance klines + subscribe to Binance WS for live price overlay
  useEffect(() => {
    chainlinkCandleMapRef.current = new Map();
    setChainlinkReady(false);

    if (chainlinkWsRef.current) {
      chainlinkWsRef.current.close();
      chainlinkWsRef.current = null;
    }

    if (!chainlinkAsset || hidePriceLines) {
      setChainlinkReady(true);
      return;
    }

    const binanceSymbol = `${chainlinkAsset.toUpperCase()}USDT`;
    const binanceStream = `${chainlinkAsset.toLowerCase()}usdt`;

    // Fetch initial candles from Binance spot REST
    fetch(`https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=500`)
      .then(r => r.json())
      .then((klines: any[][]) => {
        if (!Array.isArray(klines)) { setChainlinkReady(true); return; }
        const map = chainlinkCandleMapRef.current;
        for (const k of klines) {
          const openTime = k[0] as number;
          const o = parseFloat(k[1] as string);
          const h = parseFloat(k[2] as string);
          const l = parseFloat(k[3] as string);
          const c = parseFloat(k[4] as string);
          map.set(openTime, { time: openTime, o, h, l, c, v: 0 });
        }
        if (map.size > MAX_CHART_CANDLES) {
          const sorted = [...map.keys()].sort((a, b) => a - b);
          for (const t of sorted.slice(0, sorted.length - MAX_CHART_CANDLES)) map.delete(t);
        }
        setChainlinkReady(true);
      })
      .catch(() => setChainlinkReady(true));

    // Subscribe to Binance spot kline WS for live updates
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${binanceStream}@kline_${interval}`);
    chainlinkWsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.e === 'kline' && msg.k) {
          const k = msg.k;
          const map = chainlinkCandleMapRef.current;
          const openTime = k.t as number;
          map.set(openTime, { time: openTime, o: parseFloat(k.o), h: parseFloat(k.h), l: parseFloat(k.l), c: parseFloat(k.c), v: 0 });
          if (map.size > MAX_CHART_CANDLES) {
            const sorted = [...map.keys()].sort((a, b) => a - b);
            for (const t of sorted.slice(0, sorted.length - MAX_CHART_CANDLES)) map.delete(t);
          }
          setChainlinkTick(n => n + 1);
        }
      } catch {}
    };

    ws.onclose = () => {};
    ws.onerror = () => {};

    return () => {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      chainlinkWsRef.current = null;
    };
  }, [chainlinkAsset, hidePriceLines, startTime, endTime, interval]);

  // Trigger redraw when new trades arrive (candle data comes from kline WS, not trades)
  useEffect(() => {
    if (!ready) return;
    lastTradeCountRef.current = trades.length;
  }, [trades, ready]);

  const fmtVolume = useCallback((v: number) => {
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    if (v >= 100) return v.toFixed(0);
    if (v >= 1) return v.toFixed(1);
    return v.toFixed(2);
  }, []);

  const pickHoverCandle = useCallback((s: LiveChartState, mx: number): Candle | null => {
    if (s.candles.length === 0) return null;
    const first = s.candles[0];
    const last = s.candles[s.candles.length - 1];
    const lastCx = s.toX(last.time + s.candleMs / 2);
    const lastHitRight = Math.max(s.W, lastCx + s.candleW / 2 + 2);

    if (mx >= lastCx - s.candleW / 2 - 2 && mx <= lastHitRight) return last;

    const span = s.chartRight - s.chartLeft || 1;
    const tAtMouse = s.minT + ((mx - s.chartLeft) / span) * s.rangeT;

    for (let i = s.candles.length - 1; i >= 0; i--) {
      const c = s.candles[i];
      if (tAtMouse >= c.time && tAtMouse < c.time + s.candleMs) return c;
    }
    if (tAtMouse >= last.time) return last;
    if (tAtMouse < first.time) return first;

    let nearest: Candle | null = null;
    let nearestDist = Infinity;
    for (const c of s.candles) {
      const cx = s.toX(c.time + s.candleMs / 2);
      const dist = Math.abs(cx - mx);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = c;
      }
    }
    return nearest;
  }, []);

  const paintChartHover = useCallback((mx: number | null) => {
    const s = chartStateRef.current;
    const base = baseImageRef.current;
    const canvas = canvasRef.current;
    if (!s || !base || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.putImageData(base, 0, 0);
    if (mx == null || mx < s.chartLeft || mx > s.W) return;

    const nearest = pickHoverCandle(s, mx);
    if (!nearest) return;

    ctx.scale(s.dpr, s.dpr);
    const cx = s.toX(nearest.time + s.candleMs / 2);

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.moveTo(cx, s.chartTop);
    ctx.lineTo(cx, s.chartBot);
    ctx.stroke();
    ctx.setLineDash([]);

    const isBull = nearest.c >= nearest.o;
    const color = isBull ? s.bullColor : s.bearColor;
    const bodyTop = s.toY(Math.max(nearest.o, nearest.c));
    const bodyBot = s.toY(Math.min(nearest.o, nearest.c));
    const bodyH = Math.max(bodyBot - bodyTop, 1);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - s.candleW / 2 - 1, bodyTop - 1, s.candleW + 2, bodyH + 2);

    const hoverLine = `O ${nearest.o.toFixed(1)}  H ${nearest.h.toFixed(1)}  L ${nearest.l.toFixed(1)}  C ${nearest.c.toFixed(1)}  V ${fmtVolume(nearest.v)}`;

    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = color;
    ctx.fillText(hoverLine, s.chartLeft + 2, s.chartTop + 2);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, [fmtVolume, pickHoverCandle]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const candles = Array.from(candleMapRef.current.values()).sort((a, b) => a.time - b.time);

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;

    if (candles.length === 0) {
      chartStateRef.current = null;
      baseImageRef.current = null;
      hoverMxRef.current = null;
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const now = Date.now();
      const notStarted = startTime && now < startTime;
      ctx.fillText(notStarted ? 'Market not started yet' : 'Waiting for data...', W / 2, H / 2);
      return;
    }

    const chartLeft = 36;
    const chartRight = W - 4;
    const chartTop = 4;
    /** hh:mm sits in bottom band — 0¢ is drawn flush above it */
    const timeBand = 13;
    const gapZeroAboveTimeLabels = 2;
    const chartBot = H - timeBand - gapZeroAboveTimeLabels;
    /** Volume grows downward past chartBot through time-band (below candle pane) */
    const volFloor = H - 2;

    // Fixed 0-100 Y-axis range
    const minP = 0;
    const maxP = 100;

    // X-axis spans market window (startTime/endTime) like sidebar right chart
    const minT = startTime || candles[0].time;
    const maxT = endTime || candles[candles.length - 1].time + candleMs;
    const rangeT = maxT - minT || 1;
    const totalCandles = Math.ceil(rangeT / candleMs);

    const candleW = Math.max(2, Math.min(12, ((chartRight - chartLeft) / Math.max(totalCandles, 1)) * 0.7));
    const halfCandleW = candleW / 2;
    const xSpan = Math.max(1, chartRight - chartLeft - candleW);
    /** Inset plot so first/last candle bodies stay inside canvas (center at minT/maxT). */
    const toX = (t: number) => chartLeft + halfCandleW + ((t - minT) / rangeT) * xSpan;
    const toY = (p: number) => chartBot - ((p - minP) / (maxP - minP)) * (chartBot - chartTop);

    // Grid lines + price labels (every 10¢ on 0–100¢ axis)
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.font = '9px monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    for (let cents = 0; cents <= 100; cents += 10) {
      const y = toY(cents);
      ctx.beginPath();
      ctx.moveTo(chartLeft, y);
      ctx.lineTo(chartRight, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${cents}¢`, chartLeft - 2, y);
    }

    /** Time labels sit below chartBot in bottom band (drawn last for z-order) */
    const timeLabelY = chartBot + gapZeroAboveTimeLabels;

    if (obHeatmap) {
      drawObHeatmapColumns(ctx, candles, { chartTop, chartBot, candleMs, toX, toY });
    }

    // Volume bars — span into candle pane + full overflow through time band to bottom
    const volBleedUp = Math.min(40, Math.floor((chartBot - chartTop) * 0.38));
    const volCeil = chartBot - volBleedUp;
    const volSpanPx = Math.max(8, volFloor - volCeil);
    let maxVol = 0;
    for (const c of candles) {
      if (c.v > maxVol) maxVol = c.v;
    }
    if (maxVol > 0) {
      for (const c of candles) {
        if (c.v <= 0) continue;
        const cx = toX(c.time + candleMs / 2);
        const isBull = c.c >= c.o;
        const barH = Math.max(1, (c.v / maxVol) * volSpanPx);
        ctx.fillStyle = isBull ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)';
        ctx.fillRect(cx - candleW / 2, volFloor - barH, candleW, barH);
      }
    }

    const bullColor = '#10b981';
    const bearColor = '#ef4444';

    for (const c of candles) {
      const cx = toX(c.time + candleMs / 2);
      const isBull = c.c >= c.o;
      const color = isBull ? bullColor : bearColor;

      // Wick
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.moveTo(cx, toY(c.h));
      ctx.lineTo(cx, toY(c.l));
      ctx.stroke();

      // Body
      const bodyTop = toY(Math.max(c.o, c.c));
      const bodyBot = toY(Math.min(c.o, c.c));
      const bodyH = Math.max(bodyBot - bodyTop, 1);
      ctx.fillStyle = color;
      ctx.fillRect(cx - candleW / 2, bodyTop, candleW, bodyH);
    }

    const chartOutcome = outcomeToggle?.value ?? 'YES';
    const mathLineColor = CHART_MATH_PROB_COLOR;
    const mathPoints: { cx: number; cy: number }[] = [];
    for (const c of candles) {
      if (c.time < minT - candleMs || c.time > maxT + candleMs) continue;
      const cents = chartEnrichmentMathCents(c.enrichment?.bsProb, chartOutcome);
      if (cents == null) continue;
      mathPoints.push({
        cx: toX(c.time + candleMs / 2),
        cy: toY(cents),
      });
    }
    if (mathPoints.length === 1) {
      const p = mathPoints[0];
      ctx.beginPath();
      ctx.arc(p.cx, p.cy, 2, 0, Math.PI * 2);
      ctx.fillStyle = mathLineColor;
      ctx.fill();
    } else if (mathPoints.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = mathLineColor;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.moveTo(mathPoints[0].cx, mathPoints[0].cy);
      for (let i = 1; i < mathPoints.length; i++) {
        ctx.lineTo(mathPoints[i].cx, mathPoints[i].cy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (sidebarChartPositionLevels && sidebarChartPositionLevels.length > 0) {
      drawSidebarChartPositionLines(
        ctx,
        sidebarChartPositionLevels,
        chartLeft,
        chartRight,
        chartTop,
        chartBot,
        toY,
      );
    }

    if (displayChartOrderLevels && displayChartOrderLevels.length > 0) {
      drawSidebarChartOrderLines(
        ctx,
        displayChartOrderLevels,
        chartLeft,
        chartRight,
        chartTop,
        chartBot,
        toY,
        orderLineLayoutRef.current,
      );
    } else {
      orderLineLayoutRef.current.length = 0;
    }

    if (!hideTrades && tradeMarkers && tradeMarkers.length > 0) {
      const candleForTime = (t: number): Candle | undefined => {
        for (let i = candles.length - 1; i >= 0; i--) {
          const c = candles[i];
          if (t >= c.time && t < c.time + candleMs) return c;
        }
        return undefined;
      };
      const bucketMarkers = new Map<number, { buy: boolean; sell: boolean }>();

      for (const m of tradeMarkers) {
        if (m.timeMs < minT - candleMs || m.timeMs > maxT + candleMs) continue;
        const c = candleForTime(m.timeMs);
        if (!c) continue;
        let slot = bucketMarkers.get(c.time);
        if (!slot) {
          slot = { buy: false, sell: false };
          bucketMarkers.set(c.time, slot);
        }
        if (m.side === 'BUY' && !slot.buy) slot.buy = true;
        else if (m.side === 'SELL' && !slot.sell) slot.sell = true;
      }

      const markerSize = 4;
      const markerGap = 3;
      const invertMarkerDirection = outcomeToggle?.value === 'NO';
      for (const [bucketOpen, slot] of bucketMarkers) {
        const c = candles.find((row) => row.time === bucketOpen);
        if (!c) continue;
        const cx = toX(bucketOpen + candleMs / 2);
        const highY = toY(c.h);
        const lowY = toY(c.l);

        if (slot.buy) {
          ctx.fillStyle = '#2563eb';
          if (invertMarkerDirection) {
            fillTradeMarkerTriangle(ctx, cx, highY - markerGap, markerSize, 'down');
          } else {
            fillTradeMarkerTriangle(ctx, cx, lowY + markerGap, markerSize, 'up');
          }
        }
        if (slot.sell) {
          ctx.fillStyle = '#facc15';
          if (invertMarkerDirection) {
            fillTradeMarkerTriangle(ctx, cx, lowY + markerGap, markerSize, 'up');
          } else {
            fillTradeMarkerTriangle(ctx, cx, highY - markerGap, markerSize, 'down');
          }
        }
      }
    }

    const lastPrice = candles[candles.length - 1].c;
    const lastY = toY(lastPrice);
    if (!hidePriceLines) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.moveTo(chartLeft, lastY);
      ctx.lineTo(chartRight, lastY);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Latest candle close (no horizontal line when hidePriceLines — label only)
    const labelY = Math.max(chartTop + 8, Math.min(chartBot - 8, lastY));
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(lastPrice.toFixed(1) + '¢', chartRight - 2, labelY);

    // --- Chainlink / Binance price overlay (mapped onto 0-100¢ Y-axis, target = 50¢) ---
    // X-axis is only [minT, maxT] (market window). Binance fetch keeps ~500 candles of history;
    // plotting all of them maps pre-window times to x << chartLeft, so the segment from the last
    // off-screen point to the first on-screen point draws a bogus diagonal across the chart.
    const clAll = Array.from(chainlinkCandleMapRef.current.values()).sort((a, b) => a.time - b.time);
    const clCandles = clAll.filter(
      (c) => c.time < maxT + candleMs && c.time + candleMs > minT
    );
    if (!hidePriceLines && clCandles.length > 0 && targetPrice && targetPrice > 0) {
      // Scale from deviation from target (include closes so spikes stay in range)
      let maxDev = 0;
      for (const c of clCandles) {
        maxDev = Math.max(
          maxDev,
          Math.abs(c.h - targetPrice),
          Math.abs(c.l - targetPrice),
          Math.abs(c.c - targetPrice)
        );
      }
      if (maxDev === 0) maxDev = targetPrice * 0.001;

      const clToCents = (p: number) => {
        const v = 50 + ((p - targetPrice) / maxDev) * 50;
        return Math.max(0, Math.min(100, v));
      };

      // Draw target price line (dashed, turquoise, at 50¢)
      const targetY = toY(50);
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0,210,210,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.moveTo(chartLeft, targetY);
      ctx.lineTo(chartRight, targetY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.strokeStyle = '#00d2d2';
      ctx.lineWidth = 1.5;
      if (clCandles.length === 1) {
        const c = clCandles[0];
        const cx = toX(c.time + candleMs / 2);
        const cy = toY(clToCents(c.c));
        ctx.beginPath();
        ctx.arc(cx, cy, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#00d2d2';
        ctx.fill();
      } else {
        ctx.beginPath();
        let started = false;
        for (const c of clCandles) {
          const cx = toX(c.time + candleMs / 2);
          const cy = toY(clToCents(c.c));
          if (!started) {
            ctx.moveTo(cx, cy);
            started = true;
          } else {
            ctx.lineTo(cx, cy);
          }
        }
        ctx.stroke();
      }

      const clLast = clCandles[clCandles.length - 1].c;
      const clLastCents = clToCents(clLast);
      const clLastY = toY(clLastCents);
      ctx.fillStyle = '#00d2d2';
      ctx.font = 'bold 8px monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('$' + clLast.toFixed(clLast > 100 ? 0 : 2), chartLeft + 2, clLastY - 6);
    }

    // Time labels — on top so volume overflow through band stays readable where not covered
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    const labelCount = 4;
    const fmtTime = (t: number) => {
      const d = new Date(t);
      const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
      if (interval === '5s') return `${hm}:${String(d.getSeconds()).padStart(2, '0')}`;
      return hm;
    };
    for (let i = 0; i <= labelCount; i++) {
      const t = minT + rangeT * (i / labelCount);
      ctx.fillText(fmtTime(t), toX(t), timeLabelY);
    }

    chartStateRef.current = {
      candles,
      chartLeft,
      chartRight,
      chartTop,
      chartBot,
      candleMs,
      candleW,
      minT,
      maxT,
      rangeT,
      W,
      toX,
      toY,
      bullColor,
      bearColor,
      dpr,
      interval,
    };
    baseImageRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    if (hoverMxRef.current != null) paintChartHover(hoverMxRef.current);
  }, [trades, isNo, ready, startTime, endTime, candleMs, wsTick, chainlinkReady, chainlinkTick, targetPrice, hidePriceLines, tradeMarkers, hideTrades, interval, outcomeToggle?.value, paintChartHover, obHeatmap, displayChartOrderLevels, sidebarChartPositionLevels]);

  useEffect(() => {
    if (!orderDrag) return;
    scheduleDraw(draw);
  }, [orderDrag, scheduleDraw, draw]);

  const orderDragRef = useRef(orderDrag);
  orderDragRef.current = orderDrag;

  const hitTestOrderHandle = useCallback((mx: number, my: number): ChartOrderLineLayout | null => {
    for (const L of orderLineLayoutRef.current) {
      if (
        mx >= L.handleX - L.handleW / 2 &&
        mx <= L.handleX + L.handleW / 2 &&
        my >= L.y - L.handleH / 2 &&
        my <= L.y + L.handleH / 2
      ) {
        return L;
      }
    }
    return null;
  }, []);

  const handleMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      if (!chartOrderDragEnabled) return;
      const rect = canvasRef.current?.getBoundingClientRect();
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
    },
    [chartOrderDragEnabled, hitTestOrderHandle, sidebarChartOrderLevels],
  );

  useEffect(() => {
    if (!orderDrag || !chartOrderDragEnabled) return;
    const onPointerMove = (e: PointerEvent) => {
      const canvas = canvasRef.current;
      const s = chartStateRef.current;
      if (!canvas || !s) return;
      const rect = canvas.getBoundingClientRect();
      const my = e.clientY - rect.top;
      const cents = snapChartCentsFromY(my, s.chartTop, s.chartBot);
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
  ]);

  useEffect(() => {
    setOrderDrag(null);
    orderDragLevelRef.current = null;
  }, [sidebarChartOrderLevels, tokenId]);

  const handleMouseMove = useCallback((e: ReactMouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    if (chartOrderDragEnabled && !orderDrag) {
      const onHandle = !!hitTestOrderHandle(mx, my);
      setOrderHandleHover(onHandle);
      if (onHandle) {
        hoverMxRef.current = null;
        setHoverOb(null);
        paintChartHover(null);
        return;
      }
    }
    if (orderDrag) {
      setHoverOb(null);
      return;
    }
    hoverMxRef.current = mx;
    paintChartHover(mx);

    if (!candleObHover) {
      setHoverOb(null);
      return;
    }
    const s = chartStateRef.current;
    if (!s || mx < s.chartLeft || mx > s.W) {
      setHoverOb(null);
      return;
    }
    const nearest = pickHoverCandle(s, mx);
    const hasPolyOb =
      nearest?.ob != null && (nearest.ob.bids.length > 0 || nearest.ob.asks.length > 0);
    const hasCexOb = nearest?.cexOb != null;
    const hasGex = nearest?.gex != null;
    if (!hasPolyOb && !hasCexOb && !hasGex) {
      setHoverOb(null);
      return;
    }
    setHoverOb({
      clientX: e.clientX,
      clientY: e.clientY,
      ...(hasPolyOb ? { ob: nearest!.ob } : {}),
      ...(hasCexOb ? { cexOb: nearest!.cexOb } : {}),
      ...(hasGex ? { gex: nearest!.gex } : {}),
      ohlcv: { o: nearest!.o, h: nearest!.h, l: nearest!.l, c: nearest!.c, v: nearest!.v },
      enrichment: nearest!.enrichment,
    });
  }, [paintChartHover, pickHoverCandle, candleObHover, chartOrderDragEnabled, orderDrag, hitTestOrderHandle]);

  const handleMouseLeave = useCallback(() => {
    hoverMxRef.current = null;
    setHoverOb(null);
    setOrderHandleHover(false);
    paintChartHover(null);
  }, [paintChartHover]);

  const chartCanvasCursor = orderDrag ? 'grabbing' : orderHandleHover ? 'ns-resize' : 'crosshair';

  useEffect(() => {
    if (!volumeSpikeAlerts) {
      lastVolumeSpikeBarRef.current = null;
      setVolumeSpikeFlashSide(null);
    }
  }, [volumeSpikeAlerts]);

  useEffect(() => {
    lastVolumeSpikeBarRef.current = null;
    setVolumeSpikeFlashSide(null);
    setHoverOb(null);
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
    const candles = [...candleMapRef.current.values()].sort((a, b) => a.time - b.time);
    const spike = detectChartVolumeSpike(candles, candleMs, trades);
    if (!spike) return;
    if (lastVolumeSpikeBarRef.current === spike.barTime) return;
    lastVolumeSpikeBarRef.current = spike.barTime;

    const gen = volumeSpikeFlashGenRef.current + 1;
    volumeSpikeFlashGenRef.current = gen;
    setVolumeSpikeFlashSide(spike.side);
    const endMs = endTime != null && Number.isFinite(endTime) ? endTime : null;
    if (endMs == null || endMs > Date.now()) {
      if (candles.length >= MIN_CHART_CANDLES_FOR_VOLUME_SPIKE_SOUND) {
        void playChartVolumeSpikeRing(soundMuteYesTokenId, soundMuteNoTokenId);
      }
    }

    const t = window.setTimeout(() => {
      if (volumeSpikeFlashGenRef.current === gen) setVolumeSpikeFlashSide(null);
    }, CHART_VOLUME_SPIKE_FLASH_MS);
    return () => clearTimeout(t);
  }, [volumeSpikeAlerts, ready, wsTick, trades, tokenId, interval, candleMs, endTime, soundMuteYesTokenId, soundMuteNoTokenId]);

  useEffect(() => {
    scheduleDraw(draw);
    return () => {
      if (drawRafRef.current != null) {
        cancelAnimationFrame(drawRafRef.current);
        drawRafRef.current = null;
      }
    };
  }, [draw, scheduleDraw]);

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
              >{iv}</button>
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
      <div className="relative rounded-[6px]">
        <canvas
          ref={canvasRef}
          style={{
            width: '100%',
            height: 110,
            borderRadius: 6,
            background: '#1a1a2e',
            display: 'block',
            cursor: chartCanvasCursor,
          }}
          onMouseDown={chartOrderDragEnabled ? handleMouseDown : undefined}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
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
                  width: 320,
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
                      <ChartObHoverOhlcvStrip ohlcv={hoverOb.ohlcv} />
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
                      {hoverOb.gex ? <ChartGexHoverGrid gex={hoverOb.gex} /> : null}
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
