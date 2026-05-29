export type BinanceObLevel = { price: number; qty: number };

export type BinanceSpotBook = {
  bids: BinanceObLevel[];
  asks: BinanceObLevel[];
  updatedAt: number;
};

export const SPOT_OB_MOVE_PCT_LEVELS = [0.025, 0.05, 0.075, 1] as const;

export type SpotObMovePct = (typeof SPOT_OB_MOVE_PCT_LEVELS)[number];

export function formatSpotObMovePctLabel(pct: number): string {
  if (!Number.isFinite(pct)) return '—';
  const s = pct >= 1 ? String(pct) : pct.toFixed(3).replace(/\.?0+$/, '');
  return `${s}%`;
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

/** USD notional to lift asks until best ask is ≥ bestAsk × (1 + movePct/100). */
export function usdToMoveBinanceSpotUp(book: BinanceSpotBook | null | undefined, movePct: number): number | null {
  if (!book?.asks.length || !Number.isFinite(movePct) || movePct <= 0) return null;
  const bestAsk = book.asks[0]?.price;
  if (bestAsk == null || !Number.isFinite(bestAsk) || bestAsk <= 0) return null;
  const targetAsk = bestAsk * (1 + movePct / 100);
  let cost = 0;
  for (const level of book.asks) {
    if (level.price >= targetAsk) break;
    cost += level.price * level.qty;
  }
  return cost > 0 ? cost : null;
}

/** USD notional to hit bids until best bid is ≤ bestBid × (1 − movePct/100). */
export function usdToMoveBinanceSpotDown(book: BinanceSpotBook | null | undefined, movePct: number): number | null {
  if (!book?.bids.length || !Number.isFinite(movePct) || movePct <= 0) return null;
  const bestBid = book.bids[0]?.price;
  if (bestBid == null || !Number.isFinite(bestBid) || bestBid <= 0) return null;
  const targetBid = bestBid * (1 - movePct / 100);
  if (targetBid <= 0) return null;
  let cost = 0;
  for (const level of book.bids) {
    if (level.price <= targetBid) break;
    cost += level.price * level.qty;
  }
  return cost > 0 ? cost : null;
}
