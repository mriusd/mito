const DEG = Math.PI / 180;

/** Solar declination (degrees) for date. */
export function solarDeclination(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const day = (date.getTime() - start) / 86400000;
  return 23.44 * Math.sin((2 * Math.PI * (day - 81)) / 365.25);
}

/** Subsolar longitude (degrees, −180…180). */
export function subsolarLongitude(date: Date): number {
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lon = (12 - utcH) * 15;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

export function subsolarPoint(date: Date): { lat: number; lon: number } {
  return { lat: solarDeclination(date), lon: subsolarLongitude(date) };
}

/** True when sun is below horizon (night). */
export function isNightAt(lat: number, lon: number, date: Date): boolean {
  const sub = subsolarPoint(date);
  const lat1 = lat * DEG;
  const lat2 = sub.lat * DEG;
  const dLon = (lon - sub.lon) * DEG;
  const cosDist = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return cosDist < 0;
}

/** Local solar hour (0–23 floor) at meridian longitude. */
export function solarHourAtLongitude(lon: number, date: Date): number {
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let h = utcH + lon / 15;
  while (h < 0) h += 24;
  while (h >= 24) h -= 24;
  return Math.floor(h);
}

/** Longitude (−180…180) where local solar time equals `hour` (e.g. 16 → 16:00). */
export function longitudeAtSolarHour(hour: number, date: Date): number {
  const utcH = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lon = (hour - utcH) * 15;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  return lon;
}

/** Decimal local hour [0, 24) in an IANA timezone. */
export function localDecimalHour(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(date);
  const n = (t: Intl.DateTimeFormatPartTypes) =>
    parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  return n('hour') + n('minute') / 60 + n('second') / 3600;
}

function normalizeLon(lon: number): number {
  let x = lon;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

/**
 * Longitude where civil clocks read `hour`:00, inferred from weather cities.
 * For each city still approaching that hour (within 12h), project
 * `city.lon + hoursUntil * 15°` and average (so NYC 13:47 → ~2h east of NYC).
 */
export function longitudeAtCivilHour(
  hour: number,
  date: Date,
  cities: ReadonlyArray<{ lon: number; timezone: string }>,
): number {
  let sumX = 0;
  let sumY = 0;
  let n = 0;
  const target = ((hour % 24) + 24) % 24;
  for (const c of cities) {
    const localH = localDecimalHour(date, c.timezone);
    const delta = (((target - localH) % 24) + 24) % 24;
    // Include cities at `hour`:00 (delta=0) and those approaching within 12h.
    if (delta > 12) continue;
    const lon = normalizeLon(c.lon + delta * 15);
    sumX += Math.cos(lon * DEG);
    sumY += Math.sin(lon * DEG);
    n += 1;
  }
  if (n === 0) return longitudeAtSolarHour(target, date);
  return (Math.atan2(sumY / n, sumX / n) * 180) / Math.PI;
}

export function utcOffsetLabel(lon: number): string {
  const off = Math.round(lon / 15);
  if (off === 0) return 'UTC';
  return off > 0 ? `UTC+${off}` : `UTC${off}`;
}
