import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw } from 'lucide-react';
import {
  fetchWeatherMetarHistory,
  storedTempToDisplay,
  type WeatherMetarHistoryRow,
  type WeatherTafFcst,
  type WeatherTafHistoryRow,
  type WeatherTempUnit,
} from '../lib/weatherObservations';

interface WeatherMetarHistoryDialogProps {
  open: boolean;
  onClose: () => void;
  icao: string;
  cityLabel: string;
  timeZone: string;
  displayTempUnit: WeatherTempUnit;
}

function formatObsTime(ms: number, timeZone: string): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}

function formatWind(wdirDeg?: number, wspdKt?: number, wgstKt?: number): string {
  if (wdirDeg == null && wspdKt == null) return '—';
  const dir = wdirDeg != null ? `${Math.round(wdirDeg).toString().padStart(3, '0')}°` : 'VRB';
  let spd = '';
  if (wspdKt != null) {
    spd = `${Math.round(wspdKt)} kt`;
    if (wgstKt != null) spd += ` G${Math.round(wgstKt)}`;
  }
  return [dir, spd].filter(Boolean).join(' ');
}

function formatMetarClouds(clouds: WeatherMetarHistoryRow['clouds']): string {
  if (!clouds?.length) return '';
  return clouds
    .map((c) => {
      const cover = c.cover?.trim() || '?';
      if (c.baseFt > 0) return `${cover} ${Math.round(c.baseFt)} ft`;
      return cover;
    })
    .join(', ');
}

function formatTafClouds(clouds: WeatherTafFcst['clouds']): string {
  if (!clouds?.length) return '';
  return clouds
    .map((c) => {
      const cover = c.cover?.trim() || '?';
      if (c.baseFt != null && c.baseFt > 0) return `${cover} ${Math.round(c.baseFt)} ft`;
      return cover;
    })
    .join(', ');
}

function metarTempLabel(row: WeatherMetarHistoryRow, displayUnit: WeatherTempUnit): string {
  const stored = row.temp;
  const unit = row.obsTempUnit ?? 'C';
  if (stored != null && Number.isFinite(stored)) {
    return `${storedTempToDisplay(stored, unit, displayUnit).toFixed(1)}°${displayUnit}`;
  }
  if (row.tempC != null && Number.isFinite(row.tempC)) {
    return `${storedTempToDisplay(row.tempC, 'C', displayUnit).toFixed(1)}°${displayUnit}`;
  }
  return '—';
}

function MetarHistoryCard({
  row,
  timeZone,
  displayTempUnit,
}: {
  row: WeatherMetarHistoryRow;
  timeZone: string;
  displayTempUnit: WeatherTempUnit;
}) {
  const clouds = formatMetarClouds(row.clouds);
  return (
    <div className="rounded border border-cyan-800/50 bg-gray-900/70 px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-cyan-400">METAR</span>
        <span className="text-[10px] text-gray-400 tabular-nums">
          {formatObsTime(asMs(row.obsTimeMs), timeZone)}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[11px] tabular-nums text-gray-200 mb-1.5">
        <div>
          <span className="text-gray-500">Temp </span>
          {metarTempLabel(row, displayTempUnit)}
        </div>
        <div>
          <span className="text-gray-500">Wind </span>
          {formatWind(row.wdirDeg, row.wspdKt)}
        </div>
        <div>
          <span className="text-gray-500">Vis </span>
          {row.visibSm ? `${row.visibSm} sm` : '—'}
        </div>
        <div>
          <span className="text-gray-500">Sky </span>
          {row.skyCover || clouds || '—'}
        </div>
      </div>
      {row.rawOb ? (
        <pre className="text-[10px] font-mono text-amber-200/85 whitespace-pre-wrap break-all leading-snug">
          {row.rawOb}
        </pre>
      ) : null}
    </div>
  );
}

function TafFcstLine({ fcst, timeZone }: { fcst: WeatherTafFcst; timeZone: string }) {
  const change = fcst.fcstChange?.trim();
  const clouds = formatTafClouds(fcst.clouds);
  return (
    <div className="border-t border-gray-700/60 pt-1 mt-1 first:border-0 first:pt-0 first:mt-0">
      <div className="text-[10px] text-gray-400 tabular-nums">
        {change ? <span className="text-violet-300 font-bold mr-1">{change}</span> : null}
        {formatObsTime(fcst.timeFromMs, timeZone)}
        <span className="text-gray-600"> → </span>
        {formatObsTime(fcst.timeToMs, timeZone)}
      </div>
      <div className="text-[11px] text-gray-200 tabular-nums">
        {formatWind(fcst.wdirDeg, fcst.wspdKt, fcst.wgstKt)}
        {fcst.visibSm ? ` · ${fcst.visibSm} sm` : ''}
        {fcst.wxString ? ` · ${fcst.wxString}` : ''}
        {clouds ? ` · ${clouds}` : ''}
      </div>
    </div>
  );
}

function TafHistoryCard({
  row,
  timeZone,
}: {
  row: WeatherTafHistoryRow;
  timeZone: string;
}) {
  return (
    <div className="rounded border border-violet-800/50 bg-gray-900/70 px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[10px] font-bold uppercase tracking-wide text-violet-300">TAF</span>
        <span className="text-[10px] text-gray-400 tabular-nums">
          issued {formatObsTime(asMs(row.issueTimeMs), timeZone)}
        </span>
      </div>
      {row.validFromMs || row.validToMs ? (
        <div className="text-[10px] text-gray-500 mb-1 tabular-nums">
          Valid {formatObsTime(asMs(row.validFromMs), timeZone)}
          <span className="text-gray-600"> → </span>
          {formatObsTime(asMs(row.validToMs), timeZone)}
        </div>
      ) : null}
      {row.rawTaf ? (
        <pre className="text-[10px] font-mono text-violet-200/85 whitespace-pre-wrap break-all leading-snug mb-1.5">
          {row.rawTaf}
        </pre>
      ) : null}
      {row.fcsts?.length ? (
        <div className="space-y-0.5">
          {row.fcsts.map((f, i) => (
            <TafFcstLine key={`${f.timeFromMs}-${i}`} fcst={f} timeZone={timeZone} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function asMs(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  // Accept seconds accidentally returned as whole numbers.
  return n < 1_000_000_000_000 ? n * 1000 : n;
}

export function WeatherMetarHistoryDialog({
  open,
  onClose,
  icao,
  cityLabel,
  timeZone,
  displayTempUnit,
}: WeatherMetarHistoryDialogProps) {
  const [metarRows, setMetarRows] = useState<WeatherMetarHistoryRow[]>([]);
  const [tafRows, setTafRows] = useState<WeatherTafHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWeatherMetarHistory(icao, { limit: 500 });
      setMetarRows(data.metar ?? data.rows ?? []);
      setTafRows(data.taf ?? []);
    } catch (e) {
      setMetarRows([]);
      setTafRows([]);
      setError(e instanceof Error ? e.message : 'History fetch failed');
    } finally {
      setLoading(false);
    }
  }, [icao]);

  useEffect(() => {
    if (!open) return;
    setMetarRows([]);
    setTafRows([]);
    setError('');
    void load();
  }, [open, load]);

  // Separate sections, each oldest → newest (avoids TAF/METAR time-gap looking “newest first”).
  const metarOldestFirst = useMemo(() => {
    return [...metarRows]
      .filter((r) => asMs(r.obsTimeMs) > 0)
      .sort((a, b) => asMs(a.obsTimeMs) - asMs(b.obsTimeMs));
  }, [metarRows]);

  const tafOldestFirst = useMemo(() => {
    return [...tafRows]
      .filter((r) => asMs(r.issueTimeMs) > 0)
      .sort((a, b) => asMs(a.issueTimeMs) - asMs(b.issueTimeMs));
  }, [tafRows]);

  useEffect(() => {
    if (!open || loading) return;
    const el = listRef.current;
    if (el) el.scrollTop = 0;
  }, [open, loading, metarOldestFirst, tafOldestFirst]);

  if (!open) return null;

  const empty = metarOldestFirst.length === 0 && tafOldestFirst.length === 0;

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 z-[60000] flex items-center justify-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg p-4 max-w-2xl w-full mx-4 shadow-xl border border-gray-600 max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between gap-2 mb-3 shrink-0">
          <div className="min-w-0">
            <div className="text-sm font-bold text-white">
              METAR / TAF history — {icao}
            </div>
            <div className="text-[10px] text-gray-500">
              {cityLabel} · oldest at top · {metarOldestFirst.length} METAR · {tafOldestFirst.length}{' '}
              TAF
            </div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="shrink-0 p-1 rounded text-gray-400 hover:text-amber-300 disabled:opacity-40"
            title="Refresh history"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error ? <div className="text-[11px] text-red-400 mb-3 shrink-0">{error}</div> : null}

        <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-0.5">
          {empty && !loading ? (
            <div className="text-[11px] text-gray-500 py-6 text-center">
              No stored METAR/TAF for {icao} yet. Data fills as the weather poller runs.
            </div>
          ) : null}
          {loading && empty ? (
            <div className="text-[11px] text-gray-400 py-6 text-center">Loading history…</div>
          ) : null}

          {metarOldestFirst.length > 0 ? (
            <section>
              <div className="sticky top-0 z-10 mb-1.5 bg-gray-800/95 py-1 text-[10px] font-bold uppercase tracking-wide text-cyan-400/90">
                METAR
              </div>
              <div className="space-y-2">
                {metarOldestFirst.map((row) => (
                  <MetarHistoryCard
                    key={`m-${row.obsTimeMs}-${row.rawOb ?? ''}`}
                    row={row}
                    timeZone={timeZone}
                    displayTempUnit={displayTempUnit}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {tafOldestFirst.length > 0 ? (
            <section>
              <div className="sticky top-0 z-10 mb-1.5 bg-gray-800/95 py-1 text-[10px] font-bold uppercase tracking-wide text-violet-300/90">
                TAF
              </div>
              <div className="space-y-2">
                {tafOldestFirst.map((row) => (
                  <TafHistoryCard
                    key={`t-${row.issueTimeMs}-${row.rawTaf ?? ''}`}
                    row={row}
                    timeZone={timeZone}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 mt-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded bg-gray-700 text-gray-200 hover:bg-gray-600"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
