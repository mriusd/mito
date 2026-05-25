import { memo } from 'react';
import { ExternalLink } from 'lucide-react';
import type { OnchainFillRow } from '../api';
import type { Market } from '../types';
import { getOnchainTradesWSShared, OnchainTradesWSBridge } from '../hooks/useOnchainTradesWS';
import { useTradeElapsedTick } from '../hooks/useTradeElapsedTick';
import { toxicFlowFillKey } from '../lib/tradeKeys';
import {
  fillOutcomeDisplay,
  fmtIntEn,
  fmtUsd2En,
  isLedgerFillRow,
} from '../lib/walletInfoFillRows';
import { MemoWalletTradeTimeCell } from './WalletTradeTimeCell';

export const WalletInfoPanelFillsTable = memo(function WalletInfoPanelFillsTable({
  open,
  wallet,
  selectedMarketId,
  marketById,
  fills,
  loadingFills,
}: {
  open: boolean;
  wallet: string;
  selectedMarketId: string;
  marketById: Record<string, Market>;
  fills: OnchainFillRow[];
  loadingFills: boolean;
}) {
  const enabled = open && !!wallet && !!selectedMarketId.trim();
  const needsOwnOnchainWs = enabled && getOnchainTradesWSShared() == null;
  const tradeElapsedTick = useTradeElapsedTick(enabled);

  return (
    <>
      {needsOwnOnchainWs ? (
        <OnchainTradesWSBridge wallet={wallet} marketId={selectedMarketId} active />
      ) : null}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden min-w-0">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full text-[10px] [&_th]:px-2.5 [&_td]:px-2.5 [&_th]:py-1 [&_td]:py-1">
            <thead>
              <tr className="text-gray-500">
                <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-left">Time</th>
                <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-left">Action</th>
                <th className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-left">Side</th>
                <th
                  className="sticky top-0 z-10 bg-gray-900 border-b border-gray-700 text-center w-6 px-0"
                  title="Taker (wallet_fill_ledger.is_taker)"
                >
                  T
                </th>
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
                  <td colSpan={9} className="py-8 text-center text-gray-500">
                    Loading trades...
                  </td>
                </tr>
              ) : fills.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-gray-500">
                    No trades for this wallet/market.
                  </td>
                </tr>
              ) : (
                fills.map((f) => {
                  const mid = String(f.marketId || '').trim().toLowerCase();
                  const mk = marketById[selectedMarketId] || (mid && marketById[mid]) || {};
                  const bt = Number((f as { blockTime?: number }).blockTime ?? 0);
                  if (isLedgerFillRow(f)) {
                    const sz = Number(f.size);
                    const pr = f.price;
                    const priceFinite = pr != null && Number.isFinite(pr);
                    const sizeFinite = Number.isFinite(sz);
                    const priceLabel = priceFinite
                      ? `${(pr * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}¢`
                      : '—';
                    const usdc = priceFinite && sizeFinite ? pr * sz : NaN;
                    const usdcLabel = Number.isFinite(usdc) ? `$${fmtUsd2En(usdc)}` : '—';
                    const feeN = Number(f.fee);
                    const feeLabel = Number.isFinite(feeN) ? `$${fmtUsd2En(feeN)}` : '—';
                    const rawSide = String(f.side ?? '').trim();
                    const sideLabel = rawSide || '—';
                    const su = rawSide.toUpperCase();
                    const sideCls =
                      su === 'YES' || su === 'Y' ? 'text-green-400' : su === 'NO' || su === 'N' ? 'text-red-400' : 'text-gray-300';
                    const action = String(f.action ?? '').trim();
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
                    return (
                      <tr key={toxicFlowFillKey(f.txHash, f.logIndex, String(f.tokenId || ''))} className="border-b border-gray-800">
                        <td className="py-0.5">
                          <MemoWalletTradeTimeCell blockTime={bt} nowMs={tradeElapsedTick} />
                        </td>
                        <td className={actionCls}>{action || '—'}</td>
                        <td className={sideCls}>{sideLabel}</td>
                        <td className="text-center text-amber-300 font-bold tabular-nums px-0">
                          {f.isTaker === true ? 'T' : ''}
                        </td>
                        <td className="text-right tabular-nums">
                          {sizeFinite ? sz.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                        </td>
                        <td className="text-right text-gray-300 tabular-nums">{priceLabel}</td>
                        <td className="text-right text-yellow-400">{usdcLabel}</td>
                        <td className="text-right text-yellow-400/80">{feeLabel}</td>
                        <td className="text-center px-0">
                          {f.txHash ? (
                            <a
                              href={`https://polygonscan.com/tx/${f.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex text-gray-400 hover:text-cyan-300"
                              title={`Open tx ${f.txHash} on Polygonscan`}
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
                  }
                  const isSplitMerge = f.orderHash === 'SPLIT' || f.orderHash === 'MERGE';
                  if (isSplitMerge) {
                    const label = String(f.orderHash);
                    const amount = Number(f.makerAmount ?? 0);
                    const feeN = Number(f.fee ?? 0);
                    const feeLabel = Number.isFinite(feeN) ? `$${fmtUsd2En(feeN)}` : '—';
                    return (
                      <tr key={toxicFlowFillKey(f.txHash, f.logIndex)} className="border-b border-gray-800">
                        <td className="py-0.5">
                          <MemoWalletTradeTimeCell blockTime={bt} nowMs={tradeElapsedTick} />
                        </td>
                        <td className="text-purple-400" colSpan={2}>
                          {label}
                        </td>
                        <td className="text-center text-amber-300 font-bold px-0">{f.isTaker === true ? 'T' : ''}</td>
                        <td className="text-right tabular-nums">
                          {Number.isFinite(amount)
                            ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                            : '—'}
                        </td>
                        <td className="text-right text-gray-500">—</td>
                        <td className="text-right text-gray-500 tabular-nums">
                          {Number.isFinite(amount) ? `$${fmtUsd2En(amount)}` : '—'}
                        </td>
                        <td className="text-right text-yellow-400/80">{feeLabel}</td>
                        <td className="text-center px-0">
                          {f.txHash ? (
                            <a
                              href={`https://polygonscan.com/tx/${f.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex text-gray-400 hover:text-cyan-300"
                              title={`Open tx ${f.txHash} on Polygonscan`}
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
                  }
                  const walletLower = wallet.toLowerCase();
                  const isTaker = (f.taker || '').toLowerCase() === walletLower;
                  const walletPaysUsdc = (isTaker && f.takerAssetId === '0') || (!isTaker && f.makerAssetId === '0');
                  const wa = String(f.walletAccountSide || '').toUpperCase();
                  const action = wa === 'BUY' || wa === 'SELL' ? wa : walletPaysUsdc ? 'BUY' : 'SELL';
                  const shares = walletPaysUsdc
                    ? isTaker
                      ? f.makerAmount
                      : f.takerAmount
                    : isTaker
                      ? f.takerAmount
                      : f.makerAmount;
                  const usdc = walletPaysUsdc
                    ? isTaker
                      ? f.takerAmount
                      : f.makerAmount
                    : isTaker
                      ? f.makerAmount
                      : f.takerAmount;
                  const nShares = Number(shares);
                  const nUsdc = Number(usdc);
                  const pricePerShare = nShares > 1e-9 && Number.isFinite(nShares) && Number.isFinite(nUsdc) ? nUsdc / nShares : NaN;
                  const priceLabel = Number.isFinite(pricePerShare)
                    ? `${(pricePerShare * 100).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}¢`
                    : '—';
                  const { text: sideText, tone: sideTone } = fillOutcomeDisplay(f, mk);
                  const sideCls = sideTone === 'yes' ? 'text-green-400' : sideTone === 'no' ? 'text-red-400' : 'text-gray-300';
                  const feeN = Number(f.fee ?? 0);
                  const feeLabel = Number.isFinite(feeN) ? `$${fmtUsd2En(feeN)}` : '—';
                  return (
                    <tr key={toxicFlowFillKey(f.txHash, f.logIndex)} className="border-b border-gray-800">
                      <td className="py-0.5">
                        <MemoWalletTradeTimeCell blockTime={bt} nowMs={tradeElapsedTick} />
                      </td>
                      <td className={action === 'BUY' ? 'text-green-400' : 'text-red-400'}>{action}</td>
                      <td className={sideCls}>{sideText}</td>
                      <td className="text-center text-amber-300 font-bold tabular-nums px-0">
                        {f.isTaker === true ? 'T' : ''}
                      </td>
                      <td className="text-right tabular-nums">
                        {Number.isFinite(nShares)
                          ? nShares.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : '—'}
                      </td>
                      <td className="text-right text-gray-300 tabular-nums">{priceLabel}</td>
                      <td className="text-right text-yellow-400 tabular-nums">
                        {Number.isFinite(nUsdc) ? `$${fmtUsd2En(nUsdc)}` : '—'}
                      </td>
                      <td className="text-right text-yellow-400/80 tabular-nums">{feeLabel}</td>
                      <td className="text-center px-0">
                        {f.txHash ? (
                          <a
                            href={`https://polygonscan.com/tx/${f.txHash}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex text-gray-400 hover:text-cyan-300"
                            title={`Open tx ${f.txHash} on Polygonscan`}
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
        <div className="mt-2 text-[10px] text-gray-400 shrink-0 pt-1 border-t border-gray-800">
          <span>{fmtIntEn(fills.length)} shown (live WS)</span>
        </div>
      </div>
    </>
  );
});
