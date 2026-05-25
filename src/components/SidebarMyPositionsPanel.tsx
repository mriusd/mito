import { memo, useMemo, useState } from 'react';
import type { Market, Position } from '../types';
import { getTokenOutcome } from '../utils/format';
import { useSidebarOnchainWalletPositions } from '../lib/sidebarOnchainTradesStore';
import {
  computeSidebarMergeEligible,
  computeSidebarMyPositions,
  isSidebarDustPosition,
  type SidebarMergeEligible,
} from '../lib/sidebarMyPositions';
import { SidebarDataSourceBadge } from './SidebarDataSourceBadge';
import { SidebarPositionListItem } from './SidebarPositionListItem';
import { triggerWalletRefresh } from '../lib/clobClient';
import { refreshSidebarOnchainMarketTrades, refreshSidebarOnchainWallet } from '../lib/sidebarOnchainTradesStore';

function sidebarBsMathCentsForOutcome(
  yesMathCents: number | null | undefined,
  outcome: string | null | undefined,
): number | null {
  if (yesMathCents == null || !Number.isFinite(yesMathCents)) return null;
  if (outcome === 'YES') return Math.round(yesMathCents * 10) / 10;
  if (outcome === 'NO') return Math.round((100 - yesMathCents) * 10) / 10;
  return null;
}

export type { SidebarMergeEligible };

export const SidebarMyPositionsPanel = memo(function SidebarMyPositionsPanel({
  selectedMarket,
  marketLookup,
  liveTradesSource,
  positions,
  isUpDownMarket,
  isMarketExpired,
  mergeFunderWallet,
  sidebarSpotStrip,
  closingPositionTokens,
  limitSellingPositionTokens,
  onSetOrderAmount,
  onClosePosition,
  onLimitSellAtPrice,
  onOpenMergeDialog,
  walletForLivePositions,
  onRefreshMyMarketTrades,
  preloadMergePositionsDialog,
}: {
  selectedMarket: Market;
  marketLookup: Record<string, Market>;
  liveTradesSource: string;
  positions: Position[];
  isUpDownMarket: boolean;
  isMarketExpired: boolean;
  mergeFunderWallet: string;
  sidebarSpotStrip: {
    pastExpiry?: boolean;
    yesMathCents?: number | null;
  } | null;
  closingPositionTokens: Set<string>;
  limitSellingPositionTokens: Set<string>;
  onSetOrderAmount: (a: string) => void;
  onClosePosition: (tokenId: string, size: number) => void;
  onLimitSellAtPrice: (tokenId: string, size: number, priceCents: number) => void;
  onOpenMergeDialog: (eligible: SidebarMergeEligible) => void;
  walletForLivePositions: string | null;
  onRefreshMyMarketTrades: () => void;
  preloadMergePositionsDialog: () => void;
}) {
  const onchainWsPositions = useSidebarOnchainWalletPositions();
  const [positionsRefreshing, setPositionsRefreshing] = useState(false);

  const myPositions = useMemo(
    () =>
      computeSidebarMyPositions(
        liveTradesSource,
        positions,
        selectedMarket,
        marketLookup,
        onchainWsPositions,
      ),
    [liveTradesSource, positions, selectedMarket, marketLookup, onchainWsPositions],
  );

  const myPositionsDisplay = useMemo(
    () => myPositions.filter((p) => !isSidebarDustPosition(p.size || 0)),
    [myPositions],
  );

  const mergeEligible = useMemo(
    () => computeSidebarMergeEligible(selectedMarket, myPositions, mergeFunderWallet),
    [selectedMarket, myPositions, mergeFunderWallet],
  );

  return (
    <>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-gray-400 shrink-0">My Positions</span>
          <SidebarDataSourceBadge source={liveTradesSource === 'onchain' ? 'onchain' : 'polymarket'} />
          {mergeEligible.showButton && !isMarketExpired && (
            <button
              type="button"
              disabled={!mergeEligible.canOpenDialog}
              onClick={() => mergeEligible.canOpenDialog && onOpenMergeDialog(mergeEligible)}
              onMouseEnter={preloadMergePositionsDialog}
              onFocus={preloadMergePositionsDialog}
              title={
                !mergeEligible.canOpenDialog
                  ? !mergeEligible.conditionId
                    ? 'Market conditionId missing — refresh markets or re-open sidebar'
                    : 'Resolve Polymarket proxy wallet (connect wallet / API keys)'
                  : `Merge complementary ${isUpDownMarket ? 'UP/DOWN' : 'YES/NO'} shares into USDC`
              }
              className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-cyan-600/60 text-cyan-300 hover:bg-cyan-900/40 disabled:opacity-35 disabled:cursor-not-allowed shrink-0"
            >
              Merge
            </button>
          )}
        </div>
        <button
          onClick={() => {
            setPositionsRefreshing(true);
            triggerWalletRefresh();
            if (walletForLivePositions) {
              refreshSidebarOnchainWallet();
              if (liveTradesSource === 'onchain') onRefreshMyMarketTrades();
            }
            setTimeout(() => setPositionsRefreshing(false), 2000);
          }}
          className="text-gray-500 hover:text-white transition shrink-0"
          title="Refresh positions and trades"
        >
          <svg
            className={`w-3 h-3 ${positionsRefreshing ? 'animate-spin' : ''}`}
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>
      <div className="space-y-1 text-xs">
        {myPositionsDisplay.length === 0 ? (
          <div className="text-gray-600">No positions</div>
        ) : (
          myPositionsDisplay.map((pos, i) => {
            const posTok = String(pos.asset || '').trim();
            const outcome = getTokenOutcome(posTok, marketLookup);
            const outcomeLabel = isUpDownMarket ? (outcome === 'YES' ? 'UP' : 'DOWN') : outcome;
            const outcomeColor = outcome === 'YES' ? 'text-green-400' : 'text-red-400';
            const size = pos.size || 0;
            const avg = pos.avgPrice || 0;
            const closing = closingPositionTokens.has(posTok);
            const limitSelling = limitSellingPositionTokens.has(posTok);
            const bsMathCents = sidebarSpotStrip?.pastExpiry
              ? null
              : sidebarBsMathCentsForOutcome(sidebarSpotStrip?.yesMathCents, outcome);
            return (
              <SidebarPositionListItem
                key={posTok || i}
                tokenId={posTok}
                size={size}
                avg={avg}
                outcomeLabel={outcomeLabel}
                outcomeColor={outcomeColor}
                isMarketExpired={isMarketExpired}
                closing={closing}
                limitSelling={limitSelling}
                bsMathCents={bsMathCents}
                onSetOrderAmount={onSetOrderAmount}
                onClosePosition={() => onClosePosition(posTok, size)}
                onLimitSellAtPrice={(priceCents) => onLimitSellAtPrice(posTok, size, priceCents)}
              />
            );
          })
        )}
      </div>
    </>
  );
});
