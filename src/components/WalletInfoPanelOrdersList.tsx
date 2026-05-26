import { memo } from 'react';
import type { OnchainFillRow } from '../api';
import type { WSInferredOrder } from '../hooks/useOnchainTradesWS';
import type { Market } from '../types';
import { fillOutcomeDisplay } from '../lib/walletInfoFillRows';

export const WalletInfoPanelOrdersList = memo(function WalletInfoPanelOrdersList({
  orders,
  selectedMarketId,
  marketById,
}: {
  orders: WSInferredOrder[];
  selectedMarketId: string;
  marketById: Record<string, Market>;
}) {
  if (orders.length === 0) {
    return null;
  }
  const market = marketById[selectedMarketId] || {};
  return (
    <div className="mb-2 shrink-0 min-w-0">
      <div className="text-[10px] text-gray-400 font-bold mb-1">Open Orders (inferred)</div>
      <div className="rounded border border-gray-700/80 overflow-hidden max-h-28 overflow-y-auto">
        <table className="w-full text-[10px] [&_th]:px-2 [&_td]:px-2 [&_th]:py-0.5 [&_td]:py-0.5">
          <thead>
            <tr className="text-gray-500 bg-gray-900/90 sticky top-0">
              <th className="text-left">Side</th>
              <th className="text-left">Out</th>
              <th className="text-right">Filled</th>
              <th className="text-right">Total</th>
              <th className="text-right">Left</th>
              <th className="text-right">Limit</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => {
              const sideCls = o.side === 'BUY' ? 'text-green-400' : 'text-red-400';
              const fakeFill: OnchainFillRow = {
                txHash: '',
                logIndex: 0,
                blockNumber: 0,
                blockTime: 0,
                tokenId: o.tokenId,
                marketId: o.marketId || selectedMarketId,
              };
              const { text: outLabel, tone } = fillOutcomeDisplay(fakeFill, market);
              const outCls =
                tone === 'yes' ? 'text-green-400' : tone === 'no' ? 'text-red-400' : 'text-gray-400';
              const limit =
                o.limitPrice != null && Number.isFinite(o.limitPrice)
                  ? `${(o.limitPrice * 100).toFixed(1)}¢`
                  : '—';
              return (
                <tr
                  key={o.orderHash}
                  className={`border-t border-gray-800/80 ${o.pending ? 'bg-sky-500/10' : ''}`}
                  title={o.orderHash}
                >
                  <td className={sideCls}>{o.side}</td>
                  <td className={outCls}>{outLabel}</td>
                  <td className="text-right tabular-nums text-gray-300">
                    {fmtShares(o.filledShares)}
                  </td>
                  <td className="text-right tabular-nums text-gray-400">{fmtShares(o.totalShares)}</td>
                  <td className="text-right tabular-nums text-amber-300/90">
                    {fmtShares(o.remainingShares)}
                  </td>
                  <td className="text-right tabular-nums text-gray-400">{limit}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});

function fmtShares(n: number): string {
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}
