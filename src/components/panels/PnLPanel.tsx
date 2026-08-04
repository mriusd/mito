import { useMemo, useState, useCallback, useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useMarketLookupSnapshot } from '../../hooks/useMarketLookupSnapshot';
import { useTradingWalletAddress } from '../../hooks/useTradingWalletAddress';
import {
  refreshSidebarOnchainWallet,
  refreshSidebarOnchainWalletPnl,
  useSidebarOnchainWalletPnlDaily,
} from '../../lib/sidebarOnchainTradesStore';
import { triggerWalletRefresh } from '../../lib/clobClient';
import type { Trade } from '../../types';
import { fetchWalletActivityForDateRange } from '../../api/polymarket';
import { marketExpiryBucketDateKey } from '../../lib/weatherMarketExpiry';
import {
  getTradeClobTokenId,
  classifyMarketAssetCategory,
  marketAssetCategoryMatches,
  type MarketAssetCategoryFilter,
} from '../../utils/format';

const PNL_BUCKET_KEY = 'polybot-pnl-bucket-mode';
const PNL_ASSET_CATEGORY_KEY = 'polybot-pnl-asset-category';
const PNL_CATEGORY_OPTS: MarketAssetCategoryFilter[] = ['ALL', 'CRYPTO', 'WEATHER', 'OTHER'];

function getTradeTimeMs(trade: Trade): number {
  const ts = (trade as { match_time?: string }).match_time || trade.timestamp || trade.created_at || trade.matchTime || '';
  if (!ts) return 0;
  const num = typeof ts === 'number' ? ts : parseFloat(String(ts));
  if (!isNaN(num) && num > 0) {
    return num < 1e12 ? num * 1000 : num;
  }
  const parsed = new Date(ts);
  return isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function getDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

function fmtUsd(v: number): string {
  if (v === 0) return '-';
  const sign = v >= 0 ? '' : '-';
  const abs = Math.abs(v);
  return `${sign}$${abs.toFixed(2)}`;
}

type PnlBucketMode = 'trade' | 'market';

export function PnLPanel() {
  const trades = useAppStore((s) => s.trades);
  const marketLookup = useMarketLookupSnapshot();
  const makerAddress = useTradingWalletAddress();
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const wsPnl = useSidebarOnchainWalletPnlDaily();

  const [calendarBump, setCalendarBump] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [pmRangeTrades, setPmRangeTrades] = useState<Trade[] | null>(null);
  useEffect(() => {
    const id = window.setInterval(() => setCalendarBump((b) => b + 1), 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  const dateWindow = useMemo(() => {
    const now = new Date();
    const DAYS_PAST = 7;
    const DAYS_FUTURE = 3;
    const dates: string[] = [];
    for (let i = -DAYS_PAST; i <= DAYS_FUTURE; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() + i);
      dates.push(getDateKey(d));
    }
    return {
      dates,
      fromStr: dates[0]!,
      toStr: dates[dates.length - 1]!,
      dateSet: new Set(dates),
    };
  }, [calendarBump]);

  const [bucketMode, setBucketMode] = useState<PnlBucketMode>(() => {
    const saved = localStorage.getItem(PNL_BUCKET_KEY);
    return saved === 'market' ? 'market' : 'trade';
  });
  const [assetCategoryFilter, setAssetCategoryFilter] = useState<MarketAssetCategoryFilter>(() => {
    const v = localStorage.getItem(PNL_ASSET_CATEGORY_KEY);
    return PNL_CATEGORY_OPTS.includes(v as MarketAssetCategoryFilter)
      ? (v as MarketAssetCategoryFilter)
      : 'ALL';
  });

  const setBucket = useCallback((mode: PnlBucketMode) => {
    setBucketMode(mode);
    localStorage.setItem(PNL_BUCKET_KEY, mode);
  }, []);

  const setAssetCategory = useCallback((c: MarketAssetCategoryFilter) => {
    setAssetCategoryFilter(c);
    localStorage.setItem(PNL_ASSET_CATEGORY_KEY, c);
  }, []);

  useEffect(() => {
    const w = makerAddress?.trim().toLowerCase();
    if (!w || liveTradesSource !== 'onchain') return;
    refreshSidebarOnchainWalletPnl(w, dateWindow.fromStr, dateWindow.toStr);
  }, [makerAddress, liveTradesSource, dateWindow.fromStr, dateWindow.toStr]);

  useEffect(() => {
    const w = makerAddress?.trim();
    if (!w || liveTradesSource !== 'polymarket') {
      setPmRangeTrades(null);
      return;
    }
    let cancelled = false;
    setPmRangeTrades(null);
    void fetchWalletActivityForDateRange(w, dateWindow.fromStr, dateWindow.toStr)
      .then((rows) => {
        if (!cancelled) setPmRangeTrades(rows);
      })
      .catch(() => {
        if (!cancelled) setPmRangeTrades([]);
      });
    return () => {
      cancelled = true;
    };
  }, [makerAddress, liveTradesSource, dateWindow.fromStr, dateWindow.toStr]);

  const onchainByDate = useMemo((): Record<string, { bought: number; sold: number }> | 'pending' | 'inactive' => {
    const w = makerAddress?.trim();
    if (!w || liveTradesSource !== 'onchain') return 'inactive';
    if (!wsPnl || wsPnl.from !== dateWindow.fromStr || wsPnl.to !== dateWindow.toStr) return 'pending';
    if (assetCategoryFilter === 'ALL') {
      return bucketMode === 'market' ? wsPnl.marketByDate : wsPnl.tradeByDate;
    }
    const byCat = bucketMode === 'market' ? wsPnl.marketByDateByCategory : wsPnl.tradeByDateByCategory;
    // Empty object when category map missing (old server) or no fills — toggle still changes view.
    return byCat?.[assetCategoryFilter] ?? {};
  }, [makerAddress, liveTradesSource, wsPnl, dateWindow.fromStr, dateWindow.toStr, bucketMode, assetCategoryFilter]);

  const handleRefresh = useCallback(() => {
    const w = makerAddress?.trim().toLowerCase();
    if (!w) return;
    setRefreshing(true);
    try {
      if (liveTradesSource === 'onchain') {
        refreshSidebarOnchainWalletPnl(w, dateWindow.fromStr, dateWindow.toStr);
        refreshSidebarOnchainWallet();
      } else if (liveTradesSource === 'polymarket') {
        void fetchWalletActivityForDateRange(w, dateWindow.fromStr, dateWindow.toStr).then(setPmRangeTrades);
        triggerWalletRefresh();
      } else {
        triggerWalletRefresh();
      }
    } finally {
      if (liveTradesSource !== 'onchain') setRefreshing(false);
      else window.setTimeout(() => setRefreshing(false), 400);
    }
  }, [makerAddress, liveTradesSource, dateWindow.fromStr, dateWindow.toStr]);

  const { dates, dataByDate } = useMemo(() => {
    const { dates, dateSet } = dateWindow;

    const dataByDate: Record<string, { bought: number; sold: number }> = {};
    for (const dk of dates) {
      dataByDate[dk] = { bought: 0, sold: 0 };
    }

    if (
      liveTradesSource === 'onchain' &&
      makerAddress?.trim()
    ) {
      if (typeof onchainByDate === 'object') {
        for (const dk of dates) {
          const row = onchainByDate[dk];
          if (row) {
            dataByDate[dk] = { bought: row.bought, sold: row.sold };
          }
        }
        return { dates, dataByDate };
      }
      return { dates, dataByDate };
    }

    for (const trade of liveTradesSource === 'polymarket' && pmRangeTrades ? pmRangeTrades : trades) {
      const timeMs = getTradeTimeMs(trade);
      if (timeMs === 0) continue;
      const tid = getTradeClobTokenId(trade);
      const market = tid ? marketLookup[tid] : undefined;
      const fallbackQuestion = (trade as Trade).title || market?.question || market?.groupItemTitle || market?.eventTitle;
      const fallbackEventSlug = (trade as Trade).eventSlug || (trade as Trade).slug || market?.eventSlug;
      const cat = classifyMarketAssetCategory(market, {
        title: fallbackQuestion,
        eventSlug: fallbackEventSlug,
      });
      if (!marketAssetCategoryMatches(assetCategoryFilter, cat)) continue;

      let dateKey: string | null = null;
      if (bucketMode === 'trade') {
        dateKey = getDateKey(new Date(timeMs));
      } else {
        dateKey = marketExpiryBucketDateKey(
          market ?? { question: fallbackQuestion, eventSlug: fallbackEventSlug },
        );
        if (!dateKey) {
          dateKey = getDateKey(new Date(timeMs));
        }
      }

      if (!dateKey || !dateSet.has(dateKey)) continue;

      const rawPrice = parseFloat(trade.price) || 0;
      const size = parseFloat(trade.size_filled || trade.size) || 0;
      const isClaim = rawPrice === 0 && !(trade as { side?: string | null }).side;
      const value = isClaim ? (trade.usdcSize || size) : (trade.usdcSize || (rawPrice * size));

      if (isClaim) {
        dataByDate[dateKey].sold += value;
      } else if (trade.side === 'BUY' || trade.side === 'SPLIT') {
        dataByDate[dateKey].bought += value;
      } else {
        // SELL / MERGE / REDEEM / CLAIM / other exits
        dataByDate[dateKey].sold += value;
      }
    }

    return { dates, dataByDate };
  }, [dateWindow, onchainByDate, makerAddress, liveTradesSource, trades, pmRangeTrades, marketLookup, bucketMode, assetCategoryFilter]);

  const todayKey = getDateKey(new Date());

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0">
      <div className="panel-header flex items-center justify-between gap-2 mb-2 cursor-grab flex-wrap">
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-bold text-yellow-400">P&L</h3>
            <button
              type="button"
              className="shrink-0 p-0.5 rounded text-gray-500 hover:text-white hover:bg-gray-700 disabled:opacity-40"
              title="Refresh P&L"
              aria-label="Refresh P&L"
              disabled={!makerAddress?.trim() || refreshing}
              onClick={(e) => {
                e.stopPropagation();
                void handleRefresh();
              }}
            >
              <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          {makerAddress?.trim() && liveTradesSource === 'onchain' && typeof onchainByDate === 'object' && (
            <span className="text-[8px] text-cyan-400/90 font-medium">On-chain fills (WS)</span>
          )}
          {makerAddress?.trim() && liveTradesSource === 'polymarket' && (
            <span className="text-[8px] text-violet-400/90 font-medium">Polymarket API trades</span>
          )}
          {makerAddress?.trim() && liveTradesSource === 'onchain' && onchainByDate === 'pending' && (
            <span className="text-[8px] text-gray-500">Loading on-chain…</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 cursor-default flex-wrap justify-end" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex items-center rounded border border-gray-600 overflow-hidden text-[9px] font-bold">
            <button
              type="button"
              title="Bucket by trade execution date"
              className={`px-1.5 py-0.5 transition ${bucketMode === 'trade' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
              onClick={() => setBucket('trade')}
            >
              Trade Time
            </button>
            <button
              type="button"
              title="Bucket by market expiry date (falls back to trade date if unknown)"
              className={`px-1.5 py-0.5 transition ${bucketMode === 'market' ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`}
              onClick={() => setBucket('market')}
            >
              Market Expiry
            </button>
          </div>
          <div className="inline-flex items-center gap-0.5 rounded-md bg-gray-900 border border-gray-700 p-0.5 text-[9px] font-bold">
            {PNL_CATEGORY_OPTS.map((c) => {
              const active = assetCategoryFilter === c;
              const label = c === 'CRYPTO' ? 'Crypto' : c === 'WEATHER' ? 'Weather' : c === 'OTHER' ? 'Other' : 'All';
              return (
                <button
                  key={c}
                  type="button"
                  title={
                    c === 'ALL' ? 'All markets'
                      : c === 'CRYPTO' ? 'BTC / ETH / SOL / XRP'
                        : c === 'WEATHER' ? 'Weather / temperature'
                          : 'RWA, events, and other'
                  }
                  className={`px-1.5 py-0.5 rounded transition ${
                    active
                      ? c === 'CRYPTO'
                        ? 'bg-green-800/80 text-green-200'
                        : c === 'WEATHER'
                          ? 'bg-sky-800/80 text-sky-200'
                          : c === 'OTHER'
                            ? 'bg-amber-800/70 text-amber-100'
                            : 'bg-gray-600 text-white'
                      : 'text-gray-400 hover:text-gray-200'
                  }`}
                  onClick={() => setAssetCategory(c)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-gray-900">
          <tr>
            <th className="px-2 py-1 text-left text-gray-400 font-bold border-b border-gray-700 bg-gray-900"></th>
            {dates.map((dk) => {
              const dt = parseLocalDate(dk);
              const isToday = dk === todayKey;
              const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
              const textCls = isToday
                ? 'text-yellow-400'
                : isWeekend
                  ? 'text-purple-400'
                  : 'text-gray-300';
              return (
                <th
                  key={dk}
                  className={`px-1.5 py-1 text-center border-b border-l border-gray-700 bg-gray-900 font-bold whitespace-nowrap ${isWeekend ? 'bg-purple-900/20' : ''}`}
                >
                  <div className={`flex flex-row items-center justify-center leading-tight gap-1 text-[10px] whitespace-nowrap ${textCls}`}>
                    <span>{DAY_NAMES[dt.getDay()]}</span>
                    <span>{dt.getDate()} {MONTH_NAMES[dt.getMonth()]}</span>
                  </div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {/* Bought row */}
          <tr className="hover:bg-gray-800/50">
            <td className="px-2 py-1 font-bold text-red-400 border-b border-gray-700/50 whitespace-nowrap">Bought</td>
            {dates.map((dk) => {
              const v = dataByDate[dk]?.bought || 0;
              return (
                <td key={dk} className={`px-2 py-1 text-right border-b border-l border-gray-700 whitespace-nowrap ${v > 0 ? 'text-red-400' : 'text-gray-600'}`}>
                  {v > 0 ? fmtUsd(-v) : '-'}
                </td>
              );
            })}
          </tr>
          {/* Sold row */}
          <tr className="hover:bg-gray-800/50">
            <td className="px-2 py-1 font-bold text-green-400 border-b border-gray-700/50 whitespace-nowrap">Sold</td>
            {dates.map((dk) => {
              const v = dataByDate[dk]?.sold || 0;
              return (
                <td key={dk} className={`px-2 py-1 text-right border-b border-l border-gray-700 whitespace-nowrap ${v > 0 ? 'text-green-400' : 'text-gray-600'}`}>
                  {v > 0 ? fmtUsd(v) : '-'}
                </td>
              );
            })}
          </tr>
          {/* Net row */}
          <tr className="hover:bg-gray-800/50">
            <td className="px-2 py-1 font-bold text-white border-b border-gray-700/50 whitespace-nowrap">Net</td>
            {dates.map((dk) => {
              const b = dataByDate[dk]?.bought || 0;
              const s = dataByDate[dk]?.sold || 0;
              const net = s - b;
              const color = net === 0 ? 'text-gray-600' : net > 0 ? 'text-green-400' : 'text-red-400';
              return (
                <td key={dk} className={`px-2 py-1 text-right border-b border-l border-gray-700 font-bold whitespace-nowrap ${color}`}>
                  {net === 0 ? '-' : fmtUsd(net)}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
      </div>
    </div>
  );
}
