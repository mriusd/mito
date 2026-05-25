import { memo, useMemo } from 'react';
import type { OnchainFillRow } from '../api';
import type { Market } from '../types';
import { getOnchainTradesWSShared, OnchainTradesWSBridge } from '../hooks/useOnchainTradesWS';
import { fmtIntEn } from '../lib/walletInfoFillRows';
import { capWalletInfoFills, WalletInfoFillRow } from './WalletInfoFillRow';

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
  const visibleFills = useMemo(() => capWalletInfoFills(fills), [fills]);
  const defaultMarket = marketById[selectedMarketId];

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
              ) : visibleFills.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-gray-500">
                    No trades for this wallet/market.
                  </td>
                </tr>
              ) : (
                visibleFills.map((f) => {
                  const mid = String(f.marketId || '').trim().toLowerCase();
                  const market = defaultMarket || (mid && marketById[mid]) || {};
                  return (
                    <WalletInfoFillRow
                      key={`${f.txHash ?? ''}:${f.logIndex ?? ''}:${f.tokenId ?? ''}`}
                      fill={f}
                      wallet={wallet}
                      market={market}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[10px] text-gray-400 shrink-0 pt-1 border-t border-gray-800">
          <span>{fmtIntEn(visibleFills.length)} shown (live WS)</span>
        </div>
      </div>
    </>
  );
});
