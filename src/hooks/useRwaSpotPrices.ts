import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import type { AssetSymbol } from '../types';

const HERMES = 'https://hermes.pyth.network';
const PYTH_POLL_MS = 5_000;
const FEED_DISCOVER_MS = 15 * 60_000;

/** Fixed Hermes feed ids (Equity.US.*.USD + WTI spot CFD). */
const FIXED_FEEDS: { symbol: AssetSymbol; feedId: string }[] = [
  { symbol: 'WTIUSDT', feedId: '925ca92ff005ae943c158e3563f59698ce7e75c5a8c8dd43303a0a154887b3e6' }, // Commodities.USOILSPOT
  { symbol: 'SPYUSDT', feedId: '19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5' },
  { symbol: 'AAPLUSDT', feedId: '49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688' },
  { symbol: 'GOOGLUSDT', feedId: '5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6' },
  { symbol: 'NVDAUSDT', feedId: 'b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593' },
  { symbol: 'AMZNUSDT', feedId: 'b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a' },
];

type ParsedPrice = {
  id?: string;
  price?: { price?: string; expo?: number; publish_time?: number };
};

function normId(id: string): string {
  return id.replace(/^0x/i, '').toLowerCase();
}

function parsePythPrice(raw: ParsedPrice['price']): { px: number; pub: number } | null {
  if (!raw?.price) return null;
  const price = Number(raw.price);
  const expo = Number(raw.expo);
  if (!Number.isFinite(price) || !Number.isFinite(expo)) return null;
  const px = price * 10 ** expo;
  if (!Number.isFinite(px) || px <= 0) return null;
  const pub = Number(raw.publish_time) || 0;
  return { px, pub };
}

async function fetchLatestParsed(feedIds: string[]): Promise<ParsedPrice[]> {
  const out: ParsedPrice[] = [];
  for (let i = 0; i < feedIds.length; i += 30) {
    const chunk = feedIds.slice(i, i + 30);
    const qs = chunk.map((id) => `ids[]=${id}`).join('&');
    const resp = await fetch(`${HERMES}/v2/updates/price/latest?${qs}`);
    if (!resp.ok) throw new Error(`pyth hermes ${resp.status}`);
    const data = (await resp.json()) as { parsed?: ParsedPrice[] };
    out.push(...(data.parsed || []));
  }
  return out;
}

async function discoverCommodityFeedIds(prefix: string): Promise<string[]> {
  const resp = await fetch(`${HERMES}/v2/price_feeds?query=${encodeURIComponent(prefix)}`);
  if (!resp.ok) throw new Error(`pyth feeds ${resp.status}`);
  const data = (await resp.json()) as { id?: string; attributes?: { symbol?: string } }[];
  const ids: string[] = [];
  for (const row of data || []) {
    const sym = row.attributes?.symbol || '';
    if (!sym.startsWith(prefix)) continue;
    if (!row.id) continue;
    ids.push(normId(row.id));
  }
  return ids;
}

/** Freshest live price among candidate feed ids (publish_time, then price). */
function pickFreshest(parsed: ParsedPrice[], candidateIds: Set<string>): number | null {
  let best: { px: number; pub: number } | null = null;
  for (const row of parsed) {
    const id = normId(row.id || '');
    if (!candidateIds.has(id)) continue;
    const got = parsePythPrice(row.price);
    if (!got) continue;
    if (!best || got.pub > best.pub || (got.pub === best.pub && got.px > 0)) {
      best = got;
    }
  }
  return best?.px ?? null;
}

/**
 * Spot for Market Grid RWA assets — Pyth Hermes only
 * (Polymarket resolution source: equities + USOILSPOT; NG = active NGD month).
 */
export function useRwaSpotPrices() {
  const setBinanceTickerBatch = useAppStore((s) => s.setBinanceTickerBatch);
  const pendingRef = useRef<Partial<Record<AssetSymbol, number>>>({});
  const flushTimerRef = useRef<number | null>(null);
  const ngFeedIdsRef = useRef<string[]>([]);
  const wtiMonthIdsRef = useRef<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    function flush() {
      flushTimerRef.current = null;
      const snapshot = pendingRef.current;
      pendingRef.current = {};
      if (Object.keys(snapshot).length === 0) return;
      setBinanceTickerBatch(snapshot);
    }

    function scheduleFlush() {
      if (flushTimerRef.current != null) return;
      flushTimerRef.current = window.setTimeout(flush, 250);
    }

    function applyPatch(patch: Partial<Record<AssetSymbol, number>>) {
      if (cancelled || Object.keys(patch).length === 0) return;
      Object.assign(pendingRef.current, patch);
      scheduleFlush();
    }

    async function refreshCommodityFeeds() {
      try {
        const [ng, wti] = await Promise.all([
          discoverCommodityFeedIds('Commodities.NGD'),
          discoverCommodityFeedIds('Commodities.WTI'),
        ]);
        if (cancelled) return;
        if (ng.length) ngFeedIdsRef.current = ng;
        if (wti.length) wtiMonthIdsRef.current = wti;
      } catch (err) {
        console.error('rwa pyth feed discover:', err);
      }
    }

    async function pollPyth() {
      try {
        const fixedIds = FIXED_FEEDS.map((f) => f.feedId);
        const ngIds = ngFeedIdsRef.current;
        const wtiMonthIds = wtiMonthIdsRef.current;
        const allIds = [...new Set([...fixedIds, ...ngIds, ...wtiMonthIds])];
        const parsed = await fetchLatestParsed(allIds);
        if (cancelled) return;

        const byId = new Map<string, number>();
        for (const row of parsed) {
          const id = normId(row.id || '');
          const got = parsePythPrice(row.price);
          if (!id || !got) continue;
          byId.set(id, got.px);
        }

        const patch: Partial<Record<AssetSymbol, number>> = {};
        for (const f of FIXED_FEEDS) {
          const px = byId.get(normId(f.feedId));
          if (px != null) patch[f.symbol] = px;
        }

        // WTI: prefer USOILSPOT; else freshest live WTI month contract.
        if (patch.WTIUSDT == null && wtiMonthIds.length) {
          const px = pickFreshest(parsed, new Set(wtiMonthIds));
          if (px != null) patch.WTIUSDT = px;
        }

        // NG: freshest live Henry Hub month (NGD*).
        if (ngIds.length) {
          const px = pickFreshest(parsed, new Set(ngIds));
          if (px != null) patch.NGUSDT = px;
        }

        applyPatch(patch);
      } catch (err) {
        console.error('rwa pyth prices:', err);
      }
    }

    void (async () => {
      await refreshCommodityFeeds();
      await pollPyth();
    })();
    const pollTimer = window.setInterval(pollPyth, PYTH_POLL_MS);
    const discoverTimer = window.setInterval(refreshCommodityFeeds, FEED_DISCOVER_MS);

    return () => {
      cancelled = true;
      window.clearInterval(pollTimer);
      window.clearInterval(discoverTimer);
      if (flushTimerRef.current != null) {
        clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      const tail = pendingRef.current;
      pendingRef.current = {};
      if (Object.keys(tail).length > 0) setBinanceTickerBatch(tail);
    };
  }, [setBinanceTickerBatch]);
}
