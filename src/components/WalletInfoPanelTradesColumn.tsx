import { memo, useMemo } from 'react';
import { resolveWalletInfoChartMarket } from '../lib/walletInfoChartMarket';
import type { Market } from '../types';
import type { WalletPosition } from '../api';
import { WalletInfoPanelLiveChart } from './WalletInfoPanelLiveChart';
import { WalletInfoPanelFillsTable } from './WalletInfoPanelFillsTable';
import { WalletInfoToxicPositionStripHost } from './WalletInfoToxicPositionStripHost';

export const WalletInfoPanelTradesColumn = memo(function WalletInfoPanelTradesColumn({
  open,
  wallet,
  selectedMarketId,
  marketById,
  markets,
  toxicFlowMarketId,
  fillsRefreshToken,
  variant = 'modal',
  onLoadingFillsChange,
}: {
  open: boolean;
  wallet: string;
  selectedMarketId: string;
  marketById: Record<string, Market>;
  markets: WalletPosition[];
  toxicFlowMarketId: string;
  fillsRefreshToken: number;
  variant?: 'inline' | 'modal';
  onLoadingFillsChange?: (loading: boolean) => void;
}) {
  void variant;
  const showPendingTrades = true;

  const selectedMarketMeta = useMemo(
    () => resolveWalletInfoChartMarket(selectedMarketId, marketById, markets),
    [selectedMarketId, marketById, markets],
  );

  return (
    <>
      <div className="text-[10px] text-gray-400 font-bold mb-1 shrink-0 min-w-0 truncate">
        Trades For Selected Market{' '}
        {selectedMarketId ? <span className="text-gray-500">({selectedMarketId})</span> : null}
      </div>
      <WalletInfoPanelLiveChart
        open={open}
        wallet={wallet}
        selectedMarketId={selectedMarketId}
        selectedMarketMeta={selectedMarketMeta}
      />
      <WalletInfoToxicPositionStripHost
        wallet={wallet}
        selectedMarketId={selectedMarketId}
        marketById={marketById}
        markets={markets}
        toxicFlowMarketId={toxicFlowMarketId}
      />
      <WalletInfoPanelFillsTable
        open={open}
        wallet={wallet}
        selectedMarketId={selectedMarketId}
        marketById={marketById}
        fillsRefreshToken={fillsRefreshToken}
        showPendingTrades={showPendingTrades}
        onLoadingFillsChange={onLoadingFillsChange}
      />
    </>
  );
});
