export type BinanceObLevel = { price: number; qty: number };

export type BinanceSpotBook = {
  bids: BinanceObLevel[];
  asks: BinanceObLevel[];
  updatedAt: number;
};

export const SPOT_OB_MOVE_USD_LEVELS = [25, 50, 75, 100] as const;

export type SpotObMoveUsd = (typeof SPOT_OB_MOVE_USD_LEVELS)[number];

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

/** USD notional to lift asks until best ask is ≥ bestAsk + moveUsd. */
export function usdToMoveBinanceSpotUp(book: BinanceSpotBook | null | undefined, moveUsd: number): number | null {
  if (!book?.asks.length || !Number.isFinite(moveUsd) || moveUsd <= 0) return null;
  const bestAsk = book.asks[0]?.price;
  if (bestAsk == null || !Number.isFinite(bestAsk) || bestAsk <= 0) return null;
  const targetAsk = bestAsk + moveUsd;
  let cost = 0;
  for (const level of book.asks) {
    if (level.price >= targetAsk) break;
    cost += level.price * level.qty;
  }
  return cost > 0 ? cost : null;
}

/** USD notional to hit bids until best bid is ≤ bestBid − moveUsd. */
export function usdToMoveBinanceSpotDown(book: BinanceSpotBook | null | undefined, moveUsd: number): number | null {
  if (!book?.bids.length || !Number.isFinite(moveUsd) || moveUsd <= 0) return null;
  const bestBid = book.bids[0]?.price;
  if (bestBid == null || !Number.isFinite(bestBid) || bestBid <= 0) return null;
  const targetBid = bestBid - moveUsd;
  if (targetBid <= 0) return null;
  let cost = 0;
  for (const level of book.bids) {
    if (level.price <= targetBid) break;
    cost += level.price * level.qty;
  }
  return cost > 0 ? cost : null;
}
