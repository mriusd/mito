import { memo, useEffect, useMemo } from 'react';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import { onchainFillKey, polymarketTradeKey } from '../lib/tradeKeys';
import { resetLiveTradeElapsedBucket } from '../lib/liveTradeElapsedStore';
import { normalizeLiveTradeToSelectedToken } from '../lib/liveTradeOutcomeNormalize';
import { useSidebarPolymarketTape } from '../lib/sidebarPolymarketTapeStore';
import { useSidebarOnchainLiveTrades } from '../lib/sidebarOnchainTradesStore';
import { LiveTradeRow } from './SidebarLiveTradeRow';

const LIVE_TRADES_GRID =
  'grid grid-cols-[minmax(4.75rem,1.45fr)_2.5rem_minmax(2rem,0.7fr)_minmax(2.25rem,0.8fr)_1.75rem] gap-x-2';

export const SidebarLiveTradesTapeList = memo(function SidebarLiveTradesTapeList({
  liveTradesSource,
  myOnchainWalletLower,
  selectedTokenId,
  oppositeTokenId,
}: {
  liveTradesSource: string;
  myOnchainWalletLower: string;
  selectedTokenId: string | null;
  oppositeTokenId: string | null;
}) {
  const polymarketTape = useSidebarPolymarketTape();
  const onchainTape = useSidebarOnchainLiveTrades();
  const displayLiveTrades = useMemo(() => {
    const raw = liveTradesSource === 'onchain' ? onchainTape : polymarketTape;
    const filtered = raw.filter((t) => t.priceApproximate !== true);
    if (!selectedTokenId) return filtered;
    return filtered.map((t) => normalizeLiveTradeToSelectedToken(t, selectedTokenId, oppositeTokenId));
  }, [liveTradesSource, onchainTape, polymarketTape, selectedTokenId, oppositeTokenId]);
  const visibleTrades = displayLiveTrades.length > 150 ? displayLiveTrades.slice(0, 150) : displayLiveTrades;

  useEffect(() => {
    resetLiveTradeElapsedBucket();
  }, [liveTradesSource]);

  return (
    <>
      <div className={`${LIVE_TRADES_GRID} text-[10px] text-gray-500 mb-1`}>
        <span>Price</span>
        <span className="text-left">Side</span>
        <span className="text-right">Size</span>
        <span className="text-right">USD</span>
        <span className="text-right">Time</span>
      </div>
      <div className="relative space-y-0.5 overflow-y-auto flex-1 min-h-0" style={{ minHeight: 90 }}>
        {visibleTrades.map((t, i) => (
          <LiveTradeRow
            key={t.id ?? onchainFillKey(t.txHash, t.logIndex) ?? polymarketTradeKey(t.timestamp, t.price, t.size) ?? `row-${i}`}
            trade={t}
            liveTradesSource={liveTradesSource}
            myOnchainWalletLower={myOnchainWalletLower}
            fallbackIndex={i}
          />
        ))}
        {visibleTrades.length === 0 && <div className="text-[10px] text-gray-600 px-1">Waiting...</div>}
      </div>
    </>
  );
});
