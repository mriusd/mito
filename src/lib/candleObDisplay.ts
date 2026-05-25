import type { CandleObSnapshot } from './candleObSnapshot';
import { orderbookBookImbalance } from './orderbookBookImbalance';
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

export function prepareCandleObDisplay(ob: CandleObSnapshot, step: SidebarObAggStep) {
  const { bids: rawBids, asks: rawAsks } = candleObToRawLevels(ob);
  const imbalance = orderbookBookImbalance(rawBids, rawAsks);
  if (step === '0.1') {
    return { displayBids: rawBids, displayAsks: rawAsks, orderbookBookImbalance: imbalance };
  }
  const bucket = step === '1' ? '1' : '5';
  const cap = bucket === '1' ? 40 : 24;
  return {
    displayBids: sidebarObAggregateLevels(rawBids, bucket, 'bid', cap),
    displayAsks: sidebarObAggregateLevels(rawAsks, bucket, 'ask', cap),
    orderbookBookImbalance: imbalance,
  };
}
