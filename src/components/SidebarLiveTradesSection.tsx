import { memo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { SidebarDataSourceBadge } from './SidebarDataSourceBadge';
import { SidebarLiveTradesTapeList } from './SidebarLiveTradesTapeList';

const LIVE_TRADES_PENDING_ROW_BG = 'bg-sky-500/10';

export type SidebarLiveTradesSectionProps = {
  liveTradesExpanded: boolean;
  onToggleLiveTradesExpanded: () => void;
  liveTradesSectionHeight: string;
  liveOrderbookExpanded: boolean;
  liveTradesSource: string;
  myOnchainWalletLower: string;
  selectedTokenId: string | null;
  oppositeTokenId: string | null;
};

function liveTradesSectionInner(props: SidebarLiveTradesSectionProps) {
  const {
    liveTradesExpanded,
    onToggleLiveTradesExpanded,
    liveTradesSectionHeight,
    liveOrderbookExpanded,
    liveTradesSource,
    myOnchainWalletLower,
    selectedTokenId,
    oppositeTokenId,
  } = props;

  return (
    <div
      className={`sidebar-section live-trades-section ${liveTradesExpanded ? 'expanded' : ''} ${liveTradesExpanded && !liveOrderbookExpanded ? 'boosted' : ''} flex flex-col min-h-0 overflow-hidden flex-shrink-0`}
      style={{ height: liveTradesSectionHeight, minHeight: liveTradesSectionHeight, maxHeight: liveTradesSectionHeight }}
    >
      <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
        <button
          type="button"
          onClick={onToggleLiveTradesExpanded}
          className="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition"
          title={liveTradesExpanded ? 'Collapse' : 'Expand'}
        >
          {liveTradesExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </button>
        <span>Live Trades</span>
        {liveTradesSource === 'onchain' ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-gray-500 font-normal">
            <span>(</span>
            <span
              className={`inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] ${LIVE_TRADES_PENDING_ROW_BG} ring-1 ring-sky-500/20`}
              aria-hidden
            />
            <span>- pending)</span>
          </span>
        ) : null}
        <SidebarDataSourceBadge source={liveTradesSource === 'onchain' ? 'onchain' : 'polymarket'} />
      </div>
      {liveTradesExpanded ? (
        <SidebarLiveTradesTapeList
          liveTradesSource={liveTradesSource}
          myOnchainWalletLower={myOnchainWalletLower}
          selectedTokenId={selectedTokenId}
          oppositeTokenId={oppositeTokenId}
        />
      ) : null}
    </div>
  );
}

export const SidebarLiveTradesSection = memo(liveTradesSectionInner);
