import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Market } from '../types';
import { fetchMarketOutcomeTokens } from '../api';
import { useAppStore } from '../stores/appStore';
import { getOnchainTradesWSShared, OnchainTradesWSBridge, useWalletMarketTradesWS } from '../hooks/useOnchainTradesWS';
import { walletDirectionalChartOutcome } from '../lib/toxicFlowStakeCohort';
import { useSidebarPolymarketTape } from '../lib/sidebarPolymarketTapeStore';
import { wsTradeToFillRow } from '../lib/walletInfoFillRows';
import { SidebarRightLiveTradeChart } from './SidebarRightLiveTradeChart';
import {
  clobTokenIdsFromWalletPosition,
  walletInfoChartMarketWithOutcomeTokens,
} from '../lib/walletInfoChartMarket';
import { MarketViewTradesWalletBar } from './MarketViewTradesWalletBar';
import { capWalletInfoFills, WalletInfoFillRow } from './WalletInfoFillRow';
import type { WalletPosition } from '../api';

export const WalletMarketTradesSection = memo(function WalletMarketTradesSection({
  open,
  wallet,
  marketId,
  market,
  trader,
  onLoadingChange,
}: {
  open: boolean;
  wallet: string;
  marketId: string;
  market: Market | null;
  trader?: WalletPosition | null;
  onLoadingChange?: (loading: boolean) => void;
}) {
  const hasWallet = !!wallet.trim();
  const enabled = open && hasWallet && !!marketId.trim();
  const [needsOwnOnchainWs, setNeedsOwnOnchainWs] = useState(() => getOnchainTradesWSShared() == null);
  const { trades: fills, loading: loadingFills } = useWalletMarketTradesWS(
    wallet.trim() || null,
    marketId.trim() || null,
    enabled,
  );
  const fillRows = useMemo(
    () =>
      capWalletInfoFills(
        fills
          .filter((t) => !t.pending)
          .map((t) => wsTradeToFillRow(t, wallet.trim(), marketId.trim())),
      ),
    [fills, wallet, marketId],
  );

  useEffect(() => {
    onLoadingChange?.(enabled && loadingFills);
  }, [enabled, loadingFills, onLoadingChange]);

  useEffect(() => {
    if (!enabled) return;
    const sync = () => setNeedsOwnOnchainWs(getOnchainTradesWSShared() == null);
    sync();
    const id = window.setInterval(sync, 500);
    return () => window.clearInterval(id);
  }, [enabled]);

  const [chartOutcomeTokens, setChartOutcomeTokens] = useState<{
    tokenIdYes: string;
    tokenIdNo: string;
  } | null>(null);
  const [chartOutcome, setChartOutcome] = useState<'YES' | 'NO'>('YES');
  const userChartOverrideRef = useRef(false);

  useEffect(() => {
    userChartOverrideRef.current = false;
  }, [wallet, marketId, trader?.marketId, trader?.invYes, trader?.invNo, trader?.netYes, trader?.netNo]);

  useEffect(() => {
    if (userChartOverrideRef.current) return;
    setChartOutcome(walletDirectionalChartOutcome(trader));
  }, [wallet, marketId, trader]);

  const scopedClobTokenIds = useMemo((): string[] | null => {
    const y = chartOutcomeTokens?.tokenIdYes?.trim();
    const n = chartOutcomeTokens?.tokenIdNo?.trim();
    const ids = [y, n].filter((id): id is string => !!id);
    return ids.length > 0 ? ids : null;
  }, [chartOutcomeTokens]);

  const traderTokens = useMemo(() => clobTokenIdsFromWalletPosition(trader), [trader]);

  useEffect(() => {
    const mid = marketId.trim();
    const storeYes = market?.clobTokenIds?.[0]?.trim() || '';
    const storeNo = market?.clobTokenIds?.[1]?.trim() || '';
    const posYes = traderTokens[0] || '';
    const posNo = traderTokens[1] || '';
    const hasBoth =
      !!(storeYes && storeNo && storeYes !== storeNo) ||
      !!(posYes && posNo && posYes !== posNo);
    // Need both YES and NO tokens for distinct UP/DOWN series.
    if (!open || !mid || hasBoth) {
      setChartOutcomeTokens(null);
      return;
    }
    let cancelled = false;
    void fetchMarketOutcomeTokens(mid)
      .then((tok) => {
        if (cancelled || !tok) return;
        setChartOutcomeTokens({
          tokenIdYes: (tok.tokenIdYes || '').trim(),
          tokenIdNo: (tok.tokenIdNo || '').trim(),
        });
      })
      .catch(() => {
        /* chart stays empty until tokens resolve another way */
      });
    return () => {
      cancelled = true;
    };
  }, [open, marketId, market?.clobTokenIds, traderTokens]);

  const selectedMarketForChart = useMemo(
    () =>
      walletInfoChartMarketWithOutcomeTokens(
        market,
        chartOutcomeTokens?.tokenIdYes || market?.clobTokenIds?.[0] || traderTokens[0] || '',
        chartOutcomeTokens?.tokenIdNo || market?.clobTokenIds?.[1] || traderTokens[1] || '',
      ),
    [market, chartOutcomeTokens, traderTokens],
  );

  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const polymarketTape = useSidebarPolymarketTape();
  const chartTrades = liveTradesSource === 'onchain' ? [] : polymarketTape;

  return (
    <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
      {needsOwnOnchainWs && enabled ? (
        <OnchainTradesWSBridge
          wallet={wallet.trim()}
          marketId={marketId.trim()}
          scopedClobTokenIds={scopedClobTokenIds}
        />
      ) : null}
      {hasWallet ? <MarketViewTradesWalletBar wallet={wallet.trim()} trader={trader ?? null} /> : null}
      {selectedMarketForChart?.clobTokenIds?.[0] ? (
        <div className="shrink-0 mb-1 border-b border-gray-800/80 pb-1">
          <SidebarRightLiveTradeChart
            market={selectedMarketForChart}
            trades={chartTrades}
            ledgerFillsForMarkers={hasWallet ? fills : undefined}
            chartOutcome={chartOutcome}
            onChartOutcomeChange={(next) => {
              userChartOverrideRef.current = true;
              setChartOutcome(next);
            }}
            intervalSelector="dropdown"
            volumeSpikeAlerts={false}
          />
        </div>
      ) : null}
      {!hasWallet ? (
        <div className="flex flex-1 items-center justify-center text-gray-500 text-[10px]">Select a trader.</div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto toxic-flow-scroll-stable">
        <table className="w-full text-[10px] [&_th]:px-2.5 [&_td]:px-2.5 [&_th]:py-1 [&_td]:py-1">
          <thead>
            <tr className="text-gray-500">
              <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-left">Time</th>
              <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-left">Action</th>
              <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-left">Side</th>
              <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-center w-6 px-0">T</th>
              <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-right">Shares</th>
              <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-right">Price</th>
              <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-right">USDC</th>
              <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-right">Fee</th>
              <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-center w-6 px-0" aria-label="Transaction" />
            </tr>
          </thead>
          <tbody>
            {loadingFills && fills.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-4" />
              </tr>
            ) : fillRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-500">
                  No trades for this wallet/market.
                </td>
              </tr>
            ) : (
              fillRows.map((f) => {
                const rowKey = f.pending
                  ? f.pendingId || `pending:${f.txHash}:${f.tokenId}`
                  : `${f.txHash ?? ''}:${f.logIndex ?? ''}:${f.tokenId ?? ''}`;
                return (
                  <WalletInfoFillRow
                    key={rowKey}
                    fill={f}
                    wallet={wallet.trim()}
                    market={selectedMarketForChart || market || {}}
                  />
                );
              })
            )}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
});
