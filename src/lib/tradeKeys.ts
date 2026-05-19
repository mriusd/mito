/** Flat key — one alloc, no V8 (concatenated string) tree from chained template literals. */
export function onchainFillKey(txHash?: string, logIndex?: number): string {
  const h = (txHash || '').trim();
  if (!h) return '';
  if (logIndex == null || !Number.isFinite(logIndex)) return h;
  return `${h}:${logIndex}`;
}

export function polymarketTradeKey(timestamp: number, price: string, size: string): string {
  return `${timestamp}:${price}:${size}`;
}

export function walletTradeKey(
  txHash: string | undefined,
  logIndex: number | undefined,
  tokenId: string,
  side: string,
): string {
  return `${txHash || ''}:${logIndex ?? -1}:${tokenId}:${side}`;
}

export function toxicFlowFillKey(txHash?: string, logIndex?: number, tokenId?: string): string {
  const base = onchainFillKey(txHash, logIndex);
  const tok = (tokenId || '').trim();
  if (!base) return tok;
  if (!tok) return base;
  return `${base}:${tok}`;
}
