type OBLevel = { price: string; size: string };

export function orderbookBookImbalance(bids: OBLevel[], asks: OBLevel[]): number {
  const bidTotal = bids.reduce((s, l) => {
    const pCents = parseFloat(l.price) * 100;
    if (!Number.isFinite(pCents) || pCents < 5 || pCents > 95) return s;
    return s + parseFloat(l.size);
  }, 0);
  const askTotal = asks.reduce((s, l) => {
    const pCents = parseFloat(l.price) * 100;
    if (!Number.isFinite(pCents) || pCents < 5 || pCents > 95) return s;
    return s + parseFloat(l.size);
  }, 0);
  const bookDenom = bidTotal + askTotal;
  return bookDenom > 0 ? (bidTotal - askTotal) / bookDenom : 0;
}
