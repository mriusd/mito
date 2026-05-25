import { useMemo } from 'react';
import type { LiveTrade } from './usePolymarketOB';
import { useAppStore } from '../stores/appStore';
import { useSidebarPolymarketTape } from '../lib/sidebarPolymarketTapeStore';
import { useSidebarOnchainLiveTrades } from '../lib/sidebarOnchainTradesStore';

/** Chart trade tape — isolated from parent re-renders. */
export function usePolymarketChartTrades(): LiveTrade[] {
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const polymarketTape = useSidebarPolymarketTape();
  const onchainTape = useSidebarOnchainLiveTrades();
  return useMemo(
    () => (liveTradesSource === 'onchain' ? onchainTape : polymarketTape),
    [liveTradesSource, onchainTape, polymarketTape],
  );
}
