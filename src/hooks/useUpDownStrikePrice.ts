import { useEffect, useMemo, useState } from 'react';
import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';
import { extractAssetFromMarket, resolveUpDownStrikeSync } from '../utils/format';
import { fetchUpDownTargetFromCrypto } from '../lib/upDownTargetFromCrypto';
import { API_BASE } from '../lib/env';
import { isMarketExpired } from '../lib/marketExpiry';

const POLL_MS = 12_000;

/**
 * Up/Down target strike: store sync (Gamma / bucket / lookup) then Polymarket crypto-price poll until live.
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
  ]);

  const [asyncStrike, setAsyncStrike] = useState<number | undefined>(undefined);

  useEffect(() => {
    setAsyncStrike(undefined);
    if (!market?.endDate) return;
    if (syncStrike != null && Number.isFinite(syncStrike)) return;

    const endMs = new Date(market.endDate).getTime();
    if (!Number.isFinite(endMs)) return;

    const combined = `${market.eventSlug || ''} ${market.question || ''}`;
    const asset = extractAssetFromMarket(market);
    if (!asset) return;

    let cancelled = false;
    const tick = async () => {
      if (cancelled || isMarketExpired(market)) return;
      try {
        const p = await fetchUpDownTargetFromCrypto(API_BASE, asset, endMs, combined);
        if (!cancelled && p != null && Number.isFinite(p)) setAsyncStrike(p);
      } catch {
        /* network / CORS — retry on next poll */
      }
    };

    void tick();
    const iv = setInterval(() => void tick(), POLL_MS);
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
    syncStrike,
  ]);

  if (syncStrike != null && Number.isFinite(syncStrike)) return syncStrike;
  return asyncStrike;
}
