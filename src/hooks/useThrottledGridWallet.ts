import { useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../stores/appStore';
import { getPositionClobTokenId, normalizeClobTokenId } from '../utils/format';
import type { Order } from '../types';

type GridPosition = ReturnType<typeof useAppStore.getState>['positions'][number];
type OnchainGridPosition = ReturnType<typeof useAppStore.getState>['onchainGridPositions'][number];

export function useThrottledGridOrders(ms = 2000): Order[] {
  const live = useAppStore((s) => s.orders);
  const [throttled, setThrottled] = useState(live);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    const id = window.setTimeout(() => setThrottled(liveRef.current), ms);
    return () => window.clearTimeout(id);
  }, [live, ms]);

  return throttled;
}

export function useThrottledGridPositions(ms = 2000): GridPosition[] {
  const live = useAppStore((s) => s.positions);
  const [throttled, setThrottled] = useState(live);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    const id = window.setTimeout(() => setThrottled(liveRef.current), ms);
    return () => window.clearTimeout(id);
  }, [live, ms]);

  return throttled;
}

export function useThrottledOnchainGridPositions(ms = 2000): OnchainGridPosition[] {
  const live = useAppStore((s) => s.onchainGridPositions);
  const [throttled, setThrottled] = useState(live);
  const liveRef = useRef(live);
  liveRef.current = live;

  useEffect(() => {
    const id = window.setTimeout(() => setThrottled(liveRef.current), ms);
    return () => window.clearTimeout(id);
  }, [live, ms]);

  return throttled;
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
