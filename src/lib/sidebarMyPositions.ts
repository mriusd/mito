import type { Market, Position, Trade } from '../types';
import { normalizeClobTokenId, outcomeTokenBelongsToSelectedMarket } from '../utils/format';
import type { WSPosition } from '../hooks/useOnchainTradesWS';

export const SIDEBAR_POSITION_DUST_SIZE = 0.01;

export function isSidebarDustPosition(size: number): boolean {
  return !Number.isFinite(size) || size < SIDEBAR_POSITION_DUST_SIZE;
}

export function mergeSidebarPositionsWsRest(
  restMarket: Position[],
  wsMarketRows: { tokenId: string; size: number; avgPrice: number }[],
): { asset: string; size: number; avgPrice: number }[] {
  const byTok = new Map<string, { asset: string; size: number; avgPrice: number }>();
  for (const p of restMarket) {
    const key = normalizeClobTokenId(p.asset);
    if (!key) continue;
    byTok.set(key, {
      asset: String(p.asset || '').trim() || key,
      size: p.size || 0,
      avgPrice: p.avgPrice || 0,
    });
  }
  for (const row of wsMarketRows) {
    const key = normalizeClobTokenId(row.tokenId);
    if (!key) continue;
    const prev = byTok.get(key);
    const avgPrice = row.avgPrice > 0 ? row.avgPrice : prev?.avgPrice ?? 0;
    byTok.set(key, {
      asset: row.tokenId.trim() || prev?.asset || key,
      size: row.size,
      avgPrice,
    });
  }
  return [...byTok.values()];
}

type BuyTradeRow = { tokenId: string; side: string; price: number; size: number };

function tradeRowTokenKey(t: BuyTradeRow): string {
  return normalizeClobTokenId(t.tokenId);
}

function restTradeTokenKey(t: Trade): string {
  return normalizeClobTokenId(t.asset || t.asset_id || t.token_id || '');
}

function avgPriceFromBuyTrades(tokenKey: string, trades: BuyTradeRow[]): number {
  if (!tokenKey || trades.length === 0) return 0;
  let totalCost = 0;
  let totalSize = 0;
  for (const t of trades) {
    if (tradeRowTokenKey(t) !== tokenKey || t.side !== 'BUY') continue;
    if (t.price > 0 && t.size > 0) {
      totalCost += t.price * t.size;
      totalSize += t.size;
    }
  }
  return totalSize > 0 ? totalCost / totalSize : 0;
}

function enrichAvgPriceFromBuyTrades(
  rows: { asset: string; size: number; avgPrice: number }[],
  trades: BuyTradeRow[],
): { asset: string; size: number; avgPrice: number }[] {
  if (trades.length === 0) return rows;
  return rows.map((p) => {
    if (p.avgPrice > 0) return p;
    const avgPrice = avgPriceFromBuyTrades(normalizeClobTokenId(p.asset), trades);
    if (avgPrice <= 0) return p;
    return { ...p, avgPrice };
  });
}

function enrichAvgPriceFromRestTrades(
  rows: { asset: string; size: number; avgPrice: number }[],
  trades: Trade[],
): { asset: string; size: number; avgPrice: number }[] {
  if (trades.length === 0) return rows;
  return rows.map((p) => {
    if (p.avgPrice > 0) return p;
    const tokenKey = normalizeClobTokenId(p.asset);
    if (!tokenKey) return p;
    let totalCost = 0;
    let totalSize = 0;
    for (const t of trades) {
      if (restTradeTokenKey(t) !== tokenKey || t.side !== 'BUY') continue;
      const price = parseFloat(t.price) || 0;
      const size = parseFloat(t.size) || 0;
      if (price > 0 && size > 0) {
        totalCost += price * size;
        totalSize += size;
      }
    }
    if (totalSize <= 0) return p;
    return { ...p, avgPrice: totalCost / totalSize };
  });
}

/** Match sidebar merge + avg enrichment for a single outcome token (pair legs, etc.). */
export function resolveLegPositionForToken(
  tokenId: string,
  positions: Position[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
  onchainTrades: BuyTradeRow[] = [],
  restTrades: Trade[] = [],
): { size: number; avgPrice: number } | null {
  const tidKey = normalizeClobTokenId(tokenId);
  if (!tidKey) return null;

  const rest = positions.find((p) => normalizeClobTokenId(p.asset) === tidKey);
  let size = 0;
  let avgPrice = 0;
  if (rest) {
    if ((rest.size || 0) > 0) size = rest.size || 0;
    if (rest.avgPrice != null && rest.avgPrice > 0) avgPrice = rest.avgPrice;
  }

  if (liveTradesSource === 'onchain') {
    const ws = onchainWsPositions.find((p) => normalizeClobTokenId(p.tokenId) === tidKey);
    if (ws && ws.size > 0) {
      size = ws.size;
      if (ws.avgPrice > 0) avgPrice = ws.avgPrice;
    }
  }

  if (isSidebarDustPosition(size)) return null;

  if (avgPrice <= 0) {
    let row = { asset: String(tokenId || '').trim() || tidKey, size, avgPrice: 0 };
    if (liveTradesSource === 'onchain' && onchainTrades.length > 0) {
      row = enrichAvgPriceFromBuyTrades([row], onchainTrades)[0] ?? row;
    }
    if (row.avgPrice <= 0 && restTrades.length > 0) {
      row = enrichAvgPriceFromRestTrades([row], restTrades)[0] ?? row;
    }
    avgPrice = row.avgPrice;
  }

  return { size, avgPrice };
}

export function computeSidebarMyPositions(
  liveTradesSource: string,
  positions: Position[],
  selectedMarket: Market | null,
  marketLookup: Record<string, Market>,
  onchainWsPositions: WSPosition[],
  onchainMarketTrades: { tokenId: string; side: string; price: number; size: number }[] = [],
): { asset: string; size: number; avgPrice: number }[] {
  if (!selectedMarket) return [];
  const wsMarketRows = (liveTradesSource === 'onchain' ? onchainWsPositions : [])
    .filter((p) => outcomeTokenBelongsToSelectedMarket(p.tokenId, selectedMarket, marketLookup))
    .map((p) => ({ tokenId: p.tokenId, size: p.size, avgPrice: p.avgPrice }));
  const restMarket = positions.filter((p) =>
    outcomeTokenBelongsToSelectedMarket(String(p.asset || '').trim(), selectedMarket, marketLookup),
  );
  const merged = mergeSidebarPositionsWsRest(restMarket, wsMarketRows);
  if (liveTradesSource !== 'onchain') return merged;
  return enrichAvgPriceFromBuyTrades(merged, onchainMarketTrades);
}

export type SidebarMergeEligible = {
  showButton: boolean;
  canOpenDialog: boolean;
  maxMerge: number;
  conditionId: string;
};

export function computeSidebarMergeEligible(
  selectedMarket: Market | null,
  myPositions: { asset: string; size: number; avgPrice: number }[],
  mergeFunderWallet: string,
): SidebarMergeEligible {
  if (!selectedMarket?.clobTokenIds || selectedMarket.clobTokenIds.length < 2) {
    return { showButton: false, canOpenDialog: false, maxMerge: 0, conditionId: '' };
  }
  const yesT = selectedMarket.clobTokenIds[0] || '';
  const noT = selectedMarket.clobTokenIds[1] || '';
  const yesP = myPositions.find((p) => (p.asset || '').trim() === yesT);
  const noP = myPositions.find((p) => (p.asset || '').trim() === noT);
  const yesSz = yesP?.size || 0;
  const noSz = noP?.size || 0;
  if (yesSz <= 0 || noSz <= 0) {
    return { showButton: false, canOpenDialog: false, maxMerge: 0, conditionId: '' };
  }
  let conditionId = (selectedMarket.conditionId || '').trim();
  if (!conditionId && yesP && typeof (yesP as { conditionId?: string }).conditionId === 'string') {
    conditionId = String((yesP as { conditionId?: string }).conditionId).trim();
  }
  const maxMerge = Math.min(yesSz, noSz);
  const canOpenDialog = Boolean(conditionId && mergeFunderWallet.trim());
  return { showButton: true, canOpenDialog, maxMerge, conditionId };
}
