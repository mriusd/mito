import { useMemo } from 'react';
import {
  candleWeatherToObservations,
  type CandleWeatherBucket,
  type CandleWeatherSnapshot,
} from '../lib/candleWeatherSnapshot';
import { getTempSortValue, lookupModelBucketProb } from '../lib/weatherMarketsGrid';
import { TemperatureChart } from './TemperatureChart';
import type { WeatherTempUnit } from '../lib/weatherObservations';

function fracToPx(frac: number, maxPct: number, trackPx: number): number {
  if (maxPct <= 0 || trackPx <= 0 || frac <= 0) return 0;
  return Math.min(trackPx, (frac / maxPct) * trackPx);
}

function WeatherBucketBars({
  buckets,
  metric,
}: {
  buckets: CandleWeatherBucket[];
  metric: string;
}) {
  const sorted = useMemo(
    () => [...buckets].sort((a, b) => getTempSortValue(a.temp) - getTempSortValue(b.temp)),
    [buckets],
  );
  const maxPct = useMemo(() => {
    let m = 0.05;
    for (const b of sorted) {
      const model = b.modelProb ?? 0;
      const mid = b.mid ?? b.bid ?? b.ask ?? 0;
      m = Math.max(m, model, mid);
    }
    return m;
  }, [sorted]);
  const trackPx = 72;

  if (sorted.length === 0) {
    return <div className="text-[10px] text-gray-500 py-2 text-center">No market buckets</div>;
  }

  return (
    <div className="flex flex-col gap-1 min-h-0">
      <div className="flex gap-0.5 min-h-[12px]">
        {sorted.map((b) => {
          const model = b.modelProb;
          const mid = b.mid ?? b.bid ?? b.ask;
          return (
            <div
              key={b.temp}
              className="flex-1 min-w-0 flex gap-0.5 text-[8px] text-gray-400 tabular-nums leading-none"
            >
              <span className="flex-1 text-center opacity-60">
                {model != null ? `${(model * 100).toFixed(1)}%` : '—'}
              </span>
              <span className="flex-1 text-center">
                {mid != null ? `${(mid * 100).toFixed(1)}%` : '—'}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-end gap-0.5" style={{ height: trackPx }}>
        {sorted.map((b) => {
          const modelPx = fracToPx(b.modelProb ?? 0, maxPct, trackPx);
          const bidPx = fracToPx(b.bid ?? 0, maxPct, trackPx);
          const askPx = fracToPx(b.ask ?? 0, maxPct, trackPx);
          const midPx = b.mid != null ? fracToPx(b.mid, maxPct, trackPx) : null;
          const topPx = Math.max(bidPx, askPx, midPx ?? 0);
          return (
            <div
              key={`bar-${b.temp}`}
              className={`relative flex-1 min-w-0 h-full flex gap-0.5 items-end ${
                b.selected ? 'ring-1 ring-white/70 rounded' : ''
              }`}
              title={`${b.temp} · model ${b.modelProb != null ? `${(b.modelProb * 100).toFixed(1)}%` : '—'} · mid ${
                b.mid != null ? `${(b.mid * 100).toFixed(1)}%` : '—'
              }`}
            >
              <div className="relative flex-1 min-w-0 h-full">
                {modelPx > 0 ? (
                  <div
                    className={`absolute bottom-0 left-0 right-0 rounded-t-sm ${
                      metric === 'low' ? 'bg-sky-500/50' : 'bg-orange-500/50'
                    }`}
                    style={{ height: modelPx }}
                  />
                ) : null}
              </div>
              <div className="relative flex-1 min-w-0 h-full">
                {topPx > 0 ? (
                  <>
                    {bidPx > 0 ? (
                      <div
                        className={`absolute bottom-0 left-0 right-0 ${
                          metric === 'low' ? 'bg-sky-400' : 'bg-orange-400'
                        }`}
                        style={{ height: Math.min(bidPx, askPx || bidPx) }}
                      />
                    ) : null}
                    {askPx > bidPx ? (
                      <div
                        className={`absolute left-0 right-0 ${
                          metric === 'low' ? 'bg-sky-700/70' : 'bg-orange-700/70'
                        }`}
                        style={{ bottom: bidPx, height: askPx - bidPx }}
                      />
                    ) : null}
                    {midPx != null && midPx > 0 ? (
                      <div
                        className="absolute left-0 right-0 z-[5] h-[2px] bg-gray-900"
                        style={{ bottom: Math.max(0, midPx - 1) }}
                      />
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-0.5 min-h-[10px]">
        {sorted.map((b) => (
          <div
            key={`lbl-${b.temp}`}
            className={`flex-1 min-w-0 text-center text-[8px] truncate leading-tight ${
              b.selected ? 'font-semibold text-white/90' : 'text-gray-500'
            }`}
          >
            {b.label}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[8px] text-gray-500 px-0.5">
        <span>model</span>
        <span>market</span>
      </div>
    </div>
  );
}

export function ChartWeatherHoverPanel({ weather }: { weather: CandleWeatherSnapshot }) {
  const obs = useMemo(() => candleWeatherToObservations(weather), [weather]);
  const unit: WeatherTempUnit = weather.unit === 'F' || weather.obsTempUnit === 'F' ? 'F' : 'C';

  const buckets = useMemo(() => {
    const raw = weather.market_buckets ?? [];
    const modelMap = weather.probs?.bucket_probabilities_1c;
    return raw.map((b) => {
      if (b.modelProb != null) return b;
      const model = lookupModelBucketProb(modelMap, b.temp);
      return model != null ? { ...b, modelProb: model } : b;
    });
  }, [weather.market_buckets, weather.probs]);

  const title = `${weather.city} · ${weather.target_date} · ${weather.metric === 'low' ? 'low' : 'high'}`;
  const ev = weather.probs?.expected_value_c;
  const conf = weather.probs?.confidence;

  return (
    <div className="mt-2 border-t border-gray-700 pt-2 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] font-medium text-gray-200 truncate">{title}</div>
        <div className="text-[9px] text-gray-500 tabular-nums shrink-0">
          {ev != null ? `μ ${ev.toFixed(1)}°` : ''}
          {conf != null ? ` · ${(conf * 100).toFixed(0)}%` : ''}
        </div>
      </div>
      <WeatherBucketBars buckets={buckets} metric={weather.metric} />
      {obs ? (
        <div className="h-[140px] min-h-[140px] rounded border border-gray-700/80 overflow-hidden bg-gray-950/40">
          <TemperatureChart data={obs} unit={unit} />
        </div>
      ) : (
        <div className="text-[10px] text-gray-500 text-center py-2">No forecast series</div>
      )}
    </div>
  );
}
