import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

const CLOCK_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
const TICK_MS = 250;

const FALLBACK_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
] as const;

function loadTimeZones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: 'timeZone') => string[];
  };
  if (typeof intl.supportedValuesOf === 'function') {
    return [...intl.supportedValuesOf('timeZone')].sort((a, b) => a.localeCompare(b));
  }
  return [...FALLBACK_TIMEZONES];
}

const TIMEZONES: string[] = loadTimeZones();

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function readStoredTimezone(panelId: string): string {
  const saved = localStorage.getItem(`polybot-clock-tz-${panelId}`);
  if (saved && TIMEZONES.includes(saved)) return saved;
  if (TIMEZONES.includes(DEFAULT_TIMEZONE)) return DEFAULT_TIMEZONE;
  return TIMEZONES[0] || 'UTC';
}

function formatClockTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function measureFitFontSize(text: string, maxW: number, maxH: number): number {
  if (maxW <= 0 || maxH <= 0 || !text) return 12;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return 12;

  let lo = 8;
  let hi = Math.max(8, Math.floor(maxH));
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    ctx.font = `700 ${mid}px ${CLOCK_FONT}`;
    const w = ctx.measureText(text).width;
    if (w <= maxW && mid <= maxH) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function ClockPanelInner({ panelId }: { panelId: string }) {
  const [timeZone, setTimeZone] = useState(() => readStoredTimezone(panelId));
  const [now, setNow] = useState(() => new Date());
  const [fontPx, setFontPx] = useState(48);
  const bodyRef = useRef<HTMLDivElement>(null);

  const timeText = useMemo(() => formatClockTime(now, timeZone), [now, timeZone]);

  useEffect(() => {
    const sync = () => setNow(new Date());
    sync();
    const id = window.setInterval(sync, TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;

    const measure = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      setFontPx(measureFitFontSize(timeText, w, h));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [timeText]);

  return (
    <div className="panel-wrapper flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-gray-800/50 p-3">
      <div className="panel-header mb-1 flex shrink-0 cursor-grab items-center justify-between gap-2">
        <div className="text-[11px] font-bold text-violet-300">Clock</div>
        <div className="no-drag min-w-0" onMouseDown={(e) => e.stopPropagation()}>
          <select
            className="max-w-[min(100%,16rem)] truncate rounded border border-gray-700 bg-gray-950 px-1.5 py-0.5 text-[10px] font-semibold text-gray-200 focus:outline-none"
            value={timeZone}
            title="Timezone"
            onChange={(e) => {
              const next = e.target.value;
              setTimeZone(next);
              localStorage.setItem(`polybot-clock-tz-${panelId}`, next);
            }}
          >
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        ref={bodyRef}
        className="panel-body flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        <div
          className="select-none whitespace-nowrap font-mono font-bold tabular-nums leading-none text-white"
          style={{ fontSize: `${fontPx}px` }}
        >
          {timeText}
        </div>
      </div>
    </div>
  );
}

export const ClockPanel = memo(ClockPanelInner);
