import { geoGraticule, geoPath, geoEquirectangular } from 'd3-geo';
import { Minus, Plus } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WEATHER_CITIES, type WeatherCitySlug } from '../../lib/weatherCities';
import { WEATHER_CITY_COORDS } from '../../lib/weatherCityCoords';
import {
  isNightAt,
  longitudeAtCivilHour,
  solarHourAtLongitude,
  subsolarPoint,
  utcOffsetLabel,
} from '../../lib/weatherMapSun';
import {
  onTempOddsCitySelect,
  onTempOddsDateSelect,
  onTempOddsMetricSelect,
  getTempOddsSelectedDate,
  getTempOddsSelectedMetric,
  selectTempOddsCity,
} from '../../lib/weatherTempOddsControl';
import {
  buildWeatherCityExposureByDate,
  buildWeatherCityMaxBidByDate,
  buildWeatherCityMaxSpreadByDate,
  buildWeatherCityMispricedByDate,
  weatherMapQuoteTokenIdsForDate,
  type WeatherCityExposure,
} from '../../lib/weatherMapExposure';
import { fetchWeatherObservations, weatherMispriceHighBoundC } from '../../lib/weatherObservations';
import { getSidebarOnchainTradesSnapshot, subscribeSidebarOnchainTrades } from '../../lib/sidebarOnchainTradesStore';
import { useAppStore } from '../../stores/appStore';
import { getBidAskMarketRow, subscribeBidAskMarketLookupGridFlush } from '../../lib/bidAskMarketLookup';
import { setChartBidAskExtraTokens } from '../../lib/chartWsShared';
import type { Market } from '../../types';

type GeoPolygon = number[][][];
type GeoMultiPolygon = number[][][][];
type LandGeoJSON = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    geometry: { type: 'Polygon'; coordinates: GeoPolygon } | { type: 'MultiPolygon'; coordinates: GeoMultiPolygon };
  }>;
};

type MapCity = {
  slug: WeatherCitySlug;
  label: string;
  lat: number;
  lon: number;
};

type MapLayout = {
  pad: number;
  w: number;
  h: number;
  width: number;
  height: number;
  mapTop: number;
};

const LAND_GEOJSON_URL = `${import.meta.env.BASE_URL}ne_110m_land.geojson`;
const DOT_RADIUS = 4;
const HIT_RADIUS = 16;
const MAP_TOP_LABEL_H = 16;
const GRATICULE_STEP = 15;
const TZ_LON_STEP = 15;
const NIGHT_OVERLAY_STEP = 6;
const MAP_ZOOM_MIN = 1;
const MAP_ZOOM_MAX = 6;
const MAP_ZOOM_STEP = 0.25;

function snapMapZoom(zoom: number): number {
  const stepped = Math.round(zoom / MAP_ZOOM_STEP) * MAP_ZOOM_STEP;
  return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, stepped));
}

type MapView = { zoom: number; panX: number; panY: number };

const DEFAULT_MAP_VIEW: MapView = { zoom: 1, panX: 0, panY: 0 };

function weatherMapViewStorageKey(panelId: string): string {
  return `polybot-weather-map-view-${panelId}`;
}

function clampMapView(view: MapView, layout: MapLayout): MapView {
  const zoom = snapMapZoom(view.zoom);
  if (zoom <= MAP_ZOOM_MIN + 1e-6) {
    return { zoom: MAP_ZOOM_MIN, panX: 0, panY: 0 };
  }
  const maxPanX = (layout.w / 2) * (zoom - 1);
  const maxPanY = (layout.h / 2) * (zoom - 1);
  return {
    zoom,
    panX: Math.min(maxPanX, Math.max(-maxPanX, view.panX)),
    panY: Math.min(maxPanY, Math.max(-maxPanY, view.panY)),
  };
}

/** Persist zoom + pan as fractions of map size (survives panel resize). */
function writeStoredMapView(panelId: string, view: MapView, layout: MapLayout | null) {
  const w = layout?.w ?? 1;
  const h = layout?.h ?? 1;
  try {
    localStorage.setItem(
      weatherMapViewStorageKey(panelId),
      JSON.stringify({
        zoom: view.zoom,
        panXFrac: w > 0 ? view.panX / w : 0,
        panYFrac: h > 0 ? view.panY / h : 0,
      }),
    );
  } catch {
    /* ignore quota */
  }
}

function readStoredMapView(panelId: string): MapView {
  try {
    const raw = localStorage.getItem(weatherMapViewStorageKey(panelId));
    if (!raw) return { ...DEFAULT_MAP_VIEW };
    const o = JSON.parse(raw) as { zoom?: unknown; panXFrac?: unknown; panYFrac?: unknown };
    const zoom =
      typeof o.zoom === 'number' && Number.isFinite(o.zoom) ? snapMapZoom(o.zoom) : MAP_ZOOM_MIN;
    if (zoom <= MAP_ZOOM_MIN + 1e-6) return { ...DEFAULT_MAP_VIEW };
    const panXFrac = typeof o.panXFrac === 'number' && Number.isFinite(o.panXFrac) ? o.panXFrac : 0;
    const panYFrac = typeof o.panYFrac === 'number' && Number.isFinite(o.panYFrac) ? o.panYFrac : 0;
    // Absolute pan applied once layout known; keep fracs via temporary unit layout.
    return { zoom, panX: panXFrac, panY: panYFrac };
  } catch {
    return { ...DEFAULT_MAP_VIEW };
  }
}

function mapViewFromStoredFracs(stored: MapView, layout: MapLayout): MapView {
  // readStoredMapView packs panX/panY as fracs until first layout apply.
  return clampMapView(
    {
      zoom: stored.zoom,
      panX: stored.panX * layout.w,
      panY: stored.panY * layout.h,
    },
    layout,
  );
}

function applyMapViewTransform(ctx: CanvasRenderingContext2D, layout: MapLayout, view: MapView) {
  const cx = layout.pad + layout.w / 2;
  const cy = layout.mapTop + layout.h / 2;
  ctx.translate(cx + view.panX, cy + view.panY);
  ctx.scale(view.zoom, view.zoom);
  ctx.translate(-cx, -cy);
}

/** Screen → layout/map coords (inverse of applyMapViewTransform). */
function screenToMapCoords(mx: number, my: number, layout: MapLayout, view: MapView) {
  const cx = layout.pad + layout.w / 2;
  const cy = layout.mapTop + layout.h / 2;
  const z = view.zoom || 1;
  return {
    x: (mx - cx - view.panX) / z + cx,
    y: (my - cy - view.panY) / z + cy,
  };
}

let landGeoJsonPromise: Promise<LandGeoJSON> | null = null;
let nightOverlayCache: { key: string; canvas: HTMLCanvasElement } | null = null;

function loadLandGeoJSON(): Promise<LandGeoJSON> {
  if (!landGeoJsonPromise) {
    landGeoJsonPromise = fetch(LAND_GEOJSON_URL).then((r) => {
      if (!r.ok) throw new Error(`land geojson ${r.status}`);
      return r.json() as Promise<LandGeoJSON>;
    });
  }
  return landGeoJsonPromise;
}

function makeLayout(width: number, height: number): MapLayout {
  const pad = 6;
  return {
    pad,
    w: Math.max(1, width - pad * 2),
    h: Math.max(1, height - pad * 2 - MAP_TOP_LABEL_H),
    width,
    height,
    mapTop: pad + MAP_TOP_LABEL_H,
  };
}

function makeProjection(layout: MapLayout) {
  return geoEquirectangular().fitExtent(
    [
      [layout.pad, layout.mapTop],
      [layout.pad + layout.w, layout.mapTop + layout.h],
    ],
    { type: 'Sphere' },
  );
}

function projectLonLat(lon: number, lat: number, layout: MapLayout) {
  const proj = makeProjection(layout);
  const p = proj([lon, lat]);
  return { x: p?.[0] ?? 0, y: p?.[1] ?? 0 };
}

function drawLand(ctx: CanvasRenderingContext2D, land: LandGeoJSON, layout: MapLayout) {
  ctx.fillStyle = '#2a3441';
  for (const feature of land.features) {
    const geom = feature.geometry;
    if (geom.type === 'Polygon') {
      drawRings(ctx, geom.coordinates, layout);
    } else {
      for (const poly of geom.coordinates) {
        drawRings(ctx, poly, layout);
      }
    }
  }
}

function drawRings(ctx: CanvasRenderingContext2D, rings: GeoPolygon, layout: MapLayout) {
  ctx.beginPath();
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const [lon, lat] = ring[i];
      const { x, y } = projectLonLat(lon, lat, layout);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.fill();
}

function drawGraticule(ctx: CanvasRenderingContext2D, layout: MapLayout) {
  const projection = makeProjection(layout);
  const path = geoPath(projection).context(ctx);
  const graticule = geoGraticule().step([GRATICULE_STEP, GRATICULE_STEP]);

  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  path(graticule());
  ctx.stroke();

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  for (const line of graticule.lines()) {
    ctx.beginPath();
    path(line);
    ctx.stroke();
  }
  ctx.restore();
}

function drawTimezoneMeridians(ctx: CanvasRenderingContext2D, layout: MapLayout) {
  ctx.save();
  ctx.strokeStyle = 'rgba(251, 191, 36, 0.12)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  for (let lon = -180; lon <= 180; lon += TZ_LON_STEP) {
    const top = projectLonLat(lon, 90, layout);
    const bottom = projectLonLat(lon, -90, layout);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(bottom.x, bottom.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();
}

const CIVIL_HOUR_16_CITIES: ReadonlyArray<{ lon: number; timezone: string }> = WEATHER_CITIES.filter(
  (c) => WEATHER_CITY_COORDS[c.slug],
).map((c) => ({ lon: WEATHER_CITY_COORDS[c.slug].lon, timezone: c.timezone }));

/**
 * Thin orange dotted line where city civil clocks hit 16:00
 * (NYC 13:47 → ~2h / 30° east of NYC, not mid-Atlantic solar band).
 * Screen space so zoom/pan doesn't drift it.
 */
function drawSolarHour16Line(ctx: CanvasRenderingContext2D, layout: MapLayout, date: Date) {
  const lon = longitudeAtCivilHour(16, date, CIVIL_HOUR_16_CITIES);
  const x = projectLonLat(lon, 0, layout).x;
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.pad, layout.mapTop, layout.w, layout.h);
  ctx.clip();
  ctx.strokeStyle = 'rgba(249, 115, 22, 0.9)';
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(x, layout.mapTop);
  ctx.lineTo(x, layout.mapTop + layout.h);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function buildNightOverlayCanvas(w: number, h: number, date: Date): HTMLCanvasElement {
  const minuteKey = Math.floor(date.getTime() / 60_000);
  const key = `${w}x${h}:${minuteKey}`;
  if (nightOverlayCache?.key === key) return nightOverlayCache.canvas;

  const overlay = document.createElement('canvas');
  overlay.width = w;
  overlay.height = h;
  const ctx = overlay.getContext('2d');
  if (!ctx) return overlay;

  ctx.fillStyle = 'rgba(5, 8, 20, 0.62)';
  for (let py = 0; py < h; py += NIGHT_OVERLAY_STEP) {
    const lat = 90 - (py / h) * 180;
    for (let px = 0; px < w; px += NIGHT_OVERLAY_STEP) {
      const lon = (px / w) * 360 - 180;
      if (isNightAt(lat, lon, date)) {
        ctx.fillRect(px, py, NIGHT_OVERLAY_STEP, NIGHT_OVERLAY_STEP);
      }
    }
  }

  nightOverlayCache = { key, canvas: overlay };
  return overlay;
}

function drawNightOverlay(ctx: CanvasRenderingContext2D, layout: MapLayout, date: Date) {
  const overlay = buildNightOverlayCanvas(layout.w, layout.h, date);
  ctx.drawImage(overlay, layout.pad, layout.mapTop);
}

function drawDayGlow(ctx: CanvasRenderingContext2D, layout: MapLayout, date: Date) {
  const sub = subsolarPoint(date);
  const { x, y } = projectLonLat(sub.lon, sub.lat, layout);
  const r = Math.max(28, layout.w * 0.08);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(250, 204, 21, 0.18)');
  g.addColorStop(0.45, 'rgba(250, 204, 21, 0.06)');
  g.addColorStop(1, 'rgba(250, 204, 21, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(251, 146, 60, 0.5)';
  ctx.beginPath();
  ctx.arc(x, y, 3.5, 0, Math.PI * 2);
  ctx.fill();
}

/** Flash when max spread exceeds this (20¢). */
const SPREAD_FLASH_AT = 0.2;
const FLASH_PERIOD_MS = 650;
const FORECAST_HIGH_REFRESH_MS = 5 * 60_000;
const FLASH_PURPLE = '#c084fc';
const FLASH_TURQUOISE = '#2dd4bf';

/** Position PnL / open order → stroke around certainty fill. None = no state ring. */
function cityDotStrokeByState(exposure: WeatherCityExposure | undefined): string | null {
  if (!exposure || exposure.kind === 'none') return null;
  if (exposure.kind === 'order') return '#c084fc';
  const tier = exposure.tier;
  if (tier === 'green') return '#4ade80';
  if (tier === 'red') return '#f87171';
  return '#facc15';
}

/** Max-bid certainty: red (low) → yellow → green (high). No quote = gray. */
function cityDotFillByMaxBid(
  maxBid: number | undefined,
  hovered: boolean,
  selected: boolean,
): string {
  if (maxBid == null || !(maxBid > 0) || !Number.isFinite(maxBid)) {
    return selected || hovered ? '#e5e7eb' : '#9ca3af';
  }
  const t = Math.min(1, Math.max(0, maxBid));
  const hue = t * 120;
  const light = selected || hovered ? 58 : 48;
  return `hsl(${hue}, 75%, ${light}%)`;
}

function flashPulseAt(tsMs: number, phaseRad = 0): number {
  return 0.22 + 0.78 * (0.5 + 0.5 * Math.sin((tsMs / FLASH_PERIOD_MS) * Math.PI * 2 + phaseRad));
}

function baseMapCacheKey(
  width: number,
  height: number,
  dpr: number,
  view: MapView,
  nowMs: number,
  hasLand: boolean,
): string {
  const minute = Math.floor(nowMs / 60_000);
  return `${width}x${height}@${dpr}|z${view.zoom.toFixed(3)}|${view.panX.toFixed(1)},${view.panY.toFixed(1)}|${minute}|${hasLand ? 1 : 0}`;
}

function drawMapBase(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  layout: MapLayout,
  view: MapView,
  land: LandGeoJSON | null,
  loadError: string,
  nowMs: number,
) {
  const date = new Date(nowMs);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.pad, layout.mapTop, layout.w, layout.h);
  ctx.clip();
  applyMapViewTransform(ctx, layout, view);
  ctx.fillStyle = '#0c4a6e';
  ctx.fillRect(layout.pad, layout.mapTop, layout.w, layout.h);
  if (land) drawLand(ctx, land, layout);
  drawNightOverlay(ctx, layout, date);
  drawDayGlow(ctx, layout, date);
  drawGraticule(ctx, layout);
  drawTimezoneMeridians(ctx, layout);
  ctx.restore();
  drawSolarHour16Line(ctx, layout, date);
  if (loadError && !land) {
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Map load failed', width / 2, height / 2);
  }
}

function drawMapCities(
  ctx: CanvasRenderingContext2D,
  layout: MapLayout,
  view: MapView,
  cities: MapCity[],
  cityMaxBid: Map<string, number>,
  cityMaxSpread: Map<string, number>,
  cityMispriced: Map<string, number>,
  cityExposure: Map<string, WeatherCityExposure>,
  hoverSlug: WeatherCitySlug | null,
  selectedSlug: WeatherCitySlug | null,
  pulseTs: number,
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(layout.pad, layout.mapTop, layout.w, layout.h);
  ctx.clip();
  applyMapViewTransform(ctx, layout, view);
  const invZ = 1 / Math.max(view.zoom, 1);
  const pulse = flashPulseAt(pulseTs, 0);
  const pulseAlt = flashPulseAt(pulseTs, Math.PI);
  for (const city of cities) {
    const { x, y } = projectLonLat(city.lon, city.lat, layout);
    const hovered = hoverSlug === city.slug;
    const selected = selectedSlug === city.slug;
    const maxBid = cityMaxBid.get(city.slug);
    const maxSpread = cityMaxSpread.get(city.slug);
    const misMid = cityMispriced.get(city.slug);
    const exposure = cityExposure.get(city.slug);
    const r = (selected ? DOT_RADIUS + 2 : hovered ? DOT_RADIUS + 1.5 : DOT_RADIUS) * invZ;
    const mispriced = misMid != null && misMid > 0;
    const wideSpread = maxSpread != null && maxSpread > SPREAD_FLASH_AT;
    const stateStroke = cityDotStrokeByState(exposure);

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = cityDotFillByMaxBid(maxBid, hovered, selected);
    ctx.fill();

    if (mispriced) {
      ctx.save();
      ctx.globalAlpha = 0.25 + 0.7 * pulse;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = FLASH_TURQUOISE;
      ctx.fill();
      ctx.restore();
    }

    if (stateStroke) {
      const sr = r + 2.25 * invZ;
      ctx.beginPath();
      ctx.arc(x, y, sr, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.9)';
      ctx.lineWidth = 4.5 * invZ;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, sr, 0, Math.PI * 2);
      ctx.strokeStyle = stateStroke;
      ctx.lineWidth = 2.75 * invZ;
      ctx.stroke();
    }

    if (wideSpread) {
      const hr = r + (stateStroke ? 5.5 : 3.5) * invZ;
      ctx.save();
      ctx.globalAlpha = 0.35 + 0.65 * pulseAlt;
      ctx.beginPath();
      ctx.arc(x, y, hr, 0, Math.PI * 2);
      ctx.strokeStyle = FLASH_PURPLE;
      ctx.lineWidth = 3.25 * invZ;
      ctx.stroke();
      ctx.restore();
    }

    const outer = r + (wideSpread ? 8 : stateStroke ? 5.5 : 3) * invZ;
    if (selected) {
      ctx.beginPath();
      ctx.arc(x, y, outer, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 2 * invZ;
      ctx.stroke();
    } else if (hovered) {
      ctx.beginPath();
      ctx.arc(x, y, outer - 1 * invZ, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 1.5 * invZ;
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawDataNeedsFlash(data: {
  cityMispriced: Map<string, number>;
  cityMaxSpread: Map<string, number>;
}): boolean {
  for (const v of data.cityMispriced.values()) {
    if (v > 0) return true;
  }
  for (const s of data.cityMaxSpread.values()) {
    if (s > SPREAD_FLASH_AT) return true;
  }
  return false;
}

function updateHoverTooltip(
  el: HTMLDivElement | null,
  tip: { x: number; y: number; label: string } | null,
) {
  if (!el) return;
  if (!tip) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  el.style.left = `${tip.x}px`;
  el.style.top = `${tip.y - 8}px`;
  el.textContent = tip.label;
}

function nearestCity(
  cities: MapCity[],
  layout: MapLayout,
  mx: number,
  my: number,
  view: MapView = DEFAULT_MAP_VIEW,
): MapCity | null {
  const mapPt = screenToMapCoords(mx, my, layout, view);
  const hitR = HIT_RADIUS / Math.max(view.zoom, 1);
  let best: MapCity | null = null;
  let bestD = Infinity;
  for (const city of cities) {
    const { x, y } = projectLonLat(city.lon, city.lat, layout);
    const d = Math.hypot(mapPt.x - x, mapPt.y - y);
    if (d <= hitR && d < bestD) {
      best = city;
      bestD = d;
    }
  }
  return best;
}

function lonBandCenterPercent(lon: number, layout: MapLayout): number {
  const { x } = projectLonLat(lon + TZ_LON_STEP / 2, 0, layout);
  return (x / layout.width) * 100;
}

function buildTimezoneMeridians(): number[] {
  const lons: number[] = [];
  for (let lon = -180; lon < 180; lon += TZ_LON_STEP) {
    lons.push(lon);
  }
  return lons;
}

function WeatherMapPanelInner({ panelId }: { panelId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<MapLayout | null>(null);
  const hoverSlugRef = useRef<WeatherCitySlug | null>(null);
  const selectedSlugRef = useRef<WeatherCitySlug | null>(null);
  const hoverTipRef = useRef<{ x: number; y: number; label: string } | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const drawRafRef = useRef(0);
  const scheduleDrawRef = useRef<() => void>(() => {});
  const syncFlashLoopRef = useRef<() => void>(() => {});
  const canvasSizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const baseCacheRef = useRef<{ key: string; canvas: HTMLCanvasElement } | null>(null);
  const pulseTsRef = useRef(0);
  const tipElRef = useRef<HTMLDivElement>(null);
  const meridianStripRef = useRef<HTMLDivElement>(null);
  const drawDataRef = useRef({
    land: null as LandGeoJSON | null,
    loadError: '',
    nowMs: Date.now(),
    cities: [] as MapCity[],
    cityMaxBid: new Map<string, number>(),
    cityMaxSpread: new Map<string, number>(),
    cityMispriced: new Map<string, number>(),
    cityExposure: new Map<string, WeatherCityExposure>(),
  });
  const initStoredView = useMemo(() => readStoredMapView(panelId), [panelId]);
  /** panX/panY still fracs until first layout apply. */
  const pendingStoredViewRef = useRef<MapView | null>(
    initStoredView.zoom > MAP_ZOOM_MIN + 1e-6 ? initStoredView : null,
  );
  const viewRef = useRef<MapView>({ zoom: initStoredView.zoom, panX: 0, panY: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originPanX: number;
    originPanY: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [land, setLand] = useState<LandGeoJSON | null>(null);
  const [loadError, setLoadError] = useState('');
  const [layoutSnapshot, setLayoutSnapshot] = useState<MapLayout | null>(null);
  const [zoom, setZoom] = useState(initStoredView.zoom);
  const [dragging, setDragging] = useState(false);

  const [tempOddsDateIso, setTempOddsDateIso] = useState<string | null>(() => getTempOddsSelectedDate());
  const [tempOddsMetric, setTempOddsMetric] = useState(() => getTempOddsSelectedMetric());
  // Catalog / quotes / forecast / clock — refs only. React select of weatherMarkets was 250ms passive.
  const weatherMarketsRef = useRef(useAppStore.getState().weatherMarkets);
  const tempOddsDateIsoRef = useRef(tempOddsDateIso);
  tempOddsDateIsoRef.current = tempOddsDateIso;
  const tempOddsMetricRef = useRef(tempOddsMetric);
  tempOddsMetricRef.current = tempOddsMetric;
  const forecastHighByCityRef = useRef<Map<string, number>>(new Map());
  const quoteTokenIdsRef = useRef<string[]>([]);

  const rebuildQuoteTokenIds = useCallback(() => {
    const markets = weatherMarketsRef.current;
    const dateIso = tempOddsDateIsoRef.current;
    const metric = tempOddsMetricRef.current;
    const metricIds = weatherMapQuoteTokenIdsForDate(markets, dateIso, metric);
    const highIds =
      metric === 'high' ? metricIds : weatherMapQuoteTokenIdsForDate(markets, dateIso, 'high');
    if (metric === 'high') {
      quoteTokenIdsRef.current = metricIds;
      return metricIds;
    }
    const seen = new Set(metricIds);
    const out = metricIds.slice();
    for (const id of highIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    quoteTokenIdsRef.current = out;
    return out;
  }, []);

  const rebuildLiveQuoteMaps = useCallback(() => {
    const liveLookup: Record<string, Market> = {};
    for (const tid of quoteTokenIdsRef.current) {
      const row = getBidAskMarketRow(tid);
      if (row) liveLookup[tid] = row;
    }
    const markets = weatherMarketsRef.current;
    const dateIso = tempOddsDateIsoRef.current;
    const metric = tempOddsMetricRef.current;
    drawDataRef.current.cityMaxBid = buildWeatherCityMaxBidByDate(markets, dateIso, liveLookup, metric);
    drawDataRef.current.cityMaxSpread = buildWeatherCityMaxSpreadByDate(markets, dateIso, liveLookup, metric);
    drawDataRef.current.cityMispriced = buildWeatherCityMispricedByDate(
      markets,
      dateIso,
      liveLookup,
      forecastHighByCityRef.current,
    );
  }, []);

  const rebuildCityExposure = useCallback(() => {
    const st = useAppStore.getState();
    const myOrders = st.orders.filter((o) => !st.progOrderMap[o.id]);
    drawDataRef.current.cityExposure = buildWeatherCityExposureByDate(
      weatherMarketsRef.current,
      tempOddsDateIsoRef.current,
      st.positions,
      myOrders,
      st.liveTradesSource,
      getSidebarOnchainTradesSnapshot().gridWalletPositions,
      st.marketLookup,
      tempOddsMetricRef.current,
    );
  }, []);

  const refreshMapData = useCallback(() => {
    rebuildQuoteTokenIds();
    rebuildLiveQuoteMaps();
    rebuildCityExposure();
    syncFlashLoopRef.current();
    scheduleDrawRef.current();
  }, [rebuildQuoteTokenIds, rebuildLiveQuoteMaps, rebuildCityExposure]);

  useEffect(() => {
    rebuildQuoteTokenIds();
  }, [tempOddsDateIso, tempOddsMetric, rebuildQuoteTokenIds]);

  useEffect(() => {
    refreshMapData();
  }, [tempOddsDateIso, tempOddsMetric, refreshMapData]);

  useEffect(() => {
    weatherMarketsRef.current = useAppStore.getState().weatherMarkets;
    refreshMapData();
    setChartBidAskExtraTokens('weather-map', rebuildQuoteTokenIds());
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.weatherMarkets === prev.weatherMarkets) return;
      weatherMarketsRef.current = state.weatherMarkets;
      refreshMapData();
      setChartBidAskExtraTokens('weather-map', rebuildQuoteTokenIds());
    });
    return () => {
      unsub();
      setChartBidAskExtraTokens('weather-map', []);
    };
  }, [rebuildQuoteTokenIds, refreshMapData]);

  useEffect(
    () =>
      subscribeBidAskMarketLookupGridFlush(() => {
        rebuildLiveQuoteMaps();
        syncFlashLoopRef.current();
        scheduleDrawRef.current();
      }),
    [rebuildLiveQuoteMaps],
  );

  // Wallet / lookup / orders — update canvas refs only (no React re-render).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const flush = () => {
      timer = null;
      rebuildCityExposure();
      scheduleDrawRef.current();
    };
    const schedule = () => {
      if (timer != null) return;
      timer = setTimeout(flush, 2000);
    };
    rebuildCityExposure();
    const unsubApp = useAppStore.subscribe((state, prev) => {
      if (
        state.positions === prev.positions &&
        state.orders === prev.orders &&
        state.progOrderMap === prev.progOrderMap &&
        state.liveTradesSource === prev.liveTradesSource &&
        state.marketLookupEpoch === prev.marketLookupEpoch
      ) {
        return;
      }
      schedule();
    });
    const unsubOnchain = subscribeSidebarOnchainTrades(schedule);
    return () => {
      unsubApp();
      unsubOnchain();
      if (timer != null) clearTimeout(timer);
    };
  }, [rebuildCityExposure]);

  useEffect(() => onTempOddsDateSelect(setTempOddsDateIso), []);
  useEffect(() => onTempOddsMetricSelect(setTempOddsMetric), []);

  useEffect(() => {
    if (!tempOddsDateIso) return;
    let alive = true;
    const load = () => {
      void Promise.all(
        WEATHER_CITIES.map(async (c) => {
          try {
            const obs = await fetchWeatherObservations(c.slug, tempOddsDateIso);
            const hi = weatherMispriceHighBoundC(obs);
            return hi != null ? ([c.slug, hi] as const) : null;
          } catch {
            return null;
          }
        }),
      ).then((rows) => {
        if (!alive) return;
        const next = new Map<string, number>();
        for (const row of rows) {
          if (row) next.set(row[0], row[1]);
        }
        const prev = forecastHighByCityRef.current;
        if (prev.size === next.size) {
          let same = true;
          for (const [k, v] of next) {
            if (prev.get(k) !== v) {
              same = false;
              break;
            }
          }
          if (same) return;
        }
        forecastHighByCityRef.current = next;
        rebuildLiveQuoteMaps();
        syncFlashLoopRef.current();
        scheduleDrawRef.current();
      });
    };
    load();
    const id = window.setInterval(load, FORECAST_HIGH_REFRESH_MS);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [tempOddsDateIso, rebuildLiveQuoteMaps]);

  const meridians = useMemo(() => buildTimezoneMeridians(), []);

  useEffect(() => {
    const tick = () => {
      drawDataRef.current.nowMs = Date.now();
      baseCacheRef.current = null;
      scheduleDrawRef.current();
      const strip = meridianStripRef.current;
      if (!strip) return;
      const now = new Date(drawDataRef.current.nowMs);
      for (const el of strip.querySelectorAll<HTMLElement>('[data-tz-lon]')) {
        const lon = Number(el.dataset.tzLon);
        if (!Number.isFinite(lon)) continue;
        const hour = String(solarHourAtLongitude(lon + TZ_LON_STEP / 2, now)).padStart(2, '0');
        el.textContent = hour;
        el.title = `${utcOffsetLabel(lon)} · solar ${hour}:00`;
      }
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const cities = useMemo<MapCity[]>(
    () =>
      WEATHER_CITIES.filter((c) => WEATHER_CITY_COORDS[c.slug]).map((c) => ({
        slug: c.slug,
        label: c.label,
        ...WEATHER_CITY_COORDS[c.slug],
      })),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void loadLandGeoJSON()
      .then((geo) => {
        if (!cancelled) setLand(geo);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    const size = canvasSizeRef.current;
    if (size.w !== width || size.h !== height || size.dpr !== dpr) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      size.w = width;
      size.h = height;
      size.dpr = dpr;
      baseCacheRef.current = null;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const {
      land,
      loadError,
      nowMs,
      cities,
      cityMaxBid,
      cityMaxSpread,
      cityMispriced,
      cityExposure,
    } = drawDataRef.current;

    const layout = makeLayout(width, height);
    layoutRef.current = layout;
    if (pendingStoredViewRef.current) {
      viewRef.current = mapViewFromStoredFracs(pendingStoredViewRef.current, layout);
      pendingStoredViewRef.current = null;
      baseCacheRef.current = null;
    }
    const view = clampMapView(viewRef.current, layout);
    viewRef.current = view;

    const baseKey = baseMapCacheKey(width, height, dpr, view, nowMs, !!land);
    if (!baseCacheRef.current || baseCacheRef.current.key !== baseKey) {
      const baseCanvas = document.createElement('canvas');
      baseCanvas.width = Math.floor(width * dpr);
      baseCanvas.height = Math.floor(height * dpr);
      const bctx = baseCanvas.getContext('2d');
      if (bctx) {
        bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawMapBase(bctx, width, height, layout, view, land, loadError, nowMs);
        baseCacheRef.current = { key: baseKey, canvas: baseCanvas };
      }
    }

    ctx.clearRect(0, 0, width, height);
    if (baseCacheRef.current) {
      ctx.drawImage(baseCacheRef.current.canvas, 0, 0, width, height);
    }

    drawMapCities(
      ctx,
      layout,
      view,
      cities,
      cityMaxBid,
      cityMaxSpread,
      cityMispriced,
      cityExposure,
      hoverSlugRef.current,
      selectedSlugRef.current,
      pulseTsRef.current || performance.now(),
    );
  }, []);

  drawRef.current = draw;

  const scheduleDraw = useCallback(() => {
    if (flashLoopActiveRef.current) return;
    if (drawRafRef.current) return;
    drawRafRef.current = requestAnimationFrame(() => {
      drawRafRef.current = 0;
      drawRef.current();
    });
  }, []);

  scheduleDrawRef.current = scheduleDraw;

  const flashLoopRef = useRef<{ stop: () => void } | null>(null);
  const flashLoopActiveRef = useRef(false);

  const syncFlashLoop = useCallback(() => {
    if (!drawDataNeedsFlash(drawDataRef.current)) {
      flashLoopRef.current?.stop();
      flashLoopRef.current = null;
      flashLoopActiveRef.current = false;
      scheduleDrawRef.current();
      return;
    }
    if (flashLoopRef.current) return;
    let alive = true;
    let raf = 0;
    flashLoopActiveRef.current = true;
    const tick = (ts: number) => {
      if (!alive) return;
      pulseTsRef.current = ts;
      drawRef.current();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    flashLoopRef.current = {
      stop: () => {
        alive = false;
        flashLoopActiveRef.current = false;
        cancelAnimationFrame(raf);
      },
    };
  }, []);

  syncFlashLoopRef.current = syncFlashLoop;

  useEffect(() => {
    drawDataRef.current.land = land;
    drawDataRef.current.loadError = loadError;
    drawDataRef.current.cities = cities;
    baseCacheRef.current = null;
    syncFlashLoop();
    scheduleDraw();
  }, [land, loadError, cities, syncFlashLoop, scheduleDraw]);

  const syncLayoutSnapshot = useCallback((width: number, height: number) => {
    const layout = makeLayout(width, height);
    layoutRef.current = layout;
    setLayoutSnapshot((prev) =>
      prev?.width === layout.width && prev?.height === layout.height ? prev : layout,
    );
  }, []);

  useEffect(() => {
    scheduleDraw();
    return () => {
      flashLoopRef.current?.stop();
      flashLoopRef.current = null;
      if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
    };
  }, [scheduleDraw]);

  const pickCityAt = useCallback(
    (mx: number, my: number) => {
      const layout = layoutRef.current;
      if (!layout) return null;
      return nearestCity(cities, layout, mx, my, viewRef.current);
    },
    [cities],
  );

  const setMapView = useCallback(
    (next: MapView) => {
      const layout = layoutRef.current;
      const clamped = layout ? clampMapView(next, layout) : clampMapView(next, makeLayout(1, 1));
      viewRef.current = clamped;
      setZoom(clamped.zoom);
      baseCacheRef.current = null;
      writeStoredMapView(panelId, clamped, layout);
      scheduleDraw();
    },
    [scheduleDraw, panelId],
  );

  const zoomBy = useCallback(
    (dir: 1 | -1) => {
      const cur = viewRef.current;
      setMapView({ ...cur, zoom: snapMapZoom(cur.zoom + dir * MAP_ZOOM_STEP) });
    },
    [setMapView],
  );

  const setHoveredCity = useCallback(
    (hit: MapCity | null, mx: number, my: number) => {
      const slug = hit?.slug ?? null;
      let extra = '';
      if (hit) {
        const data = drawDataRef.current;
        const parts: string[] = [];
        const maxBid = data.cityMaxBid.get(hit.slug);
        if (maxBid != null && maxBid > 0) parts.push(`bid ${(maxBid * 100).toFixed(1)}¢`);
        const maxSpread = data.cityMaxSpread.get(hit.slug);
        if (maxSpread != null && maxSpread > SPREAD_FLASH_AT) {
          parts.push(`spread ${(maxSpread * 100).toFixed(1)}¢`);
        }
        const misMid = data.cityMispriced.get(hit.slug);
        if (misMid != null && misMid > 0) {
          parts.push(`mis ${(misMid * 100).toFixed(1)}¢`);
          const fc = forecastHighByCityRef.current.get(hit.slug);
          if (fc != null) parts.push(`fc ${fc.toFixed(1)}°C`);
        }
        const exposure = data.cityExposure.get(hit.slug);
        if (exposure?.kind === 'order') parts.push('order');
        else if (exposure?.kind === 'position') parts.push(`pos ${exposure.tier}`);
        if (parts.length) extra = ` · ${parts.join(' · ')}`;
      }
      const nextTip = hit ? { x: mx, y: my, label: `${hit.label}${extra}` } : null;
      const prevTip = hoverTipRef.current;
      const slugChanged = hoverSlugRef.current !== slug;

      if (!slugChanged && nextTip && prevTip) {
        if (
          prevTip.label === nextTip.label &&
          Math.hypot(prevTip.x - nextTip.x, prevTip.y - nextTip.y) < 3
        ) {
          return;
        }
        hoverTipRef.current = nextTip;
        updateHoverTooltip(tipElRef.current, nextTip);
        return;
      }

      hoverSlugRef.current = slug;
      hoverTipRef.current = nextTip;
      updateHoverTooltip(tipElRef.current, nextTip);
      if (slugChanged) scheduleDraw();
    },
    [scheduleDraw],
  );

  const selectCity = useCallback(
    (slug: WeatherCitySlug) => {
      selectedSlugRef.current = slug;
      scheduleDraw();
      selectTempOddsCity(slug, { linkSidebar: true });
    },
    [scheduleDraw],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onResize = () => {
      nightOverlayCache = null;
      baseCacheRef.current = null;
      syncLayoutSnapshot(el.clientWidth, el.clientHeight);
      scheduleDraw();
    };

    onResize();
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scheduleDraw, syncLayoutSnapshot]);

  useEffect(
    () =>
      onTempOddsCitySelect(({ city }) => {
        if (selectedSlugRef.current === city) return;
        selectedSlugRef.current = city;
        scheduleDraw();
      }),
    [scheduleDraw],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      if (viewRef.current.zoom <= MAP_ZOOM_MIN + 1e-6) return;
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originPanX: viewRef.current.panX,
        originPanY: viewRef.current.panY,
        moved: false,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragging(true);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const drag = dragRef.current;
      if (drag && drag.pointerId === e.pointerId) {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) > 3) drag.moved = true;
        const layout = layoutRef.current;
        const next = {
          zoom: viewRef.current.zoom,
          panX: drag.originPanX + dx,
          panY: drag.originPanY + dy,
        };
        viewRef.current = layout ? clampMapView(next, layout) : next;
        baseCacheRef.current = null;
        scheduleDraw();
        if (hoverSlugRef.current || hoverTipRef.current) {
          hoverSlugRef.current = null;
          hoverTipRef.current = null;
          updateHoverTooltip(tipElRef.current, null);
        }
        return;
      }

      setHoveredCity(pickCityAt(mx, my), mx, my);
    },
    [pickCityAt, setHoveredCity, scheduleDraw],
  );

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (drag.moved) suppressClickRef.current = true;
      dragRef.current = null;
      setDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      setZoom(viewRef.current.zoom);
      if (drag.moved) writeStoredMapView(panelId, viewRef.current, layoutRef.current);
    },
    [panelId],
  );

  const onPointerLeave = useCallback(() => {
    if (dragRef.current) return;
    if (!hoverSlugRef.current && !hoverTipRef.current) return;
    hoverSlugRef.current = null;
    hoverTipRef.current = null;
    updateHoverTooltip(tipElRef.current, null);
    scheduleDraw();
  }, [scheduleDraw]);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = pickCityAt(mx, my);
      if (!hit) return;
      selectCity(hit.slug);
    },
    [pickCityAt, selectCity],
  );

  const now = new Date(drawDataRef.current.nowMs);

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-2 h-full flex flex-col min-h-0">
      <div className="panel-header mb-1 flex shrink-0 cursor-grab items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-gray-500">Weather Map</span>
        <div className="no-drag inline-flex items-center gap-0.5 rounded-md bg-gray-900 border border-gray-700 p-0.5">
          <button
            type="button"
            title="Zoom out"
            disabled={zoom <= MAP_ZOOM_MIN + 1e-6}
            onClick={() => zoomBy(-1)}
            className="rounded-sm p-0.5 text-gray-300 hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Minus size={12} strokeWidth={2.5} />
          </button>
          <span className="min-w-[2.25rem] text-center text-[9px] tabular-nums text-gray-400">
            {zoom.toFixed(2)}×
          </span>
          <button
            type="button"
            title="Zoom in"
            disabled={zoom >= MAP_ZOOM_MAX - 1e-6}
            onClick={() => zoomBy(1)}
            className="rounded-sm p-0.5 text-gray-300 hover:bg-gray-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Plus size={12} strokeWidth={2.5} />
          </button>
        </div>
        <span className="text-[10px] text-gray-500">
          fill=certainty · ring=state · flash purple=spread · turquoise=mispriced
          {zoom > 1 ? ' · drag to pan' : ''}
        </span>
      </div>
      <div ref={containerRef} className="no-drag relative min-h-0 flex-1">
        {layoutSnapshot ? (
          <div
            ref={meridianStripRef}
            className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-4 border-b border-amber-500/20 bg-gray-950/90"
          >
            {meridians.map((lon) => (
              <div
                key={lon}
                data-tz-lon={lon}
                className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[7px] leading-4 tabular-nums text-amber-200/90"
                style={{ left: `${lonBandCenterPercent(lon, layoutSnapshot)}%` }}
                title={`${utcOffsetLabel(lon)} · solar ${String(solarHourAtLongitude(lon + TZ_LON_STEP / 2, now)).padStart(2, '0')}:00`}
              >
                {String(solarHourAtLongitude(lon + TZ_LON_STEP / 2, now)).padStart(2, '0')}
              </div>
            ))}
          </div>
        ) : null}
        <canvas
          ref={canvasRef}
          className="pointer-events-none block h-full w-full rounded border border-gray-700/80"
        />
        <div
          className={`absolute inset-0 z-[2] ${
            dragging ? 'cursor-grabbing' : zoom > 1 ? 'cursor-grab' : 'cursor-crosshair'
          }`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onPointerLeave={onPointerLeave}
          onClick={onClick}
        />
        <div
          ref={tipElRef}
          className="pointer-events-none absolute z-10 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-gray-600 bg-gray-900/95 px-1.5 py-0.5 text-[10px] text-gray-100 shadow-md"
        />
      </div>
    </div>
  );
}

export const WeatherMapPanel = memo(WeatherMapPanelInner);
