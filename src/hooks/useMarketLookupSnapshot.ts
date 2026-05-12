import { useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import type { Market } from '../types';

/** One scalar subscription (`marketLookupEpoch`) — avoid subscribing to `marketLookup` object identity on every bid/ask WS flush. */
export function useMarketLookupSnapshot(): Record<string, Market> {
  const epoch = useAppStore((s) => s.marketLookupEpoch);
  return useMemo(() => useAppStore.getState().marketLookup, [epoch]);
}
