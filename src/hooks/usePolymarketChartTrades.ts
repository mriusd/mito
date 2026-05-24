import { useMemo } from 'react';
import type { LiveTrade } from './usePolymarketOB';
import { useAppStore } from '../stores/appStore';
import { useSidebarPolymarketTape } from '../lib/sidebarPolymarketTapeStore';

/** Chart trade tape — isolated from parent re-renders. */
export function usePolymarketChartTrades(onchainTrades: LiveTrade[] = []): LiveTrade[] {
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const polymarketTape = useSidebarPolymarketTape();
  return useMemo(
    () => (liveTradesSource === 'onchain' ? onchainTrades : polymarketTape),
    [liveTradesSource, onchainTrades, polymarketTape],
  );
}
