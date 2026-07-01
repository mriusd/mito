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

export function utcOffsetLabel(lon: number): string {
  const off = Math.round(lon / 15);
  if (off === 0) return 'UTC';
  return off > 0 ? `UTC+${off}` : `UTC${off}`;
}
