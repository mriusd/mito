import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { WalletPosition } from '../api';
import { fetchMarketOutcomeTokens } from '../api';
import { useWalletMarketTradesWS } from '../hooks/useOnchainTradesWS';
import { useThrottledPolymarketChartTrades } from '../hooks/useThrottledPolymarketChartTrades';
import { walletDirectionalChartOutcome } from '../lib/toxicFlowStakeCohort';
import { walletInfoChartMarketWithOutcomeTokens } from '../lib/walletInfoChartMarket';
import { wsTradeToFillRow } from '../lib/walletInfoFillRows';
import type { Market } from '../types';
import { SidebarRightLiveTradeChart } from './SidebarRightLiveTradeChart';

export const WalletInfoPanelLiveChart = memo(function WalletInfoPanelLiveChart({
  open,
  wallet,
  selectedMarketId,
  selectedMarketMeta,
  positionForMarket = null,
  focusMarketSeq = 0,
}: {
  open: boolean;
  wallet: string;
  selectedMarketId: string;
  selectedMarketMeta: Market | null;
  positionForMarket?: WalletPosition | null;
  focusMarketSeq?: number;
}) {
  const enabled = open && !!wallet && !!selectedMarketId.trim();
  const { trades: wsMarketTrades } = useWalletMarketTradesWS(wallet, selectedMarketId, enabled);
  const ledgerFillsForMarkers = useMemo(
    () => wsMarketTrades.map((t) => wsTradeToFillRow(t, wallet, selectedMarketId)),
    [wsMarketTrades, wallet, selectedMarketId],
  );
  const walletInfoChartTrades = useThrottledPolymarketChartTrades(500);
  const [walletChartOutcome, setWalletChartOutcome] = useState<'YES' | 'NO'>('YES');
  const userChartOverrideRef = useRef(false);
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
    userChartOverrideRef.current = false;
  }, [wallet, selectedMarketId, focusMarketSeq]);

  useEffect(() => {
    if (userChartOverrideRef.current) return;
    setWalletChartOutcome(walletDirectionalChartOutcome(positionForMarket));
  }, [wallet, selectedMarketId, focusMarketSeq, positionForMarket]);

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
        onChartOutcomeChange={(next) => {
          userChartOverrideRef.current = true;
          setWalletChartOutcome(next);
        }}
        intervalSelector="dropdown"
        volumeSpikeAlerts={false}
      />
    </div>
  );
});
