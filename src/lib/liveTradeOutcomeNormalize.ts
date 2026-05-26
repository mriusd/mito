import type { LiveTrade } from '../hooks/usePolymarketOB';
import { normalizeClobTokenId } from '../utils/format';

/** Mirror opposite-token fills into selected outcome (BUY NO 20¢ → SELL YES 80¢). */
export function normalizeLiveTradeToSelectedToken(
  trade: LiveTrade,
  selectedTokenId: string | null | undefined,
  oppositeTokenId: string | null | undefined,
): LiveTrade {
  const sel = normalizeClobTokenId(selectedTokenId);
  const opp = normalizeClobTokenId(oppositeTokenId);
  const tok = normalizeClobTokenId(trade.tokenId);
  if (!sel || !tok || tok === sel) return trade;
  if (opp && tok !== opp) return trade;

  const price = parseFloat(trade.price);
  if (!Number.isFinite(price)) return trade;
  const flippedPrice = Math.max(0, Math.min(1, 1 - price));

  return {
    ...trade,
    side: trade.side === 'BUY' ? 'SELL' : 'BUY',
    price: String(flippedPrice),
  };
}
