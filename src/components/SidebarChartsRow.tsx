import { memo, useMemo } from 'react';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import type { Market } from '../types';
import type { MyTradeChartRow } from '../lib/chartTradeMarkers';
import { usePolymarketChartTrades } from '../hooks/usePolymarketChartTrades';
import { SidebarRightLiveTradeChart } from './SidebarRightLiveTradeChart';

export type SidebarChartsRowProps = {
  selectedMarket: Market;
  onchainLiveTrades: LiveTrade[];
  orderOutcome: 'YES' | 'NO';
  onOrderOutcomeChange: (value: 'YES' | 'NO') => void;
  chartOutcomeSync: boolean;
  onChartOutcomeSyncChange: (enabled: boolean) => void;
  myTradesForMarkers?: MyTradeChartRow[];
};

function SidebarChartsRowInner({
  selectedMarket,
  onchainLiveTrades,
  orderOutcome,
  onOrderOutcomeChange,
  chartOutcomeSync,
  onChartOutcomeSyncChange,
  myTradesForMarkers,
}: SidebarChartsRowProps) {
  const displayLiveTrades = usePolymarketChartTrades(onchainLiveTrades);
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

export const SidebarChartsRow = memo(SidebarChartsRowInner);
