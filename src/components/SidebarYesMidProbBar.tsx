import { memo, useMemo, useSyncExternalStore, type MutableRefObject } from 'react';
import { yesMidCentsFromSidebarBook } from '../lib/sidebarYesMidFromBook';
import {
  getSidebarTopOfBookDigest,
  subscribeSidebarTopOfBookDigest,
} from '../lib/sidebarTopOfBookStore';
import {
  sidebarVolBelowMaxCap,
  useSidebarChartAnnualVolPct,
  readNotifyMaxVolatilityPct,
} from '../lib/sidebarChartVolStore';
import { CHART_PRED_MATH_PROB_COLOR } from '../lib/chartCandleEnrichment';
import type { SidebarPolymarketBookSnapshot } from './SidebarPolymarketOBHost';
import { HelpTooltip } from './HelpTooltip';
import { SidebarBarMidMarker } from './SidebarBarMidMarker';

export const SidebarYesMidProbBar = memo(function SidebarYesMidProbBar({
  yesMathCents,
  sidebarBookRef,
  shellOnly = false,
}: {
  yesMathCents: number | null;
  sidebarBookRef: MutableRefObject<SidebarPolymarketBookSnapshot | null>;
  /** Reserve layout height before model YES / target is ready. */
  shellOnly?: boolean;
}) {
  const topOfBookDigest = useSyncExternalStore(
    subscribeSidebarTopOfBookDigest,
    getSidebarTopOfBookDigest,
    getSidebarTopOfBookDigest,
  );
  const chartVolPct = useSidebarChartAnnualVolPct();
  const maxVolPct = readNotifyMaxVolatilityPct();

  const yMidOk = useMemo(() => {
    if (shellOnly) return null;
    void topOfBookDigest;
    return yesMidCentsFromSidebarBook(sidebarBookRef.current);
  }, [shellOnly, topOfBookDigest, sidebarBookRef]);

  const m = yesMathCents;
  const delta = yMidOk != null && m != null ? yMidOk - m : null;
  const greenLeftPct =
    delta == null ? 50 : Math.min(97, Math.max(3, 50 + (delta / 22) * 46));
  const volBelowMax = sidebarVolBelowMaxCap(chartVolPct, maxVolPct);
  const volClass =
    chartVolPct == null
      ? 'text-gray-600'
      : maxVolPct <= 0
        ? 'text-amber-200/95'
        : chartVolPct > maxVolPct
          ? 'text-red-400'
          : chartVolPct >= maxVolPct * 0.75
            ? 'text-yellow-400'
            : 'text-green-400';
  const tip =
    shellOnly || m == null
      ? 'Waiting for target price and model YES probability'
      : yMidOk == null
        ? 'Model YES — no orderbook bid/ask yet'
        : `YES mid ${yMidOk.toFixed(1)}¢ (live OB) vs model ${m.toFixed(1)}¢ (Δ ${delta! >= 0 ? '+' : ''}${delta!.toFixed(1)}¢)` +
          (chartVolPct != null ? ` · σ ${chartVolPct.toFixed(1)}%` : '');

  return (
    <div className="mt-2 pt-1.5 border-t border-gray-800/70 min-h-[2.375rem]" title={tip}>
      <div className="flex items-center justify-between gap-1 mb-0.5 min-w-0">
        <span className="flex items-center gap-0.5 text-[10px] text-gray-500 shrink-0">
          Prob
          <HelpTooltip
            text={
              'Market YES midpoint from live sidebar orderbooks (same on YES/NO toggle).\n\n' +
              'YES = 100¢ − NO book mid when NO leg quoted; else YES book mid.\n\n' +
              'Compared to Math (model YES). Green left grows when market YES is above math.\n\n' +
              'σ = annualized chart volatility (same as tilt max-vol gate).'
            }
          />
        </span>
        <span className="text-[10px] text-gray-400 tabular-nums truncate text-right min-w-0">
          <span className="text-gray-500">YES mid</span>{' '}
          {yMidOk != null ? (
            <span
              className={`font-semibold sidebar-readable-value ${
                delta != null ? (delta > 0.4 ? 'text-emerald-400' : delta < -0.4 ? 'text-red-400' : 'text-gray-200') : 'text-white'
              }`}
            >
              {yMidOk.toFixed(1)}
            </span>
          ) : (
            <span className="text-gray-600 sidebar-readable-value">–</span>
          )}
          <span className="text-gray-600 mx-0.5">/</span>
          <span
            className="sidebar-readable-value font-semibold"
            style={{ color: m != null ? CHART_PRED_MATH_PROB_COLOR : undefined }}
            title="Model YES ¢ from predicted TWAP (same as bottom Math / pink chart line)"
          >
            {m != null ? (
              `${m.toFixed(1)} math`
            ) : (
              <span className="text-gray-400">– math</span>
            )}
          </span>
          <span className="text-gray-600 mx-0.5">/</span>
          <span
            className={`sidebar-readable-value ${volClass}${volBelowMax ? ' sidebar-vol-below-max-flash' : ''}`}
            title={
              chartVolPct != null
                ? `Annualized σ ${chartVolPct.toFixed(1)}%` +
                  (maxVolPct > 0 ? ` (max ${maxVolPct}%)` : '')
                : 'Annualized chart volatility'
            }
          >
            {chartVolPct != null ? `σ ${chartVolPct.toFixed(1)}%` : 'σ –'}
          </span>
        </span>
      </div>
      <div className="relative h-[7px] w-full rounded-full overflow-hidden bg-gray-900 ring-1 ring-gray-700/80">
        <div className="absolute inset-y-0 left-0 rounded-l-[999px] bg-emerald-600/90" style={{ width: `${greenLeftPct}%` }} />
        <div
          className="absolute inset-y-0 rounded-r-[999px] bg-red-800/95"
          style={{ left: `${greenLeftPct}%`, width: `${100 - greenLeftPct}%` }}
        />
        <SidebarBarMidMarker />
      </div>
    </div>
  );
});
