import type { Market, Position } from '../types';
import { outcomeTokenBelongsToSelectedMarket } from '../utils/format';
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
    const asset = String(p.asset || '').trim();
    if (!asset) continue;
    byTok.set(asset, { asset, size: p.size || 0, avgPrice: p.avgPrice || 0 });
  }
  for (const row of wsMarketRows) {
    const asset = row.tokenId.trim();
    if (!asset) continue;
    const prev = byTok.get(asset);
    if (!prev || row.size > prev.size) {
      byTok.set(asset, { asset, size: row.size, avgPrice: row.avgPrice });
    }
  }
  return [...byTok.values()];
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
  if (liveTradesSource === 'onchain') {
    return wsMarketRows.map((p) => ({ asset: p.tokenId, size: p.size, avgPrice: p.avgPrice }));
  }
  const restMarket = positions.filter((p) =>
    outcomeTokenBelongsToSelectedMarket(String(p.asset || '').trim(), selectedMarket, marketLookup),
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
