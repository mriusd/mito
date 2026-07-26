import type {
  WeatherForecastSourceId,
  WeatherForecastSourceSeries,
  WeatherObservationsResponse,
  WeatherObservationPoint,
} from './weatherObservations';

export type CandleWeatherBucket = {
  temp: string;
  label: string;
  modelProb?: number | null;
  modelProbOm?: number | null;
  modelProbWc?: number | null;
  /** YES staked share: StakedNetYes / (Yes+No). */
  stakedProb?: number | null;
  /** Bucket YES stake / Σ YES stake across city/date/metric. */
  stakedShare?: number | null;
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
  forecastSource?: WeatherForecastSourceId | string;
  probs?: CandleWeatherProbs | null;
  probsBySource?: Partial<Record<WeatherForecastSourceId | string, CandleWeatherProbs>>;
  forecastHighC?: number | null;
  forecastLowC?: number | null;
  highTemp?: number | null;
  lowTemp?: number | null;
  obsTempUnit?: 'C' | 'F';
  points?: WeatherObservationPoint[];
  forecastPoints?: WeatherObservationPoint[];
  forecastBySource?: Partial<Record<WeatherForecastSourceId | string, WeatherForecastSourceSeries>>;
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

function parseProbs(raw: unknown): CandleWeatherProbs | null {
  if (!raw || typeof raw !== 'object') return null;
  const probsRaw = raw as Record<string, unknown>;
  const bp = probsRaw.bucket_probabilities_1c;
  return {
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

function parseForecastSeries(raw: unknown): WeatherForecastSourceSeries | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const points = Array.isArray(o.points)
    ? o.points.map(asPoint).filter((p): p is WeatherObservationPoint => p != null)
    : undefined;
  const forecastHighC = asNum(o.forecastHighC) ?? undefined;
  const forecastLowC = asNum(o.forecastLowC) ?? undefined;
  const forecastUpdatedAt = asNum(o.forecastUpdatedAt) ?? undefined;
  if (!points?.length && forecastHighC == null && forecastLowC == null) return null;
  return {
    ...(points?.length ? { points } : {}),
    ...(forecastHighC != null ? { forecastHighC } : {}),
    ...(forecastLowC != null ? { forecastLowC } : {}),
    ...(forecastUpdatedAt != null ? { forecastUpdatedAt } : {}),
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
      modelProbOm: asNum(br.modelProbOm),
      modelProbWc: asNum(br.modelProbWc),
      stakedProb: asNum(br.stakedProb),
      stakedShare: asNum(br.stakedShare),
      bid: asNum(br.bid),
      ask: asNum(br.ask),
      mid: asNum(br.mid),
      tokenId: typeof br.tokenId === 'string' ? br.tokenId : undefined,
      selected: br.selected === true,
    });
  }

  const probs = parseProbs(o.probs);
  const probsBySource: CandleWeatherSnapshot['probsBySource'] = {};
  if (o.probsBySource && typeof o.probsBySource === 'object' && !Array.isArray(o.probsBySource)) {
    for (const [src, rawProbs] of Object.entries(o.probsBySource as Record<string, unknown>)) {
      const parsed = parseProbs(rawProbs);
      if (parsed) probsBySource[src] = parsed;
    }
  }

  const points = Array.isArray(o.points)
    ? o.points.map(asPoint).filter((p): p is WeatherObservationPoint => p != null)
    : [];
  const forecastPoints = Array.isArray(o.forecastPoints)
    ? o.forecastPoints.map(asPoint).filter((p): p is WeatherObservationPoint => p != null)
    : undefined;

  const forecastBySource: CandleWeatherSnapshot['forecastBySource'] = {};
  if (o.forecastBySource && typeof o.forecastBySource === 'object' && !Array.isArray(o.forecastBySource)) {
    for (const [src, rawSeries] of Object.entries(o.forecastBySource as Record<string, unknown>)) {
      const parsed = parseForecastSeries(rawSeries);
      if (parsed) forecastBySource[src] = parsed;
    }
  }

  return {
    city,
    target_date: targetDate,
    metric: typeof o.metric === 'string' ? o.metric : 'high',
    analysis_timestamp: typeof o.analysis_timestamp === 'string' ? o.analysis_timestamp : undefined,
    unit: typeof o.unit === 'string' ? o.unit : undefined,
    timezone: typeof o.timezone === 'string' ? o.timezone : undefined,
    dayStartMs: asNum(o.dayStartMs) ?? undefined,
    dayEndMs: asNum(o.dayEndMs) ?? undefined,
    forecastSource: typeof o.forecastSource === 'string' ? o.forecastSource : undefined,
    probs,
    ...(Object.keys(probsBySource).length > 0 ? { probsBySource } : {}),
    forecastHighC: asNum(o.forecastHighC),
    forecastLowC: asNum(o.forecastLowC),
    highTemp: asNum(o.highTemp),
    lowTemp: asNum(o.lowTemp),
    obsTempUnit: o.obsTempUnit === 'F' || o.obsTempUnit === 'C' ? o.obsTempUnit : undefined,
    points,
    forecastPoints,
    ...(Object.keys(forecastBySource).length > 0 ? { forecastBySource } : {}),
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
    forecastSource: snap.forecastSource,
    points: snap.points ?? [],
    forecastPoints: snap.forecastPoints,
    forecastBySource: snap.forecastBySource,
    highTemp: snap.highTemp ?? undefined,
    lowTemp: snap.lowTemp ?? undefined,
    forecastHighC: snap.forecastHighC ?? undefined,
    forecastLowC: snap.forecastLowC ?? undefined,
    obsTempUnit: snap.obsTempUnit,
  };
}
