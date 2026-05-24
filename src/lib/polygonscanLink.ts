/** Normalize tx hash for Polygonscan URLs (0x + lowercase hex). */
export function normalizePolygonscanTxHash(raw?: string | null): string {
  let h = String(raw ?? '').trim().toLowerCase();
  if (!h) return '';
  if (!h.startsWith('0x')) h = `0x${h}`;
  return h;
}

/** pending live-trade row id: pending:{tx}:{token}:{side} */
export function txHashFromPendingLiveTradeId(id?: string | null): string {
  const s = String(id ?? '').trim();
  if (!s.startsWith('pending:')) return '';
  const rest = s.slice('pending:'.length);
  const i = rest.indexOf(':');
  if (i <= 0) return '';
  return rest.slice(0, i);
}

export function polygonscanTxUrl(txHash?: string | null, pendingId?: string | null): string | null {
  let h = normalizePolygonscanTxHash(txHash);
  if (!h) h = normalizePolygonscanTxHash(txHashFromPendingLiveTradeId(pendingId));
  if (!h || h === '0x' || h.length < 10) return null;
  return `https://polygonscan.com/tx/${h}`;
}

export function openPolygonscanTx(
  txHash?: string | null,
  pendingId?: string | null,
): boolean {
  const url = polygonscanTxUrl(txHash, pendingId);
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}
