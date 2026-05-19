import { memo, useMemo, useSyncExternalStore } from 'react';
import type { SidebarPolymarketBookSnapshot } from './SidebarPolymarketOBHost';
import {
  getSidebarTopOfBookDigest,
  subscribeSidebarTopOfBookDigest,
} from '../lib/sidebarTopOfBookStore';

const MARKET_AGGRESSIVE_BUY = 0.99;
const MARKET_AGGRESSIVE_SELL = 0.01;

export const SidebarOrderCostDisplay = memo(function SidebarOrderCostDisplay({
  sidebarBookRef,
  orderKind,
  orderSide,
  orderPrice,
  orderAmount,
}: {
  sidebarBookRef: React.MutableRefObject<SidebarPolymarketBookSnapshot | null>;
  orderKind: 'limit' | 'market';
  orderSide: 'BUY' | 'SELL';
  orderPrice: string;
  orderAmount: string;
}) {
  const topOfBookDigest = useSyncExternalStore(
    subscribeSidebarTopOfBookDigest,
    getSidebarTopOfBookDigest,
    getSidebarTopOfBookDigest,
  );

  const summaryPriceDecimal = useMemo(() => {
    if (orderKind === 'market') {
      if (orderSide === 'BUY') {
        const displayAsks = sidebarBookRef.current?.displayAsks ?? [];
        return displayAsks.length > 0 ? parseFloat(displayAsks[0].price) : MARKET_AGGRESSIVE_BUY;
      }
      const displayBids = sidebarBookRef.current?.displayBids ?? [];
      const bestBid = displayBids.length > 0 ? displayBids[displayBids.length - 1] : null;
      return bestBid ? parseFloat(bestBid.price) : MARKET_AGGRESSIVE_SELL;
    }
    return (parseFloat(orderPrice) || 0) / 100;
  }, [orderKind, orderSide, orderPrice, topOfBookDigest, sidebarBookRef]);

  const cost = useMemo(() => {
    const a = parseFloat(orderAmount);
    if (!a) return 0;
    const p = summaryPriceDecimal;
    if (orderKind === 'limit' && (!orderPrice || !p)) return 0;
    if (orderSide === 'BUY') return p * a;
    return (1 - p) * a;
  }, [orderAmount, summaryPriceDecimal, orderSide, orderKind, orderPrice]);

  const payout = useMemo(() => {
    const a = parseFloat(orderAmount);
    if (!a) return 0;
    if (orderSide === 'SELL') {
      const p = summaryPriceDecimal;
      if (orderKind === 'limit' && (!orderPrice || !p)) return 0;
      return p * a;
    }
    return a;
  }, [orderAmount, orderSide, summaryPriceDecimal, orderKind, orderPrice]);

  return (
    <div className="bg-gray-700/50 rounded p-2 text-[10px] flex-1 flex flex-col text-gray-400">
      <div className="flex justify-between"><span>Cost:</span><span>Payout:</span></div>
      <div className="flex justify-between items-baseline mt-0.5">
        <span className="text-red-400 font-bold text-[13px]">{orderSide === 'SELL' ? '' : `$${cost.toFixed(2)}`}</span>
        <span className="text-green-400 font-bold text-[13px]">${payout.toFixed(2)}</span>
      </div>
    </div>
  );
});