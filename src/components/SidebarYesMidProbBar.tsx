import { memo, useSyncExternalStore } from 'react';
import { getBidAskMarketRow, subscribeBidAskMarketLookup } from '../lib/bidAskMarketLookup';
import type { Market } from '../types';
import { HelpTooltip } from './HelpTooltip';
import { SidebarBarMidMarker } from './SidebarBarMidMarker';

function yesMidCentsFromWsRow(row: Market | undefined): number | null {
  const bb = row?.bestBid;
  const ba = row?.bestAsk;
  const tb = bb != null && Number.isFinite(bb) ? bb * 100 : NaN;
  const ta = ba != null && Number.isFinite(ba) ? ba * 100 : NaN;
  let yesMidCents: number | null = null;
  if (Number.isFinite(tb) && Number.isFinite(ta)) yesMidCents = (tb + ta) / 2;
  else if (Number.isFinite(tb)) yesMidCents = tb;
  else if (Number.isFinite(ta)) yesMidCents = ta;
  if (yesMidCents == null) return null;
  return Math.min(100, Math.max(0, yesMidCents));
}

export const SidebarYesMidProbBar = memo(function SidebarYesMidProbBar({
  yesTokenId,
  yesMathCents,
  shellOnly = false,
}: {
  yesTokenId: string;
  yesMathCents: number | null;
  /** Reserve layout height before model YES / target is ready. */
  shellOnly?: boolean;
}) {
  const tid = yesTokenId.trim();
  const wsRow = useSyncExternalStore(
    subscribeBidAskMarketLookup,
    () => getBidAskMarketRow(tid),
    () => getBidAskMarketRow(tid),
  );
  const yMidOk = shellOnly ? null : yesMidCentsFromWsRow(wsRow);
  const m = yesMathCents;
  const delta = yMidOk != null && m != null ? yMidOk - m : null;
  const greenLeftPct =
    delta == null ? 50 : Math.min(97, Math.max(3, 50 + (delta / 22) * 46));
  const tip =
    shellOnly || m == null
      ? 'Waiting for target price and model YES probability'
      : yMidOk == null
        ? `Model YES ${m.toFixed(1)}¢ — no WS best bid/ask for YES yet`
        : `YES mid ${yMidOk.toFixed(1)}¢ (bid/ask WS) vs model ${m.toFixed(1)}¢ (Δ ${delta! >= 0 ? '+' : ''}${delta!.toFixed(1)}¢)`;

  return (
    <div className="mt-2 pt-1.5 border-t border-gray-800/70 min-h-[2.375rem]" title={tip}>
      <div className="flex items-center justify-between gap-1 mb-0.5">
        <span className="flex items-center gap-0.5 text-[10px] text-gray-500">
          Prob
          <HelpTooltip
            text={
              'YES midpoint: average of live best bid and best ask from `/ws/chart` (YES token asset id).\n\n' +
              'Not the sidebar CLOB ladder. Updates on each WS tick (not the 2s grid marketLookup throttle).\n\n' +
              'Compared to Math (model YES). Green left grows when WS mid is above math.'
            }
          />
        </span>
        <span className="text-[10px] text-gray-400 tabular-nums">
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
            <span className="text-gray-600">–</span>
          )}
          <span className="text-gray-600 mx-0.5">/</span>
          <span className="text-gray-400 sidebar-readable-value">{m != null ? `${m.toFixed(1)} math` : '– math'}</span>
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
