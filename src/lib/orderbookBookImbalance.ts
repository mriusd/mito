type OBLevel = { price: string; size: string };

function obLevelUsd(level: OBLevel): number {
  const size = parseFloat(level.size);
  const price = parseFloat(level.price);
  if (!Number.isFinite(size) || !Number.isFinite(price)) return 0;
  return size * price;
}

export function orderbookBookImbalance(bids: OBLevel[], asks: OBLevel[]): number {
  const bidTotal = bids.reduce((s, l) => {
    const pCents = parseFloat(l.price) * 100;
    if (!Number.isFinite(pCents) || pCents < 5 || pCents > 95) return s;
    return s + obLevelUsd(l);
  }, 0);
  const askTotal = asks.reduce((s, l) => {
    const pCents = parseFloat(l.price) * 100;
    if (!Number.isFinite(pCents) || pCents < 5 || pCents > 95) return s;
    return s + obLevelUsd(l);
  }, 0);
  const bookDenom = bidTotal + askTotal;
  return bookDenom > 0 ? (bidTotal - askTotal) / bookDenom : 0;
}
