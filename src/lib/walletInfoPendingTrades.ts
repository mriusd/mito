import type { LiveTrade } from '../hooks/usePolymarketOB';
import type { WSTrade } from '../hooks/useOnchainTradesWS';
import type { Market } from '../types';
import { normalizeClobTokenId } from '../utils/format';

function sameClobToken(a: string, b: string): boolean {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  try {
    return BigInt(sa) === BigInt(sb);
  } catch {
    return false;
  }
}

export function filterTapePendingForWalletMarket(
  tape: LiveTrade[],
  wallet: string,
  market: Market | undefined,
): LiveTrade[] {
  const wk = wallet.trim().toLowerCase();
  if (!wk) return [];
  const tokenIds = (market?.clobTokenIds || []).map((id) => String(id || '').trim()).filter(Boolean);
  return tape.filter((t) => {
    if (!t.pending) return false;
    if (t.isTaker === false) return false;
    const lw = (t.wallet || t.taker || '').toLowerCase();
    const mw = (t.maker || '').toLowerCase();
    if (lw !== wk && mw !== wk) return false;
    const tok = String(t.tokenId || '').trim();
    if (!tok) return tokenIds.length === 0;
    if (tokenIds.length === 0) return true;
    return tokenIds.some((id) => sameClobToken(tok, id));
  });
}

export function liveTradePendingToWSTrade(t: LiveTrade, wallet: string): WSTrade | null {
  if (!t.pending) return null;
  const wk = wallet.trim().toLowerCase();
  const tokenId = String(t.tokenId || '').trim();
  const tx = String(t.txHash || '').trim();
  if (!tokenId || !tx) return null;
  const side = t.side === 'SELL' ? ('SELL' as const) : ('BUY' as const);
  const ts = Number(t.timestamp ?? Date.now());
  const blockTime = ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts);
  const tokKey = normalizeClobTokenId(tokenId);
  return {
    id: t.id || `pending:${tx.toLowerCase()}:${tokKey}:${side}`,
    pending: true,
    priceApproximate: t.priceApproximate === true,
    tokenId,
    side,
    size: parseFloat(t.size) || 0,
    price: parseFloat(t.price) || 0,
    fee: 0,
    blockTime,
    txHash: tx,
    isTaker: t.isTaker === true,
  };
}

function walletInfoPendingSupersedeKey(t: WSTrade): string {
  const tx = (t.txHash || '').toLowerCase();
  const tok = normalizeClobTokenId(String(t.tokenId || ''));
  return `${tx}:${tok}:${t.side}`;
}

/** Sidebar live tape pending (reliable) + scope store + wallet-market WS pending, deduped vs confirmed. */
export function mergeWalletInfoPendingTrades(
  wsRows: WSTrade[],
  tape: LiveTrade[],
  scopePending: WSTrade[],
  wallet: string,
  market: Market | undefined,
): WSTrade[] {
  const confirmed = wsRows.filter((r) => !r.pending);
  const confirmedKeys = new Set(confirmed.map((r) => walletInfoPendingSupersedeKey(r)));
  const pendingByKey = new Map<string, WSTrade>();

  const addPending = (p: WSTrade) => {
    const tx = (p.txHash || '').toLowerCase();
    if (!tx) return;
    const key = walletInfoPendingSupersedeKey(p);
    if (confirmedKeys.has(key)) return;
    const existing = pendingByKey.get(key);
    if (existing && existing.priceApproximate !== true && p.priceApproximate === true) return;
    if (existing && existing.isTaker !== true && p.isTaker === true) return;
    pendingByKey.set(key, p);
  };

  for (const r of wsRows) {
    if (r.pending) addPending(r);
  }
  for (const t of filterTapePendingForWalletMarket(tape, wallet, market)) {
    const row = liveTradePendingToWSTrade(t, wallet);
    if (row) addPending(row);
  }
  for (const r of scopePending) addPending(r);

  const pending = [...pendingByKey.values()];
  const all = [...pending, ...confirmed];
  all.sort((a, b) => {
    const ap = a.pending ? 1 : 0;
    const bp = b.pending ? 1 : 0;
    if (ap !== bp) return bp - ap;
    const tb = (b.blockTime ?? 0) - (a.blockTime ?? 0);
    if (tb !== 0) return tb;
    return (b.logIndex ?? 0) - (a.logIndex ?? 0);
  });
  return all;
}
