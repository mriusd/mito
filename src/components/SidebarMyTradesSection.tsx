import { memo, useMemo } from 'react';
import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';
import {
  formatElapsedSinceMs,
  getTokenOutcome,
  getTradeClobTokenId,
  normalizeClobTokenId,
  outcomeTokenBelongsToSelectedMarket,
  tradeMatchesSelectedMarket,
} from '../utils/format';
import { mySidebarTradeRowKey, useMyTradeRowRingSound } from '../lib/myTradeRowRing';
import { isMarketExpired as marketIsExpired } from '../lib/marketExpiry';
import { useSidebarOnchainWalletMarketTrades } from '../lib/sidebarOnchainTradesStore';
import { useWalletTradeElapsedMs } from '../lib/walletTradeElapsedStore';
import { canonicalConditionKey } from '../hooks/useOnchainTradesWS';
import { SidebarDataSourceBadge } from './SidebarDataSourceBadge';

function tradeFilledSizeShares(trade: { size: string; size_filled?: string }): number {
  return parseFloat(trade.size_filled ?? trade.size);
}

function tradeTimeMs(trade: {
  timestamp?: string | number;
  match_time?: string | number;
  created_at?: string | number;
  matchTime?: string | number;
}): number {
  const ts = trade.match_time ?? trade.timestamp ?? trade.created_at ?? trade.matchTime ?? '';
  if (!ts) return 0;
  let t = typeof ts === 'string' ? parseInt(ts, 10) : ts;
  if (!Number.isFinite(t) || t <= 0) return 0;
  if (t < 1e12) t = t * 1000;
  return t;
}

export const SidebarMyTradesSection = memo(function SidebarMyTradesSection({
  selectedMarket,
  marketLookup,
  liveTradesSource,
  isUpDownMarket,
  walletForLivePositions,
  yesTokenIdForSoundMute,
  noTokenIdForSoundMute,
}: {
  selectedMarket: Market;
  marketLookup: Record<string, Market>;
  liveTradesSource: string;
  isUpDownMarket: boolean;
  walletForLivePositions: string | null;
  yesTokenIdForSoundMute: string;
  noTokenIdForSoundMute: string;
}) {
  const trades = useAppStore((s) => s.trades);
  const wsMarketTrades = useSidebarOnchainWalletMarketTrades();
  const nowMs = useWalletTradeElapsedMs();

  const myTrades = useMemo(() => {
    if (liveTradesSource !== 'onchain') {
      return trades.filter((t) => tradeMatchesSelectedMarket(t, selectedMarket, marketLookup));
    }
    const selCond = canonicalConditionKey(
      String(selectedMarket.conditionId || selectedMarket.id || '').trim(),
    );
    const selToks = new Set(
      (selectedMarket.clobTokenIds || [])
        .map((t) => normalizeClobTokenId(String(t || '').trim()))
        .filter(Boolean),
    );
    return wsMarketTrades
      .filter((f) => {
        if (f.pending) return false;
        const tid = String(f.tokenId || '').trim();
        if (outcomeTokenBelongsToSelectedMarket(tid, selectedMarket, marketLookup)) return true;
        // Expired stubs / WS market snapshots: match by condition id or normalized token.
        const fillCond = canonicalConditionKey(String(f.marketId || '').trim());
        if (selCond && fillCond && selCond === fillCond && !selCond.startsWith('expired:')) return true;
        return !!tid && selToks.has(normalizeClobTokenId(tid));
      })
      .slice()
      .sort((a, b) => b.blockTime - a.blockTime || (b.logIndex ?? 0) - (a.logIndex ?? 0))
      .map((f) => ({
        asset_id: f.tokenId,
        token_id: f.tokenId,
        side: f.side,
        price: String(f.price),
        size: String(f.size),
        fee: String(f.fee || 0),
        timestamp: f.blockTime > 0 ? f.blockTime * 1000 : Date.now(),
        txHash: f.txHash,
        logIndex: f.logIndex,
        created_at: '',
        matchTime: '',
      }));
  }, [liveTradesSource, trades, selectedMarket, marketLookup, wsMarketTrades]);

  const myTradesDisplay = useMemo(
    () => (liveTradesSource === 'onchain' ? myTrades : myTrades.slice(0, 20)),
    [liveTradesSource, myTrades],
  );

  const myTradesPnl = useMemo(() => {
    let totalSellCost = 0;
    let totalBuyCost = 0;
    for (const trade of myTradesDisplay) {
      const rawPrice = parseFloat(trade.price);
      const size = tradeFilledSizeShares(trade);
      if (!Number.isFinite(rawPrice) || !Number.isFinite(size)) continue;
      const cost = rawPrice * size;
      if (trade.side === 'SELL' || trade.side === 'MERGE' || trade.side === 'REDEEM') totalSellCost += cost;
      else if (trade.side === 'BUY' || trade.side === 'SPLIT') totalBuyCost += cost;
    }
    return totalSellCost - totalBuyCost;
  }, [myTradesDisplay]);

  const myTradeScopeKey =
    selectedMarket?.conditionId || selectedMarket?.id
      ? `${selectedMarket?.conditionId || selectedMarket?.id}|${(walletForLivePositions || '').toLowerCase()}|${liveTradesSource}`
      : null;

  const myTradeFlashKeys = useMyTradeRowRingSound(
    myTradesDisplay,
    myTradeScopeKey,
    !!selectedMarket && !marketIsExpired(selectedMarket),
    yesTokenIdForSoundMute,
    noTokenIdForSoundMute,
  );

  return (
    <div className="sidebar-section">
      <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
        <div className="flex items-center gap-1.5 min-w-0">
          <span>My Trades</span>
          <SidebarDataSourceBadge source={liveTradesSource === 'onchain' ? 'onchain' : 'polymarket'} />
        </div>
        <span className={myTradesPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
          PnL {myTradesPnl >= 0 ? '+' : ''}${Math.abs(myTradesPnl).toFixed(2)}
        </span>
      </div>
      <div className="max-h-48 overflow-y-auto text-[11px]">
        {myTradesDisplay.length === 0 ? (
          <div className="text-gray-600">No trades</div>
        ) : (
          <table className="w-full table-fixed border-separate border-spacing-y-0.5">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-gray-500">
                <th className="text-left font-medium">Dir</th>
                <th className="text-left font-medium">Side</th>
                <th className="text-right font-medium">Size</th>
                <th className="text-right font-medium">Price</th>
                <th className="text-right font-medium">Fee</th>
                <th className="text-right font-medium">Cost</th>
                <th className="text-right font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {myTradesDisplay.map((trade, i) => {
                const rowKey = mySidebarTradeRowKey(trade) || `my-trade-${i}`;
                const isFlashing = myTradeFlashKeys.has(rowKey);
                const tid = getTradeClobTokenId(trade) || String(trade.asset_id || trade.token_id || '').trim();
                const outcome = getTokenOutcome(tid, marketLookup);
                const sideLabel = isUpDownMarket ? (outcome === 'YES' ? 'UP' : 'DOWN') : outcome;
                const rawPrice = parseFloat(trade.price);
                const size = tradeFilledSizeShares(trade);
                const isClaim = rawPrice === 0 && !(trade as { side?: string | null }).side;
                const side = isClaim ? 'CLAIM' : trade.side;
                const cost = Number.isFinite(rawPrice) && Number.isFinite(size) ? rawPrice * size : 0;
                const signedCost =
                  side === 'BUY' || side === 'SPLIT'
                    ? -cost
                    : side === 'SELL' || side === 'MERGE' || side === 'REDEEM'
                      ? cost
                      : 0;
                const tradeFee = parseFloat(trade.fee || '0');
                const timeMs = tradeTimeMs(trade);
                const ageMs = timeMs > 0 ? nowMs - timeMs : Infinity;
                const timeColor =
                  ageMs < 15 * 60000 ? 'text-green-400' : ageMs < 60 * 60000 ? 'text-yellow-400' : 'text-gray-400';
                const dirTone =
                  side === 'BUY'
                    ? 'text-emerald-400'
                    : side === 'CLAIM' || side === 'REDEEM'
                      ? 'text-blue-400'
                      : side === 'SPLIT' || side === 'MERGE'
                        ? 'text-purple-400'
                        : 'text-rose-400';
                return (
                  <tr
                    key={rowKey}
                    className={`text-gray-300${isFlashing ? ' my-trade-row-flash' : ''}`}
                  >
                    <td className={`py-0.5 ${dirTone}`}>{side || '-'}</td>
                    <td className={outcome === 'YES' ? 'py-0.5 text-emerald-400' : 'py-0.5 text-rose-400'}>{sideLabel}</td>
                    <td className="py-0.5 text-right">{Number.isFinite(size) ? size.toFixed(2) : '-'}</td>
                    <td className="py-0.5 text-right">{Number.isFinite(rawPrice) ? `${(rawPrice * 100).toFixed(1)}¢` : '-'}</td>
                    <td className="py-0.5 text-right text-yellow-400/80">{tradeFee > 0 ? `$${tradeFee.toFixed(2)}` : '-'}</td>
                    <td
                      className={`py-0.5 text-right ${
                        side === 'BUY' || side === 'SPLIT'
                          ? 'text-rose-400'
                          : side === 'SELL' || side === 'MERGE' || side === 'REDEEM'
                            ? 'text-emerald-400'
                            : 'text-gray-300'
                      }`}
                    >
                      {signedCost >= 0 ? '+' : '-'}${Math.abs(signedCost).toFixed(2)}
                    </td>
                    <td className={`py-0.5 text-right tabular-nums ${timeColor}`}>
                      {timeMs > 0 ? formatElapsedSinceMs(timeMs, nowMs) : ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
});
