import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Market } from '../types';
import { useExpiryNow } from '../hooks/useExpiryNow';
import { useLiveBidAskLookupSubset } from '../hooks/useLiveBidAskLookupSubset';
import {
  getMarketNotifyMutedSnapshot,
  isMarketNotifyMuted,
  subscribeMarketNotifyMuted,
} from './marketNotifyMute';
import { noOutcomeBidAsk } from './outcomeQuote';
import {
  ensureTiltAudioUnlockListeners,
  pitchMulFromNotifyFreqSlider,
  playTiltNotifySoundStrikes,
  readNotifyRingTimeS,
  readNotifySoundFreqSlider,
} from './tiltNotifySound';

export const SIDEBAR_NOTIFY_UPDOWN_NEXT_HI_KEY = 'polybot-sidebar-notify-updown-next-hi';
export const SIDEBAR_NOTIFY_UPDOWN_NEXT_HI_CENTS_KEY = 'polybot-sidebar-notify-updown-next-hi-cents';
export const DEFAULT_UPDOWN_NEXT_HI_CENTS = 65;
/** Matches `.updown-triangle-badge-flash` animation period in index.css. */
export const UPDOWN_TRIANGLE_FLASH_MS = 1000;

const UPDOWN_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
const UPDOWN_TIMEFRAMES = ['5m', '15m', '1h', '4h', '24h'] as const;

type UpDownNextHiSettingsSnap = {
  digest: number;
  alertEnabled: boolean;
  hiCents: number;
};

const upDownNextHiListeners = new Set<() => void>();

function clampHiCents(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_UPDOWN_NEXT_HI_CENTS;
  return Math.min(99, Math.max(1, Math.round(raw)));
}

export function readNotifyUpDownNextHi(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_UPDOWN_NEXT_HI_KEY);
    if (v === null) return false;
    return v === '1';
  } catch {
    return false;
  }
}

export function readNotifyUpDownNextHiCents(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_UPDOWN_NEXT_HI_CENTS_KEY);
    if (raw == null || raw === '') return DEFAULT_UPDOWN_NEXT_HI_CENTS;
    return clampHiCents(Number.parseFloat(raw));
  } catch {
    return DEFAULT_UPDOWN_NEXT_HI_CENTS;
  }
}

function buildUpDownNextHiSettingsSnap(): Omit<UpDownNextHiSettingsSnap, 'digest'> {
  return {
    alertEnabled: readNotifyUpDownNextHi(),
    hiCents: readNotifyUpDownNextHiCents(),
  };
}

let upDownNextHiSettingsSnap: UpDownNextHiSettingsSnap = {
  digest: 0,
  ...buildUpDownNextHiSettingsSnap(),
};

function notifyUpDownNextHiSettingsListeners(): void {
  for (const fn of upDownNextHiListeners) fn();
}

export function publishUpDownNextHiSettings(alertEnabled: boolean, hiCents: number): void {
  const nextCents = clampHiCents(hiCents);
  upDownNextHiSettingsSnap = {
    digest: upDownNextHiSettingsSnap.digest + 1,
    alertEnabled,
    hiCents: nextCents,
  };
  notifyUpDownNextHiSettingsListeners();
}

export function subscribeUpDownNextHiSettings(onStoreChange: () => void): () => void {
  upDownNextHiListeners.add(onStoreChange);
  return () => upDownNextHiListeners.delete(onStoreChange);
}

export function getUpDownNextHiSettingsSnapshot(): UpDownNextHiSettingsSnap {
  return upDownNextHiSettingsSnap;
}

export function useUpDownNextHiSettings(): { alertEnabled: boolean; hiCents: number; hiThreshold: number } {
  const digest = useSyncExternalStore(
    subscribeUpDownNextHiSettings,
    () => getUpDownNextHiSettingsSnapshot().digest,
    () => getUpDownNextHiSettingsSnapshot().digest,
  );
  void digest;
  const snap = getUpDownNextHiSettingsSnapshot();
  return {
    alertEnabled: snap.alertEnabled,
    hiCents: snap.hiCents,
    hiThreshold: snap.hiCents / 100,
  };
}

function marketNotifyId(market: Market): string {
  return ((market.conditionId ?? market.id) || '').trim();
}

function hiFlashKey(marketId: string, side: 'yes' | 'no'): string {
  return `${marketId}:${side}`;
}

export function nextMarketHiFlashSides(
  market: Market,
  bidAskLookup: Record<string, Market>,
  opts?: { liveOnly?: boolean; hiThreshold?: number },
): { yesHi: boolean; noHi: boolean } {
  const liveOnly = opts?.liveOnly === true;
  const threshold = opts?.hiThreshold ?? readNotifyUpDownNextHiCents() / 100;
  const yesTokenId = market.clobTokenIds?.[0] || '';
  const noTokenId = market.clobTokenIds?.[1] || '';
  const live = yesTokenId ? bidAskLookup[yesTokenId] : null;
  const bestBid = liveOnly ? live?.bestBid : (live?.bestBid ?? market.bestBid);
  const gammaYes = { bestBid: market.bestBid, bestAsk: market.bestAsk };
  const yesHi = bestBid != null && Number.isFinite(bestBid) && bestBid >= threshold;

  if (liveOnly) {
    const noLive = noTokenId ? bidAskLookup[noTokenId] : null;
    const noBid = noLive?.bestBid;
    const noAsk = noLive?.bestAsk;
    const noHi =
      (noBid != null && Number.isFinite(noBid) && noBid >= threshold) ||
      (noAsk != null && Number.isFinite(noAsk) && noAsk >= threshold);
    return { yesHi, noHi };
  }

  const { bestBid: noBid, bestAsk: noAsk } = noOutcomeBidAsk(yesTokenId, noTokenId, bidAskLookup, gammaYes);
  const noHi =
    (noBid != null && Number.isFinite(noBid) && noBid >= threshold) ||
    (noAsk != null && Number.isFinite(noAsk) && noAsk >= threshold);
  return { yesHi, noHi };
}

export function collectUpDownNextMarkets(
  sortedOpenByAssetTf: Partial<
    Record<(typeof UPDOWN_ASSETS)[number], Partial<Record<(typeof UPDOWN_TIMEFRAMES)[number], Market[]>>>
  >,
  visibleAssets: readonly (typeof UPDOWN_ASSETS)[number][],
  nowMs: number,
  nextMarketsCount: number,
): Market[] {
  const out: Market[] = [];
  const seen = new Set<string>();
  for (const asset of visibleAssets) {
    for (const tf of UPDOWN_TIMEFRAMES) {
      const markets = sortedOpenByAssetTf[asset]?.[tf] ?? [];
      const currentIdx = markets.findIndex((m) => m.endDate && new Date(m.endDate).getTime() > nowMs);
      if (currentIdx === -1) continue;
      for (let i = 0; i < nextMarketsCount; i++) {
        const m = markets[currentIdx + 1 + i];
        if (!m || seen.has(m.id)) continue;
        seen.add(m.id);
        out.push(m);
      }
    }
  }
  return out;
}

export function useUpDownNextMarketFlashWhaleSound(
  sortedOpenByAssetTf: Partial<
    Record<(typeof UPDOWN_ASSETS)[number], Partial<Record<(typeof UPDOWN_TIMEFRAMES)[number], Market[]>>>
  >,
  visibleAssets: readonly (typeof UPDOWN_ASSETS)[number][],
  nextMarketsCount: number,
): void {
  const { alertEnabled, hiThreshold } = useUpDownNextHiSettings();
  const now = useExpiryNow();
  const nextMarkets = useMemo(
    () => collectUpDownNextMarkets(sortedOpenByAssetTf, visibleAssets, now, nextMarketsCount),
    [sortedOpenByAssetTf, visibleAssets, now, nextMarketsCount],
  );

  const lookupTokenIds = useMemo(() => {
    const ids = new Set<string>();
    for (const m of nextMarkets) {
      for (const t of m.clobTokenIds || []) {
        const k = String(t || '').trim();
        if (k) ids.add(k);
      }
    }
    return [...ids];
  }, [nextMarkets]);

  const bidAskLookup = useLiveBidAskLookupSubset(lookupTokenIds);
  const mutedMarketsKey = useSyncExternalStore(
    subscribeMarketNotifyMuted,
    getMarketNotifyMutedSnapshot,
    () => '[]',
  );

  const { hiKeysSig, whaleKind } = useMemo(() => {
    void mutedMarketsKey;
    if (!alertEnabled) {
      return { hiKeysSig: '', whaleKind: null };
    }
    const keys: string[] = [];
    let yesHi = false;
    let noHi = false;
    for (const m of nextMarkets) {
      if (isMarketNotifyMuted(marketNotifyId(m))) continue;
      const sides = nextMarketHiFlashSides(m, bidAskLookup, { liveOnly: true, hiThreshold });
      if (sides.yesHi) {
        yesHi = true;
        keys.push(hiFlashKey(m.id, 'yes'));
      }
      if (sides.noHi) {
        noHi = true;
        keys.push(hiFlashKey(m.id, 'no'));
      }
    }
    keys.sort();
    return {
      hiKeysSig: keys.join('|'),
      whaleKind: yesHi ? ('green' as const) : noHi ? ('red' as const) : null,
    };
  }, [nextMarkets, bidAskLookup, mutedMarketsKey, alertEnabled, hiThreshold]);

  const prevHiKeysRef = useRef('');

  useEffect(() => {
    ensureTiltAudioUnlockListeners();

    if (!alertEnabled || !whaleKind || !hiKeysSig) {
      prevHiKeysRef.current = '';
      return;
    }

    const prev = prevHiKeysRef.current;
    const prevSet = new Set(prev.split('|').filter(Boolean));
    const curKeys = hiKeysSig.split('|').filter(Boolean);
    const hasNewHi = curKeys.some((k) => !prevSet.has(k));
    prevHiKeysRef.current = hiKeysSig;

    if (!hasNewHi) return;

    const pitchMul = pitchMulFromNotifyFreqSlider(readNotifySoundFreqSlider());
    const ringTimeS = readNotifyRingTimeS();
    void playTiltNotifySoundStrikes(whaleKind, pitchMul, ringTimeS, 3);
  }, [hiKeysSig, whaleKind, alertEnabled]);
}
