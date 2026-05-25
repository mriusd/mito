import { memo, useMemo } from 'react';
import type { Market } from '../types';
import { usePolymarketChartTrades } from '../hooks/usePolymarketChartTrades';
import { useSidebarMyTradesChartMarkers } from '../hooks/useSidebarMyTradesChartMarkers';
import { SidebarRightLiveTradeChart } from './SidebarRightLiveTradeChart';

export type SidebarChartsRowProps = {
  selectedMarket: Market;
  orderOutcome: 'YES' | 'NO';
  onOrderOutcomeChange: (value: 'YES' | 'NO') => void;
  chartOutcomeSync: boolean;
  onChartOutcomeSyncChange: (enabled: boolean) => void;
  marketLookup: Record<string, Market>;
};

function SidebarChartsRowInner({
  selectedMarket,
  orderOutcome,
  onOrderOutcomeChange,
  chartOutcomeSync,
  onChartOutcomeSyncChange,
  marketLookup,
}: SidebarChartsRowProps) {
  const displayLiveTrades = usePolymarketChartTrades();
  const myTradesForMarkers = useSidebarMyTradesChartMarkers(selectedMarket, marketLookup);
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
