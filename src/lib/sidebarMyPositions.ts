import type { Market, Position } from '../types';
import { normalizeClobTokenId, getPositionClobTokenId, outcomeTokenBelongsToSelectedMarket } from '../utils/format';
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
    const key = normalizeClobTokenId(getPositionClobTokenId(p));
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
    const avgPrice = prev?.avgPrice && prev.avgPrice > 0 ? prev.avgPrice : row.avgPrice > 0 ? row.avgPrice : 0;
    byTok.set(key, {
      asset: row.tokenId.trim() || prev?.asset || key,
      size: row.size,
      avgPrice,
    });
  }
  return [...byTok.values()];
}

/** Match sidebar merge for a single outcome token (pair legs, etc.). WS = live size; REST avg beats WS avg. */
export function resolveLegPositionForToken(
  tokenId: string,
  positions: Position[],
  liveTradesSource: string,
  onchainWsPositions: WSPosition[],
): { size: number; avgPrice: number } | null {
  const tidKey = normalizeClobTokenId(tokenId);
  if (!tidKey) return null;

  const rest = positions.find((p) => normalizeClobTokenId(getPositionClobTokenId(p)) === tidKey);
  let size = 0;
  let restAvg = 0;
  if (rest) {
    if ((rest.size || 0) > 0) size = rest.size || 0;
    if (rest.avgPrice != null && rest.avgPrice > 0) restAvg = rest.avgPrice;
  }

  let wsAvg = 0;
  if (liveTradesSource === 'onchain') {
    const ws = onchainWsPositions.find((p) => normalizeClobTokenId(p.tokenId) === tidKey);
    if (ws && ws.size > 0) {
      size = ws.size;
      if (ws.avgPrice > 0) wsAvg = ws.avgPrice;
    }
  }

  if (isSidebarDustPosition(size)) return null;

  const avgPrice = restAvg > 0 ? restAvg : wsAvg;
  return { size, avgPrice };
}

export function computeSidebarMyPositions(
  liveTradesSource: string,
  positions: Position[],
  selectedMarket: Market | null,
  marketLookup: Record<string, Market>,
  onchainWsPositions: WSPosition[],
): { asset: string; size: number; avgPrice: number }[] {
  if (!selectedMarket) return [];
  const wsMarketRows = (liveTradesSource === 'onchain' ? onchainWsPositions : [])
    .filter((p) => outcomeTokenBelongsToSelectedMarket(p.tokenId, selectedMarket, marketLookup))
    .map((p) => ({ tokenId: p.tokenId, size: p.size, avgPrice: p.avgPrice }));
  const restMarket = positions.filter((p) =>
    outcomeTokenBelongsToSelectedMarket(getPositionClobTokenId(p), selectedMarket, marketLookup),
  );
  return mergeSidebarPositionsWsRest(restMarket, wsMarketRows);
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
