import { memo, useEffect, useMemo, useState } from 'react';
import { fetchMarketOutcomeTokens } from '../api';
import { usePolymarketChartTrades } from '../hooks/usePolymarketChartTrades';
import { walletInfoChartMarketWithOutcomeTokens } from '../lib/walletInfoChartMarket';
import type { Market } from '../types';
import type { OnchainFillRow } from '../api';
import { SidebarRightLiveTradeChart } from './SidebarRightLiveTradeChart';

export const WalletInfoPanelLiveChart = memo(function WalletInfoPanelLiveChart({
  open,
  selectedMarketId,
  selectedMarketMeta,
  ledgerFillsForMarkers,
}: {
  open: boolean;
  selectedMarketId: string;
  selectedMarketMeta: Market | null;
  ledgerFillsForMarkers: OnchainFillRow[];
}) {
  const walletInfoChartTrades = usePolymarketChartTrades();
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
