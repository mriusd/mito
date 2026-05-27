export type OBLevel = { price: string; size: string };

function obLevelUsd(level: OBLevel): number {
  const size = parseFloat(level.size);
  const price = parseFloat(level.price);
  if (!Number.isFinite(size) || !Number.isFinite(price)) return 0;
  return size * price;
}

export function obPriceCents(priceStr: string): number {
  const p = parseFloat(priceStr);
  return Number.isFinite(p) ? Math.round(p * 100) : NaN;
}

export function obPriceCentsInBand(priceStr: string): boolean {
  const pCents = obPriceCents(priceStr);
  return Number.isFinite(pCents) && pCents >= 5 && pCents <= 95;
}

/** USD for one raw level; prices clamped into 5–95¢ (96–99¢ → 95¢, 1–4¢ → 5¢). */
export function obLevelBandUsd(level: OBLevel): number {
  const pCents = obPriceCents(level.price);
  if (!Number.isFinite(pCents) || pCents <= 0 || pCents >= 100) return 0;
  const clampedCents = Math.min(95, Math.max(5, pCents));
  const size = parseFloat(level.size);
  if (!Number.isFinite(size)) return 0;
  return size * (clampedCents / 100);
}

/** Sum USD depth on one book side, 5–95¢ only. */
export function obBookSideUsdTotal(levels: OBLevel[]): number {
  return levels.reduce((s, l) => s + obLevelBandUsd(l), 0);
}

/** YES bids vs NO bids USD depth (5–95¢ each book). */
export function orderbookYesBidNoBidDepth(
  yesBids: OBLevel[],
  noBids: OBLevel[],
): { yesBidUsd: number; noBidUsd: number; imbalance: number } {
  const yesBidUsd = obBookSideUsdTotal(yesBids);
  const noBidUsd = obBookSideUsdTotal(noBids);
  const bookDenom = yesBidUsd + noBidUsd;
  return {
    yesBidUsd,
    noBidUsd,
    imbalance: bookDenom > 0 ? (yesBidUsd - noBidUsd) / bookDenom : 0,
  };
}

export function orderbookBookImbalance(bids: OBLevel[], asks: OBLevel[]): number {
  const bidTotal = obBookSideUsdTotal(bids);
  const askTotal = obBookSideUsdTotal(asks);
  const bookDenom = bidTotal + askTotal;
  return bookDenom > 0 ? (bidTotal - askTotal) / bookDenom : 0;
}
