import { memo, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { resolvedBinaryOutcomeLabel } from '../utils/format';
import type { Market, Position } from '../types';
import type { SidebarObAggStep } from '../lib/sidebarOrderbookAggregate';
import { sidebarObAggOrderPriceCents, sidebarUserPriceHitsBucket } from '../lib/sidebarOrderbookAggregate';

import { SidebarBarMidMarker } from './SidebarBarMidMarker';

type OBLevel = { price: string; size: string };

export type SidebarLiveOrderbookSectionProps = {
  orderbookSectionHeight: string;
  liveOrderbookExpanded: boolean;
  onToggleLiveOrderbookExpanded: () => void;
  orderbookBookImbalance: number;
  displayBids: OBLevel[];
  displayAsks: OBLevel[];
  obAggStep: SidebarObAggStep;
  onObAggStepChange: (step: SidebarObAggStep) => void;
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
    obAggStep,
    onObAggStepChange,
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
        <div
          className="ml-auto shrink-0 inline-flex rounded border border-gray-600 overflow-hidden divide-x divide-gray-600 bg-gray-900/90"
          title="Bid/ask grouping"
        >
          {(
            [
              { step: '0.1' as const, label: '0.1¢' },
              { step: '1' as const, label: '1¢' },
              { step: '5' as const, label: '5¢' },
            ] as const
          ).map(({ step, label }) => (
            <button
              key={step}
              type="button"
              onClick={() => onObAggStepChange(step)}
              className={`px-1.5 py-0.5 text-[9px] font-semibold tabular-nums transition ${obAggStep === step ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {liveOrderbookExpanded && (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto" style={{ minHeight: 120 }}>
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
                    return (
                      <div
                        key={`${bpDisp}-${i}`}
                        className={`relative grid grid-cols-2 gap-1 text-[11px] px-1 hover:bg-green-900/30 cursor-pointer ${hl}`}
                        onClick={() => {
                          setOrderSide('SELL');
                          setOrderPrice(orderPk);
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
                        <span className="relative live-ob-bid">{bpDisp}¢</span>
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
                    return (
                      <div
                        key={`${apDisp}-${i}`}
                        className={`relative grid grid-cols-2 gap-1 text-[11px] px-1 hover:bg-red-900/30 cursor-pointer ${hl}`}
                        onClick={() => {
                          setOrderSide('BUY');
                          setOrderPrice(orderPk);
                          setOrderAmount(cumulativeAskSize.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1'));
                        }}
                      >
                        <div
                          className="absolute inset-y-0 left-0 bg-red-500/10 pointer-events-none"
                          style={{ width: `${depthPct}%` }}
                        />
                        <span className="relative live-ob-ask">{apDisp}¢</span>
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
