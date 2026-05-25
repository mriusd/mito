import { memo, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import { openPolygonscanTx, polygonscanTxUrl } from '../lib/polygonscanLink';
import { onchainFillKey, polymarketTradeKey } from '../lib/tradeKeys';
import { useSidebarPolymarketTape } from '../lib/sidebarPolymarketTapeStore';
import { useSidebarOnchainLiveTrades } from '../lib/sidebarOnchainTradesStore';
import { SidebarDataSourceBadge } from './SidebarDataSourceBadge';

export type SidebarLiveTradesSectionProps = {
  liveTradesExpanded: boolean;
  onToggleLiveTradesExpanded: () => void;
  liveTradesSectionHeight: string;
  liveOrderbookExpanded: boolean;
  liveTradesSource: string;
  myOnchainWalletLower: string;
};

const LIVE_TRADES_GRID =
  'grid grid-cols-[minmax(4.75rem,1.45fr)_2.5rem_minmax(2rem,0.7fr)_minmax(2.25rem,0.8fr)_1.75rem] gap-x-2';
const LIVE_TRADES_PENDING_ROW_BG = 'bg-sky-500/10';

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
  const usdValue = Math.round(parseFloat(t.price) * parseFloat(t.size));
  const isPending = t.pending === true;
  const scanUrl =
    liveTradesSource === 'onchain' ? polygonscanTxUrl(t.txHash, isPending ? t.id : undefined) : null;
  void i;
  return (
    <div
      className={`${LIVE_TRADES_GRID} text-[11px] px-1 rounded-sm ${
        isPending
          ? LIVE_TRADES_PENDING_ROW_BG
          : isMine
            ? 'bg-blue-900/35 ring-1 ring-blue-500/60 shadow-[0_0_8px_rgba(59,130,246,0.25)]'
            : ''
      }`}
      title={isPending ? 'Pending — seen in mempool, not yet mined' : undefined}
    >
      <span className={`block min-w-0 ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
        <span className="inline-flex items-center gap-1">
        {tp}¢
        {isMine && (
          <span className="inline-flex items-center rounded bg-blue-500/30 px-1 py-[1px] text-[8px] font-bold leading-none text-blue-200">
            ME
          </span>
        )}
        {scanUrl && (
          <a
            href={scanUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={isPending ? 'Open pending tx on Polygonscan' : 'View transaction on Polygonscan'}
            className="no-drag inline-flex shrink-0 cursor-pointer p-0.5 text-gray-400 hover:text-blue-300"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!openPolygonscanTx(t.txHash, isPending ? t.id : undefined)) {
                throw new Error('polygonscan tx link missing hash');
              }
            }}
          >
            <ExternalLink size={11} aria-hidden />
          </a>
        )}
        </span>
      </span>
      <span className={`text-left text-[9px] ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
        {isBuy ? 'Buy' : 'Sell'}
      </span>
      <span className="text-right text-gray-400">{parseFloat(t.size).toFixed(0)}</span>
      <span className="text-right text-gray-400">{Number.isFinite(usdValue) ? usdValue.toLocaleString('en-US') : '–'}</span>
      <span className="text-right text-gray-500">{isPending ? '...' : agoStr}</span>
    </div>
  );
});

function liveTradesSectionInner(props: SidebarLiveTradesSectionProps) {
  const {
    liveTradesExpanded,
    onToggleLiveTradesExpanded,
    liveTradesSectionHeight,
    liveOrderbookExpanded,
    liveTradesSource,
    myOnchainWalletLower,
  } = props;

  const polymarketTape = useSidebarPolymarketTape();
  const onchainTape = useSidebarOnchainLiveTrades();
  const displayLiveTrades = useMemo(
    () => (liveTradesSource === 'onchain' ? onchainTape : polymarketTape),
    [liveTradesSource, onchainTape, polymarketTape],
  );

  /** Local 5 s bucket — parent 1 Hz tick re-rendered whole Sidebar + ToxicFlowDialog (381 profiler commits). */
  const [tradeTickBucket, setTradeTickBucket] = useState(() => Math.floor(Date.now() / 5000) * 5000);
  useEffect(() => {
    const iv = setInterval(() => setTradeTickBucket(Math.floor(Date.now() / 5000) * 5000), 5000);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    setTradeTickBucket(Math.floor(Date.now() / 5000) * 5000);
  }, [liveTradesSource]);

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
      {liveTradesExpanded && (
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
