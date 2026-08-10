import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Market } from '../types';
import {
  getBidAskMarketRow,
  subscribeBidAskMarketLookup,
} from '../lib/bidAskMarketLookup';

/** Quote-only equality — ignore volume/holders noise so we always wake on real book moves. */
function quoteSidesEqual(a: Market | undefined, b: Market | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.bestBid === b.bestBid && a.bestAsk === b.bestAsk;
}

function subsetQuoteEqual(prev: Record<string, Market>, next: Record<string, Market>): boolean {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const id of keys) {
    if (!quoteSidesEqual(prev[id], next[id])) return false;
  }
  return true;
}

function readBidAskSubset(ids: readonly string[]): Record<string, Market> {
  const out: Record<string, Market> = {};
  for (const id of ids) {
    const row = getBidAskMarketRow(id);
    if (!row) continue;
    out[id] = row;
    // Dual-key so outcomeBidAskProb finds the row under raw or BigInt form.
    try {
      const norm = BigInt(id).toString();
      if (norm !== id) out[norm] = row;
    } catch {
      /* not an int token */
    }
  }
  return out;
}

/** Unthrottled WS bid/ask subset — pending patch via `getBidAskMarketRow` (notify / flash gates). */
export function useLiveBidAskLookupSubset(tokenIds: readonly string[]): Record<string, Market> {
  return useBidAskLookupSubset(tokenIds, 0);
}

/** Bid/ask subset; `ms > 0` coalesces WS patches (TPO / heavy panels). */
export function useThrottledBidAskLookupSubset(
  tokenIds: readonly string[],
  ms = 500,
): Record<string, Market> {
  return useBidAskLookupSubset(tokenIds, ms);
}

/**
 * Forces TPO (and similar) tables to re-paint Bid/Mid/Ask.
 * Rows should call getBidAskMarketRow / resolveTpoRowLiveQuote at paint time —
 * do not bake quotes into a heavy memo that can lag under load.
 *
 * - Live WS notify → ~50ms coalesce
 * - Backup poll every 500ms (never multi-minute freeze)
 */
export function useTpoQuoteEpoch(enabled: boolean): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      timer = null;
      setTick((n) => n + 1);
    };
    const onPatch = () => {
      if (timer != null) return;
      timer = setTimeout(bump, 50);
    };
    const unsub = subscribeBidAskMarketLookup(onPatch);
    const poll = window.setInterval(bump, 500);
    bump();
    return () => {
      unsub();
      window.clearInterval(poll);
      if (timer != null) clearTimeout(timer);
    };
  }, [enabled]);

  return tick;
}

/**
 * TPO Bid/Mid/Ask lookup map — re-reads pending/store on each tick.
 * Prefer useTpoQuoteEpoch + resolveTpoRowLiveQuote at row paint for lowest lag.
 */
export function useTpoLiveQuoteLookup(
  tokenIds: readonly string[],
  enabled: boolean,
): Record<string, Market> {
  const idsKey = tokenIds.join('\0');
  const ids = useMemo(() => tokenIds.filter(Boolean), [idsKey]);
  const tick = useTpoQuoteEpoch(enabled);

  return useMemo(() => {
    void tick;
    return readBidAskSubset(ids);
  }, [ids, tick]);
}

function useBidAskLookupSubset(tokenIds: readonly string[], ms: number): Record<string, Market> {
  const idsKey = tokenIds.join('\0');
  const ids = useMemo(() => tokenIds.filter(Boolean), [idsKey]);

  const readSubset = useCallback((): Record<string, Market> => readBidAskSubset(ids), [ids]);

  const [subset, setSubset] = useState(readSubset);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const apply = () => {
      timer = null;
      setSubset((prev) => {
        const latest = readSubset();
        return subsetQuoteEqual(prev, latest) ? prev : latest;
      });
    };

    const onPatch = () => {
      if (ms <= 0) {
        apply();
        return;
      }
      if (timer != null) return;
      timer = setTimeout(apply, ms);
    };

    const unsub = subscribeBidAskMarketLookup(onPatch);
    apply();
    return () => {
      unsub();
      if (timer != null) clearTimeout(timer);
    };
  }, [readSubset, ms]);

  return subset;
}
