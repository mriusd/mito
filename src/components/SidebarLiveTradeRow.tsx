import { memo } from 'react';
import { ExternalLink } from 'lucide-react';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import { openPolygonscanTx, polygonscanTxUrl } from '../lib/polygonscanLink';
import { useLiveTradeElapsedMs } from '../lib/liveTradeElapsedStore';

const LIVE_TRADES_PENDING_ROW_BG = 'bg-sky-500/10';

export const LiveTradeRow = memo(function LiveTradeRow({
  trade: t,
  liveTradesSource,
  myOnchainWalletLower,
  fallbackIndex: i,
}: {
  trade: LiveTrade;
  liveTradesSource: string;
  myOnchainWalletLower: string;
  fallbackIndex: number;
}) {
  const tradeTickBucket = useLiveTradeElapsedMs();
  const priceApprox = t.priceApproximate === true;
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
      className={`grid grid-cols-[minmax(4.75rem,1.45fr)_2.5rem_minmax(2rem,0.7fr)_minmax(2.25rem,0.8fr)_1.75rem] gap-x-2 text-[11px] px-1 rounded-sm ${
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
          {priceApprox ? '–' : `${tp}¢`}
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
      <span className="text-right text-gray-400">{priceApprox ? '–' : Number.isFinite(usdValue) ? usdValue.toLocaleString('en-US') : '–'}</span>
      <span className="text-right text-gray-500">{isPending ? '...' : agoStr}</span>
    </div>
  );
});
