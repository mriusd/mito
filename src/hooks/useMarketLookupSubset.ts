import { useCallback, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';

/** Shallow subset of store `marketLookup` keyed by CLOB token IDs — avoids re-render on unrelated rows. */
export function useMarketLookupSubset(tokenIds: readonly string[]): Record<string, Market> {
  const dep = [...tokenIds].filter(Boolean).join('\u0001');
  const uniq = useMemo(() => [...new Set(tokenIds.filter(Boolean).map(String))].sort(), [dep]);

  const sel = useCallback(
    (state: { marketLookup: Record<string, Market> }) => {
      const ml = state.marketLookup;
      const o: Record<string, Market> = {};
      for (const id of uniq) {
        const m = ml[id];
        if (m) o[id] = m;
      }
      return o;
    },
    [uniq.join('\u0001')],
  );

  return useAppStore(useShallow(sel));
}
