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

/** USD for one raw level; 0 outside 5–95¢. */
export function obLevelBandUsd(level: OBLevel): number {
  if (!obPriceCentsInBand(level.price)) return 0;
  return obLevelUsd(level);
}

/** Sum USD depth on one book side, 5–95¢ only. */
export function obBookSideUsdTotal(levels: OBLevel[]): number {
  return levels.reduce((s, l) => s + obLevelBandUsd(l), 0);
}

/** YES book bid vs ask USD depth (5–95¢). */
export function orderbookYesBookDepth(
  yesBids: OBLevel[],
  yesAsks: OBLevel[],
): { yesBidUsd: number; yesAskUsd: number; imbalance: number } {
  const yesBidUsd = obBookSideUsdTotal(yesBids);
  const yesAskUsd = obBookSideUsdTotal(yesAsks);
  const bookDenom = yesBidUsd + yesAskUsd;
  return {
    yesBidUsd,
    yesAskUsd,
    imbalance: bookDenom > 0 ? (yesBidUsd - yesAskUsd) / bookDenom : 0,
  };
}

export function orderbookBookImbalance(bids: OBLevel[], asks: OBLevel[]): number {
  const bidTotal = obBookSideUsdTotal(bids);
  const askTotal = obBookSideUsdTotal(asks);
  const bookDenom = bidTotal + askTotal;
  return bookDenom > 0 ? (bidTotal - askTotal) / bookDenom : 0;
}
