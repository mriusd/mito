import { memo, useMemo } from 'react';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import { useSidebarPolymarketTape } from '../lib/sidebarPolymarketTapeStore';
import type { Market } from '../types';
import { SidebarRightLiveTradeChart } from './SidebarRightLiveTradeChart';

export type SidebarChartsRowProps = {
  selectedMarket: Market;
  onchainLiveTrades: LiveTrade[];
  liveTradesSource: string;
  orderOutcome: 'YES' | 'NO';
  onOrderOutcomeChange: (value: 'YES' | 'NO') => void;
  chartOutcomeSync: boolean;
  onChartOutcomeSyncChange: (enabled: boolean) => void;
};

function chartsRowInner({
  selectedMarket,
  onchainLiveTrades,
  liveTradesSource,
  orderOutcome,
  onOrderOutcomeChange,
  chartOutcomeSync,
  onChartOutcomeSyncChange,
}: SidebarChartsRowProps) {
  const polymarketTape = useSidebarPolymarketTape();
  const displayLiveTrades = useMemo(
    () => (liveTradesSource === 'onchain' ? onchainLiveTrades : polymarketTape),
    [liveTradesSource, onchainLiveTrades, polymarketTape],
  );
  const outcomeSync = useMemo(
    () => ({
      enabled: chartOutcomeSync,
      onToggle: () => onChartOutcomeSyncChange(!chartOutcomeSync),
    }),
    [chartOutcomeSync, onChartOutcomeSyncChange],
  );
  return (
    <div className="sidebar-chart-row">
      <SidebarRightLiveTradeChart
        market={selectedMarket}
        trades={displayLiveTrades}
        intervalSelector="dropdown"
        outcomeSync={outcomeSync}
        orderOutcome={orderOutcome}
        onOrderOutcomeChange={onOrderOutcomeChange}
      />
    </div>
  );
}

export const SidebarChartsRow = memo(chartsRowInner);
