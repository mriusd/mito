import type { Market, Order, Position, Trade, Signal } from '../types';

/** Gamma/static row fields — excludes WS-only live book fields (those live in `marketLookup`). */
export function marketRowContentEqual(a: Market, b: Market): boolean {
  if (a === b) return true;
  if (
    a.id !== b.id ||
    a.conditionId !== b.conditionId ||
    a.question !== b.question ||
    a.eventTitle !== b.eventTitle ||
    a.eventSlug !== b.eventSlug ||
    a.groupItemTitle !== b.groupItemTitle ||
    a.endDate !== b.endDate ||
    Boolean(a.closed) !== Boolean(b.closed) ||
    String(a.outcomePrices ?? '') !== String(b.outcomePrices ?? '') ||
    a.lastTradePrice !== b.lastTradePrice ||
    a.priceToBeat !== b.priceToBeat
  ) {
    return false;
  }
  const ca = a.clobTokenIds || [];
  const cb = b.clobTokenIds || [];
  if (ca.length !== cb.length) return false;
  for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i]) return false;
  return true;
}

function listsSameMarketRefs(a: readonly Market[], b: readonly Market[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Reuse prior Market refs when Gamma/static content unchanged (poll JSON churn). */
export function stabilizeMarketArray(prev: Market[] | undefined, next: Market[]): Market[] {
  if (prev === next) return next;
  if (!prev?.length) return next;
  if (next.length === 0) return next;
  const prevById = new Map<string, Market>();
  for (const m of prev) prevById.set(m.id, m);
  const out = new Array<Market>(next.length);
  for (let i = 0; i < next.length; i++) {
    const n = next[i];
    const p = prevById.get(n.id);
    out[i] = p && marketRowContentEqual(p, n) ? p : n;
  }
  if (listsSameMarketRefs(prev, out)) return prev;
  if (prev.length === out.length) {
    let sameOrder = true;
    for (let i = 0; i < out.length; i++) {
      if (!marketRowContentEqual(prev[i], out[i])) {
        sameOrder = false;
        break;
      }
    }
    if (sameOrder) return prev;
  }
  return out;
}

function marketArraysEqualByRefOrContent(a: Market[] | undefined, b: Market[] | undefined): boolean {
  if (a === b) return true;
  if (!a?.length && !b?.length) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && !marketRowContentEqual(a[i], b[i])) return false;
  }
  return true;
}

function marketRecordLeafCount(m: Record<string, Market[]> | null | undefined): number {
  if (!m) return 0;
  let n = 0;
  for (const k of Object.keys(m)) n += (m[k] || []).length;
  return n;
}

export function coalesceRecordOfMarketArrays(
  prev: Record<string, Market[]>,
  next: Record<string, Market[]>,
): Record<string, Market[]> {
  // Empty Gamma wipe must not clear a healthy sidebar/list.
  if (marketRecordLeafCount(next) === 0 && marketRecordLeafCount(prev) > 0) return prev;
  if (recordOfMarketArraysEqual(next, prev)) return prev;
  const out: Record<string, Market[]> = {};
  let anyChange = false;
  for (const k of Object.keys(next)) {
    const stabilized = stabilizeMarketArray(prev[k], next[k] || []);
    out[k] = stabilized;
    if (stabilized !== prev[k]) anyChange = true;
  }
  if (!anyChange && recordOfMarketArraysEqual(out, prev)) return prev;
  return out;
}

export function recordOfMarketArraysEqual(a: Record<string, Market[]>, b: Record<string, Market[]>): boolean {
  if (a === b) return true;
  const ka = Object.keys(a).sort().join(',');
  const kb = Object.keys(b).sort().join(',');
  if (ka !== kb) return false;
  for (const k of Object.keys(a)) {
    if (!marketArraysEqualByRefOrContent(a[k], b[k])) return false;
  }
  return true;
}

function upOrDownLeafCount(m: Record<string, Record<string, Market[]>> | null | undefined): number {
  if (!m) return 0;
  let n = 0;
  for (const asset of Object.keys(m)) {
    const tfMap = m[asset] || {};
    for (const tf of Object.keys(tfMap)) n += (tfMap[tf] || []).length;
  }
  return n;
}

export function coalesceUpOrDownMarkets(
  prev: Record<string, Record<string, Market[]>>,
  next: Record<string, Record<string, Market[]>>,
): Record<string, Record<string, Market[]>> {
  if (upOrDownLeafCount(next) === 0 && upOrDownLeafCount(prev) > 0) return prev;
  if (upOrDownMarketsEqual(next, prev)) return prev;
  const out: Record<string, Record<string, Market[]>> = {};
  let changed = false;
  for (const asset of Object.keys(next)) {
    const prevAsset = prev[asset] || {};
    const nextAsset = next[asset] || {};
    let assetOut: Record<string, Market[]> | null = null;
    for (const tf of Object.keys(nextAsset)) {
      const stabilized = stabilizeMarketArray(prevAsset[tf], nextAsset[tf] || []);
      if (stabilized !== nextAsset[tf]) {
        if (!assetOut) assetOut = { ...nextAsset };
        assetOut[tf] = stabilized;
        changed = true;
      } else if (stabilized !== prevAsset[tf]) {
        if (!assetOut) assetOut = { ...nextAsset };
        assetOut[tf] = stabilized;
        changed = true;
      }
    }
    out[asset] = assetOut ?? nextAsset;
    if (assetOut) changed = true;
  }
  if (!changed && upOrDownMarketsEqual(out, prev)) return prev;
  return out;
}

export function upOrDownMarketsEqual(
  a: Record<string, Record<string, Market[]>>,
  b: Record<string, Record<string, Market[]>>,
): boolean {
  if (a === b) return true;
  const ak = Object.keys(a).sort().join(',');
  const bk = Object.keys(b).sort().join(',');
  if (ak !== bk) return false;
  for (const asset of Object.keys(a)) {
    const ia = a[asset];
    const ib = b[asset];
    const tik = Object.keys(ia).sort().join(',');
    const tikb = Object.keys(ib).sort().join(',');
    if (tik !== tikb) return false;
    for (const tf of Object.keys(ia)) {
      if (!marketArraysEqualByRefOrContent(ia[tf], ib[tf])) return false;
    }
  }
  return true;
}

function positionRowSig(p: Position): string {
  const id = String(p.asset || p.token_id || p.asset_id || '');
  return [
    id,
    p.size,
    p.avgPrice ?? '',
    p.currentValue ?? '',
    p.curPrice ?? '',
    p.redeemable ? '1' : '0',
    p.pnl ?? '',
  ].join('\x01');
}

export function positionsEqual(a: Position[], b: Position[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const sa = [...a].map(positionRowSig).sort().join('|');
  const sb = [...b].map(positionRowSig).sort().join('|');
  return sa === sb;
}

function orderRowSig(o: Order): string {
  return [
    o.id,
    o.asset_id,
    o.token_id ?? '',
    o.side,
    o.price,
    o.size,
    o.status ?? '',
    o.size_matched ?? '',
    o.original_size ?? '',
  ].join('\x01');
}

export function ordersEqual(a: Order[], b: Order[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const sa = [...a].map(orderRowSig).sort().join('|');
  const sb = [...b].map(orderRowSig).sort().join('|');
  return sa === sb;
}

function tradeRowSig(t: Trade): string {
  return [
    t.id,
    t.asset_id ?? t.asset ?? t.token_id ?? '',
    t.side,
    t.price,
    t.size,
    t.timestamp ?? '',
    t.created_at ?? '',
  ].join('\x01');
}

export function tradesEqual(a: Trade[], b: Trade[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const sa = [...a].map(tradeRowSig).sort().join('|');
  const sb = [...b].map(tradeRowSig).sort().join('|');
  return sa === sb;
}

export function jsonStableEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return a === b;
  }
}

export function signalsEqual(a: Signal[], b: Signal[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.market.id !== y.market.id ||
      x.type !== y.type ||
      x.origSide !== y.origSide ||
      x.tableType !== y.tableType ||
      x.diffPct !== y.diffPct ||
      x.bidDiffPct !== y.bidDiffPct ||
      x.price !== y.price ||
      x.bsPrice !== y.bsPrice
    ) {
      return false;
    }
  }
  return true;
}
