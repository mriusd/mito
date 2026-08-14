import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { WalletPosition } from '../api';
import { fetchMarketOutcomeTokens } from '../api';
import { useWalletMarketTradesWS } from '../hooks/useOnchainTradesWS';
import { useThrottledPolymarketChartTrades } from '../hooks/useThrottledPolymarketChartTrades';
import { walletDirectionalChartOutcome } from '../lib/toxicFlowStakeCohort';
import {
  clobTokenIdsFromWalletPosition,
  walletInfoChartMarketWithOutcomeTokens,
} from '../lib/walletInfoChartMarket';
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
  const [tokensLoading, setTokensLoading] = useState(false);

  const positionTokens = useMemo(
    () => clobTokenIdsFromWalletPosition(positionForMarket),
    [positionForMarket],
  );

  useEffect(() => {
    const mid = selectedMarketId.trim();
    const storeYes = selectedMarketMeta?.clobTokenIds?.[0]?.trim() || '';
    const storeNo = selectedMarketMeta?.clobTokenIds?.[1]?.trim() || '';
    const posYes = positionTokens[0] || '';
    const posNo = positionTokens[1] || '';
    // Need *both* outcome tokens for UP/DOWN. Having only YES is not enough.
    const hasBoth =
      !!(storeYes && storeNo && storeYes !== storeNo) ||
      !!(posYes && posNo && posYes !== posNo);
    if (!open || !mid || hasBoth) {
      setChartOutcomeTokens(null);
      setTokensLoading(false);
      return;
    }
    let cancelled = false;
    setTokensLoading(true);
    void fetchMarketOutcomeTokens(mid)
      .then((tok) => {
        if (cancelled) return;
        if (!tok?.tokenIdYes?.trim()) {
          setChartOutcomeTokens(null);
          return;
        }
        setChartOutcomeTokens({
          tokenIdYes: (tok.tokenIdYes || '').trim(),
          tokenIdNo: (tok.tokenIdNo || '').trim(),
        });
      })
      .catch(() => {
        if (!cancelled) setChartOutcomeTokens(null);
      })
      .finally(() => {
        if (!cancelled) setTokensLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedMarketId, selectedMarketMeta?.clobTokenIds, positionTokens]);

  useEffect(() => {
    userChartOverrideRef.current = false;
  }, [wallet, selectedMarketId, focusMarketSeq]);

  useEffect(() => {
    if (userChartOverrideRef.current) return;
    setWalletChartOutcome(walletDirectionalChartOutcome(positionForMarket));
  }, [wallet, selectedMarketId, focusMarketSeq, positionForMarket]);

  const selectedMarketForChart = useMemo(() => {
    const fromFetch = chartOutcomeTokens;
    const yes =
      fromFetch?.tokenIdYes ||
      selectedMarketMeta?.clobTokenIds?.[0] ||
      positionTokens[0] ||
      '';
    const no =
      fromFetch?.tokenIdNo ||
      selectedMarketMeta?.clobTokenIds?.[1] ||
      positionTokens[1] ||
      '';
    return walletInfoChartMarketWithOutcomeTokens(selectedMarketMeta, yes, no);
  }, [selectedMarketMeta, chartOutcomeTokens, positionTokens]);

  if (!selectedMarketForChart?.clobTokenIds?.[0]) {
    if (!selectedMarketId.trim()) return null;
    return (
      <div className="shrink-0 mb-1 border-b border-gray-800/80 pb-1 px-1 py-3 text-[10px] text-gray-500 text-center">
        {tokensLoading ? 'Loading chart…' : 'Chart unavailable (no outcome tokens for this market)'}
      </div>
    );
  }

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
        ignoreStoredInterval
        volumeSpikeAlerts={false}
      />
    </div>
  );
});
