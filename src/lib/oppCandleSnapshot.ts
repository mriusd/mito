/** Candle opp$ — full CLOB ask sweep redeem edge (mitobot opp$). */

import { obAskSweepRedeemProfit } from './orderbookBookImbalance';
import type { CandleObSnapshot } from './candleObSnapshot';

export type OppSweepLeg = {
  shares: number;
  cost: number;
  profit: number;
};

export type OppCandleSnapshot = {
  yes?: OppSweepLeg;
  no?: OppSweepLeg;
  /** Spot % move so predicted TWAP = strike (mitobot flip%). */
  flipPct?: number;
  /** spot* − spot ($). */
  flipUsd?: number;
  /** spot* that pushes pred TWAP to K. */
  flipPrice?: number;
  /** Binance bid/Down wall USD at |flipPct|. */
  wallYes?: number;
  /** Binance ask/Up wall USD at |flipPct|. */
  wallNo?: number;
  updatedAt?: number;
};

function parseLeg(raw: unknown): OppSweepLeg | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const shares = typeof r.shares === 'number' && Number.isFinite(r.shares) ? r.shares : NaN;
  const cost = typeof r.cost === 'number' && Number.isFinite(r.cost) ? r.cost : NaN;
  const profit = typeof r.profit === 'number' && Number.isFinite(r.profit) ? r.profit : NaN;
  // Allow shares=0 / profit=0 (empty ask book) — still a real leg for hover YES+NO.
  if (Number.isNaN(shares) || shares < 0 || Number.isNaN(cost) || Number.isNaN(profit)) return undefined;
  return { shares, cost, profit };
}

/** Build a leg from raw ask levels (full book preferred). */
export function oppSweepLegFromAskLevels(
  levels: Array<{ price: string; size: string }> | null | undefined,
): OppSweepLeg | undefined {
  if (!levels?.length) return undefined;
  const profit = obAskSweepRedeemProfit(levels);
  if (profit == null || !Number.isFinite(profit)) return undefined;
  let shares = 0;
  let cost = 0;
  for (const lvl of levels) {
    const px = parseFloat(lvl.price);
    const sz = parseFloat(lvl.size);
    if (!(px > 0) || !(sz > 0) || !Number.isFinite(px) || !Number.isFinite(sz)) continue;
    shares += sz;
    cost += px * sz;
  }
  if (!(shares > 0)) return undefined;
  return { shares, cost, profit: shares - cost };
}

/** One-sided fallback from a candle poly OB snapshot (charted token only). */
export function oppSweepLegFromCandleOb(ob: CandleObSnapshot | null | undefined): OppSweepLeg | undefined {
  if (!ob?.asks?.length) return undefined;
  return oppSweepLegFromAskLevels(ob.asks.map((l) => ({ price: l.p, size: l.s })));
}

/** Live sidebar books → candle-shaped opp$ (YES + NO). */
export function oppCandleSnapshotFromLive(
  yesOppUsd: number | null | undefined,
  noOppUsd: number | null | undefined,
): OppCandleSnapshot | undefined {
  const leg = (profit: number | null | undefined): OppSweepLeg | undefined => {
    if (profit == null || !Number.isFinite(profit)) return undefined;
    // shares/cost unknown from live strip — profit is what hover displays.
    return { shares: 0, cost: 0, profit };
  };
  const yes = leg(yesOppUsd);
  const no = leg(noOppUsd);
  if (!yes && !no) return undefined;
  // Prefer both legs when either side is known; missing side → explicit $0 so hover isn't one-sided.
  return {
    yes: yes ?? { shares: 0, cost: 0, profit: 0 },
    no: no ?? { shares: 0, cost: 0, profit: 0 },
    updatedAt: Date.now(),
  };
}

export function parseOppCandleSnapshot(raw: unknown): OppCandleSnapshot | undefined {
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
  const r = obj as Record<string, unknown>;
  // Accept profit-only legs (live sidebar fallback) and full polycandles legs.
  const yes = parseLeg(r.yes) ?? parseProfitOnlyLeg(r.yes);
  const no = parseLeg(r.no) ?? parseProfitOnlyLeg(r.no);
  const flipPct = parseOptFinite(r.flipPct);
  const flipUsd = parseOptFinite(r.flipUsd);
  const flipPrice = parseOptFinite(r.flipPrice);
  const wallYes = parseOptFinite(r.wallYes);
  const wallNo = parseOptFinite(r.wallNo);
  const hasFlip =
    flipPct != null || flipUsd != null || flipPrice != null || wallYes != null || wallNo != null;
  if (!yes && !no && !hasFlip) return undefined;
  const updatedAt =
    typeof r.updatedAt === 'number' && Number.isFinite(r.updatedAt) ? r.updatedAt : undefined;
  return {
    yes,
    no,
    ...(flipPct != null ? { flipPct } : {}),
    ...(flipUsd != null ? { flipUsd } : {}),
    ...(flipPrice != null ? { flipPrice } : {}),
    ...(wallYes != null ? { wallYes } : {}),
    ...(wallNo != null ? { wallNo } : {}),
    updatedAt,
  };
}

function parseOptFinite(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return raw;
}

function parseProfitOnlyLeg(raw: unknown): OppSweepLeg | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const profit = typeof r.profit === 'number' && Number.isFinite(r.profit) ? r.profit : NaN;
  if (Number.isNaN(profit)) return undefined;
  const shares = typeof r.shares === 'number' && Number.isFinite(r.shares) ? r.shares : 0;
  const cost = typeof r.cost === 'number' && Number.isFinite(r.cost) ? r.cost : 0;
  return { shares, cost, profit };
}

/** Empty-book pad from polycandles/FE — not a real sweep (shares=cost=profit=0). */
export function isOppLegEmptyStub(leg: OppSweepLeg | undefined | null): boolean {
  if (!leg) return true;
  return leg.shares === 0 && leg.cost === 0 && leg.profit === 0;
}

function preferOppLeg(
  primary: OppSweepLeg | undefined,
  fallback: OppSweepLeg | undefined,
): OppSweepLeg | undefined {
  if (!isOppLegEmptyStub(primary)) return primary;
  if (!isOppLegEmptyStub(fallback)) return fallback;
  return primary ?? fallback;
}

export function mergeOppCandleSnapshot(
  next: OppCandleSnapshot | undefined,
  prev: OppCandleSnapshot | undefined,
): OppCandleSnapshot | undefined {
  if (!next && !prev) return undefined;
  return {
    // Real sweeps (incl. tiny profit with shares>0) beat empty stubs so hover
    // doesn't stick at $0 when the ask book is clearly mid-market.
    yes: preferOppLeg(next?.yes, prev?.yes),
    no: preferOppLeg(next?.no, prev?.no),
    flipPct: next?.flipPct ?? prev?.flipPct,
    flipUsd: next?.flipUsd ?? prev?.flipUsd,
    flipPrice: next?.flipPrice ?? prev?.flipPrice,
    wallYes: next?.wallYes ?? prev?.wallYes,
    wallNo: next?.wallNo ?? prev?.wallNo,
    updatedAt: next?.updatedAt ?? prev?.updatedAt,
  };
}

export function fmtOppProfitUsd(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  // Near-$1 asks (e.g. 99.9¢) yield sub-dollar edges — don't round to $0.
  if (abs >= 100) return `${sign}$${abs.toFixed(0)}`;
  if (abs >= 10) return `${sign}$${abs.toFixed(1)}`;
  if (abs > 0) return `${sign}$${abs.toFixed(2)}`;
  return '$0';
}

/** Tooltip detail for a sweep leg. */
export function fmtOppLegTitle(leg: OppSweepLeg | undefined, side: 'YES' | 'NO'): string {
  if (!leg) return `${side} ask book empty / unavailable`;
  return (
    `${side} ask sweep: profit $${leg.profit.toFixed(2)}` +
    ` (shares ${leg.shares.toFixed(2)} − cost $${leg.cost.toFixed(2)})`
  );
}

/** Compact signed % for candle flip (mitobot Markets flip%). */
export function fmtFlipPct(pct: number | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return '—';
  const a = Math.abs(pct);
  if (a >= 1) return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
  if (a >= 0.1) return `${pct >= 0 ? '+' : ''}${pct.toFixed(3)}%`;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(4)}%`;
}

/** Compact signed $ for candle flip (spot* − spot). */
export function fmtFlipUsd(usd: number | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return '—';
  const sign = usd < 0 ? '-' : '+';
  const abs = Math.abs(usd);
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  if (abs >= 100) return `${sign}$${abs.toFixed(0)}`;
  if (abs >= 10) return `${sign}$${abs.toFixed(1)}`;
  return `${sign}$${abs.toFixed(2)}`;
}

/** Absolute flip price (spot*). */
export function fmtFlipPrice(price: number | undefined, priceDec = 2): string {
  if (price == null || !Number.isFinite(price) || !(price > 0)) return '—';
  return `$${price.toLocaleString(undefined, {
    minimumFractionDigits: priceDec,
    maximumFractionDigits: priceDec,
  })}`;
}

/** Binance OB wall USD at |flip%| (mitobot wall formatting). */
export function fmtObWallUsd(usd: number | undefined): string {
  if (usd == null || !Number.isFinite(usd) || usd < 0) return '—';
  if (usd >= 1e9) return `$${(usd / 1e9).toFixed(2)}B`;
  if (usd >= 1e6) {
    const m = usd / 1e6;
    return Number.isInteger(m) || Math.abs(m - Math.round(m)) < 1e-9
      ? `$${Math.round(m)}M`
      : `$${m.toFixed(1)}M`;
  }
  if (usd >= 1e3) return `$${Math.round(usd / 1e3)}k`;
  return `$${Math.round(usd)}`;
}
