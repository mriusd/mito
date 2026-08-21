import { useEffect, useRef, useState } from 'react';
import { API_BASE } from '../lib/env';
import { fetchBackend } from '../lib/fetchBackend';
import { subscribeChartKline } from '../lib/chartWsShared';
import { resolveLiveTradeChartWindow } from '../lib/walletInfoChartMarket';
import { parseCandleOb, type CandleObSnapshot } from '../lib/candleObSnapshot';
import { parseCexObSnapshot, type CexObCandleSnapshot } from '../lib/cexObSnapshot';
import { parseCvdCandleSnapshot, type CvdCandleSnapshot } from '../lib/cvdCandleSnapshot';
import { parseOppCandleSnapshot, type OppCandleSnapshot } from '../lib/oppCandleSnapshot';
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
  /** Polymarket trade CVD for this outcome token (up/down crypto candles). */
  cvd?: CvdCandleSnapshot;
  /** Full ask-side redeem edge (opp$) for YES and NO legs. */
  opp?: OppCandleSnapshot;
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
    let opp = first.opp;
    // Sum per-bucket CVD across hours (do not take last only).
    let buyUsd = 0;
    let sellUsd = 0;
    let tradeCount = 0;
    let lastCvd = first.cvd;
    let hasCvd = false;
    for (const p of parts) {
      if (p.h > h) h = p.h;
      if (p.l < l) l = p.l;
      v += p.v || 0;
      if (p.ob) ob = p.ob;
      if (p.cexOb) cexOb = p.cexOb;
      if (p.gex) gex = p.gex;
      if (p.gexBinance) gexBinance = p.gexBinance;
      if (p.gexOkx) gexOkx = p.gexOkx;
      if (p.cvd) {
        hasCvd = true;
        lastCvd = p.cvd;
        buyUsd += p.cvd.buyUsd || 0;
        sellUsd += p.cvd.sellUsd || 0;
        tradeCount += p.cvd.tradeCount || 0;
      }
      if (p.opp) opp = p.opp;
      if (p.enrichment) enrichment = p.enrichment;
      if (p.weather) weather = p.weather;
    }
    const cvd = hasCvd
      ? {
          source: lastCvd?.source,
          asset: lastCvd?.asset,
          tokenId: lastCvd?.tokenId,
          updatedAt: lastCvd?.updatedAt ?? 0,
          bucketMs: bucketMs,
          buyUsd,
          sellUsd,
          deltaUsd: buyUsd - sellUsd,
          cumDeltaUsd: lastCvd?.cumDeltaUsd ?? buyUsd - sellUsd,
          tradeCount,
        }
      : undefined;
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
      ...(cvd ? { cvd } : {}),
      ...(opp ? { opp } : {}),
      ...(weather ? { weather } : {}),
      ...(enrichment ? { enrichment } : {}),
    });
  }
  return out;
}

function pruneCandleMap(map: Map<number, LiveTradeCandle>, startMs: number, endMs: number, padMs: number) {
  if (map.size === 0) return;
  const lo = startMs - padMs;
  const hi = endMs + padMs;
  const victims: number[] = [];
  for (const t of map.keys()) {
    if (t < lo || t > hi) victims.push(t);
  }
  // Never wipe a successful history load because the window was slightly wrong
  // (older wallet markets: endDate/lastTradeTime off by hours/days).
  if (victims.length < map.size) {
    for (const t of victims) map.delete(t);
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
  /**
   * When true, after slim OHLCV load, pull a short non-slim window so candle hover
   * gets CEX OB / poly OB / GEX (slim=1 strips those blobs).
   */
  includeCandleEnrichment?: boolean;
};

export function useLiveTradeCandles({
  tokenId,
  isNo,
  startTime,
  endTime,
  interval,
  candleMs,
  includeCandleEnrichment = false,
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
    const nowMs = Date.now();
    // Market ended in the past (wallet-info older rows): anchor fetch/prune on *expiry*,
    // not "now". Expanding end→now + lookback from now wipes all historical bars
    // (latest market still works; older markets show "Waiting for data…").
    const marketEnded = Number.isFinite(et) && et < nowMs - 60_000;

    if (marketEnded) {
      const histMs = needsExpandedHistory
        ? (minHist ?? ONE_H_FEED_LOOKBACK_MS)
        : 7 * 24 * 60 * 60 * 1000;
      // Pad after expiry so the last settling bars survive prune.
      const endPad = Math.max(feedCandleMs * 8, 2 * 60 * 60 * 1000);
      const endAnchor = et;
      st = Math.min(st, endAnchor - histMs);
      // Keep start ≤ end; widen short updown windows (end−15m) so history has room.
      if (endAnchor - st < Math.min(histMs, 24 * 60 * 60 * 1000)) {
        st = endAnchor - Math.min(histMs, 7 * 24 * 60 * 60 * 1000);
      }
      et = endAnchor + endPad;
    } else {
      // Live / not-yet-ended: allow "now" on the end so WS tail is not pruned.
      const endForFetch = Math.max(et, nowMs);
      if (needsExpandedHistory) {
        const histMs = minHist ?? ONE_H_FEED_LOOKBACK_MS;
        // Recent lookback only — server ASC LIMIT returns oldest slice of a huge window.
        st = endForFetch - histMs;
      } else {
        const minLookback = 48 * 60 * 60 * 1000;
        if (endForFetch - st < minLookback) st = endForFetch - minLookback;
      }
      et = endForFetch;
    }

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
        // non-slim index 21 = cvd JSON; 30 = opp$ (see polycandles writeBinanceKlines)
        const cvd = parseCvdCandleSnapshot(k[21]) ?? prev?.cvd;
        const gexBinance = parseGexAssetSnapshot(k[22]) ?? prev?.gexBinance;
        const gexOkx = parseGexAssetSnapshot(k[23]) ?? prev?.gexOkx;
        // REST row is authoritative — never inherit weather from a prior map entry.
        const weather = parseCandleWeather(k[24]);
        const enrichment = mergeCandleBsEnrichment(parseHttpKlineEnrichment(k), prev?.enrichment);
        // Per-bucket opp$ only — do not inherit from another candle's time.
        const opp = parseOppCandleSnapshot(k[30]) ?? undefined;
        map.set(openTime, {
          time: openTime,
          o,
          h: hi,
          l: lo,
          c,
          v,
          // Do not inherit prev.ob / prev.opp — each candle keeps its own book snapshot.
          ...(ob ? { ob } : {}),
          ...(cexOb ? { cexOb } : {}),
          ...(gex ? { gex } : {}),
          ...(cvd ? { cvd } : {}),
          ...(opp ? { opp } : {}),
          ...(gexBinance ? { gexBinance } : {}),
          ...(gexOkx ? { gexOkx } : {}),
          ...(weather ? { weather } : {}),
          ...(enrichment ? { enrichment } : {}),
        });
      }
      // Keep enough 1h bars to cover 4h/1d display window (pad by target bucket).
      pruneCandleMap(map, st, et, Math.max(feedCandleMs, displayBucketMs) * 2);
    };

    // slim=1: OHLCV only (no gex/weather/cex blobs). Full enrich on the whole window
    // was multi‑MB and CF 502'd. We optionally backfill a short non-slim window after.
    const klineLimit = from1h || interval === '1h' ? 500 : 200;
    const baseQ =
      `symbol=${encodeURIComponent(tokenId)}&interval=${encodeURIComponent(feedInterval)}` +
      `&limit=${klineLimit}&slim=1`;
    const windowedQuery = `${baseQ}&startTime=${st}&endTime=${et}`;
    // Recent bars only — enough for hover CEX OB / poly OB without huge payloads.
    const ENRICH_LIMIT = 80;
    const enrichQ =
      `symbol=${encodeURIComponent(tokenId)}&interval=${encodeURIComponent(feedInterval)}` +
      `&limit=${ENRICH_LIMIT}&startTime=${st}&endTime=${et}`;

    /** Carry last-known CEX GEX + BS enrichment forward so math line / CEX hover work on
     * OHLCV-only bars. Do NOT forward-fill poly OB or opp$ — those are per-bucket book
     * snapshots; copying them made every 5s candle show the same imbalance / opp$. */
    const forwardFillEnrichment = () => {
      const map = candleMapRef.current;
      if (map.size === 0) return;
      const times = [...map.keys()].sort((a, b) => a - b);
      let lastCex = undefined as LiveTradeCandle['cexOb'];
      let lastGex = undefined as LiveTradeCandle['gex'];
      let lastGexBinance = undefined as LiveTradeCandle['gexBinance'];
      let lastGexOkx = undefined as LiveTradeCandle['gexOkx'];
      let lastEnrichment = undefined as LiveTradeCandle['enrichment'];
      for (const t of times) {
        const row = map.get(t)!;
        if (row.cexOb) lastCex = row.cexOb;
        if (row.gex) lastGex = row.gex;
        if (row.gexBinance) lastGexBinance = row.gexBinance;
        if (row.gexOkx) lastGexOkx = row.gexOkx;
        // Do not forward-fill CVD / poly OB / opp$ — per-bucket snapshots.
        // Merge so partial ticks (spot only) keep prior bsProb for the math line.
        const mergedEnrich = mergeCandleBsEnrichment(row.enrichment, lastEnrichment);
        if (mergedEnrich) lastEnrichment = mergedEnrich;
        map.set(t, {
          ...row,
          ...(row.cexOb ? {} : lastCex ? { cexOb: lastCex } : {}),
          ...(row.gex ? {} : lastGex ? { gex: lastGex } : {}),
          ...(row.gexBinance ? {} : lastGexBinance ? { gexBinance: lastGexBinance } : {}),
          ...(row.gexOkx ? {} : lastGexOkx ? { gexOkx: lastGexOkx } : {}),
          ...(mergedEnrich ? { enrichment: mergedEnrich } : {}),
        });
      }
    };

    const loadKlines = async () => {
      /**
       * Soft + staged: never stampede origin (concurrent klines → CF 502 → whole app flaky).
       * Retry each URL once — browser HTTP2/CORS blips often fail the first attempt only.
       */
      const LIVE_MS = 12_000;
      const HIST_MS = 15_000;

      const ingest = (rows: unknown) => {
        if (cancelled || rows == null) return false;
        // Server may return a bare array or `{ klines: [...] }`.
        const list = Array.isArray(rows)
          ? rows
          : typeof rows === 'object' && Array.isArray((rows as { klines?: unknown }).klines)
            ? (rows as { klines: unknown[] }).klines
            : null;
        if (!list || list.length === 0) return false;
        applyKlines(list as any[][]);
        publish(true);
        return true;
      };

      const fetchJson = async (url: string, timeoutMs: number): Promise<unknown> => {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const r = await fetchBackend(url, undefined, { timeoutMs, soft: true });
            if (!r.ok) {
              if (attempt === 0) await new Promise((res) => setTimeout(res, 300 + attempt * 400));
              continue;
            }
            return await r.json();
          } catch {
            if (attempt === 0) await new Promise((res) => setTimeout(res, 300 + attempt * 400));
          }
        }
        return null;
      };

      try {
        // Expired markets: history windowed on market end first (live limit is empty).
        // Live markets: windowed live, then limit-only, then history.
        if (marketEnded) {
          let got = await fetchJson(
            `${API_BASE}/api/v3/klines/history?${windowedQuery}`,
            HIST_MS,
          ).then(ingest);
          if (cancelled) return;
          if (!got) {
            got = await fetchJson(`${API_BASE}/api/v3/klines?${windowedQuery}`, LIVE_MS).then(ingest);
          }
          if (cancelled) return;
          // Unwindowed history last — some tokens only resolve via limit DESC on history.
          if (!got || candleMapRef.current.size < 3) {
            await fetchJson(`${API_BASE}/api/v3/klines/history?${baseQ}`, HIST_MS).then(ingest);
          }
        } else {
          let got = await fetchJson(`${API_BASE}/api/v3/klines?${windowedQuery}`, LIVE_MS).then(ingest);
          if (cancelled) return;
          if (!got) {
            got = await fetchJson(`${API_BASE}/api/v3/klines?${baseQ}`, LIVE_MS).then(ingest);
          }
          if (cancelled) return;
          if (!got || candleMapRef.current.size < 5) {
            got =
              (await fetchJson(
                `${API_BASE}/api/v3/klines/history?${windowedQuery}`,
                HIST_MS,
              ).then(ingest)) || got;
          }
          if (cancelled) return;
          if (!got || candleMapRef.current.size < 5) {
            await fetchJson(`${API_BASE}/api/v3/klines/history?${baseQ}`, HIST_MS).then(ingest);
          }
        }

        // Backfill CEX OB / poly OB / GEX for hover (heavy JSON; slim already has BS scalars).
        if (includeCandleEnrichment && candleMapRef.current.size > 0) {
          if (cancelled) return;
          let enriched = await fetchJson(
            `${API_BASE}/api/v3/klines/history?${enrichQ}`,
            HIST_MS,
          ).then(ingest);
          if (cancelled) return;
          if (!enriched) {
            enriched = await fetchJson(`${API_BASE}/api/v3/klines?${enrichQ}`, LIVE_MS).then(ingest);
          }
          if (cancelled) return;
        }
        // Always forward-fill BS math across bars so the yellow math line stays continuous
        // (including expired markets where live recompute stops after T≤0).
        if (candleMapRef.current.size > 0) {
          forwardFillEnrichment();
          publish(true);
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
      // Poly OB + opp$: prefer this tick's payload; keep prior only for the *same* open
      // bucket when the WS tick omitted the field (partial enrich). Never copy across times.
      const parsedOb = parseCandleOb(k.ob);
      const ob = parsedOb ?? (prev && prev.time === openTime ? prev.ob : undefined);
      const cexOb = parseCexObSnapshot(k.cex_ob) ?? prev?.cexOb;
      const gex = parseGexAssetSnapshot(k.gex) ?? prev?.gex;
      const gexBinance = parseGexAssetSnapshot(k.gex_binance) ?? prev?.gexBinance;
      const gexOkx = parseGexAssetSnapshot(k.gex_okx) ?? prev?.gexOkx;
      const cvd = parseCvdCandleSnapshot(k.cvd) ?? prev?.cvd;
      const parsedOpp = parseOppCandleSnapshot(k.opp);
      const opp =
        parsedOpp ??
        (prev && prev.time === openTime ? prev.opp : undefined);
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
        ...(cvd ? { cvd } : {}),
        ...(opp ? { opp } : {}),
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
          // Snapshot only: fill gaps across history. Per-tick forward-fill was
          // rewriting every bar and could pin transient live BS spikes onto neighbors.
          forwardFillEnrichment();
          publish(true);
          scheduleWsTick();
          return;
        }
        if (msg.type === 'klineStreamUpdate') {
          const k = msg.data?.data?.k;
          if (!k) return;
          applyWsKline(k as Record<string, unknown>);
          // Open-bucket tick: only backfill missing fields on *this* bar from the prior bar.
          // Do not re-walk the whole series (avoids spreading a live BS glitch).
          {
            const openTime = (k as { t?: number }).t;
            if (typeof openTime === 'number' && openTime > 0) {
              const map = candleMapRef.current;
              const row = map.get(openTime);
              if (row) {
                let prevEnrich = row.enrichment;
                const times = [...map.keys()].sort((a, b) => a - b);
                const idx = times.indexOf(openTime);
                if (idx > 0) {
                  prevEnrich = map.get(times[idx - 1]!)?.enrichment ?? prevEnrich;
                }
                const merged = mergeCandleBsEnrichment(row.enrichment, prevEnrich);
                if (merged) {
                  map.set(openTime, { ...row, enrichment: merged });
                }
              }
            }
          }
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
  }, [tokenId, isNo, startTime, endTime, interval, candleMs, includeCandleEnrichment]);

  return { candles, candlesRef, ready, wsTick, candleMapRef };
}
