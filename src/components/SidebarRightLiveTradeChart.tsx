import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchMarketOutcomeTokens } from '../api';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import type { Market } from '../types';
import { extractAssetFromMarket } from '../utils/format';
import { effectiveMarketExpiryMs, weatherMarketChartStartMs } from '../lib/weatherMarketExpiry';
import { isWeatherMarket } from '../utils/format';
import { walletInfoChartMarketWithOutcomeTokens } from '../lib/walletInfoChartMarket';
import { LiveTradeChart } from './LiveTradeChart';
import {
  buildChartTradeMarkersFromLedgerFills,
  buildChartTradeMarkersFromMyTrades,
  type ChartTradeMarker,
  type LedgerFillChartRow,
  type MyTradeChartRow,
} from '../lib/chartTradeMarkers';
import {
  buildSidebarChartOrderLevels,
  buildSidebarChartPositionLevels,
  type ChartOrderReplaceParams,
} from '../lib/sidebarOrderbookAggregate';
import type { Order } from '../types';

export type { ChartTradeMarker, LedgerFillChartRow, MyTradeChartRow };

function marketIsUpDown(market: { question?: string; eventSlug?: string } | null | undefined): boolean {
  return !!(market?.question?.match(/up\s+or\s+down/i) || market?.eventSlug?.match(/up-or-down|updown/i));
}

function upDownIntervalContextFromMarket(market: Market): string | undefined {
  if (!marketIsUpDown(market)) return undefined;
  return `${market.eventSlug || ''} ${market.question || ''} ${market.groupItemTitle || ''}`.trim();
}

function upDownKlineDefaultIntervalFromMarket(market: Market): string | undefined {
  if (!marketIsUpDown(market)) return undefined;
  const combined = `${market.eventSlug || ''} ${market.question || ''}`;
  if (combined.match(/updown-5m/i) || combined.match(/\b5[- ]?min/i)) return '5s';
  if (combined.match(/updown-15m/i) || combined.match(/\b15[- ]?min/i)) return '1m';
  if (combined.match(/updown-4h/i) || combined.match(/\b4[- ]?h/i)) return '15m';
  if (combined.match(/up-or-down-on-/i) || combined.match(/\b24[- ]?h/i)) return '15m';
  return '5m';
}

function upDownStartTimeFromMarket(market: Market): number {
  if (!marketIsUpDown(market) || !market.endDate) return 0;
  const endMs = new Date(market.endDate).getTime();
  if (Number.isNaN(endMs)) return 0;
  const combined = `${market.eventSlug || ''} ${market.question || ''}`;
  let intervalMs = 60 * 60 * 1000;
  if (combined.match(/updown-5m/i) || combined.match(/\b5[- ]?min/i)) intervalMs = 5 * 60 * 1000;
  else if (combined.match(/updown-15m/i) || combined.match(/\b15[- ]?min/i)) intervalMs = 15 * 60 * 1000;
  else if (combined.match(/updown-4h/i) || combined.match(/\b4[- ]?h/i)) intervalMs = 4 * 60 * 60 * 1000;
  else if (combined.match(/up-or-down-on-/i) || combined.match(/\b24[- ]?h/i)) intervalMs = 24 * 60 * 60 * 1000;
  return endMs - intervalMs;
}

export type SidebarRightLiveTradeChartProps = {
  market: Market;
  trades?: LiveTrade[];
  tradeMarkers?: ChartTradeMarker[];
  /** Build triangle markers from sidebar My Trades (uses chart YES/NO view). */
  myTradesForMarkers?: MyTradeChartRow[];
  /** Build triangle markers from wallet fill ledger rows (uses chart YES/NO view). */
  ledgerFillsForMarkers?: LedgerFillChartRow[];
  className?: string;
  chartStartTime?: number;
  chartEndTime?: number;
  intervalSelector?: 'buttons' | 'dropdown';
  chartOutcome?: 'YES' | 'NO';
  onChartOutcomeChange?: (value: 'YES' | 'NO') => void;
  outcomeSync?: { enabled: boolean; onToggle: () => void };
  orderOutcome?: 'YES' | 'NO';
  onOrderOutcomeChange?: (value: 'YES' | 'NO') => void;
  volumeSpikeAlerts?: boolean;
  sidebarUserBidPrices?: Set<string>;
  sidebarUserAskPrices?: Set<string>;
  /** My Orders for selected market (non-prog) — chart horizontal lines. */
  sidebarChartOrders?: Order[];
  onChartOrderReplace?: (params: ChartOrderReplaceParams) => void;
  sidebarChartPositions?: { asset: string; size: number; avgPrice: number }[];
};

export const SidebarRightLiveTradeChart = memo(function SidebarRightLiveTradeChart({
  market,
  trades = [],
  tradeMarkers: tradeMarkersProp,
  myTradesForMarkers,
  ledgerFillsForMarkers,
  className,
  chartStartTime,
  chartEndTime,
  intervalSelector = 'buttons',
  chartOutcome: chartOutcomeProp,
  onChartOutcomeChange,
  outcomeSync,
  orderOutcome,
  onOrderOutcomeChange,
  volumeSpikeAlerts = false,
  sidebarUserBidPrices,
  sidebarUserAskPrices,
  sidebarChartOrders,
  onChartOrderReplace,
  sidebarChartPositions,
}: SidebarRightLiveTradeChartProps) {
  const marketId = (market.conditionId || market.id || '').trim();
  const storeYesTokenId = market.clobTokenIds?.[0]?.trim() || '';
  const [fetchedYesTokenId, setFetchedYesTokenId] = useState('');
  const [fetchedNoTokenId, setFetchedNoTokenId] = useState('');

  useEffect(() => {
    if (storeYesTokenId) {
      setFetchedYesTokenId('');
      setFetchedNoTokenId('');
      return;
    }
    if (!marketId) {
      setFetchedYesTokenId('');
      setFetchedNoTokenId('');
      return;
    }
    let cancelled = false;
    setFetchedYesTokenId('');
    setFetchedNoTokenId('');
    void fetchMarketOutcomeTokens(marketId)
      .then((tok) => {
        if (cancelled) return;
        setFetchedYesTokenId((tok?.tokenIdYes || '').trim());
        setFetchedNoTokenId((tok?.tokenIdNo || '').trim());
      })
      .catch(() => {
        if (!cancelled) {
          setFetchedYesTokenId('');
          setFetchedNoTokenId('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [marketId, storeYesTokenId]);

  const chartMarket = useMemo(() => {
    if (storeYesTokenId) return market;
    return walletInfoChartMarketWithOutcomeTokens(market, fetchedYesTokenId, fetchedNoTokenId);
  }, [market, storeYesTokenId, fetchedYesTokenId, fetchedNoTokenId]);

  const isUpDownMarket = marketIsUpDown(chartMarket ?? market);
  const upDownAsset = isUpDownMarket ? extractAssetFromMarket(chartMarket ?? market) : null;
  const upDownIntervalContext = useMemo(
    () => upDownIntervalContextFromMarket(chartMarket ?? market),
    [chartMarket, market],
  );
  const upDownKlineDefaultInterval = useMemo(
    () => upDownKlineDefaultIntervalFromMarket(chartMarket ?? market),
    [chartMarket, market],
  );
  const upDownStartTime = useMemo(
    () => upDownStartTimeFromMarket(chartMarket ?? market),
    [chartMarket, market],
  );
  const weatherStartTime = useMemo(() => {
    const m = chartMarket ?? market;
    if (!isWeatherMarket(m)) return 0;
    return weatherMarketChartStartMs(m) ?? 0;
  }, [chartMarket, market]);
  const yesTokenId = chartMarket?.clobTokenIds?.[0] || '';
  const noTokenId = chartMarket?.clobTokenIds?.[1] || '';
  const [internalChartOutcome, setInternalChartOutcome] = useState<'YES' | 'NO'>('YES');
  const syncedToOrder = !!(outcomeSync?.enabled && orderOutcome != null);
  const chartOutcome = syncedToOrder ? orderOutcome! : chartOutcomeProp ?? internalChartOutcome;
  const setChartOutcome = useCallback(
    (value: 'YES' | 'NO') => {
      if (syncedToOrder) {
        onOrderOutcomeChange?.(value);
        return;
      }
      if (onChartOutcomeChange) {
        onChartOutcomeChange(value);
      } else {
        setInternalChartOutcome(value);
      }
    },
    [syncedToOrder, onOrderOutcomeChange, onChartOutcomeChange],
  );

  useEffect(() => {
    if (chartOutcomeProp !== undefined) return;
    setInternalChartOutcome('YES');
  }, [market.id, yesTokenId, noTokenId, chartOutcomeProp]);

  const tokenId = chartOutcome === 'YES' ? yesTokenId : noTokenId || yesTokenId;
  const endTime = useMemo(() => {
    if (chartEndTime != null) return chartEndTime;
    const m = chartMarket ?? market;
    const expiryMs = effectiveMarketExpiryMs(m);
    if (expiryMs != null) return expiryMs;
    return m.endDate ? new Date(m.endDate).getTime() : undefined;
  }, [chartEndTime, chartMarket, market]);
  const startTimeProp =
    chartStartTime ??
    (upDownStartTime > 0 ? upDownStartTime : weatherStartTime > 0 ? weatherStartTime : undefined);
  const yesLabel = isUpDownMarket ? 'UP' : 'YES';
  const noLabel = isUpDownMarket ? 'DOWN' : 'NO';

  const sidebarChartOrderLevels = useMemo(() => {
    if (!sidebarChartOrders?.length) return undefined;
    return buildSidebarChartOrderLevels(sidebarChartOrders, yesTokenId, noTokenId, chartOutcome);
  }, [sidebarChartOrders, yesTokenId, noTokenId, chartOutcome]);

  const sidebarChartPositionLevels = useMemo(() => {
    if (!sidebarChartPositions?.length) return undefined;
    return buildSidebarChartPositionLevels(sidebarChartPositions, yesTokenId, noTokenId, chartOutcome);
  }, [sidebarChartPositions, yesTokenId, noTokenId, chartOutcome]);

  const tradeMarkers = useMemo(() => {
    if (tradeMarkersProp != null) return tradeMarkersProp;
    if (ledgerFillsForMarkers != null) {
      return buildChartTradeMarkersFromLedgerFills(ledgerFillsForMarkers, {
        yesTokenId,
        noTokenId,
        chartOutcome,
      });
    }
    if (myTradesForMarkers != null) {
      return buildChartTradeMarkersFromMyTrades(myTradesForMarkers, {
        yesTokenId,
        noTokenId,
        chartOutcome,
      });
    }
    return undefined;
  }, [
    tradeMarkersProp,
    ledgerFillsForMarkers,
    myTradesForMarkers,
    yesTokenId,
    noTokenId,
    chartOutcome,
  ]);

  if (!chartMarket || !yesTokenId) return null;

  const outcomeToggle = {
    value: chartOutcome,
    onChange: setChartOutcome,
    yesLabel,
    noLabel,
    noDisabled: !noTokenId,
  };

  const wrap = (node: ReactNode) => (className ? <div className={className}>{node}</div> : node);

  if (isUpDownMarket) {
    return wrap(
      <LiveTradeChart
        trades={trades}
        tradeMarkers={tradeMarkers}
        isNo={false}
        tokenId={tokenId}
        startTime={startTimeProp}
        endTime={endTime}
        intervalContext={upDownIntervalContext}
        defaultIntervalOverride={upDownKlineDefaultInterval}
        chainlinkAsset={upDownAsset || undefined}
        hidePriceLines
        intervalSelector={intervalSelector}
        outcomeToggle={outcomeToggle}
        outcomeSync={outcomeSync}
        soundMuteYesTokenId={yesTokenId}
        soundMuteNoTokenId={noTokenId}
        volumeSpikeAlerts={volumeSpikeAlerts}
        candleObHover
        obHeatmap
        sidebarUserBidPrices={sidebarUserBidPrices}
        sidebarUserAskPrices={sidebarUserAskPrices}
        sidebarChartOrderLevels={sidebarChartOrderLevels}
        sidebarChartPositionLevels={sidebarChartPositionLevels}
        onChartOrderReplace={onChartOrderReplace}
      />,
    );
  }

  return wrap(
    <LiveTradeChart
      trades={trades}
      tradeMarkers={tradeMarkers}
      isNo={false}
      tokenId={tokenId}
      startTime={startTimeProp}
      endTime={endTime}
      defaultIntervalOverride="5m"
      hidePriceLines
      intervalSelector={intervalSelector}
      outcomeToggle={outcomeToggle}
      outcomeSync={outcomeSync}
      soundMuteYesTokenId={yesTokenId}
      soundMuteNoTokenId={noTokenId}
      volumeSpikeAlerts={volumeSpikeAlerts}
      candleObHover
      obHeatmap
      sidebarUserBidPrices={sidebarUserBidPrices}
      sidebarUserAskPrices={sidebarUserAskPrices}
      sidebarChartOrderLevels={sidebarChartOrderLevels}
      sidebarChartPositionLevels={sidebarChartPositionLevels}
      onChartOrderReplace={onChartOrderReplace}
    />,
  );
});
