import { memo, useEffect, useRef } from 'react';
import type { OnchainFillRow } from '../api';
import type { Market } from '../types';
import { useFixedRowVirtualWindow } from '../lib/useFixedRowVirtualWindow';
import { WalletInfoFillRow, walletInfoFillRowKey } from './WalletInfoFillRow';

const FILL_ROW_HEIGHT = 23;
const FILL_COL_COUNT = 9;

const FILLS_TABLE_HEAD = (
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
);

function VirtualSpacerRow({ height }: { height: number }) {
  if (height <= 0) return null;
  return (
    <tr aria-hidden className="pointer-events-none">
      <td colSpan={FILL_COL_COUNT} style={{ height, padding: 0, border: 'none', lineHeight: 0 }} />
    </tr>
  );
}

export const WalletInfoFillsVirtualTable = memo(function WalletInfoFillsVirtualTable({
  fills,
  wallet,
  marketById,
  defaultMarket,
  loading,
  empty,
  scrollResetKey,
}: {
  fills: OnchainFillRow[];
  wallet: string;
  marketById: Record<string, Market>;
  defaultMarket?: Market;
  loading: boolean;
  empty: boolean;
  scrollResetKey: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const { start, end, paddingTop, paddingBottom } = useFixedRowVirtualWindow(
    fills.length,
    FILL_ROW_HEIGHT,
    scrollRef,
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = 0;
  }, [scrollResetKey]);

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto">
      <table className="w-full text-[10px] [&_th]:px-2.5 [&_td]:px-2.5 [&_th]:py-1 [&_td]:py-1">
        {FILLS_TABLE_HEAD}
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={FILL_COL_COUNT} className="py-8 text-center text-gray-500">
                Loading trades...
              </td>
            </tr>
          ) : empty ? (
            <tr>
              <td colSpan={FILL_COL_COUNT} className="py-8 text-center text-gray-500">
                No trades for this wallet/market.
              </td>
            </tr>
          ) : (
            <>
              <VirtualSpacerRow height={paddingTop} />
              {fills.slice(start, end).map((f) => {
                const mid = String(f.marketId || '').trim().toLowerCase();
                const market = defaultMarket || (mid && marketById[mid]) || {};
                return (
                  <WalletInfoFillRow
                    key={walletInfoFillRowKey(f)}
                    fill={f}
                    wallet={wallet}
                    market={market}
                  />
                );
              })}
              <VirtualSpacerRow height={paddingBottom} />
            </>
          )}
        </tbody>
      </table>
    </div>
  );
});
