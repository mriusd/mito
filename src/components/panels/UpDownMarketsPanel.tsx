import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import type { CSSProperties } from 'react';
import { CirclePercent, GraduationCap, Minus, Triangle } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { HelpTooltip } from '../HelpTooltip';
import type { Market } from '../../types';
import type { AssetSymbol } from '../../types';
import { getMarketProbability } from '../../utils/bsMath';
import { formatPolymarketVolumeK, getPolymarketVolumeUsd, getPositionClobTokenId, normalizeClobTokenId } from '../../utils/format';
import { useChainlinkPricesMap } from '../../hooks/usePolymarketPrice';
import { outcomeMidOrOneSideProb } from '../../lib/outcomeQuote';
import { MarketCellMidRow } from './MarketCellMidRow';

function formatCountdown(ms: number): string {
  const rem = ms - Date.now();
  if (rem <= 0) return '0s';
  const sec = Math.floor(rem / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '24h'] as const;
const ASSET_COLORS: Record<string, string> = {
  BTC: 'text-orange-400',
  ETH: 'text-blue-400',
  SOL: 'text-purple-400',
  XRP: 'text-cyan-400',
};

/**
 * Asset envelope border colors as inline RGBA so production CSS always includes them.
 * (Tailwind JIT sometimes omits `border-{color}-400/85` for some hues in minified builds.)
 */
const ASSET_BORDER_COLOR: Record<(typeof ASSETS)[number], string> = {
  BTC: 'rgba(251, 146, 60, 0.9)',
  ETH: 'rgba(96, 165, 250, 0.9)',
  SOL: 'rgba(192, 132, 252, 0.9)',
  XRP: 'rgba(34, 211, 238, 0.9)',
};

function assetBorderStyle(
  asset: (typeof ASSETS)[number],
  sides: { L?: boolean; R?: boolean; B?: boolean },
): CSSProperties {
  const c = ASSET_BORDER_COLOR[asset];
  const s: CSSProperties = {};
  if (sides.L) s.borderLeftColor = c;
  if (sides.R) s.borderRightColor = c;
  if (sides.B) s.borderBottomColor = c;
  return s;
}

const LAST_TIMEFRAME = TIMEFRAMES[TIMEFRAMES.length - 1];

const TF_DURATIONS_MS: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

/** Elapsed fraction [0,1] of fixed window ending at endMs (same as AssetMarketTable). */
function expiryProgress(nowMs: number, endMs: number, durationMs: number): number {
  if (endMs <= 0 || durationMs <= 0) return 0;
  const startMs = endMs - durationMs;
  return Math.max(0, Math.min(1, (nowMs - startMs) / durationMs));
}

const EXPIRY_BAR_BG = 'rgba(6, 182, 212, 0.6)';

const THRESHOLD_KEY = 'updown-cheap-threshold';
const SHOW_TARGET_KEY = 'updown-show-target';
const SHOW_NEXT_MARKET_KEY = 'updown-show-next-market';
const SHOW_VOLUME_KEY = 'updown-show-volume';

const TARGET_STRIKE_DECIMALS: Record<(typeof ASSETS)[number], number> = {
  BTC: 0,
  ETH: 1,
  SOL: 2,
  XRP: 4,
};

/** Math % badge: gray when rounded P(Up) is within this many points of 50 (i.e. 50 ± 1 → 49–51). */
const MATH_PROB_NEUTRAL_BAND = 1;

/** Minus (neutral) triangle when |YES bid% − math%| ≤ this (percentage points). */
const MATH_VS_BID_NEUTRAL_PCT = 5;

/**
 * Triangle flashes when YES bid is at least this far from math **relative to math**:
 * |bid − math| / math ≥ threshold (e.g. 0.30 ⇒ 30% away from math, not 30 percentage points).
 */
const MATH_VS_BID_FLASH_REL = 0.30;

function formatTargetStrikePrice(p: number | undefined | null, fractionDigits: number): string {
  if (p == null || !Number.isFinite(p)) return '-';
  return p.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function strikePriceFromMarket(market: Market, tokenId: string, lookup: Record<string, Market>): number | undefined {
  const p = market.priceToBeat ?? (tokenId ? lookup[tokenId]?.priceToBeat : undefined);
  return p != null && Number.isFinite(p) ? p : undefined;
}

/** Same curve as AssetMarketTable: tint by (YES mid − BS math) in percentage points. */
function deltaMidVsMathBg(yesMidProb: number | null, mathYesProb: number | null): CSSProperties {
  if (yesMidProb == null || mathYesProb == null) return {};
  const delta = (yesMidProb - mathYesProb) * 100;
  const alpha = Math.min(0.55, Math.abs(delta) * 0.035);
  if (alpha < 0.02) return {};
  return {
    backgroundColor:
      delta > 0
        ? `rgba(34, 197, 94, ${alpha.toFixed(3)})`
        : `rgba(239, 68, 68, ${alpha.toFixed(3)})`,
  };
}

export function UpDownMarketsPanel() {
  const [showTarget, setShowTarget] = useState(() => localStorage.getItem(SHOW_TARGET_KEY) !== 'false');
  const [showNextMarket, setShowNextMarket] = useState(() => localStorage.getItem(SHOW_NEXT_MARKET_KEY) === 'true');
  const [showVolume, setShowVolume] = useState(() => localStorage.getItem(SHOW_VOLUME_KEY) === 'true');

  const [thresholdStr, setThresholdStr] = useState<string>(() => {
    const saved = localStorage.getItem(THRESHOLD_KEY);
    return saved ?? '10';
  });
  const threshold = parseFloat(thresholdStr) || 0;
  const thresholdFactor = 1 - threshold / 100;

  const handleThresholdChange = (val: string) => {
    setThresholdStr(val);
    const n = parseFloat(val);
    if (!isNaN(n) && n >= 0 && n <= 100) {
      localStorage.setItem(THRESHOLD_KEY, String(n));
    }
  };

  const setShowTargetColumn = (on: boolean) => {
    setShowTarget(on);
    localStorage.setItem(SHOW_TARGET_KEY, on ? 'true' : 'false');
  };
  const setShowNextMarketColumn = (on: boolean) => {
    setShowNextMarket(on);
    localStorage.setItem(SHOW_NEXT_MARKET_KEY, on ? 'true' : 'false');
  };
  const setShowVolumeColumn = (on: boolean) => {
    setShowVolume(on);
    localStorage.setItem(SHOW_VOLUME_KEY, on ? 'true' : 'false');
  };

  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const _bidAskLookup = useAppStore((s) => s.marketLookup);
  useAppStore((s) => s.bidAskTick);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const positions = useAppStore((s) => s.positions);
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const onchainGridPositions = useAppStore((s) => s.onchainGridPositions);
  const orders = useAppStore((s) => s.orders);
  const progOrderMap = useAppStore((s) => s.progOrderMap);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);
  const priceData = useAppStore((s) => s.priceData);
  const chainlinkPrices = useChainlinkPricesMap();

  const positionTokenIds = useMemo(() => {
    const s = new Set<string>();
    if (liveTradesSource === 'onchain') {
      for (const p of onchainGridPositions) {
        const k = normalizeClobTokenId(p.tokenId);
        if (k && Math.abs(p.size) > 1e-9) s.add(k);
      }
      return s;
    }
    for (const pos of positions) {
      const k = normalizeClobTokenId(getPositionClobTokenId(pos));
      if (k && (pos.size || 0) > 0) s.add(k);
    }
    return s;
  }, [liveTradesSource, onchainGridPositions, positions]);

  // Build order lookup by tokenId (exclude prog orders)
  const orderLookup: Record<string, typeof orders> = {};
  for (const o of orders) {
    if (progOrderMap[o.id]) continue;
    const tid = o.asset_id || o.token_id || '';
    if (!tid) continue;
    if (!orderLookup[tid]) orderLookup[tid] = [];
    orderLookup[tid].push(o);
  }

  const getLiveBidAsk = (m: Market) => {
    const tid = m.clobTokenIds?.[0];
    const live = tid ? _bidAskLookup[tid] : null;
    return { bestBid: live?.bestBid ?? m.bestBid, bestAsk: live?.bestAsk ?? m.bestAsk };
  };

  const handleCellClick = useCallback((market: Market, outcome: 'YES' | 'NO' = 'YES') => {
    setSelectedMarket(market);
    setSidebarOutcome(outcome);
    setSidebarOpen(true);
  }, [setSelectedMarket, setSidebarOutcome, setSidebarOpen]);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // For each asset+timeframe, find the current and next market
  const getCurrentAndNextMarket = (asset: string, tf: string): { current: Market | null; next: Market | null } => {
    const assetData = upOrDownMarkets[asset] || {};
    const markets = (assetData[tf] || [])
      .filter((m: Market) => !m.closed)
      .sort((a: Market, b: Market) => {
        const ta = a.endDate ? new Date(a.endDate).getTime() : Infinity;
        const tb = b.endDate ? new Date(b.endDate).getTime() : Infinity;
        return ta - tb;
      });
    const currentIdx = markets.findIndex((m: Market) => m.endDate && new Date(m.endDate).getTime() > now);
    if (currentIdx === -1) return { current: null, next: null };
    return { current: markets[currentIdx], next: markets[currentIdx + 1] || null };
  };

  /** Timeframe rows whose current window ends at the same instant as another row (2+ timeframes). */
  const timeframesWithSharedExpiry = (() => {
    const endMsByTf: Partial<Record<(typeof TIMEFRAMES)[number], number>> = {};
    for (const tf of TIMEFRAMES) {
      let endMs = 0;
      for (const a of ASSETS) {
        const m = getCurrentAndNextMarket(a, tf).current;
        if (m?.endDate) {
          endMs = new Date(m.endDate).getTime();
          break;
        }
      }
      endMsByTf[tf] = endMs;
    }
    const byEnd = new Map<number, (typeof TIMEFRAMES)[number][]>();
    for (const tf of TIMEFRAMES) {
      const e = endMsByTf[tf];
      if (!e || e <= 0) continue;
      if (!byEnd.has(e)) byEnd.set(e, []);
      byEnd.get(e)!.push(tf);
    }
    const dup = new Set<string>();
    for (const list of byEnd.values()) {
      if (list.length >= 2) list.forEach(t => dup.add(t));
    }
    return dup;
  })();

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0">
      <div className="panel-header flex items-center gap-2 mb-2 cursor-grab flex-wrap">
        <h3 className="text-sm font-bold text-yellow-400">Up or Down Markets</h3>
        <div className="ml-auto flex items-center gap-3 cursor-default flex-wrap">
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={100}
              value={thresholdStr}
              onChange={(e) => handleThresholdChange(e.target.value)}
              className="w-10 bg-gray-700 text-white text-[10px] text-center rounded px-0.5 py-0.5 border border-gray-600 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <span className="text-[10px] text-gray-400">%</span>
            <HelpTooltip text="Left: YES mid in ¢. Right: implied NO probability in ¢ as 100 − YES mid (complementary to the same YES quote). Highlights vs peer averages." />
          </div>
          <label
            className="flex items-center gap-1 cursor-default text-[10px] text-gray-300 select-none"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={showTarget}
              onChange={(e) => setShowTargetColumn(e.target.checked)}
              className="accent-blue-500 rounded"
            />
            <span>Show Target</span>
          </label>
          <label
            className="flex items-center gap-1 cursor-default text-[10px] text-gray-300 select-none"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={showNextMarket}
              onChange={(e) => setShowNextMarketColumn(e.target.checked)}
              className="accent-blue-500 rounded"
            />
            <span>Next Market</span>
          </label>
          <label
            className="flex items-center gap-1 cursor-default text-[10px] text-gray-300 select-none"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={showVolume}
              onChange={(e) => setShowVolumeColumn(e.target.checked)}
              className="accent-blue-500 rounded"
            />
            <span>Volume</span>
          </label>
        </div>
      </div>
      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-gray-900">
            <tr>
              <th className="px-2 py-1 text-center text-gray-400 font-bold border-b border-r border-gray-700 bg-gray-900" rowSpan={2} />
              {ASSETS.map((asset) => (
                <th
                  key={asset}
                  colSpan={(showTarget ? 1 : 0) + 1 + (showNextMarket ? 1 : 0) + (showVolume ? 1 : 0)}
                  className={`px-2 py-1 text-center border-b border-l border-r border-gray-700 border-solid bg-gray-900 font-bold ${ASSET_COLORS[asset] || 'text-white'}`}
                  style={assetBorderStyle(asset, { L: true, R: true })}
                >
                  {asset}
                </th>
              ))}
            </tr>
            <tr>
              {ASSETS.map((asset) => (
                <Fragment key={asset}>
                  {showTarget && (
                    <th
                      className="px-1 py-0.5 text-center border-b border-r border-l border-gray-700 border-solid bg-gray-900 text-[9px] text-gray-400 font-semibold"
                      style={assetBorderStyle(asset, { L: true })}
                    >
                      Target
                    </th>
                  )}
                  <th
                    className="px-1 py-0.5 text-center border-b border-l border-r border-gray-700 border-solid bg-gray-900/80 text-[9px] text-gray-400 font-semibold"
                    style={assetBorderStyle(asset, showTarget ? {} : { L: true })}
                  >
                    Current
                  </th>
                  {showNextMarket && (
                    <th
                      className="px-1 py-0.5 text-center border-b border-l border-r border-gray-700 border-solid bg-gray-900/70 text-[9px] text-gray-400 font-semibold"
                      style={assetBorderStyle(asset, showVolume ? {} : { R: true })}
                    >
                      Next
                    </th>
                  )}
                  {showVolume && (
                    <th
                      className="px-1 py-0.5 text-right border-b border-l border-r border-gray-700 border-solid bg-gray-900/80 text-[9px] text-sky-300 font-semibold"
                      style={assetBorderStyle(asset, { R: true })}
                    >
                      <span className="inline-flex w-full items-center justify-end gap-0.5">
                        Vol
                        <HelpTooltip text="Trading volume (USDC In) from Toxic Flow aggregation (wallet_positions), pushed over chart WebSocket together with bid/ask updates. Shown in thousands (e.g. 12.3k)." />
                      </span>
                    </th>
                  )}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {TIMEFRAMES.map((tf) => {
              // Pre-compute YES mid and P(NO)=1−P(YES) for peer highlights (same YES mid drives both columns)
              const yesMidByAsset: Record<string, number> = {};
              const noProbByAsset: Record<string, number> = {};
              for (const a of ASSETS) {
                const m = getCurrentAndNextMarket(a, tf).current;
                if (m) {
                  const yT = m.clobTokenIds?.[0];
                  const gamma = { bestBid: m.bestBid, bestAsk: m.bestAsk };
                  const y = outcomeMidOrOneSideProb(yT, _bidAskLookup, gamma);
                  if (y != null) {
                    yesMidByAsset[a] = y;
                    noProbByAsset[a] = 1 - y;
                  }
                }
              }
              const otherYesMids = (asset: string) => {
                const vals = ASSETS.filter(a => a !== asset && yesMidByAsset[a] !== undefined).map(a => yesMidByAsset[a]);
                return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
              };
              const otherNoProb = (asset: string) => {
                const vals = ASSETS.filter(a => a !== asset && noProbByAsset[a] !== undefined).map(a => noProbByAsset[a]);
                return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
              };

              const duration = TF_DURATIONS_MS[tf] || 0;
              const firstMarket = ASSETS.map(a => getCurrentAndNextMarket(a, tf).current).find(m => m !== null);
              const endMs = firstMarket?.endDate ? new Date(firstMarket.endDate).getTime() : 0;
              const tfProgress = expiryProgress(now, endMs, duration);
              const tfProgressPct = (tfProgress * 100).toFixed(1);
              const isLastTfRow = tf === LAST_TIMEFRAME;

              const tfDupExpiry = timeframesWithSharedExpiry.has(tf);
              return (
              <tr key={tf} className="hover:bg-gray-800/50">
                <td
                  className={`px-1 py-1 font-bold text-white border-b border-r border-gray-700 whitespace-nowrap relative ${
                    tfDupExpiry ? 'bg-red-950/70' : 'bg-gray-900'
                  }`}
                  title={tfDupExpiry ? 'This timeframe shares the same expiry instant as another row' : undefined}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>{tf}</span>
                    <span className={`text-[8px] font-normal ${endMs > 0 && endMs - now < 60000 ? 'text-red-400' : endMs > 0 && endMs - now < 300000 ? 'text-yellow-400' : 'text-green-400'}`}>{endMs > 0 ? formatCountdown(endMs) : ''}</span>
                  </div>
                  {endMs > 0 && duration > 0 && (
                    <div
                      className="absolute bottom-0 left-0 z-0 h-[2px] pointer-events-none"
                      style={{ width: `${tfProgressPct}%`, backgroundColor: EXPIRY_BAR_BG }}
                    />
                  )}
                </td>
                {ASSETS.map((asset) => {
                  const { current: market, next: nextMarket } = getCurrentAndNextMarket(asset, tf);
                  if (!market) {
                    return (
                      <td
                        key={asset}
                        colSpan={(showTarget ? 1 : 0) + 1 + (showNextMarket ? 1 : 0) + (showVolume ? 1 : 0)}
                        className={`px-1 py-1 text-center border-l border-r border-solid border-gray-700 text-gray-600 ${isLastTfRow ? 'border-b' : 'border-b border-gray-700/50'}`}
                        style={assetBorderStyle(asset, { L: true, R: true, B: isLastTfRow })}
                      >
                        -
                      </td>
                    );
                  }

                  const { bestBid } = getLiveBidAsk(market);
                  const tokenIds = market.clobTokenIds || [];
                  const yesTokenId = tokenIds[0] || '';
                  const noTokenId = tokenIds[1] || '';
                  const sym = (asset + 'USDT') as AssetSymbol;
                  const cl = chainlinkPrices[asset];
                  const binanceSpot = priceData[sym]?.price;
                  const preferChainlink = tf === '5m' || tf === '15m';
                  const livePrice = preferChainlink
                    ? cl != null && cl > 0
                      ? cl
                      : binanceSpot != null && binanceSpot > 0
                        ? binanceSpot
                        : undefined
                    : binanceSpot != null && binanceSpot > 0
                      ? binanceSpot
                      : undefined;
                  const strikeTarget = strikePriceFromMarket(market, yesTokenId, _bidAskLookup);

                  let mathYesProb: number | null = null;
                  if (livePrice != null && livePrice > 0 && strikeTarget !== undefined && market.endDate) {
                    const sigma = (volatilityData[sym] || 0.60) * volMultiplier;
                    const bsYes = getMarketProbability('>' + strikeTarget, livePrice, market.endDate, sigma, bsTimeOffsetHours);
                    if (bsYes !== null) {
                      mathYesProb = bsYes;
                    }
                  }

                  let bidVsMath: 'bidAbove' | 'bidBelow' | 'tie' | null = null;
                  let triangleBadgeFlash = false;
                  if (mathYesProb !== null && bestBid != null && Number.isFinite(bestBid)) {
                    const gapPts = Math.abs(bestBid * 100 - mathYesProb * 100);
                    const d = bestBid - mathYesProb;
                    if (gapPts <= MATH_VS_BID_NEUTRAL_PCT) bidVsMath = 'tie';
                    else if (d > 0) bidVsMath = 'bidAbove';
                    else bidVsMath = 'bidBelow';
                    const flashDenom = Math.max(mathYesProb, 1e-9);
                    triangleBadgeFlash = Math.abs(bestBid - mathYesProb) / flashDenom >= MATH_VS_BID_FLASH_REL;
                  }
                  const mathPctRounded = mathYesProb !== null ? Math.round(mathYesProb * 100) : null;
                  const mathProbNeutral =
                    mathPctRounded !== null &&
                    mathPctRounded >= 50 - MATH_PROB_NEUTRAL_BAND &&
                    mathPctRounded <= 50 + MATH_PROB_NEUTRAL_BAND;
                  const mathBadgeColorClass =
                    mathPctRounded === null
                      ? 'bg-gray-800/70 text-gray-300 border border-gray-600/50'
                      : mathProbNeutral
                        ? 'bg-gray-800/40 text-gray-300/90 border border-gray-500/30'
                        : mathPctRounded > 50
                          ? 'bg-green-900/55 text-green-200 border border-green-700/40'
                          : 'bg-red-900/55 text-red-200 border border-red-700/40';

                  const targetCell = showTarget ? (
                    <td
                      key={`${asset}-target`}
                      className={`px-1 py-1 align-middle border-l border-r border-solid border-gray-700 text-center text-[9px] whitespace-nowrap ${ASSET_COLORS[asset] || 'text-gray-300'} bg-gray-900/50 ${isLastTfRow ? 'border-b' : 'border-b border-gray-700/50'}`}
                      style={assetBorderStyle(asset, { L: true, B: isLastTfRow })}
                    >
                      <div className="flex flex-row items-center justify-center gap-1 leading-none">
                        <span className="font-medium tabular-nums">
                          {formatTargetStrikePrice(strikeTarget, TARGET_STRIKE_DECIMALS[asset])}
                        </span>
                        {mathYesProb !== null && (
                          <div className="inline-flex items-center gap-0.5 shrink-0">
                            <div
                              className={`inline-flex h-4 min-w-[2.75rem] shrink-0 items-center justify-center gap-0.5 rounded px-1 text-[8px] font-bold tabular-nums ${mathBadgeColorClass}`}
                              title={
                                bestBid != null && Number.isFinite(bestBid)
                                  ? `Math P(Up) — green >${50 + MATH_PROB_NEUTRAL_BAND}%, red <${50 - MATH_PROB_NEUTRAL_BAND}%, gray if ${50 - MATH_PROB_NEUTRAL_BAND}–${50 + MATH_PROB_NEUTRAL_BAND}% (YES bid ${(bestBid * 100).toFixed(1)}¢)`
                                  : `Math P(Up) — green >${50 + MATH_PROB_NEUTRAL_BAND}%, red <${50 - MATH_PROB_NEUTRAL_BAND}%, gray if ${50 - MATH_PROB_NEUTRAL_BAND}–${50 + MATH_PROB_NEUTRAL_BAND}%. Spot: 5m/15m = Chainlink (Binance fallback); 1h/4h/24h = Binance. σ from vol settings.`
                              }
                            >
                              <CirclePercent className="h-2.5 w-2.5 shrink-0 opacity-90" strokeWidth={2.5} aria-hidden />
                              <span>{(mathYesProb * 100).toFixed(0)}</span>
                            </div>
                            {bidVsMath !== null && (
                              <div
                                className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                  bidVsMath === 'bidAbove'
                                    ? 'bg-green-900/65 border-green-600/45 text-green-100'
                                    : bidVsMath === 'bidBelow'
                                      ? 'bg-red-900/65 border-red-600/45 text-red-100'
                                      : 'bg-gray-800/40 border-gray-500/30 text-gray-300/90'
                                } ${triangleBadgeFlash && bidVsMath !== 'tie' ? 'updown-triangle-badge-flash' : ''}`}
                                title={
                                  bidVsMath === 'bidAbove'
                                    ? `YES best bid above math by ${(bestBid! * 100 - mathYesProb! * 100).toFixed(1)} pts — flashes if bid ≥ ${(MATH_VS_BID_FLASH_REL * 100).toFixed(0)}% away from math (relative to math)`
                                    : bidVsMath === 'bidBelow'
                                      ? `YES best bid below math by ${(mathYesProb! * 100 - bestBid! * 100).toFixed(1)} pts — flashes if bid ≥ ${(MATH_VS_BID_FLASH_REL * 100).toFixed(0)}% away from math (relative to math)`
                                      : `Within ±${MATH_VS_BID_NEUTRAL_PCT} pts of math (gap ${(bestBid! * 100 - mathYesProb! * 100).toFixed(1)} pts)`
                                }
                              >
                                {bidVsMath === 'bidAbove' && (
                                  <Triangle className="h-2.5 w-2.5 fill-current stroke-current" strokeWidth={1.5} aria-hidden />
                                )}
                                {bidVsMath === 'bidBelow' && (
                                  <Triangle className="h-2.5 w-2.5 rotate-180 fill-current stroke-current" strokeWidth={1.5} aria-hidden />
                                )}
                                {bidVsMath === 'tie' && (
                                  <Minus className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  ) : null;
                  const polymarketVol = getPolymarketVolumeUsd(market, yesTokenId, _bidAskLookup);

                  const gammaYes = { bestBid: market.bestBid, bestAsk: market.bestAsk };
                  const yesMidProb = outcomeMidOrOneSideProb(yesTokenId, _bidAskLookup, gammaYes);
                  const noProb = yesMidProb != null ? 1 - yesMidProb : null;
                  const yesMidStr = yesMidProb != null ? (yesMidProb * 100).toFixed(1) : '-';
                  const noProbStr = noProb != null ? (noProb * 100).toFixed(1) : '-';
                  const quoteDeltaBg = deltaMidVsMathBg(yesMidProb, mathYesProb);
                  const isSelected = selectedMarket?.id === market.id;
                  const avgNoProb = otherNoProb(asset);
                  const isNoProbStrong =
                    noProb != null && avgNoProb > 0 && noProb >= avgNoProb / thresholdFactor;
                  const avgYesMid = otherYesMids(asset);
                  const isYesMidStrong =
                    yesMidProb != null && avgYesMid > 0 && yesMidProb >= avgYesMid / thresholdFactor;
                  const provenSMS = yesTokenId ? (_bidAskLookup[yesTokenId]?.provenSMS ?? 0) : 0;
                  const smartMoneyBarPct = Math.max(2, Math.min(98, 50 + provenSMS * 50));
                  const marketLeansNo = yesMidProb != null && yesMidProb < 0.45;
                  const marketLeansYes = yesMidProb != null && yesMidProb > 0.55;
                  const smartMoneyLeansYes = smartMoneyBarPct > 75;
                  const smartMoneyLeansNo = smartMoneyBarPct < 25;
                  const showSmartMoneyLeftIcon = marketLeansNo && smartMoneyLeansYes;
                  const showSmartMoneyRightIcon = marketLeansYes && smartMoneyLeansNo;
                  const concRaw =
                    typeof _bidAskLookup[yesTokenId]?.concentration === 'number' &&
                    Number.isFinite(_bidAskLookup[yesTokenId]?.concentration)
                      ? _bidAskLookup[yesTokenId]!.concentration!
                      : 0;
                  const concPct = Math.max(0, Math.min(100, concRaw * 100));
                  const cR = Math.round(Math.min(255, concRaw * 2 * 255));
                  const cG = Math.round(Math.min(255, (1 - concRaw) * 2 * 255));
                  const concColor = `rgb(${cR}, ${cG}, 0)`;

                  const quoteCell = (
                    <td
                      key={asset}
                      data-market-id={market.id}
                      className={`market-cell px-0.5 py-1 text-center whitespace-nowrap border-l border-r border-solid border-gray-700 relative cursor-pointer hover:brightness-125 ${isSelected ? 'selected ring-2 ring-blue-500 ring-inset z-10' : ''} ${isLastTfRow ? 'border-b' : 'border-b border-gray-700/50'}`}
                      style={{
                        minWidth: 60,
                        ...quoteDeltaBg,
                        ...assetBorderStyle(asset, showTarget
                          ? { B: isLastTfRow }
                          : { L: true, B: isLastTfRow }),
                      }}
                      onClick={() => handleCellClick(market)}
                    >
                      {yesTokenId && positionTokenIds.has(normalizeClobTokenId(yesTokenId)) && (
                        <span
                          className="absolute left-0.5 top-0.5 z-10 h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_3px_rgba(52,211,153,0.8)]"
                          title={liveTradesSource === 'onchain' ? 'YES position (on-chain)' : 'YES position'}
                        />
                      )}
                      {noTokenId && positionTokenIds.has(normalizeClobTokenId(noTokenId)) && (
                        <span
                          className="absolute right-0.5 top-0.5 z-10 h-1.5 w-1.5 rounded-full bg-rose-400 shadow-[0_0_3px_rgba(251,113,133,0.8)]"
                          title={liveTradesSource === 'onchain' ? 'NO position (on-chain)' : 'NO position'}
                        />
                      )}
                      {showSmartMoneyLeftIcon && (
                        <span
                          className="absolute left-[4px] top-1/2 -translate-y-1/2 z-10 text-green-300 animate-[pulse_0.7s_ease-in-out_infinite]"
                          title={`Contrarian smart money: market leans NO (${((yesMidProb ?? 0) * 100).toFixed(1)}c), smart money leans YES (${smartMoneyBarPct.toFixed(1)}%)`}
                        >
                          <GraduationCap size={11} />
                        </span>
                      )}
                      {showSmartMoneyRightIcon && (
                        <span
                          className="absolute right-[4px] top-1/2 -translate-y-1/2 z-10 text-red-300 animate-[pulse_0.7s_ease-in-out_infinite]"
                          title={`Contrarian smart money: market leans YES (${((yesMidProb ?? 0) * 100).toFixed(1)}c), smart money leans NO (${smartMoneyBarPct.toFixed(1)}%)`}
                        >
                          <GraduationCap size={11} />
                        </span>
                      )}
                      <MarketCellMidRow
                        className="text-[10px] text-gray-400"
                        left={
                          <span
                            className={`cursor-pointer hover:underline ${isYesMidStrong ? 'bg-green-700 text-white font-extrabold rounded px-0.5 text-[11px]' : 'text-green-400'}`}
                            onClick={(e) => { e.stopPropagation(); handleCellClick(market, 'YES'); }}
                          >{yesMidStr}</span>
                        }
                        right={
                          <span
                            className={`cursor-pointer hover:underline ${isNoProbStrong ? 'bg-red-700 text-white font-extrabold rounded px-0.5 text-[11px]' : 'text-red-400'}`}
                            onClick={(e) => { e.stopPropagation(); handleCellClick(market, 'NO'); }}
                          >{noProbStr}</span>
                        }
                      />

                      {/* Order badges - YES bottom-left, NO bottom-right */}
                      {(() => {
                        const yesOrders = orderLookup[yesTokenId] || [];
                        const noOrders = orderLookup[noTokenId] || [];
                        const yesBuy = yesOrders.filter(o => o.side === 'BUY');
                        const yesSell = yesOrders.filter(o => o.side === 'SELL');
                        const noBuy = noOrders.filter(o => o.side === 'BUY');
                        const noSell = noOrders.filter(o => o.side === 'SELL');
                        return <>
                          {yesBuy.length > 0 && <div className="absolute bottom-0 left-0 bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tr-sm">{(Math.max(...yesBuy.map(o => parseFloat(o.price || '0') * 100))).toFixed(1)}</div>}
                          {yesSell.length > 0 && <div className={`absolute ${yesBuy.length > 0 ? 'bottom-[9px]' : 'bottom-0'} left-0 bg-yellow-400 text-[7px] px-[2px] leading-none font-bold rounded-tr-sm`} style={{ color: '#78350f' }}>{(Math.min(...yesSell.map(o => parseFloat(o.price || '0') * 100))).toFixed(1)}</div>}
                          {noBuy.length > 0 && <div className="absolute bottom-0 right-0 bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tl-sm">{(Math.max(...noBuy.map(o => parseFloat(o.price || '0') * 100))).toFixed(1)}</div>}
                          {noSell.length > 0 && <div className={`absolute ${noBuy.length > 0 ? 'bottom-[9px]' : 'bottom-0'} right-0 bg-yellow-400 text-[7px] px-[2px] leading-none font-bold rounded-tl-sm`} style={{ color: '#78350f' }}>{(Math.min(...noSell.map(o => parseFloat(o.price || '0') * 100))).toFixed(1)}</div>}
                        </>;
                      })()}
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
                      {/* Smart Money (proven wallets) */}
                      <div
                        className="absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none z-[1] flex"
                        title={`Smart Money (proven wallets): ${(provenSMS * 100).toFixed(0)}%`}
                      >
                        <div className="bg-yellow-400/75 h-full shrink-0 transition-[width]" style={{ width: `${smartMoneyBarPct}%` }} />
                        <div className="bg-purple-400/75 h-full flex-1 min-w-0" />
                      </div>
                      {market.endDate && duration > 0 && (() => {
                        const mEnd = new Date(market.endDate).getTime();
                        const p = expiryProgress(now, mEnd, duration);
                        return (
                          <div
                            className="absolute bottom-[2px] left-0 z-0 h-[2px] pointer-events-none"
                            style={{ width: `${(p * 100).toFixed(1)}%`, backgroundColor: EXPIRY_BAR_BG }}
                          />
                        );
                      })()}
                    </td>
                  );

                  const volumeCell = (
                    <td
                      key={`${asset}-vol`}
                      className={`px-1 py-1 text-right border-l border-r border-solid border-gray-700 bg-gray-900/40 text-sky-300/95 font-bold tabular-nums text-[9px] whitespace-nowrap ${isLastTfRow ? 'border-b' : 'border-b border-gray-700/50'}`}
                      style={assetBorderStyle(asset, { R: true, B: isLastTfRow })}
                      title="Toxic Flow USDC volume (wallet_positions usdc_in), shown in thousands"
                    >
                      {formatPolymarketVolumeK(polymarketVol)}
                    </td>
                  );

                  const nextCell = (() => {
                    if (!nextMarket) {
                      return (
                        <td
                          key={`${asset}-next`}
                          className={`px-1 py-1 text-center border-l border-r border-solid border-gray-700 bg-gray-900/30 text-gray-600 text-[10px] whitespace-nowrap ${isLastTfRow ? 'border-b' : 'border-b border-gray-700/50'}`}
                          style={assetBorderStyle(asset, showVolume ? { B: isLastTfRow } : { R: true, B: isLastTfRow })}
                        >
                          -
                        </td>
                      );
                    }
                    const nextTokenIds = nextMarket.clobTokenIds || [];
                    const nextYesTokenId = nextTokenIds[0] || '';
                    const nextGammaYes = { bestBid: nextMarket.bestBid, bestAsk: nextMarket.bestAsk };
                    const nextYesMid = outcomeMidOrOneSideProb(nextYesTokenId, _bidAskLookup, nextGammaYes);
                    const nextNoProb = nextYesMid != null ? 1 - nextYesMid : null;
                    return (
                      <td
                        key={`${asset}-next`}
                        className={`px-1 py-1 text-center border-l border-r border-solid border-gray-700 bg-gray-900/30 text-[10px] whitespace-nowrap cursor-pointer hover:brightness-125 relative ${isLastTfRow ? 'border-b' : 'border-b border-gray-700/50'}`}
                        style={assetBorderStyle(asset, showVolume ? { B: isLastTfRow } : { R: true, B: isLastTfRow })}
                        onClick={() => handleCellClick(nextMarket)}
                        title="Next market in this lane"
                      >
                        <MarketCellMidRow
                          className="text-gray-400"
                          left={
                            <span
                              className="text-green-400 cursor-pointer hover:underline"
                              onClick={(e) => { e.stopPropagation(); handleCellClick(nextMarket, 'YES'); }}
                            >
                              {nextYesMid != null ? (nextYesMid * 100).toFixed(1) : '-'}
                            </span>
                          }
                          right={
                            <span
                              className="text-red-400 cursor-pointer hover:underline"
                              onClick={(e) => { e.stopPropagation(); handleCellClick(nextMarket, 'NO'); }}
                            >
                              {nextNoProb != null ? (nextNoProb * 100).toFixed(1) : '-'}
                            </span>
                          }
                        />
                        {nextMarket.endDate && duration > 0 && (() => {
                          const nEnd = new Date(nextMarket.endDate).getTime();
                          const p = expiryProgress(now, nEnd, duration);
                          return (
                            <div
                              className="absolute bottom-0 left-0 z-0 h-[2px] pointer-events-none"
                              style={{ width: `${(p * 100).toFixed(1)}%`, backgroundColor: EXPIRY_BAR_BG }}
                            />
                          );
                        })()}
                      </td>
                    );
                  })();

                  return (
                    <Fragment key={asset}>
                      {targetCell}
                      {quoteCell}
                      {showNextMarket && nextCell}
                      {showVolume && volumeCell}
                    </Fragment>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
