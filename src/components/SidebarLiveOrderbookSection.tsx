import { memo, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { resolvedBinaryOutcomeLabel } from '../utils/format';
import type { Market, Position } from '../types';

type OBLevel = { price: string; size: string };

export type SidebarLiveOrderbookSectionProps = {
  orderbookSectionHeight: string;
  liveOrderbookExpanded: boolean;
  onToggleLiveOrderbookExpanded: () => void;
  orderbookBookImbalance: number;
  displayBids: OBLevel[];
  displayAsks: OBLevel[];
  obLoading: boolean;
  isMarketExpired: boolean;
  isUpDownMarket: boolean;
  sidebarUserBidPrices: Set<string>;
  sidebarUserAskPrices: Set<string>;
  selectedMarket: Market | null;
  orderOutcome: 'YES' | 'NO';
  positions: Position[];
  /** Merged with `marketLookup` YES row so `outcomePrices` is fresh for resolution. */
  outcomeMarket: Market | null;
  setOrderSide: (s: 'BUY' | 'SELL') => void;
  setOrderPrice: (p: string) => void;
  setOrderAmount: (a: string) => void;
};

function orderbookSectionInner(props: SidebarLiveOrderbookSectionProps) {
  const {
    orderbookSectionHeight,
    liveOrderbookExpanded,
    onToggleLiveOrderbookExpanded,
    orderbookBookImbalance,
    displayBids,
    displayAsks,
    obLoading,
    isMarketExpired,
    isUpDownMarket,
    sidebarUserBidPrices,
    sidebarUserAskPrices,
    selectedMarket,
    orderOutcome,
    positions,
    outcomeMarket,
    setOrderSide,
    setOrderPrice,
    setOrderAmount,
  } = props;

  const resolvedOutcomeLabel = useMemo(
    () => resolvedBinaryOutcomeLabel(outcomeMarket, isUpDownMarket),
    [outcomeMarket, isUpDownMarket],
  );

  const overlayPrimary = resolvedOutcomeLabel
    ? { text: `Outcome: ${resolvedOutcomeLabel}`, className: 'text-emerald-400 font-bold' }
    : isMarketExpired
      ? { text: 'Market expired', className: 'text-red-400' }
      : obLoading
        ? { text: 'Loading orderbook...', className: 'text-gray-300' }
        : null;
  const showOrderbookOverlay = overlayPrimary != null;

  return (
    <div
      className="sidebar-section flex flex-col min-h-0 overflow-hidden"
      style={{ height: orderbookSectionHeight, minHeight: orderbookSectionHeight, maxHeight: orderbookSectionHeight }}
    >
      <div className="text-xs text-gray-400 mb-2 flex w-full min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={onToggleLiveOrderbookExpanded}
          className="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition"
          title={liveOrderbookExpanded ? 'Collapse' : 'Expand'}
        >
          {liveOrderbookExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <span className="shrink-0">Live Orderbook</span>
        <span
          className="inline-flex items-center rounded px-1 py-0.5 text-[9px] font-bold leading-none border border-[#2d57ff] bg-[#2f5cff]"
          title="This orderbook data comes from Polymarket's live market feed."
        >
          <img
            src="/polymarket-favicon.ico"
            alt="Polymarket"
            className="h-3 w-3 rounded-[2px]"
            style={{ filter: 'brightness(0) invert(1)' }}
          />
        </span>
      </div>
      {liveOrderbookExpanded && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto" style={{ minHeight: 120 }}>
          <div
            className="shrink-0 mb-1.5 px-0.5"
            title={`Book imbalance: ${(orderbookBookImbalance * 100).toFixed(1)}% (5–95¢ depth)`}
          >
            <div className="h-[5px] bg-gray-700 rounded-full overflow-hidden flex w-full">
              <div
                className="bg-emerald-500/70 h-full transition-all"
                style={{ width: `${Math.max(2, Math.min(98, 50 + orderbookBookImbalance * 50))}%` }}
              />
              <div className="bg-amber-500/70 h-full transition-all flex-1" />
            </div>
          </div>
          <div className="relative grid grid-cols-2 gap-2 flex-1 min-h-0">
            <div>
              <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-500 mb-1">
                <span>Bid</span>
                <span className="text-right">Size</span>
              </div>
              <div className="space-y-0.5">
                {(() => {
                  let cumul = 0;
                  const cumuls = displayBids.map((b) => {
                    cumul += parseFloat(b.size) || 0;
                    return cumul;
                  });
                  const maxCumul = cumuls.length > 0 ? cumuls[cumuls.length - 1] : 1;
                  return displayBids.map((bid, i) => {
                    const bp = (parseFloat(bid.price) * 100).toFixed(1);
                    const hl = sidebarUserBidPrices.has(bp) ? 'bg-blue-900/50 font-bold' : '';
                    const depthPct = maxCumul > 0 ? (cumuls[i] / maxCumul) * 100 : 0;
                    return (
                      <div
                        key={i}
                        className={`relative grid grid-cols-2 gap-1 text-[11px] px-1 hover:bg-green-900/30 cursor-pointer ${hl}`}
                        onClick={() => {
                          setOrderSide('SELL');
                          setOrderPrice(bp.replace(/\.0$/, ''));
                          const tokenId = selectedMarket?.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1] || '';
                          const pos = positions.find((p) => p.asset === tokenId && p.size > 0);
                          if (pos) setOrderAmount(String(Math.floor(pos.size * 100) / 100));
                          else setOrderAmount('');
                        }}
                      >
                        <div
                          className="absolute inset-y-0 right-0 bg-green-500/10 pointer-events-none"
                          style={{ width: `${depthPct}%` }}
                        />
                        <span className="relative live-ob-bid">{bp}¢</span>
                        <span className="relative text-right text-gray-400">{parseFloat(bid.size).toFixed(0)}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
            <div>
              <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-500 mb-1">
                <span>Ask</span>
                <span className="text-right">Size</span>
              </div>
              <div className="space-y-0.5">
                {(() => {
                  let cumul = 0;
                  const cumuls = displayAsks.map((a) => {
                    cumul += parseFloat(a.size) || 0;
                    return cumul;
                  });
                  const maxCumul = cumuls.length > 0 ? cumuls[cumuls.length - 1] : 1;
                  return displayAsks.map((ask, i) => {
                    const ap = (parseFloat(ask.price) * 100).toFixed(1);
                    const hl = sidebarUserAskPrices.has(ap) ? 'bg-orange-900/50 font-bold' : '';
                    const cumulativeAskSize = cumuls[i];
                    const depthPct = maxCumul > 0 ? (cumulativeAskSize / maxCumul) * 100 : 0;
                    return (
                      <div
                        key={i}
                        className={`relative grid grid-cols-2 gap-1 text-[11px] px-1 hover:bg-red-900/30 cursor-pointer ${hl}`}
                        onClick={() => {
                          setOrderSide('BUY');
                          setOrderPrice(ap.replace(/\.0$/, ''));
                          setOrderAmount(cumulativeAskSize.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1'));
                        }}
                      >
                        <div
                          className="absolute inset-y-0 left-0 bg-red-500/10 pointer-events-none"
                          style={{ width: `${depthPct}%` }}
                        />
                        <span className="relative live-ob-ask">{ap}¢</span>
                        <span className="relative text-right text-gray-400">{parseFloat(ask.size).toFixed(0)}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
            {showOrderbookOverlay && (
              <div className="absolute inset-0 z-10 bg-gray-900/55 backdrop-blur-[1px] flex items-center justify-center pointer-events-none px-2">
                <div className={`text-[10px] text-center leading-tight ${overlayPrimary?.className ?? 'text-gray-300'}`}>
                  {overlayPrimary?.text}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export const SidebarLiveOrderbookSection = memo(orderbookSectionInner);
