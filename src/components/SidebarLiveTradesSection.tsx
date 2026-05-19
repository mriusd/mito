import { memo } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import { onchainFillKey, polymarketTradeKey } from '../lib/tradeKeys';
import { SidebarDataSourceBadge } from './SidebarDataSourceBadge';

export type SidebarLiveTradesSectionProps = {
  liveTradesExpanded: boolean;
  onToggleLiveTradesExpanded: () => void;
  liveTradesSectionHeight: string;
  liveOrderbookExpanded: boolean;
  displayLiveTrades: LiveTrade[];
  /** Quantize to 5 s buckets in the parent — passing wall-clock 1 Hz caused all 150 row memos to bust every second. */
  tradeTickBucket: number;
  liveTradesSource: string;
  myOnchainWalletLower: string;
};

type LiveTradeRowProps = {
  trade: LiveTrade;
  tradeTickBucket: number;
  liveTradesSource: string;
  myOnchainWalletLower: string;
  fallbackIndex: number;
};

const LiveTradeRow = memo(function LiveTradeRow({ trade: t, tradeTickBucket, liveTradesSource, myOnchainWalletLower, fallbackIndex: i }: LiveTradeRowProps) {
  const tp = (parseFloat(t.price) * 100).toFixed(1);
  const isBuy = t.side === 'BUY';
  const makerLower = (t.maker || '').toLowerCase();
  const takerLower = (t.taker || '').toLowerCase();
  const isMine =
    liveTradesSource === 'onchain' &&
    !!myOnchainWalletLower &&
    (makerLower === myOnchainWalletLower || takerLower === myOnchainWalletLower);
  const rawTs = Number(t.timestamp);
  const ts = Number.isFinite(rawTs) ? Math.min(rawTs, tradeTickBucket) : tradeTickBucket;
  const agoSec = Math.max(0, Math.floor((tradeTickBucket - ts) / 1000));
  const agoStr =
    agoSec < 60
      ? `${agoSec}s`
      : agoSec < 3600
        ? `${Math.floor(agoSec / 60)}m`
        : agoSec < 86400
          ? `${Math.floor(agoSec / 3600)}h`
          : `${Math.floor(agoSec / 86400)}d`;
  const usdValue = (parseFloat(t.price) * parseFloat(t.size)).toFixed(2);
  void i;
  return (
    <div
      className={`grid grid-cols-5 gap-1 text-[11px] px-1 rounded-sm ${
        isMine ? 'bg-blue-900/35 ring-1 ring-blue-500/60 shadow-[0_0_8px_rgba(59,130,246,0.25)]' : ''
      }`}
    >
      <span className={`inline-flex items-center gap-1 ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
        {tp}¢
        {isMine && (
          <span className="inline-flex items-center rounded bg-blue-500/30 px-1 py-[1px] text-[8px] font-bold leading-none text-blue-200">
            ME
          </span>
        )}
        {liveTradesSource === 'onchain' && t.txHash && (
          <a
            href={`https://polygonscan.com/tx/${t.txHash}`}
            target="_blank"
            rel="noreferrer"
            title="View transaction on Polygonscan"
            className="text-gray-400 hover:text-blue-300"
          >
            <ExternalLink size={11} />
          </a>
        )}
      </span>
      <span className={`text-right text-[9px] ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
        {isBuy ? 'Buy' : 'Sell'}
      </span>
      <span className="text-right text-gray-400">{parseFloat(t.size).toFixed(0)}</span>
      <span className="text-right text-gray-400">{usdValue}</span>
      <span className="text-right text-gray-500">{agoStr}</span>
    </div>
  );
});

function liveTradesSectionInner(props: SidebarLiveTradesSectionProps) {
  const {
    liveTradesExpanded,
    onToggleLiveTradesExpanded,
    liveTradesSectionHeight,
    liveOrderbookExpanded,
    displayLiveTrades,
    tradeTickBucket,
    liveTradesSource,
    myOnchainWalletLower,
  } = props;

  /** Hard render cap — each row mounts a lucide SVG anchor; 1000+ rows trashed thousands of detached SVG nodes on every market switch. */
  const visibleTrades = displayLiveTrades.length > 150 ? displayLiveTrades.slice(0, 150) : displayLiveTrades;

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
        <SidebarDataSourceBadge source={liveTradesSource === 'onchain' ? 'onchain' : 'polymarket'} />
      </div>
      {liveTradesExpanded && (
        <>
          <div className="grid grid-cols-5 gap-1 text-[10px] text-gray-500 mb-1">
            <span>Price</span>
            <span className="text-right">Side</span>
            <span className="text-right">Size</span>
            <span className="text-right">USD</span>
            <span className="text-right">Time</span>
          </div>
          <div className="relative space-y-0.5 overflow-y-auto flex-1 min-h-0" style={{ minHeight: 90 }}>
            {visibleTrades.map((t, i) => (
              <LiveTradeRow
                key={t.id ?? onchainFillKey(t.txHash, t.logIndex) ?? polymarketTradeKey(t.timestamp, t.price, t.size) ?? `row-${i}`}
                trade={t}
                tradeTickBucket={tradeTickBucket}
                liveTradesSource={liveTradesSource}
                myOnchainWalletLower={myOnchainWalletLower}
                fallbackIndex={i}
              />
            ))}
            {visibleTrades.length === 0 && <div className="text-[10px] text-gray-600 px-1">Waiting...</div>}
          </div>
        </>
      )}
    </div>
  );
}

export const SidebarLiveTradesSection = memo(liveTradesSectionInner);
