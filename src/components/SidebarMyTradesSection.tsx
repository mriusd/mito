import { memo, useMemo, useState } from 'react';
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

const GROUP_LS_KEY = 'sidebar-my-trades-group';

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

type MyTradeRow = {
  asset_id?: string;
  token_id?: string;
  side: string;
  price: string;
  size: string;
  fee?: string;
  timestamp?: number | string;
  txHash?: string;
  logIndex?: number;
  created_at?: string;
  matchTime?: string;
  size_filled?: string;
};

type DisplayTradeRow = MyTradeRow & {
  rowKey: string;
  flashKeys: string[];
  groupedCount: number;
  /** Sum of fill notionals (price*size); used for Cost when grouped. */
  notional: number;
};

/** Round probability to 0.1¢ (not whole cents). e.g. 0.00145 → 0.1¢ key. */
function roundPriceToTenthCent(rawPrice: number): number {
  if (!Number.isFinite(rawPrice)) return NaN;
  return Math.round(rawPrice * 1000) / 1000;
}

/** Group key = ¢ with 1 decimal place (0.1¢ steps). */
function tradeGroupPriceKey(rawPrice: number): string {
  const p = roundPriceToTenthCent(rawPrice);
  if (!Number.isFinite(p)) return '';
  return (p * 100).toFixed(1);
}

function tradeOutcomeGroupKey(
  tid: string,
  selectedMarket: Market,
  marketLookup: Record<string, Market>,
): string {
  const fromLookup = getTokenOutcome(tid, marketLookup);
  if (fromLookup) return fromLookup;
  const toks = selectedMarket.clobTokenIds || [];
  if (toks[0] && normalizeClobTokenId(toks[0]) === tid) return 'YES';
  if (toks[1] && normalizeClobTokenId(toks[1]) === tid) return 'NO';
  return tid || '-';
}

function groupMyTrades(
  trades: MyTradeRow[],
  selectedMarket: Market,
  marketLookup: Record<string, Market>,
): DisplayTradeRow[] {
  const groups = new Map<string, DisplayTradeRow>();
  for (const trade of trades) {
    const side = String(trade.side || '').toUpperCase() || '-';
    const rawPrice = parseFloat(trade.price);
    const priceKey = tradeGroupPriceKey(rawPrice);
    const tid = normalizeClobTokenId(
      getTradeClobTokenId(trade) || String(trade.asset_id || trade.token_id || '').trim(),
    );
    const outcome = tradeOutcomeGroupKey(tid, selectedMarket, marketLookup);
    // Dir + display ¢ + YES/NO — ignore float noise / token-id formatting.
    const gKey = `${side}|${priceKey}|${outcome}`;
    const sizeRaw = tradeFilledSizeShares(trade);
    const size = Number.isFinite(sizeRaw) ? sizeRaw : 0;
    const fee = parseFloat(trade.fee || '0');
    const feeAdd = Number.isFinite(fee) && fee > 0 ? fee : 0;
    const notional = (Number.isFinite(rawPrice) ? rawPrice : 0) * size;
    const timeMs = tradeTimeMs(trade);
    const memberKey = mySidebarTradeRowKey(trade);
    const prev = groups.get(gKey);
    if (!prev) {
      const canonPrice = roundPriceToTenthCent(rawPrice);
      groups.set(gKey, {
        ...trade,
        side,
        price: Number.isFinite(canonPrice) ? String(canonPrice) : trade.price,
        size: String(size),
        fee: String(feeAdd),
        timestamp: timeMs > 0 ? timeMs : trade.timestamp,
        rowKey: `grp:${gKey}`,
        flashKeys: memberKey ? [memberKey] : [],
        groupedCount: 1,
        notional,
      });
      continue;
    }
    const prevSizeRaw = tradeFilledSizeShares(prev);
    const prevSize = Number.isFinite(prevSizeRaw) ? prevSizeRaw : 0;
    const prevFee = parseFloat(prev.fee || '0');
    const prevTime = tradeTimeMs(prev);
    const nextSize = prevSize + size;
    prev.size = String(nextSize);
    prev.notional += notional;
    // Keep row price on the 0.1¢ bucket (size-weighted avg snapped to 1 decimal ¢).
    const avg = nextSize > 0 ? prev.notional / nextSize : parseFloat(prev.price);
    prev.price = String(roundPriceToTenthCent(avg));
    prev.fee = String((Number.isFinite(prevFee) ? prevFee : 0) + feeAdd);
    prev.groupedCount += 1;
    if (memberKey) prev.flashKeys.push(memberKey);
    if (timeMs > prevTime) {
      prev.timestamp = timeMs;
      prev.txHash = trade.txHash;
      prev.logIndex = trade.logIndex;
    }
  }
  return Array.from(groups.values()).sort((a, b) => tradeTimeMs(b) - tradeTimeMs(a));
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
  const [groupOn, setGroupOn] = useState(() => localStorage.getItem(GROUP_LS_KEY) === '1');

  const myTrades = useMemo(() => {
    if (liveTradesSource !== 'onchain') {
      return trades.filter((t) => tradeMatchesSelectedMarket(t, selectedMarket, marketLookup)) as MyTradeRow[];
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

  const tableRows = useMemo((): DisplayTradeRow[] => {
    if (!groupOn) {
      return myTradesDisplay.map((trade, i) => {
        const k = mySidebarTradeRowKey(trade);
        const rawPrice = parseFloat(trade.price);
        const size = tradeFilledSizeShares(trade);
        return {
          ...trade,
          rowKey: k || `my-trade-${i}`,
          flashKeys: k ? [k] : [],
          groupedCount: 1,
          notional:
            (Number.isFinite(rawPrice) ? rawPrice : 0) * (Number.isFinite(size) ? size : 0),
        };
      });
    }
    return groupMyTrades(myTradesDisplay, selectedMarket, marketLookup);
  }, [groupOn, myTradesDisplay, selectedMarket, marketLookup]);

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

  // Ring/flash from raw fills so grouping never suppresses new-trade sound.
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
          <label className="flex items-center gap-1 cursor-pointer select-none text-[10px] text-gray-500 hover:text-gray-300">
            <input
              type="checkbox"
              className="rounded accent-amber-500"
              checked={groupOn}
              onChange={(e) => {
                const on = e.target.checked;
                setGroupOn(on);
                localStorage.setItem(GROUP_LS_KEY, on ? '1' : '0');
              }}
            />
            <span>Group</span>
          </label>
        </div>
        <span className={myTradesPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
          PnL {myTradesPnl >= 0 ? '+' : ''}${Math.abs(myTradesPnl).toFixed(2)}
        </span>
      </div>
      <div className="max-h-48 overflow-y-auto text-[11px]">
        {tableRows.length === 0 ? (
          <div className="text-gray-600">No trades</div>
        ) : (
          <table className="w-full border-separate border-spacing-y-0.5">
            <colgroup>
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
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
              {tableRows.map((trade) => {
                const isFlashing = trade.flashKeys.some((k) => myTradeFlashKeys.has(k));
                const tid = getTradeClobTokenId(trade) || String(trade.asset_id || trade.token_id || '').trim();
                const outcome = getTokenOutcome(tid, marketLookup);
                const sideLabel = isUpDownMarket ? (outcome === 'YES' ? 'UP' : 'DOWN') : outcome;
                const rawPrice = parseFloat(trade.price);
                const size = tradeFilledSizeShares(trade);
                const isClaim = rawPrice === 0 && !(trade as { side?: string | null }).side;
                const side = isClaim ? 'CLAIM' : trade.side;
                const cost = Number.isFinite(trade.notional) ? trade.notional : 0;
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
                  ageMs < 60_000
                    ? 'text-purple-400'
                    : ageMs < 15 * 60_000
                      ? 'text-green-400'
                      : ageMs < 60 * 60_000
                        ? 'text-yellow-400'
                        : 'text-gray-400';
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
                    key={trade.rowKey}
                    className={`text-gray-300${isFlashing ? ' my-trade-row-flash' : ''}`}
                    title={trade.groupedCount > 1 ? `${trade.groupedCount} fills @ same price` : undefined}
                  >
                    <td className={`py-0.5 pr-1 ${dirTone}`}>{side || '-'}</td>
                    <td className={`py-0.5 pr-1 ${outcome === 'YES' ? 'text-emerald-400' : 'text-rose-400'}`}>{sideLabel}</td>
                    <td className="py-0.5 pr-1 text-right tabular-nums whitespace-nowrap">
                      {Number.isFinite(size) ? size.toFixed(2) : '-'}
                    </td>
                    <td className="py-0.5 pr-1 text-right tabular-nums whitespace-nowrap">
                      {Number.isFinite(rawPrice) ? `${(rawPrice * 100).toFixed(1)}¢` : '-'}
                    </td>
                    <td className="py-0.5 pr-1 text-right tabular-nums whitespace-nowrap text-yellow-400/80">
                      {tradeFee > 0 ? `$${tradeFee.toFixed(2)}` : '-'}
                    </td>
                    <td
                      className={`py-0.5 pr-1 text-right tabular-nums whitespace-nowrap ${
                        side === 'BUY' || side === 'SPLIT'
                          ? 'text-rose-400'
                          : side === 'SELL' || side === 'MERGE' || side === 'REDEEM'
                            ? 'text-emerald-400'
                            : 'text-gray-300'
                      }`}
                    >
                      {signedCost >= 0 ? '+' : '-'}${Math.abs(signedCost).toFixed(2)}
                    </td>
                    <td className={`py-0.5 text-right tabular-nums whitespace-nowrap ${timeColor}`}>
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
