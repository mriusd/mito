import { useEffect, useMemo, useState } from 'react';
import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';
import {
  extractAssetFromMarket,
  resolveUpDownStrikeSync,
  upDownTimeframeKeyFromMarket,
} from '../utils/format';
import {
  extractEventStartUnixFromSlug,
  fetchUpDownTargetFromCrypto,
} from '../lib/upDownTargetFromCrypto';
import { API_BASE } from '../lib/env';
import { isMarketExpired } from '../lib/marketExpiry';

/** Poll interval while target is missing (and delay after window open). */
const TARGET_RETRY_MS = 5_000;

function marketWindowStartMs(market: Market, endMs: number): number {
  const slugUnix =
    extractEventStartUnixFromSlug(market.eventSlug) ??
    extractEventStartUnixFromSlug(`${market.eventSlug || ''} ${market.question || ''}`);
  if (slugUnix != null) return slugUnix * 1000;
  const tf = upDownTimeframeKeyFromMarket(market);
  let dur = 60 * 60 * 1000;
  if (tf === '5m') dur = 5 * 60 * 1000;
  else if (tf === '15m') dur = 15 * 60 * 1000;
  else if (tf === '4h') dur = 4 * 60 * 60 * 1000;
  else if (tf === '24h') dur = 24 * 60 * 60 * 1000;
  return endMs - dur;
}

/**
 * Sidebar Target strike — must match mitobot K / polycandles /api/markets priceToBeat.
 *
 * Prefer catalog bucket/lookup/selected priceToBeat (same JSON the bot reads).
 * When missing (common right after auto-switch to a new window), wait until
 * marketStart+5s then poll /api/crypto-price every 5s until a target is acquired.
 * Never override a present catalog strike with crypto-price.
 */
export function useUpDownStrikePrice(market: Market | null | undefined): number | undefined {
  const lastUpdated = useAppStore((s) => s.lastUpdated);
  const marketLookupEpoch = useAppStore((s) => s.marketLookupEpoch);
  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);

  const marketLookup = useMemo(
    () => useAppStore.getState().marketLookup,
    [marketLookupEpoch],
  );

  const syncStrike = useMemo(() => {
    if (!market) return undefined;
    return resolveUpDownStrikeSync(market, marketLookup, upOrDownMarkets);
  }, [
    market,
    market?.id,
    market?.priceToBeat,
    market?.clobTokenIds,
    marketLookup,
    upOrDownMarkets,
    lastUpdated,
    marketLookupEpoch,
  ]);

  /** Bound to market.id so a switch never shows the previous window's async fill. */
  const [asyncStrike, setAsyncStrike] = useState<{ id: string; p: number } | null>(null);

  const hasCatalogStrike =
    syncStrike != null && Number.isFinite(syncStrike) && syncStrike > 0;

  // Drop any prior market's async value immediately on selection change.
  useEffect(() => {
    setAsyncStrike(null);
  }, [market?.id]);

  useEffect(() => {
    if (hasCatalogStrike) {
      setAsyncStrike(null);
      return;
    }
    if (!market?.id || !market.endDate) {
      setAsyncStrike(null);
      return;
    }

    const marketId = market.id;
    const endMs = new Date(market.endDate).getTime();
    if (!Number.isFinite(endMs)) return;

    const combined = `${market.eventSlug || ''} ${market.question || ''}`;
    const asset = extractAssetFromMarket(market);
    if (!asset) return;

    const startMs = marketWindowStartMs(market, endMs);
    // First attempt at window open + 5s (or immediately if already later).
    const firstAt = startMs + TARGET_RETRY_MS;

    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      if (cancelled || isMarketExpired(market)) return;
      // Re-check catalog each tick — markets poll may land ptb between intervals.
      const st = useAppStore.getState();
      const cat = resolveUpDownStrikeSync(market, st.marketLookup, st.upOrDownMarkets);
      if (cat != null && Number.isFinite(cat) && cat > 0) {
        if (!cancelled) setAsyncStrike(null);
        return;
      }
      try {
        const p = await fetchUpDownTargetFromCrypto(
          API_BASE,
          asset,
          endMs,
          combined,
          market.eventSlug,
        );
        if (!cancelled && p != null && Number.isFinite(p) && p > 0) {
          setAsyncStrike({ id: marketId, p });
          // Seed store so up/down panel Target cells update too.
          useAppStore.getState().patchMarketPriceToBeats({ [marketId]: p });
        }
      } catch {
        /* network / CORS — retry on next poll */
      }
    };

    const startPolling = () => {
      if (cancelled) return;
      void tick();
      intervalId = setInterval(() => void tick(), TARGET_RETRY_MS);
    };

    const delay = Math.max(0, firstAt - Date.now());
    timeoutId = setTimeout(startPolling, delay);

    return () => {
      cancelled = true;
      if (timeoutId != null) clearTimeout(timeoutId);
      if (intervalId != null) clearInterval(intervalId);
    };
    // Intentionally omit lastUpdated/marketLookupEpoch — tick re-reads the store.
    // Restarting the timer on every markets poll would push first-fetch past open+5s forever.
  }, [
    market,
    market?.id,
    market?.endDate,
    market?.eventSlug,
    market?.question,
    hasCatalogStrike,
  ]);

  // Catalog first (bot K). Async only as temporary fill when markets ptb missing.
  if (hasCatalogStrike) return syncStrike;
  if (
    asyncStrike != null &&
    market?.id &&
    asyncStrike.id === market.id &&
    Number.isFinite(asyncStrike.p) &&
    asyncStrike.p > 0
  ) {
    return asyncStrike.p;
  }
  return undefined;
}
