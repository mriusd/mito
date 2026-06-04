import { API_BASE, WS_BASE } from './env';

export const FUNDING_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
export type FundingAsset = (typeof FUNDING_ASSETS)[number];

export type FundingPoint = { t: number; r: number };

export type FundingAssetSnapshot = {
  asset: string;
  rate: number;
  points: FundingPoint[];
  updatedAt: number;
};

export type FundingPanelSnapshot = {
  interval: string;
  assets: Partial<Record<FundingAsset, FundingAssetSnapshot>>;
  updatedAt: number;
};

export function fmtFundingRate(r: number): string {
  if (!Number.isFinite(r)) return '—';
  const pct = r * 100;
  const sign = pct >= 0 ? '+' : '';
  if (Math.abs(pct) >= 0.01) return `${sign}${pct.toFixed(3)}%`;
  if (Math.abs(pct) >= 0.001) return `${sign}${pct.toFixed(4)}%`;
  return `${sign}${pct.toFixed(5)}%`;
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function parsePoint(raw: unknown): FundingPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const t = num(r.t);
  const rate = num(r.r);
  if (t == null || rate == null) return null;
  return { t, r: rate };
}

function parseAsset(raw: unknown): FundingAssetSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const asset = String(r.asset ?? '').trim().toUpperCase();
  if (!asset) return null;
  const points = Array.isArray(r.points)
    ? r.points.map(parsePoint).filter((x): x is FundingPoint => x != null)
    : [];
  return {
    asset,
    rate: num(r.rate) ?? (points.length ? points[points.length - 1].r : 0),
    points,
    updatedAt: num(r.updatedAt) ?? 0,
  };
}

export function parseFundingSnapshot(raw: unknown): FundingPanelSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const assets: Partial<Record<FundingAsset, FundingAssetSnapshot>> = {};
  const src = r.assets;
  if (src && typeof src === 'object') {
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      const sym = k.toUpperCase() as FundingAsset;
      if (!(FUNDING_ASSETS as readonly string[]).includes(sym)) continue;
      const parsed = parseAsset(v);
      if (parsed) assets[sym] = parsed;
    }
  }
  return {
    interval: String(r.interval ?? '1m'),
    assets,
    updatedAt: num(r.updatedAt) ?? Date.now(),
  };
}

export async function fetchFundingSnapshot(
  interval: string,
  startTime: number,
  endTime?: number,
): Promise<FundingPanelSnapshot | null> {
  const params = new URLSearchParams({ interval, startTime: String(startTime) });
  if (endTime != null) params.set('endTime', String(endTime));
  const res = await fetch(`${API_BASE}/api/binance-funding-rates?${params}`);
  if (!res.ok) return null;
  const json: unknown = await res.json();
  return parseFundingSnapshot(json);
}

export function fundingWsUrl(interval: string, window: string): string {
  const params = new URLSearchParams({ interval, window });
  return `${WS_BASE}/ws/binance-funding?${params}`;
}

export function fundingSubscribePayload(interval: string, window: string): string {
  return JSON.stringify({ type: 'subscribe', interval, window });
}
