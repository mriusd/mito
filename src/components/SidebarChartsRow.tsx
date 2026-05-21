import { memo, useMemo } from 'react';
import { extractAssetFromMarket } from '../utils/format';
import { ChainlinkChart } from './ChainlinkChart';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import { useSidebarPolymarketTape } from '../lib/sidebarPolymarketTapeStore';
import type { Market } from '../types';
import { SidebarRightLiveTradeChart } from './SidebarRightLiveTradeChart';

export type SidebarChartsRowProps = {
  selectedMarket: Market;
  isUpDownMarket: boolean;
  upDownAsset: string | null;
  upDownIntervalContext: string | undefined;
  upDownTargetPrice: number | null;
  upDownSpotUsesChainlink: boolean;
  onchainLiveTrades: LiveTrade[];
  liveTradesSource: string;
  orderOutcome: 'YES' | 'NO';
  upDownStartTime: number | null | undefined;
  upDownKlineDefaultInterval: string | undefined;
  volatilityLookbackCandles: number;
  onSidebarChartAnnualVolPct: (pct: number | null) => void;
};

function chartsRowInner({
  selectedMarket,
  isUpDownMarket,
  upDownAsset,
  upDownIntervalContext,
  upDownTargetPrice,
  upDownSpotUsesChainlink,
  onchainLiveTrades,
  liveTradesSource,
  orderOutcome,
  volatilityLookbackCandles,
  onSidebarChartAnnualVolPct,
}: SidebarChartsRowProps) {
  const polymarketTape = useSidebarPolymarketTape();
  const displayLiveTrades = useMemo(
    () => (liveTradesSource === 'onchain' ? onchainLiveTrades : polymarketTape),
    [liveTradesSource, onchainLiveTrades, polymarketTape],
  );
  const chartAsset = isUpDownMarket ? upDownAsset : extractAssetFromMarket(selectedMarket);
  return (
    <div className="sidebar-chart-row">
      {chartAsset ? (
        <ChainlinkChart
          asset={chartAsset}
          intervalContext={upDownIntervalContext}
          targetPrice={isUpDownMarket ? upDownTargetPrice : undefined}
          chainlinkCandles={isUpDownMarket && upDownSpotUsesChainlink}
          volatilityLookbackCandles={volatilityLookbackCandles}
          onAnnualizedVolPct={onSidebarChartAnnualVolPct}
        />
      ) : null}

      <SidebarRightLiveTradeChart
        market={selectedMarket}
        trades={displayLiveTrades}
        isNo={orderOutcome === 'NO'}
        intervalSelector="dropdown"
      />
    </div>
  );
}

export const SidebarChartsRow = memo(chartsRowInner);
