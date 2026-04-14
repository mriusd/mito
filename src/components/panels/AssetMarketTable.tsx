import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { formatPrice, assetToSymbol, formatDateShort } from '../../utils/format';
import { saveRange } from '../../api';
import { showToast } from '../../utils/toast';
import { PriceTicks } from '../PriceTicks';
import { RangeEditDialog } from '../RangeEditDialog';
import { HelpTooltip } from '../HelpTooltip';
import type { AssetName, Market } from '../../types';
import { outcomeMidOrOneSideProb } from '../../lib/outcomeQuote';
import { getMarketProbability, getHitMarketProbability } from '../../utils/bsMath';
import { MarketCellMidRow } from './MarketCellMidRow';

function StrikeRangeIndicator({ markets, livePrice }: { markets: Market[]; livePrice: number }) {
  if (livePrice <= 0 || markets.length === 0) return null;

  // Collect active strikes with end dates
  const strikes: { strike: number; endDate: string }[] = [];
  const now = Date.now();
  for (const m of markets) {
    const ps = m.groupItemTitle || '';
    if (!ps) continue;
    const cleaned = ps.replace(/\$/g, '').replace(/,/g, '');
    let strike: number;
    if (cleaned.startsWith('>')) strike = parseFloat(cleaned.substring(1));
    else if (cleaned.startsWith('<') || cleaned.includes('-')) continue;
    else strike = parseFloat(cleaned);
    if (isNaN(strike) || strike <= 0) continue;
    const ed = m.endDate || '';
    if (!ed || m.closed || new Date(ed).getTime() < now) continue;
    strikes.push({ strike, endDate: ed });
  }
  if (strikes.length === 0) return null;

  // Find soonest expiry date
  strikes.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  const soonestDate = new Date(strikes[0].endDate).toDateString();

  // Unique strikes for soonest date, sorted
  const soonestStrikes = [...new Set(
    strikes.filter(s => new Date(s.endDate).toDateString() === soonestDate).map(s => s.strike)
  )].sort((a, b) => a - b);
  if (soonestStrikes.length < 2) return null;

  // Find closest strike below and above live price
  let below: number | null = null;
  let above: number | null = null;
  for (const s of soonestStrikes) {
    if (s <= livePrice) below = s;
  }
  for (const s of soonestStrikes) {
    if (s > livePrice && above === null) above = s;
  }
  if (below === null || above === null) return null;

  const pct = Math.max(0, Math.min(1, (livePrice - below) / (above - below)));
  const fmtStrike = (v: number) => v >= 1000 ? (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k' : v.toString();

  const w = 60, h = 16, pad = 4;
  const barY = 10, barW = w - pad * 2;
  const tickH = 6;
  const markerX = pad + pct * barW;

  return (
    <span
      className="inline-flex items-center ml-1"
      title={`${fmtStrike(below)} ← ${livePrice.toLocaleString()} → ${fmtStrike(above)}`}
    >
      <svg width={w} height={h} className="inline">
        <line x1={pad} y1={barY} x2={w - pad} y2={barY} stroke="#4b5563" strokeWidth={1.5} />
        <line x1={pad} y1={barY - tickH} x2={pad} y2={barY} stroke="#6b7280" strokeWidth={1.5} />
        <line x1={w - pad} y1={barY - tickH} x2={w - pad} y2={barY} stroke="#6b7280" strokeWidth={1.5} />
        <line x1={markerX} y1={barY - tickH - 1} x2={markerX} y2={barY} stroke="#94a3b8" strokeWidth={2} />
      </svg>
    </span>
  );
}

interface AssetMarketTableProps {
  asset: AssetName;
  panelId: string;
}

const ALL_ASSETS: AssetName[] = ['BTC', 'ETH', 'SOL', 'XRP'];
const MANUAL_VOL_KEY_PREFIX = 'polybot-manual-vol-pct-';

export function AssetMarketTable({ asset: initialAsset, panelId }: AssetMarketTableProps) {
  const [asset, setAsset] = useState<AssetName>(() => {
    const saved = localStorage.getItem(`polybot-grid-asset-${panelId}`);
    if (saved && ALL_ASSETS.includes(saved as AssetName)) return saved as AssetName;
    return initialAsset;
  });
  const [assetDropdownOpen, setAssetDropdownOpen] = useState(false);
  const [showUpDown, setShowUpDown] = useState(() => {
    const saved = localStorage.getItem(`polybot-show-updown-${panelId}`);
    if (saved === 'true') return true;
    if (saved === 'false') return false;
    return window.innerWidth >= 640;
  });
  const [showHit, setShowHit] = useState(() => {
    const saved = localStorage.getItem(`polybot-show-hit-${panelId}`);
    if (saved === 'true') return true;
    if (saved === 'false') return false;
    return window.innerWidth >= 640;
  });
  const [showAbove, setShowAbove] = useState(() => localStorage.getItem(`polybot-show-above-${panelId}`) !== 'false');
  const [showBetween, setShowBetween] = useState(() => localStorage.getItem(`polybot-show-between-${panelId}`) !== 'false');
  const symbol = assetToSymbol(asset);
  const aboveMarkets = useAppStore((s) => s.aboveMarkets);
  const priceOnMarkets = useAppStore((s) => s.priceOnMarkets);
  const weeklyHitMarkets = useAppStore((s) => s.weeklyHitMarkets);
  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const _bidAskLookup = useAppStore((s) => s.marketLookup);
  useAppStore((s) => s.bidAskTick); // subscribe to bid/ask updates for re-renders
  const getLiveBidAsk = (m: Market) => {
    const tid = m.clobTokenIds?.[0];
    const live = tid ? _bidAskLookup[tid] : null;
    return { bestBid: live?.bestBid ?? m.bestBid, bestAsk: live?.bestAsk ?? m.bestAsk };
  };
  const priceData = useAppStore((s) => s.priceData);
  const vwapData = useAppStore((s) => s.vwapData);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const manualPriceSlots = useAppStore((s) => s.manualPriceSlots);
  const activeRangeSlot = useAppStore((s) => s.activeRangeSlot);
  const showPast = useAppStore((s) => s.showPast);
  const setShowPast = useAppStore((s) => s.setShowPast);
  const positions = useAppStore((s) => s.positions);
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const onchainGridPositions = useAppStore((s) => s.onchainGridPositions);
  const orders = useAppStore((s) => s.orders);
  const setManualPriceSlot = useAppStore((s) => s.setManualPriceSlot);
  const setActiveRangeSlot = useAppStore((s) => s.setActiveRangeSlot);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const selectedEndDate = selectedMarket?.endDate || '';
  const signalsOnGrid = useAppStore((s) => s.signalsOnGrid);
  const signals = useAppStore((s) => s.signals);
  const signalMakerMode = useAppStore((s) => s.signalMakerMode);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);

  // Build signal lookup: marketId -> { yesDiff, noDiff } (only negative diffs)
  const signalByMarket: Record<string, { yesDiff: string | null; noDiff: string | null }> = {};
  if (signalsOnGrid) {
    for (const sig of signals) {
      const mid = sig.market.id;
      if (!signalByMarket[mid]) signalByMarket[mid] = { yesDiff: null, noDiff: null };
      const diff = signalMakerMode ? sig.bidDiffPct : sig.diffPct;
      if (diff >= 0) continue;
      const label = signalMakerMode
        ? diff.toFixed(1) + '%'
        : diff.toFixed(0) + '%';
      if (sig.origSide === 'YES') signalByMarket[mid].yesDiff = label;
      else signalByMarket[mid].noDiff = label;
    }
  }

  const aboveContainerRef = useRef<HTMLDivElement>(null);
  const priceOnContainerRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef<Set<string>>(new Set());

  // Callback ref: scroll the row's scrollable parent to center this row
  const scrollToCenterRef = useCallback((tableKey: string) => (el: HTMLTableRowElement | null) => {
    if (!el || scrolledRef.current.has(tableKey)) return;
    scrolledRef.current.add(tableKey);
    // Use setTimeout to ensure the container has its final layout height
    setTimeout(() => {
      // Walk up to find the scrollable container
      let container = el.parentElement as HTMLElement | null;
      while (container && container.scrollHeight <= container.clientHeight) {
        container = container.parentElement;
      }
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const rowRect = el.getBoundingClientRect();
        const scrollOffset = rowRect.top - containerRect.top + container.scrollTop
          - containerRect.height / 2 + rowRect.height / 2;
        container.scrollTop = Math.max(0, scrollOffset);
      }
    }, 100);
  }, []);

  const [rangeDialogOpen, setRangeDialogOpen] = useState(false);
  const [rangeDialogSlot, setRangeDialogSlot] = useState(0);

  const colorMap: Record<AssetName, string> = {
    BTC: 'text-orange-400',
    ETH: 'text-blue-400',
    SOL: 'text-purple-400',
    XRP: 'text-cyan-400',
  };
  const titleColor = colorMap[asset] || 'text-yellow-400';

  const livePrice = priceData[symbol]?.price || 0;
  const vwapPrice = vwapData[symbol]?.price || 0;
  const autoAdjVol = (volatilityData[symbol] || 0.6) * volMultiplier;
  const [sigmaEditing, setSigmaEditing] = useState(false);
  const [manualVolPctInput, setManualVolPctInput] = useState<string>(() => {
    const raw = localStorage.getItem(`${MANUAL_VOL_KEY_PREFIX}${symbol}`);
    return raw ?? '';
  });
  useEffect(() => {
    const raw = localStorage.getItem(`${MANUAL_VOL_KEY_PREFIX}${symbol}`);
    setManualVolPctInput(raw ?? '');
    setSigmaEditing(false);
  }, [symbol]);
  const manualVolPct = parseFloat(manualVolPctInput);
  const hasManualVol = Number.isFinite(manualVolPct) && manualVolPct > 0;
  const adjVol = hasManualVol ? manualVolPct / 100 : autoAdjVol;

  const commitManualVol = useCallback(() => {
    const n = parseFloat(manualVolPctInput);
    if (!Number.isFinite(n) || n <= 0) {
      localStorage.removeItem(`${MANUAL_VOL_KEY_PREFIX}${symbol}`);
      setManualVolPctInput('');
      setSigmaEditing(false);
      return;
    }
    const clamped = Math.min(1000, Math.max(0, n));
    localStorage.setItem(`${MANUAL_VOL_KEY_PREFIX}${symbol}`, String(clamped));
    setManualVolPctInput(String(clamped));
    setSigmaEditing(false);
  }, [manualVolPctInput, symbol]);
  const activeSlot = activeRangeSlot[symbol];
  const slot0 = manualPriceSlots[symbol][0];
  const slot1 = manualPriceSlots[symbol][1];

  const handleCellClick = useCallback((market: Market, outcome: 'YES' | 'NO' = 'YES') => {
    setSelectedMarket(market);
    setSidebarOutcome(outcome);
    setSidebarOpen(true);
  }, [setSelectedMarket, setSidebarOpen, setSidebarOutcome]);

  const aboveMarketsForAsset = aboveMarkets[asset] || [];
  const priceOnMarketsForAsset = priceOnMarkets[asset] || [];
  const weeklyHitMarketsForAsset = weeklyHitMarkets[asset] || [];

  // Format price for display: abbreviate large numbers, ranges
  const formatPriceShort = (priceStr: string) => {
    const cleaned = priceStr.replace(/\$/g, '').replace(/,/g, '');
    if (cleaned.startsWith('<') || cleaned.startsWith('>')) {
      const sym = cleaned[0];
      const num = parseFloat(cleaned.substring(1));
      if (num >= 1000) return sym + (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1) + 'k';
      return sym + num;
    }
    if (cleaned.includes('-')) {
      const parts = cleaned.split('-');
      const num1 = parseFloat(parts[0]);
      const num2 = parseFloat(parts[1]);
      if (num1 >= 1000 && num2 >= 1000) {
        const k1 = (num1 / 1000).toFixed(num1 % 1000 === 0 ? 0 : 1);
        const k2 = (num2 / 1000).toFixed(num2 % 1000 === 0 ? 0 : 1);
        return k1 + '-' + k2 + 'k';
      }
      return num1 + '-' + num2;
    }
    const num = parseFloat(cleaned);
    if (num >= 1000) return (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1) + 'k';
    return cleaned;
  };

  // Numeric value for sorting prices (handles <, >, ranges)
  const getNumericValue = (str: string) => {
    const s = str.replace(/\$/g, '').replace(/,/g, '');
    if (s.startsWith('<')) return parseFloat(s.substring(1)) - 0.5;
    if (s.startsWith('>')) return parseFloat(s.substring(1)) + 1000000;
    if (s.includes('-')) return parseFloat(s.split('-')[0]);
    return parseFloat(s) || 0;
  };

  // Parse price bounds for % change calculation
  const parsePriceBounds = (str: string) => {
    let s = str.replace(/\$/g, '').replace(/,/g, '');
    const isLt = s.startsWith('<');
    const isGt = s.startsWith('>');
    s = s.replace(/</g, '').replace(/>/g, '');
    const parseNum = (v: string) => {
      const m = v.match(/^([\d.]+)(k)?$/i);
      if (m) return m[2] ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
      return parseFloat(v) || 0;
    };
    if (s.includes('-')) {
      const parts = s.split('-');
      return { low: parseNum(parts[0]), high: parseNum(parts[1]) };
    }
    const n = parseNum(s);
    if (isLt) return { low: 0, high: n };
    if (isGt) return { low: n, high: Infinity };
    return { low: n, high: n };
  };

  interface DateCol { slug: string; endDate: string; title: string }

  // Build table data — keyed by eventSlug like original
  const buildTableData = (markets: Market[]) => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    // Collect unique dates by eventSlug
    const dateMap = new Map<string, DateCol>();
    const priceSet = new Set<string>();
    const marketLookup: Record<string, Market> = {};

    for (const m of markets) {
      const slug = m.eventSlug || '';
      const price = m.groupItemTitle || '';
      if (!price) continue;
      if (!dateMap.has(slug)) {
        dateMap.set(slug, { slug, endDate: m.endDate, title: m.eventTitle || '' });
      }
      priceSet.add(price);
      marketLookup[price + '_' + slug] = m;
    }

    // Sort dates by endDate, filter past
    let dates = Array.from(dateMap.values())
      .filter(d => {
        const endTime = d.endDate ? new Date(d.endDate).getTime() : Infinity;
        return endTime > oneDayAgo;
      })
      .sort((a, b) => {
        const ta = a.endDate ? new Date(a.endDate).getTime() : Infinity;
        const tb = b.endDate ? new Date(b.endDate).getTime() : Infinity;
        return ta - tb;
      });

    if (!showPast) {
      dates = dates.filter(d => !d.endDate || new Date(d.endDate).getTime() >= now);
    }

    // Sort prices numerically, filter to only those with visible markets
    const prices = Array.from(priceSet)
      .filter(price => dates.some(d => marketLookup[price + '_' + d.slug]))
      .sort((a, b) => getNumericValue(a) - getNumericValue(b));

    return { dates, prices, marketLookup };
  };

  // Build position/order lookups by tokenId (on-chain rollups when sidebar source is ONCHAIN)
  const positionLookup: Record<string, { size: number }> = {};
  if (liveTradesSource === 'onchain') {
    for (const p of onchainGridPositions) {
      if (p.tokenId && p.size > 0) positionLookup[p.tokenId] = { size: p.size };
    }
  } else {
    for (const pos of positions) {
      const tid = pos.asset || '';
      const sz = pos.size || 0;
      if (tid && sz > 0) positionLookup[tid] = { size: sz };
    }
  }
  const orderLookup: Record<string, typeof orders> = {};
  for (const ord of orders) {
    const tid = ord.asset_id || ord.token_id || '';
    if (tid) {
      if (!orderLookup[tid]) orderLookup[tid] = [];
      orderLookup[tid].push(ord);
    }
  }

  // Check if live price satisfies the market's price condition
  const isPriceConditionTrue = (priceStr: string, live: number) => {
    if (live <= 0) return false;
    const cleaned = priceStr.replace(/\$/g, '').replace(/,/g, '');
    if (cleaned.startsWith('>')) {
      const val = parseFloat(cleaned.substring(1));
      return !isNaN(val) && live > val;
    }
    if (cleaned.startsWith('<')) {
      const val = parseFloat(cleaned.substring(1));
      return !isNaN(val) && live < val;
    }
    if (cleaned.includes('-')) {
      const parts = cleaned.split('-');
      const lo = parseFloat(parts[0]);
      const hi = parseFloat(parts[1]);
      return !isNaN(lo) && !isNaN(hi) && live >= lo && live <= hi;
    }
    // Plain number (above markets without > prefix): price >= threshold
    const threshold = parseFloat(cleaned);
    if (!isNaN(threshold)) return live >= threshold;
    return false;
  };

  const deltaBgStyle = (
    priceStr: string,
    yesMidProb: number | null,
    endDate: string,
    isHit = false,
  ): React.CSSProperties => {
    if (yesMidProb == null || livePrice <= 0 || !endDate) return {};
    const cleaned = priceStr
      .replace(/\$/g, '').replace(/,/g, '')
      .replace(/↑/g, '>').replace(/↓/g, '<')
      .trim();
    const ps = (cleaned.startsWith('>') || cleaned.startsWith('<') || cleaned.includes('-'))
      ? cleaned : '>' + cleaned;
    const mathProb = isHit
      ? getHitMarketProbability(ps, livePrice, endDate, adjVol, bsTimeOffsetHours)
      : getMarketProbability(ps, livePrice, endDate, adjVol, bsTimeOffsetHours);
    if (mathProb == null) return {};
    const delta = (yesMidProb - mathProb) * 100;
    const alpha = Math.min(0.55, Math.abs(delta) * 0.035);
    if (alpha < 0.02) return {};
    return {
      backgroundColor: delta > 0
        ? `rgba(34, 197, 94, ${alpha.toFixed(3)})`
        : `rgba(239, 68, 68, ${alpha.toFixed(3)})`,
    };
  };

  const renderWeeklyHitTable = () => {
    const now = Date.now();
    const dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    // Filter active weekly hit markets, group by eventSlug
    // Filter out dip-to (↓) markets where target is $0 (nonsensical)
    const activeMarkets = weeklyHitMarketsForAsset.filter(m => {
      if (m.closed) return false;
      const endTime = m.endDate ? new Date(m.endDate).getTime() : 0;
      if (endTime <= now) return false;
      const title = m.groupItemTitle || '';
      if (title.includes('↓')) {
        const target = parseFloat(title.replace(/[↑↓,\s]/g, '')) || 0;
        if (target <= 0) return false;
      }
      return true;
    });
    if (activeMarkets.length === 0) return null;

    // Group by eventSlug (each slug = one weekly event)
    const byEvent = new Map<string, { title: string; endDate: string; slug: string; markets: Market[] }>();
    for (const m of activeMarkets) {
      const slug = m.eventSlug || '';
      if (!byEvent.has(slug)) byEvent.set(slug, { title: m.eventTitle || '', endDate: m.endDate, slug, markets: [] });
      byEvent.get(slug)!.markets.push(m);
    }

    // Sort events by endDate
    const events = Array.from(byEvent.values()).sort((a, b) => {
      return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
    });

    // Sort markets within each event by price ascending
    const hitPrice = (t: string) => parseFloat(t.replace(/[↑↓,\s]/g, '')) || 0;
    for (const ev of events) {
      ev.markets.sort((a, b) => hitPrice(a.groupItemTitle || '0') - hitPrice(b.groupItemTitle || '0'));
    }

    // Collect unique prices across all events, sorted ascending
    const priceSet = new Set<string>();
    for (const ev of events) {
      for (const m of ev.markets) priceSet.add(m.groupItemTitle || '');
    }
    const prices = Array.from(priceSet).sort((a, b) => hitPrice(a) - hitPrice(b));

    // Build lookup: price -> eventSlug -> market
    const hitLookup: Record<string, Record<string, Market>> = {};
    for (const ev of events) {
      for (const m of ev.markets) {
        const key = m.groupItemTitle || '';
        if (!hitLookup[key]) hitLookup[key] = {};
        hitLookup[key][ev.slug] = m;
      }
    }

    // Scroll anchor: last ↓ row (dip strikes below current); fallback = closest row to live price
    let anchorRowIdx = -1;
    for (let i = 0; i < prices.length; i++) {
      if (prices[i].includes('↓')) anchorRowIdx = i;
    }

    let closestRowIdx = -1;
    if (anchorRowIdx === -1 && livePrice > 0) {
      let minDist = Infinity;
      for (let i = 0; i < prices.length; i++) {
        const dist = Math.abs(hitPrice(prices[i]) - livePrice);
        if (dist < minDist) { minDist = dist; closestRowIdx = i; }
      }
    }

    // Format size (1000+ => 1.2k)
    const fmtSz = (sz: number) => {
      const v = Math.floor(sz);
      return v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : v.toLocaleString();
    };

    return (
      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-20 bg-gray-900">
            <tr>
              <th className={`px-1 py-1 text-center ${titleColor} font-bold border-b border-gray-700 text-[10px] bg-gray-900`}>
                Price
              </th>
              {events.map((ev) => {
                const dt = new Date(ev.endDate);
                return (
                  <th key={ev.slug} className="px-0.5 py-1 border-b border-gray-700 text-[10px] bg-gray-900">
                    <a
                      href={`https://polymarket.com/event/${ev.slug}?r=mito`}
                      target="_blank"
                      rel="noreferrer"
                      className="block hover:bg-gray-800/50 rounded p-0.5 transition"
                    >
                      <div className="font-bold text-white hover:text-blue-400 text-[10px]">
                        {dayNames[dt.getDay()]} {dt.getDate()} {monthNames[dt.getMonth()]}
                      </div>
                    </a>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {prices.map((priceStr, rowIdx) => {
              const rowBorder = 'border-b border-gray-700/50';
              const isAnchorRow = rowIdx === anchorRowIdx;
              return (
              <tr key={priceStr} className="hover:bg-gray-800/50" ref={isAnchorRow ? scrollToCenterRef('hit') : (rowIdx === closestRowIdx ? scrollToCenterRef('hit-closest') : undefined)}>
                <td className={`price-col-cell sticky left-0 bg-gray-900 z-10 px-1 py-0.5 font-bold ${titleColor} ${rowBorder} whitespace-nowrap text-xs`}>
                  {(() => {
                    const arrow = priceStr.includes('↑') ? '↑' : priceStr.includes('↓') ? '↓' : '';
                    const num = hitPrice(priceStr);
                    const fmt = num >= 1000 ? (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1) + 'k' : String(num);
                    const pct = livePrice > 0 && num > 0 ? ((num - livePrice) / livePrice) * 100 : 0;
                    const pctSign = pct >= 0 ? '+' : '';
                    const isAtPrice = livePrice > 0 && Math.abs(pct) < 0.5;
                    return (
                      <div className="flex flex-col leading-tight">
                        <span>{arrow}{fmt}</span>
                        {!isAtPrice && pct !== 0 && (
                          <span className="text-gray-400 text-[11px]">{pctSign}{pct.toFixed(0)}%</span>
                        )}
                      </div>
                    );
                  })()}
                </td>
                {events.map((ev) => {
                  const market = hitLookup[priceStr]?.[ev.slug];
                  if (!market) {
                    return <td key={ev.slug} className={`text-center px-1 py-0.5 ${rowBorder} text-gray-600 text-[10px]`} style={{ minWidth: 68 }}>-</td>;
                  }

                  const { bestBid: _hBid } = getLiveBidAsk(market);
                  const tokenIds = market.clobTokenIds || [];
                  const yesTokenId = tokenIds[0] || '';
                  const noTokenId = tokenIds[1] || '';
                  const gammaYes = { bestBid: market.bestBid, bestAsk: market.bestAsk };
                  const yesMidProb = outcomeMidOrOneSideProb(yesTokenId, _bidAskLookup, gammaYes);
                  const noProbCents = yesMidProb != null ? (1 - yesMidProb) * 100 : null;
                  const yesMidStr = yesMidProb != null ? (yesMidProb * 100).toFixed(1) : '-';
                  const noMidStr = noProbCents != null ? noProbCents.toFixed(1) : '-';
                  const yesProb = yesMidProb ?? _hBid ?? 0;
                  const hitDeltaBg = deltaBgStyle(priceStr, yesMidProb, ev.endDate, true);
                  const isSelected = selectedMarket?.id === market.id;

                  const yesPos = positionLookup[yesTokenId];
                  const noPos = positionLookup[noTokenId];
                  const yesOrders = orderLookup[yesTokenId] || [];
                  const noOrders = orderLookup[noTokenId] || [];
                  const yesBuyOrders = yesOrders.filter((o) => o.side === 'BUY');
                  const noBuyOrders = noOrders.filter((o) => o.side === 'BUY');
                  const yesSellOrders = yesOrders.filter((o) => o.side === 'SELL');
                  const noSellOrders = noOrders.filter((o) => o.side === 'SELL');
                  const wbUsdc =
                    typeof _bidAskLookup[yesTokenId]?.winnerBias === 'number' &&
                    Number.isFinite(_bidAskLookup[yesTokenId]?.winnerBias)
                      ? _bidAskLookup[yesTokenId]!.winnerBias!
                      : 0;
                  const smsRaw = _bidAskLookup[yesTokenId]?.provenSMS ?? 0;
                  const smsPct = Math.max(2, Math.min(98, 50 + smsRaw * 50));
                  const concRaw =
                    typeof _bidAskLookup[yesTokenId]?.concentration === 'number' &&
                    Number.isFinite(_bidAskLookup[yesTokenId]?.concentration)
                      ? _bidAskLookup[yesTokenId]!.concentration!
                      : 0;
                  const concPct = Math.max(0, Math.min(100, concRaw * 100));
                  const cR = Math.round(Math.min(255, concRaw * 2 * 255));
                  const cG = Math.round(Math.min(255, (1 - concRaw) * 2 * 255));
                  const concColor = `rgb(${cR}, ${cG}, 0)`;
                  const wbPct = Math.max(2, Math.min(98, 50 + wbUsdc * 50));

                  return (
                    <td
                      key={ev.slug}
                      data-market-id={market.id}
                      className={`market-cell px-0.5 py-1 text-center ${rowBorder} whitespace-nowrap border border-gray-700 relative cursor-pointer hover:brightness-125 ${isSelected ? 'selected' : ''}`}
                      style={{ minWidth: 68, ...hitDeltaBg }}
                      onClick={() => handleCellClick(market)}
                    >
                      {/* Signal diff overlays */}
                      {signalsOnGrid && signalByMarket[market.id] && (
                        <>
                          {signalByMarket[market.id].yesDiff && (
                            <div className="absolute top-0 left-0 text-[7px] font-bold leading-none px-[2px] text-black bg-green-400 rounded-br-sm z-10">{signalByMarket[market.id].yesDiff}</div>
                          )}
                          {signalByMarket[market.id].noDiff && (
                            <div className="absolute top-0 right-0 text-[7px] font-bold leading-none px-[2px] text-black bg-green-400 rounded-bl-sm z-10">{signalByMarket[market.id].noDiff}</div>
                          )}
                        </>
                      )}
                      {/* YES mid | P(NO)¢ = 100 − YES mid */}
                      <MarketCellMidRow
                        className="text-[10px] text-gray-400"
                        left={
                          <span
                            className="ob-trigger text-green-400 cursor-pointer hover:underline"
                            data-token-id={yesTokenId}
                            data-market-title={`${market.question || market.groupItemTitle || ''} (YES mid)`}
                            data-asset={asset}
                            data-strike={market.groupItemTitle || ''}
                            data-end-date={ev.endDate || ''}
                            onClick={(e) => { e.stopPropagation(); handleCellClick(market, 'YES'); }}
                          >{yesMidStr}</span>
                        }
                        right={
                          <span
                            className="ob-trigger text-red-400 cursor-pointer hover:underline"
                            data-token-id={noTokenId}
                            data-market-title={`${market.question || market.groupItemTitle || ''} (P(NO) ¢)`}
                            data-asset={asset}
                            data-strike={market.groupItemTitle || ''}
                            data-end-date={ev.endDate || ''}
                            onClick={(e) => { e.stopPropagation(); handleCellClick(market, 'NO'); }}
                          >{noMidStr}</span>
                        }
                      />

                      {/* Position indicators */}
                      {(yesPos || noPos) && (
                        <div className="mt-0.5 text-[9px] border-t border-gray-600/50 pt-0.5">
                          {yesPos && (
                            <div className="text-green-300 text-center">{fmtSz(yesPos.size)}</div>
                          )}
                          {noPos && (
                            <div className="text-red-300 text-center">{fmtSz(noPos.size)}</div>
                          )}
                        </div>
                      )}

                      {/* Order badges */}
                      {yesBuyOrders.length > 0 && (
                        <div className="absolute bottom-0 left-0 bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tr-sm">
                          {(Math.max(...yesBuyOrders.map((o) => parseFloat(o.price || '0') * 100))).toFixed(1)}
                        </div>
                      )}
                      {yesSellOrders.length > 0 && (
                        <div className={`absolute ${yesBuyOrders.length > 0 ? 'bottom-[9px]' : 'bottom-0'} left-0 bg-yellow-400 text-[7px] px-[2px] leading-none font-bold rounded-tr-sm`} style={{ color: '#78350f' }}>
                          {(Math.min(...yesSellOrders.map((o) => parseFloat(o.price || '0') * 100))).toFixed(1)}
                        </div>
                      )}
                      {noBuyOrders.length > 0 && (
                        <div className="absolute bottom-0 right-0 bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tl-sm">
                          {(Math.max(...noBuyOrders.map((o) => parseFloat(o.price || '0') * 100))).toFixed(1)}
                        </div>
                      )}
                      {noSellOrders.length > 0 && (
                        <div className={`absolute ${noBuyOrders.length > 0 ? 'bottom-[9px]' : 'bottom-0'} right-0 bg-yellow-400 text-[7px] px-[2px] leading-none font-bold rounded-tl-sm`} style={{ color: '#78350f' }}>
                          {(Math.min(...noSellOrders.map((o) => parseFloat(o.price || '0') * 100))).toFixed(1)}
                        </div>
                      )}
                      {/* Concentration — left vertical bar, grows upward */}
                      <div
                        className="absolute left-0 bottom-0 w-[2px] pointer-events-none z-0 bg-gray-800/80 overflow-hidden"
                        style={{ height: '100%' }}
                        title={`Concentration (top wallets): ${concPct.toFixed(0)}%`}
                      >
                        <div
                          className="absolute bottom-0 left-0 w-full transition-all"
                          style={{ height: `${concPct}%`, backgroundColor: concColor }}
                        />
                      </div>
                      <div
                        className="absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none z-[1] flex"
                        title={`Winners $ (USDC bias, top 30%): ${(wbUsdc * 100).toFixed(0)}%`}
                      >
                        <div className="bg-cyan-400/75 h-full shrink-0 transition-[width]" style={{ width: `${wbPct}%` }} />
                        <div className="bg-pink-400/75 h-full flex-1 min-w-0" />
                      </div>
                      <div
                        className="absolute bottom-[2px] left-0 right-0 h-[2px] pointer-events-none z-[1] flex"
                        title={`Smart Money (proven wallets): ${(smsRaw * 100).toFixed(0)}%`}
                      >
                        <div className="bg-yellow-400/75 h-full shrink-0 transition-[width]" style={{ width: `${smsPct}%` }} />
                        <div className="bg-purple-400/75 h-full flex-1 min-w-0" />
                      </div>
                    </td>
                  );
                })}
              </tr>
            );})}
          </tbody>
        </table>
      </div>
    );
  };

  const renderUpOrDownTable = () => {
    const assetData = upOrDownMarkets[asset] || {};
    const timeframes = ['5m', '15m', '1h', '4h', '24h'] as const;
    const colLabels = showPast ? ['Past', 'Current'] : ['Current'];
    const now = Date.now();

    // For each timeframe, sort markets by endDate and classify as past/current/next
    const rows: Record<string, (Market | null)[]> = {};
    for (const tf of timeframes) {
      const markets = (assetData[tf] || [])
        .filter(m => !m.closed)
        .sort((a, b) => {
          const ta = a.endDate ? new Date(a.endDate).getTime() : Infinity;
          const tb = b.endDate ? new Date(b.endDate).getTime() : Infinity;
          return ta - tb;
        });

      // Find the "current" market: first one whose endDate is in the future
      let currentIdx = markets.findIndex(m => m.endDate && new Date(m.endDate).getTime() > now);
      if (currentIdx === -1) currentIdx = markets.length; // all past

      const past = currentIdx > 0 ? markets[currentIdx - 1] : null;
      const current = currentIdx < markets.length ? markets[currentIdx] : null;
      rows[tf] = showPast ? [past, current] : [current];
    }

    // Check if we have any data at all
    const hasData = timeframes.some(tf => rows[tf].some((m: Market | null) => m !== null));
    if (!hasData) return null;

    return (
      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-20 bg-gray-900">
            <tr>
              <th className={`px-1 py-1 text-center ${titleColor} font-bold border-b border-gray-700 text-[10px] bg-gray-900`}></th>
              <th className="px-1 py-1 text-center border-b border-gray-700 text-[10px] bg-gray-900 font-bold text-gray-400">Target</th>
              {colLabels.map(label => (
                <th key={label} className="px-1 py-1 text-center border-b border-gray-700 text-[10px] bg-gray-900 font-bold text-white">{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {timeframes.map(tf => {
              const tfDurations: Record<string, number> = { '5m': 5*60*1000, '15m': 15*60*1000, '1h': 60*60*1000, '4h': 4*60*60*1000, '24h': 24*60*60*1000 };
              const duration = tfDurations[tf] || 0;
              const currentMarket = showPast ? rows[tf][1] : rows[tf][0];
              const tfEndMs = currentMarket?.endDate ? new Date(currentMarket.endDate).getTime() : 0;
              const tfStartMs = tfEndMs - duration;
              const tfProgress = tfEndMs > 0 && duration > 0 ? Math.max(0, Math.min(1, (now - tfStartMs) / duration)) : 0;
              const tfProgressPct = (tfProgress * 100).toFixed(1);
              const tfRemaining = tfEndMs - now;
              const fmtCountdown = (ms: number) => { if (ms <= 0) return '0s'; const s = Math.floor(ms/1000); if (s < 60) return s+'s'; const m = Math.floor(s/60); if (m < 60) return m+'m'; const h = Math.floor(m/60); if (h < 24) return h+'h'; return Math.floor(h/24)+'d'; };

              return (
              <tr key={tf} className="hover:bg-gray-800/50">
                <td className="px-1 py-1 font-bold text-white border-b border-gray-700/50 text-[10px] bg-gray-900 whitespace-nowrap relative">
                  <div className="flex items-center justify-between gap-1">
                    <span>{tf}</span>
                    <span className={`text-[8px] font-normal ${tfRemaining > 0 && tfRemaining < 60000 ? 'text-red-400' : tfRemaining > 0 && tfRemaining < 300000 ? 'text-yellow-400' : 'text-green-400'}`}>{tfEndMs > 0 ? fmtCountdown(tfRemaining) : ''}</span>
                  </div>
                  <div className="absolute bottom-0 left-0 h-[2px]" style={{ width: `${tfProgressPct}%`, backgroundColor: 'rgba(6,182,212,0.6)' }} />
                </td>
                <td className={`px-1 py-0.5 border-b border-gray-700/50 text-[9px] text-right ${titleColor} bg-gray-900 whitespace-nowrap`}>
                  {(() => {
                    for (const m of rows[tf]) {
                      if (!m) continue;
                      const p = m.priceToBeat ?? _bidAskLookup[m.clobTokenIds?.[0] || '']?.priceToBeat;
                      if (p != null) return p.toLocaleString(undefined, { maximumFractionDigits: asset === 'BTC' ? 0 : 2 });
                    }
                    return '-';
                  })()}
                </td>
                {rows[tf].map((market: Market | null, colIdx: number) => {
                  if (!market) {
                    return <td key={colIdx} className="text-center px-1 py-1 border-b border-gray-700/50 text-gray-600 text-[10px]">-</td>;
                  }

                  const { bestBid: _uBid } = getLiveBidAsk(market);
                  const tokenIds = market.clobTokenIds || [];
                  const yesTokenId = tokenIds[0] || '';
                  const noTokenId = tokenIds[1] || '';
                  const gammaYes = { bestBid: market.bestBid, bestAsk: market.bestAsk };
                  const yesMidProb = outcomeMidOrOneSideProb(yesTokenId, _bidAskLookup, gammaYes);
                  const noProbCents = yesMidProb != null ? (1 - yesMidProb) * 100 : null;
                  const yesMidStr = yesMidProb != null ? (yesMidProb * 100).toFixed(1) : '-';
                  const noMidStr = noProbCents != null ? noProbCents.toFixed(1) : '-';
                  const yesProb = yesMidProb ?? _uBid ?? 0;
                  const isPast = showPast && colIdx === 0;
                  const ptb = market.priceToBeat ?? _bidAskLookup[yesTokenId]?.priceToBeat;
                  const udDeltaBg = (!isPast && ptb != null)
                    ? deltaBgStyle('>' + ptb, yesMidProb, market.endDate)
                    : {};
                  const isSelected = selectedMarket?.id === market.id;

                  const yesPos = positionLookup[yesTokenId];
                  const noPos = positionLookup[noTokenId];
                  const yesOrders = orderLookup[yesTokenId] || [];
                  const noOrders = orderLookup[noTokenId] || [];
                  const yesBuyOrders = yesOrders.filter((o) => o.side === 'BUY');
                  const noBuyOrders = noOrders.filter((o) => o.side === 'BUY');
                  const wbUsdc =
                    typeof _bidAskLookup[yesTokenId]?.winnerBias === 'number' &&
                    Number.isFinite(_bidAskLookup[yesTokenId]?.winnerBias)
                      ? _bidAskLookup[yesTokenId]!.winnerBias!
                      : 0;
                  const smsRaw = _bidAskLookup[yesTokenId]?.provenSMS ?? 0;
                  const smsPct = Math.max(2, Math.min(98, 50 + smsRaw * 50));
                  const concRaw =
                    typeof _bidAskLookup[yesTokenId]?.concentration === 'number' &&
                    Number.isFinite(_bidAskLookup[yesTokenId]?.concentration)
                      ? _bidAskLookup[yesTokenId]!.concentration!
                      : 0;
                  const concPct = Math.max(0, Math.min(100, concRaw * 100));
                  const cR = Math.round(Math.min(255, concRaw * 2 * 255));
                  const cG = Math.round(Math.min(255, (1 - concRaw) * 2 * 255));
                  const concColor = `rgb(${cR}, ${cG}, 0)`;
                  const wbPct = Math.max(2, Math.min(98, 50 + wbUsdc * 50));

                  const fmtSz = (sz: number) => {
                    const v = Math.floor(sz);
                    return v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : v.toLocaleString();
                  };

                  return (
                    <td
                      key={colIdx}
                      data-market-id={market.id}
                      className={`market-cell px-0.5 py-1 text-center border-b border-gray-700/50 ${isPast ? 'opacity-50 bg-gray-700/30' : ''} whitespace-nowrap border border-gray-400 relative cursor-pointer hover:brightness-125 ${isSelected ? 'selected' : ''}`}
                      style={{ minWidth: 60, ...udDeltaBg }}
                      onClick={() => handleCellClick(market)}
                    >
                      {/* YES mid | P(NO)¢ = 100 − YES mid */}
                      <MarketCellMidRow
                        className="text-[10px] text-gray-400"
                        left={
                          <span
                            className="ob-trigger text-green-400 cursor-pointer hover:underline"
                            data-token-id={yesTokenId}
                            data-market-title={`${market.question || ''} (YES mid)`}
                            data-asset={asset}
                            data-strike={market.groupItemTitle || ''}
                            data-end-date={market.endDate || ''}
                            onClick={(e) => { e.stopPropagation(); handleCellClick(market, 'YES'); }}
                          >{yesMidStr}</span>
                        }
                        right={
                          <span
                            className="ob-trigger text-red-400 cursor-pointer hover:underline"
                            data-token-id={noTokenId}
                            data-market-title={`${market.question || ''} (P(NO) ¢)`}
                            data-asset={asset}
                            data-strike={market.groupItemTitle || ''}
                            data-end-date={market.endDate || ''}
                            onClick={(e) => { e.stopPropagation(); handleCellClick(market, 'NO'); }}
                          >{noMidStr}</span>
                        }
                      />

                      {/* Position indicators */}
                      {(yesPos || noPos) && (
                        <div className="mt-0.5 text-[9px] border-t border-gray-600/50 pt-0.5">
                          {yesPos && <div className="text-green-300 text-center">{fmtSz(yesPos.size)}</div>}
                          {noPos && <div className="text-red-300 text-center">{fmtSz(noPos.size)}</div>}
                        </div>
                      )}

                      {/* Order badges */}
                      {yesBuyOrders.length > 0 && (
                        <div className="absolute bottom-0 left-0 bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tr-sm">
                          {(Math.max(...yesBuyOrders.map((o) => parseFloat(o.price || '0') * 100))).toFixed(1)}
                        </div>
                      )}
                      {noBuyOrders.length > 0 && (
                        <div className="absolute bottom-0 right-0 bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tl-sm">
                          {(Math.max(...noBuyOrders.map((o) => parseFloat(o.price || '0') * 100))).toFixed(1)}
                        </div>
                      )}
                      {/* Concentration — left vertical bar, grows upward */}
                      <div
                        className="absolute left-0 bottom-0 w-[2px] pointer-events-none z-0 bg-gray-800/80 overflow-hidden"
                        style={{ height: '100%' }}
                        title={`Concentration (top wallets): ${concPct.toFixed(0)}%`}
                      >
                        <div
                          className="absolute bottom-0 left-0 w-full transition-all"
                          style={{ height: `${concPct}%`, backgroundColor: concColor }}
                        />
                      </div>
                      <div
                        className="absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none z-[1] flex"
                        title={`Winners $ (USDC bias, top 30%): ${(wbUsdc * 100).toFixed(0)}%`}
                      >
                        <div className="bg-cyan-400/75 h-full shrink-0 transition-[width]" style={{ width: `${wbPct}%` }} />
                        <div className="bg-pink-400/75 h-full flex-1 min-w-0" />
                      </div>
                      <div
                        className="absolute bottom-[2px] left-0 right-0 h-[2px] pointer-events-none z-[1] flex"
                        title={`Smart Money (proven wallets): ${(smsRaw * 100).toFixed(0)}%`}
                      >
                        <div className="bg-yellow-400/75 h-full shrink-0 transition-[width]" style={{ width: `${smsPct}%` }} />
                        <div className="bg-purple-400/75 h-full flex-1 min-w-0" />
                      </div>
                    </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderTable = (markets: Market[], tableType: string) => {
    if (markets.length === 0) {
      return <div className="text-gray-500 text-center py-2 text-xs">No markets</div>;
    }

    const { dates, prices, marketLookup } = buildTableData(markets);

    if (dates.length === 0 || prices.length === 0) {
      return <div className="text-gray-500 text-center py-2 text-xs">No active markets</div>;
    }

    // Above tables: anchor scroll to last row where live price satisfies the strike condition
    let aboveAnchorRowIdx = -1;
    if (tableType === 'above') {
      for (let i = 0; i < prices.length; i++) {
        if (isPriceConditionTrue(prices[i], livePrice)) aboveAnchorRowIdx = i;
      }
    }

    // Find closest row to livePrice as fallback for centering
    let closestPriceRowIdx = -1;
    if (livePrice > 0) {
      let minDist = Infinity;
      for (let i = 0; i < prices.length; i++) {
        const b = parsePriceBounds(prices[i]);
        const mid = b.high === Infinity ? b.low : (b.low + b.high) / 2;
        const dist = Math.abs(mid - livePrice);
        if (dist < minDist) { minDist = dist; closestPriceRowIdx = i; }
      }
    }

    return (
      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-20 bg-gray-900">
            <tr>
              <th className={`sticky left-0 bg-gray-900 z-30 px-1 py-1 text-left ${titleColor} font-bold border-b border-gray-700 text-[10px]`}>
                Price
              </th>
              {dates.map((d) => {
                const dt = new Date(d.endDate);
                const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
                const isEnded = d.endDate && new Date(d.endDate).getTime() < Date.now();
                const isDateHighlighted = false;
                return (
                  <th
                    key={d.slug}
                    className={`px-1 py-1 text-center border-b border-gray-700 min-w-[70px] bg-gray-900 ${isEnded ? 'opacity-50' : ''} ${isWeekend ? 'bg-purple-900/20' : ''} ${isDateHighlighted ? 'date-column-highlighted' : ''}`}
                  >
                    <a
                      href={`https://polymarket.com/event/${d.slug}?r=mito`}
                      target="_blank"
                      rel="noreferrer"
                      className="block hover:bg-gray-800/50 rounded p-0.5 transition"
                    >
                      <div className={`font-bold ${isWeekend ? 'text-purple-400' : 'text-white'} hover:text-blue-400 text-[10px]`}>
                        {['Su','Mo','Tu','We','Th','Fr','Sa'][dt.getDay()]} {formatDateShort(d.endDate)}
                      </div>
                    </a>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {prices.map((priceStr, rowIdx) => {
              const conditionTrue = isPriceConditionTrue(priceStr, livePrice);
              const priceCellBg = conditionTrue ? 'bg-green-900/50' : 'bg-gray-900';
              const priceFontSize = tableType === 'price' ? 'text-[10px]' : 'text-xs';
              const isAboveAnchorRow = tableType === 'above' && rowIdx === aboveAnchorRowIdx;

              // % change from live price
              const bounds = parsePriceBounds(priceStr);
              const isCurrentRange = livePrice > bounds.low && livePrice < bounds.high;
              let targetPrice: number;
              if (livePrice <= bounds.low) targetPrice = bounds.low;
              else if (livePrice >= bounds.high) targetPrice = bounds.high;
              else targetPrice = livePrice;
              const pctChange = livePrice > 0 && targetPrice > 0 && targetPrice !== Infinity
                ? ((targetPrice - livePrice) / livePrice) * 100 : 0;
              const pctSign = pctChange >= 0 ? '+' : '';

              return (
                <tr key={priceStr} className="hover:bg-gray-800/50" ref={isAboveAnchorRow ? scrollToCenterRef(tableType + '-yellow') : (isCurrentRange ? scrollToCenterRef(tableType + '-range') : (rowIdx === closestPriceRowIdx ? scrollToCenterRef(tableType + '-closest') : undefined))}>
                  <td
                    className={`price-col-cell sticky left-0 ${priceCellBg} z-10 px-1 py-0.5 font-bold ${titleColor} border-b border-gray-700/50 whitespace-nowrap ${priceFontSize}`}
                    data-price-low={bounds.low}
                    data-price-high={bounds.high === Infinity ? 999999999 : bounds.high}
                  >
                    <div className="flex flex-col leading-tight">
                      <span>{formatPriceShort(priceStr)}</span>
                      {!isCurrentRange && pctChange !== 0 && (
                        <span className="text-gray-400 text-[11px]">{pctSign}{pctChange.toFixed(0)}%</span>
                      )}
                    </div>
                  </td>
                  {dates.map((d) => {
                    const market = marketLookup[priceStr + '_' + d.slug];
                    const dateEnded = d.endDate && new Date(d.endDate).getTime() < Date.now();
                    const dt = new Date(d.endDate);
                    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;

                  if (!market) {
                    return (
                      <td key={d.slug} className={`text-center px-1 py-0.5 border-b border-gray-700/50 text-gray-600 text-[10px] ${dateEnded ? 'opacity-50' : ''} ${isWeekend ? 'bg-purple-900/20' : ''}`}>
                        -
                      </td>
                    );
                  }

                  const isClosed = market.closed || dateEnded;

                  const tokenIds = market.clobTokenIds || [];
                  const yesTokenId = tokenIds[0] || '';
                  const noTokenId = tokenIds[1] || '';

                  const { bestBid: _aBid } = getLiveBidAsk(market);
                  const gammaYes = { bestBid: market.bestBid, bestAsk: market.bestAsk };
                  const yesMidProb = outcomeMidOrOneSideProb(yesTokenId, _bidAskLookup, gammaYes);
                  const noProbCents = yesMidProb != null ? (1 - yesMidProb) * 100 : null;
                  const yesMidStr = yesMidProb != null ? (yesMidProb * 100).toFixed(1) : '-';
                  const noMidStr = noProbCents != null ? noProbCents.toFixed(1) : '-';

                  const gridDeltaBg = !isClosed ? deltaBgStyle(priceStr, yesMidProb, d.endDate) : {};
                  const bgColor = isClosed ? 'bg-gray-700/30' : '';

                  const conditionMet = isPriceConditionTrue(priceStr, livePrice);
                  const borderClass = 'border border-gray-700';

                  // Positions
                  const yesPos = positionLookup[yesTokenId];
                  const noPos = positionLookup[noTokenId];
                  const yesWinning = conditionMet;
                  const noWinning = !conditionMet && livePrice > 0;

                  // Orders
                  const yesOrders = orderLookup[yesTokenId] || [];
                  const noOrders = orderLookup[noTokenId] || [];
                  const yesBuyOrders = yesOrders.filter((o) => o.side === 'BUY');
                  const noBuyOrders = noOrders.filter((o) => o.side === 'BUY');
                  const yesSellOrders = yesOrders.filter((o) => o.side === 'SELL');
                  const noSellOrders = noOrders.filter((o) => o.side === 'SELL');
                  const wbUsdc =
                    typeof _bidAskLookup[yesTokenId]?.winnerBias === 'number' &&
                    Number.isFinite(_bidAskLookup[yesTokenId]?.winnerBias)
                      ? _bidAskLookup[yesTokenId]!.winnerBias!
                      : 0;
                  const smsRaw = _bidAskLookup[yesTokenId]?.provenSMS ?? 0;
                  const smsPct = Math.max(2, Math.min(98, 50 + smsRaw * 50));
                  const concRaw =
                    typeof _bidAskLookup[yesTokenId]?.concentration === 'number' &&
                    Number.isFinite(_bidAskLookup[yesTokenId]?.concentration)
                      ? _bidAskLookup[yesTokenId]!.concentration!
                      : 0;
                  const concPct = Math.max(0, Math.min(100, concRaw * 100));
                  const cR = Math.round(Math.min(255, concRaw * 2 * 255));
                  const cG = Math.round(Math.min(255, (1 - concRaw) * 2 * 255));
                  const concColor = `rgb(${cR}, ${cG}, 0)`;
                  const wbPct = Math.max(2, Math.min(98, 50 + wbUsdc * 50));

                  // Format size (1000+ => 1.2k)
                  const fmtSz = (sz: number) => {
                    const v = Math.floor(sz);
                    return v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : v.toLocaleString();
                  };

                  const isSelected = selectedMarket?.id === market.id;
                  const isColHighlighted = false;

                  return (
                    <td
                      key={d.slug}
                      data-market-id={market.id}
                      className={`market-cell px-0.5 py-0.5 text-center border-b border-gray-700/50 ${bgColor} ${isClosed ? 'opacity-50' : ''} whitespace-nowrap ${borderClass} relative cursor-pointer hover:brightness-125 ${isSelected ? 'selected' : ''} ${isColHighlighted && !isSelected ? 'date-column-highlighted' : ''}`}
                      style={{
                        ...(isWeekend && !isSelected && !isColHighlighted ? { boxShadow: 'inset 0 0 0 100px rgba(147, 51, 234, 0.08)' } : {}),
                        ...gridDeltaBg,
                      }}
                      onClick={() => handleCellClick(market)}
                    >
                      {/* Signal diff overlays (top corners) */}
                      {signalsOnGrid && signalByMarket[market.id] && (
                        <>
                          {signalByMarket[market.id].yesDiff && (
                            <div className="absolute top-0 left-0 text-[7px] font-bold leading-none px-[2px] text-black bg-green-400 rounded-br-sm z-10">{signalByMarket[market.id].yesDiff}</div>
                          )}
                          {signalByMarket[market.id].noDiff && (
                            <div className="absolute top-0 right-0 text-[7px] font-bold leading-none px-[2px] text-black bg-green-400 rounded-bl-sm z-10">{signalByMarket[market.id].noDiff}</div>
                          )}
                        </>
                      )}
                      {/* YES mid | P(NO)¢ = 100 − YES mid */}
                      <MarketCellMidRow
                        className="text-[10px] text-gray-400"
                        left={
                          <span
                            className="ob-trigger text-green-400 cursor-pointer hover:underline"
                            data-token-id={yesTokenId}
                            data-market-title={`${market.question || market.groupItemTitle || ''} (YES mid)`}
                            data-asset={asset}
                            data-strike={market.groupItemTitle || ''}
                            data-end-date={d.endDate || ''}
                            onClick={(e) => { e.stopPropagation(); handleCellClick(market, 'YES'); }}
                          >{yesMidStr}</span>
                        }
                        right={
                          <span
                            className="ob-trigger text-red-400 cursor-pointer hover:underline"
                            data-token-id={noTokenId}
                            data-market-title={`${market.question || market.groupItemTitle || ''} (P(NO) ¢)`}
                            data-asset={asset}
                            data-strike={market.groupItemTitle || ''}
                            data-end-date={d.endDate || ''}
                            onClick={(e) => { e.stopPropagation(); handleCellClick(market, 'NO'); }}
                          >{noMidStr}</span>
                        }
                      />

                      {/* Position indicators */}
                      {(yesPos || noPos) && (
                        <div className="mt-0.5 text-[9px] border-t border-gray-600/50 pt-0.5">
                          {yesPos && (
                            <div className={`text-green-300 text-center ${yesWinning ? 'bg-green-500/40 px-1 rounded font-bold' : (livePrice > 0 ? 'bg-red-500/40 px-1 rounded' : '')}`}>
                              {fmtSz(yesPos.size)}
                            </div>
                          )}
                          {noPos && (
                            <div className={`text-red-300 text-center ${noWinning ? 'bg-green-500/40 px-1 rounded font-bold' : (livePrice > 0 ? 'bg-red-500/40 px-1 rounded' : '')}`}>
                              {fmtSz(noPos.size)}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Order badges - YES bottom-left, NO bottom-right */}
                      {yesBuyOrders.length > 0 && (
                        <div className="absolute bottom-0 left-0 bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tr-sm">
                          {(Math.max(...yesBuyOrders.map((o) => parseFloat(o.price || '0') * 100))).toFixed(1)}
                        </div>
                      )}
                      {yesSellOrders.length > 0 && (
                        <div className={`absolute ${yesBuyOrders.length > 0 ? 'bottom-[9px]' : 'bottom-0'} left-0 bg-yellow-400 text-[7px] px-[2px] leading-none font-bold rounded-tr-sm`} style={{ color: '#78350f' }}>
                          {(Math.min(...yesSellOrders.map((o) => parseFloat(o.price || '0') * 100))).toFixed(1)}
                        </div>
                      )}
                      {noBuyOrders.length > 0 && (
                        <div className="absolute bottom-0 right-0 bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tl-sm">
                          {(Math.max(...noBuyOrders.map((o) => parseFloat(o.price || '0') * 100))).toFixed(1)}
                        </div>
                      )}
                      {noSellOrders.length > 0 && (
                        <div className={`absolute ${noBuyOrders.length > 0 ? 'bottom-[9px]' : 'bottom-0'} right-0 bg-yellow-400 text-[7px] px-[2px] leading-none font-bold rounded-tl-sm`} style={{ color: '#78350f' }}>
                          {(Math.min(...noSellOrders.map((o) => parseFloat(o.price || '0') * 100))).toFixed(1)}
                        </div>
                      )}
                      {/* Concentration — left vertical bar, grows upward */}
                      <div
                        className="absolute left-0 bottom-0 w-[2px] pointer-events-none z-0 bg-gray-800/80 overflow-hidden"
                        style={{ height: '100%' }}
                        title={`Concentration (top wallets): ${concPct.toFixed(0)}%`}
                      >
                        <div
                          className="absolute bottom-0 left-0 w-full transition-all"
                          style={{ height: `${concPct}%`, backgroundColor: concColor }}
                        />
                      </div>
                      <div
                        className="absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none z-[1] flex"
                        title={`Winners $ (USDC bias, top 30%): ${(wbUsdc * 100).toFixed(0)}%`}
                      >
                        <div className="bg-cyan-400/75 h-full shrink-0 transition-[width]" style={{ width: `${wbPct}%` }} />
                        <div className="bg-pink-400/75 h-full flex-1 min-w-0" />
                      </div>
                      <div
                        className="absolute bottom-[2px] left-0 right-0 h-[2px] pointer-events-none z-[1] flex"
                        title={`Smart Money (proven wallets): ${(smsRaw * 100).toFixed(0)}%`}
                      >
                        <div className="bg-yellow-400/75 h-full shrink-0 transition-[width]" style={{ width: `${smsPct}%` }} />
                        <div className="bg-purple-400/75 h-full flex-1 min-w-0" />
                      </div>
                    </td>
                  );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  // Format slot value
  const fmtSlotValue = (val: { low: number; high: number } | null) => {
    if (!val) return null;
    return `${val.low}-${val.high}`;
  };

  // VWAP display
  const vwapFmt = vwapPrice > 0
    ? formatPrice(vwapPrice, asset) + ' (' + (livePrice > 0 ? ((livePrice - vwapPrice) / vwapPrice * 100 >= 0 ? '+' : '') + ((livePrice - vwapPrice) / vwapPrice * 100).toFixed(1) + '%' : '0.0%') + ')'
    : '';

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3">
      {/* Asset Title */}
      <div className="panel-header">
        <h3 className={`text-sm font-bold mb-2 flex items-center gap-1 flex-wrap ${titleColor}`}>
          <span className="relative no-drag inline-flex items-center cursor-pointer select-none" onClick={() => setAssetDropdownOpen(v => !v)}>
            {asset}:{' '}
            <span className="font-bold">
              {livePrice > 0 ? formatPrice(livePrice, asset) : '--'}
            </span>
            <svg className="w-3 h-3 ml-0.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            {assetDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[80px]">
                {ALL_ASSETS.map(a => (
                  <div
                    key={a}
                    className={`px-3 py-1 text-xs font-bold hover:bg-gray-700 cursor-pointer ${a === asset ? 'text-white bg-gray-700' : 'text-gray-300'}`}
                    onClick={(e) => { e.stopPropagation(); setAsset(a); localStorage.setItem(`polybot-grid-asset-${panelId}`, a); setAssetDropdownOpen(false); }}
                  >{a}</div>
                ))}
              </div>
            )}
          </span>
          {vwapPrice > 0 && (
            <>
              <span className="text-[11px] text-gray-500 font-normal">{vwapFmt}</span>
              <HelpTooltip text={"This is the VWAP (Volume Weighted Average Price) calculated from recent candles. The percentage shows how far the live price has deviated from VWAP.\n\nVWAP is used as the underlying price for all B-S probability calculations in the dashboard. A positive % means the live price is above VWAP, negative means below.\n\nTo use the live price instead of VWAP for B-S calculations, set both VWAP inputs in the header to 0."} />
            </>
          )}
          {/* Range slots */}
          {[0, 1].map((i) => {
            const slotVal = manualPriceSlots[symbol][i];
            const isActive = activeSlot === i;
            const colors = ['text-cyan-300', 'text-pink-400'];
            const borderColors = isActive
              ? ['border-cyan-300', 'border-pink-400']
              : ['border-cyan-400/40', 'border-pink-500/40'];

            // Check if VWAP is outside range
            let outOfRange = false;
            if (slotVal && vwapPrice > 0) {
              outOfRange = vwapPrice <= slotVal.low || vwapPrice >= slotVal.high;
            }

            return (
              <span key={i} className="no-drag inline-flex items-center gap-0.5">
                <span className="text-gray-600 mx-0">\</span>
                <span
                  className={`${colors[i]} text-[9px] cursor-pointer select-none ${isActive ? 'font-bold' : ''}`}
                  onClick={() => setActiveRangeSlot(symbol, i)}
                >
                  {i + 1}
                </span>
                <span
                  className={`text-[11px] font-normal ${colors[i]} ${outOfRange ? 'out-of-range-pulse' : ''} bg-gray-800 border ${borderColors[i]} rounded px-1 w-24 inline-block cursor-pointer hover:brightness-125 select-none`}
                  onClick={() => {
                    setRangeDialogSlot(i);
                    setRangeDialogOpen(true);
                  }}
                >
                  {fmtSlotValue(slotVal) || <span className="text-gray-600">low-high</span>}
                </span>
              </span>
            );
          })}
          <HelpTooltip text={"Price ranges let you see how underlying asset price moves translate into B-S probabilities, helping you find better entry and exit prices.\n\nSet two ranges:\n• Range 1 (cyan) — a tighter range, producing the BS1 values used across the app.\n• Range 2 (pink) — a wider range, producing the BS2 values.\n\nBS1 and BS2 show the max and min B-S probability across the price range. For 'Above' markets, these coincide with the range edges. For 'Between' markets, the max probability may fall in the middle of the range rather than at the edges.\n\nSince underlying price volatility directly influences probabilities and therefore the orderbook, these ranges let the trader anticipate how the market will reprice and enter/exit at better levels before the move is reflected in the orderbook.\n\nBS1 and BS2 values appear throughout the dashboard — in the grid, signals, hedges, and sidebar.\n\nIf VWAP moves outside a range, it will pulse to alert you."} />
          {sigmaEditing ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-bold text-pink-400 border border-pink-400/60 rounded px-1 py-0.5">
              <span>σ</span>
              <input
                autoFocus
                value={manualVolPctInput}
                onChange={(e) => setManualVolPctInput(e.target.value)}
                onBlur={commitManualVol}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitManualVol();
                  if (e.key === 'Escape') {
                    const raw = localStorage.getItem(`${MANUAL_VOL_KEY_PREFIX}${symbol}`);
                    setManualVolPctInput(raw ?? '');
                    setSigmaEditing(false);
                  }
                }}
                type="number"
                min={0}
                step={1}
                className="w-12 bg-transparent outline-none text-pink-300 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                title="Manual volatility % (0 resets to automatic)"
              />
              <span>%</span>
            </span>
          ) : (
            <span
              onClick={() => setSigmaEditing(true)}
              className={`text-[11px] font-bold border rounded px-1 py-0.5 cursor-pointer ${
                hasManualVol
                  ? 'text-pink-400 border-pink-400/60'
                  : 'text-yellow-400 border-yellow-400/50'
              }`}
              title="Click to set manual volatility % (0 resets to automatic)"
            >
              σ{(adjVol * 100).toFixed(0)}%
            </span>
          )}
          <HelpTooltip text={"Annualized volatility (σ) used for Black-Scholes probability calculations.\n\nThis value is fetched from Binance as the asset's historical realized volatility, then multiplied by the global volatility multiplier set in settings.\n\nHigher volatility means wider expected price distributions — strike prices further from the current price will have higher B-S probabilities. Lower volatility narrows the distribution, making distant strikes less likely.\n\nThis directly affects all B-S values shown across the dashboard: the flower, grid cells, signals, and hedges."} />
          <StrikeRangeIndicator markets={aboveMarketsForAsset} livePrice={livePrice} />
          <HelpTooltip text={"This bar shows where the current asset price sits relative to the active market strike prices.\n\nThe gray ticks at the ends are the nearest strikes below and above spot; the vertical marker is the live price between them.\n\nThis gives a quick visual sense of how close the asset is to triggering different markets — the closer the live price is to a strike, the more sensitive that market's probability becomes to small price moves."} />
          <label className="no-drag inline-flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer ml-1 font-normal">
            <input
              type="checkbox"
              checked={showPast}
              onChange={(e) => setShowPast(e.target.checked)}
              className="cursor-pointer w-3 h-3"
            />
            Past
          </label>
          <HelpTooltip text={"Show past/expired markets in the grid. When enabled, markets that have already expired will remain visible so you can review past data and outcomes."} />
          {[['Up\\Down', showUpDown, setShowUpDown, `polybot-show-updown-${panelId}`] as const,
            ['Hit', showHit, setShowHit, `polybot-show-hit-${panelId}`] as const,
            ['Above', showAbove, setShowAbove, `polybot-show-above-${panelId}`] as const,
            ['Between', showBetween, setShowBetween, `polybot-show-between-${panelId}`] as const,
          ].map(([label, val, setter, key]) => (
            <label key={key} className="no-drag inline-flex items-center gap-1 text-[10px] text-gray-400 cursor-pointer ml-1 font-normal">
              <input type="checkbox" checked={val} onChange={(e) => { setter(e.target.checked); localStorage.setItem(key, String(e.target.checked)); }} className="cursor-pointer w-3 h-3" />
              {label}
            </label>
          ))}
        </h3>
      </div>

      {/* Range Edit Dialog */}
      <RangeEditDialog
        open={rangeDialogOpen}
        asset={asset}
        slotIndex={rangeDialogSlot}
        currentLow={manualPriceSlots[symbol][rangeDialogSlot]?.low ?? null}
        currentHigh={manualPriceSlots[symbol][rangeDialogSlot]?.high ?? null}
        livePrice={livePrice}
        onConfirm={(lo, hi) => {
          setManualPriceSlot(symbol, rangeDialogSlot, { low: lo, high: hi });
          saveRange(symbol, rangeDialogSlot, lo, hi);
          showToast(`${asset} range ${rangeDialogSlot + 1} set to ${lo}-${hi}`, 'success');
          setRangeDialogOpen(false);
        }}
        onClear={() => {
          setManualPriceSlot(symbol, rangeDialogSlot, null);
          saveRange(symbol, rangeDialogSlot, null, null);
          showToast(`${asset} range ${rangeDialogSlot + 1} cleared`, 'success');
          setRangeDialogOpen(false);
        }}
        onClose={() => setRangeDialogOpen(false)}
      />

      {/* Tables: Up/Down stacked on Hit (left column) + Above + Between side by side */}
      <div className="panel-body" style={{ overflow: 'hidden' }}>
        <div className="flex gap-2 h-full">
          {/* Left column: Up/Down (no scroll, all rows) stacked on Hit (scrollable) */}
          {(showUpDown || (showHit && weeklyHitMarketsForAsset.length > 0)) && (
            <div className="shrink-0 flex flex-col gap-1" style={{ minWidth: '80px' }}>
              {showUpDown && (() => {
                const upDownContent = renderUpOrDownTable();
                if (!upDownContent) return null;
                return (
                  <div className="shrink-0 border border-sky-500/40 rounded flex flex-col">
                    <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-sky-400 bg-gray-800/50 rounded-t py-0.5">Up or Down <HelpTooltip text={"Up or Down markets are short-duration binary markets that resolve based on whether the asset price goes up or down over a fixed time window.\n\nTimeframes: 5m, 15m, 1h, 24h.\n\nEach cell shows ↑ (Up/YES price) and ↓ (Down/NO price).\n\nColumns show the previous (Past), currently active (Current), and upcoming (Next) market for each timeframe.\n\nThese markets are useful for short-term directional bets and hedging."} /></div>
                    {upDownContent}
                  </div>
                );
              })()}
              {showHit && weeklyHitMarketsForAsset.length > 0 && (
                <div className="flex-1 min-h-0 border border-orange-500/40 rounded flex flex-col overflow-hidden">
                  <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-orange-400 bg-gray-800/50 rounded-t py-0.5">Hit <HelpTooltip text={"Hit markets resolve YES if the asset price touches or crosses a specific price level at any point before expiry.\n\nUnlike Above markets which only check the price at expiry, Hit markets are path-dependent — they trigger as soon as the price 'hits' the target, regardless of where it ends up.\n\nHit markets come in two varieties: weekly (short-term, expiring each week) and monthly (longer-term, expiring at month end).\n\nRows show strike prices with ↑ (must go up to hit) or ↓ (must go down to hit). Columns show different expiry dates."} /></div>
                  {renderWeeklyHitTable()}
                </div>
              )}
            </div>
          )}
          {showAbove && (
            <div className="flex-1 min-w-0 border border-emerald-500/40 rounded flex flex-col" ref={aboveContainerRef} style={{ position: 'relative' }}>
              <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-emerald-400 bg-gray-800/50 rounded-t py-0.5">Above <HelpTooltip text={"Above markets resolve YES if the asset price is above a specific strike price at the moment of expiry (noon ET).\n\nThese are the most common market type. Each row is a different strike price and each column is a different expiry date.\n\nThe YES probability increases as the live price moves further above the strike, and decreases as it falls below. At expiry, the market resolves to 100 (YES) or 0 (NO) based purely on where the price is at that moment."} /></div>
              {renderTable(aboveMarketsForAsset, 'above')}
              <PriceTicks containerRef={aboveContainerRef} livePrice={livePrice} slot0={slot0} slot1={slot1} />
            </div>
          )}
          {showBetween && (
            <div className="flex-1 min-w-0 border border-purple-500/40 rounded flex flex-col" ref={priceOnContainerRef} style={{ position: 'relative' }}>
              <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-purple-400 bg-gray-800/50 rounded-t py-0.5">Between <HelpTooltip text={"Between markets resolve YES if the asset price falls within a specific price range at the moment of expiry (noon ET).\n\nEach row shows a price range (e.g. 95k-100k). The market pays out if the price lands inside that range at expiry.\n\nB-S probability for these markets peaks when the price is near the center of the range and drops off toward the edges. Unlike Above markets, the max probability may not be at the range boundary — it can be in the middle."} /></div>
              {renderTable(priceOnMarketsForAsset, 'price')}
              <PriceTicks containerRef={priceOnContainerRef} livePrice={livePrice} slot0={slot0} slot1={slot1} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
