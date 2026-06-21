import { forwardRef, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import { useMarketLookupSnapshot } from '../hooks/useMarketLookupSnapshot';
import { BsFlower } from './BsFlower';
import { isMarketInWeeklyHitMarkets } from '../utils/bsMath';
import { shortenMarketName } from '../utils/format';
import type { OBEntry } from '../lib/candleObSnapshot';

export type { OBEntry };

export type OrderbookPopupPanelProps = {
  title: string;
  tokenId: string;
  isYes: boolean;
  asset?: string;
  strike?: string;
  endDate?: string;
  bids: OBEntry[];
  asks: OBEntry[];
  loading?: boolean;
  error?: boolean;
  snapshotTs?: number;
  className?: string;
  style?: React.CSSProperties;
};

function shortenTitle(title: string): string {
  const outcomeMatch = title.match(/\((YES|NO|UP|DOWN)\)\s*$/);
  const outcome = outcomeMatch ? outcomeMatch[1] : '';
  const baseTitle = outcomeMatch ? title.substring(0, outcomeMatch.index).trim() : title;
  const short = shortenMarketName(baseTitle);
  return outcome ? `${short} (${outcome})` : short;
}

export const OrderbookPopupPanel = forwardRef<HTMLDivElement, OrderbookPopupPanelProps>(function OrderbookPopupPanel(
  {
    title,
    tokenId,
    isYes,
    asset = '',
    strike = '',
    endDate = '',
    bids,
    asks,
    loading = false,
    error = false,
    snapshotTs,
    className,
    style,
  },
  ref,
) {
  const positions = useAppStore((s) => s.positions);
  const orders = useAppStore((s) => s.orders);
  const marketLookup = useMarketLookupSnapshot();
  const weeklyHitMarkets = useAppStore((s) => s.weeklyHitMarkets);

  const position = useMemo(() => {
    if (!tokenId) return null;
    return positions.find((p) => p.asset === tokenId && p.size > 0) || null;
  }, [positions, tokenId]);

  const tokenOrders = useMemo(() => {
    if (!tokenId) return [];
    return orders.filter((o) => (o.asset_id || o.token_id || '') === tokenId);
  }, [orders, tokenId]);

  const obHitBarrierModel = useMemo(() => {
    const m = marketLookup[tokenId];
    return m ? isMarketInWeeklyHitMarkets(m.id, weeklyHitMarkets) : false;
  }, [marketLookup, weeklyHitMarkets, tokenId]);

  const maxRows = Math.max(bids.length, asks.length, 1);
  const fmtSz = (n: number) => {
    const v = Math.floor(n);
    return v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : v.toLocaleString();
  };

  const userBidPrices = new Set<string>();
  const userAskPrices = new Set<string>();
  for (const o of tokenOrders) {
    const pp = (parseFloat(o.price) * 100).toFixed(1);
    if (o.side === 'BUY') userBidPrices.add(pp);
    else userAskPrices.add(pp);
  }

  return (
    <div
      ref={ref}
      className={className ?? 'bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 pointer-events-none'}
      style={style ?? { minWidth: 220, maxWidth: 250, maxHeight: '80vh', overflowY: 'auto', fontSize: 11 }}
    >
      <div className="mb-2 pb-1 border-b border-gray-700">
        <div className="text-xs text-gray-300 leading-tight">{shortenTitle(title)}</div>
        <div className="text-[10px] text-gray-500 leading-tight mt-0.5 break-words">{title}</div>
        {snapshotTs != null && snapshotTs > 0 ? (
          <div className="text-[10px] text-gray-600 leading-tight mt-0.5">
            Snapshot {new Date(snapshotTs).toLocaleTimeString()}
          </div>
        ) : null}
      </div>

      {position ? (
        <div className="mb-2 pb-2 border-b border-gray-600">
          <div className="text-[10px] text-gray-500 mb-0.5">Position:</div>
          <div className="text-[11px]">
            <span className={isYes ? 'text-green-400' : 'text-red-400'}>
              {fmtSz(position.size)} {isYes ? 'YES' : 'NO'}
            </span>
            {position.avgPrice != null ? (
              <span className="text-gray-400"> @ {(position.avgPrice * 100).toFixed(1)}¢</span>
            ) : null}
          </div>
          {position.avgPrice != null ? (
            <div className="text-[10px] text-gray-400">Cost: ${(position.avgPrice * position.size).toFixed(2)}</div>
          ) : null}
        </div>
      ) : null}

      {tokenOrders.length > 0 ? (
        <div className="mb-2 pb-2 border-b border-gray-600">
          <div className="text-[10px] text-gray-500 mb-0.5">Orders:</div>
          {tokenOrders.map((o) => {
            const pr = (parseFloat(o.price) * 100).toFixed(1);
            const sz = Math.round(parseFloat(o.original_size || o.size));
            const val = (parseFloat(o.price) * parseFloat(o.original_size || o.size)).toFixed(2);
            const color = o.side === 'BUY' ? 'text-green-400' : 'text-red-400';
            return (
              <div key={o.id} className={`text-[11px] ${color}`}>
                {o.side} {isYes ? 'YES' : 'NO'} {sz} @ {pr}¢ (${val})
              </div>
            );
          })}
        </div>
      ) : null}

      {asset && strike ? (
        <div className="mb-2 pb-2 border-b border-gray-600">
          <BsFlower asset={asset} strike={strike} endDate={endDate} isYes={isYes} hitBarrierModel={obHitBarrierModel} hideTimeMachine />
        </div>
      ) : null}

      {loading ? <div className="text-xs text-gray-500">Loading orderbook...</div> : null}
      {error ? <div className="text-xs text-red-400">Failed to load orderbook</div> : null}

      {!loading && !error ? (
        <>
          <div className="grid gap-0.5 text-[10px] text-gray-500 mb-1" style={{ gridTemplateColumns: '50px 50px 50px 50px' }}>
            <span>Bid</span>
            <span className="text-right">Size</span>
            <span>Ask</span>
            <span className="text-right">Size</span>
          </div>
          {bids.length === 0 && asks.length === 0 ? (
            <div className="text-xs text-gray-500 text-center py-2">No orders in book</div>
          ) : (
            Array.from({ length: maxRows }, (_, i) => {
              const bid = bids[i];
              const ask = asks[i];
              const bidPrice = bid ? (parseFloat(bid.price) * 100).toFixed(1) : '';
              const askPrice = ask ? (parseFloat(ask.price) * 100).toFixed(1) : '';
              const bidHl = bidPrice && userBidPrices.has(bidPrice) ? 'bg-blue-900/50 font-bold' : '';
              const askHl = askPrice && userAskPrices.has(askPrice) ? 'bg-orange-900/50 font-bold' : '';
              return (
                <div
                  key={i}
                  className="grid gap-0.5"
                  style={{ gridTemplateColumns: '50px 50px 50px 50px', fontSize: 11, padding: '1px 0' }}
                >
                  {bid ? (
                    <>
                      <span className={`text-green-400 ${bidHl}`}>{bidPrice}¢</span>
                      <span className={`text-green-400 text-right ${bidHl}`}>{parseFloat(bid.size).toFixed(0)}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-600">-</span>
                      <span className="text-gray-600 text-right">-</span>
                    </>
                  )}
                  {ask ? (
                    <>
                      <span className={`text-red-400 ${askHl}`}>{askPrice}¢</span>
                      <span className={`text-red-400 text-right ${askHl}`}>{parseFloat(ask.size).toFixed(0)}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-600">-</span>
                      <span className="text-gray-600 text-right">-</span>
                    </>
                  )}
                </div>
              );
            })
          )}
        </>
      ) : null}
    </div>
  );
});
