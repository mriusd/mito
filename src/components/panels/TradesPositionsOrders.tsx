import { useState, useCallback, useEffect, useMemo, memo, type ReactNode } from 'react';
import { useAccount } from 'wagmi';
import { useAppStore } from '../../stores/appStore';
import {
  cancelOrder,
  fetchMarketOutcomeTokens,
  fetchOnchainWalletTrades,
  type OnchainClaimRow,
  type OnchainMarketTradeRow,
} from '../../api';
import { positionExitBidProb, outcomeBidAskProb } from '../../lib/outcomeQuote';
import { positionBidExitTier, positionSellPriceColorStyle, POSITION_BID_EXIT_TAILWIND } from '../../lib/positionBidExitTier';
import { onchainFillKey } from '../../lib/tradeKeys';
import { useThrottledMarketLookupSubset } from '../../hooks/useThrottledMarketLookupSubset';
import { useLiveBidAskLookupSubset } from '../../hooks/useLiveBidAskLookupSubset';
import { useTradingWalletAddress } from '../../hooks/useTradingWalletAddress';
import { setChartBidAskExtraTokens } from '../../lib/chartWsShared';
import { TpoVirtualTableBody } from './TpoVirtualTableBody';
import { TpoColorCodedSize } from './TpoColorCodedSize';
import {
  refreshSidebarOnchainWallet,
  useSidebarOnchainGridWalletPositions,
  useSidebarOnchainWalletTrades,
  useSidebarOnchainWalletWsHydrated,
} from '../../lib/sidebarOnchainTradesStore';
import { canonicalConditionKey, type WSPosition, type WSTrade } from '../../hooks/useOnchainTradesWS';
import { hasCredsForWallet, ensureCredsForWallet, triggerWalletRefresh } from '../../lib/clobClient';
import { isWebMode } from '../../lib/env';
import { appKit } from '../../lib/wallet';
import { signingDialog } from '../SigningDialog';
import type { Position, Trade, Order } from '../../types';
import { showToast } from '../../utils/toast';
import { getMarketPriceCondition, getTokenOutcome, getTradeClobTokenId, getOrderClobTokenId, getPositionClobTokenId, extractAssetFromMarket, formatPriceShort, lookupMarketByTokenId, isWeatherMarket, normalizeClobTokenId, ASSET_COLORS as assetColorMap2 } from '../../utils/format';
import { formatWeatherEventDateLabel, tpoMarketSortDateIso } from '../../lib/weatherMarketExpiry';
import type { Market } from '../../types';

const assetColorMap: Record<string, string> = { BTC: 'text-orange-400', ETH: 'text-blue-400', SOL: 'text-purple-400', XRP: 'text-cyan-400' };

function normalizeDbUnderlying(raw: string | undefined): string {
  if (!raw?.trim()) return '';
  const k = raw.trim().toLowerCase();
  const m: Record<string, string> = {
    btc: 'BTC', bitcoin: 'BTC', eth: 'ETH', ethereum: 'ETH', sol: 'SOL', solana: 'SOL', xrp: 'XRP', ripple: 'XRP',
  };
  return m[k] || (raw.trim().length <= 6 ? raw.trim().toUpperCase() : '');
}

function formatTpoMarketLabel(asset: string, marketName: string): string {
  if (!asset || asset === 'WEATHER') return marketName;
  return `${asset} ${formatPriceShort(marketName, asset === 'ETH' ? 'ETH' : undefined)}`;
}

function formatQuoteCents(prob: number | null | undefined): string {
  if (prob == null || !Number.isFinite(prob) || prob <= 0) return '-';
  return `${(prob * 100).toFixed(1)}¢`;
}

function formatElapsed(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return '';
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

function getLocalDateKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function tpoDateColumnColor(dateIso: string | null, weekend = false): string {
  if (!dateIso) return 'text-gray-400';
  const today = getLocalDateKey();
  const tomorrow = getLocalDateKey(new Date(Date.now() + 86_400_000));
  if (dateIso === today) return 'text-yellow-400 font-bold';
  if (dateIso === tomorrow) return 'text-red-400 font-bold';
  if (weekend) return 'text-purple-400';
  return 'text-gray-400';
}

function getDateDisplay(endDate: string | null): { label: string; color: string } {
  if (!endDate) return { label: '-', color: 'text-gray-400' };
  let dateIso: string | null = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? endDate : null;
  if (!dateIso) {
    const ms = Date.parse(endDate);
    if (!Number.isFinite(ms)) return { label: '-', color: 'text-gray-400' };
    dateIso = getLocalDateKey(new Date(ms));
  }
  const [y, mo, d] = dateIso.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(y, mo - 1, d);
  const dayAbbr = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dt.getDay()];
  const weekend = dt.getDay() === 0 || dt.getDay() === 6;
  return {
    label: `${dayAbbr} ${d}`,
    color: tpoDateColumnColor(dateIso, weekend),
  };
}

function resolveTpoRowDate(
  market: Market | null | undefined,
  fallback: { question?: string; eventSlug?: string; endDate?: string | null },
): { sortDate: string | null; display: { label: string; color: string }; isWeather: boolean } {
  const meta = market ?? {
    question: fallback.question,
    eventSlug: fallback.eventSlug,
    endDate: fallback.endDate ?? undefined,
  };
  const weather = formatWeatherEventDateLabel(meta);
  if (weather) {
    const [y, mo, day] = weather.eventDateIso.split('-').map((x) => parseInt(x, 10));
    const dow = new Date(Date.UTC(y, mo - 1, day, 12, 0, 0)).getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    return {
      sortDate: weather.eventDateIso,
      display: {
        label: weather.label,
        color: tpoDateColumnColor(weather.eventDateIso, isWeekend),
      },
      isWeather: true,
    };
  }
  const sortDate = tpoMarketSortDateIso(market ?? null, fallback.endDate ?? null);
  return {
    sortDate,
    display: getDateDisplay(sortDate),
    isWeather: false,
  };
}

function getTimeLeftDisplay(endDate: string | null): { label: string; color: string } {
  if (!endDate) return { label: '-', color: 'text-gray-400' };
  const dt = new Date(endDate);
  const msLeft = dt.getTime() - Date.now();
  if (!Number.isFinite(msLeft)) return { label: '-', color: 'text-gray-400' };

  if (msLeft <= 0) return { label: 'Expired', color: 'text-red-400 font-bold' };

  const minutesLeft = msLeft / 60000;
  const hoursLeft = msLeft / 3600000;
  const daysLeft = msLeft / 86400000;

  // Match the requested style like "2.5h"
  if (minutesLeft < 60) {
    const m = Math.max(1, Math.round(minutesLeft));
    return { label: `${m}m`, color: 'text-red-400 font-bold' };
  }
  if (hoursLeft < 48) {
    const h = hoursLeft.toFixed(1);
    return { label: `${h}h`, color: hoursLeft < 24 ? 'text-red-400 font-bold' : 'text-yellow-400 font-bold' };
  }

  const d = Math.max(1, Math.floor(daysLeft));
  return { label: `${d}d`, color: 'text-gray-400' };
}

function parseEndDateMs(endDate: string | null): number {
  if (!endDate) return 0;
  const t = Date.parse(endDate);
  return Number.isFinite(t) ? t : 0;
}

function comparePositionsByExpiryDesc(
  a: { endDate: string | null; tid: string },
  b: { endDate: string | null; tid: string },
): number {
  const ea = parseEndDateMs(a.endDate);
  const eb = parseEndDateMs(b.endDate);
  if (ea === 0 && eb === 0) return a.tid.localeCompare(b.tid);
  if (ea === 0) return 1;
  if (eb === 0) return -1;
  if (eb !== ea) return eb - ea;
  return a.tid.localeCompare(b.tid);
}

function buildSellOrderPriceByToken(orders: Order[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const o of orders) {
    if ((o.side || '').toUpperCase() !== 'SELL') continue;
    const tid = normalizeClobTokenId(getOrderClobTokenId(o));
    if (!tid) continue;
    const price = parseFloat(o.price);
    if (!Number.isFinite(price) || price <= 0) continue;
    const priceCents = price * 100;
    const prev = map.get(tid);
    if (prev == null || priceCents < prev) map.set(tid, priceCents);
  }
  return map;
}

function wsPositionsToPM(rows: WSPosition[], marketLookup: Record<string, Market>): Position[] {
  return rows.map((r) => {
    const cur = positionExitBidProb(r.tokenId, marketLookup);
    return {
      asset: r.tokenId,
      size: r.size,
      avgPrice: r.avgPrice,
      curPrice: cur,
      ...(r.title ? { title: r.title } : {}),
      ...(r.slug ? { slug: r.slug } : {}),
      ...(r.eventSlug ? { eventSlug: r.eventSlug } : {}),
      ...(r.outcome ? { outcome: r.outcome } : {}),
      ...(r.endDate ? { endDate: r.endDate } : {}),
      ...(r.underlyingAsset ? { underlyingAsset: r.underlyingAsset } : {}),
      ...(r.marketId ? { market: r.marketId } : {}),
    };
  });
}

function wsTradesToPM(rows: WSTrade[]): Trade[] {
  return rows.map((t) => {
    const tsMs = t.blockTime > 1e12 ? t.blockTime : t.blockTime * 1000;
    const id = onchainFillKey(t.txHash, t.logIndex) || t.id;
    const mid = (t.marketId || '').trim();
    return {
      id: id || `token:${t.tokenId}:${tsMs}`,
      asset_id: t.tokenId,
      token_id: t.tokenId,
      side: t.side as Trade['side'],
      price: String(t.price),
      size: String(t.size),
      fee: String(t.fee || 0),
      timestamp: String(tsMs),
      ...(mid ? { market: mid, conditionId: mid } : {}),
      ...(t.outcome ? { outcome: t.outcome } : {}),
      ...(t.title ? { title: t.title } : {}),
      ...(t.slug ? { slug: t.slug } : {}),
      ...(t.eventSlug ? { eventSlug: t.eventSlug } : {}),
    };
  });
}

function ledgerTradesToPM(rows: OnchainMarketTradeRow[]): Trade[] {
  return rows.map((t) => {
    const tsMs = t.blockTime > 1e12 ? t.blockTime : t.blockTime * 1000;
    const id = onchainFillKey(t.txHash, t.logIndex);
    const mid = (t.marketId || '').trim();
    return {
      id: id || `token:${t.tokenId}:${tsMs}`,
      asset_id: t.tokenId,
      token_id: t.tokenId,
      side: t.side as Trade['side'],
      price: String(t.price),
      size: String(t.size),
      fee: String(t.fee || 0),
      timestamp: String(tsMs),
      ...(mid ? { market: mid, conditionId: mid } : {}),
      ...(t.outcome ? { outcome: t.outcome } : {}),
      ...(t.title ? { title: t.title } : {}),
      ...(t.slug ? { slug: t.slug } : {}),
      ...(t.eventSlug ? { eventSlug: t.eventSlug } : {}),
    };
  });
}

type TpoSelectHint = {
  marketId?: string | null;
  title?: string | null;
  eventSlug?: string | null;
  endDate?: string | null;
  outcome?: string | null;
};

const TPO_TRADES_PAGE = 500;

function TpoAuthEmpty({
  mode,
  onLogIn,
  loggingIn,
}: {
  mode: 'connect' | 'login';
  onLogIn?: () => void;
  loggingIn?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-2">
      <button
        type="button"
        disabled={mode === 'login' && loggingIn}
        onClick={mode === 'connect' ? () => appKit.open({ view: 'Connect' }) : onLogIn}
        className="px-4 py-2 rounded-lg font-bold text-xs transition bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none text-white"
      >
        {mode === 'connect' ? 'Connect Wallet' : loggingIn ? 'Signing…' : 'Log In'}
      </button>
      {mode === 'login' && (
        <p className="text-[10px] text-gray-500 m-0 text-center max-w-[220px]">
          Sign once to load orders and sync trading data.
        </p>
      )}
    </div>
  );
}

function TradesPositionsOrdersInner({ panelId }: { panelId: string }) {
  const positions = useAppStore((s) => s.positions);
  const orders = useAppStore((s) => s.orders);
  const trades = useAppStore((s) => s.trades);
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const signingMode = useAppStore((s) => s.signingMode);
  const pkAddress = useAppStore((s) => s.pkAddress);
  const pkRevision = useAppStore((s) => s.pkRevision);
  const { address, isConnected } = useAccount();
  const makerAddress = useTradingWalletAddress();
  const selectedMarketId = useAppStore((s) => s.selectedMarket?.conditionId || s.selectedMarket?.id);
  const selectedMarketClobTokenIds = useAppStore((s) => s.selectedMarket?.clobTokenIds);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);

  const [onchainClaimRows] = useState<OnchainClaimRow[]>([]);
  const onchainWsPositions = useSidebarOnchainGridWalletPositions();
  const onchainWsTrades = useSidebarOnchainWalletTrades();
  const onchainWsHydrated = useSidebarOnchainWalletWsHydrated();
  const tradingWalletKey = makerAddress.trim().toLowerCase();
  const onchainPositionsLoading =
    liveTradesSource === 'onchain' &&
    !!tradingWalletKey &&
    !onchainWsHydrated;
  const onchainTradesLoading =
    liveTradesSource === 'onchain' &&
    !!tradingWalletKey &&
    !onchainWsHydrated;

  useEffect(() => {
    if (liveTradesSource !== 'onchain' || !tradingWalletKey) return;
    refreshSidebarOnchainWallet();
  }, [liveTradesSource, tradingWalletKey]);

  const polymarketTokenKey = useMemo(() => {
    const s = new Set<string>();
    for (const p of positions) {
      const tid = getPositionClobTokenId(p);
      if (tid) s.add(tid);
    }
    // Cap order/trade token keys — 5k+ open orders must not explode live lookup / subset builds.
    let orderN = 0;
    for (const o of orders) {
      if (orderN >= 200) break;
      const t = o.asset_id || o.token_id;
      if (t) {
        s.add(t);
        orderN += 1;
      }
    }
    let tradeN = 0;
    for (const t of trades) {
      if (tradeN >= 200) break;
      const id = t.asset_id || t.asset || t.token_id;
      if (id) {
        s.add(id);
        tradeN += 1;
      }
    }
    return Array.from(s).sort().join(',');
  }, [positions, orders, trades]);

  const tpoClobIds = useMemo(() => {
    const set = new Set<string>();
    if (polymarketTokenKey) {
      for (const tid of polymarketTokenKey.split(',')) {
        const t = tid.trim();
        if (t) set.add(t);
      }
    }
    for (const r of onchainWsPositions) {
      if (r.tokenId) set.add(String(r.tokenId));
    }
    for (const t of onchainWsTrades.slice(0, 200)) {
      if (t.tokenId) set.add(String(t.tokenId));
    }
    for (const t of selectedMarketClobTokenIds || []) if (t) set.add(String(t));
    return [...set];
  }, [polymarketTokenKey, onchainWsPositions, onchainWsTrades, selectedMarketClobTokenIds]);

  // Grid flush (~2s) for labels/metadata; live WS only for position quotes (not 5k orders).
  const marketLookup = useThrottledMarketLookupSubset(tpoClobIds);

  // Include YES+NO legs so NO positions can imply from YES book (and vice versa).
  const tpoLiveQuoteIds = useMemo(() => {
    const set = new Set<string>();
    const addTid = (tid: string | null | undefined) => {
      const t = String(tid || '').trim();
      if (!t) return;
      set.add(t);
      const m = lookupMarketByTokenId(t, marketLookup);
      for (const id of m?.clobTokenIds || []) {
        if (id) set.add(String(id));
      }
    };
    for (const p of positions) addTid(getPositionClobTokenId(p));
    for (const r of onchainWsPositions) addTid(r.tokenId);
    for (const t of selectedMarketClobTokenIds || []) addTid(t);
    return [...set];
  }, [positions, onchainWsPositions, selectedMarketClobTokenIds, marketLookup]);

  const liveQuoteLookup = useLiveBidAskLookupSubset(tpoLiveQuoteIds);

  useEffect(() => {
    setChartBidAskExtraTokens('tpo', tpoLiveQuoteIds);
  }, [tpoLiveQuoteIds]);
  useEffect(() => () => setChartBidAskExtraTokens('tpo', []), []);

  const sellOrderPriceByToken = useMemo(() => buildSellOrderPriceByToken(orders), [orders]);

  const onchainPositionsAsPM = useMemo(
    () => wsPositionsToPM(onchainWsPositions, liveQuoteLookup),
    [onchainWsPositions, liveQuoteLookup],
  );

  const onchainTradesAsPM = useMemo(() => wsTradesToPM(onchainWsTrades), [onchainWsTrades]);

  const onchainClaimsAsPM = useMemo((): Trade[] => {
    return onchainClaimRows.map((c, i) => {
      const tsMs = c.blockTime > 1e12 ? c.blockTime : c.blockTime * 1000;
      return {
        id: `claim-${c.txHash}-${i}`,
        asset_id: '',
        token_id: '',
        side: '',
        price: '0',
        size: String(c.payout),
        usdcSize: c.payout,
        fee: '0',
        timestamp: String(tsMs),
        ...(c.title ? { title: c.title } : {}),
        ...(c.eventSlug ? { eventSlug: c.eventSlug } : {}),
      };
    });
  }, [onchainClaimRows]);

  const positionsForTable = useMemo(() => {
    if (liveTradesSource !== 'onchain') return positions;
    const byToken = new Map<string, Position>();
    for (const p of positions) {
      const tid = getPositionClobTokenId(p);
      if (!tid || (p.size || 0) <= 0) continue;
      byToken.set(normalizeClobTokenId(tid), p);
    }
    for (const p of onchainPositionsAsPM) {
      const tid = getPositionClobTokenId(p);
      if (!tid || (p.size || 0) <= 0) continue;
      byToken.set(normalizeClobTokenId(tid), p);
    }
    return [...byToken.values()];
  }, [liveTradesSource, positions, onchainPositionsAsPM]);

  const handleMarketClick = useCallback(async (tokenId: string, hint?: TpoSelectHint) => {
    const tid = String(tokenId || '').trim();
    if (!tid) return;
    const fromLookup = lookupMarketByTokenId(tid, marketLookup);
    const outcomeHint = (hint?.outcome || '').toUpperCase();
    const sideFromHint = outcomeHint === 'NO' || outcomeHint === 'DOWN' ? 'NO' : 'YES';
    const mid = canonicalConditionKey(
      String(hint?.marketId || fromLookup?.conditionId || fromLookup?.id || '').trim(),
    );

    const open = (market: Market, side: 'YES' | 'NO') => {
      setSelectedMarket(market);
      setSidebarOutcome(side);
      setSidebarOpen(true);
    };

    if (fromLookup) {
      const outcome = getTokenOutcome(tid, marketLookup);
      open(fromLookup as Market, outcome === 'NO' ? 'NO' : sideFromHint);
      return;
    }

    // Expired / off-grid: build selectable stub; enrich YES/NO tokens when condition id known.
    let yes = sideFromHint === 'YES' ? tid : '';
    let no = sideFromHint === 'NO' ? tid : '';
    if (mid) {
      try {
        const toks = await fetchMarketOutcomeTokens(mid);
        if (toks?.tokenIdYes) yes = toks.tokenIdYes;
        if (toks?.tokenIdNo) no = toks.tokenIdNo;
      } catch {
        /* stub with known token only */
      }
    }
    const clobTokenIds = [yes || tid, no].filter(Boolean);
    if (clobTokenIds.length === 1) clobTokenIds.push('');
    const stub: Market = {
      id: mid || tid,
      conditionId: mid || undefined,
      question: (hint?.title || '').trim() || tid,
      eventSlug: hint?.eventSlug || undefined,
      endDate: (hint?.endDate || '').trim(),
      closed: true,
      clobTokenIds,
    };
    open(stub, sideFromHint);
  }, [marketLookup, setSelectedMarket, setSidebarOutcome, setSidebarOpen]);

  const [tab, setTab] = useState<'trades' | 'positions' | 'orders'>(
    (localStorage.getItem(`polymarket-pos-orders-tab-${panelId}`) as 'trades' | 'positions' | 'orders') || 'trades'
  );
  const [tradesSideFilter, setTradesSideFilter] = useState(
    localStorage.getItem('polymarket-trades-side-filter') || 'ALL'
  );
  const [tradesOffset, setTradesOffset] = useState(0);
  const [pagedLedgerTrades, setPagedLedgerTrades] = useState<OnchainMarketTradeRow[]>([]);
  const [tradesTotal, setTradesTotal] = useState(0);
  const [tradesPageLoading, setTradesPageLoading] = useState(false);

  // On-chain TPO trades: server page + optional side (BUY/SELL) so SELL not buried past last 1000 mixed fills.
  useEffect(() => {
    if (liveTradesSource !== 'onchain') return;
    const w = makerAddress.trim().toLowerCase();
    if (!w) {
      setPagedLedgerTrades([]);
      setTradesTotal(0);
      return;
    }
    let cancelled = false;
    setTradesPageLoading(true);
    const side =
      tradesSideFilter === 'BUY' || tradesSideFilter === 'SELL'
        ? tradesSideFilter
        : undefined;
    void fetchOnchainWalletTrades({
      wallet: w,
      side,
      limit: TPO_TRADES_PAGE,
      offset: tradesOffset,
    })
      .then((r) => {
        if (cancelled) return;
        setPagedLedgerTrades(r.trades || []);
        setTradesTotal(Number(r.total) || 0);
      })
      .catch(() => {
        if (cancelled) return;
        setPagedLedgerTrades([]);
        setTradesTotal(0);
      })
      .finally(() => {
        if (!cancelled) setTradesPageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [liveTradesSource, makerAddress, tradesSideFilter, tradesOffset]);

  const pagedTradesAsPM = useMemo(() => ledgerTradesToPM(pagedLedgerTrades), [pagedLedgerTrades]);

  const tradesForTable = useMemo(() => {
    if (liveTradesSource !== 'onchain') return trades;
    // Older pages: REST only. Newest page: merge live WS so new fills appear immediately.
    if (tradesOffset > 0) return pagedTradesAsPM;
    const sideOk = (side: string) =>
      tradesSideFilter === 'ALL' || side === tradesSideFilter;
    const live = onchainTradesAsPM.filter((t) => sideOk(t.side || ''));
    const claims = tradesSideFilter === 'ALL' ? onchainClaimsAsPM : [];
    const seen = new Set<string>();
    const out: Trade[] = [];
    for (const t of [...live, ...pagedTradesAsPM, ...claims]) {
      const k = t.id || `${t.asset_id || t.token_id}:${t.timestamp}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(t);
    }
    return out.sort((a, b) => {
      const ta = parseInt(a.timestamp || '0', 10);
      const tb = parseInt(b.timestamp || '0', 10);
      return tb - ta;
    });
  }, [
    liveTradesSource,
    trades,
    tradesOffset,
    tradesSideFilter,
    pagedTradesAsPM,
    onchainTradesAsPM,
    onchainClaimsAsPM,
  ]);
  const [ordersFilter, setOrdersFilter] = useState(
    localStorage.getItem('polymarket-orders-filter') || 'ALL'
  );
  const [assetFilter, setAssetFilter] = useState(
    localStorage.getItem('polymarket-table-asset-filter') || 'ALL'
  );
  type PosSortCol = 'expiry' | 'size' | 'entry' | 'cost' | 'bid' | 'ask' | 'val' | 'pnl' | 'pnlPct';
  const [posSortCol, setPosSortCol] = useState<PosSortCol>(() => {
    const v = localStorage.getItem(`polymarket-tpo-pos-sort-col-${panelId}`);
    if (v === 'exit') return 'bid';
    if (v === 'pnl' || v === 'pnlPct' || v === 'entry' || v === 'cost' || v === 'bid' || v === 'ask' || v === 'val') return v;
    return 'expiry';
  });
  const [posSortDir, setPosSortDir] = useState<1 | -1>(() => {
    const v = parseInt(localStorage.getItem(`polymarket-tpo-pos-sort-dir-${panelId}`) || '-1', 10);
    return v === 1 ? 1 : -1;
  });

  const togglePosSort = (col: PosSortCol) => {
    if (posSortCol === col) {
      const nd = (posSortDir === 1 ? -1 : 1) as 1 | -1;
      setPosSortDir(nd);
      localStorage.setItem(`polymarket-tpo-pos-sort-dir-${panelId}`, String(nd));
      return;
    }
    setPosSortCol(col);
    setPosSortDir(-1);
    localStorage.setItem(`polymarket-tpo-pos-sort-col-${panelId}`, col);
    localStorage.setItem(`polymarket-tpo-pos-sort-dir-${panelId}`, '-1');
  };

  type OrdSortCol = 'price';
  const [ordSortCol, setOrdSortCol] = useState<OrdSortCol | null>(() => {
    const v = localStorage.getItem(`polymarket-tpo-ord-sort-col-${panelId}`);
    return v === 'price' ? 'price' : null;
  });
  const [ordSortDir, setOrdSortDir] = useState<1 | -1>(() => {
    const v = parseInt(localStorage.getItem(`polymarket-tpo-ord-sort-dir-${panelId}`) || '-1', 10);
    return v === 1 ? 1 : -1;
  });

  const toggleOrdSort = (col: OrdSortCol) => {
    if (ordSortCol === col) {
      const nd = (ordSortDir === 1 ? -1 : 1) as 1 | -1;
      setOrdSortDir(nd);
      localStorage.setItem(`polymarket-tpo-ord-sort-dir-${panelId}`, String(nd));
      return;
    }
    setOrdSortCol(col);
    setOrdSortDir(-1);
    localStorage.setItem(`polymarket-tpo-ord-sort-col-${panelId}`, col);
    localStorage.setItem(`polymarket-tpo-ord-sort-dir-${panelId}`, '-1');
  };

  const handleSetTab = (t: 'trades' | 'positions' | 'orders') => {
    setTab(t);
    localStorage.setItem(`polymarket-pos-orders-tab-${panelId}`, t);
  };

  const [cancellingOrderIds, setCancellingOrderIds] = useState<Set<string>>(new Set());
  const [loggingIn, setLoggingIn] = useState(false);
  const [authEpoch, setAuthEpoch] = useState(0);

  const effectiveEoa = useMemo(
    () => ((signingMode === 'privateKey' && pkAddress ? pkAddress : address) || '').trim().toLowerCase(),
    [signingMode, pkAddress, address],
  );
  const walletConnected = signingMode === 'privateKey' ? !!pkAddress : isConnected && !!address;
  const walletAuthed = useMemo(() => {
    if (!isWebMode) return true;
    if (signingMode === 'privateKey' && pkAddress) return true;
    if (!walletConnected || !effectiveEoa || !makerAddress) return false;
    return hasCredsForWallet(makerAddress, effectiveEoa);
  }, [walletConnected, effectiveEoa, makerAddress, signingMode, pkAddress, pkRevision, authEpoch]);
  const showConnectWallet = isWebMode && !walletConnected;
  const showLogIn =
    isWebMode &&
    walletConnected &&
    !!makerAddress &&
    signingMode !== 'privateKey' &&
    !walletAuthed;

  const handleLogIn = useCallback(async () => {
    if (!makerAddress || loggingIn) return;
    setLoggingIn(true);
    signingDialog.open(true, {
      title: 'Log In',
      signLabel: 'Sign in wallet',
      submitLabel: 'Authenticate',
    });
    try {
      await ensureCredsForWallet(makerAddress);
      signingDialog.setStep('auth', 'done');
      setAuthEpoch((n) => n + 1);
      triggerWalletRefresh();
      setTimeout(() => signingDialog.close(), 600);
    } catch (err) {
      signingDialog.setStep('auth', 'error', err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoggingIn(false);
    }
  }, [makerAddress, loggingIn]);

  const renderEmptyOrAuth = (fallback: ReactNode) => {
    if (showConnectWallet) return <TpoAuthEmpty mode="connect" />;
    if (showLogIn) return <TpoAuthEmpty mode="login" onLogIn={() => void handleLogIn()} loggingIn={loggingIn} />;
    return fallback;
  };

  const handleCancelOrder = async (orderId: string) => {
    setCancellingOrderIds(prev => new Set(prev).add(orderId));
    try {
      const result = await cancelOrder(orderId);
      if (result.success) showToast('Order cancelled', 'success');
      else showToast(result.error || 'Cancel failed', 'error');
    } catch {
      showToast('Cancel failed', 'error');
    } finally {
      setCancellingOrderIds(prev => { const s = new Set(prev); s.delete(orderId); return s; });
    }
  };

  const assets = ['ALL', 'BTC', 'ETH', 'SOL', 'XRP', 'WEATHER'];
  const assetColors: Record<string, string> = { ALL: 'text-white', BTC: 'text-orange-400', ETH: 'text-blue-400', SOL: 'text-purple-400', XRP: 'text-cyan-400', WEATHER: 'text-sky-400' };

  const tabCls = (t: string) =>
    tab === t
      ? 'px-2 py-0.5 rounded text-xs font-bold bg-gray-600 text-white'
      : 'px-2 py-0.5 rounded text-xs font-bold bg-gray-800 text-gray-500 hover:text-gray-300';

  const filterBtnCls = (active: boolean, color: 'green' | 'red' | 'gray') => {
    if (active) {
      if (color === 'green') return 'px-2 py-0.5 rounded-sm text-[9px] font-semibold bg-green-600 text-white shadow-[0_0_8px_rgba(22,163,74,0.35)]';
      if (color === 'red') return 'px-2 py-0.5 rounded-sm text-[9px] font-semibold bg-red-600 text-white shadow-[0_0_8px_rgba(220,38,38,0.35)]';
      return 'px-2 py-0.5 rounded-sm text-[9px] font-semibold bg-gray-500 text-white';
    }
    return 'px-2 py-0.5 rounded-sm text-[9px] font-semibold text-gray-400 hover:text-white hover:bg-gray-700';
  };

  // Process trades
  const processedTrades = useMemo(() => tradesForTable
    .filter((t) => {
      const tid = getTradeClobTokenId(t);
      if (assetFilter !== 'ALL') {
        const market = lookupMarketByTokenId(tid, marketLookup);
        if (market) {
          const asset = extractAssetFromMarket(market);
          if (asset) {
            if (asset !== assetFilter) return false;
          } else if (isWeatherMarket(market)) {
            if (assetFilter !== 'WEATHER') return false;
          } else if (assetFilter !== 'ALL') {
            return false;
          }
        } else if (t.title) {
          if (/temperature in/i.test(t.title)) {
            if (assetFilter !== 'WEATHER') return false;
          } else {
          const m = t.title.match(/\b(BTC|ETH|SOL|XRP)\b/i);
          if (!m || m[1].toUpperCase() !== assetFilter) return false;
          }
        }
      }
      if (tradesSideFilter !== 'ALL' && t.side !== tradesSideFilter) return false;
      return true;
    })
    .map((trade) => {
      const tid = getTradeClobTokenId(trade);
      const market = lookupMarketByTokenId(tid, marketLookup);
      let asset = market ? extractAssetFromMarket(market) || '' : '';
      const tradeFallback = {
        question: trade.title,
        eventSlug: trade.eventSlug || trade.slug,
        endDate: null as string | null,
      };
      const rowDate = resolveTpoRowDate(market, tradeFallback);
      let endDate = rowDate.sortDate;
      let dateLabel = rowDate.display.label;
      let dateColor = rowDate.display.color;
      if (!endDate && trade.timestamp) {
        let tsNum = typeof trade.timestamp === 'string' ? parseInt(trade.timestamp, 10) : (trade.timestamp as number);
        if (tsNum < 1e12) tsNum = tsNum * 1000;
        endDate = new Date(tsNum).toISOString();
        const dd = getDateDisplay(endDate);
        dateLabel = dd.label;
        dateColor = dd.color;
      }
      const marketName = getMarketPriceCondition(null, tid, marketLookup);
      let mktLabel = formatTpoMarketLabel(asset, marketName);
      let outcome = getTokenOutcome(tid, marketLookup) || '';

      // Fallback to activity API fields when market not in lookup (expired markets)
      if (!market && trade.title) {
        // Combine title + eventSlug for better pattern matching (slug has timeframe like "updown-5m")
        const combined = trade.eventSlug ? `${trade.title} ${trade.eventSlug}` : trade.title;
        const shortened = getMarketPriceCondition(combined);
        // Extract asset from full name in title
        const nameMap: Record<string, string> = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', ripple: 'XRP', xrp: 'XRP', btc: 'BTC', eth: 'ETH', sol: 'SOL' };
        const nameMatch = trade.title.match(/\b(Bitcoin|Ethereum|Solana|Ripple|BTC|ETH|SOL|XRP)\b/i);
        if (nameMatch) asset = nameMap[nameMatch[1].toLowerCase()] || nameMatch[1].toUpperCase();
        mktLabel = asset ? `${formatPriceShort(shortened, asset === 'ETH' ? 'ETH' : undefined)}` : shortened;
        if (trade.outcome) {
          const upper = trade.outcome.toUpperCase();
          outcome = upper === 'YES' ? 'YES' : upper === 'NO' ? 'NO' : upper;
        } else if (trade.outcomeIndex !== undefined) {
          outcome = trade.outcomeIndex === 0 ? 'YES' : 'NO';
        }
      }

      const rawPrice = parseFloat(trade.price);
      const price = rawPrice * 100;
      const size = parseFloat(trade.size_filled || trade.size);
      // Detect claims: price=0 and no side (or empty side)
      const isClaim = rawPrice === 0 && !(trade as { side?: string | null }).side;
      const side = isClaim ? 'CLAIM' : trade.side;
      const value = isClaim ? (trade.usdcSize || size) : (trade.usdcSize || rawPrice * size);
      const ts = trade.match_time ?? trade.timestamp ?? trade.created_at ?? trade.matchTime ?? '';
      let timeMs = 0;
      if (ts) {
        let t = typeof ts === 'string' ? parseInt(ts, 10) : ts;
        if (t < 1e12) t = t * 1000;
        timeMs = t;
      }
      const fee = parseFloat(trade.fee || '0');
      const conditionId = market?.conditionId || market?.id || trade.conditionId || trade.market || '';
      const clickable = !!tid && side !== 'CLAIM';
      return {
        tid,
        asset,
        endDate,
        dateLabel: endDate ? dateLabel : '-',
        dateColor: endDate ? dateColor : 'text-gray-400',
        marketName: mktLabel,
        outcome,
        side,
        price,
        size,
        value,
        fee,
        timeMs,
        marketId: conditionId || market?.id,
        title: trade.title || market?.question || '',
        eventSlug: trade.eventSlug || trade.slug || market?.eventSlug || '',
        clickable,
      };
    }), [tradesForTable, assetFilter, tradesSideFilter, marketLookup]);

  // Process positions
  const processedPositions = useMemo(() => positionsForTable
    .filter((p) => {
      if ((p.size || 0) <= 0) return false;
      const tid = getPositionClobTokenId(p);
      if (!tid) return false;
      if (assetFilter === 'ALL') return true;
      const market = lookupMarketByTokenId(tid, marketLookup);
      if (market) {
        const asset = extractAssetFromMarket(market);
        if (asset) return asset === assetFilter;
        if (isWeatherMarket(market)) return assetFilter === 'WEATHER';
        return false;
      }
      const uA = normalizeDbUnderlying(p.underlyingAsset);
      if (uA && uA === assetFilter) return true;
      if (p.title) {
        if (/temperature in/i.test(p.title)) return assetFilter === 'WEATHER';
        const m = p.title.match(/\b(BTC|ETH|SOL|XRP)\b/i);
        if (m) return m[1].toUpperCase() === assetFilter;
        const nameMap: Record<string, string> = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', ripple: 'XRP' };
        const nm = p.title.match(/\b(Bitcoin|Ethereum|Solana|Ripple)\b/i);
        if (nm) return (nameMap[nm[1].toLowerCase()] || '') === assetFilter;
      }
      return true;
    })
    .map((pos) => {
      const tid = getPositionClobTokenId(pos);
      const market = lookupMarketByTokenId(tid, marketLookup);
      let asset = market ? extractAssetFromMarket(market) || '' : normalizeDbUnderlying(pos.underlyingAsset);
      const posFallback = {
        question: pos.title,
        eventSlug: pos.eventSlug || pos.slug,
        endDate: pos.endDate || null,
      };
      const rowDate = resolveTpoRowDate(market, posFallback);
      const endDate = rowDate.sortDate;
      const marketName = getMarketPriceCondition(null, tid, marketLookup);
      let mktLabel = formatTpoMarketLabel(asset, marketName);
      let outcome = getTokenOutcome(tid, marketLookup) || '';
      if (!market && (pos.title || pos.slug || pos.outcome || pos.outcomeIndex !== undefined || pos.underlyingAsset)) {
        if (pos.title) {
          const combined = pos.eventSlug ? `${pos.title} ${pos.eventSlug}` : pos.title;
          const shortened = getMarketPriceCondition(combined);
          const nameMap: Record<string, string> = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', ripple: 'XRP', xrp: 'XRP', btc: 'BTC', eth: 'ETH', sol: 'SOL' };
          const nameMatch = pos.title.match(/\b(Bitcoin|Ethereum|Solana|Ripple|BTC|ETH|SOL|XRP)\b/i);
          if (nameMatch) asset = asset || nameMap[nameMatch[1].toLowerCase()] || nameMatch[1].toUpperCase();
          mktLabel = formatTpoMarketLabel(asset, shortened);
        } else if (pos.slug) {
          mktLabel = formatTpoMarketLabel(asset, pos.slug);
        }
        if (pos.outcome) {
          const upper = pos.outcome.toUpperCase();
          outcome = upper === 'YES' ? 'YES' : upper === 'NO' ? 'NO' : upper;
        } else if (pos.outcomeIndex !== undefined) {
          outcome = pos.outcomeIndex === 0 ? 'YES' : 'NO';
        }
      }

      const size = pos.size || 0;
      const avg = pos.avgPrice || 0;
      const { bid: bidProb, ask: askProb } = outcomeBidAskProb(tid, liveQuoteLookup);
      const cur = bidProb ?? 0;
      const mid =
        bidProb == null || bidProb === 0
          ? 0
          : askProb != null
            ? (bidProb + askProb) / 2
            : bidProb;
      const entryPrice = avg * 100;
      const cost = avg * size;
      const currentValue = mid * size;
      const currentPrice = cur * 100;
      const pnl = currentValue - cost;
      const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0;
      const sellPrice = sellOrderPriceByToken.get(normalizeClobTokenId(tid)) ?? null;
      const conditionId = market?.conditionId || market?.id || pos.conditionId || pos.market || '';
      const clickable = !!tid;
      return {
        tid,
        asset,
        endDate,
        dateLabel: endDate ? rowDate.display.label : '-',
        dateColor: endDate ? rowDate.display.color : 'text-gray-400',
        marketName: mktLabel,
        outcome,
        size,
        entryPrice,
        cost,
        currentPrice,
        currentValue,
        bidProb,
        askProb,
        sellPrice,
        pnl,
        pnlPercent,
        marketId: conditionId || market?.id || pos.market,
        title: pos.title || market?.question || '',
        eventSlug: pos.eventSlug || pos.slug || market?.eventSlug || '',
        clickable,
      };
    }), [positionsForTable, assetFilter, marketLookup, liveQuoteLookup, sellOrderPriceByToken]);

  const displayPositions = useMemo(() => {
    const rows = [...processedPositions];
    if (posSortCol === 'size') {
      return rows.sort((a, b) => (a.size - b.size) * posSortDir);
    }
    if (posSortCol === 'entry') {
      return rows.sort((a, b) => (a.entryPrice - b.entryPrice) * posSortDir);
    }
    if (posSortCol === 'cost') {
      return rows.sort((a, b) => (a.cost - b.cost) * posSortDir);
    }
    if (posSortCol === 'bid') {
      return rows.sort((a, b) => (a.currentPrice - b.currentPrice) * posSortDir);
    }
    if (posSortCol === 'ask') {
      return rows.sort((a, b) => ((a.askProb ?? 0) - (b.askProb ?? 0)) * posSortDir);
    }
    if (posSortCol === 'val') {
      return rows.sort((a, b) => (a.currentValue - b.currentValue) * posSortDir);
    }
    if (posSortCol === 'pnl') {
      return rows.sort((a, b) => (a.pnl - b.pnl) * posSortDir);
    }
    if (posSortCol === 'pnlPct') {
      return rows.sort((a, b) => (a.pnlPercent - b.pnlPercent) * posSortDir);
    }
    return rows.sort((a, b) => {
      const cmp = comparePositionsByExpiryDesc(a, b);
      return posSortDir === -1 ? cmp : -cmp;
    });
  }, [processedPositions, posSortCol, posSortDir]);

  // Process orders — no live quote dep (5k orders × quote ticks freezes UI).
  const processedOrders = useMemo(() => {
    const fullLookup = useAppStore.getState().marketLookup;
    return orders
      .filter((o) => {
        const tid = getOrderClobTokenId(o);
        if (assetFilter !== 'ALL') {
          const market = lookupMarketByTokenId(tid, fullLookup);
          if (!market) return true;
          const asset = extractAssetFromMarket(market);
          if (asset) {
            if (asset !== assetFilter) return false;
          } else if (isWeatherMarket(market)) {
            if (assetFilter !== 'WEATHER') return false;
          } else {
            return false;
          }
        }
        if (ordersFilter !== 'ALL' && o.side !== ordersFilter) return false;
        return true;
      })
      .map((order) => {
        const tid = getOrderClobTokenId(order);
        const market = lookupMarketByTokenId(tid, fullLookup);
        let asset = market ? extractAssetFromMarket(market) || '' : '';
        const rowDate = resolveTpoRowDate(market, { question: order.outcome, eventSlug: market?.eventSlug, endDate: market?.endDate ?? null });
        const endDate = rowDate.sortDate;
        const marketName = getMarketPriceCondition(null, tid, fullLookup);
        const mktLabel = formatTpoMarketLabel(asset, marketName);
        const outcome = getTokenOutcome(tid, fullLookup) || '';
        const price = parseFloat(order.price) * 100;
        const size = parseFloat(order.original_size || order.size);
        const filled = parseFloat(order.size_matched || '0');
        const value = parseFloat(order.price) * size;
        return {
          id: order.id,
          tid,
          asset,
          endDate,
          dateLabel: endDate ? rowDate.display.label : '-',
          dateColor: endDate ? rowDate.display.color : 'text-gray-400',
          isWeather: rowDate.isWeather,
          marketName: mktLabel,
          outcome,
          side: order.side,
          price,
          size,
          filled,
          value,
          marketId: market?.id,
        };
      });
  }, [orders, assetFilter, ordersFilter]);

  const displayOrders = useMemo(() => {
    if (ordSortCol !== 'price') return processedOrders;
    return [...processedOrders].sort((a, b) => (a.price - b.price) * ordSortDir);
  }, [processedOrders, ordSortCol, ordSortDir]);

  const displayTrades = processedTrades;

  // Position totals
  const { totalSize, totalCost, totalValue, totalPnl, avgEntry, avgExit, avgPnlPct } = useMemo(() => {
    const totalSize = processedPositions.reduce((s, p) => s + p.size, 0);
    const totalCost = processedPositions.reduce((s, p) => s + p.cost, 0);
    const totalValue = processedPositions.reduce((s, p) => s + p.currentValue, 0);
    const totalPnl = totalValue - totalCost;
    return {
      totalSize,
      totalCost,
      totalValue,
      totalPnl,
      avgEntry: totalSize > 0 ? (totalCost / totalSize) * 100 : 0,
      avgExit: totalSize > 0 ? (totalValue / totalSize) * 100 : 0,
      avgPnlPct: totalCost > 0 ? (totalPnl / totalCost) * 100 : 0,
    };
  }, [processedPositions]);
  const tPnlColor = totalPnl >= 0 ? 'text-green-400' : 'text-red-400';
  const tPnlSign = totalPnl >= 0 ? '+' : '';

  const hCls = 'text-gray-500 py-1 px-1 whitespace-nowrap truncate max-w-0';
  const hSortCls = `${hCls} cursor-pointer hover:text-white select-none no-drag`;
  const nHCls = 'text-gray-500 py-1 px-1 whitespace-nowrap';
  const nHSortCls = `${nHCls} cursor-pointer hover:text-white select-none no-drag`;
  const cCls = 'py-1 px-1 whitespace-nowrap truncate';
  const nCls = 'py-1 px-1 whitespace-nowrap';
  const posSortArrow = (col: PosSortCol) =>
    posSortCol === col ? (posSortDir === 1 ? ' ▲' : ' ▼') : '';
  const ordSortArrow = (col: OrdSortCol) =>
    ordSortCol === col ? (ordSortDir === 1 ? ' ▲' : ' ▼') : '';

  // Pixel cols + minWidth: table scrolls horizontally on mobile instead of overlapping.
  const TR_MIN_W = 572;
  const POS_MIN_W = 716;
  const ORD_MIN_W = 556;
  const trColgroup = (
    <colgroup>
      <col style={{ width: 44 }} />
      <col style={{ width: 56 }} />
      <col style={{ width: 140 }} />
      <col style={{ width: 44 }} />
      <col style={{ width: 32 }} />
      <col style={{ width: 52 }} />
      <col style={{ width: 48 }} />
      <col style={{ width: 56 }} />
      <col style={{ width: 48 }} />
      <col style={{ width: 52 }} />
    </colgroup>
  );
  const posColgroup = (
    <colgroup>
      <col style={{ width: 40 }} />
      <col style={{ width: 52 }} />
      <col style={{ width: 120 }} />
      <col style={{ width: 28 }} />
      <col style={{ width: 52 }} />
      <col style={{ width: 48 }} />
      <col style={{ width: 60 }} />
      <col style={{ width: 48 }} />
      <col style={{ width: 48 }} />
      <col style={{ width: 48 }} />
      <col style={{ width: 60 }} />
      <col style={{ width: 60 }} />
      <col style={{ width: 52 }} />
    </colgroup>
  );
  const ordColgroup = (
    <colgroup>
      <col style={{ width: 44 }} />
      <col style={{ width: 56 }} />
      <col style={{ width: 140 }} />
      <col style={{ width: 44 }} />
      <col style={{ width: 32 }} />
      <col style={{ width: 48 }} />
      <col style={{ width: 52 }} />
      <col style={{ width: 52 }} />
      <col style={{ width: 56 }} />
      <col style={{ width: 32 }} />
    </colgroup>
  );

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0 min-w-0">
      <div className="panel-header flex min-w-0 items-center gap-1 mb-2 cursor-grab">
        <span className="shrink-0 text-[10px] font-bold text-gray-500 select-none">TPO</span>
        <div className="no-drag flex min-w-0 flex-1 flex-wrap items-center gap-1">
          <button onClick={() => handleSetTab('positions')} className={tabCls('positions')}>
            Positions <span className="text-xs text-gray-500">({processedPositions.length})</span>
          </button>
          <button onClick={() => handleSetTab('orders')} className={tabCls('orders')}>
            Orders <span className="text-xs text-gray-500">({processedOrders.length})</span>
          </button>
          <button onClick={() => handleSetTab('trades')} className={tabCls('trades')}>
            Trades{' '}
            <span className="text-xs text-gray-500">
              ({liveTradesSource === 'onchain' ? tradesTotal : processedTrades.length})
            </span>
          </button>

          {tab === 'trades' && (
            <div className="flex gap-1 items-center flex-wrap">
              <div className="inline-flex items-center gap-0.5 rounded-md bg-gray-900 border border-gray-700 p-0.5 text-[9px]">
                {(['ALL', 'BUY', 'SELL'] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setTradesSideFilter(s);
                      setTradesOffset(0);
                      localStorage.setItem('polymarket-trades-side-filter', s);
                    }}
                    className={filterBtnCls(tradesSideFilter === s, s === 'BUY' ? 'green' : s === 'SELL' ? 'red' : 'gray')}
                  >{s}</button>
                ))}
              </div>
              <select value={assetFilter} onChange={(e) => { setAssetFilter(e.target.value); localStorage.setItem('polymarket-table-asset-filter', e.target.value); }}
                className={`bg-gray-700 text-[9px] font-bold rounded px-1 py-0.5 border border-gray-600 ${assetColors[assetFilter]}`} style={{ outline: 'none' }}>
                {assets.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
              {liveTradesSource === 'onchain' && (
                <div className="inline-flex items-center gap-0.5 rounded-md bg-gray-900 border border-gray-700 p-0.5 text-[9px] text-gray-400">
                  <button
                    type="button"
                    disabled={tradesOffset <= 0 || tradesPageLoading}
                    onClick={() => setTradesOffset((o) => Math.max(0, o - TPO_TRADES_PAGE))}
                    className="px-1.5 py-0.5 rounded-sm font-semibold hover:text-white hover:bg-gray-700 disabled:opacity-40 disabled:pointer-events-none"
                    title="Newer fills"
                  >Newer</button>
                  <span className="px-1 tabular-nums whitespace-nowrap">
                    {tradesTotal === 0
                      ? '0'
                      : `${tradesOffset + 1}–${Math.min(tradesOffset + TPO_TRADES_PAGE, tradesTotal)} / ${tradesTotal}`}
                  </span>
                  <button
                    type="button"
                    disabled={tradesOffset + TPO_TRADES_PAGE >= tradesTotal || tradesPageLoading}
                    onClick={() => setTradesOffset((o) => o + TPO_TRADES_PAGE)}
                    className="px-1.5 py-0.5 rounded-sm font-semibold hover:text-white hover:bg-gray-700 disabled:opacity-40 disabled:pointer-events-none"
                    title="Older fills"
                  >Older</button>
                </div>
              )}
            </div>
          )}

          {tab === 'positions' && (
            <select value={assetFilter} onChange={(e) => { setAssetFilter(e.target.value); localStorage.setItem('polymarket-table-asset-filter', e.target.value); }}
              className={`bg-gray-700 text-[9px] font-bold rounded px-1 py-0.5 border border-gray-600 ${assetColors[assetFilter]}`} style={{ outline: 'none' }}>
              {assets.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}

          {tab === 'orders' && (
            <div className="flex gap-1 items-center">
              <div className="inline-flex items-center gap-0.5 rounded-md bg-gray-900 border border-gray-700 p-0.5 text-[9px]">
                {(['ALL', 'BUY', 'SELL'] as const).map((s) => (
                  <button key={s} onClick={() => { setOrdersFilter(s); localStorage.setItem('polymarket-orders-filter', s); }}
                    className={filterBtnCls(ordersFilter === s, s === 'BUY' ? 'green' : s === 'SELL' ? 'red' : 'gray')}>{s}</button>
                ))}
              </div>
              <select value={assetFilter} onChange={(e) => { setAssetFilter(e.target.value); localStorage.setItem('polymarket-table-asset-filter', e.target.value); }}
                className={`bg-gray-700 text-[9px] font-bold rounded px-1 py-0.5 border border-gray-600 ${assetColors[assetFilter]}`} style={{ outline: 'none' }}>
                {assets.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}
        </div>
        <span className="min-w-6 w-6 shrink-0 self-stretch cursor-grab" aria-hidden />
        {liveTradesSource === 'onchain' && (
          <span className="text-[9px] font-bold text-purple-300/90 shrink-0" title="Positions & trades from backend rollups (wallet_market_positions / wallet_fill_ledger)">
            CHAIN
          </span>
        )}
      </div>

      <div className="panel-body text-[10px] flex-1 min-h-0 min-w-0 flex flex-col">
        {/* Trades */}
        {tab === 'trades' && (
          liveTradesSource === 'onchain' && tradesPageLoading && processedTrades.length === 0 ? (
            <div className="text-purple-300/90 text-center py-4">Loading on-chain trades…</div>
          ) : onchainTradesLoading && liveTradesSource === 'onchain' && processedTrades.length === 0 && !makerAddress.trim() ? (
            <div className="text-purple-300/90 text-center py-4">Loading on-chain trades…</div>
          ) : processedTrades.length === 0 ? (
            renderEmptyOrAuth(
              <div className="text-gray-500 text-center py-4">
                {liveTradesSource === 'onchain' && tradesTotal > 0
                  ? 'No trades on this page — try Older / Newer'
                  : 'No trades'}
              </div>,
            )
          ) : (<div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-hidden">
            <div className="flex flex-col flex-1 min-h-0 w-full" style={{ minWidth: TR_MIN_W }}>
            {/* Fixed header */}
            <table className="w-full text-[10px] table-fixed" style={{ minWidth: TR_MIN_W }}>{trColgroup}<thead><tr className="text-gray-500 border-b border-gray-700">
              <th className={`${hCls} text-left`}>Asset</th>
              <th className={`${nHCls} text-left`}>Date</th>
              <th className={`${hCls} text-left`}>Market</th>
              <th className={`${hCls} text-left`}>Side</th>
              <th className={`${hCls} text-left`}>Y/N</th>
              <th className={`${nHCls} text-right`}>Size</th>
              <th className={`${nHCls} text-right`}>Price</th>
              <th className={`${nHCls} text-right`}>Value</th>
              <th className={`${nHCls} text-right`}>Fee</th>
              <th className={`${nHCls} text-right`}>Time</th>
            </tr></thead></table>
            <TpoVirtualTableBody count={displayTrades.length} colgroup={trColgroup} minWidth={TR_MIN_W}>
              {(i) => {
                const t = displayTrades[i];
                const ageMs = t.timeMs > 0 ? Date.now() - t.timeMs : Infinity;
                const timeColor = ageMs < 15 * 60000 ? 'text-green-400' : ageMs < 60 * 60000 ? 'text-yellow-400' : 'text-gray-400';
                return (
                  <tr
                    key={i}
                    className={`border-b border-gray-700/50 hover:bg-gray-800/50 ${t.clickable ? 'cursor-pointer' : 'opacity-70'} ${selectedMarketId === t.marketId ? 'bg-blue-900/40' : ''}`}
                    onClick={() => t.clickable && void handleMarketClick(t.tid, {
                      marketId: t.marketId,
                      title: t.title,
                      eventSlug: t.eventSlug,
                      endDate: t.endDate,
                      outcome: t.outcome,
                    })}
                  >
                    <td className={`${cCls} ${assetColorMap[t.asset] || 'text-gray-400'} font-bold`}>{t.asset}</td>
                    <td className={`${nCls} ${t.dateColor}`}>{t.dateLabel}</td>
                    <td className={`${cCls} ${assetColorMap2[t.asset] || 'text-gray-300'}`}>{t.marketName}</td>
                    <td className={`${cCls} font-bold ${
                      t.side === 'BUY' ? 'text-green-400'
                        : t.side === 'CLAIM' || t.side === 'REDEEM' ? 'text-blue-400'
                          : t.side === 'SPLIT' ? 'text-purple-400'
                            : t.side === 'MERGE' ? 'text-amber-400'
                              : 'text-red-400'
                    }`}>{t.side}</td>
                    <td className={`${cCls} font-bold ${t.outcome === 'YES' || t.outcome === 'UP' ? 'text-green-300' : 'text-red-300'}`}>{t.outcome || '-'}</td>
                    <td className={`${nCls} text-right`}>{t.side === 'CLAIM' ? '—' : <TpoColorCodedSize value={Math.round(t.size)} />}</td>
                    <td className={`${nCls} text-right text-gray-300`}>{t.side === 'CLAIM' ? '—' : `${t.price.toFixed(1)}¢`}</td>
                    <td className={`${nCls} text-right ${t.side === 'CLAIM' ? 'text-blue-300 font-bold' : 'text-gray-300'}`}>${t.value.toFixed(2)}</td>
                    <td className={`${nCls} text-right text-yellow-400/80`}>{t.fee > 0 ? `$${t.fee.toFixed(2)}` : '-'}</td>
                    <td className={`${nCls} text-right ${timeColor}`}>{t.timeMs > 0 ? formatElapsed(t.timeMs) : ''}</td>
                  </tr>
                );
              }}
            </TpoVirtualTableBody>
            </div>
          </div>)
        )}

        {/* Positions */}
        {tab === 'positions' && (
          onchainPositionsLoading && liveTradesSource === 'onchain' && positionsForTable.length === 0 ? (
            <div className="text-purple-300/90 text-center py-4">Loading on-chain positions…</div>
          ) : processedPositions.length === 0 ? (
            renderEmptyOrAuth(
              <div className="text-gray-500 text-center py-4">
                {liveTradesSource === 'onchain'
                  ? 'No on-chain positions for known tokens'
                  : 'No positions'}
              </div>,
            )
          ) : (<div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-hidden">
            <div className="flex flex-col flex-1 min-h-0 w-full" style={{ minWidth: POS_MIN_W }}>
            {/* Fixed header */}
            <table className="w-full text-[10px] table-fixed" style={{ minWidth: POS_MIN_W }}>{posColgroup}<thead><tr className="text-gray-500 border-b border-gray-700">
              <th className={`${hCls} text-left`}>Asset</th>
              <th
                className={`${nHSortCls} text-left`}
                onClick={() => togglePosSort('expiry')}
                title="Sort by expiry date"
              >
                Date{posSortArrow('expiry')}
              </th>
              <th className={`${hCls} text-left`}>Market</th>
              <th className={`${hCls} text-left`}>Y/N</th>
              <th
                className={`${nHSortCls} text-right`}
                onClick={() => togglePosSort('size')}
                title="Sort by size"
              >
                Size{posSortArrow('size')}
              </th>
              <th
                className={`${nHSortCls} text-right`}
                onClick={() => togglePosSort('entry')}
                title="Sort by entry price"
              >
                Entry{posSortArrow('entry')}
              </th>
              <th
                className={`${nHSortCls} text-right`}
                onClick={() => togglePosSort('cost')}
                title="Sort by cost"
              >
                Cost{posSortArrow('cost')}
              </th>
              <th
                className={`${nHSortCls} text-right`}
                onClick={() => togglePosSort('bid')}
                title="Sort by bid"
              >
                Bid{posSortArrow('bid')}
              </th>
              <th
                className={`${nHSortCls} text-right`}
                onClick={() => togglePosSort('ask')}
                title="Sort by ask"
              >
                Ask{posSortArrow('ask')}
              </th>
              <th className={`${nHCls} text-right`} title="Resting sell limit price">
                Sell
              </th>
              <th
                className={`${nHSortCls} text-right`}
                onClick={() => togglePosSort('val')}
                title="Sort by position value"
              >
                Val{posSortArrow('val')}
              </th>
              <th
                className={`${nHSortCls} text-right`}
                onClick={() => togglePosSort('pnl')}
                title="Sort by PnL $"
              >
                PnL${posSortArrow('pnl')}
              </th>
              <th
                className={`${nHSortCls} text-right`}
                onClick={() => togglePosSort('pnlPct')}
                title="Sort by PnL %"
              >
                PnL%{posSortArrow('pnlPct')}
              </th>
            </tr></thead></table>
            <TpoVirtualTableBody count={displayPositions.length} colgroup={posColgroup} minWidth={POS_MIN_W}>
              {(i) => {
                const p = displayPositions[i];
                const pnlColor = p.pnl >= 0 ? 'text-green-400' : 'text-red-400';
                const pnlSign = p.pnl >= 0 ? '+' : '-';
                const exitColor = POSITION_BID_EXIT_TAILWIND[positionBidExitTier(p.entryPrice, p.currentPrice)];
                const hasBid = p.bidProb != null && Number.isFinite(p.bidProb) && p.bidProb > 0;
                return (
                  <tr
                    key={p.tid}
                    className={`border-b border-gray-700/50 hover:bg-gray-800/50 ${p.clickable ? 'cursor-pointer' : 'opacity-70'} ${selectedMarketId === p.marketId ? 'bg-blue-900/40' : ''}`}
                    onClick={() => p.clickable && void handleMarketClick(p.tid, {
                      marketId: p.marketId,
                      title: p.title,
                      eventSlug: p.eventSlug,
                      endDate: p.endDate,
                      outcome: p.outcome,
                    })}
                  >
                    <td className={`${cCls} ${assetColorMap[p.asset] || 'text-gray-400'} font-bold`}>{p.asset}</td>
                    <td className={`${nCls} ${p.dateColor}`}>{p.dateLabel}</td>
                    <td className={`${cCls} ${assetColorMap2[p.asset] || 'text-gray-300'}`}>{p.marketName}</td>
                    <td className={`${cCls} font-bold ${p.outcome === 'YES' || p.outcome === 'UP' ? 'text-green-300' : 'text-red-300'}`}>{p.outcome || '-'}</td>
                    <td className={`${nCls} text-right`}><TpoColorCodedSize value={Math.floor(p.size)} /></td>
                    <td className={`${nCls} text-right text-gray-300`}>{p.entryPrice.toFixed(1)}¢</td>
                    <td className={`${nCls} text-right text-red-400`}>-${p.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className={`${nCls} text-right ${hasBid ? exitColor : 'text-gray-400'}`}>
                      {hasBid ? `${p.currentPrice.toFixed(1)}¢` : '-'}
                    </td>
                    <td className={`${nCls} text-right text-red-300/90`}>{formatQuoteCents(p.askProb)}</td>
                    <td
                      className={`${nCls} text-right ${p.sellPrice == null ? 'text-gray-400' : ''}`}
                      style={p.sellPrice != null ? positionSellPriceColorStyle(p.currentPrice, p.sellPrice) : undefined}
                    >
                      {p.sellPrice != null ? `${p.sellPrice.toFixed(1)}¢` : '-'}
                    </td>
                    <td className={`${nCls} text-right text-gray-300`}>${p.currentValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className={`${nCls} text-right ${pnlColor} font-bold`}>{pnlSign}${Math.abs(p.pnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                    <td className={`${nCls} text-right ${pnlColor} font-bold`}>{pnlSign}{Math.round(Math.abs(p.pnlPercent))}%</td>
                  </tr>
                );
              }}
            </TpoVirtualTableBody>
            {/* Fixed footer */}
            <table className="w-full text-[10px] table-fixed" style={{ minWidth: POS_MIN_W }}>{posColgroup}<tbody>
              <tr className="border-t-2 border-gray-600 font-bold">
                <td className={`${cCls} text-white`}>Total</td>
                <td className={cCls}></td><td className={cCls}></td><td className={cCls}></td>
                <td className={`${nCls} text-right`}><TpoColorCodedSize value={Math.floor(totalSize)} /></td>
                <td className={`${nCls} text-right text-gray-400`}>{avgEntry.toFixed(1)}¢</td>
                <td className={`${nCls} text-right text-red-400`}>-${totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className={`${nCls} text-right text-gray-400`}>{avgExit.toFixed(1)}¢</td>
                <td className={cCls}></td>
                <td className={cCls}></td>
                <td className={`${nCls} text-right text-white`}>${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className={`${nCls} text-right ${tPnlColor} font-bold`}>{tPnlSign}${Math.abs(totalPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className={`${nCls} text-right ${tPnlColor} font-bold`}>{tPnlSign}{Math.round(Math.abs(avgPnlPct))}%</td>
              </tr>
            </tbody></table>
            </div>
          </div>)
        )}

        {/* Orders */}
        {tab === 'orders' && (
          processedOrders.length === 0 ? (
            renderEmptyOrAuth(<div className="text-gray-500 text-center py-4">No open orders</div>)
          ) : (<div className="flex flex-col flex-1 min-h-0 min-w-0 overflow-x-auto overflow-y-hidden">
            <div className="flex flex-col flex-1 min-h-0 w-full" style={{ minWidth: ORD_MIN_W }}>
            {/* Fixed header */}
            <table className="w-full text-[10px] table-fixed" style={{ minWidth: ORD_MIN_W }}>{ordColgroup}<thead><tr className="text-gray-500 border-b border-gray-700">
              <th className={`${hCls} text-left`}>Asset</th>
              <th className={`${nHCls} text-left`}>Date</th>
              <th className={`${hCls} text-left`}>Market</th>
              <th className={`${hCls} text-left`}>Side</th>
              <th className={`${hCls} text-left`}>Y/N</th>
              <th
                className={`${nHSortCls} text-right`}
                onClick={() => toggleOrdSort('price')}
                title="Sort by price"
              >
                Price{ordSortArrow('price')}
              </th>
              <th className={`${nHCls} text-right`}>Size</th>
              <th className={`${nHCls} text-right`}>Filled</th>
              <th className={`${nHCls} text-right`}>Value</th>
              <th className={`${nHCls} text-center`}></th>
            </tr></thead></table>
            <TpoVirtualTableBody count={displayOrders.length} colgroup={ordColgroup} minWidth={ORD_MIN_W}>
              {(i) => {
                const o = displayOrders[i];
                const dd = o.isWeather
                  ? { label: o.dateLabel, color: o.dateColor }
                  : getTimeLeftDisplay(o.endDate);
                return (
                  <tr key={o.id} className={`border-b border-gray-700/50 hover:bg-gray-800/50 ${selectedMarketId === o.marketId ? 'bg-blue-900/40' : ''}`}>
                    <td className={`${cCls} ${assetColorMap[o.asset] || 'text-gray-400'} font-bold`}>{o.asset}</td>
                    <td className={`${nCls} ${dd.color}`}>{dd.label}</td>
                    <td
                      className={`${cCls} ${assetColorMap2[o.asset] || 'text-gray-300'} cursor-pointer hover:underline`}
                      onClick={() => void handleMarketClick(o.tid)}
                    >{o.marketName}</td>
                    <td className={`${cCls} font-bold ${o.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{o.side}</td>
                    <td className={`${cCls} font-bold ${o.outcome === 'YES' ? 'text-green-300' : 'text-red-300'}`}>{o.outcome || '-'}</td>
                    <td className={`${nCls} text-right text-white`}>{o.price.toFixed(1)}¢</td>
                    <td className={`${nCls} text-right`}><TpoColorCodedSize value={Math.round(o.size)} /></td>
                    <td className={`${nCls} text-right text-gray-500`}>{Math.round(o.filled).toLocaleString()}</td>
                    <td className={`${nCls} text-right text-gray-300`}>${Math.round(o.value).toLocaleString()}</td>
                    <td className={`${nCls} text-center`}>
                      <button
                        onClick={() => !cancellingOrderIds.has(o.id) && handleCancelOrder(o.id)}
                        disabled={cancellingOrderIds.has(o.id)}
                        className="w-4 h-4 rounded-sm inline-flex items-center justify-center bg-red-600 hover:bg-red-500 disabled:bg-red-600/50"
                        title="Cancel order"
                      >{cancellingOrderIds.has(o.id) ? <span className="cancel-spinner"/> : <span className="text-black text-[10px] font-bold leading-none">✕</span>}</button>
                    </td>
                  </tr>
                );
              }}
            </TpoVirtualTableBody>
            </div>
          </div>)
        )}
      </div>
    </div>
  );
}

export const TradesPositionsOrders = memo(TradesPositionsOrdersInner);
