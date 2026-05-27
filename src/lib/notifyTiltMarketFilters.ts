import { useMemo, useSyncExternalStore } from 'react';
import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';
import { isMarketInWeeklyHitMarkets } from '../utils/bsMath';
import { hitStrikeMetaForBs, upDownTimeframeKeyFromMarket } from '../utils/format';

const SIDEBAR_NOTIFY_TILT_MKT_UPDOWN_KEY = 'polybot-sidebar-notify-tilt-mkt-updown';
const SIDEBAR_NOTIFY_TILT_MKT_HIT_KEY = 'polybot-sidebar-notify-tilt-mkt-hit';
const SIDEBAR_NOTIFY_TILT_MKT_ABOVE_KEY = 'polybot-sidebar-notify-tilt-mkt-above';
const SIDEBAR_NOTIFY_TILT_MKT_BETWEEN_KEY = 'polybot-sidebar-notify-tilt-mkt-between';
const SIDEBAR_NOTIFY_TILT_UD_5M_KEY = 'polybot-sidebar-notify-tilt-ud-5m';
const SIDEBAR_NOTIFY_TILT_UD_15M_KEY = 'polybot-sidebar-notify-tilt-ud-15m';
const SIDEBAR_NOTIFY_TILT_UD_1H_KEY = 'polybot-sidebar-notify-tilt-ud-1h';
const SIDEBAR_NOTIFY_TILT_UD_4H_KEY = 'polybot-sidebar-notify-tilt-ud-4h';

export type NotifyTiltMarketFiltersPersisted = {
  upDown: boolean;
  hit: boolean;
  above: boolean;
  between: boolean;
  ud5m: boolean;
  ud15m: boolean;
  ud1h: boolean;
  ud4h: boolean;
};

function readFlag(key: string, defaultOnNull: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return defaultOnNull;
    return v === '1';
  } catch {
    return defaultOnNull;
  }
}

export function readNotifyTiltMarketFiltersPersisted(): NotifyTiltMarketFiltersPersisted {
  return {
    upDown: readFlag(SIDEBAR_NOTIFY_TILT_MKT_UPDOWN_KEY, true),
    hit: readFlag(SIDEBAR_NOTIFY_TILT_MKT_HIT_KEY, false),
    above: readFlag(SIDEBAR_NOTIFY_TILT_MKT_ABOVE_KEY, false),
    between: readFlag(SIDEBAR_NOTIFY_TILT_MKT_BETWEEN_KEY, false),
    ud5m: readFlag(SIDEBAR_NOTIFY_TILT_UD_5M_KEY, true),
    ud15m: readFlag(SIDEBAR_NOTIFY_TILT_UD_15M_KEY, true),
    ud1h: readFlag(SIDEBAR_NOTIFY_TILT_UD_1H_KEY, false),
    ud4h: readFlag(SIDEBAR_NOTIFY_TILT_UD_4H_KEY, false),
  };
}

/** Tilt sound/flash/top-cohort tilt only when the selected market matches user filters. */
export function marketMatchesNotifyTiltFilters(
  market: Parameters<typeof hitStrikeMetaForBs>[0] | null | undefined,
  f: NotifyTiltMarketFiltersPersisted,
  isWeeklyListedHit: boolean,
): boolean {
  if (!market) return false;
  if (!(f.upDown || f.hit || f.above || f.between)) return false;
  const isUd = !!(market.question?.match(/up\s+or\s+down/i) || market.eventSlug?.match(/up-or-down|updown/i));
  if (isUd && f.upDown) {
    const tf = upDownTimeframeKeyFromMarket(market);
    if (tf === '5m') return f.ud5m;
    if (tf === '15m') return f.ud15m;
    if (tf === '1h') return f.ud1h;
    if (tf === '4h') return f.ud4h;
    return false;
  }
  if (isUd) return false;
  const isHit = isWeeklyListedHit || hitStrikeMetaForBs(market) != null;
  const q = (market.question || '').trim();
  const isBetween = /\bbetween\b.+\band\b/i.test(q);
  if (isHit && f.hit) return true;
  if (isBetween && f.between) return true;
  if (!isHit && !isBetween && f.above) return true;
  return false;
}

let revision = 0;
const revisionListeners = new Set<() => void>();

export function bumpNotifyTiltMarketFiltersRevision(): void {
  revision += 1;
  for (const fn of revisionListeners) fn();
}

function subscribeNotifyTiltMarketFiltersRevision(onStoreChange: () => void): () => void {
  revisionListeners.add(onStoreChange);
  return () => revisionListeners.delete(onStoreChange);
}

function getNotifyTiltMarketFiltersRevision(): number {
  return revision;
}

export function useNotifyTiltAppliesToSelectedMarket(): boolean {
  const filterRevision = useSyncExternalStore(
    subscribeNotifyTiltMarketFiltersRevision,
    getNotifyTiltMarketFiltersRevision,
    getNotifyTiltMarketFiltersRevision,
  );
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const weeklyHitMarkets = useAppStore((s) => s.weeklyHitMarkets);
  return useMemo(
    () =>
      marketMatchesNotifyTiltFilters(
        selectedMarket,
        readNotifyTiltMarketFiltersPersisted(),
        isMarketInWeeklyHitMarkets(selectedMarket?.id, weeklyHitMarkets),
      ),
    [selectedMarket, weeklyHitMarkets, filterRevision],
  );
}
