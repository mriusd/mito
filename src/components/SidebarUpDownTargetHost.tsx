import { memo, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import {
  extractAssetFromMarket,
  pickLiveUpDownMarketInTfBucket,
  pickNextMarketOnExpiry,
  resolveUpDownStrikeSync,
  upDownTimeframeKeyFromMarket,
} from '../utils/format';
import { isMarketExpired as marketIsExpired } from '../lib/marketExpiry';
import { getExpiryTickNow, subscribeExpiryTick } from '../lib/expiryTickStore';
import { fetchUpDownTargetFromCrypto, upDownCryptoTimeframe } from '../lib/upDownTargetFromCrypto';
import { API_BASE } from '../lib/env';
import {
  setSidebarUpDownLiveSameTfMarket,
  setSidebarUpDownTargetPrice,
} from '../lib/sidebarUpDownTargetStore';

export const SidebarUpDownTargetHost = memo(function SidebarUpDownTargetHost() {
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const lastUpdated = useAppStore((s) => s.lastUpdated);
  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const marketLookupEpoch = useAppStore((s) => s.marketLookupEpoch);
  const autoSwitchNextMarketOnExpiry = useAppStore((s) => s.autoSwitchNextMarketOnExpiry);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);

  const marketLookup = useMemo(
    () => useAppStore.getState().marketLookup,
    [marketLookupEpoch],
  );

  const isUpDownMarket = !!(
    selectedMarket?.question?.match(/up\s+or\s+down/i) ||
    selectedMarket?.eventSlug?.match(/up-or-down|updown/i)
  );
  const upDownAsset = isUpDownMarket && selectedMarket ? extractAssetFromMarket(selectedMarket) : null;
  const isMarketExpired = marketIsExpired(selectedMarket);

  const autoSwitchPrevSelectedIdRef = useRef<string | null>(null);
  const userPinnedExpiredMarketRef = useRef(false);
  const selectedMarketForAutoSwitchRef = useRef(selectedMarket);
  selectedMarketForAutoSwitchRef.current = selectedMarket;

  const syncUpDownStrike = useMemo(
    () =>
      isUpDownMarket && selectedMarket
        ? resolveUpDownStrikeSync(selectedMarket, marketLookup, upOrDownMarkets)
        : undefined,
    [
      isUpDownMarket,
      selectedMarket,
      selectedMarket?.id,
      selectedMarket?.priceToBeat,
      selectedMarket?.clobTokenIds,
      marketLookup,
      upOrDownMarkets,
      lastUpdated,
    ],
  );

  useEffect(() => {
    if (!isUpDownMarket || !selectedMarket?.endDate) {
      setSidebarUpDownTargetPrice(null);
      return;
    }

    const endMs = new Date(selectedMarket.endDate).getTime();
    if (isNaN(endMs)) {
      setSidebarUpDownTargetPrice(null);
      return;
    }

    if (syncUpDownStrike != null && Number.isFinite(syncUpDownStrike)) {
      setSidebarUpDownTargetPrice(syncUpDownStrike);
      return;
    }

    setSidebarUpDownTargetPrice(null);

    const slug = selectedMarket.eventSlug || '';
    const q = selectedMarket.question || '';
    const combined = `${slug} ${q}`;
    const is5m = !!(combined.match(/updown-5m/i) || combined.match(/\b5[- ]?min/i));

    if (is5m) return;
    if (!upDownCryptoTimeframe(combined)) return;

    const asset = extractAssetFromMarket(selectedMarket);
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const p = await fetchUpDownTargetFromCrypto(API_BASE, asset, endMs, combined);
      if (!cancelled && p != null) setSidebarUpDownTargetPrice(p);
    };
    void tick();
    const iv = setInterval(() => void tick(), 12_000);
    const stopIv = setTimeout(() => clearInterval(iv), 150_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
      clearTimeout(stopIv);
    };
  }, [
    isUpDownMarket,
    selectedMarket?.id,
    selectedMarket?.endDate,
    selectedMarket?.eventSlug,
    selectedMarket?.question,
    syncUpDownStrike,
  ]);

  useEffect(() => {
    if (!isUpDownMarket || !selectedMarket || !isMarketExpired || !upDownAsset) {
      setSidebarUpDownLiveSameTfMarket(null);
      return;
    }
    const tf = upDownTimeframeKeyFromMarket(selectedMarket);
    if (!tf) {
      setSidebarUpDownLiveSameTfMarket(null);
      return;
    }
    const live = pickLiveUpDownMarketInTfBucket(upOrDownMarkets[upDownAsset]?.[tf]);
    if (!live || live.id === selectedMarket.id) {
      setSidebarUpDownLiveSameTfMarket(null);
      return;
    }
    setSidebarUpDownLiveSameTfMarket(live);
  }, [
    isUpDownMarket,
    selectedMarket,
    isMarketExpired,
    upDownAsset,
    upOrDownMarkets,
    lastUpdated,
  ]);

  useEffect(() => {
    if (!isMarketExpired || !isUpDownMarket) return;
    const id = window.setInterval(() => {
      const m = selectedMarketForAutoSwitchRef.current;
      if (!m || !marketIsExpired(m, getExpiryTickNow())) return;
      const asset = extractAssetFromMarket(m);
      if (!asset) return;
      const tf = upDownTimeframeKeyFromMarket(m);
      if (!tf) return;
      const st = useAppStore.getState();
      const live = pickLiveUpDownMarketInTfBucket(st.upOrDownMarkets[asset]?.[tf]);
      if (!live || live.id === m.id) {
        setSidebarUpDownLiveSameTfMarket(null);
        return;
      }
      setSidebarUpDownLiveSameTfMarket(live);
    }, 1500);
    return () => window.clearInterval(id);
  }, [isMarketExpired, isUpDownMarket]);

  useEffect(() => {
    if (!autoSwitchNextMarketOnExpiry) return;

    const tryAutoSwitch = () => {
      const m = selectedMarketForAutoSwitchRef.current;
      if (!m) {
        autoSwitchPrevSelectedIdRef.current = null;
        userPinnedExpiredMarketRef.current = false;
        return;
      }
      const id = m.id;
      const expiredNow = marketIsExpired(m, getExpiryTickNow());

      if (id !== autoSwitchPrevSelectedIdRef.current) {
        autoSwitchPrevSelectedIdRef.current = id;
        userPinnedExpiredMarketRef.current = expiredNow;
        return;
      }

      if (userPinnedExpiredMarketRef.current || !expiredNow) return;

      const st = useAppStore.getState();
      const next = pickNextMarketOnExpiry(m, getExpiryTickNow(), st.upOrDownMarkets, st.marketLookup);
      if (next) setSelectedMarket(next);
    };

    tryAutoSwitch();
    return subscribeExpiryTick(tryAutoSwitch);
  }, [
    autoSwitchNextMarketOnExpiry,
    selectedMarket?.id,
    selectedMarket?.endDate,
    selectedMarket?.closed,
    upOrDownMarkets,
    lastUpdated,
    marketLookupEpoch,
    setSelectedMarket,
  ]);

  return null;
});
