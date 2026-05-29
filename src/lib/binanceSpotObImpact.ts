export type BinanceObLevel = { price: number; qty: number };

export type BinanceSpotBook = {
  bids: BinanceObLevel[];
  asks: BinanceObLevel[];
  updatedAt: number;
};

export const SPOT_OB_MOVE_PCT_LEVELS = [0.025, 0.05, 0.075, 1] as const;

export type SpotObMovePct = (typeof SPOT_OB_MOVE_PCT_LEVELS)[number];

export type SpotObImpact = { usd: number; depthCapped: boolean };

export function formatSpotObMovePctLabel(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  const s = pct >= 1 ? String(pct) : pct.toFixed(3).replace(/\.?0+$/, '');
  return `${s}%`;
}

export function formatSpotObImpactUsd(v: SpotObImpact | null): string {
  if (!v || !Number.isFinite(v.usd) || v.usd <= 0) return '—';
  const u = v.usd;
  let core: string;
  if (u >= 1_000_000) core = `$${(u / 1_000_000).toFixed(2)}M`;
  else if (u >= 10_000) core = `$${(u / 1000).toFixed(1)}k`;
  else if (u >= 1000) core = `$${(u / 1000).toFixed(2)}k`;
  else core = `$${Math.round(u).toLocaleString()}`;
  return v.depthCapped ? `${core}+` : core;
}

export function parseBinanceObLevels(raw: unknown): BinanceObLevel[] {
  if (!Array.isArray(raw)) return [];
  const out: BinanceObLevel[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 2) continue;
    const price = parseFloat(String(row[0]));
    const qty = parseFloat(String(row[1]));
    if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) continue;
    out.push({ price, qty });
  }
  return out;
}

export function normalizeBinanceSpotBook(bids: BinanceObLevel[], asks: BinanceObLevel[]): BinanceSpotBook | null {
  const normBids = [...bids].sort((a, b) => b.price - a.price);
  const normAsks = [...asks].sort((a, b) => a.price - b.price);
  if (normBids.length === 0 || normAsks.length === 0) return null;
  return { bids: normBids, asks: normAsks, updatedAt: Date.now() };
}

export function binanceSpotBookMid(book: BinanceSpotBook | null | undefined): number | null {
  if (!book?.bids.length || !book.asks.length) return null;
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  if (bestBid == null || bestAsk == null || !Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return null;
  return (bestBid + bestAsk) / 2;
}

/** USD notional to lift through asks until ask price reaches mid × (1 + movePct/100). */
export function usdToMoveBinanceSpotUp(book: BinanceSpotBook | null | undefined, movePct: number): SpotObImpact | null {
  if (!book?.bids.length || !book?.asks.length || !Number.isFinite(movePct) || movePct <= 0) return null;
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  if (bestBid == null || bestAsk == null || !Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return null;
  if (bestBid <= 0 || bestAsk <= 0) return null;

  const refMid = (bestBid + bestAsk) / 2;
  const targetPrice = refMid * (1 + movePct / 100);

  let cost = 0;
  let reached = false;
  for (const level of book.asks) {
    if (level.price >= targetPrice) {
      reached = true;
      break;
    }
    cost += level.price * level.qty;
  }
  if (cost <= 0) return null;
  return { usd: cost, depthCapped: !reached };
}

/** USD notional to hit bids until bid price reaches mid × (1 − movePct/100). */
export function usdToMoveBinanceSpotDown(book: BinanceSpotBook | null | undefined, movePct: number): SpotObImpact | null {
  if (!book?.bids.length || !book?.asks.length || !Number.isFinite(movePct) || movePct <= 0) return null;
  const bestBid = book.bids[0]?.price;
  const bestAsk = book.asks[0]?.price;
  if (bestBid == null || bestAsk == null || !Number.isFinite(bestBid) || !Number.isFinite(bestAsk)) return null;
  if (bestBid <= 0 || bestAsk <= 0) return null;

  const refMid = (bestBid + bestAsk) / 2;
  const targetPrice = refMid * (1 - movePct / 100);
  if (targetPrice <= 0) return null;

  let cost = 0;
  let reached = false;
  for (const level of book.bids) {
    if (level.price <= targetPrice) {
      reached = true;
      break;
    }
    cost += level.price * level.qty;
  }
  if (cost <= 0) return null;
  return { usd: cost, depthCapped: !reached };
}
