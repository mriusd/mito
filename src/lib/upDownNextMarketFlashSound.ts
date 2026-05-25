import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { Market } from '../types';
import { useExpiryNow } from '../hooks/useExpiryNow';
import { useThrottledMarketLookupSubset } from '../hooks/useThrottledMarketLookupSubset';
import { GRID_BID_ASK_THROTTLE_MS } from './bidAskMarketLookup';
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

export const UPDOWN_NEXT_MARKET_HI_THRESHOLD = 0.6;
/** Matches `.updown-triangle-badge-flash` animation period in index.css. */
export const UPDOWN_TRIANGLE_FLASH_MS = 1000;

const UPDOWN_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
const UPDOWN_TIMEFRAMES = ['5m', '15m', '1h', '4h', '24h'] as const;

function marketNotifyId(market: Market): string {
  return ((market.conditionId ?? market.id) || '').trim();
}

function hiFlashKey(marketId: string, side: 'yes' | 'no'): string {
  return `${marketId}:${side}`;
}

export function nextMarketHiFlashSides(
  market: Market,
  bidAskLookup: Record<string, Market>,
  opts?: { liveOnly?: boolean },
): { yesHi: boolean; noHi: boolean } {
  const liveOnly = opts?.liveOnly === true;
  const yesTokenId = market.clobTokenIds?.[0] || '';
  const noTokenId = market.clobTokenIds?.[1] || '';
  const live = yesTokenId ? bidAskLookup[yesTokenId] : null;
  const bestBid = liveOnly ? live?.bestBid : (live?.bestBid ?? market.bestBid);
  const gammaYes = { bestBid: market.bestBid, bestAsk: market.bestAsk };
  const yesHi =
    bestBid != null && Number.isFinite(bestBid) && bestBid >= UPDOWN_NEXT_MARKET_HI_THRESHOLD;

  if (liveOnly) {
    const noLive = noTokenId ? bidAskLookup[noTokenId] : null;
    const noBid = noLive?.bestBid;
    const noAsk = noLive?.bestAsk;
    const noHi =
      (noBid != null && Number.isFinite(noBid) && noBid >= UPDOWN_NEXT_MARKET_HI_THRESHOLD) ||
      (noAsk != null && Number.isFinite(noAsk) && noAsk >= UPDOWN_NEXT_MARKET_HI_THRESHOLD);
    return { yesHi, noHi };
  }

  const { bestBid: noBid, bestAsk: noAsk } = noOutcomeBidAsk(yesTokenId, noTokenId, bidAskLookup, gammaYes);
  const noHi =
    (noBid != null && Number.isFinite(noBid) && noBid >= UPDOWN_NEXT_MARKET_HI_THRESHOLD) ||
    (noAsk != null && Number.isFinite(noAsk) && noAsk >= UPDOWN_NEXT_MARKET_HI_THRESHOLD);
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

  const bidAskLookup = useThrottledMarketLookupSubset(lookupTokenIds, GRID_BID_ASK_THROTTLE_MS);
  const mutedMarketsKey = useSyncExternalStore(
    subscribeMarketNotifyMuted,
    getMarketNotifyMutedSnapshot,
    () => '[]',
  );

  const { hiKeysSig, whaleKind } = useMemo(() => {
    void mutedMarketsKey;
    const keys: string[] = [];
    let yesHi = false;
    let noHi = false;
    for (const m of nextMarkets) {
      if (isMarketNotifyMuted(marketNotifyId(m))) continue;
      const sides = nextMarketHiFlashSides(m, bidAskLookup, { liveOnly: true });
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
  }, [nextMarkets, bidAskLookup, mutedMarketsKey]);

  const prevHiKeysRef = useRef('');
  const intervalRef = useRef<number | null>(null);
  const whaleKindRef = useRef<'green' | 'red' | null>(null);
  whaleKindRef.current = whaleKind;

  useEffect(() => {
    ensureTiltAudioUnlockListeners();

    if (intervalRef.current != null) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (!whaleKind || !hiKeysSig) {
      prevHiKeysRef.current = '';
      return;
    }

    const prev = prevHiKeysRef.current;
    const hasNewHi = prev !== hiKeysSig && hiKeysSig.split('|').some((k) => k && !prev.split('|').filter(Boolean).includes(k));
    prevHiKeysRef.current = hiKeysSig;

    const pitchMul = pitchMulFromNotifyFreqSlider(readNotifySoundFreqSlider());
    const ringTimeS = readNotifyRingTimeS();
    const tick = () => {
      const kind = whaleKindRef.current;
      if (!kind) return;
      void playTiltNotifySoundStrikes(kind, pitchMul, ringTimeS, 3);
    };

    // Only start ringing on a fresh ≥60¢ cross on a next-market slot — not on rollover to current
    // and not when stale gamma already showed ≥60¢ before live quotes arrived.
    if (hasNewHi) tick();

    intervalRef.current = window.setInterval(tick, UPDOWN_TRIANGLE_FLASH_MS);

    return () => {
      if (intervalRef.current != null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [hiKeysSig, whaleKind]);
}
