/** Minimal orderbook level for depth walks (CLOB book / sidebar OB). */
export type ObWalkLevel = {
  price: string;
  size: string;
};

export type AskWalkResult = {
  avgPrice: number;
  avgCents: number;
  totalCostUsd: number;
  filledShares: number;
  complete: boolean;
};

export type BidWalkResult = {
  avgPrice: number;
  avgCents: number;
  totalProceedsUsd: number;
  filledShares: number;
  complete: boolean;
};

export function walkAsksForShares(asks: ObWalkLevel[], shares: number): AskWalkResult | null {
  if (!Number.isFinite(shares) || shares <= 0 || asks.length === 0) return null;

  let remaining = shares;
  let costUsd = 0;
  let filled = 0;

  for (const level of asks) {
    const px = parseFloat(String(level.price));
    const sz = parseFloat(String(level.size));
    if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(sz) || sz <= 0) continue;
    const take = Math.min(remaining, sz);
    costUsd += take * px;
    filled += take;
    remaining -= take;
    if (remaining <= 1e-9) break;
  }

  if (filled <= 0) return null;
  const avgPrice = costUsd / filled;
  return {
    avgPrice,
    avgCents: avgPrice * 100,
    totalCostUsd: costUsd,
    filledShares: filled,
    complete: remaining <= 1e-6,
  };
}

export function walkBidsForShares(bids: ObWalkLevel[], shares: number): BidWalkResult | null {
  if (!Number.isFinite(shares) || shares <= 0 || bids.length === 0) return null;

  let remaining = shares;
  let proceedsUsd = 0;
  let filled = 0;

  for (const level of bids) {
    const px = parseFloat(String(level.price));
    const sz = parseFloat(String(level.size));
    if (!Number.isFinite(px) || px <= 0 || !Number.isFinite(sz) || sz <= 0) continue;
    const take = Math.min(remaining, sz);
    proceedsUsd += take * px;
    filled += take;
    remaining -= take;
    if (remaining <= 1e-9) break;
  }

  if (filled <= 0) return null;
  const avgPrice = proceedsUsd / filled;
  return {
    avgPrice,
    avgCents: avgPrice * 100,
    totalProceedsUsd: proceedsUsd,
    filledShares: filled,
    complete: remaining <= 1e-6,
  };
}
