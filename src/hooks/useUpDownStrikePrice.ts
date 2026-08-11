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
 * Up/Down target strike for sidebar Target:
 * 1) polycandles catalog (TWAP-open for 5m/15m via bucket/lookup)
 * 2) async /api/crypto-price (backend prefers TWAP open for 5m/15m)
 * Never lock forever on a stale selectedMarket.priceToBeat from Gamma.
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

  useEffect(() => {
    setAsyncStrike(undefined);
    if (!market?.endDate) return;
    // Short TF: still poll crypto-price/TWAP open so Target tracks polycandles as soon as open is captured
    // (catalog may lag one poll after window start). Longer TF: only poll when sync missing.
    if (!isShortTf && syncStrike != null && Number.isFinite(syncStrike)) return;

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
        if (!cancelled && p != null && Number.isFinite(p) && p > 0) {
          setAsyncStrike(p);
          // Keep store in sync so grid cells / BS math see the same strike.
          useAppStore.getState().patchMarketPriceToBeats({ [market.id]: p });
        }
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
    isShortTf,
  ]);

  // Prefer sync catalog (TWAP-open from polycandles markets API). Async only when missing
  // or when short-TF async is a real TWAP open that differs (late capture).
  if (syncStrike != null && Number.isFinite(syncStrike) && syncStrike > 0) {
    if (
      isShortTf &&
      asyncStrike != null &&
      Number.isFinite(asyncStrike) &&
      asyncStrike > 0 &&
      Math.abs(asyncStrike - syncStrike) > 0.5
    ) {
      // Large disagreement: prefer backend crypto-price/TWAP open over stale Gamma on selected.
      return asyncStrike;
    }
    return syncStrike;
  }
  return asyncStrike;
}
