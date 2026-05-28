import { memo } from 'react';
import { useSidebarChartAnnualVolPct, sidebarVolBelowMaxCap } from '../lib/sidebarChartVolStore';
import { HelpTooltip } from './HelpTooltip';

export const SidebarSpotVolSigmaLabel = memo(function SidebarSpotVolSigmaLabel({
  notifyMaxVolatilityPct,
  notifyVolatilityCandles,
  sidebarChartKlineLabel,
  pastExpiry,
}: {
  notifyMaxVolatilityPct: number;
  notifyVolatilityCandles: number;
  sidebarChartKlineLabel: string;
  pastExpiry: boolean;
}) {
  const sidebarChartAnnualVolPct = useSidebarChartAnnualVolPct();

  if (pastExpiry) {
    return (
      <span className="text-transparent select-none" aria-hidden>
        —
      </span>
    );
  }

  const vol = sidebarChartAnnualVolPct;
  const maxVol = notifyMaxVolatilityPct;
  const volBelowMax = sidebarVolBelowMaxCap(vol, maxVol);
  const volClass =
    vol == null
      ? 'text-gray-600'
      : maxVol <= 0
        ? 'text-amber-200/95 sidebar-readable-value'
        : vol > maxVol
          ? 'text-red-400 sidebar-readable-value'
          : vol >= maxVol * 0.75
            ? 'text-yellow-400 sidebar-readable-value'
            : 'text-green-400 sidebar-readable-value';

  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className={`${volClass}${volBelowMax ? ' sidebar-vol-below-max-flash' : ''}`}>
        {vol != null ? `σ ${vol.toFixed(1)}%` : 'σ —'}
      </span>
      <HelpTooltip
        text={`Annualized volatility from spot klines (Binance or Chainlink, same source as the hidden asset chart). Uses the last ${notifyVolatilityCandles} completed ${sidebarChartKlineLabel} candles; the open candle is excluded. For 5m markets these are 5m candles, for 15m markets 15m candles, etc. Candle count and max volatility for tilt alerts are set in Tilt notifications.`}
        openOnHover
        wrapClassName="inline-flex shrink-0 items-center leading-none"
      >
        <span className="flex size-[10px] shrink-0 cursor-help items-center justify-center rounded-full border border-gray-500 text-[7px] font-bold leading-none text-gray-400 hover:border-gray-300 hover:text-gray-200">
          ?
        </span>
      </HelpTooltip>
    </span>
  );
});
