import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { useAppStore } from '../stores/appStore';
import {
  ensureTiltAudioUnlockListeners,
  playTiltNotifySoundStrikes,
  playTiltNotifySoundWithDoubleRing,
} from '../lib/tiltNotifySound';
import { isNotifySoundPriceMuted } from '../lib/notifySoundPriceMute';
import {
  getMarketNotifyMutedSnapshot,
  isMarketNotifyMuted,
  subscribeMarketNotifyMuted,
} from '../lib/marketNotifyMute';
import { useSidebarChartAnnualVolPct } from '../lib/sidebarChartVolStore';
import { useSidebarNotifyStakedGatePasses } from '../lib/sidebarNotifyStakedGateStore';
import { getSidebarToxicFlowSnapshot } from '../lib/sidebarToxicFlowStore';
import { resetSidebarToxicNotify, useSidebarToxicNotify } from '../lib/sidebarToxicNotifyStore';

const TILT_EXTREME_FLASH_MS = 550;

export function SidebarToxicNotifySoundHost({
  notifyPlaySound,
  notifyWhaleRing,
  notifyWhaleRingMutable,
  notifySoundPitchMul,
  notifyRingTimeS,
  notifySoundMaxPriceCents,
  notifyDoubleRing,
  notifyMaxVolatilityPct,
  isMarketExpired,
}: {
  notifyPlaySound: boolean;
  notifyWhaleRing: boolean;
  notifyWhaleRingMutable: boolean;
  notifySoundPitchMul: number;
  notifyRingTimeS: number;
  notifySoundMaxPriceCents: number;
  notifyDoubleRing: boolean;
  notifyMaxVolatilityPct: number;
  isMarketExpired: boolean;
}) {
  const { topBarExtremeBgFlash, whalePassesPriceGate: notifyWhalePassesPriceGate } =
    useSidebarToxicNotify();
  const notifyStakedGatePasses = useSidebarNotifyStakedGatePasses();
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

  const tiltSoundMarketRef = useRef(selectedMarket);
  tiltSoundMarketRef.current = selectedMarket;
  const marketNotifyMutedRef = useRef(isCurrentMarketMuted);
  marketNotifyMutedRef.current = isCurrentMarketMuted;

  const notifyVolatilityGatePasses = useMemo(() => {
    if (notifyMaxVolatilityPct <= 0) return true;
    if (sidebarChartAnnualVolPct == null || !Number.isFinite(sidebarChartAnnualVolPct)) return false;
    return sidebarChartAnnualVolPct <= notifyMaxVolatilityPct;
  }, [notifyMaxVolatilityPct, sidebarChartAnnualVolPct]);

  useEffect(() => {
    ensureTiltAudioUnlockListeners();
  }, []);

  useEffect(() => {
    resetSidebarToxicNotify();
  }, [toxicFlowMarketId]);

  useEffect(() => {
    const cohortTiltAlarm = topBarExtremeBgFlash;
    const cohortNeedsSound = cohortTiltAlarm != null && notifyPlaySound;
    const whaleEligible = notifyWhaleRing && notifyWhalePassesPriceGate;
    const whaleNeedsSound = whaleEligible && !cohortNeedsSound;

    if (!cohortNeedsSound && !whaleNeedsSound) return;
    if (isMarketExpired) return;
    if (cohortNeedsSound && !notifyVolatilityGatePasses) return;
    if (cohortNeedsSound && !notifyStakedGatePasses) return;

    const k = cohortTiltAlarm ?? 'green';
    const mul = notifySoundPitchMul;
    const rt = notifyRingTimeS;
    const maxCents = notifySoundMaxPriceCents;
    const doubleRing = notifyDoubleRing;

    const tick = () => {
      const sm = tiltSoundMarketRef.current;
      const ids = sm?.clobTokenIds;
      const muted = marketNotifyMutedRef.current;
      if (cohortNeedsSound) {
        if (isNotifySoundPriceMuted(ids?.[0], ids?.[1], maxCents)) return;
        if (muted) return;
        void playTiltNotifySoundWithDoubleRing(k, mul, rt, doubleRing);
      } else if (whaleNeedsSound) {
        const tfMid = (getSidebarToxicFlowSnapshot().data?.marketId ?? '').trim();
        const curMid = toxicFlowMarketId.trim();
        if (!tfMid || !curMid || tfMid !== curMid) return;
        if (muted && notifyWhaleRingMutable) return;
        void playTiltNotifySoundStrikes(k, mul, rt, 3);
      }
    };

    tick();
    const repeatMs = Math.max(TILT_EXTREME_FLASH_MS, Math.ceil(rt * 1000) + 80);
    const id = window.setInterval(tick, repeatMs);
    return () => clearInterval(id);
  }, [
    topBarExtremeBgFlash,
    notifyWhaleRing,
    notifyWhaleRingMutable,
    notifyWhalePassesPriceGate,
    notifyPlaySound,
    notifyStakedGatePasses,
    notifyVolatilityGatePasses,
    notifySoundPitchMul,
    notifyRingTimeS,
    notifySoundMaxPriceCents,
    notifyDoubleRing,
    isMarketExpired,
    toxicFlowMarketId,
    isCurrentMarketMuted,
  ]);

  return null;
}
