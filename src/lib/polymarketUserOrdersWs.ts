import type { Order } from '../types';

export const POLY_USER_ORDERS_WS_URL = 'wss://ws-subscriptions-clob.polymarket.com/ws/user';

export interface PolyUserWsAuth {
  apiKey: string;
  secret: string;
  passphrase: string;
}

export interface PolyUserOrderWsMsg {
  event_type?: string;
  id?: string;
  asset_id?: string;
  market?: string;
  side?: string;
  price?: string;
  original_size?: string;
  size_matched?: string;
  size?: string;
  outcome?: string;
  expiration?: string;
  timestamp?: string;
  created_at?: string;
  status?: string;
  order_type?: string;
  type?: string;
}

export function normalizeConditionIdForWs(raw: string | undefined | null): string {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return '';
  if (!t.startsWith('0x')) return `0x${t}`;
  return t;
}

export function wsOrderToAppOrder(msg: PolyUserOrderWsMsg): Order {
  const side = String(msg.side || '').toUpperCase();
  return {
    id: String(msg.id || ''),
    asset_id: String(msg.asset_id || ''),
    market: msg.market ? normalizeConditionIdForWs(msg.market) : undefined,
    side: side === 'SELL' ? 'SELL' : 'BUY',
    price: String(msg.price || '0'),
    size: String(msg.original_size || msg.size || '0'),
    original_size: msg.original_size != null ? String(msg.original_size) : undefined,
    size_matched: msg.size_matched != null ? String(msg.size_matched) : undefined,
    outcome: msg.outcome != null ? String(msg.outcome) : undefined,
    expiration: msg.expiration != null ? String(msg.expiration) : undefined,
    created_at: msg.timestamp != null ? String(msg.timestamp) : msg.created_at != null ? String(msg.created_at) : undefined,
    status: msg.status != null ? String(msg.status) : undefined,
    type: msg.order_type != null ? String(msg.order_type) : undefined,
  };
}

function orderRemainingShares(msg: PolyUserOrderWsMsg): number {
  const orig = parseFloat(String(msg.original_size || msg.size || '0'));
  const matched = parseFloat(String(msg.size_matched || '0'));
  if (!Number.isFinite(orig)) return 0;
  return Math.max(0, orig - (Number.isFinite(matched) ? matched : 0));
}

/** Apply one user-channel order event onto the current open-order list. */
export function applyUserOrderWsEvent(orders: Order[], msg: PolyUserOrderWsMsg): Order[] {
  const id = String(msg.id || '').trim();
  if (!id) return orders;

  const evt = String(msg.type || '').toUpperCase();
  if (evt === 'CANCELLATION' || orderRemainingShares(msg) <= 1e-9) {
    return orders.filter((o) => o.id !== id);
  }

  const row = wsOrderToAppOrder(msg);
  const idx = orders.findIndex((o) => o.id === id);
  if (idx >= 0) {
    const next = orders.slice();
    next[idx] = { ...next[idx], ...row };
    return next;
  }
  return [...orders, row];
}

export function buildUserOrdersSubscribePayload(
  markets: string[],
  auth: { key: string; secret: string; passphrase: string },
  initialDump: boolean,
): Record<string, unknown> {
  return {
    type: 'subscribe',
    operation: 'subscribe',
    markets,
    initial_dump: initialDump,
    auth: {
      apiKey: auth.key,
      secret: auth.secret,
      passphrase: auth.passphrase,
    },
  };
}
