import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useAppStore } from '../stores/appStore';
import { ensureTiltAudioUnlockListeners, playTiltNotifySoundStrikes } from '../lib/tiltNotifySound';
import { isNotifySoundPriceMuted } from '../lib/notifySoundPriceMute';
import {
  getMarketNotifyMutedSnapshot,
  isMarketNotifyMuted,
  subscribeMarketNotifyMuted,
} from '../lib/marketNotifyMute';
import { useSidebarChartAnnualVolPct, sidebarVolBelowMaxCap } from '../lib/sidebarChartVolStore';

const VOLATILITY_RING_MS = 3000;

export function SidebarVolatilityRingHost({
  notifyVolatilityRing,
  notifyMaxVolatilityPct,
  notifySoundPitchMul,
  notifyRingTimeS,
  notifySoundMaxPriceCents,
  isMarketExpired,
}: {
  notifyVolatilityRing: boolean;
  notifyMaxVolatilityPct: number;
  notifySoundPitchMul: number;
  notifyRingTimeS: number;
  notifySoundMaxPriceCents: number;
  isMarketExpired: boolean;
}) {
  const sidebarChartAnnualVolPct = useSidebarChartAnnualVolPct();
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const toxicFlowMarketId = useMemo(
    () => ((selectedMarket?.conditionId ?? selectedMarket?.id) || '').trim(),
    [selectedMarket?.conditionId, selectedMarket?.id],
  );
  const mutedMarketsKey = useSyncExternalStore(
    subscribeMarketNotifyMuted,
    getMarketNotifyMutedSnapshot,
    () => '[]',
  );
  const isCurrentMarketMuted = useMemo(
    () => isMarketNotifyMuted(toxicFlowMarketId),
    [toxicFlowMarketId, mutedMarketsKey],
  );

  const volBelowMax = useMemo(
    () =>
      !isMarketExpired &&
      sidebarVolBelowMaxCap(sidebarChartAnnualVolPct, notifyMaxVolatilityPct),
    [isMarketExpired, sidebarChartAnnualVolPct, notifyMaxVolatilityPct],
  );

  const marketRef = useRef(selectedMarket);
  marketRef.current = selectedMarket;
  const marketMutedRef = useRef(isCurrentMarketMuted);
  marketMutedRef.current = isCurrentMarketMuted;

  useEffect(() => {
    ensureTiltAudioUnlockListeners();
  }, []);

  useEffect(() => {
    if (!notifyVolatilityRing || !volBelowMax) return;

    const tick = () => {
      const sm = marketRef.current;
      const ids = sm?.clobTokenIds;
      if (isNotifySoundPriceMuted(ids?.[0], ids?.[1], notifySoundMaxPriceCents)) return;
      if (marketMutedRef.current) return;
      void playTiltNotifySoundStrikes('green', notifySoundPitchMul, notifyRingTimeS, 1);
    };

    tick();
    const id = window.setInterval(tick, VOLATILITY_RING_MS);
    return () => clearInterval(id);
  }, [
    notifyVolatilityRing,
    volBelowMax,
    notifySoundPitchMul,
    notifyRingTimeS,
    notifySoundMaxPriceCents,
  ]);

  return null;
}
