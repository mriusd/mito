import { memo, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { WalletPosition } from '../api';
import { getToxicWalletTag, TOXIC_WALLET_TAGS_CHANGED_EVENT } from '../lib/toxicWalletTags';
import { ToxicFlowWalletTable } from './ToxicFlowWalletTable';

export const TRADERS_PAGE_SIZE = 100;

const PAGE_BTN_CLS =
  'rounded border border-gray-700 px-2 py-0.5 text-[10px] text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-gray-400';

export const MarketViewTradersTable = memo(function MarketViewTradersTable({
  traders,
  loading,
  selectedWallet,
  marketId,
  onRowClick,
  onOpenWallet,
  offset,
  total,
  sortCol,
  sortOrder,
  onSortClick,
  onFirstPage,
  onPrevPage,
  onNextPage,
  onLastPage,
}: {
  traders: WalletPosition[];
  loading: boolean;
  selectedWallet: string | null;
  marketId: string;
  onRowClick: (wallet: string) => void;
  onOpenWallet: (wallet: string) => void;
  offset: number;
  total: number;
  sortCol: 'pnl' | 'staked';
  sortOrder: 'asc' | 'desc';
  onSortClick: (col: 'pnl' | 'staked') => void;
  onFirstPage: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onLastPage: () => void;
}) {
  const [search, setSearch] = useState('');
  const [tagRev, setTagRev] = useState(0);

  useEffect(() => {
    setSearch('');
  }, [marketId]);

  useEffect(() => {
    const onTags = () => setTagRev((n) => n + 1);
    window.addEventListener(TOXIC_WALLET_TAGS_CHANGED_EVENT, onTags);
    return () => window.removeEventListener(TOXIC_WALLET_TAGS_CHANGED_EVENT, onTags);
  }, []);

  const filteredTraders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return traders;
    void tagRev;
    return traders.filter((t) => {
      const wallet = (t.wallet || '').trim().toLowerCase();
      if (wallet.includes(q)) return true;
      const nick = (t.walletLedgerSummary?.polymarketNickname ?? '').trim().toLowerCase();
      if (nick && nick.includes(q)) return true;
      const tag = getToxicWalletTag(t.wallet || '');
      if (tag && tag.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [traders, search, tagRev]);

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
      <div className="relative mb-1.5 shrink-0">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search wallet, nickname, tag…"
          className="w-full rounded border border-gray-600 bg-gray-950 pl-2 pr-7 py-1 text-[11px] text-white placeholder:text-gray-500 focus:outline-none focus:border-gray-500"
          autoComplete="off"
          spellCheck={false}
        />
        {search.trim() ? (
          <button
            type="button"
            className="absolute right-1 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-500 hover:text-white hover:bg-gray-700/80"
            title="Clear search"
            aria-label="Clear search"
            onClick={() => setSearch('')}
          >
            <X size={12} />
          </button>
        ) : null}
      </div>
      {filteredTraders.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-gray-500 text-[10px] px-2 text-center">
          No matches for &ldquo;{search.trim()}&rdquo;
        </div>
      ) : (
        <ToxicFlowWalletTable
          wallets={filteredTraders}
          label="traders"
          hideStakeBar
          showRank
          rankStart={offset}
          marketViewSortCol={sortCol}
          marketViewSortOrder={sortOrder}
          onMarketViewSortClick={onSortClick}
          selectedWallet={selectedWallet}
          onRowClick={onRowClick}
          onOpenWallet={onOpenWallet}
          variant="marketView"
        />
      )}
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
