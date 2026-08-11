import { memo, useMemo, type RefObject } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import type { WalletPosition, WalletSummary } from '../api';
import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';
import { exportWalletMarketsCsv } from '../lib/walletInfoCsvExport';
import { WalletScoresDailyCharts } from './WalletScoresDailyCharts';
import { WalletLatestMarketsTradedTable } from './WalletLatestMarketsTradedTable';
import { WalletScoresLedgerSummaryGrid } from './walletInfoPanelSummaryGrid';
import { WalletInfoPanelLiveChart } from './WalletInfoPanelLiveChart';
import { WalletInfoPanelFillsTable } from './WalletInfoPanelFillsTable';
import { WalletInfoToxicPositionStripHost } from './WalletInfoToxicPositionStripHost';
import { resolveWalletInfoChartMarket, resolveWalletInfoMarketPosition } from '../lib/walletInfoChartMarket';
import { canonicalConditionKey } from '../hooks/useOnchainTradesWS';
import { useSidebarToxicFlowData } from '../lib/sidebarToxicFlowStore';

export const WalletInfoPanelSummarySection = memo(function WalletInfoPanelSummarySection({
  wallet,
  summary,
  loadingMarkets,
  onRefresh,
  dailySnapshotsRefresh,
  summaryLeftRef,
  summaryLeftH,
  lgChartsSync,
}: {
  wallet: string;
  summary: WalletSummary | null | undefined;
  loadingMarkets: boolean;
  onRefresh: () => void;
  dailySnapshotsRefresh: number;
  summaryLeftRef: RefObject<HTMLDivElement>;
  summaryLeftH: number;
  lgChartsSync: boolean;
}) {
  return (
    <div className="text-[10px] shrink-0 flex flex-col">
      <div className="bg-gray-900 rounded p-2 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 mb-1 shrink-0">
          <div className="text-gray-500 font-semibold">
            Summary <span className="font-normal text-gray-600">[updated every hour]</span>
          </div>
          <button
            type="button"
            className="shrink-0 p-0.5 rounded text-gray-500 hover:text-white hover:bg-gray-800 disabled:opacity-40"
            title="Refresh markets & trades"
            aria-label="Refresh markets and trades"
            disabled={!wallet || loadingMarkets}
            onClick={() => {
              void onRefresh();
            }}
          >
            <RefreshCw size={12} className={loadingMarkets ? 'animate-spin' : ''} />
          </button>
        </div>
        <div
          className="mt-1 flex flex-col lg:flex-row gap-3 lg:items-start items-stretch min-w-0 min-h-0"
          style={
            lgChartsSync && summaryLeftH > 0
              ? { height: summaryLeftH, maxHeight: summaryLeftH }
              : undefined
          }
        >
          <div
            ref={summaryLeftRef}
            className="shrink-0 w-full lg:w-[min(16.5rem,calc(100%/4))] lg:max-w-[16.5rem] flex flex-col lg:self-start"
          >
            {summary === undefined && <div className="text-gray-500">Loading...</div>}
            {summary === null && <div className="text-gray-500">No wallet_scores_ledger row</div>}
            {summary && (
              <WalletScoresLedgerSummaryGrid
                s={summary}
                narrowSummary
                hideNetCash
                hideTotalMarkets
                showLastUpdated
              />
            )}
          </div>
          {wallet.trim() ? (
            <div
              className="min-w-0 flex-1 flex flex-col min-h-0 overflow-hidden lg:border-l lg:border-gray-800 lg:pl-3"
              style={
                lgChartsSync && summaryLeftH > 0
                  ? { height: summaryLeftH, maxHeight: summaryLeftH, minHeight: 0 }
                  : undefined
              }
            >
              <WalletScoresDailyCharts wallet={wallet.trim()} refreshToken={dailySnapshotsRefresh} chartsLayout="row" compactSummary />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
});

export const WalletInfoPanelMarketsSection = memo(function WalletInfoPanelMarketsSection({
  wallet,
  markets,
  marketById,
  loadingMarkets,
  selectedMarketId,
  onRowClick,
  isInlineWalletInfo,
}: {
  wallet: string;
  markets: WalletPosition[];
  marketById: Record<string, Market>;
  loadingMarkets: boolean;
  selectedMarketId: string;
  onRowClick: (id: string) => void;
  isInlineWalletInfo: boolean;
}) {
  return (
    <div
      className={`bg-gray-900 rounded p-2 min-h-0 h-full min-w-0 flex flex-col overflow-hidden${isInlineWalletInfo ? ' shrink-0 w-[min(52rem,56%)] max-w-[52rem]' : ''}`}
    >
      <div className="flex items-center justify-between gap-2 mb-1 shrink-0">
        <div className="text-[10px] text-gray-400 font-bold">Latest Markets Traded</div>
        <button
          type="button"
          className="text-[10px] text-blue-400 hover:underline shrink-0 disabled:opacity-40 disabled:pointer-events-none"
          disabled={loadingMarkets || markets.length === 0}
          onClick={() => exportWalletMarketsCsv(wallet, markets, useAppStore.getState().marketLookup)}
        >
          Export CSV
        </button>
      </div>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <WalletLatestMarketsTradedTable
          markets={markets}
          marketById={marketById}
          loading={loadingMarkets}
          selectedMarketId={selectedMarketId}
          onRowClick={onRowClick}
          horizontalCellPadding
          stickyHeader
        />
      </div>
    </div>
  );
});

/** Chart + toxic strip + fills. Toxic store sub isolated to strip host only. */
export const WalletInfoPanelTradesSection = memo(function WalletInfoPanelTradesSection({
  open,
  wallet,
  selectedMarketId,
  marketById,
  markets,
  toxicFlowMarketId,
  fillsRefreshToken,
  focusMarketSeq = 0,
  variant = 'modal',
}: {
  open: boolean;
  wallet: string;
  selectedMarketId: string;
  marketById: Record<string, Market>;
  markets: WalletPosition[];
  toxicFlowMarketId: string;
  fillsRefreshToken: number;
  focusMarketSeq?: number;
  variant?: 'inline' | 'modal';
}) {
  const toxicFlowData = useSidebarToxicFlowData();
  const showPendingTrades = useMemo(() => {
    if (variant !== 'inline') return false;
    const sel = canonicalConditionKey(selectedMarketId);
    const sidebar = canonicalConditionKey(toxicFlowMarketId);
    return !!sel && !!sidebar && sel === sidebar;
  }, [variant, selectedMarketId, toxicFlowMarketId]);

  const selectedMarketMeta = useMemo(
    () => resolveWalletInfoChartMarket(selectedMarketId, marketById, markets),
    [selectedMarketId, marketById, markets],
  );

  const positionForMarket = useMemo(
    () => resolveWalletInfoMarketPosition(wallet, selectedMarketId, markets, toxicFlowData, toxicFlowMarketId),
    [wallet, selectedMarketId, markets, toxicFlowData, toxicFlowMarketId],
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
        positionForMarket={positionForMarket}
        focusMarketSeq={focusMarketSeq}
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
      />
    </>
  );
});

export const WalletInfoPanelInlineMarketsToggle = memo(function WalletInfoPanelInlineMarketsToggle({
  inlineMarketsListOpen,
  onToggle,
}: {
  inlineMarketsListOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`wallet-info-markets-expand-handle shrink-0 w-6 flex flex-col justify-center items-center border-x border-gray-700/55 bg-gray-800/95 text-gray-500 hover:text-gray-400 ${inlineMarketsListOpen ? '' : 'sidebar-expand-handle-idle-flash'}`}
      title={inlineMarketsListOpen ? 'Hide markets list' : 'Show markets list'}
      aria-expanded={inlineMarketsListOpen}
      aria-label={inlineMarketsListOpen ? 'Hide markets list' : 'Show markets list'}
      onClick={onToggle}
    >
      {inlineMarketsListOpen ? (
        <ChevronLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
      ) : (
        <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden />
      )}
    </button>
  );
});
