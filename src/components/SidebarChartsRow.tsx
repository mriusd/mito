import { memo, useMemo } from 'react';
import type { Market } from '../types';
import { useThrottledPolymarketChartTrades } from '../hooks/useThrottledPolymarketChartTrades';
import { useSidebarMyTradesChartMarkers } from '../hooks/useSidebarMyTradesChartMarkers';
import { SidebarRightLiveTradeChart } from './SidebarRightLiveTradeChart';
import { useSidebarOrderHighlightSets } from '../lib/sidebarOrderHighlightStore';

const SidebarChartsRowChart = memo(function SidebarChartsRowChart({
  selectedMarket,
  orderOutcome,
  onOrderOutcomeChange,
  chartOutcomeSync,
  onChartOutcomeSyncChange,
  marketLookup,
}: {
  selectedMarket: Market;
  orderOutcome: 'YES' | 'NO';
  onOrderOutcomeChange: (value: 'YES' | 'NO') => void;
  chartOutcomeSync: boolean;
  onChartOutcomeSyncChange: (enabled: boolean) => void;
  marketLookup: Record<string, Market>;
}) {
  const { bidPrices: sidebarUserBidPrices, askPrices: sidebarUserAskPrices } = useSidebarOrderHighlightSets();
  const displayLiveTrades = useThrottledPolymarketChartTrades(500);
  const myTradesForMarkers = useSidebarMyTradesChartMarkers(selectedMarket, marketLookup);
  const outcomeSync = useMemo(
    () => ({
      enabled: chartOutcomeSync,
      onToggle: () => onChartOutcomeSyncChange(!chartOutcomeSync),
    }),
    [chartOutcomeSync, onChartOutcomeSyncChange],
  );
  return (
    <SidebarRightLiveTradeChart
      market={selectedMarket}
      trades={displayLiveTrades}
      myTradesForMarkers={myTradesForMarkers}
      intervalSelector="dropdown"
      outcomeSync={outcomeSync}
      orderOutcome={orderOutcome}
      onOrderOutcomeChange={onOrderOutcomeChange}
      volumeSpikeAlerts
      sidebarUserBidPrices={sidebarUserBidPrices}
      sidebarUserAskPrices={sidebarUserAskPrices}
    />
  );
});

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
  return (
    <div className="sidebar-chart-row">
      <SidebarChartsRowChart
        selectedMarket={selectedMarket}
        orderOutcome={orderOutcome}
        onOrderOutcomeChange={onOrderOutcomeChange}
        chartOutcomeSync={chartOutcomeSync}
        onChartOutcomeSyncChange={onChartOutcomeSyncChange}
        marketLookup={marketLookup}
      />
    </div>
  );
}

export const SidebarChartsRow = memo(SidebarChartsRowInner);
