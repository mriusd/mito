import { memo, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { CirclePercent } from 'lucide-react';
import type { Market, AssetSymbol } from '../types';
import { useAppStore } from '../stores/appStore';
import {
  chainlinkTwapWindowForUpDownTf,
  predictedTwapAtExpiry,
  resolveChainlinkBareSpotFromMap,
  useChainlinkPricesMap,
  usePolymarketPriceForMarket,
} from '../hooks/usePolymarketPrice';
import { useThrottledStorePrice } from '../hooks/useThrottledStorePrice';
import { useExpiryNow } from '../hooks/useExpiryNow';
import {
  extractAssetFromMarket,
  formatPriceShort,
  formatWeatherMarketLabel,
  getMarketPriceCondition,
  isWeatherMarket,
  upDownTimeframeKeyFromMarket,
} from '../utils/format';
import { getHitMarketProbability, getMarketProbability } from '../utils/bsMath';
import {
  useSidebarUpDownLiveSameTfMarket,
  useSidebarUpDownTargetPrice,
} from '../lib/sidebarUpDownTargetStore';
import { setSidebarSpotStripBsSnapshot } from '../lib/sidebarSpotStripStore';
import { weatherMarketLocalMidnightExpiryMs } from '../lib/weatherMarketExpiry';
import { CHART_PRED_MATH_PROB_COLOR } from '../lib/chartCandleEnrichment';
import { SidebarMarketCountdownLabel } from './SidebarMarketCountdownLabel';
import { SidebarSpotStripMathButton } from './SidebarSpotStripMathButton';
import { SidebarSpotVolSigmaLabel } from './SidebarSpotVolSigmaLabel';
import { SidebarYesMidProbBar } from './SidebarYesMidProbBar';
import { HelpTooltip } from './HelpTooltip';
import type { SidebarPolymarketBookSnapshot } from './SidebarPolymarketOBHost';

type PriceDelta = { abs: number; pct: number; isUp: boolean };

type SpotStripRow = {
  mode: 'updown' | 'generic' | 'weather';
  targetDisplay: string;
  priceDec: number;
  /** BS cents for order side — pred TWAP (up/down) or spot (generic). */
  mathCents: number | null;
  /** Model YES ¢ from pred TWAP (up/down) or spot (generic); drives prob bar. */
  yesMathCents: number | null;
  /** Up/Down only: BS for order side using live settlement TWAP as S₀. */
  twapMathCents: number | null;
  pastExpiry: boolean;
  /** Settlement TWAP (CL60 for 5m/15m) or Binance. */
  currentPrice: number;
  currentSource: 'chainlink' | 'binance';
  /** Live spot (Chainlink bare preferred, else Binance). */
  spotPrice: number;
  spotSource: 'chainlink' | 'binance';
  /** Predicted settlement TWAP at expiry (mitobot continuous formula). */
  predictedTwap: number;
  predictedWinSec: number;
  predictedRemInWin: number;
  /** TWAP − Target */
  diff: PriceDelta | null;
  /** Spot − Target */
  spotVsTarget: PriceDelta | null;
  /** Predicted TWAP − Target */
  predVsTarget: PriceDelta | null;
  hitModel?: boolean;
  countdownEndDate?: string;
};

function deltaVsTarget(price: number, target: number | null | undefined): PriceDelta | null {
  if (!(price > 0) || target == null || !(target > 0)) return null;
  const signedDelta = price - target;
  return {
    abs: Math.abs(signedDelta),
    pct: (signedDelta / target) * 100,
    isUp: signedDelta >= 0,
  };
}

function formatUsd(n: number, priceDec: number): string {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: priceDec, maximumFractionDigits: priceDec })}`;
}

function DeltaLine({
  d,
  priceDec,
  title,
}: {
  d: PriceDelta | null;
  priceDec: number;
  title?: string;
}) {
  if (!d) {
    return (
      <span className="inline-flex min-h-[15px] items-center text-transparent select-none" aria-hidden>
        ↑0.00 (0.00%)
      </span>
    );
  }
  return (
    <span
      className={`inline-flex min-h-[15px] items-center whitespace-nowrap gap-0.5 sidebar-readable-value ${d.isUp ? 'text-green-400' : 'text-red-400'}`}
      title={title}
    >
      <span>
        {d.isUp ? '↑' : '↓'}
        {d.abs.toLocaleString(undefined, {
          minimumFractionDigits: priceDec,
          maximumFractionDigits: priceDec,
        })}
      </span>
      <span>
        ({d.pct >= 0 ? '+' : ''}
        {d.pct.toFixed(2)}%)
      </span>
    </span>
  );
}

export const SidebarSpotStripSection = memo(function SidebarSpotStripSection({
  selectedMarket,
  marketLookup,
  orderOutcome,
  isUpDownMarket,
  selectedMarketIsHit,
  upDownSpotUsesChainlink,
  sidebarChartKlineLabel,
  notifyMaxVolatilityPct,
  notifyVolatilityCandles,
  sidebarBookRef,
  onPickPrice,
  onSwitchLiveMarket,
}: {
  selectedMarket: Market;
  marketLookup: Record<string, Market>;
  orderOutcome: 'YES' | 'NO';
  isUpDownMarket: boolean;
  selectedMarketIsHit: boolean;
  upDownSpotUsesChainlink: boolean;
  sidebarChartKlineLabel: string;
  notifyMaxVolatilityPct: number;
  notifyVolatilityCandles: number;
  sidebarBookRef: React.MutableRefObject<SidebarPolymarketBookSnapshot | null>;
  onPickPrice: (cents: string) => void;
  onSwitchLiveMarket?: (market: Market) => void;
}) {
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);
  const upDownTargetPrice = useSidebarUpDownTargetPrice();
  const liveUpDownSameTfMarket = useSidebarUpDownLiveSameTfMarket();
  const expiryNow = useExpiryNow();

  const sidebarPriceSym = useMemo((): AssetSymbol | null => {
    const asset = extractAssetFromMarket(selectedMarket);
    return asset ? (`${asset.toUpperCase()}USDT` as AssetSymbol) : null;
  }, [selectedMarket]);

  const sidebarThrottledSpot = useThrottledStorePrice(sidebarPriceSym ?? 'BTCUSDT', 1000);
  const upDownAsset = isUpDownMarket ? extractAssetFromMarket(selectedMarket) : null;
  // 5m + 15m → TWAP-60 (CL60) for settlement column.
  const polyPrice = usePolymarketPriceForMarket(
    upDownSpotUsesChainlink ? selectedMarket : null,
    upDownSpotUsesChainlink ? upDownAsset : null,
  );
  const chainlinkPricesMap = useChainlinkPricesMap();
  const upDownTf = isUpDownMarket ? upDownTimeframeKeyFromMarket(selectedMarket) : null;

  const row = useMemo((): SpotStripRow | null => {
    if (isWeatherMarket(selectedMarket)) {
      const expiryMs = weatherMarketLocalMidnightExpiryMs(selectedMarket);
      const countdownEndDate =
        expiryMs != null ? new Date(expiryMs).toISOString() : selectedMarket.endDate || '';
      if (!countdownEndDate) return null;
      const nowOffset = Date.now() + bsTimeOffsetHours * 3600000;
      const pastExpiry = nowOffset >= new Date(countdownEndDate).getTime();
      const targetDisplay =
        formatWeatherMarketLabel(
          selectedMarket.question,
          selectedMarket.eventSlug,
          selectedMarket.groupItemTitle,
        ) || selectedMarket.groupItemTitle || '—';
      return {
        mode: 'weather',
        targetDisplay,
        priceDec: 0,
        mathCents: null,
        yesMathCents: null,
        twapMathCents: null,
        pastExpiry,
        currentPrice: 0,
        currentSource: 'binance',
        spotPrice: 0,
        spotSource: 'binance',
        predictedTwap: 0,
        predictedWinSec: 0,
        predictedRemInWin: 0,
        diff: null,
        spotVsTarget: null,
        predVsTarget: null,
        countdownEndDate,
      };
    }

    if (!selectedMarket?.endDate) return null;
    const endDate = selectedMarket.endDate;
    const asset = extractAssetFromMarket(selectedMarket);
    if (!asset) return null;
    const sym = (asset + 'USDT') as AssetSymbol;
    const sigma = (volatilityData[sym] || 0.6) * volMultiplier;
    const priceDec = asset.toUpperCase() === 'XRP' ? 4 : 2;

    const nowOffset = Date.now() + bsTimeOffsetHours * 3600000;
    const expiryMs = new Date(endDate).getTime();
    const pastExpiry = bsTimeOffsetHours > 0 && nowOffset >= expiryMs;

    if (isUpDownMarket) {
      const binanceSym = (asset.toUpperCase() + 'USDT') as AssetSymbol;
      const chainlinkTwap =
        upDownSpotUsesChainlink && polyPrice.price != null && polyPrice.price > 0 ? polyPrice.price : 0;
      const binancePrice = sidebarPriceSym === binanceSym ? sidebarThrottledSpot : 0;
      const currentPrice = upDownSpotUsesChainlink ? chainlinkTwap || binancePrice : binancePrice;
      const currentSource: 'chainlink' | 'binance' =
        upDownSpotUsesChainlink && chainlinkTwap > 0 ? 'chainlink' : 'binance';

      const bareCl = resolveChainlinkBareSpotFromMap(chainlinkPricesMap, asset);
      const spotFromCl = bareCl.price != null && bareCl.price > 0 ? bareCl.price : 0;
      const spotPrice = spotFromCl > 0 ? spotFromCl : binancePrice;
      const spotSource: 'chainlink' | 'binance' = spotFromCl > 0 ? 'chainlink' : 'binance';

      // Mitobot continuous: pred = (twap*(W−r) + spot*r)/W, W=60 for 5m/15m.
      const winSec = chainlinkTwapWindowForUpDownTf(upDownTf) ?? 60;
      const predSnap =
        currentPrice > 0 && spotPrice > 0
          ? predictedTwapAtExpiry({
              twap: currentPrice,
              spot: spotPrice,
              endMs: expiryMs,
              nowMs: expiryNow + bsTimeOffsetHours * 3600000,
              windowSec: winSec,
            })
          : null;
      const predictedTwap = predSnap?.pred ?? 0;

      // Top Math: BS from live settlement TWAP. Bottom Math: BS from predicted TWAP.
      let twapMathCents: number | null = null;
      let mathCents: number | null = null;
      let yesMathCents: number | null = null;
      if (!pastExpiry && upDownTargetPrice) {
        if (currentPrice > 0) {
          const pTwap = getMarketProbability(
            '>' + upDownTargetPrice,
            currentPrice,
            endDate,
            sigma,
            bsTimeOffsetHours,
          );
          if (pTwap !== null) {
            twapMathCents = (orderOutcome === 'YES' ? pTwap : 1 - pTwap) * 100;
          }
        }
        const predUnderlying = predictedTwap > 0 ? predictedTwap : 0;
        if (predUnderlying > 0) {
          const pPred = getMarketProbability(
            '>' + upDownTargetPrice,
            predUnderlying,
            endDate,
            sigma,
            bsTimeOffsetHours,
          );
          if (pPred !== null) {
            yesMathCents = pPred * 100;
            mathCents = (orderOutcome === 'YES' ? pPred : 1 - pPred) * 100;
          }
        }
      }

      return {
        mode: 'updown',
        targetDisplay:
          upDownTargetPrice != null
            ? formatUsd(upDownTargetPrice, priceDec)
            : '...',
        priceDec,
        mathCents,
        yesMathCents,
        twapMathCents,
        pastExpiry,
        currentPrice,
        currentSource,
        spotPrice,
        spotSource,
        predictedTwap,
        predictedWinSec: predSnap?.win ?? winSec,
        predictedRemInWin: predSnap?.remInWin ?? 0,
        diff: deltaVsTarget(currentPrice, upDownTargetPrice),
        spotVsTarget: deltaVsTarget(spotPrice, upDownTargetPrice),
        predVsTarget: deltaVsTarget(predictedTwap, upDownTargetPrice),
      };
    }

    const strikeRaw = (selectedMarket.groupItemTitle || '').trim();
    if (!strikeRaw) return null;

    const currentPrice = sidebarPriceSym === sym ? sidebarThrottledSpot : 0;
    const currentSource = 'binance' as const;

    const cleaned = strikeRaw.replace(/^Hit\s*/i, '').replace(/[\$,]/g, '').replace(/↑/g, '>').replace(/↓/g, '<').trim();
    const ps =
      cleaned.startsWith('>') || cleaned.startsWith('<') || cleaned.includes('-') ? cleaned : '>' + cleaned;

    const targetDisplay =
      getMarketPriceCondition(
        selectedMarket.question || selectedMarket.groupItemTitle,
        selectedMarket.clobTokenIds?.[0],
        marketLookup,
      ) || formatPriceShort(ps, asset === 'ETH' ? 'ETH' : undefined);

    let mathCents: number | null = null;
    let yesMathCents: number | null = null;
    if (!pastExpiry && currentPrice > 0) {
      const probYes = selectedMarketIsHit
        ? getHitMarketProbability(ps, currentPrice, endDate, sigma, bsTimeOffsetHours)
        : getMarketProbability(ps, currentPrice, endDate, sigma, bsTimeOffsetHours);
      if (probYes !== null) {
        yesMathCents = probYes * 100;
        mathCents = (orderOutcome === 'YES' ? probYes : 1 - probYes) * 100;
      }
    }

    let diff: PriceDelta | null = null;
    if (currentPrice > 0 && !ps.includes('-')) {
      let rest = ps.replace(/,/g, '');
      if (rest.startsWith('>') || rest.startsWith('<')) rest = rest.slice(1);
      let K: number;
      if (rest.toLowerCase().endsWith('k')) {
        const n = parseFloat(rest.slice(0, -1));
        K = isNaN(n) || n <= 0 ? NaN : n * 1000;
      } else {
        K = parseFloat(rest);
      }
      if (!isNaN(K) && K > 0) {
        diff = deltaVsTarget(currentPrice, K);
      }
    }

    return {
      mode: 'generic',
      targetDisplay,
      priceDec,
      mathCents,
      yesMathCents,
      twapMathCents: null,
      pastExpiry,
      currentPrice,
      currentSource,
      spotPrice: currentPrice,
      spotSource: currentSource,
      predictedTwap: 0,
      predictedWinSec: 0,
      predictedRemInWin: 0,
      diff,
      spotVsTarget: null,
      predVsTarget: null,
      hitModel: selectedMarketIsHit,
    };
  }, [
    selectedMarket,
    marketLookup,
    isUpDownMarket,
    upDownTargetPrice,
    upDownSpotUsesChainlink,
    polyPrice.price,
    chainlinkPricesMap,
    upDownTf,
    sidebarPriceSym,
    sidebarThrottledSpot,
    volatilityData,
    volMultiplier,
    bsTimeOffsetHours,
    orderOutcome,
    selectedMarketIsHit,
    expiryNow,
  ]);

  useLayoutEffect(() => {
    if (!row) {
      setSidebarSpotStripBsSnapshot(null);
      return;
    }
    setSidebarSpotStripBsSnapshot({
      yesMathCents: row.yesMathCents,
      mathCents: row.mathCents,
      pastExpiry: row.pastExpiry,
    });
  }, [row]);

  useEffect(() => () => setSidebarSpotStripBsSnapshot(null), []);

  const currentPriceRef = useRef<HTMLSpanElement>(null);
  const spotPriceRef = useRef<HTMLSpanElement>(null);
  const predPriceRef = useRef<HTMLSpanElement>(null);
  const prevPriceRef = useRef(0);
  const prevSpotRef = useRef(0);
  const prevPredRef = useRef(0);

  useEffect(() => {
    prevPriceRef.current = 0;
    prevSpotRef.current = 0;
    prevPredRef.current = 0;
  }, [selectedMarket.id]);

  useEffect(() => {
    const p = row?.currentPrice;
    if (!p || p <= 0 || !currentPriceRef.current) return;
    const el = currentPriceRef.current;
    if (prevPriceRef.current && p !== prevPriceRef.current) {
      const cls = p > prevPriceRef.current ? 'updown-flash-up' : 'updown-flash-down';
      el.classList.remove('updown-flash-up', 'updown-flash-down');
      void el.offsetWidth;
      el.classList.add(cls);
    }
    prevPriceRef.current = p;
  }, [row?.currentPrice]);

  useEffect(() => {
    const p = row?.spotPrice;
    if (!p || p <= 0 || !spotPriceRef.current) return;
    const el = spotPriceRef.current;
    if (prevSpotRef.current && p !== prevSpotRef.current) {
      const cls = p > prevSpotRef.current ? 'updown-flash-up' : 'updown-flash-down';
      el.classList.remove('updown-flash-up', 'updown-flash-down');
      void el.offsetWidth;
      el.classList.add(cls);
    }
    prevSpotRef.current = p;
  }, [row?.spotPrice]);

  useEffect(() => {
    const p = row?.predictedTwap;
    if (!p || p <= 0 || !predPriceRef.current) return;
    const el = predPriceRef.current;
    if (prevPredRef.current && p !== prevPredRef.current) {
      const cls = p > prevPredRef.current ? 'updown-flash-up' : 'updown-flash-down';
      el.classList.remove('updown-flash-up', 'updown-flash-down');
      void el.offsetWidth;
      el.classList.add(cls);
    }
    prevPredRef.current = p;
  }, [row?.predictedTwap]);

  if (!row) return null;

  const mathTooltip =
    row.mode === 'weather'
      ? ''
      : row.hitModel
        ? 'Fair-value probability for this Hit market (one-touch / first-passage under GBM): risk-neutral chance price touches the strike by expiry. Same Binance spot as “Current”, σ from settings.\n\nCompare to the order book to spot mispricings.'
        : 'Fair-value probability (terminal Black-Scholes–style) for this market’s strike vs spot.\n\nUses Binance spot, time to expiry, and σ. For YES/NO: YES uses model YES probability; NO uses 100% − YES.\n\nCompare to the market price to spot mispricings.';

  const twapBadge =
    row.mode === 'updown'
      ? {
          label:
            row.currentSource === 'chainlink'
              ? upDownTf === '5m' || upDownTf === '15m'
                ? 'CL60'
                : 'CL'
              : 'BINANCE',
          className: row.currentSource === 'chainlink' ? 'bg-blue-600 text-white' : 'bg-yellow-400 text-black',
          title:
            row.currentSource === 'chainlink'
              ? 'Current settlement TWAP-60 (crypto_prices_twap_sixty)'
              : upDownSpotUsesChainlink
                ? 'Binance spot (fallback until TWAP feed connects)'
                : 'Binance spot (1h/4h/24h Up/Down)',
        }
      : {
          label: 'BINANCE',
          className: 'bg-yellow-400 text-black',
          title: 'Binance spot',
        };

  const spotBadge =
    row.mode === 'updown'
      ? {
          label: row.spotSource === 'chainlink' ? 'CL' : 'BINANCE',
          className: row.spotSource === 'chainlink' ? 'bg-blue-600 text-white' : 'bg-yellow-400 text-black',
          title:
            row.spotSource === 'chainlink'
              ? 'Chainlink spot (live underlying, not settlement TWAP)'
              : 'Binance spot (fallback until Chainlink spot connects)',
        }
      : null;

  const reserveUpDownSpotHeight = row.mode === 'updown' && !row.pastExpiry;
  const predTitle =
    row.predictedTwap > 0
      ? `Predicted settlement TWAP at expiry if spot stays flat (mitobot continuous):\n` +
        `(TWAP×(W−r) + Spot×r)/W with W=${row.predictedWinSec}s, r=${row.predictedRemInWin.toFixed(1)}s left in window`
      : 'Predicted TWAP needs both current TWAP and spot';

  // ——— Up/Down: Target | BS(TWAP) | TWAP  /  Spot | BS(pred) | Pred TWAP ———
  if (row.mode === 'updown') {
    const twapMathTooltip =
      'Terminal BS for this side using live settlement TWAP as S₀ (CL60/CL30), strike = Target, σ from settings.\n\n' +
      'Click to fill order price.';
    const predMathTooltip =
      'Terminal BS for this side using predicted settlement TWAP as S₀ (spot stays flat to expiry), strike = Target, σ from settings.\n\n' +
      'Click to fill order price.';
    const threeCol = {
      gridTemplateColumns: 'minmax(0, 1fr) minmax(3.25rem, auto) minmax(0, 1fr)',
    } as const;

    return (
      <div className={`sidebar-section sidebar-target-section py-1 px-3${reserveUpDownSpotHeight ? ' min-h-[9.5rem]' : ''}`}>
        {/* Row 1: Target | Math(TWAP) | TWAP */}
        <div className="grid gap-x-2 gap-y-1 w-full" style={threeCol}>
          <div className="flex items-center min-h-[15px] text-[9px] font-medium leading-none text-gray-500">
            Target
          </div>
          <div className="flex items-center justify-center gap-0.5 min-h-[15px] text-[9px] font-medium leading-none text-gray-500">
            <CirclePercent className="h-[9px] w-[9px] shrink-0 opacity-80" strokeWidth={2.5} aria-hidden />
            <span className="shrink-0">Math</span>
            <HelpTooltip
              text={twapMathTooltip}
              openOnHover
              wrapClassName="inline-flex shrink-0 items-center leading-none"
            >
              <span className="flex size-[10px] shrink-0 cursor-help items-center justify-center rounded-full border border-gray-500 text-[7px] font-bold leading-none text-gray-400 hover:border-gray-300 hover:text-gray-200">
                ?
              </span>
            </HelpTooltip>
          </div>
          <div className="flex items-center justify-end gap-1 min-h-[15px] text-[9px] font-medium leading-none text-gray-500">
            <span className="shrink-0">TWAP</span>
            <span
              className={`shrink-0 px-0.5 rounded-sm text-[9px] font-bold leading-none py-px ${twapBadge.className}`}
              title={twapBadge.title}
            >
              {twapBadge.label}
            </span>
          </div>

          <div className="flex items-center min-h-[16px] min-w-0">
            <span className="text-[11px] font-bold tabular-nums text-white truncate sidebar-readable-value">
              {row.targetDisplay}
            </span>
          </div>
          <div className="flex items-center justify-center min-h-[16px] min-w-0">
            {row.pastExpiry ? (
              <span className="text-gray-500 tabular-nums text-[11px] sidebar-readable-value" title="Time machine ahead of expiration">
                &gt;⏱
              </span>
            ) : row.twapMathCents !== null ? (
              <SidebarSpotStripMathButton
                mathCents={row.twapMathCents}
                sidebarBookRef={sidebarBookRef}
                onPickPrice={onPickPrice}
              />
            ) : (
              <span className="text-gray-600 text-[11px] sidebar-readable-value">—</span>
            )}
          </div>
          <div className="flex items-center justify-end min-h-[16px] min-w-0">
            <span
              ref={currentPriceRef}
              className="text-[11px] font-bold tabular-nums text-white truncate whitespace-nowrap sidebar-readable-value"
            >
              {row.currentPrice ? formatUsd(row.currentPrice, row.priceDec) : '...'}
            </span>
          </div>

          <div className="flex items-center min-h-[15px] min-w-0 text-[10px] font-bold tabular-nums leading-none">
            {selectedMarket?.endDate ? (
              <SidebarMarketCountdownLabel
                endDate={selectedMarket.endDate}
                mode={row.mode}
                liveUpDownSameTfMarket={liveUpDownSameTfMarket}
                onSwitchLiveMarket={
                  liveUpDownSameTfMarket && onSwitchLiveMarket
                    ? () => onSwitchLiveMarket(liveUpDownSameTfMarket)
                    : undefined
                }
              />
            ) : (
              <span className="text-transparent select-none" aria-hidden>
                —
              </span>
            )}
          </div>
          <div className="flex items-center justify-center min-h-[15px] min-w-0 text-[10px] font-bold tabular-nums leading-none">
            <span className="text-transparent select-none text-[9px]" aria-hidden>
              σ
            </span>
          </div>
          <div className="flex items-center justify-end min-h-[15px] min-w-0 text-[10px] font-bold tabular-nums leading-none">
            <DeltaLine d={row.diff} priceDec={row.priceDec} title="TWAP − Target" />
          </div>
        </div>

        {/* Row 2: Spot | Math(pred TWAP) | Pred TWAP */}
        <div
          className="grid gap-x-2 gap-y-1 w-full mt-1 pt-1 border-t border-gray-800/60"
          style={threeCol}
        >
          <div className="flex items-center gap-1 min-h-[15px] text-[9px] font-medium leading-none text-gray-500">
            <span className="shrink-0">Spot</span>
            {spotBadge && (
              <span
                className={`shrink-0 px-0.5 rounded-sm text-[9px] font-bold leading-none py-px ${spotBadge.className}`}
                title={spotBadge.title}
              >
                {spotBadge.label}
              </span>
            )}
            <HelpTooltip
              text="Live Chainlink spot (crypto_prices_chainlink), else Binance."
              openOnHover
              wrapClassName="inline-flex shrink-0 items-center leading-none"
            >
              <span className="flex size-[10px] shrink-0 cursor-help items-center justify-center rounded-full border border-gray-500 text-[7px] font-bold leading-none text-gray-400 hover:border-gray-300 hover:text-gray-200">
                ?
              </span>
            </HelpTooltip>
          </div>
          <div
            className="flex items-center justify-center gap-0.5 min-h-[15px] text-[9px] font-medium leading-none"
            style={{ color: CHART_PRED_MATH_PROB_COLOR }}
          >
            <CirclePercent className="h-[9px] w-[9px] shrink-0 opacity-90" strokeWidth={2.5} aria-hidden />
            <span className="shrink-0">Math</span>
            <HelpTooltip
              text={predMathTooltip}
              openOnHover
              wrapClassName="inline-flex shrink-0 items-center leading-none"
            >
              <span className="flex size-[10px] shrink-0 cursor-help items-center justify-center rounded-full border border-pink-500/70 text-[7px] font-bold leading-none text-pink-300/90 hover:border-pink-300 hover:text-pink-200">
                ?
              </span>
            </HelpTooltip>
          </div>
          <div className="flex items-center justify-end gap-1 min-h-[15px] text-[9px] font-medium leading-none text-gray-500">
            <span className="shrink-0">Pred TWAP</span>
            <HelpTooltip
              text={
                'Mitobot continuous predicted settlement TWAP at expiry if spot stays flat:\n\n' +
                'predicted = (current_TWAP × (W − r) + spot × r) / W\n\n' +
                'W = rolling window (60s for 5m/15m). r = seconds left clamped to [0, W].\n' +
                'Before the window (r=W) → pred = spot; at expiry (r=0) → pred = current TWAP.\n\n' +
                'Bottom Math uses this predicted TWAP as S₀.'
              }
              openOnHover
              wrapClassName="inline-flex shrink-0 items-center leading-none"
            >
              <span className="flex size-[10px] shrink-0 cursor-help items-center justify-center rounded-full border border-gray-500 text-[7px] font-bold leading-none text-gray-400 hover:border-gray-300 hover:text-gray-200">
                ?
              </span>
            </HelpTooltip>
          </div>

          <div className="flex items-center min-h-[16px] min-w-0">
            {row.pastExpiry ? (
              <span className="text-gray-500 tabular-nums text-[11px] sidebar-readable-value" title="Time machine ahead of expiration">
                &gt;⏱
              </span>
            ) : (
              <span
                ref={spotPriceRef}
                className="text-[11px] font-bold tabular-nums text-white truncate whitespace-nowrap sidebar-readable-value"
              >
                {row.spotPrice ? formatUsd(row.spotPrice, row.priceDec) : '...'}
              </span>
            )}
          </div>
          <div className="flex items-center justify-center min-h-[16px] min-w-0">
            {row.pastExpiry ? (
              <span className="text-gray-500 tabular-nums text-[11px] sidebar-readable-value" title="Time machine ahead of expiration">
                &gt;⏱
              </span>
            ) : row.mathCents !== null ? (
              <SidebarSpotStripMathButton
                mathCents={row.mathCents}
                sidebarBookRef={sidebarBookRef}
                onPickPrice={onPickPrice}
                color={CHART_PRED_MATH_PROB_COLOR}
              />
            ) : (
              <span className="text-gray-600 text-[11px] sidebar-readable-value">—</span>
            )}
          </div>
          <div className="flex items-center justify-end min-h-[16px] min-w-0">
            <span
              ref={predPriceRef}
              className="text-[11px] font-bold tabular-nums text-amber-200/95 truncate whitespace-nowrap sidebar-readable-value"
              title={predTitle}
            >
              {row.predictedTwap > 0 ? formatUsd(row.predictedTwap, row.priceDec) : '...'}
            </span>
          </div>

          <div className="flex items-center min-h-[15px] min-w-0 text-[10px] font-bold tabular-nums leading-none">
            <DeltaLine d={row.spotVsTarget} priceDec={row.priceDec} title="Spot − Target" />
          </div>
          <div className="flex items-center justify-center min-h-[15px] min-w-0 text-[10px] font-bold tabular-nums leading-none">
            <SidebarSpotVolSigmaLabel
              notifyMaxVolatilityPct={notifyMaxVolatilityPct}
              notifyVolatilityCandles={notifyVolatilityCandles}
              sidebarChartKlineLabel={sidebarChartKlineLabel}
              pastExpiry={row.pastExpiry}
            />
          </div>
          <div className="flex items-center justify-end min-h-[15px] min-w-0 text-[10px] font-bold tabular-nums leading-none">
            <DeltaLine d={row.predVsTarget} priceDec={row.priceDec} title="Predicted TWAP − Target" />
          </div>
        </div>
        {reserveUpDownSpotHeight && (
          <SidebarYesMidProbBar
            yesMathCents={row.yesMathCents}
            sidebarBookRef={sidebarBookRef}
            shellOnly={row.yesMathCents == null}
          />
        )}
      </div>
    );
  }

  // ——— Weather / generic (3-column) ———
  const currentBadge =
    row.mode === 'weather'
      ? {
          label: 'GMT',
          className: 'bg-gray-600 text-gray-200',
          title: 'Expires at GMT midnight after event day',
        }
      : twapBadge;

  return (
    <div className="sidebar-section sidebar-target-section py-1 px-3">
      <div
        className="grid gap-x-3 gap-y-1.5 items-center w-full min-h-[3.625rem]"
        style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(6rem, 1fr) minmax(0, 1fr)' }}
      >
        <div className="flex items-center min-h-[15px] text-left text-[9px] font-medium leading-none text-gray-500">
          Target
        </div>
        <div className="flex items-center justify-center gap-1 min-h-[15px] text-[9px] font-medium leading-none text-gray-500 min-w-0 px-px">
          {row.mode === 'weather' ? (
            <span className="shrink-0 text-transparent select-none" aria-hidden>
              Math
            </span>
          ) : row.pastExpiry ? (
            <>
              <CirclePercent className="h-[9px] w-[9px] shrink-0 opacity-80" strokeWidth={2.5} aria-hidden />
              <span className="shrink-0">Math</span>
            </>
          ) : (
            <>
              <CirclePercent className="h-[9px] w-[9px] shrink-0 opacity-80" strokeWidth={2.5} aria-hidden />
              <span className="shrink-0">Math</span>
              <HelpTooltip
                text={mathTooltip}
                openOnHover
                wrapClassName="inline-flex shrink-0 items-center leading-none ml-px"
              >
                <span className="flex size-[10px] shrink-0 cursor-help items-center justify-center rounded-full border border-gray-500 text-[7px] font-bold leading-none text-gray-400 hover:border-gray-300 hover:text-gray-200">
                  ?
                </span>
              </HelpTooltip>
            </>
          )}
        </div>
        <div className="flex items-center justify-end gap-1.5 min-h-[15px] flex-nowrap text-[9px] font-medium leading-none text-gray-500 min-w-0">
          {row.mode === 'weather' ? (
            <span className="shrink-0 text-transparent select-none" aria-hidden>
              Current
            </span>
          ) : (
            <>
              <span className="shrink-0">Current</span>
              <span
                className={`shrink-0 px-0.5 rounded-sm text-[9px] font-bold leading-none py-px ${currentBadge.className}`}
                title={currentBadge.title}
              >
                {currentBadge.label}
              </span>
            </>
          )}
        </div>

        <div className="flex items-center justify-start min-h-[16px] min-w-0">
          <span className="inline-flex min-h-[16px] items-center text-[11px] font-bold tabular-nums text-white truncate max-w-full sidebar-readable-value">
            {row.targetDisplay}
          </span>
        </div>
        <div className="flex items-center justify-center min-h-[16px] min-w-0 text-[11px] font-bold tabular-nums px-px">
          {row.mode === 'weather' ? (
            <span className="text-gray-600 text-[11px] sidebar-readable-value">—</span>
          ) : row.pastExpiry ? (
            <span className="text-gray-500 tabular-nums text-[11px] sidebar-readable-value" title="Time machine ahead of expiration">
              &gt;⏱
            </span>
          ) : row.mathCents !== null ? (
            <SidebarSpotStripMathButton
              mathCents={row.mathCents}
              sidebarBookRef={sidebarBookRef}
              onPickPrice={onPickPrice}
            />
          ) : (
            <span className="text-gray-600 text-[11px] sidebar-readable-value">—</span>
          )}
        </div>
        <div className="flex items-center justify-end min-h-[16px] min-w-0">
          <span
            ref={currentPriceRef}
            className="text-[11px] font-bold tabular-nums text-white truncate max-w-full whitespace-nowrap sidebar-readable-value"
          >
            {row.mode === 'weather'
              ? '—'
              : row.currentPrice
                ? formatUsd(row.currentPrice, row.priceDec)
                : '...'}
          </span>
        </div>

        <div className="flex items-center justify-start min-h-[15px] min-w-0 text-[10px] font-bold tabular-nums leading-none">
          {row.countdownEndDate || selectedMarket?.endDate ? (
            <SidebarMarketCountdownLabel
              endDate={row.countdownEndDate ?? selectedMarket.endDate ?? ''}
              mode={row.mode}
            />
          ) : (
            <span className="text-transparent select-none" aria-hidden>
              —
            </span>
          )}
        </div>
        <div className="flex items-center justify-center min-h-[15px] min-w-0 text-[10px] font-bold tabular-nums leading-none px-px">
          {row.mode === 'weather' ? (
            <span className="text-transparent select-none" aria-hidden>
              σ
            </span>
          ) : (
            <SidebarSpotVolSigmaLabel
              notifyMaxVolatilityPct={notifyMaxVolatilityPct}
              notifyVolatilityCandles={notifyVolatilityCandles}
              sidebarChartKlineLabel={sidebarChartKlineLabel}
              pastExpiry={row.pastExpiry}
            />
          )}
        </div>
        <div className="flex items-center justify-end min-h-[15px] min-w-0 text-[10px] font-bold tabular-nums leading-none">
          <DeltaLine d={row.diff} priceDec={row.priceDec} />
        </div>
      </div>
    </div>
  );
});
