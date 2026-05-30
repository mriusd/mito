import type { CandleObSnapshot } from './candleObSnapshot';
import { orderbookBookImbalance, obBookSideUsdTotal } from './orderbookBookImbalance';
import { sidebarObAggregateLevels, type SidebarObAggStep } from './sidebarOrderbookAggregate';

export type ObLevel = { price: string; size: string };

export function candleObToRawLevels(ob: CandleObSnapshot): { bids: ObLevel[]; asks: ObLevel[] } {
  const bids = ob.bids
    .map((l) => ({ price: l.p, size: l.s }))
    .sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
  const asks = ob.asks
    .map((l) => ({ price: l.p, size: l.s }))
    .sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
  return { bids, asks };
}

export function candleObBookImbalance(ob: CandleObSnapshot): number {
  const { bids, asks } = candleObToRawLevels(ob);
  return orderbookBookImbalance(bids, asks);
}

export function prepareCandleObDisplay(ob: CandleObSnapshot, step: SidebarObAggStep) {
  const { bids: rawBids, asks: rawAsks } = candleObToRawLevels(ob);
  const yesBidUsd = obBookSideUsdTotal(rawBids);
  const noBidUsd = 0;
  const imbalance = candleObBookImbalance(ob);
  const cap = step === '0.1' ? 50 : step === '1' ? 40 : 24;
  const displayBids = sidebarObAggregateLevels(rawBids, step, 'bid', cap);
  const displayAsks = sidebarObAggregateLevels(rawAsks, step, 'ask', cap);
  return {
    displayBids,
    displayAsks,
    yesBidUsd,
    noBidUsd,
    displayBidFullUsd: yesBidUsd,
    displayAskFullUsd: obBookSideUsdTotal(rawAsks),
    orderbookBookImbalance: imbalance,
  };
}
