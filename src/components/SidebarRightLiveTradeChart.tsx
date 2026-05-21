import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import type { Market } from '../types';
import { extractAssetFromMarket } from '../utils/format';
import { LiveTradeChart } from './LiveTradeChart';
import {
  buildChartTradeMarkersFromLedgerFills,
  buildChartTradeMarkersFromMyTrades,
  type ChartTradeMarker,
  type LedgerFillChartRow,
  type MyTradeChartRow,
} from '../lib/chartTradeMarkers';

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
}: SidebarRightLiveTradeChartProps) {
  const isUpDownMarket = marketIsUpDown(market);
  const upDownAsset = isUpDownMarket ? extractAssetFromMarket(market) : null;
  const upDownIntervalContext = useMemo(() => upDownIntervalContextFromMarket(market), [market]);
  const upDownKlineDefaultInterval = useMemo(() => upDownKlineDefaultIntervalFromMarket(market), [market]);
  const upDownStartTime = useMemo(() => upDownStartTimeFromMarket(market), [market]);
  const yesTokenId = market.clobTokenIds?.[0] || '';
  const noTokenId = market.clobTokenIds?.[1] || '';
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
  const endTime = chartEndTime ?? (market.endDate ? new Date(market.endDate).getTime() : undefined);
  const startTimeProp = chartStartTime ?? (upDownStartTime > 0 ? upDownStartTime : undefined);
  const yesLabel = isUpDownMarket ? 'UP' : 'YES';
  const noLabel = isUpDownMarket ? 'DOWN' : 'NO';

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

  if (!yesTokenId) return null;

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
    />,
  );
});
