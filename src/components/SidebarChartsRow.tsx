import { memo, useMemo } from 'react';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import { useSidebarPolymarketTape } from '../lib/sidebarPolymarketTapeStore';
import type { Market } from '../types';
import type { MyTradeChartRow } from '../lib/chartTradeMarkers';
import { SidebarRightLiveTradeChart } from './SidebarRightLiveTradeChart';

export type SidebarChartsRowProps = {
  selectedMarket: Market;
  onchainLiveTrades: LiveTrade[];
  liveTradesSource: string;
  orderOutcome: 'YES' | 'NO';
  onOrderOutcomeChange: (value: 'YES' | 'NO') => void;
  chartOutcomeSync: boolean;
  onChartOutcomeSyncChange: (enabled: boolean) => void;
  myTradesForMarkers?: MyTradeChartRow[];
};

function chartsRowInner({
  selectedMarket,
  onchainLiveTrades,
  liveTradesSource,
  orderOutcome,
  onOrderOutcomeChange,
  chartOutcomeSync,
  onChartOutcomeSyncChange,
  myTradesForMarkers,
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
        myTradesForMarkers={myTradesForMarkers}
        intervalSelector="dropdown"
        outcomeSync={outcomeSync}
        orderOutcome={orderOutcome}
        onOrderOutcomeChange={onOrderOutcomeChange}
        volumeSpikeAlerts
      />
    </div>
  );
}

export const SidebarChartsRow = memo(chartsRowInner);
