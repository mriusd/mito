import { geoGraticule, geoPath, geoEquirectangular } from 'd3-geo';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { WEATHER_CITIES, type WeatherCitySlug } from '../../lib/weatherCities';
import { WEATHER_CITY_COORDS } from '../../lib/weatherCityCoords';
import {
  isNightAt,
  solarHourAtLongitude,
  subsolarPoint,
  utcOffsetLabel,
} from '../../lib/weatherMapSun';
import { useMarketLookupSnapshot } from '../../hooks/useMarketLookupSnapshot';
import { onTempOddsCitySelect, onTempOddsDateSelect, onTempOddsMetricSelect, getTempOddsSelectedDate, getTempOddsSelectedMetric, selectTempOddsCity } from '../../lib/weatherTempOddsControl';
import {
  buildWeatherCityExposureByDate,
  buildWeatherCityMaxBidByDate,
  weatherMapQuoteTokenIdsForDate,
  type WeatherCityExposure,
} from '../../lib/weatherMapExposure';
import { useThrottledGridOrders, useThrottledGridPositions } from '../../hooks/useThrottledGridWallet';
import { useSidebarOnchainGridWalletPositions } from '../../lib/sidebarOnchainTradesStore';
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

type WeatherMapColorMode = 'state' | 'certainty';

const WEATHER_MAP_COLOR_MODE_LS = 'polybot-weather-map-color-mode';

/** Old: position PnL tier / open order / none. */
function cityDotFillByState(
  exposure: WeatherCityExposure | undefined,
  hovered: boolean,
  selected: boolean,
): string {
  if (!exposure || exposure.kind === 'none') {
    return selected || hovered ? '#e5e7eb' : '#ffffff';
  }
  if (exposure.kind === 'order') {
    return selected || hovered ? '#c084fc' : '#a855f7';
  }
  const tier = exposure.tier;
  if (tier === 'green') return selected || hovered ? '#4ade80' : '#22c55e';
  if (tier === 'red') return selected || hovered ? '#f87171' : '#ef4444';
  return selected || hovered ? '#fde047' : '#eab308';
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

function nearestCity(
  cities: MapCity[],
  layout: MapLayout,
  mx: number,
  my: number,
): MapCity | null {
  let best: MapCity | null = null;
  let bestD = Infinity;
  for (const city of cities) {
    const { x, y } = projectLonLat(city.lon, city.lat, layout);
    const d = Math.hypot(mx - x, my - y);
    if (d <= HIT_RADIUS && d < bestD) {
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

function WeatherMapPanelInner({ panelId: _panelId }: { panelId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<MapLayout | null>(null);
  const hoverSlugRef = useRef<WeatherCitySlug | null>(null);
  const selectedSlugRef = useRef<WeatherCitySlug | null>(null);
  const hoverTipRef = useRef<{ x: number; y: number; label: string } | null>(null);
  const drawRef = useRef<() => void>(() => {});
  const drawRafRef = useRef(0);
  const [land, setLand] = useState<LandGeoJSON | null>(null);
  const [loadError, setLoadError] = useState('');
  const [hoverTip, setHoverTip] = useState<{ x: number; y: number; label: string } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [layoutSnapshot, setLayoutSnapshot] = useState<MapLayout | null>(null);

  const [tempOddsDateIso, setTempOddsDateIso] = useState<string | null>(() => getTempOddsSelectedDate());
  const [tempOddsMetric, setTempOddsMetric] = useState(() => getTempOddsSelectedMetric());
  const [colorMode, setColorMode] = useState<WeatherMapColorMode>(() => {
    const v = localStorage.getItem(WEATHER_MAP_COLOR_MODE_LS);
    return v === 'certainty' ? 'certainty' : 'state';
  });
  const colorModeRef = useRef(colorMode);
  colorModeRef.current = colorMode;
  const weatherMarkets = useAppStore((s) => s.weatherMarkets);
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const progOrderMap = useAppStore((s) => s.progOrderMap);
  const marketLookup = useMarketLookupSnapshot();
  const positions = useThrottledGridPositions(2000);
  const orders = useThrottledGridOrders(2000);
  const onchainWsPositions = useSidebarOnchainGridWalletPositions();

  const cityExposure = useMemo(() => {
    const myOrders = orders.filter((o) => !progOrderMap[o.id]);
    return buildWeatherCityExposureByDate(
      weatherMarkets,
      tempOddsDateIso,
      positions,
      myOrders,
      liveTradesSource,
      onchainWsPositions,
      marketLookup,
      tempOddsMetric,
    );
  }, [weatherMarkets, tempOddsDateIso, tempOddsMetric, positions, orders, progOrderMap, liveTradesSource, onchainWsPositions, marketLookup]);

  const quoteTokenIds = useMemo(
    () => weatherMapQuoteTokenIdsForDate(weatherMarkets, tempOddsDateIso, tempOddsMetric),
    [weatherMarkets, tempOddsDateIso, tempOddsMetric],
  );

  const [quoteTick, setQuoteTick] = useState(0);
  useEffect(() => {
    setChartBidAskExtraTokens('weather-map', quoteTokenIds);
    return () => setChartBidAskExtraTokens('weather-map', []);
  }, [quoteTokenIds]);
  useEffect(() => subscribeBidAskMarketLookupGridFlush(() => setQuoteTick((n) => n + 1)), []);

  const cityMaxBid = useMemo(() => {
    const liveLookup: Record<string, Market> = { ...marketLookup };
    for (const tid of quoteTokenIds) {
      const row = getBidAskMarketRow(tid);
      if (row) liveLookup[tid] = row;
    }
    return buildWeatherCityMaxBidByDate(weatherMarkets, tempOddsDateIso, liveLookup, tempOddsMetric);
    // quoteTick forces recompute when bid/ask flush
    // eslint-disable-next-line react-hooks/exhaustive-deps -- quoteTick is the live pulse
  }, [weatherMarkets, tempOddsDateIso, tempOddsMetric, marketLookup, quoteTokenIds, quoteTick]);

  useEffect(() => onTempOddsDateSelect(setTempOddsDateIso), []);
  useEffect(() => onTempOddsMetricSelect(setTempOddsMetric), []);

  const meridians = useMemo(() => buildTimezoneMeridians(), []);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
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
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const layout = makeLayout(width, height);
    layoutRef.current = layout;

    const date = new Date(nowMs);

    ctx.fillStyle = '#0c4a6e';
    ctx.fillRect(layout.pad, layout.mapTop, layout.w, layout.h);

    if (land) {
      drawLand(ctx, land, layout);
    }

    drawNightOverlay(ctx, layout, date);
    drawDayGlow(ctx, layout, date);

    drawGraticule(ctx, layout);
    drawTimezoneMeridians(ctx, layout);

    const hoverSlug = hoverSlugRef.current;
    const selectedSlug = selectedSlugRef.current;
    const mode = colorModeRef.current;
    for (const city of cities) {
      const { x, y } = projectLonLat(city.lon, city.lat, layout);
      const hovered = hoverSlug === city.slug;
      const selected = selectedSlug === city.slug;
      const maxBid = cityMaxBid.get(city.slug);
      const exposure = cityExposure.get(city.slug);
      const r = selected ? DOT_RADIUS + 2 : hovered ? DOT_RADIUS + 1.5 : DOT_RADIUS;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle =
        mode === 'certainty'
          ? cityDotFillByMaxBid(maxBid, hovered, selected)
          : cityDotFillByState(exposure, hovered, selected);
      ctx.fill();
      if (selected) {
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (hovered) {
        ctx.beginPath();
        ctx.arc(x, y, r + 2, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    if (loadError && !land) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.font = '11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Map load failed', width / 2, height / 2);
    }
  }, [cities, land, loadError, nowMs, cityMaxBid, cityExposure, colorMode]);

  drawRef.current = draw;

  const scheduleDraw = useCallback(() => {
    if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
    drawRafRef.current = requestAnimationFrame(() => {
      drawRafRef.current = 0;
      drawRef.current();
    });
  }, []);

  const syncLayoutSnapshot = useCallback((width: number, height: number) => {
    const layout = makeLayout(width, height);
    layoutRef.current = layout;
    setLayoutSnapshot((prev) =>
      prev?.width === layout.width && prev?.height === layout.height ? prev : layout,
    );
  }, []);

  useLayoutEffect(() => {
    scheduleDraw();
  }, [draw, scheduleDraw]);

  useEffect(() => {
    scheduleDraw();
  }, [land, loadError, nowMs, scheduleDraw]);

  useEffect(() => {
    return () => {
      if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
    };
  }, []);

  const pickCityAt = useCallback(
    (mx: number, my: number) => {
      const layout = layoutRef.current;
      if (!layout) return null;
      return nearestCity(cities, layout, mx, my);
    },
    [cities],
  );

  const setHoveredCity = useCallback(
    (hit: MapCity | null, mx: number, my: number) => {
      const slug = hit?.slug ?? null;
      const maxBid = hit ? cityMaxBid.get(hit.slug) : undefined;
      const bidLbl =
        maxBid != null && maxBid > 0 ? ` · max bid ${(maxBid * 100).toFixed(1)}¢` : '';
      const nextTip = hit ? { x: mx, y: my, label: `${hit.label}${bidLbl}` } : null;
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
        setHoverTip(nextTip);
        return;
      }

      hoverSlugRef.current = slug;
      hoverTipRef.current = nextTip;
      setHoverTip(nextTip);
      if (slugChanged) scheduleDraw();
    },
    [scheduleDraw, cityMaxBid],
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

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setHoveredCity(pickCityAt(mx, my), mx, my);
    },
    [pickCityAt, setHoveredCity],
  );

  const onPointerLeave = useCallback(() => {
    if (!hoverSlugRef.current && !hoverTipRef.current) return;
    hoverSlugRef.current = null;
    hoverTipRef.current = null;
    setHoverTip(null);
    scheduleDraw();
  }, [scheduleDraw]);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
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

  const now = new Date(nowMs);

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-2 h-full flex flex-col min-h-0">
      <div className="panel-header mb-1 flex shrink-0 cursor-grab items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-gray-500">Weather Map</span>
        <div className="no-drag inline-flex items-center gap-0.5 rounded-md bg-gray-900 border border-gray-700 p-0.5 text-[9px]">
          {([
            { id: 'state' as const, label: 'State', title: 'Position PnL / open order' },
            { id: 'certainty' as const, label: 'Certainty', title: 'Max bid across buckets (red→green)' },
          ]).map(({ id, label, title }) => (
            <button
              key={id}
              type="button"
              title={title}
              onClick={() => {
                setColorMode(id);
                localStorage.setItem(WEATHER_MAP_COLOR_MODE_LS, id);
              }}
              className={
                colorMode === id
                  ? 'px-2 py-0.5 rounded-sm font-semibold bg-gray-500 text-white'
                  : 'px-2 py-0.5 rounded-sm font-semibold text-gray-400 hover:text-white hover:bg-gray-700'
              }
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[10px] text-gray-500">
          click city → Temp Odds
          {colorMode === 'certainty'
            ? ' · max bid certainty (red→green)'
            : ' · pos=green/yellow/red · purple=order · white=none'}
        </span>
      </div>
      <div ref={containerRef} className="no-drag relative min-h-0 flex-1">
        {layoutSnapshot ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[1] h-4 border-b border-amber-500/20 bg-gray-950/90">
            {meridians.map((lon) => (
              <div
                key={lon}
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
          className="absolute inset-0 z-[2] cursor-crosshair"
          onPointerMove={onPointerMove}
          onPointerLeave={onPointerLeave}
          onClick={onClick}
        />
        {hoverTip ? (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded border border-gray-600 bg-gray-900/95 px-1.5 py-0.5 text-[10px] text-gray-100 shadow-md"
            style={{ left: hoverTip.x, top: hoverTip.y - 8 }}
          >
            {hoverTip.label}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export const WeatherMapPanel = memo(WeatherMapPanelInner);
