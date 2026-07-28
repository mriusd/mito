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

/** SPLIT/MERGE: one row per tx+token+action (NR+CTF double logs; size float ignored). */
export function walletTradeLedgerLegEconKey(
  txHash: string | undefined,
  tokenId: string,
  side: string,
  _size?: number,
): string {
  const act = String(side || '').toUpperCase();
  if (act !== 'SPLIT' && act !== 'MERGE') return '';
  const tx = String(txHash || '').trim().toLowerCase();
  let tok = String(tokenId || '').trim();
  if (!tok || !tx) return '';
  try {
    tok = BigInt(tok).toString();
  } catch {
    /* keep */
  }
  return `${tx}:${tok}:${act}`;
}

export function dedupeWalletTradesByLedgerLeg<T extends {
  txHash?: string;
  logIndex?: number;
  tokenId: string;
  side: string;
  size: number;
  blockTime?: number;
  id?: string;
}>(rows: T[], keyFn: (t: T) => string): T[] {
  const best = new Map<string, T>();
  for (const t of rows) {
    const leg = walletTradeLedgerLegEconKey(t.txHash, t.tokenId, t.side, t.size);
    const k = leg || keyFn(t);
    const prev = best.get(k);
    if (!prev) {
      best.set(k, t);
      continue;
    }
    const li = t.logIndex ?? Number.MAX_SAFE_INTEGER;
    const pli = prev.logIndex ?? Number.MAX_SAFE_INTEGER;
    if (li < pli) best.set(k, t);
  }
  return Array.from(best.values()).sort((a, b) => {
    const tb = (b.blockTime ?? 0) - (a.blockTime ?? 0);
    if (tb !== 0) return tb;
    return (b.logIndex ?? 0) - (a.logIndex ?? 0);
  });
}

export function toxicFlowFillKey(txHash?: string, logIndex?: number, tokenId?: string): string {
  const base = onchainFillKey(txHash, logIndex);
  const tok = (tokenId || '').trim();
  if (!base) return tok;
  if (!tok) return base;
  return `${base}:${tok}`;
}
