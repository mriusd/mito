export type OBLevel = { price: string; size: string };

function obLevelUsd(level: OBLevel): number {
  const size = parseFloat(level.size);
  const price = parseFloat(level.price);
  if (!Number.isFinite(size) || !Number.isFinite(price)) return 0;
  return size * price;
}

/** Sum USD depth on one book side, 5–95¢ only. */
export function obBookSideUsdTotal(levels: OBLevel[]): number {
  return levels.reduce((s, l) => {
    const pCents = parseFloat(l.price) * 100;
    if (!Number.isFinite(pCents) || pCents < 5 || pCents > 95) return s;
    return s + obLevelUsd(l);
  }, 0);
}

/** Long = YES bids + NO asks; short = NO bids + YES asks (5–95¢). */
export function orderbookLongShortDepth(
  yesBids: OBLevel[],
  yesAsks: OBLevel[],
  noBids: OBLevel[],
  noAsks: OBLevel[],
): { longUsd: number; shortUsd: number; imbalance: number } {
  const longUsd = obBookSideUsdTotal(yesBids) + obBookSideUsdTotal(noAsks);
  const shortUsd = obBookSideUsdTotal(noBids) + obBookSideUsdTotal(yesAsks);
  const bookDenom = longUsd + shortUsd;
  return {
    longUsd,
    shortUsd,
    imbalance: bookDenom > 0 ? (longUsd - shortUsd) / bookDenom : 0,
  };
}

export function orderbookBookImbalance(bids: OBLevel[], asks: OBLevel[]): number {
  const bidTotal = obBookSideUsdTotal(bids);
  const askTotal = obBookSideUsdTotal(asks);
  const bookDenom = bidTotal + askTotal;
  return bookDenom > 0 ? (bidTotal - askTotal) / bookDenom : 0;
}
