import { useMemo } from 'react';
import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';
import { tradeMatchesSelectedMarket } from '../utils/format';
import type { MyTradeChartRow } from '../lib/chartTradeMarkers';
import { useSidebarOnchainWalletMarketTrades } from '../lib/sidebarOnchainTradesStore';

/** Chart markers — isolated from Sidebar parent re-renders. */
export function useSidebarMyTradesChartMarkers(
  selectedMarket: Market | null,
  marketLookup: Record<string, Market>,
): MyTradeChartRow[] | undefined {
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const trades = useAppStore((s) => s.trades);
  const wsMarketTrades = useSidebarOnchainWalletMarketTrades();

  return useMemo(() => {
    if (!selectedMarket) return undefined;
    if (liveTradesSource !== 'onchain') {
      return trades
        .filter((t) => tradeMatchesSelectedMarket(t, selectedMarket, marketLookup))
        .slice(0, 20) as MyTradeChartRow[];
    }
    return wsMarketTrades
      .slice()
      .sort((a, b) => b.blockTime - a.blockTime || (b.logIndex ?? 0) - (a.logIndex ?? 0))
      .slice(0, 100)
      .map((f) => ({
        asset_id: f.tokenId,
        token_id: f.tokenId,
        side: f.side,
        price: String(f.price),
        size: String(f.size),
        fee: String(f.fee || 0),
        timestamp: f.blockTime > 0 ? f.blockTime * 1000 : Date.now(),
        txHash: f.txHash,
        logIndex: f.logIndex,
        created_at: '',
        matchTime: '',
      })) as MyTradeChartRow[];
  }, [liveTradesSource, trades, selectedMarket, marketLookup, wsMarketTrades]);
}
