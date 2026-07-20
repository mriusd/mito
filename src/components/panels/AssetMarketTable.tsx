import { useCallback, useEffect, useMemo, useRef, useState, memo, type RefObject } from 'react';
import { useAppStore } from '../../stores/appStore';
import { formatPrice, assetToSymbol, formatDateShort, getPositionClobTokenId, normalizeClobTokenId, formatPriceShort, formatThousandsAsK, parseStrikeTokenToNumber, parseHitStrikeNumber } from '../../utils/format';
import { saveRange } from '../../api';
import { showToast } from '../../utils/toast';
import { PriceTicks } from '../PriceTicks';
import { RangeEditDialog } from '../RangeEditDialog';
import { HelpTooltip } from '../HelpTooltip';
import type { AssetName, Market, Order } from '../../types';
import { GridMarketCell } from './GridMarketCell';
import { useThrottledStorePrice } from '../../hooks/useThrottledStorePrice';
import { useThrottledStoreVwap } from '../../hooks/useThrottledStoreVwap';
import { useGridSignals } from '../../lib/gridSignalsStore';
import {
  useThrottledGridOrders,
  useThrottledGridPositions,
  useThrottledOnchainGridPositions,
} from '../../hooks/useThrottledGridWallet';
import {
  AssetMarketTableHitPriceCol,
  AssetMarketTableStrikePriceCol,
} from './AssetMarketTablePriceCol';
import { AssetMarketTableScrollSync } from './AssetMarketTableScrollSync';
import { polymarketSiteUrl } from '../../lib/polymarketSiteUrl';
import {
  fetchHyperliquidOutcomesSnapshot,
  useHyperliquidOutcomesConnection,
  useHyperliquidOutcomesSnapshot,
} from '../../lib/hyperliquidOutcomesFeed';
import { hlSnapshotToAssetGrid } from '../../lib/hlMarketsForAssetGrid';

export type GridMarketSource = 'polymarket' | 'hyperliquid';

const ALL_ASSETS: AssetName[] = [
  'BTC', 'ETH', 'SOL', 'XRP',
  'WTI', 'NG', 'SPY', 'AAPL', 'GOOGL', 'NVDA', 'AMZN',
];
const MANUAL_VOL_KEY_PREFIX = 'polybot-manual-vol-pct-';
const EMPTY_ORDERS: Order[] = [];
const EMPTY_MARKETS: Market[] = [];
const EMPTY_UDM: Record<string, Market[]> = {};
const EMPTY_SIGNALS: import('../../types').Signal[] = [];

const AssetMarketTableSpotPrice = memo(function AssetMarketTableSpotPrice({
  asset,
  symbol,
}: {
  asset: AssetName;
  symbol: ReturnType<typeof assetToSymbol>;
}) {
  const livePrice = useThrottledStorePrice(symbol, 1000);
  return <span className="font-bold">{livePrice > 0 ? formatPrice(livePrice, asset) : '--'}</span>;
});

const AssetMarketTableVwapHint = memo(function AssetMarketTableVwapHint({
  asset,
  symbol,
}: {
  asset: AssetName;
  symbol: ReturnType<typeof assetToSymbol>;
}) {
  const vwapPrice = useThrottledStoreVwap(symbol, 1000);
  const spotPrice = useThrottledStorePrice(symbol, 1000);
  if (vwapPrice <= 0) return null;
  const vwapFmt =
    formatPrice(vwapPrice, asset) +
    ' (' +
    (spotPrice > 0
      ? ((spotPrice - vwapPrice) / vwapPrice * 100 >= 0 ? '+' : '') +
        ((spotPrice - vwapPrice) / vwapPrice * 100).toFixed(1) +
        '%'
      : '0.0%') +
    ')';
  return (
    <>
      <span className="text-[11px] text-gray-500 font-normal">{vwapFmt}</span>
      <HelpTooltip text={"This is the VWAP (Volume Weighted Average Price) calculated from recent candles. The percentage shows how far the live price has deviated from VWAP.\n\nVWAP is used as the underlying price for all B-S probability calculations in the dashboard. A positive % means the live price is above VWAP, negative means below.\n\nTo use the live price instead of VWAP for B-S calculations, set both VWAP inputs in the header to 0."} />
    </>
  );
});

function StrikeRangeIndicator({ markets, livePrice, asset }: { markets: Market[]; livePrice: number; asset: AssetName }) {
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
  const fmtStrike = (v: number) => (v >= 1000 ? formatThousandsAsK(v, asset === 'ETH' ? 'ETH' : undefined) : v.toString());

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

const AssetMarketTableStrikeRangeWrap = memo(function AssetMarketTableStrikeRangeWrap({
  markets,
  asset,
}: {
  markets: Market[];
  asset: AssetName;
}) {
  const livePrice = useThrottledStorePrice(assetToSymbol(asset), 1000);
  return <StrikeRangeIndicator markets={markets} livePrice={livePrice} asset={asset} />;
});

interface AssetMarketTableProps {
  asset: AssetName;
  panelId: string;
}

function AssetMarketTableInner({ asset: initialAsset, panelId }: AssetMarketTableProps) {
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
  const [gridSource, setGridSource] = useState<GridMarketSource>(() => {
    const saved = localStorage.getItem(`polybot-grid-source-${panelId}`);
    return saved === 'hyperliquid' ? 'hyperliquid' : 'polymarket';
  });
  const [sourceDropdownOpen, setSourceDropdownOpen] = useState(false);
  const isHl = gridSource === 'hyperliquid';
  const symbol = assetToSymbol(asset);
  useHyperliquidOutcomesConnection(isHl);
  const hlSnap = useHyperliquidOutcomesSnapshot();
  useEffect(() => {
    if (!isHl || hlSnap != null) return;
    void fetchHyperliquidOutcomesSnapshot();
  }, [isHl, hlSnap]);
  const hlGrid = useMemo(
    () => hlSnapshotToAssetGrid(hlSnap, asset),
    [hlSnap, asset],
  );
  const pmAbove = useAppStore((s) => s.aboveMarkets[asset] ?? EMPTY_MARKETS);
  const pmBetween = useAppStore((s) => s.priceOnMarkets[asset] ?? EMPTY_MARKETS);
  const pmWeeklyHit = useAppStore((s) => s.weeklyHitMarkets[asset] ?? EMPTY_MARKETS);
  const pmUpOrDown = useAppStore((s) => s.upOrDownMarkets[asset] ?? EMPTY_UDM);
  const aboveMarketsForAsset = isHl ? hlGrid.above : pmAbove;
  const priceOnMarketsForAsset = isHl ? hlGrid.between : pmBetween;
  const weeklyHitMarketsForAsset = isHl ? EMPTY_MARKETS : pmWeeklyHit;
  const upOrDownMarketsForAsset = isHl ? hlGrid.upOrDown : pmUpOrDown;
  const assetVol = useAppStore((s) => s.volatilityData[symbol] ?? 0.6);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const slot0 = useAppStore((s) => s.manualPriceSlots[symbol][0]);
  const slot1 = useAppStore((s) => s.manualPriceSlots[symbol][1]);
  const activeSlot = useAppStore((s) => s.activeRangeSlot[symbol]);
  const setManualPriceSlot = useAppStore((s) => s.setManualPriceSlot);
  const setActiveRangeSlot = useAppStore((s) => s.setActiveRangeSlot);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const showPast = useAppStore((s) => s.showPast);
  const setShowPast = useAppStore((s) => s.setShowPast);
  const [pastFilterTick, setPastFilterTick] = useState(0);
  useEffect(() => {
    if (showPast) return;
    const id = window.setInterval(() => setPastFilterTick((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [showPast]);
  const positions = useThrottledGridPositions(2000);
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const onchainGridPositions = useThrottledOnchainGridPositions(2000);
  const orders = useThrottledGridOrders(2000);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const selectedMarketId = useAppStore((s) => s.selectedMarket?.id ?? '');
  const signalsOnGrid = useAppStore((s) => s.signalsOnGrid);
  const signals = useGridSignals();
  const signalMakerMode = useAppStore((s) => s.signalMakerMode);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);

  const signalByMarket = useMemo(() => {
    const out: Record<string, { yesDiff: string | null; noDiff: string | null }> = {};
    if (!signalsOnGrid) return out;
    for (const sig of signals) {
      const mid = sig.market.id;
      if (!out[mid]) out[mid] = { yesDiff: null, noDiff: null };
      const diff = signalMakerMode ? sig.bidDiffPct : sig.diffPct;
      if (diff >= 0) continue;
      const label = signalMakerMode
        ? diff.toFixed(1) + '%'
        : diff.toFixed(0) + '%';
      if (sig.origSide === 'YES') out[mid].yesDiff = label;
      else out[mid].noDiff = label;
    }
    return out;
  }, [signals, signalsOnGrid, signalMakerMode]);

  const aboveContainerRef = useRef<HTMLDivElement>(null);
  const priceOnContainerRef = useRef<HTMLDivElement>(null);
  const hitContainerRef = useRef<HTMLDivElement>(null);

  const [rangeDialogOpen, setRangeDialogOpen] = useState(false);
  const [rangeDialogSlot, setRangeDialogSlot] = useState(0);

  const colorMap: Record<AssetName, string> = {
    BTC: 'text-orange-400',
    ETH: 'text-blue-400',
    SOL: 'text-purple-400',
    XRP: 'text-cyan-400',
    WTI: 'text-amber-500',
    NG: 'text-lime-400',
    SPY: 'text-emerald-400',
    AAPL: 'text-gray-200',
    GOOGL: 'text-blue-300',
    NVDA: 'text-green-400',
    AMZN: 'text-orange-300',
  };
  const titleColor = colorMap[asset] || 'text-yellow-400';

  const autoAdjVol = assetVol * volMultiplier;
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

  const handleCellClick = useCallback((market: Market, outcome: 'YES' | 'NO' = 'YES') => {
    setSelectedMarket(market);
    setSidebarOutcome(outcome);
    setSidebarOpen(true);
  }, [setSelectedMarket, setSidebarOpen, setSidebarOutcome]);

  const positionLookup = useMemo(() => {
    const lookup: Record<string, { size: number }> = {};
    if (liveTradesSource === 'onchain') {
      for (const p of onchainGridPositions) {
        const k = normalizeClobTokenId(p.tokenId);
        if (k && Math.abs(p.size) > 1e-9) lookup[k] = { size: Math.abs(p.size) };
      }
    } else {
      for (const pos of positions) {
        const tid = getPositionClobTokenId(pos);
        const sz = pos.size || 0;
        const k = normalizeClobTokenId(tid);
        if (k && sz > 0) lookup[k] = { size: sz };
      }
    }
    return lookup;
  }, [liveTradesSource, onchainGridPositions, positions]);

  const orderLookup = useMemo(() => {
    const lookup: Record<string, typeof orders> = {};
    for (const ord of orders) {
      const tid = ord.asset_id || ord.token_id || '';
      if (tid) {
        if (!lookup[tid]) lookup[tid] = [];
        lookup[tid].push(ord);
      }
    }
    return lookup;
  }, [orders]);

  const priceShortAsset = asset === 'ETH' ? 'ETH' : undefined;

  // Numeric value for sorting prices (handles <, >, ranges, k suffix)
  const getNumericValue = (str: string) => {
    const s = str.replace(/\$/g, '').replace(/,/g, '').trim();
    if (s.startsWith('<')) return parseStrikeTokenToNumber(s.substring(1)) - 0.5;
    if (s.startsWith('>')) return parseStrikeTokenToNumber(s.substring(1)) + 1_000_000;
    if (s.includes('-')) return parseStrikeTokenToNumber(s.split('-')[0]) || 0;
    return parseStrikeTokenToNumber(s) || 0;
  };

  interface DateCol { slug: string; endDate: string; title: string }

  const buildTableData = (markets: Market[], includePast: boolean) => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    const dateMap = new Map<string, DateCol>();
    const priceSet = new Set<string>();
    const marketLookup: Record<string, Market> = {};

    for (const m of markets) {
      const slug = m.eventSlug || '';
      if (!slug) continue;
      if (!dateMap.has(slug)) {
        dateMap.set(slug, { slug, endDate: m.endDate, title: m.eventTitle || '' });
      }
    }

    for (const m of markets) {
      const slug = m.eventSlug || '';
      const price = m.groupItemTitle || '';
      if (!slug || !price) continue;
      priceSet.add(price);
      marketLookup[price + '_' + slug] = m;
    }

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

    if (!includePast) {
      dates = dates.filter(d => !d.endDate || new Date(d.endDate).getTime() >= now);
    }

    const prices = Array.from(priceSet)
      .filter(price => dates.some(d => marketLookup[price + '_' + d.slug]))
      .sort((a, b) => getNumericValue(a) - getNumericValue(b));

    return { dates, prices, marketLookup };
  };

  type GridTableData = ReturnType<typeof buildTableData>;
  const aboveGridData = useMemo(
    () => (aboveMarketsForAsset.length > 0 ? buildTableData(aboveMarketsForAsset, showPast) : null),
    [aboveMarketsForAsset, showPast, pastFilterTick, hlSnap?.updatedAt],
  );
  const priceOnGridData = useMemo(
    () => (priceOnMarketsForAsset.length > 0 ? buildTableData(priceOnMarketsForAsset, showPast) : null),
    [priceOnMarketsForAsset, showPast, pastFilterTick, hlSnap?.updatedAt],
  );

  const renderWeeklyHitTable = () => {
    const now = Date.now();
    const hitPastWindowMs = 21 * 24 * 60 * 60 * 1000; // ~3 weekly windows; matches “Past” for Hit cadence
    const dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    // Filter weekly hit markets: default = only active (not closed, end in future). Past checkbox = also recently ended columns.
    const activeMarkets = weeklyHitMarketsForAsset.filter(m => {
      const title = m.groupItemTitle || '';
      if (title.includes('↓')) {
        const target = parseHitStrikeNumber(title);
        if (target <= 0) return false;
      }
      const endTime = m.endDate ? new Date(m.endDate).getTime() : 0;
      if (!endTime) return false;

      if (!showPast) {
        if (m.closed) return false;
        if (endTime <= now) return false;
        return true;
      }

      if (endTime > now) return true;
      return endTime >= now - hitPastWindowMs;
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
    const hitPrice = (t: string) => parseHitStrikeNumber(t);
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

    // Scroll anchor handled by AssetMarketTableScrollSync
    return (
      <>
      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-20 bg-gray-900">
            <tr>
              <th className={`px-1 py-1 text-center ${titleColor} font-bold border-b border-gray-700 text-[10px] bg-gray-900`}>
                Price
              </th>
              {events.map((ev) => {
                const dt = new Date(ev.endDate);
                const evEnded = showPast && ev.endDate && dt.getTime() <= now;
                return (
                  <th key={ev.slug} className={`px-0.5 py-1 border-b border-gray-700 text-[10px] bg-gray-900 ${evEnded ? 'opacity-60' : ''}`}>
                    <a
                      href={polymarketSiteUrl(`event/${ev.slug}`)}
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
            {prices.map((priceStr) => {
              const rowBorder = 'border-b border-gray-700/50';
              return (
              <tr key={priceStr} className="hover:bg-gray-800/50">
                <AssetMarketTableHitPriceCol
                  asset={asset}
                  priceStr={priceStr}
                  titleColor={titleColor}
                  hitPrice={hitPrice}
                />
                {events.map((ev) => {
                  const market = hitLookup[priceStr]?.[ev.slug];
                  const evEnded = showPast && ev.endDate && new Date(ev.endDate).getTime() <= now;
                  if (!market) {
                    return <td key={ev.slug} className={`text-center px-1 py-0.5 ${rowBorder} text-gray-600 text-[10px] ${evEnded ? 'opacity-50 bg-gray-700/30' : ''}`} style={{ minWidth: 68 }}>-</td>;
                  }

                  const tokenIds = market.clobTokenIds || [];
                  const yesTokenId = tokenIds[0] || '';
                  const noTokenId = tokenIds[1] || '';
                  const sig = signalByMarket[market.id];
                  const yesPos = yesTokenId ? positionLookup[normalizeClobTokenId(yesTokenId)] : undefined;
                  const noPos = noTokenId ? positionLookup[normalizeClobTokenId(noTokenId)] : undefined;

                  return (
                    <GridMarketCell
                      key={ev.slug}
                      market={market}
                      asset={asset}
                      endDate={ev.endDate}
                      deltaPriceStr={priceStr}
                      isHit
                      isPast={!!evEnded}
                      variant="hit"
                      signalsOnGrid={signalsOnGrid}
                      yesDiff={sig?.yesDiff}
                      noDiff={sig?.noDiff}
                      isSelected={selectedMarketId === market.id}
                      adjVol={adjVol}
                      bsTimeOffsetHours={bsTimeOffsetHours}
                      yesPosSize={yesPos?.size}
                      noPosSize={noPos?.size}
                      yesOrders={orderLookup[yesTokenId] ?? EMPTY_ORDERS}
                      noOrders={orderLookup[noTokenId] ?? EMPTY_ORDERS}
                      onCellClick={handleCellClick}
                    />
                  );
                })}
              </tr>
            );})}
          </tbody>
        </table>
      </div>
      <AssetMarketTableScrollSync
        containerRef={hitContainerRef}
        symbol={symbol}
        tableType="hit"
        prices={prices}
        hitPrice={hitPrice}
      />
      </>
    );
  };

  const renderUpOrDownTable = () => {
    const assetData = upOrDownMarketsForAsset;
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

    const visibleTimeframes = timeframes.filter((tf) => rows[tf].some((m) => m !== null));
    if (visibleTimeframes.length === 0) return null;

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
            {visibleTimeframes.map(tf => {
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
                      const p = m.priceToBeat;
                      if (p != null) return p.toLocaleString(undefined, { maximumFractionDigits: asset === 'BTC' ? 0 : 2 });
                    }
                    return '-';
                  })()}
                </td>
                {rows[tf].map((market: Market | null, colIdx: number) => {
                  if (!market) {
                    return <td key={colIdx} className="text-center px-1 py-1 border-b border-gray-700/50 text-gray-600 text-[10px]">-</td>;
                  }

                  const tokenIds = market.clobTokenIds || [];
                  const yesTokenId = tokenIds[0] || '';
                  const noTokenId = tokenIds[1] || '';
                  const isPast = showPast && colIdx === 0;
                  const yesPos = yesTokenId ? positionLookup[normalizeClobTokenId(yesTokenId)] : undefined;
                  const noPos = noTokenId ? positionLookup[normalizeClobTokenId(noTokenId)] : undefined;

                  return (
                    <GridMarketCell
                      key={colIdx}
                      market={market}
                      asset={asset}
                      endDate={market.endDate || ''}
                      deltaPriceStr=""
                      isPast={isPast}
                      skipDeltaBg={isPast || isHl}
                      variant="updown"
                      minWidth={60}
                      signalsOnGrid={false}
                      isSelected={selectedMarketId === market.id}
                      adjVol={adjVol}
                      bsTimeOffsetHours={bsTimeOffsetHours}
                      yesPosSize={yesPos?.size}
                      noPosSize={noPos?.size}
                      yesOrders={orderLookup[yesTokenId] ?? EMPTY_ORDERS}
                      noOrders={orderLookup[noTokenId] ?? EMPTY_ORDERS}
                      onCellClick={handleCellClick}
                    />
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

  const renderTable = (
    markets: Market[],
    tableType: string,
    cached?: GridTableData | null,
    scrollContainerRef?: RefObject<HTMLElement | null>,
    hlGridMode = false,
  ) => {
    if (markets.length === 0) {
      return <div className="text-gray-500 text-center py-2 text-xs">No markets</div>;
    }

    const built = cached ?? buildTableData(markets, showPast);
    const { dates, prices, marketLookup } = built;

    if (dates.length === 0 || prices.length === 0) {
      return <div className="text-gray-500 text-center py-2 text-xs">No active markets</div>;
    }

    return (
      <>
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
                    {hlGridMode ? (
                      <div className={`font-bold ${isWeekend ? 'text-purple-400' : 'text-white'} text-[10px]`}>
                        {['Su','Mo','Tu','We','Th','Fr','Sa'][dt.getDay()]} {formatDateShort(d.endDate)}
                      </div>
                    ) : (
                      <a
                        href={polymarketSiteUrl(`event/${d.slug}`)}
                        target="_blank"
                        rel="noreferrer"
                        className="block hover:bg-gray-800/50 rounded p-0.5 transition"
                      >
                        <div className={`font-bold ${isWeekend ? 'text-purple-400' : 'text-white'} hover:text-blue-400 text-[10px]`}>
                          {['Su','Mo','Tu','We','Th','Fr','Sa'][dt.getDay()]} {formatDateShort(d.endDate)}
                        </div>
                      </a>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {prices.map((priceStr) => {
              return (
                <tr key={priceStr} className="hover:bg-gray-800/50">
                  <AssetMarketTableStrikePriceCol
                    asset={asset}
                    priceStr={priceStr}
                    titleColor={titleColor}
                    tableType={tableType}
                    priceShortAsset={priceShortAsset}
                  />
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
                  const yesPos = yesTokenId ? positionLookup[normalizeClobTokenId(yesTokenId)] : undefined;
                  const noPos = noTokenId ? positionLookup[normalizeClobTokenId(noTokenId)] : undefined;
                  const sig = signalByMarket[market.id];

                  return (
                    <GridMarketCell
                      key={d.slug}
                      market={market}
                      asset={asset}
                      endDate={d.endDate}
                      deltaPriceStr={priceStr}
                      isClosed={!!isClosed}
                      isWeekend={isWeekend}
                      variant={tableType === 'above' ? 'above' : 'between'}
                      signalsOnGrid={!hlGridMode && signalsOnGrid}
                      yesDiff={sig?.yesDiff}
                      noDiff={sig?.noDiff}
                      isSelected={selectedMarketId === market.id}
                      adjVol={adjVol}
                      bsTimeOffsetHours={bsTimeOffsetHours}
                      yesPosSize={yesPos?.size}
                      noPosSize={noPos?.size}
                      yesOrders={orderLookup[yesTokenId] ?? EMPTY_ORDERS}
                      noOrders={orderLookup[noTokenId] ?? EMPTY_ORDERS}
                      onCellClick={handleCellClick}
                      skipDeltaBg={hlGridMode}
                    />
                  );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {scrollContainerRef && !hlGridMode ? (
        <AssetMarketTableScrollSync
          containerRef={scrollContainerRef}
          symbol={symbol}
          tableType={tableType}
          prices={prices}
        />
      ) : null}
      </>
    );
  };
  const fmtSlotValue = (val: { low: number; high: number } | null) => {
    if (!val) return null;
    return `${val.low}-${val.high}`;
  };

  const vwapSnap = useAppStore.getState().vwapData[symbol]?.price || 0;
  const spotSnap = useAppStore.getState().priceData[symbol]?.price || 0;

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3">
      {/* Asset Title */}
      <div className="panel-header">
        <h3 className={`text-sm font-bold mb-2 flex items-center gap-1 flex-wrap ${titleColor}`}>
          <span className="relative no-drag inline-flex items-center cursor-pointer select-none" onClick={() => setAssetDropdownOpen(v => !v)}>
            {asset}:{' '}
            <AssetMarketTableSpotPrice asset={asset} symbol={symbol} />
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
          <span className="relative no-drag inline-flex items-center cursor-pointer select-none text-[10px] font-normal text-gray-300" onClick={() => setSourceDropdownOpen((v) => !v)}>
            {isHl ? 'Hyperliquid' : 'Polymarket'}
            <svg className="w-3 h-3 ml-0.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            {sourceDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[100px]">
                {(['polymarket', 'hyperliquid'] as const).map((src) => (
                  <div
                    key={src}
                    className={`px-3 py-1 text-xs font-bold hover:bg-gray-700 cursor-pointer ${src === gridSource ? 'text-white bg-gray-700' : 'text-gray-300'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setGridSource(src);
                      localStorage.setItem(`polybot-grid-source-${panelId}`, src);
                      setSourceDropdownOpen(false);
                    }}
                  >
                    {src === 'hyperliquid' ? 'Hyperliquid' : 'Polymarket'}
                  </div>
                ))}
              </div>
            )}
          </span>
          {!isHl && <AssetMarketTableVwapHint asset={asset} symbol={symbol} />}
          {/* Range slots (Polymarket only) */}
          {!isHl && [0, 1].map((i) => {
            const slotVal = i === 0 ? slot0 : slot1;
            const isActive = activeSlot === i;
            const colors = ['text-cyan-300', 'text-pink-400'];
            const borderColors = isActive
              ? ['border-cyan-300', 'border-pink-400']
              : ['border-cyan-400/40', 'border-pink-500/40'];

            // Check if VWAP is outside range
            let outOfRange = false;
            if (slotVal && vwapSnap > 0) {
              outOfRange = vwapSnap <= slotVal.low || vwapSnap >= slotVal.high;
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
          {!isHl && <AssetMarketTableStrikeRangeWrap markets={aboveMarketsForAsset} asset={asset} />}
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
            ...(!isHl ? [['Hit', showHit, setShowHit, `polybot-show-hit-${panelId}`] as const] : []),
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
        currentLow={(rangeDialogSlot === 0 ? slot0 : slot1)?.low ?? null}
        currentHigh={(rangeDialogSlot === 0 ? slot0 : slot1)?.high ?? null}
        livePrice={spotSnap}
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
                <div className="flex-1 min-h-0 border border-orange-500/40 rounded flex flex-col overflow-hidden" ref={hitContainerRef} style={{ position: 'relative' }}>
                  <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-orange-400 bg-gray-800/50 rounded-t py-0.5">Hit <HelpTooltip text={"Hit markets resolve YES if the asset price touches or crosses a specific price level at any point before expiry.\n\nUnlike Above markets which only check the price at expiry, Hit markets are path-dependent — they trigger as soon as the price 'hits' the target, regardless of where it ends up.\n\nHit markets come in two varieties: weekly (short-term, expiring each week) and monthly (longer-term, expiring at month end).\n\nRows show strike prices with ↑ (must go up to hit) or ↓ (must go down to hit). Columns show different expiry dates."} /></div>
                  {renderWeeklyHitTable()}
                  <PriceTicks containerRef={hitContainerRef} symbol={symbol} />
                </div>
              )}
            </div>
          )}
          {showAbove && (
            <div className="flex-1 min-w-0 border border-emerald-500/40 rounded flex flex-col" ref={aboveContainerRef} style={{ position: 'relative' }}>
              <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-emerald-400 bg-gray-800/50 rounded-t py-0.5">Above <HelpTooltip text={"Above markets resolve YES if the asset price is above a specific strike price at the moment of expiry (noon ET).\n\nThese are the most common market type. Each row is a different strike price and each column is a different expiry date.\n\nThe YES probability increases as the live price moves further above the strike, and decreases as it falls below. At expiry, the market resolves to 100 (YES) or 0 (NO) based purely on where the price is at that moment."} /></div>
              {renderTable(aboveMarketsForAsset, 'above', aboveGridData, aboveContainerRef, isHl)}
              {!isHl && <PriceTicks containerRef={aboveContainerRef} symbol={symbol} />}
            </div>
          )}
          {showBetween && (
            <div className="flex-1 min-w-0 border border-purple-500/40 rounded flex flex-col" ref={priceOnContainerRef} style={{ position: 'relative' }}>
              <div className="flex items-center justify-center gap-1 text-[10px] font-bold text-purple-400 bg-gray-800/50 rounded-t py-0.5">Between <HelpTooltip text={"Between markets resolve YES if the asset price falls within a specific price range at the moment of expiry (noon ET).\n\nEach row shows a price range (e.g. 95k-100k). The market pays out if the price lands inside that range at expiry.\n\nB-S probability for these markets peaks when the price is near the center of the range and drops off toward the edges. Unlike Above markets, the max probability may not be at the range boundary — it can be in the middle."} /></div>
              {renderTable(priceOnMarketsForAsset, 'price', priceOnGridData, priceOnContainerRef, isHl)}
              {!isHl && <PriceTicks containerRef={priceOnContainerRef} symbol={symbol} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export const AssetMarketTable = memo(AssetMarketTableInner);
