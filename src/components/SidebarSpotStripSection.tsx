import { memo, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { CirclePercent } from 'lucide-react';
import type { Market, AssetSymbol } from '../types';
import { useAppStore } from '../stores/appStore';
import { usePolymarketPriceForMarket } from '../hooks/usePolymarketPrice';
import { useThrottledStorePrice } from '../hooks/useThrottledStorePrice';
import {
  extractAssetFromMarket,
  formatPriceShort,
  formatWeatherMarketLabel,
  getMarketPriceCondition,
  isWeatherMarket,
  upDownMarketUsesChainlinkSpot,
  upDownTimeframeKeyFromMarket,
} from '../utils/format';
import { getHitMarketProbability, getMarketProbability } from '../utils/bsMath';
import {
  useSidebarUpDownLiveSameTfMarket,
  useSidebarUpDownTargetPrice,
} from '../lib/sidebarUpDownTargetStore';
import { setSidebarSpotStripBsSnapshot } from '../lib/sidebarSpotStripStore';
import { weatherMarketLocalMidnightExpiryMs } from '../lib/weatherMarketExpiry';
import { SidebarMarketCountdownLabel } from './SidebarMarketCountdownLabel';
import { SidebarSpotStripMathButton } from './SidebarSpotStripMathButton';
import { SidebarSpotVolSigmaLabel } from './SidebarSpotVolSigmaLabel';
import { SidebarYesMidProbBar } from './SidebarYesMidProbBar';
import { HelpTooltip } from './HelpTooltip';
import type { SidebarPolymarketBookSnapshot } from './SidebarPolymarketOBHost';

type SpotStripRow = {
  mode: 'updown' | 'generic' | 'weather';
  targetDisplay: string;
  priceDec: number;
  mathCents: number | null;
  yesMathCents: number | null;
  pastExpiry: boolean;
  currentPrice: number;
  currentSource: 'chainlink' | 'binance';
  diff: { abs: number; pct: number; isUp: boolean } | null;
  hitModel?: boolean;
  countdownEndDate?: string;
};

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

  const sidebarPriceSym = useMemo((): AssetSymbol | null => {
    const asset = extractAssetFromMarket(selectedMarket);
    return asset ? (`${asset.toUpperCase()}USDT` as AssetSymbol) : null;
  }, [selectedMarket]);

  const sidebarThrottledSpot = useThrottledStorePrice(sidebarPriceSym ?? 'BTCUSDT', 1000);
  const upDownAsset = isUpDownMarket ? extractAssetFromMarket(selectedMarket) : null;
  // 5m → TWAP-30, 15m → TWAP-60 (Polymarket settlement alignment).
  const polyPrice = usePolymarketPriceForMarket(
    upDownSpotUsesChainlink ? selectedMarket : null,
    upDownSpotUsesChainlink ? upDownAsset : null,
  );
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
        pastExpiry,
        currentPrice: 0,
        currentSource: 'binance',
        diff: null,
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
      const chainlinkPrice =
        upDownSpotUsesChainlink && polyPrice.price != null && polyPrice.price > 0 ? polyPrice.price : 0;
      const binancePrice = sidebarPriceSym === binanceSym ? sidebarThrottledSpot : 0;
      const currentPrice = upDownSpotUsesChainlink ? chainlinkPrice || binancePrice : binancePrice;
      const currentSource: 'chainlink' | 'binance' =
        upDownSpotUsesChainlink && chainlinkPrice > 0 ? 'chainlink' : 'binance';

      let mathCents: number | null = null;
      let yesMathCents: number | null = null;
      if (!pastExpiry && upDownTargetPrice && currentPrice) {
        const probUp = getMarketProbability('>' + upDownTargetPrice, currentPrice, endDate, sigma, bsTimeOffsetHours);
        if (probUp !== null) {
          yesMathCents = probUp * 100;
          mathCents = (orderOutcome === 'YES' ? probUp : 1 - probUp) * 100;
        }
      }

      const diff =
        upDownTargetPrice && currentPrice
          ? (() => {
              const signedDelta = currentPrice - upDownTargetPrice;
              return {
                abs: Math.abs(signedDelta),
                pct: (signedDelta / upDownTargetPrice) * 100,
                isUp: signedDelta >= 0,
              };
            })()
          : null;

      return {
        mode: 'updown',
        targetDisplay:
          upDownTargetPrice != null
            ? `$${upDownTargetPrice.toLocaleString(undefined, { minimumFractionDigits: priceDec, maximumFractionDigits: priceDec })}`
            : '...',
        priceDec,
        mathCents,
        yesMathCents,
        pastExpiry,
        currentPrice,
        currentSource,
        diff,
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

    let diff: { abs: number; pct: number; isUp: boolean } | null = null;
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
        const signedDelta = currentPrice - K;
        diff = {
          abs: Math.abs(signedDelta),
          pct: (signedDelta / K) * 100,
          isUp: signedDelta >= 0,
        };
      }
    }

    return {
      mode: 'generic',
      targetDisplay,
      priceDec,
      mathCents,
      yesMathCents,
      pastExpiry,
      currentPrice,
      currentSource,
      diff,
      hitModel: selectedMarketIsHit,
    };
  }, [
    selectedMarket,
    marketLookup,
    isUpDownMarket,
    upDownTargetPrice,
    upDownSpotUsesChainlink,
    polyPrice.price,
    upDownTf,
    sidebarPriceSym,
    sidebarThrottledSpot,
    volatilityData,
    volMultiplier,
    bsTimeOffsetHours,
    orderOutcome,
    selectedMarketIsHit,
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
  const prevPriceRef = useRef(0);

  useEffect(() => {
    prevPriceRef.current = 0;
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

  if (!row) return null;

  const mathTooltip =
    row.mode === 'weather'
      ? ''
      : row.mode === 'updown'
      ? 'Mathematical fair value for this Up/Down market (Black-Scholes–style terminal probability).\n\nUses the same spot as “Current” on the right: Polymarket TWAP-30 for 5m windows, TWAP-60 for 15m, Binance spot for 1h/4h/24h. Inputs: target strike, time to expiry, implied volatility (σ).\n\nFor Up (YES): probability price is above the target at expiry. For Down (NO): below.\n\nCompare to the market price to spot mispricings.'
      : row.hitModel
        ? 'Fair-value probability for this Hit market (one-touch / first-passage under GBM): risk-neutral chance price touches the strike by expiry. Same Binance spot as “Current”, σ from settings.\n\nCompare to the order book to spot mispricings.'
        : 'Fair-value probability (terminal Black-Scholes–style) for this market’s strike vs spot.\n\nUses Binance spot, time to expiry, and σ. For YES/NO: YES uses model YES probability; NO uses 100% − YES.\n\nCompare to the market price to spot mispricings.';

  const currentBadge =
    row.mode === 'weather'
      ? {
          label: 'GMT',
          className: 'bg-gray-600 text-gray-200',
          title: 'Expires at GMT midnight after event day',
        }
      : row.mode === 'updown'
      ? {
          label:
            row.currentSource === 'chainlink'
              ? upDownTf === '15m'
                ? 'CL60'
                : upDownTf === '5m'
                  ? 'CL30'
                  : 'CL'
              : 'BINANCE',
          className: row.currentSource === 'chainlink' ? 'bg-blue-600 text-white' : 'bg-yellow-400 text-black',
          title:
            row.currentSource === 'chainlink'
              ? upDownTf === '15m'
                ? 'Polymarket RTDS TWAP-60 (crypto_prices_twap_sixty) via backend'
                : upDownTf === '5m'
                  ? 'Polymarket RTDS TWAP-30 (crypto_prices_twap_thirty) via backend'
                  : 'Polymarket RTDS Chainlink/TWAP (via backend)'
              : upDownSpotUsesChainlink
                ? 'Binance spot (fallback until TWAP feed connects)'
                : 'Binance spot (1h/4h/24h Up/Down)',
        }
      : {
          label: 'BINANCE',
          className: 'bg-yellow-400 text-black',
          title: 'Binance spot',
        };

  const reserveUpDownSpotHeight = row.mode === 'updown' && !row.pastExpiry;

  return (
    <div className={`sidebar-section sidebar-target-section py-1 px-3${reserveUpDownSpotHeight ? ' min-h-[7.5rem]' : ''}`}>
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
              ? `$${row.currentPrice.toLocaleString(undefined, { minimumFractionDigits: row.priceDec, maximumFractionDigits: row.priceDec })}`
              : '...'}
          </span>
        </div>

        <div className="flex items-center justify-start min-h-[15px] min-w-0 text-[10px] font-bold tabular-nums leading-none">
          {row.countdownEndDate || selectedMarket?.endDate ? (
            <div className="flex items-center gap-1 min-w-0 whitespace-nowrap">
              <SidebarMarketCountdownLabel
                endDate={row.countdownEndDate ?? selectedMarket.endDate ?? ''}
                mode={row.mode}
                liveUpDownSameTfMarket={liveUpDownSameTfMarket}
                onSwitchLiveMarket={
                  liveUpDownSameTfMarket && onSwitchLiveMarket
                    ? () => onSwitchLiveMarket(liveUpDownSameTfMarket)
                    : undefined
                }
              />
            </div>
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
          {row.diff && row.currentPrice > 0 ? (
            <span
              className={`inline-flex min-h-[15px] items-center whitespace-nowrap gap-0.5 sidebar-readable-value ${row.diff.isUp ? 'text-green-400' : 'text-red-400'}`}
            >
              <span>
                {row.diff.isUp ? '↑' : '↓'}
                {row.diff.abs.toLocaleString(undefined, {
                  minimumFractionDigits: row.priceDec,
                  maximumFractionDigits: row.priceDec,
                })}
              </span>
              <span>
                ({row.diff.pct >= 0 ? '+' : ''}
                {row.diff.pct.toFixed(2)}%)
              </span>
            </span>
          ) : (
            <span className="inline-flex min-h-[15px] items-center text-transparent select-none" aria-hidden>
              ↑0.00 (0.00%)
            </span>
          )}
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
});
