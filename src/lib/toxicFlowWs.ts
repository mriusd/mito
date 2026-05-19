import type { ToxicFlowData, WalletPosition } from '../api';
import { coalesceToxicFlowPayload, clearToxicFlowTabWalletViewsCache } from './toxicFlowStakeCohort';

export const TOXIC_FLOW_COHORT_KEYS = ['topHolders'] as const;

export type ToxicFlowCohortKey = (typeof TOXIC_FLOW_COHORT_KEYS)[number];

export type ToxicFlowWSAction = 'full' | 'add' | 'update' | 'remove';

/** Partial cohort patch keyed like ToxicFlowData cohort arrays. */
export type ToxicFlowPatchBody = {
  marketId?: string;
  /** Market-level scalar / redFlags patch (update action only). */
  market?: Partial<ToxicFlowData>;
} & Partial<Record<ToxicFlowCohortKey, WalletPosition[] | string[]>>;

export type ToxicFlowWSMessage = {
  type?: string;
  action?: ToxicFlowWSAction;
  /** @deprecated legacy full snapshots without `action` */
  data?: ToxicFlowData | ToxicFlowPatchBody;
};

function walletKey(w: string): string {
  return (w || '').trim().toLowerCase();
}

function isWalletRowList(v: unknown): v is WalletPosition[] {
  return Array.isArray(v) && (v.length === 0 || typeof (v[0] as WalletPosition)?.wallet === 'string');
}

function isWalletRemoveList(v: unknown): v is string[] {
  return Array.isArray(v) && (v.length === 0 || typeof v[0] === 'string');
}

function mergeCohortRows(
  prev: WalletPosition[],
  rows: WalletPosition[],
): WalletPosition[] {
  if (rows.length === 0) return prev;
  const m = new Map<string, WalletPosition>();
  for (const w of prev) {
    const k = walletKey(w.wallet);
    if (k) m.set(k, w);
  }
  for (const w of rows) {
    const k = walletKey(w.wallet);
    if (k) m.set(k, w);
  }
  return [...m.values()];
}

function removeFromCohort(prev: WalletPosition[], wallets: string[]): WalletPosition[] {
  if (wallets.length === 0) return prev;
  const drop = new Set(wallets.map(walletKey));
  return prev.filter((w) => !drop.has(walletKey(w.wallet)));
}

function applyCohortPatch(
  base: ToxicFlowData,
  body: ToxicFlowPatchBody,
  mode: 'add' | 'update' | 'remove',
): ToxicFlowData {
  const next: ToxicFlowData = { ...base };
  for (const ck of TOXIC_FLOW_COHORT_KEYS) {
    const chunk = body[ck];
    if (chunk == null) continue;
    const cur = [...(next[ck] ?? [])];
    if (mode === 'remove' && isWalletRemoveList(chunk)) {
      next[ck] = removeFromCohort(cur, chunk);
    } else if ((mode === 'add' || mode === 'update') && isWalletRowList(chunk)) {
      next[ck] = mergeCohortRows(cur, chunk);
    }
  }
  return next;
}

/** Apply one WS frame; returns null when message ignored or no prior state for patch. */
export function applyToxicFlowWSMessage(
  prev: ToxicFlowData | null,
  raw: ToxicFlowWSMessage,
): ToxicFlowData | null {
  if (raw.type !== 'toxicFlow' || !raw.data || typeof raw.data !== 'object') return prev;

  const action = raw.action ?? (isFullToxicFlowPayload(raw.data) ? 'full' : undefined);
  if (!action) return prev;

  const body = raw.data as ToxicFlowPatchBody & ToxicFlowData;

  if (action === 'full') {
    return coalesceToxicFlowPayload(null, sanitizeToxicFlowPayload(body as ToxicFlowData));
  }

  if (!prev) return prev;
  const mid = (body.marketId || (body as ToxicFlowData).marketId || '').trim();
  if (mid && prev.marketId && mid !== prev.marketId) return prev;

  let next: ToxicFlowData;
  switch (action) {
    case 'remove':
      next = applyCohortPatch(prev, body, 'remove');
      break;
    case 'add':
      next = applyCohortPatch(prev, body, 'add');
      break;
    case 'update':
      next = applyCohortPatch(prev, body, 'update');
      break;
    default:
      return prev;
  }
  if (body.market && typeof body.market === 'object') {
    next = { ...next, ...body.market };
  }

  return coalesceToxicFlowPayload(prev, next);
}

function isFullToxicFlowPayload(data: ToxicFlowPatchBody | ToxicFlowData): data is ToxicFlowData {
  return Array.isArray((data as ToxicFlowData).topHolders);
}

/** Keep only topHolders from server (ignore legacy extra cohort arrays). */
export function sanitizeToxicFlowPayload(data: ToxicFlowData): ToxicFlowData {
  return { ...data, topHolders: data.topHolders ?? [] };
}

/** HTTP refresh: replace local state with full snapshot (no WS coalesce merge from prior). */
export function toxicFlowFullSnapshot(next: ToxicFlowData): ToxicFlowData {
  clearToxicFlowTabWalletViewsCache();
  return sanitizeToxicFlowPayload(next);
}
