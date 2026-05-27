import { memo, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { resolvedBinaryOutcomeLabel } from '../utils/format';
import type { Market, Position } from '../types';
import type { SidebarObAggStep } from '../lib/sidebarOrderbookAggregate';
import { SidebarDataSourceBadge } from './SidebarDataSourceBadge';
import { SidebarOrderbookBookGrid, type SidebarObLevel } from './SidebarOrderbookBookGrid';

export type SidebarLiveOrderbookSectionProps = {
  orderbookSectionHeight: string;
  liveOrderbookExpanded: boolean;
  onToggleLiveOrderbookExpanded: () => void;
  yesBidUsd: number;
  yesAskUsd: number;
  displayBidFullUsd: number;
  displayAskFullUsd: number;
  displayBids: SidebarObLevel[];
  displayAsks: SidebarObLevel[];
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
    yesBidUsd,
    yesAskUsd,
    displayBidFullUsd,
    displayAskFullUsd,
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
        <SidebarDataSourceBadge source="polymarket" />
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
      {liveOrderbookExpanded ? (
        <div className="flex flex-col flex-1 min-h-0 overflow-y-auto" style={{ minHeight: 120 }}>
          <SidebarOrderbookBookGrid
            displayBids={displayBids}
            displayAsks={displayAsks}
            obAggStep={obAggStep}
            yesBidUsd={yesBidUsd}
            yesAskUsd={yesAskUsd}
            displayBidFullUsd={displayBidFullUsd}
            displayAskFullUsd={displayAskFullUsd}
            sidebarUserBidPrices={sidebarUserBidPrices}
            sidebarUserAskPrices={sidebarUserAskPrices}
            selectedMarket={selectedMarket}
            orderOutcome={orderOutcome}
            positions={positions}
            setOrderSide={setOrderSide}
            setOrderPrice={setOrderPrice}
            setOrderAmount={setOrderAmount}
            overlay={overlayPrimary}
          />
        </div>
      ) : null}
    </div>
  );
}

export const SidebarLiveOrderbookSection = memo(orderbookSectionInner);
