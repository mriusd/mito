import { useEffect, useMemo, useState } from 'react';
import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';
import {
  extractAssetFromMarket,
  resolveUpDownStrikeSync,
  upDownTimeframeKeyFromMarket,
} from '../utils/format';
import { fetchUpDownTargetFromCrypto } from '../lib/upDownTargetFromCrypto';
import { API_BASE } from '../lib/env';
import { isMarketExpired } from '../lib/marketExpiry';

const POLL_MS = 12_000;

/**
 * Sidebar Target strike — must match mitobot K / polycandles /api/markets priceToBeat.
 *
 * Prefer catalog bucket/lookup/selected priceToBeat (same JSON the bot reads).
 * Only poll /api/crypto-price when catalog has no strike yet (window just opened).
 * Never override a present catalog strike with crypto-price (that path was returning a
 * different open and made Target disagree with the bot).
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

  const [asyncStrike, setAsyncStrike] = useState<number | undefined>(undefined);
  const tf = market ? upDownTimeframeKeyFromMarket(market) : null;
  const isShortTf = tf === '5m' || tf === '15m';
  const hasCatalogStrike =
    syncStrike != null && Number.isFinite(syncStrike) && syncStrike > 0;

  useEffect(() => {
    // Catalog already has bot-aligned priceToBeat — do not poll crypto-price or patch over it.
    if (hasCatalogStrike) {
      setAsyncStrike(undefined);
      return;
    }
    if (!market?.endDate) {
      setAsyncStrike(undefined);
      return;
    }

    const endMs = new Date(market.endDate).getTime();
    if (!Number.isFinite(endMs)) return;

    const combined = `${market.eventSlug || ''} ${market.question || ''}`;
    const asset = extractAssetFromMarket(market);
    if (!asset) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled || isMarketExpired(market)) return;
      // Re-check catalog each tick — markets poll may land ptb between intervals.
      const st = useAppStore.getState();
      const cat = resolveUpDownStrikeSync(market, st.marketLookup, st.upOrDownMarkets);
      if (cat != null && Number.isFinite(cat) && cat > 0) {
        if (!cancelled) setAsyncStrike(undefined);
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
          setAsyncStrike(p);
          // Only seed store when catalog still empty (fill gap until markets refresh).
          useAppStore.getState().patchMarketPriceToBeats({ [market.id]: p });
        }
      } catch {
        /* network / CORS — retry on next poll */
      }
    };

    void tick();
    // Short TF: poll until catalog lands. Longer TF: same when missing.
    const iv = setInterval(() => void tick(), isShortTf ? POLL_MS : POLL_MS * 2);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [
    market,
    market?.id,
    market?.endDate,
    market?.eventSlug,
    market?.question,
    hasCatalogStrike,
    isShortTf,
    lastUpdated,
    marketLookupEpoch,
  ]);

  // Catalog first (bot K). Async only as temporary fill when markets ptb missing.
  if (hasCatalogStrike) return syncStrike;
  if (asyncStrike != null && Number.isFinite(asyncStrike) && asyncStrike > 0) {
    return asyncStrike;
  }
  return undefined;
}
