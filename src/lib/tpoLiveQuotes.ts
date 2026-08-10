import type { Market } from '../types';
import { getBidAskMarketRow } from './bidAskMarketLookup';
import { outcomeBidAskProb } from './outcomeQuote';

/** Minimal live lookup for one token (+ sibling legs) from pending/store. */
export function liveBidAskLookupForToken(tokenId: string | undefined): Record<string, Market> {
  const tid = String(tokenId || '').trim();
  if (!tid) return {};
  const out: Record<string, Market> = {};
  const put = (id: string) => {
    const row = getBidAskMarketRow(id);
    if (!row) return;
    out[id] = row;
    try {
      const norm = BigInt(id).toString();
      if (norm !== id) out[norm] = row;
    } catch {
      /* not an int token */
    }
    for (const leg of row.clobTokenIds || []) {
      if (!leg || out[leg]) continue;
      const legRow = getBidAskMarketRow(leg);
      if (!legRow) continue;
      out[leg] = legRow;
      try {
        const n = BigInt(leg).toString();
        if (n !== leg) out[n] = legRow;
      } catch {
        /* ignore */
      }
    }
  };
  put(tid);
  return out;
}

export type TpoLiveQuote = {
  bidProb: number | null;
  askProb: number | null;
  midCents: number | null;
  currentPrice: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  askCents: number | null;
};

/** Resolve Bid/Mid/Ask/Val/PnL from live book at paint time (not baked memo). */
export function resolveTpoRowLiveQuote(
  tid: string,
  size: number,
  cost: number,
  /** Pre-baked bucket sums — when set, skip per-token live (parent already aggregated). */
  bucket?: {
    bidProb: number | null;
    askProb: number | null;
    midCents: number | null;
    askCents: number | null;
    currentPrice: number;
    currentValue: number;
    pnl: number;
    pnlPercent: number;
  } | null,
): TpoLiveQuote {
  if (bucket) {
    return {
      bidProb: bucket.bidProb,
      askProb: bucket.askProb,
      midCents: bucket.midCents,
      currentPrice: bucket.currentPrice,
      currentValue: bucket.currentValue,
      pnl: bucket.pnl,
      pnlPercent: bucket.pnlPercent,
      askCents: bucket.askCents,
    };
  }
  const { bid: bidProb, ask: askProb } = outcomeBidAskProb(tid, liveBidAskLookupForToken(tid));
  const hasBid = bidProb != null && bidProb > 0;
  const hasAsk = askProb != null && askProb > 0;
  let midCents: number | null = null;
  if (hasBid && hasAsk) midCents = ((bidProb! + askProb!) / 2) * 100;
  else if (hasBid) midCents = bidProb! * 100;
  else if (hasAsk) midCents = askProb! * 100;
  const mid =
    hasBid && hasAsk ? (bidProb! + askProb!) / 2 : hasBid ? bidProb! : 0;
  const currentPrice = hasBid ? bidProb! * 100 : 0;
  const currentValue = mid * size;
  const pnl = currentValue - cost;
  const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0;
  return {
    bidProb: hasBid ? bidProb : null,
    askProb: hasAsk ? askProb : null,
    midCents,
    currentPrice,
    currentValue,
    pnl,
    pnlPercent,
    askCents: hasAsk ? askProb! * 100 : null,
  };
}

/** Live-aggregate bucket parent quotes from children (each child read live). */
export function resolveTpoBucketLiveQuote(
  children: { tid: string; size: number; cost: number; currentValue?: number }[],
): TpoLiveQuote {
  let size = 0;
  let cost = 0;
  let currentValue = 0;
  let bidSumCents = 0;
  let askSumCents = 0;
  let midSumCents = 0;
  let bidN = 0;
  let askN = 0;
  let midN = 0;
  for (const c of children) {
    size += Number.isFinite(c.size) ? c.size : 0;
    cost += Number.isFinite(c.cost) ? c.cost : 0;
    const q = resolveTpoRowLiveQuote(c.tid, c.size, c.cost);
    currentValue += q.currentValue;
    if (q.bidProb != null && q.bidProb > 0) {
      bidSumCents += q.currentPrice;
      bidN += 1;
    }
    if (q.askCents != null && q.askCents > 0) {
      askSumCents += q.askCents;
      askN += 1;
    }
    if (q.midCents != null && q.midCents > 0) {
      midSumCents += q.midCents;
      midN += 1;
    }
  }
  const pnl = currentValue - cost;
  const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0;
  return {
    bidProb: bidN > 0 ? bidSumCents / 100 : null,
    askProb: askN > 0 ? askSumCents / 100 : null,
    midCents: midN > 0 ? midSumCents : null,
    currentPrice: bidN > 0 ? bidSumCents : 0,
    currentValue,
    pnl,
    pnlPercent,
    askCents: askN > 0 ? askSumCents : null,
  };
}
