import { cancelOrder, cancelOrders } from '../api';
import type { Order } from '../types';
import { getOrderClobTokenId, normalizeClobTokenId } from '../utils/format';

export async function cancelExistingSellOrdersForToken(
  tokenId: string,
  orders: Order[],
): Promise<{ success: boolean; error?: string; cancelled: number }> {
  const tidKey = normalizeClobTokenId(tokenId);
  if (!tidKey) return { success: true, cancelled: 0 };

  const existingSellIds = orders
    .filter(
      (o) =>
        (o.side || '').toUpperCase() === 'SELL' &&
        normalizeClobTokenId(getOrderClobTokenId(o)) === tidKey,
    )
    .map((o) => o.id)
    .filter((id): id is string => Boolean(id));

  if (existingSellIds.length === 0) return { success: true, cancelled: 0 };

  const cancelResult =
    existingSellIds.length === 1
      ? await cancelOrder(existingSellIds[0]!)
      : await cancelOrders(existingSellIds);

  if (!cancelResult.success) {
    return {
      success: false,
      error: cancelResult.error || 'Cancel existing sell failed',
      cancelled: 0,
    };
  }

  return { success: true, cancelled: existingSellIds.length };
}
