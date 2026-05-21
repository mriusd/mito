import { memo, useMemo } from 'react';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import { useSidebarPolymarketTape } from '../lib/sidebarPolymarketTapeStore';
import type { Market } from '../types';
import { SidebarRightLiveTradeChart } from './SidebarRightLiveTradeChart';

export type SidebarChartsRowProps = {
  selectedMarket: Market;
  onchainLiveTrades: LiveTrade[];
  liveTradesSource: string;
};

function chartsRowInner({
  selectedMarket,
  onchainLiveTrades,
  liveTradesSource,
}: SidebarChartsRowProps) {
  const polymarketTape = useSidebarPolymarketTape();
  const displayLiveTrades = useMemo(
    () => (liveTradesSource === 'onchain' ? onchainLiveTrades : polymarketTape),
    [liveTradesSource, onchainLiveTrades, polymarketTape],
  );
  return (
    <div className="sidebar-chart-row">
      <SidebarRightLiveTradeChart
        market={selectedMarket}
        trades={displayLiveTrades}
        intervalSelector="dropdown"
      />
    </div>
  );
}

export const SidebarChartsRow = memo(chartsRowInner);
