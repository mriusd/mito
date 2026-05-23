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
  xKey: string;
  whaleUsd: number;
  views: ToxicFlowTabWalletViews;
} | null = null;

function setKey(s: ReadonlySet<string>): string {
  if (s.size === 0) return '';
  return [...s].sort().join('\0');
}

export function clearSidebarToxicFlowTabViewsCache(): void {
  cache = null;
}

export function resolveSidebarToxicFlowTabViews(
  favSet: ReadonlySet<string>,
  whaleFloorUsd: number,
  xSet: ReadonlySet<string> = new Set(),
): ToxicFlowTabWalletViews | null {
  const data = getSidebarToxicFlowSnapshot().data;
  if (!data) return null;
  const favKey = setKey(favSet);
  const xKey = setKey(xSet);
  if (
    cache &&
    cache.data === data &&
    cache.favKey === favKey &&
    cache.xKey === xKey &&
    cache.whaleUsd === whaleFloorUsd
  ) {
    return cache.views;
  }
  const views = buildToxicFlowTabWalletViews(data, favSet, whaleFloorUsd, xSet);
  cache = { data, favKey, xKey, whaleUsd: whaleFloorUsd, views };
  return views;
}

export function useSidebarToxicFlowTabViews(
  favSet: ReadonlySet<string>,
  whaleFloorUsd: number,
  xSet: ReadonlySet<string> = new Set(),
): ToxicFlowTabWalletViews | null {
  const digest = useSyncExternalStore(
    subscribeSidebarToxicFlow,
    () => getSidebarToxicFlowSnapshot().digest,
    () => getSidebarToxicFlowSnapshot().digest,
  );
  const favKey = setKey(favSet);
  const xKey = setKey(xSet);
  return useMemo(
    () => resolveSidebarToxicFlowTabViews(favSet, whaleFloorUsd, xSet),
    [digest, favKey, xKey, whaleFloorUsd, favSet, xSet],
  );
}
