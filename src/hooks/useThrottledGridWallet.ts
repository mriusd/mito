import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { getPositionClobTokenId, normalizeClobTokenId } from '../utils/format';
import type { Order } from '../types';

type GridPosition = ReturnType<typeof useAppStore.getState>['positions'][number];
type OnchainGridPosition = ReturnType<typeof useAppStore.getState>['onchainGridPositions'][number];

/**
 * Throttle store slice without selecting live via useAppStore (that re-renders every write).
 * Subscribe + delayed setState only.
 */
function useThrottledAppSlice<T>(select: (s: ReturnType<typeof useAppStore.getState>) => T, ms: number): T {
  const [value, setValue] = useState(() => select(useAppStore.getState()));

  useEffect(() => {
    let latest = select(useAppStore.getState());
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      setValue((prev) => (Object.is(prev, latest) ? prev : latest));
    };

    const schedule = () => {
      if (timer != null) return;
      timer = setTimeout(flush, ms);
    };

    // Prime once in case we mounted mid-stream.
    schedule();
    const unsub = useAppStore.subscribe((state) => {
      const next = select(state);
      if (Object.is(next, latest)) return;
      latest = next;
      schedule();
    });

    return () => {
      unsub();
      if (timer != null) clearTimeout(timer);
    };
  }, [select, ms]);

  return value;
}

const selectOrders = (s: ReturnType<typeof useAppStore.getState>) => s.orders;
const selectPositions = (s: ReturnType<typeof useAppStore.getState>) => s.positions;
const selectTrades = (s: ReturnType<typeof useAppStore.getState>) => s.trades;
const selectOnchainGridPositions = (s: ReturnType<typeof useAppStore.getState>) => s.onchainGridPositions;

export function useThrottledGridOrders(ms = 2000): Order[] {
  return useThrottledAppSlice(selectOrders, ms);
}

export function useThrottledGridPositions(ms = 2000): GridPosition[] {
  return useThrottledAppSlice(selectPositions, ms);
}

export function useThrottledGridTrades(ms = 2000): ReturnType<typeof useAppStore.getState>['trades'] {
  return useThrottledAppSlice(selectTrades, ms);
}

export function useThrottledOnchainGridPositions(ms = 2000): OnchainGridPosition[] {
  return useThrottledAppSlice(selectOnchainGridPositions, ms);
}

/** Grid dots: Polymarket API positions + onchain wallet snapshot (onchain wins same token). */
export function buildGridPositionLookup(
  positions: GridPosition[],
  onchainGridPositions: OnchainGridPosition[],
  liveTradesSource: string,
): Record<string, { size: number }> {
  const lookup: Record<string, { size: number }> = {};
  const put = (tid: string, size: number) => {
    const k = normalizeClobTokenId(tid);
    if (k && Math.abs(size) > 1e-9) lookup[k] = { size: Math.abs(size) };
  };
  for (const pos of positions) {
    put(getPositionClobTokenId(pos), pos.size || 0);
  }
  if (liveTradesSource === 'onchain') {
    for (const p of onchainGridPositions) {
      put(p.tokenId, p.size);
    }
  }
  return lookup;
}

export function useGridPositionLookup(ms = 2000): Record<string, { size: number }> {
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const positions = useThrottledGridPositions(ms);
  const onchainGridPositions = useThrottledOnchainGridPositions(ms);
  return useMemo(
    () => buildGridPositionLookup(positions, onchainGridPositions, liveTradesSource),
    [positions, onchainGridPositions, liveTradesSource],
  );
}
