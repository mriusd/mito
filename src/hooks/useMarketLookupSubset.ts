import { useCallback, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { Market } from '../types';
import { normalizeClobTokenId } from '../utils/format';
import { useAppStore } from '../stores/appStore';

function sortedUniqIds(tokenIds: readonly string[]): string[] {
  const s = new Set<string>();
  for (const id of tokenIds) {
    const t = String(id || '').trim();
    if (t) s.add(t);
  }
  return [...s].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Shallow subset of store `marketLookup` keyed by CLOB token IDs — avoids re-render on unrelated rows. */
export function useMarketLookupSubset(tokenIds: readonly string[]): Record<string, Market> {
  const uniqRef = useRef<string[]>([]);
  const nextUniq = sortedUniqIds(tokenIds);
  const prevUniq = uniqRef.current;
  const uniq =
    prevUniq.length === nextUniq.length && prevUniq.every((v, i) => v === nextUniq[i])
      ? prevUniq
      : (uniqRef.current = nextUniq);

  const sel = useCallback(
    (state: { marketLookup: Record<string, Market> }) => {
      const ml = state.marketLookup;
      const o: Record<string, Market> = {};
      for (const id of uniq) {
        const m = ml[id] || ml[normalizeClobTokenId(id)];
        if (m) o[id] = m;
      }
      return o;
    },
    [uniq],
  );

  return useAppStore(useShallow(sel));
}
