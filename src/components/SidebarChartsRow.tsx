import { memo, useMemo } from 'react';
import type { Market } from '../types';
import { useThrottledPolymarketChartTrades } from '../hooks/useThrottledPolymarketChartTrades';
import { useSidebarMyTradesChartMarkers } from '../hooks/useSidebarMyTradesChartMarkers';
import { SidebarRightLiveTradeChart } from './SidebarRightLiveTradeChart';
import { useSidebarOrderHighlightSets } from '../lib/sidebarOrderHighlightStore';
import { useAppStore } from '../stores/appStore';
import { getOrderClobTokenId, outcomeTokenBelongsToSelectedMarket } from '../utils/format';
import type { ChartOrderReplaceParams } from '../lib/sidebarOrderbookAggregate';
import { computeSidebarMyPositions, isSidebarDustPosition } from '../lib/sidebarMyPositions';
import { useSidebarOnchainWalletPositions } from '../lib/sidebarOnchainTradesStore';

const SidebarChartsRowChart = memo(function SidebarChartsRowChart({
  selectedMarket,
  orderOutcome,
  onOrderOutcomeChange,
  chartOutcomeSync,
  onChartOutcomeSyncChange,
  marketLookup,
  onChartOrderReplace,
}: {
  selectedMarket: Market;
  orderOutcome: 'YES' | 'NO';
  onOrderOutcomeChange: (value: 'YES' | 'NO') => void;
  chartOutcomeSync: boolean;
  onChartOutcomeSyncChange: (enabled: boolean) => void;
  marketLookup: Record<string, Market>;
  onChartOrderReplace?: (params: ChartOrderReplaceParams) => void;
}) {
  const { bidPrices: sidebarUserBidPrices, askPrices: sidebarUserAskPrices } = useSidebarOrderHighlightSets();
  const orders = useAppStore((s) => s.orders);
  const positions = useAppStore((s) => s.positions);
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const onchainWsPositions = useSidebarOnchainWalletPositions();
  const progOrderMap = useAppStore((s) => s.progOrderMap) as Record<string, number>;
  const sidebarChartPositions = useMemo(() => {
    const rows = computeSidebarMyPositions(
      liveTradesSource,
      positions,
      selectedMarket,
      marketLookup,
      onchainWsPositions,
    );
    return rows.filter((p) => !isSidebarDustPosition(p.size || 0));
  }, [liveTradesSource, positions, selectedMarket, marketLookup, onchainWsPositions]);
  const sidebarChartOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          !progOrderMap[o.id] &&
          outcomeTokenBelongsToSelectedMarket(getOrderClobTokenId(o), selectedMarket, marketLookup),
      ),
    [orders, progOrderMap, selectedMarket, marketLookup],
  );
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
      sidebarChartOrders={sidebarChartOrders}
      sidebarChartPositions={sidebarChartPositions}
      onChartOrderReplace={onChartOrderReplace}
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
  onChartOrderReplace?: (params: ChartOrderReplaceParams) => void;
};

function SidebarChartsRowInner({
  selectedMarket,
  orderOutcome,
  onOrderOutcomeChange,
  chartOutcomeSync,
  onChartOutcomeSyncChange,
  marketLookup,
  onChartOrderReplace,
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
        onChartOrderReplace={onChartOrderReplace}
      />
    </div>
  );
}

export const SidebarChartsRow = memo(SidebarChartsRowInner);
