import { useMemo, useSyncExternalStore } from 'react';
import type { ToxicFlowData } from '../api';
import {
  buildToxicFlowTabWalletViews,
  type ToxicFlowTabWalletViews,
} from './toxicFlowStakeCohort';
import {
  getSidebarToxicFlowSnapshot,
  subscribeSidebarToxicFlow,
} from './sidebarToxicFlowStore';

let cache: {
  data: ToxicFlowData;
  favKey: string;
  whaleUsd: number;
  views: ToxicFlowTabWalletViews;
} | null = null;

function favSetKey(fav: ReadonlySet<string>): string {
  if (fav.size === 0) return '';
  return [...fav].sort().join('\0');
}

export function clearSidebarToxicFlowTabViewsCache(): void {
  cache = null;
}

export function resolveSidebarToxicFlowTabViews(
  favSet: ReadonlySet<string>,
  whaleFloorUsd: number,
): ToxicFlowTabWalletViews | null {
  const data = getSidebarToxicFlowSnapshot().data;
  if (!data) return null;
  const favKey = favSetKey(favSet);
  if (
    cache &&
    cache.data === data &&
    cache.favKey === favKey &&
    cache.whaleUsd === whaleFloorUsd
  ) {
    return cache.views;
  }
  const views = buildToxicFlowTabWalletViews(data, favSet, whaleFloorUsd);
  cache = { data, favKey, whaleUsd: whaleFloorUsd, views };
  return views;
}

export function useSidebarToxicFlowTabViews(
  favSet: ReadonlySet<string>,
  whaleFloorUsd: number,
): ToxicFlowTabWalletViews | null {
  const digest = useSyncExternalStore(
    subscribeSidebarToxicFlow,
    () => getSidebarToxicFlowSnapshot().digest,
    () => getSidebarToxicFlowSnapshot().digest,
  );
  const favKey = favSetKey(favSet);
  return useMemo(
    () => resolveSidebarToxicFlowTabViews(favSet, whaleFloorUsd),
    [digest, favKey, whaleFloorUsd, favSet],
  );
}
