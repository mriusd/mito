import { memo, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import {
  extractAssetFromMarket,
  listFutureUpDownMarketsInTfBucket,
  listPastUpDownMarketsInTfBucket,
  pickLiveUpDownMarketInTfBucket,
  pickNextMarketOnExpiry,
  upDownTimeframeKeyFromMarket,
} from '../utils/format';
import { isMarketExpired as marketIsExpired } from '../lib/marketExpiry';
import { getExpiryTickNow, subscribeExpiryTick } from '../lib/expiryTickStore';
import { useUpDownStrikePrice } from '../hooks/useUpDownStrikePrice';
import {
  setSidebarUpDownEndPicker,
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

  const isUpDownMarket = !!(
    selectedMarket?.question?.match(/up\s+or\s+down/i) ||
    selectedMarket?.eventSlug?.match(/up-or-down|updown/i)
  );
  const upDownAsset = isUpDownMarket && selectedMarket ? extractAssetFromMarket(selectedMarket) : null;
  const isMarketExpired = marketIsExpired(selectedMarket);

  const strike = useUpDownStrikePrice(isUpDownMarket ? selectedMarket : null);

  const autoSwitchPrevSelectedIdRef = useRef<string | null>(null);
  const userPinnedExpiredMarketRef = useRef(false);
  const selectedMarketForAutoSwitchRef = useRef(selectedMarket);
  selectedMarketForAutoSwitchRef.current = selectedMarket;

  const [endPickerPulse, setEndPickerPulse] = useState(0);

  useEffect(() => {
    if (!isUpDownMarket || !selectedMarket?.endDate) {
      setSidebarUpDownTargetPrice(null);
      return;
    }
    setSidebarUpDownTargetPrice(strike ?? null);
  }, [isUpDownMarket, selectedMarket?.id, selectedMarket?.endDate, strike]);

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
    if (!isUpDownMarket || !selectedMarket?.endDate) {
      setSidebarUpDownEndPicker(null);
      return;
    }
    const endMs = new Date(selectedMarket.endDate).getTime();
    if (!Number.isFinite(endMs)) {
      setSidebarUpDownEndPicker(null);
      return;
    }
    const asset = extractAssetFromMarket(selectedMarket);
    if (!asset) {
      setSidebarUpDownEndPicker(null);
      return;
    }
    const tf = upDownTimeframeKeyFromMarket(selectedMarket);
    if (!tf) {
      setSidebarUpDownEndPicker(null);
      return;
    }
    const nowMs = Date.now();
    const futureList = listFutureUpDownMarketsInTfBucket(upOrDownMarkets[asset]?.[tf], nowMs);
    const pastList = listPastUpDownMarketsInTfBucket(upOrDownMarkets[asset]?.[tf], nowMs);
    const endPickerList = [...pastList, ...futureList].sort((a, b) => {
      const ta = a.endDate ? new Date(a.endDate).getTime() : 0;
      const tb = b.endDate ? new Date(b.endDate).getTime() : 0;
      return ta - tb;
    });
    const visibleEndLabel = new Date(selectedMarket.endDate).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    setSidebarUpDownEndPicker({ endPickerList, visibleEndLabel, endIso: selectedMarket.endDate });
  }, [
    isUpDownMarket,
    selectedMarket,
    selectedMarket?.id,
    selectedMarket?.endDate,
    upOrDownMarkets,
    lastUpdated,
    marketLookupEpoch,
    endPickerPulse,
  ]);

  useEffect(() => {
    if (!isMarketExpired || !isUpDownMarket) return;
    const id = window.setInterval(() => setEndPickerPulse((n) => n + 1), 1500);
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
