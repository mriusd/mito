import type { WeatherObservationsResponse, WeatherObservationPoint } from './weatherObservations';

export type CandleWeatherBucket = {
  temp: string;
  label: string;
  modelProb?: number | null;
  bid?: number | null;
  ask?: number | null;
  mid?: number | null;
  tokenId?: string;
  selected?: boolean;
};

export type CandleWeatherProbs = {
  expected_value_c?: number;
  median_c?: number;
  std_c?: number;
  bucket_probabilities_1c?: Record<string, number>;
  confidence?: number;
};

export type CandleWeatherSnapshot = {
  city: string;
  target_date: string;
  metric: 'high' | 'low' | string;
  analysis_timestamp?: string;
  unit?: 'C' | 'F' | string;
  timezone?: string;
  dayStartMs?: number;
  dayEndMs?: number;
  probs?: CandleWeatherProbs | null;
  forecastHighC?: number | null;
  forecastLowC?: number | null;
  highTemp?: number | null;
  lowTemp?: number | null;
  obsTempUnit?: 'C' | 'F';
  points?: WeatherObservationPoint[];
  forecastPoints?: WeatherObservationPoint[];
  market_buckets?: CandleWeatherBucket[];
};

function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asPoint(raw: unknown): WeatherObservationPoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const timeMs = asNum(o.timeMs);
  const temp = asNum(o.temp);
  if (timeMs == null || temp == null) return null;
  const humidity = asNum(o.humidity);
  const dewpoint = asNum(o.dewpoint);
  const windDirDeg = asNum(o.windDirDeg);
  const windSpeedKt = asNum(o.windSpeedKt);
  return {
    timeMs,
    temp,
    ...(humidity != null ? { humidity } : {}),
    ...(dewpoint != null ? { dewpoint } : {}),
    ...(windDirDeg != null ? { windDirDeg } : {}),
    ...(windSpeedKt != null ? { windSpeedKt } : {}),
  };
}

export function parseCandleWeather(raw: unknown): CandleWeatherSnapshot | undefined {
  if (raw == null || raw === '') return undefined;
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s || s === 'null') return undefined;
    try {
      obj = JSON.parse(s);
    } catch {
      return undefined;
    }
  }
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  const city = typeof o.city === 'string' ? o.city : '';
  const targetDate = typeof o.target_date === 'string' ? o.target_date : '';
  if (!city || !targetDate) return undefined;

  const bucketsRaw = Array.isArray(o.market_buckets) ? o.market_buckets : [];
  const market_buckets: CandleWeatherBucket[] = [];
  for (const b of bucketsRaw) {
    if (!b || typeof b !== 'object') continue;
    const br = b as Record<string, unknown>;
    const temp = typeof br.temp === 'string' ? br.temp : '';
    if (!temp) continue;
    market_buckets.push({
      temp,
      label: typeof br.label === 'string' ? br.label : temp,
      modelProb: asNum(br.modelProb),
      bid: asNum(br.bid),
      ask: asNum(br.ask),
      mid: asNum(br.mid),
      tokenId: typeof br.tokenId === 'string' ? br.tokenId : undefined,
      selected: br.selected === true,
    });
  }

  const probsRaw = o.probs && typeof o.probs === 'object' ? (o.probs as Record<string, unknown>) : null;
  let probs: CandleWeatherProbs | null = null;
  if (probsRaw) {
    const bp = probsRaw.bucket_probabilities_1c;
    probs = {
      expected_value_c: asNum(probsRaw.expected_value_c) ?? undefined,
      median_c: asNum(probsRaw.median_c) ?? undefined,
      std_c: asNum(probsRaw.std_c) ?? undefined,
      confidence: asNum(probsRaw.confidence) ?? undefined,
      bucket_probabilities_1c:
        bp && typeof bp === 'object' && !Array.isArray(bp)
          ? Object.fromEntries(
              Object.entries(bp as Record<string, unknown>)
                .map(([k, v]) => [k, asNum(v)])
                .filter((e): e is [string, number] => e[1] != null),
            )
          : undefined,
    };
  }

  const points = Array.isArray(o.points)
    ? o.points.map(asPoint).filter((p): p is WeatherObservationPoint => p != null)
    : [];
  const forecastPoints = Array.isArray(o.forecastPoints)
    ? o.forecastPoints.map(asPoint).filter((p): p is WeatherObservationPoint => p != null)
    : undefined;

  return {
    city,
    target_date: targetDate,
    metric: typeof o.metric === 'string' ? o.metric : 'high',
    analysis_timestamp: typeof o.analysis_timestamp === 'string' ? o.analysis_timestamp : undefined,
    unit: typeof o.unit === 'string' ? o.unit : undefined,
    timezone: typeof o.timezone === 'string' ? o.timezone : undefined,
    dayStartMs: asNum(o.dayStartMs) ?? undefined,
    dayEndMs: asNum(o.dayEndMs) ?? undefined,
    probs,
    forecastHighC: asNum(o.forecastHighC),
    forecastLowC: asNum(o.forecastLowC),
    highTemp: asNum(o.highTemp),
    lowTemp: asNum(o.lowTemp),
    obsTempUnit: o.obsTempUnit === 'F' || o.obsTempUnit === 'C' ? o.obsTempUnit : undefined,
    points,
    forecastPoints,
    market_buckets,
  };
}

export function candleWeatherToObservations(snap: CandleWeatherSnapshot): WeatherObservationsResponse | null {
  if (!snap.dayStartMs || !snap.dayEndMs || !snap.timezone) return null;
  const dateCompact = snap.target_date.replace(/-/g, '');
  return {
    city: snap.city,
    date: dateCompact,
    locationId: snap.city,
    timezone: snap.timezone,
    dayStartMs: snap.dayStartMs,
    dayEndMs: snap.dayEndMs,
    points: snap.points ?? [],
    forecastPoints: snap.forecastPoints,
    highTemp: snap.highTemp ?? undefined,
    lowTemp: snap.lowTemp ?? undefined,
    forecastHighC: snap.forecastHighC ?? undefined,
    forecastLowC: snap.forecastLowC ?? undefined,
    obsTempUnit: snap.obsTempUnit,
  };
}
