import { memo, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { WalletPosition } from '../api';
import type { Market } from '../types';
import {
  enrichMarketByIdFromWalletPositions,
  resolveWalletInfoChartMarket,
  resolveWalletInfoMarketPosition,
} from '../lib/walletInfoChartMarket';
import { WalletInfoPanelLiveChart } from './WalletInfoPanelLiveChart';
import { WalletInfoPanelFillsTable } from './WalletInfoPanelFillsTable';

/** Lightweight wallet-info slice: chart + fills for one market (no summary / markets list). */
export const WalletMarketTradesDialog = memo(function WalletMarketTradesDialog({
  open,
  wallet,
  marketId,
  marketById,
  markets,
  onClose,
  overlayZClass = 'z-[70000]',
}: {
  open: boolean;
  wallet: string;
  marketId: string;
  marketById: Record<string, Market>;
  markets: WalletPosition[];
  onClose: () => void;
  overlayZClass?: string;
}) {
  const mid = marketId.trim();
  const w = wallet.trim();
  const [fillsRefreshToken, setFillsRefreshToken] = useState(0);

  const enrichedMarketById = useMemo(
    () => enrichMarketByIdFromWalletPositions(marketById, markets),
    [marketById, markets],
  );

  const selectedMarketMeta = useMemo(
    () => resolveWalletInfoChartMarket(mid, enrichedMarketById, markets),
    [mid, enrichedMarketById, markets],
  );

  const positionForMarket = useMemo(
    () => resolveWalletInfoMarketPosition(w, mid, markets, null, ''),
    [w, mid, markets],
  );

  const title =
    selectedMarketMeta?.question?.trim() ||
    positionForMarket?.question?.trim() ||
    mid ||
    'Market trades';

  const onRefreshFills = useCallback(() => {
    setFillsRefreshToken((n) => n + 1);
  }, []);

  if (!open || !w || !mid) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className={`fixed inset-0 bg-black/60 ${overlayZClass} flex items-center justify-center`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg p-3 w-full mx-4 shadow-xl border border-gray-700 max-w-[min(96vw,52rem)] max-h-[88vh] min-h-[42vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between gap-2 mb-2 shrink-0 min-w-0">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-gray-500 font-semibold uppercase tracking-wide">
              Trades for market
            </div>
            <div className="text-sm text-white font-medium truncate" title={title}>
              {title}
            </div>
            <div className="text-[10px] font-mono text-gray-500 truncate" title={w}>
              {w}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              className="text-[10px] text-blue-400 hover:underline px-1"
              onClick={onRefreshFills}
              title="Refresh trades"
            >
              Refresh
            </button>
            <button
              type="button"
              className="p-1 rounded text-gray-400 hover:text-white hover:bg-gray-700"
              onClick={onClose}
              aria-label="Close"
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="bg-gray-900 rounded p-2 min-h-0 flex-1 flex flex-col overflow-hidden">
          <WalletInfoPanelLiveChart
            open={open}
            wallet={w}
            selectedMarketId={mid}
            selectedMarketMeta={selectedMarketMeta}
            positionForMarket={positionForMarket}
            outcomeFromFirstTrade
          />
          <WalletInfoPanelFillsTable
            open={open}
            wallet={w}
            selectedMarketId={mid}
            marketById={enrichedMarketById}
            fillsRefreshToken={fillsRefreshToken}
            showPendingTrades={false}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
});
