import { memo } from 'react';
import { extractAssetFromMarket } from '../utils/format';
import { ChainlinkChart } from './ChainlinkChart';
import { LiveTradeChart } from './LiveTradeChart';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import type { Market } from '../types';

export type SidebarChartsRowProps = {
  selectedMarket: Market;
  isUpDownMarket: boolean;
  upDownAsset: string | null;
  upDownIntervalContext: string | undefined;
  upDownTargetPrice: number | null;
  upDownSpotUsesChainlink: boolean;
  displayLiveTrades: LiveTrade[];
  orderOutcome: 'YES' | 'NO';
  upDownStartTime: number | null | undefined;
  upDownKlineDefaultInterval: string | undefined;
};

function chartsRowInner({
  selectedMarket,
  isUpDownMarket,
  upDownAsset,
  upDownIntervalContext,
  upDownTargetPrice,
  upDownSpotUsesChainlink,
  displayLiveTrades,
  orderOutcome,
  upDownStartTime,
  upDownKlineDefaultInterval,
}: SidebarChartsRowProps) {
  const chartAsset = isUpDownMarket ? upDownAsset : extractAssetFromMarket(selectedMarket);
  return (
    <div className="sidebar-chart-row">
      {chartAsset ? (
        <ChainlinkChart
          asset={chartAsset}
          intervalContext={upDownIntervalContext}
          targetPrice={isUpDownMarket ? upDownTargetPrice : undefined}
          chainlinkCandles={isUpDownMarket && upDownSpotUsesChainlink}
        />
      ) : null}

      {isUpDownMarket ? (
        <LiveTradeChart
          trades={displayLiveTrades}
          isNo={orderOutcome === 'NO'}
          tokenId={selectedMarket.clobTokenIds?.[0] || ''}
          startTime={upDownStartTime ?? undefined}
          endTime={selectedMarket.endDate ? new Date(selectedMarket.endDate).getTime() : undefined}
          intervalContext={upDownIntervalContext}
          defaultIntervalOverride={upDownKlineDefaultInterval}
          chainlinkAsset={upDownAsset || undefined}
          targetPrice={upDownTargetPrice}
          hidePriceLines
        />
      ) : (
        <LiveTradeChart
          trades={displayLiveTrades}
          isNo={orderOutcome === 'NO'}
          tokenId={selectedMarket.clobTokenIds?.[0] || ''}
          endTime={selectedMarket.endDate ? new Date(selectedMarket.endDate).getTime() : undefined}
          defaultIntervalOverride="5m"
          hidePriceLines
        />
      )}
    </div>
  );
}

export const SidebarChartsRow = memo(chartsRowInner);
