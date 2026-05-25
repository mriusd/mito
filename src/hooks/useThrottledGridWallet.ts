import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../stores/appStore';
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
