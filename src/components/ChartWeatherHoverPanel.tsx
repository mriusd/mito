import { useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import {
  candleWeatherToObservations,
  type CandleWeatherBucket,
  type CandleWeatherSnapshot,
} from '../lib/candleWeatherSnapshot';
import { getTempSortValue, lookupModelBucketProb } from '../lib/weatherMarketsGrid';
import { normalizeClobTokenId } from '../utils/format';
import { TemperatureChart } from './TemperatureChart';
import {
  weatherObsWithForecastSource,
  type WeatherTempUnit,
} from '../lib/weatherObservations';

function fracToPx(frac: number, maxPct: number, trackPx: number): number {
  if (maxPct <= 0 || trackPx <= 0 || frac <= 0) return 0;
  return Math.min(trackPx, (frac / maxPct) * trackPx);
}

/** Highlight bucket when sidebar selected token matches bucket YES or sibling NO. */
function weatherBucketMatchesSidebarToken(
  bucket: CandleWeatherBucket,
  selectedTokenId: string | null,
  selectedMarketTokenIds: string[] | undefined,
): boolean {
  const sel = normalizeClobTokenId(selectedTokenId);
  if (!sel) return false;
  const yes = normalizeClobTokenId(bucket.tokenId);
  if (yes && yes === sel) return true;
  if (!yes || !selectedMarketTokenIds?.length) return false;
  const mYes = normalizeClobTokenId(selectedMarketTokenIds[0]);
  const mNo = normalizeClobTokenId(selectedMarketTokenIds[1]);
  if (yes !== mYes) return false;
  return sel === mYes || sel === mNo;
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
  // Fixed 100% scale — do not auto-fit to tallest bar.
  const maxPct = 1;
  const trackPx = 72;
  const marketBarColor = metric === 'low' ? 'bg-cyan-400/90' : 'bg-red-400/90';
  const marketSpreadColor = metric === 'low' ? 'bg-cyan-700/70' : 'bg-red-700/70';

  if (sorted.length === 0) {
    return <div className="text-[10px] text-gray-500 py-2 text-center">No market buckets</div>;
  }

  const marketLabelColor = metric === 'low' ? 'text-cyan-400/90' : 'text-red-400/90';

  const tipLabel = (text: string, tipPx: number, colorClass: string) => (
    <span
      className={`absolute left-0 right-0 z-[6] -translate-y-full text-center text-[8px] tabular-nums leading-none pointer-events-none ${colorClass}`}
      style={{ bottom: tipPx }}
    >
      {text}
    </span>
  );

  return (
    <div className="flex flex-col gap-1 min-h-0">
      <div className="pt-2.5">
        <div className="flex items-end gap-0 divide-x divide-gray-500/80 overflow-visible" style={{ height: trackPx }}>
          {sorted.map((b) => {
            const mid = b.mid ?? b.bid ?? b.ask;
            const modelProb = b.modelProbOm ?? b.modelProb ?? null;
            const omPx = fracToPx(modelProb ?? 0, maxPct, trackPx);
            const stkPx = fracToPx(b.stakedProb ?? 0, maxPct, trackPx);
            const relPx = fracToPx(b.stakedShare ?? 0, maxPct, trackPx);
            const bidPx = fracToPx(b.bid ?? 0, maxPct, trackPx);
            const askPx = fracToPx(b.ask ?? 0, maxPct, trackPx);
            const midPx = b.mid != null ? fracToPx(b.mid, maxPct, trackPx) : null;
            const topPx = Math.max(bidPx, askPx, midPx ?? 0);
            return (
              <div
                key={`bar-${b.temp}`}
                className={`relative flex-1 min-w-0 h-full flex gap-0.5 items-end px-0.5 ${
                  b.selected ? 'ring-1 ring-white/70 rounded' : ''
                }`}
                title={[
                  b.temp,
                  modelProb != null ? `OM ${(modelProb * 100).toFixed(1)}%` : null,
                  b.stakedProb != null ? `Stk ${(b.stakedProb * 100).toFixed(1)}%` : null,
                  b.stakedShare != null ? `Rel ${(b.stakedShare * 100).toFixed(1)}%` : null,
                  mid != null ? `mid ${(mid * 100).toFixed(1)}%` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              >
                <div className="relative flex-1 min-w-0 h-full">
                  {omPx > 0 ? (
                    <div
                      className="absolute bottom-0 left-0 right-0 rounded-t-sm bg-amber-400/55"
                      style={{ height: omPx }}
                    />
                  ) : null}
                  {modelProb != null
                    ? tipLabel(`${(modelProb * 100).toFixed(0)}`, omPx, 'text-amber-400/80')
                    : null}
                </div>
                <div className="relative flex-1 min-w-0 h-full">
                  {stkPx > 0 ? (
                    <div
                      className="absolute bottom-0 left-0 right-0 rounded-t-sm bg-violet-400/55"
                      style={{ height: stkPx }}
                    />
                  ) : null}
                  {b.stakedProb != null
                    ? tipLabel(`${(b.stakedProb * 100).toFixed(0)}`, stkPx, 'text-violet-400/80')
                    : null}
                </div>
                <div className="relative flex-1 min-w-0 h-full">
                  {relPx > 0 ? (
                    <div
                      className="absolute bottom-0 left-0 right-0 rounded-t-sm bg-fuchsia-400/55"
                      style={{ height: relPx }}
                    />
                  ) : null}
                  {b.stakedShare != null
                    ? tipLabel(`${(b.stakedShare * 100).toFixed(0)}`, relPx, 'text-fuchsia-400/80')
                    : null}
                </div>
                <div className="relative flex-1 min-w-0 h-full">
                  {topPx > 0 ? (
                    <>
                      {bidPx > 0 ? (
                        <div
                          className={`absolute bottom-0 left-0 right-0 ${marketBarColor}`}
                          style={{ height: Math.min(bidPx, askPx || bidPx) }}
                        />
                      ) : null}
                      {askPx > bidPx ? (
                        <div
                          className={`absolute left-0 right-0 ${marketSpreadColor}`}
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
                  {mid != null
                    ? tipLabel(`${(mid * 100).toFixed(0)}`, topPx, marketLabelColor)
                    : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-0 divide-x divide-gray-500/80 min-h-[10px]">
        {sorted.map((b) => (
          <div
            key={`lbl-${b.temp}`}
            className={`flex-1 min-w-0 px-0.5 text-center text-[8px] truncate leading-tight ${
              b.selected ? 'font-semibold text-white/90' : 'text-gray-500'
            }`}
          >
            {b.label}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[8px] text-gray-500 px-0.5">
        <span className="text-amber-400/70">OM</span>
        <span className="text-violet-400/70">Stk</span>
        <span className="text-fuchsia-400/70">Rel</span>
        <span className={marketLabelColor}>mkt</span>
      </div>
    </div>
  );
}

export function ChartWeatherHoverPanel({ weather }: { weather: CandleWeatherSnapshot }) {
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const sidebarOutcome = useAppStore((s) => s.sidebarOutcome);
  const selectedTokenId = useMemo(() => {
    const toks = selectedMarket?.clobTokenIds;
    if (!toks?.length) return null;
    return toks[sidebarOutcome === 'YES' ? 0 : 1] || null;
  }, [selectedMarket, sidebarOutcome]);

  const obs = useMemo(() => candleWeatherToObservations(weather), [weather]);
  const unit: WeatherTempUnit = weather.unit === 'F' || weather.obsTempUnit === 'F' ? 'F' : 'C';
  const chartObs = useMemo(
    () => (obs ? weatherObsWithForecastSource(obs, 'open-meteo') : null),
    [obs],
  );

  const buckets = useMemo(() => {
    const raw = weather.market_buckets ?? [];
    const omMap =
      weather.probsBySource?.['open-meteo']?.bucket_probabilities_1c ??
      weather.probs?.bucket_probabilities_1c;
    return raw.map((b) => {
      let modelProbOm = b.modelProbOm;
      if (modelProbOm == null) {
        modelProbOm = lookupModelBucketProb(omMap, b.temp);
      }
      if (modelProbOm == null && b.modelProb != null) {
        modelProbOm = b.modelProb;
      }
      const selected = weatherBucketMatchesSidebarToken(
        b,
        selectedTokenId,
        selectedMarket?.clobTokenIds,
      );
      return { ...b, modelProbOm, modelProbWc: null, selected };
    });
  }, [
    weather.market_buckets,
    weather.probs,
    weather.probsBySource,
    selectedTokenId,
    selectedMarket?.clobTokenIds,
  ]);

  const title = `${weather.city} · ${weather.target_date} · ${weather.metric === 'low' ? 'low' : 'high'}`;
  const evOm = weather.probsBySource?.['open-meteo']?.expected_value_c ?? weather.probs?.expected_value_c;

  return (
    <div className="mt-2 border-t border-gray-700 pt-2 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] font-medium text-gray-200 truncate">{title}</div>
        <div className="text-[9px] text-gray-500 tabular-nums shrink-0">
          {evOm != null ? <span className="text-amber-400/80">OM μ {evOm.toFixed(1)}°</span> : null}
        </div>
      </div>
      <WeatherBucketBars buckets={buckets} metric={weather.metric} />
      {chartObs ? (
        <div className="space-y-0.5">
          <div className="text-[9px] font-bold uppercase tracking-wide text-amber-400/80">
            OM forecast
            {!chartObs.forecastPoints?.length ? (
              <span className="ml-1 font-normal normal-case text-gray-600">no fc</span>
            ) : null}
          </div>
          <div className="h-[120px] min-h-[120px] rounded border border-gray-700/80 overflow-hidden bg-gray-950/40">
            <TemperatureChart data={chartObs} unit={unit} forecastColor="#f87171" />
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-gray-500 text-center py-2">No forecast series</div>
      )}
    </div>
  );
}
