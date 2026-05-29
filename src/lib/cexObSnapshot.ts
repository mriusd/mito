import { SPOT_OB_MOVE_PCT_LEVELS } from './binanceSpotObImpact';

export type CexObImpactCell = {
  pct: number;
  usd: number;
  capped: boolean;
};

export type CexObAssetPanel = {
  synced: boolean;
  mid?: number | null;
  up: CexObImpactCell[];
  down: CexObImpactCell[];
};

export type CexObExchangePanels = {
  binance?: CexObAssetPanel | null;
  okx?: CexObAssetPanel | null;
};

export type CexObCandleSnapshot = {
  asset: string;
  updatedAt: number;
  spot?: CexObExchangePanels | null;
  futures?: CexObExchangePanels | null;
};

function parseImpactCells(raw: unknown): CexObImpactCell[] {
  if (!Array.isArray(raw)) return [];
  const out: CexObImpactCell[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const pct = Number(o.pct);
    const usd = Number(o.usd);
    if (!Number.isFinite(pct) || !Number.isFinite(usd) || usd <= 0) continue;
    out.push({ pct, usd, capped: o.capped === true });
  }
  return out;
}

function parseAssetPanel(raw: unknown): CexObAssetPanel | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const up = parseImpactCells(o.up);
  const down = parseImpactCells(o.down);
  const midRaw = o.mid;
  const mid =
    midRaw != null && Number.isFinite(Number(midRaw)) ? Number(midRaw) : null;
  if (mid == null && up.length === 0 && down.length === 0) return null;
  return {
    synced: o.synced === true,
    mid,
    up,
    down,
  };
}

function parseExchangePanels(raw: unknown): CexObExchangePanels | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const binance = parseAssetPanel(o.binance);
  const okx = parseAssetPanel(o.okx);
  if (!binance && !okx) return null;
  return { binance, okx };
}

export function parseCexObSnapshot(raw: unknown): CexObCandleSnapshot | undefined {
  if (raw == null || raw === '') return undefined;
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  const asset = String(o.asset ?? '').trim().toUpperCase();
  if (!asset) return undefined;
  const spot = parseExchangePanels(o.spot);
  const futures = parseExchangePanels(o.futures);
  if (!spot && !futures) return undefined;
  return {
    asset,
    updatedAt: Number(o.updatedAt) || 0,
    spot,
    futures,
  };
}

export function cexObCellForPct(cells: CexObImpactCell[], pct: number): CexObImpactCell | null {
  return cells.find((c) => c.pct === pct) ?? null;
}

export { SPOT_OB_MOVE_PCT_LEVELS };
