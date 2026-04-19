import { useState, useCallback, useEffect, useMemo } from 'react';
import { useAppStore } from '../../stores/appStore';
import {
  cancelOrder,
  fetchWalletPositions,
  fetchOnchainMarketPositions,
  fetchOnchainMarketTrades,
  // fetchOnchainClaims,
  type OnchainMarketPositionRow,
  type OnchainMarketTradeRow,
  type OnchainClaimRow,
} from '../../api';
import { outcomeMidOrOneSideProb } from '../../lib/outcomeQuote';
import type { Position, Trade } from '../../types';
import { showToast } from '../../utils/toast';
import { getMarketPriceCondition, getTokenOutcome, getTradeClobTokenId, getOrderClobTokenId, getPositionClobTokenId, extractAssetFromMarket, formatPriceShort, ASSET_COLORS as assetColorMap2 } from '../../utils/format';
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

function getDateDisplay(endDate: string | null): { label: string; color: string } {
  if (!endDate) return { label: '-', color: 'text-gray-400' };
  const dt = new Date(endDate);
  const hoursLeft = (dt.getTime() - Date.now()) / (1000 * 60 * 60);
  const isToday = hoursLeft > 0 && hoursLeft < 24;
  const isTmr = !isToday && hoursLeft > 0 && hoursLeft < 48;
  const dayAbbr = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dt.getDay()];
  if (isToday) return { label: 'TODAY', color: 'text-red-400 font-bold' };
  if (isTmr) return { label: 'TMR', color: 'text-yellow-400 font-bold' };
  return { label: `${dayAbbr} ${dt.getDate()}`, color: 'text-gray-400' };
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

export function TradesPositionsOrders({ panelId }: { panelId: string }) {
  const positions = useAppStore((s) => s.positions);
  const orders = useAppStore((s) => s.orders);
  const trades = useAppStore((s) => s.trades);
  const marketLookup = useAppStore((s) => s.marketLookup);
  const bidAskTick = useAppStore((s) => s.bidAskTick);
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const makerAddress = useAppStore((s) => s.makerAddress);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);

  const [onchainPosRows, setOnchainPosRows] = useState<OnchainMarketPositionRow[]>([]);
  const [onchainTrRows, setOnchainTrRows] = useState<OnchainMarketTradeRow[]>([]);
  const [onchainClaimRows, setOnchainClaimRows] = useState<OnchainClaimRow[]>([]);
  const [onchainLoading, setOnchainLoading] = useState(false);

  const polymarketTokenKey = useMemo(() => {
    const s = new Set<string>();
    for (const p of positions) {
      const tid = getPositionClobTokenId(p);
      if (tid) s.add(tid);
    }
    for (const o of orders) {
      const t = o.asset_id || o.token_id;
      if (t) s.add(t);
    }
    for (const t of trades) {
      const id = t.asset_id || t.asset || t.token_id;
      if (id) s.add(id);
    }
    return Array.from(s).sort().join(',');
  }, [positions, orders, trades]);

  useEffect(() => {
    if (liveTradesSource !== 'onchain' || !makerAddress) {
      setOnchainPosRows([]);
      setOnchainTrRows([]);
      setOnchainClaimRows([]);
      setOnchainLoading(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setOnchainLoading(true);
      try {
        const walletRes = await fetchWalletPositions({
          wallet: makerAddress,
          limit: 500,
          active_only: true,
          ledger: true,
        });
        const idSet = new Set<string>();
        for (const wp of walletRes.positions || []) {
          if (wp.tokenIdYes) idSet.add(wp.tokenIdYes);
          if (wp.tokenIdNo) idSet.add(wp.tokenIdNo);
        }
        for (const p of positions) {
          const tid = getPositionClobTokenId(p);
          if (tid) idSet.add(tid);
        }
        for (const o of orders) {
          const t = o.asset_id || o.token_id;
          if (t) idSet.add(t);
        }
        for (const t of trades) {
          const id = t.asset_id || t.asset || t.token_id;
          if (id) idSet.add(id);
        }
        const token_ids = Array.from(idSet).filter(Boolean);
        if (token_ids.length === 0) {
          if (!cancelled) {
            setOnchainPosRows([]);
            setOnchainTrRows([]);
          }
          return;
        }
        const [pr, tr] = await Promise.all([
          fetchOnchainMarketPositions({ token_ids, wallet: makerAddress }),
          fetchOnchainMarketTrades({ token_ids, wallet: makerAddress, limit: 500 }),
          // fetchOnchainClaims({ wallet: makerAddress, limit: 200 }),
        ]);
        if (!cancelled) {
          setOnchainPosRows(pr.positions || []);
          setOnchainTrRows(tr.trades || []);
          setOnchainClaimRows([]);
        }
      } catch {
        if (!cancelled) {
          setOnchainPosRows([]);
          setOnchainTrRows([]);
          setOnchainClaimRows([]);
        }
      } finally {
        if (!cancelled) setOnchainLoading(false);
      }
    };
    void load();
    const iv = window.setInterval(load, 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, [liveTradesSource, makerAddress, polymarketTokenKey, positions, orders, trades]);

  const onchainPositionsAsPM = useMemo((): Position[] => {
    return onchainPosRows.map((r) => {
      const m = marketLookup[r.tokenId];
      const mid = outcomeMidOrOneSideProb(
        r.tokenId,
        marketLookup,
        m ? { bestBid: m.bestBid, bestAsk: m.bestAsk } : {},
      );
      const cur = mid ?? m?.lastTradePrice ?? r.avgPrice;
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
  }, [onchainPosRows, marketLookup, bidAskTick]);

  const onchainTradesAsPM = useMemo((): Trade[] => {
    return onchainTrRows.map((t, i) => {
      const tsMs = t.blockTime > 1e12 ? t.blockTime : t.blockTime * 1000;
      return {
        id: `${t.txHash}-${t.logIndex}-${i}`,
        asset_id: t.tokenId,
        token_id: t.tokenId,
        side: t.side as Trade['side'],
        price: String(t.price),
        size: String(t.size),
        fee: String(t.fee || 0),
        timestamp: String(tsMs),
        ...(t.outcome ? { outcome: t.outcome } : {}),
        ...(t.title ? { title: t.title } : {}),
        ...(t.slug ? { slug: t.slug } : {}),
        ...(t.eventSlug ? { eventSlug: t.eventSlug } : {}),
      };
    });
  }, [onchainTrRows]);

  const onchainClaimsAsPM = useMemo((): Trade[] => {
    return onchainClaimRows.map((c, i) => {
      const tsMs = c.blockTime > 1e12 ? c.blockTime : c.blockTime * 1000;
      return {
        id: `claim-${c.txHash}-${i}`,
        asset_id: '',
        token_id: '',
        side: '' as any,
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

  const positionsForTable = liveTradesSource === 'onchain' ? onchainPositionsAsPM : positions;
  const tradesForTable = liveTradesSource === 'onchain'
    ? [...onchainTradesAsPM, ...onchainClaimsAsPM].sort((a, b) => {
        const ta = parseInt(a.timestamp || '0', 10);
        const tb = parseInt(b.timestamp || '0', 10);
        return tb - ta;
      })
    : trades;

  const handleMarketClick = useCallback((tokenId: string) => {
    const market = marketLookup[tokenId];
    if (!market) return;
    const outcome = getTokenOutcome(tokenId, marketLookup);
    setSelectedMarket(market as Market);
    setSidebarOutcome((outcome === 'NO' ? 'NO' : 'YES') as 'YES' | 'NO');
    setSidebarOpen(true);
  }, [marketLookup, setSelectedMarket, setSidebarOutcome, setSidebarOpen]);

  const [tab, setTab] = useState<'trades' | 'positions' | 'orders'>(
    (localStorage.getItem(`polymarket-pos-orders-tab-${panelId}`) as 'trades' | 'positions' | 'orders') || 'trades'
  );
  const [tradesSideFilter, setTradesSideFilter] = useState(
    localStorage.getItem('polymarket-trades-side-filter') || 'ALL'
  );
  const [ordersFilter, setOrdersFilter] = useState(
    localStorage.getItem('polymarket-orders-filter') || 'ALL'
  );
  const [_ordersTypeFilter, _setOrdersTypeFilter] = useState(
    localStorage.getItem('polymarket-orders-type-filter') || 'ALL'
  );
  const [assetFilter, setAssetFilter] = useState(
    localStorage.getItem('polymarket-table-asset-filter') || 'ALL'
  );

  const handleSetTab = (t: 'trades' | 'positions' | 'orders') => {
    setTab(t);
    localStorage.setItem(`polymarket-pos-orders-tab-${panelId}`, t);
  };

  const [cancellingOrderIds, setCancellingOrderIds] = useState<Set<string>>(new Set());

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

  const filterByAsset = (tokenId: string) => {
    if (assetFilter === 'ALL') return true;
    const market = marketLookup[tokenId];
    if (!market) return true;
    return extractAssetFromMarket(market) === assetFilter;
  };

  const assets = ['ALL', 'BTC', 'ETH', 'SOL', 'XRP'];
  const assetColors: Record<string, string> = { ALL: 'text-white', BTC: 'text-orange-400', ETH: 'text-blue-400', SOL: 'text-purple-400', XRP: 'text-cyan-400' };

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
  const processedTrades = tradesForTable
    .filter((t) => {
      const tid = getTradeClobTokenId(t);
      if (assetFilter !== 'ALL') {
        const market = marketLookup[tid];
        if (market) {
          if (extractAssetFromMarket(market) !== assetFilter) return false;
        } else if (t.title) {
          const m = t.title.match(/\b(BTC|ETH|SOL|XRP)\b/i);
          if (!m || m[1].toUpperCase() !== assetFilter) return false;
        }
      }
      if (tradesSideFilter !== 'ALL' && t.side !== tradesSideFilter) return false;
      return true;
    })
    .map((trade) => {
      const tid = getTradeClobTokenId(trade);
      const market = marketLookup[tid];
      let asset = market ? extractAssetFromMarket(market) || '' : '';
      let endDate = market?.endDate || null;
      if (!endDate && trade.timestamp) {
        let tsNum = typeof trade.timestamp === 'string' ? parseInt(trade.timestamp, 10) : (trade.timestamp as number);
        if (tsNum < 1e12) tsNum = tsNum * 1000;
        endDate = new Date(tsNum).toISOString();
      }
      let marketName = getMarketPriceCondition(null, tid, marketLookup);
      let mktLabel = asset ? `${asset} ${formatPriceShort(marketName)}` : marketName;
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
        mktLabel = asset ? `${formatPriceShort(shortened)}` : shortened;
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
      const ts = (trade as any).match_time || trade.timestamp || trade.created_at || trade.matchTime || '';
      let timeMs = 0;
      if (ts) {
        let t = typeof ts === 'string' ? parseInt(ts, 10) : ts;
        if (t < 1e12) t = t * 1000;
        timeMs = t;
      }
      const fee = parseFloat(trade.fee || '0');
      const clickable = !!market;
      return { tid, asset, endDate, marketName: mktLabel, outcome, side, price, size, value, fee, timeMs, marketId: market?.id, clickable };
    });

  // Process positions
  const processedPositions = positionsForTable
    .filter((p) => {
      if ((p.size || 0) <= 0) return false;
      const tid = getPositionClobTokenId(p);
      if (!tid) return false;
      if (assetFilter === 'ALL') return true;
      const market = marketLookup[tid];
      if (market) return extractAssetFromMarket(market) === assetFilter;
      const uA = normalizeDbUnderlying(p.underlyingAsset);
      if (uA && uA === assetFilter) return true;
      if (p.title) {
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
      const market = marketLookup[tid];
      let asset = market ? extractAssetFromMarket(market) || '' : normalizeDbUnderlying(pos.underlyingAsset);
      const endDate = market?.endDate || pos.endDate || null;
      let marketName = getMarketPriceCondition(null, tid, marketLookup);
      let mktLabel = asset ? `${asset} ${formatPriceShort(marketName)}` : marketName;
      let outcome = getTokenOutcome(tid, marketLookup) || '';

      // Fallback when market not in live lookup (on-chain rollups, API snapshot fields)
      if (!market && (pos.title || pos.slug || pos.outcome || pos.outcomeIndex !== undefined || pos.underlyingAsset)) {
        if (pos.title) {
          const combined = pos.eventSlug ? `${pos.title} ${pos.eventSlug}` : pos.title;
          const shortened = getMarketPriceCondition(combined);
          const nameMap: Record<string, string> = { bitcoin: 'BTC', ethereum: 'ETH', solana: 'SOL', ripple: 'XRP', xrp: 'XRP', btc: 'BTC', eth: 'ETH', sol: 'SOL' };
          const nameMatch = pos.title.match(/\b(Bitcoin|Ethereum|Solana|Ripple|BTC|ETH|SOL|XRP)\b/i);
          if (nameMatch) asset = asset || nameMap[nameMatch[1].toLowerCase()] || nameMatch[1].toUpperCase();
          mktLabel = asset ? `${formatPriceShort(shortened)}` : shortened;
        } else if (pos.slug) {
          mktLabel = asset ? `${asset} ${pos.slug}` : pos.slug;
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
      const cur = pos.curPrice || avg;
      const entryPrice = avg * 100;
      const cost = avg * size;
      const currentValue = cur * size;
      const currentPrice = cur * 100;
      const pnl = currentValue - cost;
      const pnlPercent = cost > 0 ? (pnl / cost) * 100 : 0;
      const clickable = !!market;
      return { tid, asset, endDate, marketName: mktLabel, outcome, size, entryPrice, cost, currentPrice, currentValue, pnl, pnlPercent, marketId: market?.id ?? pos.market, clickable };
    });

  // Process orders
  const processedOrders = orders
    .filter((o) => {
      const tid = getOrderClobTokenId(o);
      if (!filterByAsset(tid)) return false;
      if (ordersFilter !== 'ALL' && o.side !== ordersFilter) return false;
      return true;
    })
    .map((order) => {
      const tid = getOrderClobTokenId(order);
      const market = marketLookup[tid];
      const asset = market ? extractAssetFromMarket(market) || '' : '';
      const endDate = market?.endDate || null;
      const marketName = getMarketPriceCondition(null, tid, marketLookup);
      const mktLabel = asset ? `${asset} ${formatPriceShort(marketName)}` : marketName;
      const outcome = getTokenOutcome(tid, marketLookup) || '';
      const price = parseFloat(order.price) * 100;
      const size = parseFloat(order.original_size || order.size);
      const filled = parseFloat(order.size_matched || '0');
      const value = parseFloat(order.price) * size;
      return { id: order.id, tid, asset, endDate, marketName: mktLabel, outcome, side: order.side, price, size, filled, value, marketId: market?.id };
    });

  // Position totals
  const totalSize = processedPositions.reduce((s, p) => s + p.size, 0);
  const totalCost = processedPositions.reduce((s, p) => s + p.cost, 0);
  const totalValue = processedPositions.reduce((s, p) => s + p.currentValue, 0);
  const totalPnl = totalValue - totalCost;
  const avgEntry = totalSize > 0 ? (totalCost / totalSize) * 100 : 0;
  const avgExit = totalSize > 0 ? (totalValue / totalSize) * 100 : 0;
  const avgPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;
  const tPnlColor = totalPnl >= 0 ? 'text-green-400' : 'text-red-400';
  const tPnlSign = totalPnl >= 0 ? '+' : '';

  const hCls = 'text-gray-500 py-1 px-1';

  const trColgroup = <colgroup><col style={{width:'7%'}}/><col style={{width:'8%'}}/><col style={{width:'22%'}}/><col style={{width:'7%'}}/><col style={{width:'6%'}}/><col style={{width:'10%'}}/><col style={{width:'9%'}}/><col style={{width:'10%'}}/><col style={{width:'9%'}}/><col style={{width:'12%'}}/></colgroup>;
  const posColgroup = <colgroup><col style={{width:'5%'}}/><col style={{width:'8%'}}/><col style={{width:'16%'}}/><col style={{width:'5%'}}/><col style={{width:'8%'}}/><col style={{width:'8%'}}/><col style={{width:'10%'}}/><col style={{width:'8%'}}/><col style={{width:'10%'}}/><col style={{width:'11%'}}/><col style={{width:'11%'}}/></colgroup>;
  const ordColgroup = <colgroup><col style={{width:'7%'}}/><col style={{width:'8%'}}/><col style={{width:'22%'}}/><col style={{width:'8%'}}/><col style={{width:'6%'}}/><col style={{width:'10%'}}/><col style={{width:'10%'}}/><col style={{width:'10%'}}/><col style={{width:'12%'}}/><col style={{width:'7%'}}/></colgroup>;

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0">
      <div className="panel-header flex items-center gap-1 mb-2 cursor-grab">
        <div className="no-drag flex items-center gap-1 flex-wrap">
          <button onClick={() => handleSetTab('positions')} className={tabCls('positions')}>
            Positions <span className="text-xs text-gray-500">({processedPositions.length})</span>
          </button>
          <button onClick={() => handleSetTab('orders')} className={tabCls('orders')}>
            Orders <span className="text-xs text-gray-500">({processedOrders.length})</span>
          </button>
          <button onClick={() => handleSetTab('trades')} className={tabCls('trades')}>
            Trades <span className="text-xs text-gray-500">({processedTrades.length})</span>
          </button>

          {tab === 'trades' && (
            <div className="flex gap-1 items-center">
              <div className="inline-flex items-center gap-0.5 rounded-md bg-gray-900 border border-gray-700 p-0.5 text-[9px]">
                {(['ALL', 'BUY', 'SELL'] as const).map((s) => (
                  <button key={s} onClick={() => { setTradesSideFilter(s); localStorage.setItem('polymarket-trades-side-filter', s); }}
                    className={filterBtnCls(tradesSideFilter === s, s === 'BUY' ? 'green' : s === 'SELL' ? 'red' : 'gray')}>{s}</button>
                ))}
              </div>
              <select value={assetFilter} onChange={(e) => { setAssetFilter(e.target.value); localStorage.setItem('polymarket-table-asset-filter', e.target.value); }}
                className={`bg-gray-700 text-[9px] font-bold rounded px-1 py-0.5 border border-gray-600 ${assetColors[assetFilter]}`} style={{ outline: 'none' }}>
                {assets.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}

          {tab === 'positions' && (
            <select value={assetFilter} onChange={(e) => { setAssetFilter(e.target.value); localStorage.setItem('polymarket-table-asset-filter', e.target.value); }}
              className={`bg-gray-700 text-[9px] font-bold rounded px-1 py-0.5 border border-gray-600 ${assetColors[assetFilter]}`} style={{ outline: 'none' }}>
              {assets.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          )}

          {tab === 'orders' && (
            <div className="flex gap-0.5 items-center flex-wrap">
              <div className="inline-flex items-center gap-0.5 rounded-md bg-gray-900 border border-gray-700 p-0.5">
                {(['ALL', 'BUY', 'SELL'] as const).map((s) => (
                  <button key={s} onClick={() => { setOrdersFilter(s); localStorage.setItem('polymarket-orders-filter', s); }}
                    className={filterBtnCls(ordersFilter === s, s === 'BUY' ? 'green' : s === 'SELL' ? 'red' : 'gray')}>{s}</button>
                ))}
              </div>
              <span className="mx-1 text-gray-600">|</span>
              <select value={assetFilter} onChange={(e) => { setAssetFilter(e.target.value); localStorage.setItem('polymarket-table-asset-filter', e.target.value); }}
                className={`bg-gray-700 text-[9px] font-bold rounded px-1 py-0.5 border border-gray-600 ${assetColors[assetFilter]}`} style={{ outline: 'none' }}>
                {assets.map((a) => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
          )}
        </div>
        <span className="flex-1" />
        {liveTradesSource === 'onchain' && (
          <span className="text-[9px] font-bold text-purple-300/90 shrink-0" title="Positions & trades from backend rollups (wallet_market_positions / wallet_fill_ledger)">
            ONCHAIN
          </span>
        )}
      </div>

      <div className="panel-body text-[10px] flex-1 min-h-0 flex flex-col">
        {/* Trades */}
        {tab === 'trades' && (
          onchainLoading && liveTradesSource === 'onchain' && processedTrades.length === 0 ? (
            <div className="text-purple-300/90 text-center py-4">Loading on-chain trades…</div>
          ) : processedTrades.length === 0 ? (
            <div className="text-gray-500 text-center py-4">No trades</div>
          ) : (<div className="flex flex-col flex-1 min-h-0">
            {/* Fixed header */}
            <table className="w-full text-[10px] table-fixed">{trColgroup}<thead><tr className="text-gray-500 border-b border-gray-700">
              <th className={`${hCls} text-left`}>Asset</th>
              <th className={`${hCls} text-left whitespace-nowrap`}>Date</th>
              <th className={`${hCls} text-left`}>Market</th>
              <th className={`${hCls} text-left`}>Side</th>
              <th className={`${hCls} text-left`}>Y/N</th>
              <th className={`${hCls} text-right`}>Size</th>
              <th className={`${hCls} text-right`}>Price</th>
              <th className={`${hCls} text-right`}>Value</th>
              <th className={`${hCls} text-right`}>Fee</th>
              <th className={`${hCls} text-right`}>Time</th>
            </tr></thead></table>
            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <table className="w-full text-[10px] table-fixed">{trColgroup}<tbody>
                {processedTrades.slice(0, 100).map((t, i) => {
                  const dd = getDateDisplay(t.endDate);
                  const ageMs = t.timeMs > 0 ? Date.now() - t.timeMs : Infinity;
                  const timeColor = ageMs < 15 * 60000 ? 'text-green-400' : ageMs < 60 * 60000 ? 'text-yellow-400' : 'text-gray-400';
                  return (
                    <tr key={i} className={`border-b border-gray-700/50 hover:bg-gray-800/50 ${t.clickable ? 'cursor-pointer' : 'opacity-70'} ${selectedMarket && selectedMarket.id === t.marketId ? 'bg-blue-900/40' : ''}`} onClick={() => t.clickable && handleMarketClick(t.tid)}>
                      <td className={`py-1 px-1 ${assetColorMap[t.asset] || 'text-gray-400'} font-bold`}>{t.asset}</td>
                      <td className={`py-1 px-1 ${dd.color}`}>{dd.label}</td>
                      <td className={`py-1 px-1 ${assetColorMap2[t.asset] || 'text-gray-300'} truncate`}>{t.marketName}</td>
                      <td className={`py-1 px-1 font-bold ${
                        t.side === 'BUY' ? 'text-green-400'
                          : t.side === 'CLAIM' ? 'text-blue-400'
                            : t.side === 'SPLIT' ? 'text-purple-400'
                              : t.side === 'MERGE' ? 'text-amber-400'
                                : 'text-red-400'
                      }`}>{t.outcome ? `${t.side} ${t.outcome}` : t.side}</td>
                      <td className={`py-1 px-1 font-bold ${t.outcome === 'YES' || t.outcome === 'UP' ? 'text-green-300' : 'text-red-300'}`}>{t.outcome || '-'}</td>
                      <td className="py-1 px-1 text-right text-gray-300">{t.side === 'CLAIM' ? '—' : Math.round(t.size).toLocaleString()}</td>
                      <td className="py-1 px-1 text-right text-gray-300">{t.side === 'CLAIM' ? '—' : `${t.price.toFixed(1)}¢`}</td>
                      <td className={`py-1 px-1 text-right ${t.side === 'CLAIM' ? 'text-blue-300 font-bold' : 'text-gray-300'}`}>${t.value.toFixed(2)}</td>
                      <td className="py-1 px-1 text-right text-yellow-400/80">{t.fee > 0 ? `$${t.fee.toFixed(2)}` : '-'}</td>
                      <td className={`py-1 px-1 text-right ${timeColor}`}>{t.timeMs > 0 ? formatElapsed(t.timeMs) : ''}</td>
                    </tr>
                  );
                })}
              </tbody></table>
            </div>
          </div>)
        )}

        {/* Positions */}
        {tab === 'positions' && (
          onchainLoading && liveTradesSource === 'onchain' && processedPositions.length === 0 ? (
            <div className="text-purple-300/90 text-center py-4">Loading on-chain positions…</div>
          ) : processedPositions.length === 0 ? (
            <div className="text-gray-500 text-center py-4">
              {liveTradesSource === 'onchain' && !makerAddress
                ? 'Connect wallet (proxy) for on-chain positions'
                : liveTradesSource === 'onchain'
                  ? 'No on-chain positions for known tokens'
                  : 'No positions'}
            </div>
          ) : (<div className="flex flex-col flex-1 min-h-0">
            {/* Fixed header */}
            <table className="w-full text-[10px] table-fixed">{posColgroup}<thead><tr className="text-gray-500 border-b border-gray-700">
              <th className={`${hCls} text-left`}>Asset</th>
              <th className={`${hCls} text-left whitespace-nowrap`}>Date</th>
              <th className={`${hCls} text-left`}>Market</th>
              <th className={`${hCls} text-left`}>Y/N</th>
              <th className={`${hCls} text-right`}>Size</th>
              <th className={`${hCls} text-right`}>Entry</th>
              <th className={`${hCls} text-right`}>Cost</th>
              <th className={`${hCls} text-right`}>Exit</th>
              <th className={`${hCls} text-right`}>Val</th>
              <th className={`${hCls} text-right`}>PnL$</th>
              <th className={`${hCls} text-right`}>PnL%</th>
            </tr></thead></table>
            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <table className="w-full text-[10px] table-fixed">{posColgroup}<tbody>
                {processedPositions.map((p, i) => {
                  const dd = getDateDisplay(p.endDate);
                  const pnlColor = p.pnl >= 0 ? 'text-green-400' : 'text-red-400';
                  const pnlSign = p.pnl >= 0 ? '+' : '-';
                  const exitChange = p.entryPrice > 0 ? ((p.currentPrice - p.entryPrice) / p.entryPrice) * 100 : 0;
                  const exitColor = exitChange > 20 ? 'text-green-400' : exitChange < -20 ? 'text-red-400' : 'text-yellow-400';
                  return (
                    <tr key={i} className={`border-b border-gray-700/50 hover:bg-gray-800/50 ${p.clickable ? 'cursor-pointer' : 'opacity-70'} ${selectedMarket && selectedMarket.id === p.marketId ? 'bg-blue-900/40' : ''}`} onClick={() => p.clickable && handleMarketClick(p.tid)}>
                      <td className={`py-1 px-1 ${assetColorMap[p.asset] || 'text-gray-400'} font-bold`}>{p.asset}</td>
                      <td className={`py-1 px-1 ${dd.color}`}>{dd.label}</td>
                      <td className={`py-1 px-1 ${assetColorMap2[p.asset] || 'text-gray-300'} truncate`}>{p.marketName}</td>
                      <td className={`py-1 px-1 font-bold ${p.outcome === 'YES' || p.outcome === 'UP' ? 'text-green-300' : 'text-red-300'}`}>{p.outcome || '-'}</td>
                      <td className="py-1 px-1 text-right text-gray-300">{Math.floor(p.size).toLocaleString()}</td>
                      <td className="py-1 px-1 text-right text-gray-300">{p.entryPrice.toFixed(1)}¢</td>
                      <td className="py-1 px-1 text-right text-gray-300">${Math.round(p.cost).toLocaleString()}</td>
                      <td className={`py-1 px-1 text-right ${exitColor}`}>{p.currentPrice.toFixed(1)}¢</td>
                      <td className="py-1 px-1 text-right text-gray-300">${Math.round(p.currentValue).toLocaleString()}</td>
                      <td className={`py-1 px-1 text-right ${pnlColor} font-bold`}>{pnlSign}${Math.round(Math.abs(p.pnl)).toLocaleString()}</td>
                      <td className={`py-1 px-1 text-right ${pnlColor} font-bold`}>{pnlSign}{Math.round(Math.abs(p.pnlPercent))}%</td>
                    </tr>
                  );
                })}
              </tbody></table>
            </div>
            {/* Fixed footer */}
            <table className="w-full text-[10px] table-fixed">{posColgroup}<tbody>
              <tr className="border-t-2 border-gray-600 font-bold">
                <td className="py-1 px-1 text-white">Total</td>
                <td className="py-1 px-1"></td><td className="py-1 px-1"></td><td className="py-1 px-1"></td>
                <td className="py-1 px-1 text-right text-white">{Math.floor(totalSize).toLocaleString()}</td>
                <td className="py-1 px-1 text-right text-gray-400">{avgEntry.toFixed(1)}¢</td>
                <td className="py-1 px-1 text-right text-white">${Math.round(totalCost).toLocaleString()}</td>
                <td className="py-1 px-1 text-right text-gray-400">{avgExit.toFixed(1)}¢</td>
                <td className="py-1 px-1 text-right text-white">${Math.round(totalValue).toLocaleString()}</td>
                <td className={`py-1 px-1 text-right ${tPnlColor} font-bold`}>{tPnlSign}${Math.round(Math.abs(totalPnl)).toLocaleString()}</td>
                <td className={`py-1 px-1 text-right ${tPnlColor} font-bold`}>{tPnlSign}{Math.round(Math.abs(avgPnlPct))}%</td>
              </tr>
            </tbody></table>
          </div>)
        )}

        {/* Orders */}
        {tab === 'orders' && (
          processedOrders.length === 0 ? (
            <div className="text-gray-500 text-center py-4">No open orders</div>
          ) : (<div className="flex flex-col flex-1 min-h-0">
            {/* Fixed header */}
            <table className="w-full text-[10px] table-fixed">{ordColgroup}<thead><tr className="text-gray-500 border-b border-gray-700">
              <th className={`${hCls} text-left`}>Asset</th>
              <th className={`${hCls} text-left whitespace-nowrap`}>Date</th>
              <th className={`${hCls} text-left`}>Market</th>
              <th className={`${hCls} text-left`}>Side</th>
              <th className={`${hCls} text-left`}>Y/N</th>
              <th className={`${hCls} text-right`}>Price</th>
              <th className={`${hCls} text-right`}>Size</th>
              <th className={`${hCls} text-right`}>Filled</th>
              <th className={`${hCls} text-right`}>Value</th>
              <th className={`${hCls} text-center`}></th>
            </tr></thead></table>
            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <table className="w-full text-[10px] table-fixed">{ordColgroup}<tbody>
                {processedOrders.map((o) => {
                  // Show time-left in the Orders tab (e.g. "2.5h") instead of TODAY/TMR labels.
                  const dd = getTimeLeftDisplay(o.endDate);
                  return (
                    <tr key={o.id} className={`border-b border-gray-700/50 hover:bg-gray-800/50 ${selectedMarket && selectedMarket.id === o.marketId ? 'bg-blue-900/40' : ''}`}>
                      <td className={`py-1 px-1 ${assetColorMap[o.asset] || 'text-gray-400'} font-bold`}>{o.asset}</td>
                      <td className={`py-1 px-1 ${dd.color}`}>{dd.label}</td>
                      <td className={`py-1 px-1 ${assetColorMap2[o.asset] || 'text-gray-300'} truncate cursor-pointer hover:underline`} onClick={() => handleMarketClick(o.tid)}>{o.marketName}</td>
                      <td className={`py-1 px-1 font-bold ${o.side === 'BUY' ? 'text-green-400' : 'text-red-400'}`}>{o.side}</td>
                      <td className={`py-1 px-1 font-bold ${o.outcome === 'YES' ? 'text-green-300' : 'text-red-300'}`}>{o.outcome || '-'}</td>
                      <td className="py-1 px-1 text-right text-white">{o.price.toFixed(1)}¢</td>
                      <td className="py-1 px-1 text-right text-gray-300">{Math.round(o.size).toLocaleString()}</td>
                      <td className="py-1 px-1 text-right text-gray-500">{Math.round(o.filled).toLocaleString()}</td>
                      <td className="py-1 px-1 text-right text-gray-300">${Math.round(o.value).toLocaleString()}</td>
                      <td className="py-1 px-1 text-center">
                        <button
                          onClick={() => !cancellingOrderIds.has(o.id) && handleCancelOrder(o.id)}
                          disabled={cancellingOrderIds.has(o.id)}
                          className="w-4 h-4 rounded-sm inline-flex items-center justify-center bg-red-600 hover:bg-red-500 disabled:bg-red-600/50"
                          title="Cancel order"
                        >{cancellingOrderIds.has(o.id) ? <span className="cancel-spinner"/> : <span className="text-black text-[10px] font-bold leading-none">✕</span>}</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody></table>
            </div>
          </div>)
        )}
      </div>
    </div>
  );
}
