export type ChartTradeMarker = {
  timeMs: number;
  priceCents: number;
  side: 'BUY' | 'SELL';
};

export type ChartOutcomeSide = 'YES' | 'NO';

function sameClobToken(a: string, b: string): boolean {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  try {
    return BigInt(sa) === BigInt(sb);
  } catch {
    return sa.toLowerCase() === sb.toLowerCase();
  }
}

function normalizeBuySell(raw: string): 'BUY' | 'SELL' | null {
  const u = raw.trim().toUpperCase();
  if (u === 'BUY') return 'BUY';
  if (u === 'SELL') return 'SELL';
  return null;
}

function blockTimeToMs(blockTime: number): number | null {
  if (!Number.isFinite(blockTime) || blockTime <= 0) return null;
  return blockTime > 1e12 ? blockTime : blockTime * 1000;
}

function normalizeOutcomeLeg(raw: string): 'YES' | 'NO' | null {
  const n = raw.trim().toUpperCase().replace(/\s+/g, '');
  if (n === 'YES' || n === 'UP') return 'YES';
  if (n === 'NO' || n === 'DOWN') return 'NO';
  return null;
}

function tradeLegFromToken(
  tokenId: string,
  yesTokenId: string,
  noTokenId: string,
): 'YES' | 'NO' | null {
  const tid = tokenId.trim();
  if (!tid) return null;
  const yesTok = yesTokenId.trim();
  const noTok = noTokenId.trim();
  const isNoLeg = noTok && sameClobToken(tid, noTok) && !sameClobToken(tid, yesTok);
  const isYesLeg = yesTok && sameClobToken(tid, yesTok) && !sameClobToken(tid, noTok);
  if (isYesLeg) return 'YES';
  if (isNoLeg) return 'NO';
  return null;
}

/** Long (blue): BUY YES / SELL NO. Short (yellow): BUY NO / SELL YES — same on UP and DOWN chart. */
function markerSideFromTrade(
  action: 'BUY' | 'SELL',
  tradeLeg: 'YES' | 'NO' | null,
): 'BUY' | 'SELL' {
  if (!tradeLeg) return action;
  const isLong =
    (tradeLeg === 'YES' && action === 'BUY') || (tradeLeg === 'NO' && action === 'SELL');
  return isLong ? 'BUY' : 'SELL';
}

function toChartViewMarker(
  action: 'BUY' | 'SELL',
  priceCents: number,
  tokenId: string,
  yesTokenId: string,
  noTokenId: string,
  chartOutcome: ChartOutcomeSide,
  outcomeHint?: string,
): ChartTradeMarker | null {
  if (!Number.isFinite(priceCents)) return null;
  let outPrice = priceCents;
  const yesTok = yesTokenId.trim();
  const noTok = noTokenId.trim();
  const tid = tokenId.trim();
  const isNoLeg = noTok && tid && sameClobToken(tid, noTok) && !sameClobToken(tid, yesTok);
  const isYesLeg = yesTok && tid && sameClobToken(tid, yesTok) && !sameClobToken(tid, noTok);
  if (chartOutcome === 'YES') {
    if (isNoLeg) outPrice = 100 - outPrice;
  } else if (isYesLeg) {
    outPrice = 100 - outPrice;
  }
  let tradeLeg = tradeLegFromToken(tokenId, yesTokenId, noTokenId);
  if (!tradeLeg && outcomeHint) tradeLeg = normalizeOutcomeLeg(outcomeHint);
  const side = markerSideFromTrade(action, tradeLeg);
  return { timeMs: 0, priceCents: outPrice, side };
}

export type LedgerFillChartRow = {
  blockTime?: number;
  price?: number | null;
  action?: string | null;
  side?: string | null;
  tokenId?: string | null;
};

/** Wallet fill ledger rows → chart buy/sell triangles for selected YES/NO view. */
export function buildChartTradeMarkersFromLedgerFills(
  fills: readonly LedgerFillChartRow[],
  opts: { yesTokenId: string; noTokenId: string; chartOutcome: ChartOutcomeSide },
): ChartTradeMarker[] {
  const { yesTokenId, noTokenId, chartOutcome } = opts;
  const out: ChartTradeMarker[] = [];
  for (const f of fills) {
    const action = normalizeBuySell(String(f.action ?? ''));
    if (!action) continue;
    const timeMs = blockTimeToMs(Number(f.blockTime ?? 0));
    if (timeMs == null) continue;
    const pr = f.price;
    if (pr == null || !Number.isFinite(pr)) continue;
    const view = toChartViewMarker(
      action,
      pr * 100,
      String(f.tokenId || ''),
      yesTokenId,
      noTokenId,
      chartOutcome,
      String(f.side ?? ''),
    );
    if (!view) continue;
    out.push({ ...view, timeMs });
  }
  return out;
}

export type MyTradeChartRow = {
  side?: string | null;
  price?: string | number | null;
  timestamp?: number | string | null;
  blockTime?: number | null;
  token_id?: string | null;
  asset_id?: string | null;
  tokenId?: string | null;
};

/** Sidebar My Trades rows → chart buy/sell triangles for selected YES/NO view. */
export function buildChartTradeMarkersFromMyTrades(
  trades: readonly MyTradeChartRow[],
  opts: { yesTokenId: string; noTokenId: string; chartOutcome: ChartOutcomeSide },
): ChartTradeMarker[] {
  const { yesTokenId, noTokenId, chartOutcome } = opts;
  const out: ChartTradeMarker[] = [];
  for (const t of trades) {
    const side = normalizeBuySell(String(t.side ?? ''));
    if (!side) continue;
    let timeMs: number | null = null;
    const bt = Number(t.blockTime ?? 0);
    if (bt > 0) timeMs = blockTimeToMs(bt);
    if (timeMs == null) {
      const ts = t.timestamp;
      if (ts == null || ts === '') continue;
      const num = typeof ts === 'number' ? ts : parseFloat(String(ts));
      if (!Number.isFinite(num) || num <= 0) continue;
      timeMs = num < 1e12 ? num * 1000 : num;
    }
    const rawPrice = typeof t.price === 'number' ? t.price : parseFloat(String(t.price ?? ''));
    if (!Number.isFinite(rawPrice)) continue;
    const tokenId = String(t.tokenId || t.token_id || t.asset_id || '').trim();
    const view = toChartViewMarker(
      side,
      rawPrice * 100,
      tokenId,
      yesTokenId,
      noTokenId,
      chartOutcome,
    );
    if (!view) continue;
    out.push({ ...view, timeMs });
  }
  return out;
}
