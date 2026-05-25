import { useMemo } from 'react';
import type { Market, Position } from '../types';
import type { SidebarObAggStep } from '../lib/sidebarOrderbookAggregate';
import { sidebarObAggOrderPriceCents, sidebarUserPriceHitsBucket } from '../lib/sidebarOrderbookAggregate';
import { SidebarBarMidMarker } from './SidebarBarMidMarker';

export type SidebarObLevel = { price: string; size: string };

function obLevelUsd(level: SidebarObLevel): number {
  const size = parseFloat(level.size);
  const price = parseFloat(level.price);
  if (!Number.isFinite(size) || !Number.isFinite(price)) return 0;
  return size * price;
}

function fmtObLevelUsd(usd: number): string {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`;
  if (usd >= 1000) return `$${(usd / 1000).toFixed(1)}k`;
  if (usd >= 100) return `$${Math.round(usd)}`;
  if (usd >= 10) return `$${usd.toFixed(0)}`;
  return `$${usd.toFixed(2)}`;
}

export type SidebarOrderbookBookGridProps = {
  displayBids: SidebarObLevel[];
  displayAsks: SidebarObLevel[];
  obAggStep: SidebarObAggStep;
  orderbookBookImbalance: number;
  sidebarUserBidPrices: Set<string>;
  sidebarUserAskPrices: Set<string>;
  readOnly?: boolean;
  selectedMarket?: Market | null;
  orderOutcome?: 'YES' | 'NO';
  positions?: Position[];
  setOrderSide?: (s: 'BUY' | 'SELL') => void;
  setOrderPrice?: (p: string) => void;
  setOrderAmount?: (a: string) => void;
  overlay?: { text: string; className: string } | null;
};

export function SidebarOrderbookBookGrid({
  displayBids,
  displayAsks,
  obAggStep,
  orderbookBookImbalance,
  sidebarUserBidPrices,
  sidebarUserAskPrices,
  readOnly = false,
  selectedMarket = null,
  orderOutcome = 'YES',
  positions = [],
  setOrderSide,
  setOrderPrice,
  setOrderAmount,
  overlay = null,
}: SidebarOrderbookBookGridProps) {
  const maxBookLevelSize = useMemo(() => {
    let max = 0;
    for (const level of displayBids) max = Math.max(max, parseFloat(level.size) || 0);
    for (const level of displayAsks) max = Math.max(max, parseFloat(level.size) || 0);
    return max || 1;
  }, [displayBids, displayAsks]);

  return (
    <>
      <div
        className="shrink-0 mb-1.5 px-0.5"
        title={`Book imbalance: ${(orderbookBookImbalance * 100).toFixed(1)}% (5–95¢ depth)`}
      >
        <div className="relative h-[5px] bg-gray-700 rounded-full overflow-hidden flex w-full">
          <div
            className="bg-emerald-500/70 h-full transition-all"
            style={{ width: `${Math.max(2, Math.min(98, 50 + orderbookBookImbalance * 50))}%` }}
          />
          <div className="bg-amber-500/70 h-full transition-all flex-1" />
          <SidebarBarMidMarker />
        </div>
      </div>
      <div className="relative grid grid-cols-2 gap-2 flex-1 min-h-0">
        <div>
          <div className="grid grid-cols-3 gap-1 text-[10px] text-gray-500 mb-1">
            <span>Bid</span>
            <span className="text-right">Size</span>
            <span className="text-right">USD</span>
          </div>
          <div className="space-y-0.5">
            {(() => {
              let cumul = 0;
              let cumulUsd = 0;
              const cumuls = displayBids.map((b) => {
                cumul += parseFloat(b.size) || 0;
                return cumul;
              });
              const cumulUsds = displayBids.map((b) => {
                cumulUsd += obLevelUsd(b);
                return cumulUsd;
              });
              const maxCumul = cumuls.length > 0 ? cumuls[cumuls.length - 1] : 1;
              return displayBids.map((bid, i) => {
                const levelSize = parseFloat(bid.size) || 0;
                const levelUsd = obLevelUsd(bid);
                const cumulativeUsd = cumulUsds[i];
                const centsNum = parseFloat(bid.price) * 100;
                const bpDisp = obAggStep === '0.1' ? centsNum.toFixed(1) : String(Math.round(centsNum));
                const orderPk =
                  obAggStep === '0.1'
                    ? centsNum.toFixed(1).replace(/\.0$/, '')
                    : sidebarObAggOrderPriceCents(centsNum, obAggStep === '1' ? '1' : '5');
                const hl =
                  obAggStep === '0.1'
                    ? sidebarUserBidPrices.has(centsNum.toFixed(1))
                      ? 'bg-blue-900/50 font-bold'
                      : ''
                    : sidebarUserPriceHitsBucket(sidebarUserBidPrices, centsNum, obAggStep === '1' ? '1' : '5')
                      ? 'bg-blue-900/50 font-bold'
                      : '';
                const depthPct = maxCumul > 0 ? (cumuls[i] / maxCumul) * 100 : 0;
                const levelPct = maxBookLevelSize > 0 ? (levelSize / maxBookLevelSize) * 100 : 0;
                return (
                  <div
                    key={`${bpDisp}-${i}`}
                    className={`relative grid grid-cols-3 gap-1 text-[10px] px-1 ${readOnly ? '' : 'hover:bg-green-900/30 cursor-pointer'} ${hl}`}
                    title={`Bid ${bpDisp}¢ · ${levelSize.toFixed(0)} shares · level ${fmtObLevelUsd(levelUsd)} · cumulative ${cumuls[i].toFixed(0)} shares / ${fmtObLevelUsd(cumulativeUsd)} (${depthPct.toFixed(0)}% of book shares · ${levelPct.toFixed(0)}% of max bid/ask size at level)`}
                    onClick={
                      readOnly
                        ? undefined
                        : () => {
                            setOrderSide?.('SELL');
                            setOrderPrice?.(orderPk);
                            const tokenId = selectedMarket?.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1] || '';
                            const pos = positions.find((p) => p.asset === tokenId && p.size > 0);
                            if (pos) setOrderAmount?.(String(Math.floor(pos.size * 100) / 100));
                            else setOrderAmount?.('');
                          }
                    }
                  >
                    <div
                      className="absolute inset-y-0 right-0 z-0 sidebar-ob-depth-bar-bid pointer-events-none"
                      style={{ width: `${depthPct}%` }}
                    />
                    <div
                      className="absolute inset-y-0 right-0 z-[1] sidebar-ob-level-bar-bid pointer-events-none"
                      style={{ width: `${levelPct}%`, minWidth: levelPct > 0 ? 2 : 0 }}
                    />
                    <span className="relative live-ob-bid">{bpDisp}¢</span>
                    <span className="relative text-right text-gray-400 tabular-nums">{levelSize.toFixed(0)}</span>
                    <span className="relative text-right text-gray-500 tabular-nums">{fmtObLevelUsd(cumulativeUsd)}</span>
                  </div>
                );
              });
            })()}
          </div>
        </div>
        <div>
          <div className="grid grid-cols-3 gap-1 text-[10px] text-gray-500 mb-1">
            <span>Ask</span>
            <span className="text-right">Size</span>
            <span className="text-right">USD</span>
          </div>
          <div className="space-y-0.5">
            {(() => {
              let cumul = 0;
              let cumulUsd = 0;
              const cumuls = displayAsks.map((a) => {
                cumul += parseFloat(a.size) || 0;
                return cumul;
              });
              const cumulUsds = displayAsks.map((a) => {
                cumulUsd += obLevelUsd(a);
                return cumulUsd;
              });
              const maxCumul = cumuls.length > 0 ? cumuls[cumuls.length - 1] : 1;
              return displayAsks.map((ask, i) => {
                const levelSize = parseFloat(ask.size) || 0;
                const levelUsd = obLevelUsd(ask);
                const cumulativeUsd = cumulUsds[i];
                const centsNum = parseFloat(ask.price) * 100;
                const apDisp = obAggStep === '0.1' ? centsNum.toFixed(1) : String(Math.round(centsNum));
                const orderPk =
                  obAggStep === '0.1'
                    ? centsNum.toFixed(1).replace(/\.0$/, '')
                    : sidebarObAggOrderPriceCents(centsNum, obAggStep === '1' ? '1' : '5');
                const hl =
                  obAggStep === '0.1'
                    ? sidebarUserAskPrices.has(centsNum.toFixed(1))
                      ? 'bg-orange-900/50 font-bold'
                      : ''
                    : sidebarUserPriceHitsBucket(sidebarUserAskPrices, centsNum, obAggStep === '1' ? '1' : '5')
                      ? 'bg-orange-900/50 font-bold'
                      : '';
                const cumulativeAskSize = cumuls[i];
                const depthPct = maxCumul > 0 ? (cumulativeAskSize / maxCumul) * 100 : 0;
                const levelPct = maxBookLevelSize > 0 ? (levelSize / maxBookLevelSize) * 100 : 0;
                return (
                  <div
                    key={`${apDisp}-${i}`}
                    className={`relative grid grid-cols-3 gap-1 text-[10px] px-1 ${readOnly ? '' : 'hover:bg-red-900/30 cursor-pointer'} ${hl}`}
                    title={`Ask ${apDisp}¢ · ${levelSize.toFixed(0)} shares · level ${fmtObLevelUsd(levelUsd)} · cumulative ${cumulativeAskSize.toFixed(0)} shares / ${fmtObLevelUsd(cumulativeUsd)} (${depthPct.toFixed(0)}% of book shares · ${levelPct.toFixed(0)}% of max bid/ask size at level)`}
                    onClick={
                      readOnly
                        ? undefined
                        : () => {
                            setOrderSide?.('BUY');
                            setOrderPrice?.(orderPk);
                            setOrderAmount?.(cumulativeAskSize.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1'));
                          }
                    }
                  >
                    <div
                      className="absolute inset-y-0 left-0 z-0 sidebar-ob-depth-bar-ask pointer-events-none"
                      style={{ width: `${depthPct}%` }}
                    />
                    <div
                      className="absolute inset-y-0 left-0 z-[1] sidebar-ob-level-bar-ask pointer-events-none"
                      style={{ width: `${levelPct}%`, minWidth: levelPct > 0 ? 2 : 0 }}
                    />
                    <span className="relative live-ob-ask">{apDisp}¢</span>
                    <span className="relative text-right text-gray-400 tabular-nums">{levelSize.toFixed(0)}</span>
                    <span className="relative text-right text-gray-500 tabular-nums">{fmtObLevelUsd(cumulativeUsd)}</span>
                  </div>
                );
              });
            })()}
          </div>
        </div>
        {overlay ? (
          <div className="absolute inset-0 z-10 bg-gray-900/55 backdrop-blur-[1px] flex items-center justify-center pointer-events-none px-2">
            <div className={`text-[10px] text-center leading-tight ${overlay.className}`}>{overlay.text}</div>
          </div>
        ) : null}
      </div>
    </>
  );
}
