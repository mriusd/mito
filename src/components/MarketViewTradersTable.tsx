import { memo } from 'react';
import type { WalletPosition } from '../api';
import { ToxicFlowWalletTable } from './ToxicFlowWalletTable';

export const TRADERS_PAGE_SIZE = 100;

const PAGE_BTN_CLS =
  'rounded border border-gray-700 px-2 py-0.5 text-[10px] text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400';

export const MarketViewTradersTable = memo(function MarketViewTradersTable({
  traders,
  loading,
  selectedWallet,
  onRowClick,
  onOpenWallet,
  offset,
  total,
  pnlOrder,
  onPnlOrderToggle,
  onFirstPage,
  onPrevPage,
  onNextPage,
  onLastPage,
}: {
  traders: WalletPosition[];
  loading: boolean;
  selectedWallet: string | null;
  onRowClick: (wallet: string) => void;
  onOpenWallet: (wallet: string) => void;
  offset: number;
  total: number;
  pnlOrder: 'asc' | 'desc';
  onPnlOrderToggle: () => void;
  onFirstPage: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onLastPage: () => void;
}) {
  if (loading && traders.length === 0) {
    return <div className="flex flex-1 min-h-0" />;
  }
  if (!loading && traders.length === 0) {
    return <div className="flex flex-1 items-center justify-center text-gray-500 text-[10px]">No traders on this market.</div>;
  }

  const lastOffset = total >= 0 ? Math.max(0, Math.floor((total - 1) / TRADERS_PAGE_SIZE) * TRADERS_PAGE_SIZE) : 0;
  const hasFirst = offset > 0;
  const hasPrev = offset > 0;
  const hasNext = total >= 0 ? offset + traders.length < total : traders.length >= TRADERS_PAGE_SIZE;
  const hasLast = total >= 0 && offset < lastOffset;
  const rangeStart = offset + 1;
  const rangeEnd = offset + traders.length;
  const rangeLabel =
    total >= 0 ? `${rangeStart}–${rangeEnd} of ${total}` : `${rangeStart}–${rangeEnd}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ToxicFlowWalletTable
        wallets={traders}
        label="traders"
        hideStakeBar
        showRank
        rankStart={offset}
        pnlSortOrder={pnlOrder}
        onPnlSortClick={onPnlOrderToggle}
        selectedWallet={selectedWallet}
        onRowClick={onRowClick}
        onOpenWallet={onOpenWallet}
        variant="marketView"
      />
      <div className="mt-2 shrink-0 flex items-center justify-between gap-2 border-t border-gray-800 pt-2">
        <div className="flex items-center gap-1">
          <button type="button" className={PAGE_BTN_CLS} disabled={!hasFirst || loading} onClick={onFirstPage}>
            First
          </button>
          <button type="button" className={PAGE_BTN_CLS} disabled={!hasPrev || loading} onClick={onPrevPage}>
            Prev
          </button>
        </div>
        <span className="text-[10px] text-gray-500 tabular-nums">{rangeLabel}</span>
        <div className="flex items-center gap-1">
          <button type="button" className={PAGE_BTN_CLS} disabled={!hasNext || loading} onClick={onNextPage}>
            Next
          </button>
          <button type="button" className={PAGE_BTN_CLS} disabled={!hasLast || loading} onClick={onLastPage}>
            Last
          </button>
        </div>
      </div>
    </div>
  );
});

export function sortTradersByPnlDesc(rows: WalletPosition[]): WalletPosition[] {
  return rows;
}
