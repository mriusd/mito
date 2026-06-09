import type { OnchainMarketListItem } from '../api';
import type { Market } from '../types';
import { resolvedBinaryOutcomeLabel, shortenUpDownMarketListCell } from '../utils/format';
import { marketListEndDateTimeLocale } from '../components/WalletLatestMarketsTradedTable';

const TF_DURATION_MS: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

export function tfDurationMs(timeframe: string): number {
  return TF_DURATION_MS[timeframe] ?? 0;
}

export type MarketSquareStatus = 'resolved_yes' | 'resolved_no' | 'current' | 'future' | 'expired_unresolved';

export const MARKET_SQUARE_CLS =
  'inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded border px-0.5 text-[8px] font-bold tabular-nums leading-none transition-colors';

export const STATUS_CLS: Record<MarketSquareStatus, string> = {
  resolved_yes: 'border-green-600/55 bg-green-900/45 text-green-100',
  resolved_no: 'border-red-600/55 bg-red-900/45 text-red-100',
  current: 'border-orange-500/70 bg-orange-900/40 text-orange-100',
  future: 'border-gray-600/80 bg-gray-800/40 text-gray-500',
  expired_unresolved: 'border-yellow-500/70 bg-yellow-900/40 text-yellow-100',
};

export function parseMarketEndMs(m: { endDate?: string | null }): number {
  const raw = (m.endDate || '').trim();
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}

function statusTipSuffix(status: MarketSquareStatus): string {
  switch (status) {
    case 'resolved_yes':
      return ' · resolved YES';
    case 'resolved_no':
      return ' · resolved NO';
    case 'current':
      return ' · current';
    case 'future':
      return ' · upcoming';
    case 'expired_unresolved':
      return ' · expired, unresolved';
    default:
      return ' · unresolved';
  }
}

export function marketSquareStatusFromOnchain(
  m: OnchainMarketListItem,
  timeframe: string,
  nowMs: number,
): MarketSquareStatus {
  const endMs = parseMarketEndMs(m);
  if (!endMs) return 'expired_unresolved';

  const duration = TF_DURATION_MS[timeframe] ?? 0;
  const startMs = duration > 0 ? endMs - duration : endMs;
  const outcome = (m.outcome || '').trim().toUpperCase();

  if (endMs > nowMs) {
    if (startMs <= nowMs) return 'current';
    return 'future';
  }

  if (outcome === 'YES' || outcome === 'UP') return 'resolved_yes';
  if (outcome === 'NO' || outcome === 'DOWN') return 'resolved_no';
  return 'expired_unresolved';
}

function isDecisiveSettledOutcomePrices(m: Market): boolean {
  const raw = m.outcomePrices as unknown;
  let yesPrice: number | null = null;
  let noPrice: number | null = null;
  if (Array.isArray(raw) && raw.length >= 2) {
    yesPrice = Number(raw[0]);
    noPrice = Number(raw[1]);
  } else if (typeof raw === 'string' && raw.trim()) {
    const cleaned = raw.replace(/^\[/, '').replace(/\]$/, '');
    const parts = cleaned.split(',').map((s) => Number(String(s).trim()));
    if (parts.length >= 2) {
      yesPrice = parts[0];
      noPrice = parts[1];
    }
  }
  if (
    yesPrice == null ||
    noPrice == null ||
    !Number.isFinite(yesPrice) ||
    !Number.isFinite(noPrice)
  ) {
    return false;
  }
  const hi = Math.max(yesPrice, noPrice);
  const lo = Math.min(yesPrice, noPrice);
  return hi >= 0.9 && lo <= 0.1;
}

export function marketSquareStatusFromMarket(
  m: Market,
  timeframe: string,
  nowMs: number,
): MarketSquareStatus {
  const endMs = parseMarketEndMs(m);
  if (!endMs) return 'expired_unresolved';

  const duration = TF_DURATION_MS[timeframe] ?? 0;
  const startMs = duration > 0 ? endMs - duration : endMs;

  if (endMs > nowMs) {
    if (startMs <= nowMs) return 'current';
    return 'future';
  }

  const resolved = resolvedBinaryOutcomeLabel(m, true);
  if (resolved === 'UP' || resolved === 'DOWN') {
    if (isDecisiveSettledOutcomePrices(m)) {
      return resolved === 'UP' ? 'resolved_yes' : 'resolved_no';
    }
  }
  return 'expired_unresolved';
}

/** Minute label for 5m/15m grid squares (`:05`, `:30`, …). */
export function formatMinuteSquareLabel(ms: number): string {
  return `:${String(new Date(ms).getMinutes()).padStart(2, '0')}`;
}

/** Hour:minute label for 1h/4h/24h squares. */
export function formatHourSquareLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function squareLabelForTimeframe(timeframe: string, endMs: number): string {
  if (timeframe === '5m' || timeframe === '15m') return formatMinuteSquareLabel(endMs);
  return formatHourSquareLabel(endMs);
}

export function marketSquareTooltip(
  m: Pick<Market, 'question' | 'eventSlug' | 'endDate'> & { conditionId?: string },
  status: MarketSquareStatus,
): string {
  const id = (m.conditionId || '').trim();
  const endRaw = (m.endDate || '').trim();
  const title = (m.question || '').trim();
  if (title) {
    return `${shortenUpDownMarketListCell(title, m.eventSlug || null, endRaw || null)} · ${marketListEndDateTimeLocale(endRaw || null).label}${statusTipSuffix(status)}`;
  }
  return `${id}${statusTipSuffix(status)}`;
}
