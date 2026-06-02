import { memo, useMemo } from 'react';
import type { OnchainMarketListItem } from '../api';
import { ASSET_COLORS, assetTickerFromQuestion, shortenUpDownMarketListCell } from '../utils/format';
import { marketListEndDateTimeLocale } from './WalletLatestMarketsTradedTable';

const GRID_TIMEFRAMES = new Set(['5m', '15m', '1h', '4h']);

const TF_DURATION_MS: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
};

export function marketViewUsesGrid(timeframe: string | null | undefined): boolean {
  return Boolean(timeframe && GRID_TIMEFRAMES.has(timeframe));
}

type MarketSquareStatus = 'resolved_yes' | 'resolved_no' | 'current' | 'future' | 'expired_unresolved';

function marketSquareStatus(m: OnchainMarketListItem, timeframe: string, nowMs: number): MarketSquareStatus {
  const endMs = parseMarketEndMs(m);
  if (!endMs) return 'expired_unresolved';

  const duration = TF_DURATION_MS[timeframe] ?? 0;
  const startMs = duration > 0 ? endMs - duration : endMs;
  const outcome = (m.outcome || '').trim().toUpperCase();

  if (endMs > nowMs) {
    if (startMs <= nowMs) return 'current';
    return 'future';
  }

  if (outcome === 'YES' || outcome === 'UP') return 'resolved_yes';
  if (outcome === 'NO' || outcome === 'DOWN') return 'resolved_no';
  return 'expired_unresolved';
}

const STATUS_CLS: Record<MarketSquareStatus, string> = {
  resolved_yes: 'border-green-600/55 bg-green-900/45 text-green-100',
  resolved_no: 'border-red-600/55 bg-red-900/45 text-red-100',
  current: 'border-orange-500/70 bg-orange-900/40 text-orange-100',
  future: 'border-gray-600/80 bg-gray-800/40 text-gray-500',
  expired_unresolved: 'border-yellow-500/70 bg-yellow-900/40 text-yellow-100',
};

function statusTipSuffix(status: MarketSquareStatus): string {
  switch (status) {
    case 'resolved_yes':
      return ' · resolved YES';
    case 'resolved_no':
      return ' · resolved NO';
    case 'current':
      return ' · current';
    case 'future':
      return ' · upcoming';
    case 'expired_unresolved':
      return ' · expired, unresolved';
    default:
      return ' · unresolved';
  }
}

function parseMarketEndMs(m: OnchainMarketListItem): number {
  const raw = (m.endDate || '').trim();
  if (!raw) return 0;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? 0 : t;
}

/** Grid hour row + day bucket; :00 expiry belongs on previous hour row (00:00 → prior day 23:xx). */
function gridSlotFromEndMs(endMs: number): { dayKey: string; hour: number; sortMs: number } {
  const end = new Date(endMs);
  const slotMs = end.getMinutes() === 0 ? endMs - 1 : endMs;
  const slot = new Date(slotMs);
  const dayStart = new Date(slot.getFullYear(), slot.getMonth(), slot.getDate()).getTime();
  return {
    dayKey: dayKeyFromMs(slotMs),
    hour: slot.getHours(),
    sortMs: dayStart,
  };
}

function grid1hSlotFromEndMs(endMs: number): { dayKey: string; slotHour: number; sortMs: number } {
  const end = new Date(endMs);
  if (end.getMinutes() === 0 && end.getHours() === 0) {
    const anchorMs = endMs - 1;
    const anchor = new Date(anchorMs);
    const dayStart = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate()).getTime();
    return { dayKey: dayKeyFromMs(anchorMs), slotHour: 0, sortMs: dayStart };
  }
  const dayStart = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return { dayKey: dayKeyFromMs(endMs), slotHour: end.getHours(), sortMs: dayStart };
}

function daySlotFromEndMs(endMs: number, timeframe: string): { dayKey: string; hour: number; sortMs: number } {
  if (timeframe === '1h') {
    const { dayKey, slotHour, sortMs } = grid1hSlotFromEndMs(endMs);
    return { dayKey, hour: slotHour, sortMs };
  }
  return gridSlotFromEndMs(endMs);
}

function dayKeyFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function formatDayTitle(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatHourRowLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}

function formatMinuteSquareLabel(ms: number): string {
  return `:${String(new Date(ms).getMinutes()).padStart(2, '0')}`;
}

function usesHourRowGrid(timeframe: string): boolean {
  return timeframe === '5m' || timeframe === '15m';
}

function hourRowResolvedCounts(
  markets: OnchainMarketListItem[],
  timeframe: string,
  nowMs: number,
): { yes: number; no: number; total: number } {
  let yes = 0;
  let no = 0;
  for (const m of markets) {
    const st = marketSquareStatus(m, timeframe, nowMs);
    if (st === 'resolved_yes') yes++;
    else if (st === 'resolved_no') no++;
  }
  return { yes, no, total: yes + no };
}

function uses1hTwoRowGrid(timeframe: string): boolean {
  return timeframe === '1h';
}

/** Top row: 1 PM–12 AM (13–00). Bottom row: 1 AM–12 PM (1–12). Midnight → prior day top slot 00. */
const HOUR_1H_BOTTOM = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const HOUR_1H_TOP = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 0] as const;

function format1hSquareLabel(hour: number): string {
  const d = new Date(2000, 0, 1, hour, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric' });
}

function format1hHourTitle(hour: number): string {
  const d = new Date(2000, 0, 1, hour, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatHourSquareLabel(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

type HourRow = {
  hour: number;
  hourLabel: string;
  markets: OnchainMarketListItem[];
};

type OneHourDayGrid = {
  topRow: (OnchainMarketListItem | null)[];
  bottomRow: (OnchainMarketListItem | null)[];
};

type MarketGridDay = {
  dayKey: string;
  dayMs: number;
  title: string;
  hourRows?: HourRow[];
  oneHourGrid?: OneHourDayGrid;
  gridMarkets?: OnchainMarketListItem[];
};

function buildMarketGridDays(markets: OnchainMarketListItem[], timeframe: string): MarketGridDay[] {
  const byDay = new Map<string, { dayMs: number; markets: OnchainMarketListItem[] }>();
  for (const m of markets) {
    const endMs = parseMarketEndMs(m);
    if (!endMs) continue;
    const { dayKey, sortMs } = daySlotFromEndMs(endMs, timeframe);
    const bucket = byDay.get(dayKey);
    if (bucket) bucket.markets.push(m);
    else byDay.set(dayKey, { dayMs: sortMs, markets: [m] });
  }

  const isHourRows = usesHourRowGrid(timeframe);
  const is1hTwoRow = uses1hTwoRowGrid(timeframe);
  const days: MarketGridDay[] = [];

  for (const [dayKey, { dayMs, markets: dayMarkets }] of byDay) {
    if (is1hTwoRow) {
      const byHour = new Map<number, OnchainMarketListItem>();
      for (const m of dayMarkets) {
        const endMs = parseMarketEndMs(m);
        const { slotHour } = grid1hSlotFromEndMs(endMs);
        const prev = byHour.get(slotHour);
        if (!prev || parseMarketEndMs(m) > parseMarketEndMs(prev)) byHour.set(slotHour, m);
      }
      days.push({
        dayKey,
        dayMs,
        title: formatDayTitle(dayMs),
        oneHourGrid: {
          topRow: HOUR_1H_TOP.map((hour) => byHour.get(hour) ?? null),
          bottomRow: HOUR_1H_BOTTOM.map((hour) => byHour.get(hour) ?? null),
        },
      });
    } else if (isHourRows) {
      const byHour = new Map<number, OnchainMarketListItem[]>();
      for (const m of dayMarkets) {
        const endMs = parseMarketEndMs(m);
        const { hour } = gridSlotFromEndMs(endMs);
        const row = byHour.get(hour);
        if (row) row.push(m);
        else byHour.set(hour, [m]);
      }
      const hourRows: HourRow[] = [];
      for (const [hour, rowMarkets] of byHour) {
        rowMarkets.sort((a, b) => parseMarketEndMs(a) - parseMarketEndMs(b));
        hourRows.push({
          hour,
          hourLabel: formatHourRowLabel(hour),
          markets: rowMarkets,
        });
      }
      hourRows.sort((a, b) => b.hour - a.hour);
      days.push({ dayKey, dayMs, title: formatDayTitle(dayMs), hourRows });
    } else {
      const gridMarkets = [...dayMarkets].sort((a, b) => parseMarketEndMs(b) - parseMarketEndMs(a));
      days.push({ dayKey, dayMs, title: formatDayTitle(dayMs), gridMarkets });
    }
  }

  days.sort((a, b) => b.dayMs - a.dayMs);
  return days;
}

const MARKET_SQUARE_CLS =
  'inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded border px-0.5 text-[8px] font-bold tabular-nums leading-none transition-colors';

function MarketSquare({
  market,
  selected,
  label,
  status,
  onSelect,
  className,
}: {
  market: OnchainMarketListItem;
  selected: boolean;
  label: string;
  status: MarketSquareStatus;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const id = (market.conditionId || '').trim();
  const endRaw = (market.endDate || '').trim();
  const title = (market.question || '').trim();
  const tip = title
    ? `${shortenUpDownMarketListCell(title, market.eventSlug || null, endRaw || null)} · ${marketListEndDateTimeLocale(endRaw || null).label}${statusTipSuffix(status)}`
    : `${id}${statusTipSuffix(status)}`;

  return (
    <button
      type="button"
      className={
        className ??
        `${MARKET_SQUARE_CLS} ${STATUS_CLS[status]} hover:brightness-110 ${
          selected ? 'ring-1 ring-yellow-400 border-yellow-500/70 brightness-110' : ''
        }`
      }
      title={tip}
      onClick={() => onSelect(id)}
    >
      {label}
    </button>
  );
}

const EMPTY_SQUARE_CLS =
  'inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded border border-gray-800/80 bg-gray-900/30 opacity-40';

const ONE_HOUR_ROW_CLS = 'grid grid-cols-12 gap-px w-full min-w-0';
const ONE_HOUR_SQUARE_CLS =
  'flex h-6 w-full min-w-0 items-center justify-center rounded-sm border px-0 text-[6px] font-bold leading-none truncate';

function OneHourGridRow({
  hours,
  markets,
  timeframe,
  selectedLc,
  nowMs,
  onSelectMarket,
}: {
  hours: readonly number[];
  markets: (OnchainMarketListItem | null)[];
  timeframe: string;
  selectedLc: string;
  nowMs: number;
  onSelectMarket: (id: string) => void;
}) {
  return (
    <div className={ONE_HOUR_ROW_CLS}>
      {markets.map((m, i) => {
        const hour = hours[i];
        if (!m) {
          return (
            <div
              key={`empty-${hour}`}
              className={`${ONE_HOUR_SQUARE_CLS} border-gray-800/80 bg-gray-900/30 opacity-40 text-gray-500`}
              title={`${format1hHourTitle(hour)} · no market`}
            >
              {format1hSquareLabel(hour)}
            </div>
          );
        }
        const id = (m.conditionId || '').trim();
        const status = marketSquareStatus(m, timeframe, nowMs);
        const isSelected = selectedLc === id.toLowerCase();
        return (
          <MarketSquare
            key={id}
            market={m}
            selected={isSelected}
            label={format1hSquareLabel(hour)}
            status={status}
            onSelect={onSelectMarket}
            className={`${ONE_HOUR_SQUARE_CLS} ${STATUS_CLS[status]} hover:brightness-110 ${
              isSelected ? 'ring-1 ring-yellow-400 border-yellow-500/70 brightness-110' : ''
            }`}
          />
        );
      })}
    </div>
  );
}

const MarketViewMarketsGrid = memo(function MarketViewMarketsGrid({
  markets,
  timeframe,
  selectedMarketId,
  onSelectMarket,
}: {
  markets: OnchainMarketListItem[];
  timeframe: string;
  selectedMarketId: string | null;
  onSelectMarket: (id: string) => void;
}) {
  const days = useMemo(() => buildMarketGridDays(markets, timeframe), [markets, timeframe]);
  const selectedLc = selectedMarketId?.trim().toLowerCase() ?? '';
  const nowMs = Date.now();

  if (days.length === 0) {
    return <div className="flex flex-1 items-center justify-center text-gray-500 text-[10px]">No markets with end dates.</div>;
  }

  const isHourRows = usesHourRowGrid(timeframe);
  const is1hTwoRow = uses1hTwoRowGrid(timeframe);

  return (
    <div className="space-y-3">
      {days.map((day) => (
        <section key={day.dayKey}>
          <div className="text-[10px] font-bold text-gray-300 mb-1.5 sticky top-0 z-[1] bg-gray-900 py-0.5">
            {day.title}
          </div>
          {is1hTwoRow && day.oneHourGrid ? (
            <div className="space-y-1">
              <OneHourGridRow
                hours={HOUR_1H_TOP}
                markets={day.oneHourGrid.topRow}
                timeframe={timeframe}
                selectedLc={selectedLc}
                nowMs={nowMs}
                onSelectMarket={onSelectMarket}
              />
              <OneHourGridRow
                hours={HOUR_1H_BOTTOM}
                markets={day.oneHourGrid.bottomRow}
                timeframe={timeframe}
                selectedLc={selectedLc}
                nowMs={nowMs}
                onSelectMarket={onSelectMarket}
              />
            </div>
          ) : isHourRows ? (
            <div className="space-y-1">
              {day.hourRows?.map((row) => {
                const resolved = hourRowResolvedCounts(row.markets, timeframe, nowMs);
                return (
                <div key={`${day.dayKey}-${row.hour}`} className="flex items-start gap-1.5">
                  <div className="w-11 shrink-0 pt-1 text-[9px] text-gray-500 tabular-nums leading-tight">
                    <div>{row.hourLabel}</div>
                    {resolved.total > 0 ? (
                      <div className="text-[8px] font-semibold" title={`${resolved.yes} YES · ${resolved.no} NO`}>
                        <span className="text-green-400">{resolved.yes}</span>
                        <span className="text-gray-600">\</span>
                        <span className="text-red-400">{resolved.no}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-0.5">
                    {row.markets.map((m) => {
                      const id = (m.conditionId || '').trim();
                      const ms = parseMarketEndMs(m);
                      return (
                        <MarketSquare
                          key={id}
                          market={m}
                          selected={selectedLc === id.toLowerCase()}
                          label={formatMinuteSquareLabel(ms)}
                          status={marketSquareStatus(m, timeframe, nowMs)}
                          onSelect={onSelectMarket}
                        />
                      );
                    })}
                  </div>
                </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-wrap gap-0.5">
              {day.gridMarkets?.map((m) => {
                const id = (m.conditionId || '').trim();
                const ms = parseMarketEndMs(m);
                return (
                  <MarketSquare
                    key={id}
                    market={m}
                    selected={selectedLc === id.toLowerCase()}
                    label={formatHourSquareLabel(ms)}
                    status={marketSquareStatus(m, timeframe, nowMs)}
                    onSelect={onSelectMarket}
                  />
                );
              })}
            </div>
          )}
        </section>
      ))}
    </div>
  );
});

const MarketViewMarketsList = memo(function MarketViewMarketsList({
  markets,
  selectedMarketId,
  onSelectMarket,
}: {
  markets: OnchainMarketListItem[];
  selectedMarketId: string | null;
  onSelectMarket: (id: string) => void;
}) {
  return (
    <table className="w-max max-w-full text-[10px] table-auto [&_th]:px-1.5 [&_td]:px-1.5 [&_th]:py-1 [&_td]:py-0.5">
      <thead>
        <tr className="text-gray-500 sticky top-0 z-10 border-b border-gray-700">
          <th className="text-left whitespace-nowrap bg-gray-900">Date</th>
          <th className="text-left whitespace-nowrap bg-gray-900">Market</th>
        </tr>
      </thead>
      <tbody>
        {markets.map((m) => {
          const id = (m.conditionId || '').trim();
          const selected = selectedMarketId?.trim().toLowerCase() === id.toLowerCase();
          const endRaw = (m.endDate || '').trim();
          const dd = marketListEndDateTimeLocale(endRaw || null);
          const title = (m.question || '').trim();
          const marketName = title
            ? shortenUpDownMarketListCell(title, m.eventSlug || null, endRaw || null)
            : `${m.asset || '-'} ${m.timeframe || ''}`;
          const assetForColor = assetTickerFromQuestion(title) || m.asset || '';
          return (
            <tr
              key={id}
              className={`border-b border-gray-800 cursor-pointer hover:bg-gray-700/30 ${selected ? 'bg-gray-700/40' : ''}`}
              onClick={() => onSelectMarket(id)}
            >
              <td className={`whitespace-nowrap ${dd.color}`}>{dd.label}</td>
              <td
                className={`whitespace-nowrap font-bold ${ASSET_COLORS[assetForColor] || 'text-gray-200'}`}
                title={title || id}
              >
                {marketName}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});

const MARKET_STATUS_LEGEND: { status: MarketSquareStatus; label: string }[] = [
  { status: 'resolved_yes', label: 'YES' },
  { status: 'resolved_no', label: 'NO' },
  { status: 'current', label: 'Live' },
  { status: 'future', label: 'Upcoming' },
  { status: 'expired_unresolved', label: 'Unresolved' },
];

export function MarketViewMarketsLegend() {
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 mb-1 shrink-0" aria-label="Market cell colors">
      {MARKET_STATUS_LEGEND.map(({ status, label }) => (
        <span key={status} className="inline-flex items-center gap-0.5 text-[8px] text-gray-500 leading-none">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-sm border ${STATUS_CLS[status]}`} aria-hidden />
          {label}
        </span>
      ))}
    </div>
  );
}

export const MarketViewMarketsPanel = memo(function MarketViewMarketsPanel({
  markets,
  timeframe,
  selectedMarketId,
  onSelectMarket,
  hasMoreMarkets,
  loadingMoreMarkets,
  onLoadMoreMarkets,
}: {
  markets: OnchainMarketListItem[];
  timeframe: string;
  selectedMarketId: string | null;
  onSelectMarket: (id: string) => void;
  hasMoreMarkets: boolean;
  loadingMoreMarkets: boolean;
  onLoadMoreMarkets: () => void;
}) {
  const useGrid = marketViewUsesGrid(timeframe);

  return (
    <div className="flex-1 min-h-0 overflow-auto toxic-flow-scroll-stable">
      {useGrid ? (
        <MarketViewMarketsGrid
          markets={markets}
          timeframe={timeframe}
          selectedMarketId={selectedMarketId}
          onSelectMarket={onSelectMarket}
        />
      ) : (
        <MarketViewMarketsList
          markets={markets}
          selectedMarketId={selectedMarketId}
          onSelectMarket={onSelectMarket}
        />
      )}
      {hasMoreMarkets ? (
        <button
          type="button"
          className="mt-2 w-full rounded border border-gray-700 py-1 text-[10px] text-gray-400 hover:bg-gray-800 hover:text-white disabled:opacity-50"
          disabled={loadingMoreMarkets}
          onClick={onLoadMoreMarkets}
        >
          {loadingMoreMarkets ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
    </div>
  );
});
