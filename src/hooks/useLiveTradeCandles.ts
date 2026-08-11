import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../lib/env';
import { fetchBackend } from '../lib/fetchBackend';
import { subscribeChartKline } from '../lib/chartWsShared';
import { resolveLiveTradeChartWindow } from '../lib/walletInfoChartMarket';
import { parseCandleOb, type CandleObSnapshot } from '../lib/candleObSnapshot';
import { parseCexObSnapshot, type CexObCandleSnapshot } from '../lib/cexObSnapshot';
import { parseGexAssetSnapshot, type GexAssetSnapshot } from '../lib/deribitGexFeed';
import {
  mergeCandleBsEnrichment,
  parseCandleBsEnrichment,
  parseHttpKlineEnrichment,
  type CandleBsEnrichment,
} from '../lib/chartCandleEnrichment';
import { parseCandleWeather, type CandleWeatherSnapshot } from '../lib/candleWeatherSnapshot';

const MAX_CHART_CANDLES = 2500;
const ONE_HOUR_MS = 3_600_000;
/** Server clamps kline limit to 1500; size the 1h lookback so ASC LIMIT returns the *recent* window. */
const KLINE_FETCH_LIMIT = 1500;
/** ~62d of 1h bars — matches server limit and guarantees ≥7d when data exists. */
const ONE_H_FEED_LOOKBACK_MS = KLINE_FETCH_LIMIT * ONE_HOUR_MS;

/** Higher TFs built client-side from 1h klines (backend may not serve 4h/1d for outcome tokens). */
const AGGREGATE_FROM_1H = new Set(['4h', '1d']);

/**
 * Market startTime is often only the current window (5m/15m/4h) — that yields a handful of
 * 1h bars. Live `/klines` is also frequently empty for 1h (history has the series).
 *
 * Expand lookback for 1h/4h/1d. Cap at ~1500×1h so history `ORDER BY time ASC LIMIT`
 * returns the *newest* stretch (a wider 180d window used to return only the oldest 1500
 * hours — 1d still charted, while 1h with a short 7d window showed 0 bars).
 */
const MIN_HISTORY_MS: Record<string, number> = {
  '1h': ONE_H_FEED_LOOKBACK_MS,
  '4h': ONE_H_FEED_LOOKBACK_MS,
  '1d': ONE_H_FEED_LOOKBACK_MS,
};

export type LiveTradeCandle = {
  time: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  ob?: CandleObSnapshot;
  cexOb?: CexObCandleSnapshot;
  gex?: GexAssetSnapshot;
  gexBinance?: GexAssetSnapshot;
  gexOkx?: GexAssetSnapshot;
  enrichment?: CandleBsEnrichment;
  weather?: CandleWeatherSnapshot;
};

function toPrice(raw: number, isNo: boolean): number {
  return isNo ? 100 - raw : raw;
}

function bucketOpenTime(timeMs: number, bucketMs: number): number {
  return Math.floor(timeMs / bucketMs) * bucketMs;
}

/**
 * Collapse 1h OHLC into coarser buckets (4h / 1d).
 * Open = first hour open, close = last hour close, H/L extremes, volume sum.
 * Snapshots (ob / weather / enrichment) prefer the latest hour that has them.
 */
export function aggregateHourlyCandles(
  hourly: LiveTradeCandle[],
  bucketMs: number,
): LiveTradeCandle[] {
  if (bucketMs <= ONE_HOUR_MS || hourly.length === 0) return hourly;
  const groups = new Map<number, LiveTradeCandle[]>();
  for (const c of hourly) {
    const t = bucketOpenTime(c.time, bucketMs);
    let g = groups.get(t);
    if (!g) {
      g = [];
      groups.set(t, g);
    }
    g.push(c);
  }
  const out: LiveTradeCandle[] = [];
  const keys = [...groups.keys()].sort((a, b) => a - b);
  for (const t of keys) {
    const parts = groups.get(t)!;
    parts.sort((a, b) => a.time - b.time);
    const first = parts[0]!;
    const last = parts[parts.length - 1]!;
    let h = first.h;
    let l = first.l;
    let v = 0;
    let ob = first.ob;
    let cexOb = first.cexOb;
    let gex = first.gex;
    let gexBinance = first.gexBinance;
    let gexOkx = first.gexOkx;
    let enrichment = first.enrichment;
    let weather = first.weather;
    for (const p of parts) {
      if (p.h > h) h = p.h;
      if (p.l < l) l = p.l;
      v += p.v || 0;
      if (p.ob) ob = p.ob;
      if (p.cexOb) cexOb = p.cexOb;
      if (p.gex) gex = p.gex;
      if (p.gexBinance) gexBinance = p.gexBinance;
      if (p.gexOkx) gexOkx = p.gexOkx;
      if (p.enrichment) enrichment = p.enrichment;
      if (p.weather) weather = p.weather;
    }
    out.push({
      time: t,
      o: first.o,
      h,
      l,
      c: last.c,
      v,
      ...(ob ? { ob } : {}),
      ...(cexOb ? { cexOb } : {}),
      ...(gex ? { gex } : {}),
      ...(gexBinance ? { gexBinance } : {}),
      ...(gexOkx ? { gexOkx } : {}),
      ...(weather ? { weather } : {}),
      ...(enrichment ? { enrichment } : {}),
    });
  }
  return out;
}

function pruneCandleMap(map: Map<number, LiveTradeCandle>, startMs: number, endMs: number, padMs: number) {
  const lo = startMs - padMs;
  const hi = endMs + padMs;
  for (const t of map.keys()) {
    if (t < lo || t > hi) map.delete(t);
  }
  if (map.size <= MAX_CHART_CANDLES) return;
  const sorted = [...map.keys()].sort((a, b) => a - b);
  for (const t of sorted.slice(0, sorted.length - MAX_CHART_CANDLES)) map.delete(t);
}

export type UseLiveTradeCandlesArgs = {
  tokenId?: string;
  isNo: boolean;
  startTime?: number;
  endTime?: number;
  interval: string;
  candleMs: number;
};

export function useLiveTradeCandles({
  tokenId,
  isNo,
  startTime,
  endTime,
  interval,
  candleMs,
}: UseLiveTradeCandlesArgs) {
  const candleMapRef = useRef<Map<number, LiveTradeCandle>>(new Map());
  const candlesRef = useRef<LiveTradeCandle[]>([]);
  const [ready, setReady] = useState(false);
  const [wsTick, setWsTick] = useState(0);
  const [candles, setCandles] = useState<LiveTradeCandle[]>([]);
  const wsTickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleWsTick = () => {
    if (wsTickTimerRef.current != null) return;
    wsTickTimerRef.current = setTimeout(() => {
      wsTickTimerRef.current = null;
      setWsTick((n) => n + 1);
    }, 250);
  };

  useEffect(() => {
    candleMapRef.current = new Map();
    candlesRef.current = [];
    setReady(false);
    setCandles([]);

    if (!tokenId) return;

    let cancelled = false;
    let publishTimer: ReturnType<typeof setTimeout> | null = null;

    // 4h / 1d: pull 1h stream and aggregate client-side.
    const from1h = AGGREGATE_FROM_1H.has(interval);
    const feedInterval = from1h ? '1h' : interval;
    const feedCandleMs = from1h ? ONE_HOUR_MS : candleMs;
    const displayBucketMs = from1h ? candleMs : feedCandleMs;
    const minHist = MIN_HISTORY_MS[interval];
    // Expand + history-first for long TFs — live `/klines` is often empty for 1h resolution.
    const needsExpandedHistory = minHist != null || from1h;

    const baseWin = resolveLiveTradeChartWindow(tokenId, startTime, endTime);
    let st = baseWin.startMs;
    let et = baseWin.endMs;
    // Always allow "now" on the fetch/prune end so live tail + WS are not wiped for ended markets.
    const endForFetch = Math.max(et, Date.now());
    if (needsExpandedHistory) {
      const histMs = minHist ?? ONE_H_FEED_LOOKBACK_MS;
      // Recent lookback only — do not open a wider range than histMs: server
      // `ORDER BY time ASC LIMIT 1500` would return the *oldest* slice of a huge window.
      st = endForFetch - histMs;
    }
    et = endForFetch;

    const publishNow = () => {
      if (cancelled) return;
      let sorted = Array.from(candleMapRef.current.values()).sort((a, b) => a.time - b.time);
      if (from1h) {
        sorted = aggregateHourlyCandles(sorted, displayBucketMs);
      }
      // Weather series: forward-fill bars/forecast; drop historical vol=0 flat stubs.
      const weatherSeries = sorted.some((c) => c.weather != null);
      if (weatherSeries) {
        let lastWx: CandleWeatherSnapshot | undefined;
        const lastT = sorted[sorted.length - 1]?.time ?? -1;
        const next: LiveTradeCandle[] = [];
        for (const c of sorted) {
          let row = c;
          if (c.weather) lastWx = c.weather;
          else if (lastWx) row = { ...c, weather: lastWx };
          const flatEmpty = row.v <= 0 && row.o === row.h && row.h === row.l && row.l === row.c;
          if (flatEmpty && row.time !== lastT) continue;
          next.push(row);
        }
        sorted = next;
      }

      const prev = candlesRef.current;
      candlesRef.current = sorted;
      // Structural = axis length/window changed. Last-bar OHLC churn stays ref-only + wsTick.
      const structural =
        prev.length !== sorted.length ||
        prev[0]?.time !== sorted[0]?.time ||
        prev[prev.length - 1]?.time !== sorted[sorted.length - 1]?.time;
      if (structural) setCandles(sorted);
      scheduleWsTick();
    };

    const publish = (immediate = false) => {
      if (immediate) {
        if (publishTimer != null) {
          clearTimeout(publishTimer);
          publishTimer = null;
        }
        publishNow();
        return;
      }
      if (publishTimer != null) return;
      publishTimer = setTimeout(() => {
        publishTimer = null;
        publishNow();
      }, 250);
    };

    const applyKlines = (klines: any[][]) => {
      if (!Array.isArray(klines)) return;
      const map = candleMapRef.current;
      for (const k of klines) {
        const openTime = Number(k[0]);
        if (!Number.isFinite(openTime) || openTime <= 0) continue;
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
        const gexBinance = parseGexAssetSnapshot(k[22]) ?? prev?.gexBinance;
        const gexOkx = parseGexAssetSnapshot(k[23]) ?? prev?.gexOkx;
        // REST row is authoritative — never inherit weather from a prior map entry.
        const weather = parseCandleWeather(k[24]);
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
          ...(gexBinance ? { gexBinance } : {}),
          ...(gexOkx ? { gexOkx } : {}),
          ...(weather ? { weather } : {}),
          ...(enrichment ? { enrichment } : {}),
        });
      }
      // Keep enough 1h bars to cover 4h/1d display window (pad by target bucket).
      pruneCandleMap(map, st, et, Math.max(feedCandleMs, displayBucketMs) * 2);
    };

    // Cap fetches: full 900–1500 history rows are multi‑MB and trip HTTP/2/CORS under load
    // when 4 parallel requests fire on every market switch (www.mito.trade → data.mito.trade).
    const klineLimit = from1h || interval === '1h' ? KLINE_FETCH_LIMIT : 400;
    const baseQ = `symbol=${encodeURIComponent(tokenId)}&interval=${encodeURIComponent(feedInterval)}&limit=${klineLimit}`;
    const windowedQuery = `${baseQ}&startTime=${st}&endTime=${et}`;

    const loadKlines = async () => {
      /**
       * Soft fetches: kline failures must not open the global backend circuit
       * (that made weather/temp-odds die after a few HTTP2 blips).
       *
       * Staged load (not 4-way parallel stampede):
       *  1) live limit-only (mem cache, small)
       *  2) live windowed if still empty
       *  3) history only as backfill if still sparse — WS snapshot can still fill gaps
       */
      const LIVE_MS = 4_000;
      const HIST_MS = 5_000;

      const ingest = (rows: unknown) => {
        if (cancelled || !Array.isArray(rows) || rows.length === 0) return false;
        applyKlines(rows as any[][]);
        publish(true);
        return true;
      };

      const fetchJson = (url: string, timeoutMs: number) =>
        fetchBackend(url, undefined, { timeoutMs, soft: true })
          .then((r) => {
            if (!r.ok) return null;
            return r.json();
          })
          .catch(() => null);

      try {
        // 1) Fast path — recent live bars only.
        let got = await fetchJson(`${API_BASE}/api/v3/klines?${baseQ}`, LIVE_MS).then(ingest);
        if (cancelled) return;

        // 2) Windowed live if the tail was empty (new token / cold mem).
        if (!got) {
          got = await fetchJson(`${API_BASE}/api/v3/klines?${windowedQuery}`, LIVE_MS).then(ingest);
        }
        if (cancelled) return;

        // 3) History backfill only when we still have little data (avoid 2MB×N storms).
        const needHistory = candleMapRef.current.size < Math.min(80, Math.floor(klineLimit / 4));
        if (needHistory) {
          await fetchJson(`${API_BASE}/api/v3/klines/history?${baseQ}`, HIST_MS).then(ingest);
          if (cancelled) return;
          if (candleMapRef.current.size < 20) {
            await fetchJson(`${API_BASE}/api/v3/klines/history?${windowedQuery}`, HIST_MS).then(ingest);
          }
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    };

    void loadKlines();

    const applyWsKline = (k: Record<string, unknown>, opts?: { replaceWeather?: boolean }) => {
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
      const gexBinance = parseGexAssetSnapshot(k.gex_binance) ?? prev?.gexBinance;
      const gexOkx = parseGexAssetSnapshot(k.gex_okx) ?? prev?.gexOkx;
      const parsedWeather = parseCandleWeather(k.weather);
      // Snapshot: trust payload only (omit = no weather). Update: keep prior if field absent.
      const weather = opts?.replaceWeather ? parsedWeather : parsedWeather ?? prev?.weather;
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
        ...(gexBinance ? { gexBinance } : {}),
        ...(gexOkx ? { gexOkx } : {}),
        ...(weather ? { weather } : {}),
        ...(enrichment ? { enrichment } : {}),
      });
      pruneCandleMap(candleMapRef.current, st, et, Math.max(feedCandleMs, displayBucketMs) * 2);
    };

    const unsub = subscribeChartKline(tokenId, feedInterval, {
      onMessage: (msg) => {
        if (msg.type === 'klineStreamSnapshot') {
          const klines = msg.data?.klines;
          if (!Array.isArray(klines)) return;
          for (const k of klines) {
            if (k && typeof k === 'object') {
              applyWsKline(k as Record<string, unknown>, { replaceWeather: true });
            }
          }
          publish(true);
          scheduleWsTick();
          return;
        }
        if (msg.type === 'klineStreamUpdate') {
          const k = msg.data?.data?.k;
          if (!k) return;
          applyWsKline(k as Record<string, unknown>);
          publish();
          scheduleWsTick();
        } else if (msg.type === 'klineStreamDelete') {
          const tRaw = msg.data?.data?.t;
          const t = typeof tRaw === 'number' ? tRaw : Number(tRaw);
          if (Number.isFinite(t) && t > 0) {
            candleMapRef.current.delete(t);
            publish();
            scheduleWsTick();
          }
        }
      },
      onReconnect: () => {
        void loadKlines().then(() => {
          if (!cancelled) scheduleWsTick();
        });
      },
    });

    const onVisibility = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      void loadKlines().then(() => {
        if (!cancelled) scheduleWsTick();
      });
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (wsTickTimerRef.current != null) {
        clearTimeout(wsTickTimerRef.current);
        wsTickTimerRef.current = null;
      }
      if (publishTimer != null) clearTimeout(publishTimer);
      unsub();
    };
  }, [tokenId, isNo, startTime, endTime, interval, candleMs]);

  return { candles, candlesRef, ready, wsTick, candleMapRef };
}
