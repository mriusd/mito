import type { Market, Order, Position, Trade } from '../types';

function marketRowSig(m: Market): string {
  return [
    m.id,
    m.bestBid ?? '',
    m.bestAsk ?? '',
    m.closed ? '1' : '0',
    m.endDate ?? '',
    m.volume ?? '',
    m.question ?? '',
  ].join('\x01');
}

function marketArraySig(arr: Market[] | undefined): string {
  if (!arr?.length) return '';
  return [...arr].map(marketRowSig).sort().join('\x02');
}

export function recordOfMarketArraysEqual(a: Record<string, Market[]>, b: Record<string, Market[]>): boolean {
  const ka = Object.keys(a).sort().join(',');
  const kb = Object.keys(b).sort().join(',');
  if (ka !== kb) return false;
  for (const k of Object.keys(a)) {
    if (marketArraySig(a[k]) !== marketArraySig(b[k])) return false;
  }
  return true;
}

export function upOrDownMarketsEqual(
  a: Record<string, Record<string, Market[]>>,
  b: Record<string, Record<string, Market[]>>,
): boolean {
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
      if (marketArraySig(ia[tf]) !== marketArraySig(ib[tf])) return false;
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
