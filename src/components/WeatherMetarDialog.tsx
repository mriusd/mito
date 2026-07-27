import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import type { WeatherCitySlug } from '../types';
import {
  fetchWeatherMetarDetail,
  storedTempToDisplay,
  type WeatherMetarDetail,
  type WeatherTempUnit,
} from '../lib/weatherObservations';
import { formatElapsedSinceMs, tradeElapsedColorClass } from '../utils/format';

interface WeatherMetarDialogProps {
  open: boolean;
  onClose: () => void;
  city: WeatherCitySlug;
  cityLabel: string;
  icao: string;
  timeZone: string;
  displayTempUnit: WeatherTempUnit;
}

function formatWind(wdirDeg: number | undefined, wspdKt: number | undefined): string {
  if (wdirDeg == null && wspdKt == null) return '—';
  const dir =
    wdirDeg != null
      ? `${Math.round(wdirDeg).toString().padStart(3, '0')}°`
      : 'VRB';
  const spd = wspdKt != null ? `${Math.round(wspdKt)} kt` : '';
  return [dir, spd].filter(Boolean).join(' ');
}

function formatClouds(clouds: WeatherMetarDetail['clouds']): string {
  if (!clouds?.length) return '—';
  return clouds
    .map((c) => {
      const cover = c.cover?.trim() || '?';
      if (c.baseFt > 0) return `${cover} ${Math.round(c.baseFt)} ft`;
      return cover;
    })
    .join(', ');
}

function formatObsTime(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).format(new Date(ms));
}

function MetarField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-xs text-gray-100 tabular-nums break-words">{value}</div>
    </div>
  );
}

export function WeatherMetarDialog({
  open,
  onClose,
  city,
  cityLabel,
  icao,
  timeZone,
  displayTempUnit,
}: WeatherMetarDialogProps) {
  const [detail, setDetail] = useState<WeatherMetarDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fetchedAtMs, setFetchedAtMs] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchWeatherMetarDetail(city);
      setDetail(data);
      setFetchedAtMs(Date.now());
    } catch (e) {
      setDetail(null);
      setError(e instanceof Error ? e.message : 'METAR fetch failed');
    } finally {
      setLoading(false);
    }
  }, [city]);

  useEffect(() => {
    if (!open) return;
    setDetail(null);
    setError('');
    setFetchedAtMs(0);
    void load();
  }, [open, load]);

  if (!open) return null;

  const obsUnit = detail?.obsTempUnit ?? 'C';
  const tempDisplay =
    detail != null
      ? `${storedTempToDisplay(detail.temp, obsUnit, displayTempUnit).toFixed(1)}°${displayTempUnit}`
      : '—';
  const dewpDisplay =
    detail?.dewp != null
      ? `${storedTempToDisplay(detail.dewp, obsUnit, displayTempUnit).toFixed(1)}°${displayTempUnit}`
      : '—';
  const ageMs = detail?.obsTimeMs ?? 0;
  const ageLabel = ageMs > 0 ? formatElapsedSinceMs(ageMs) : '';
  const ageClass = ageMs > 0 ? tradeElapsedColorClass(ageMs) : 'text-gray-500';

  return (
    <div
      className="fixed inset-0 bg-black/70 z-[60000] flex items-center justify-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !loading) onClose();
      }}
    >
      <div className="bg-gray-800 rounded-lg p-4 max-w-md w-full mx-4 shadow-xl border border-gray-600 max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between gap-2 mb-3 shrink-0">
          <div className="min-w-0">
            <div className="text-sm font-bold text-white">
              METAR {icao}
              {detail?.name ? (
                <span className="font-normal text-gray-400"> — {detail.name}</span>
              ) : null}
            </div>
            <div className="text-[10px] text-gray-500">{cityLabel}</div>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="shrink-0 p-1 rounded text-gray-400 hover:text-amber-300 disabled:opacity-40"
            title="Refresh METAR"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {error ? <div className="text-[11px] text-red-400 mb-3 shrink-0">{error}</div> : null}

        {detail ? (
          <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-3 shrink-0">
              <MetarField label="Temp" value={tempDisplay} />
              <MetarField label="Dew point" value={dewpDisplay} />
              <MetarField label="Wind" value={formatWind(detail.wdirDeg, detail.wspdKt)} />
              <MetarField
                label="Visibility"
                value={detail.visibSm != null ? `${detail.visibSm} sm` : '—'}
              />
              <MetarField
                label="Altimeter"
                value={detail.altimMb != null ? `${detail.altimMb.toFixed(2)} mb` : '—'}
              />
              <MetarField label="Sky" value={detail.skyCover || '—'} />
              <MetarField label="Clouds" value={formatClouds(detail.clouds)} />
              <MetarField label="Flight cat" value={detail.fltCat || '—'} />
            </div>
            <div className="text-[10px] text-gray-500 mb-2 shrink-0">
              Obs{' '}
              <span className="text-gray-300">{formatObsTime(detail.obsTimeMs, timeZone)}</span>
              {ageLabel ? (
                <>
                  {' '}
                  · <span className={ageClass}>{ageLabel}</span>
                </>
              ) : null}
              {fetchedAtMs > 0 ? (
                <span className="text-gray-600"> · fetched {formatElapsedSinceMs(fetchedAtMs)} ago</span>
              ) : null}
            </div>
            {detail.rawOb ? (
              <pre className="text-[11px] font-mono text-amber-200/90 bg-gray-900/80 border border-gray-700 rounded px-2 py-1.5 overflow-x-auto whitespace-pre-wrap break-all shrink min-h-0">
                {detail.rawOb}
              </pre>
            ) : null}
          </>
        ) : loading ? (
          <div className="text-[11px] text-gray-400 py-4">Loading METAR…</div>
        ) : null}

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
    </div>
  );
}
