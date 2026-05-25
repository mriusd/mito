import { memo, useEffect, useMemo, useState } from 'react';
import { fetchMarketOutcomeTokens } from '../api';
import { useWalletMarketTradesWS } from '../hooks/useOnchainTradesWS';
import { useThrottledPolymarketChartTrades } from '../hooks/useThrottledPolymarketChartTrades';
import { walletInfoChartMarketWithOutcomeTokens } from '../lib/walletInfoChartMarket';
import { wsTradeToFillRow } from '../lib/walletInfoFillRows';
import type { Market } from '../types';
import { SidebarRightLiveTradeChart } from './SidebarRightLiveTradeChart';

export const WalletInfoPanelLiveChart = memo(function WalletInfoPanelLiveChart({
  open,
  wallet,
  selectedMarketId,
  selectedMarketMeta,
}: {
  open: boolean;
  wallet: string;
  selectedMarketId: string;
  selectedMarketMeta: Market | null;
}) {
  const enabled = open && !!wallet && !!selectedMarketId.trim();
  const { trades: wsMarketTrades } = useWalletMarketTradesWS(wallet, selectedMarketId, enabled);
  const ledgerFillsForMarkers = useMemo(
    () => wsMarketTrades.map((t) => wsTradeToFillRow(t, wallet, selectedMarketId)),
    [wsMarketTrades, wallet, selectedMarketId],
  );
  const walletInfoChartTrades = useThrottledPolymarketChartTrades(500);
  const [walletChartOutcome, setWalletChartOutcome] = useState<'YES' | 'NO'>('YES');
  const [chartOutcomeTokens, setChartOutcomeTokens] = useState<{
    tokenIdYes: string;
    tokenIdNo: string;
  } | null>(null);

  useEffect(() => {
    const mid = selectedMarketId.trim();
    if (!open || !mid) {
      setChartOutcomeTokens(null);
      return;
    }
    let cancelled = false;
    setChartOutcomeTokens(null);
    void fetchMarketOutcomeTokens(mid).then((tok) => {
      if (!cancelled) setChartOutcomeTokens(tok);
    });
    return () => {
      cancelled = true;
    };
  }, [open, selectedMarketId]);

  useEffect(() => {
    setWalletChartOutcome('YES');
  }, [selectedMarketId, chartOutcomeTokens?.tokenIdYes, chartOutcomeTokens?.tokenIdNo]);

  const selectedMarketForChart = useMemo(
    () =>
      walletInfoChartMarketWithOutcomeTokens(
        selectedMarketMeta,
        chartOutcomeTokens?.tokenIdYes || '',
        chartOutcomeTokens?.tokenIdNo || '',
      ),
    [selectedMarketMeta, chartOutcomeTokens],
  );

  if (!selectedMarketForChart?.clobTokenIds?.[0]) return null;

  return (
    <div className="shrink-0 mb-1 border-b border-gray-800/80 pb-1">
      <SidebarRightLiveTradeChart
        market={selectedMarketForChart}
        trades={walletInfoChartTrades}
        ledgerFillsForMarkers={ledgerFillsForMarkers}
        chartOutcome={walletChartOutcome}
        onChartOutcomeChange={setWalletChartOutcome}
        intervalSelector="dropdown"
        volumeSpikeAlerts={false}
      />
    </div>
  );
});
