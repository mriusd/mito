import { memo, useEffect, useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Market } from '../types';
import { fetchMarketOutcomeTokens } from '../api';
import { useAppStore } from '../stores/appStore';
import { useWalletMarketTradesWS, useOnchainTradesWS } from '../hooks/useOnchainTradesWS';
import { useSidebarPolymarketTape } from '../lib/sidebarPolymarketTapeStore';
import { SidebarRightLiveTradeChart } from './SidebarRightLiveTradeChart';
import { walletInfoChartMarketWithOutcomeTokens } from '../lib/walletInfoChartMarket';
import { toxicFlowFillKey } from '../lib/tradeKeys';
import { MarketViewTradesWalletBar } from './MarketViewTradesWalletBar';
import { formatWalletTradeTimeWithElapsed } from '../utils/format';
import type { WalletPosition } from '../api';

function fmtUsd2En(absVal: number): string {
  if (!Number.isFinite(absVal)) return '—';
  return absVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

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
  const enabled = open && !!wallet.trim() && !!marketId.trim();
  const { trades: fills, loading: loadingFills } = useWalletMarketTradesWS(
    wallet.trim() || null,
    marketId.trim() || null,
    enabled,
  );

  useEffect(() => {
    onLoadingChange?.(enabled && loadingFills);
  }, [enabled, loadingFills, onLoadingChange]);

  useOnchainTradesWS({
    wallet: enabled ? wallet.trim().toLowerCase() : null,
    marketId: enabled ? marketId.trim() : null,
    scopedClobTokenIds: market?.clobTokenIds?.length ? market.clobTokenIds : null,
  });

  const [chartOutcomeTokens, setChartOutcomeTokens] = useState<{
    tokenIdYes: string;
    tokenIdNo: string;
  } | null>(null);
  const [chartOutcome, setChartOutcome] = useState<'YES' | 'NO'>('YES');
  const [tradeElapsedTick, setTradeElapsedTick] = useState(() => Date.now());

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setTradeElapsedTick(Date.now()), 5000);
    return () => window.clearInterval(id);
  }, [open]);

  useEffect(() => {
    const mid = marketId.trim();
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
  }, [open, marketId]);

  useEffect(() => {
    setChartOutcome('YES');
  }, [marketId, chartOutcomeTokens?.tokenIdYes]);

  const selectedMarketForChart = useMemo(
    () =>
      walletInfoChartMarketWithOutcomeTokens(
        market,
        chartOutcomeTokens?.tokenIdYes || '',
        chartOutcomeTokens?.tokenIdNo || '',
      ),
    [market, chartOutcomeTokens],
  );

  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const polymarketTape = useSidebarPolymarketTape();
  const chartTrades = liveTradesSource === 'onchain' ? [] : polymarketTape;

  if (!wallet.trim()) {
    return <div className="flex flex-1 items-center justify-center text-gray-500 text-[10px]">Select a trader.</div>;
  }

  return (
    <>
      <MarketViewTradesWalletBar wallet={wallet.trim()} trader={trader ?? null} />
      {selectedMarketForChart?.clobTokenIds?.[0] ? (
        <div className="shrink-0 mb-1 border-b border-gray-800/80 pb-1">
          <SidebarRightLiveTradeChart
            market={selectedMarketForChart}
            trades={chartTrades}
            ledgerFillsForMarkers={fills}
            chartOutcome={chartOutcome}
            onChartOutcomeChange={setChartOutcome}
            intervalSelector="dropdown"
          />
        </div>
      ) : null}
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
            ) : fills.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-gray-500">
                  No trades for this wallet/market.
                </td>
              </tr>
            ) : (
              fills.map((f) => {
                const ts = formatWalletTradeTimeWithElapsed(f.blockTime, tradeElapsedTick);
                const sz = Number(f.size);
                const pr = f.price;
                const priceFinite = Number.isFinite(pr);
                const sizeFinite = Number.isFinite(sz);
                const priceLabel = priceFinite
                  ? `${(pr * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}¢`
                  : '—';
                const usdc = priceFinite && sizeFinite ? pr * sz : NaN;
                const usdcLabel = Number.isFinite(usdc) ? `$${fmtUsd2En(usdc)}` : '—';
                const feeN = Number(f.fee);
                const feeLabel = Number.isFinite(feeN) ? `$${fmtUsd2En(feeN)}` : '—';
                const rawSide = String(f.outcome ?? '').trim();
                const sideLabel = rawSide || '—';
                const su = rawSide.toUpperCase();
                const sideCls =
                  su === 'YES' || su === 'Y' || su === 'UP'
                    ? 'text-green-400'
                    : su === 'NO' || su === 'N' || su === 'DOWN'
                      ? 'text-red-400'
                      : 'text-gray-300';
                const action = String(f.side ?? '').trim();
                const actionU = action.toUpperCase();
                const actionCls =
                  actionU === 'BUY'
                    ? 'text-green-400'
                    : actionU === 'SELL'
                      ? 'text-red-400'
                      : actionU === 'SPLIT' || actionU === 'MERGE'
                        ? 'text-purple-400'
                        : actionU === 'REDEEM'
                          ? 'text-blue-400'
                          : 'text-gray-300';
                const tx = String(f.txHash || '').trim();
                return (
                  <tr
                    key={toxicFlowFillKey(tx, f.logIndex, String(f.tokenId || ''))}
                    className="border-b border-gray-800"
                  >
                    <td className="py-0.5">{ts}</td>
                    <td className={actionCls}>{action || '—'}</td>
                    <td className={sideCls}>{sideLabel}</td>
                    <td className="text-center text-amber-300 font-bold tabular-nums px-0">
                      {f.isTaker === true ? 'T' : ''}
                    </td>
                    <td className="text-right tabular-nums">
                      {sizeFinite
                        ? sz.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : '—'}
                    </td>
                    <td className="text-right text-gray-300 tabular-nums">{priceLabel}</td>
                    <td className="text-right text-yellow-400">{usdcLabel}</td>
                    <td className="text-right text-yellow-400/80">{feeLabel}</td>
                    <td className="text-center px-0">
                      {tx ? (
                        <a
                          href={`https://polygonscan.com/tx/${tx}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex text-gray-400 hover:text-cyan-300"
                          title={`Open tx ${tx} on Polygonscan`}
                          aria-label="Open transaction on Polygonscan"
                        >
                          <ExternalLink size={12} />
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
});
