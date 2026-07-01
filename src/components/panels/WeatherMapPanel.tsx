import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { WEATHER_CITIES, type WeatherCitySlug } from '../../lib/weatherCities';
import { WEATHER_CITY_COORDS } from '../../lib/weatherCityCoords';
import { selectTempOddsCity } from '../../lib/weatherTempOddsControl';

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
};

const LAND_GEOJSON_URL = `${import.meta.env.BASE_URL}ne_110m_land.geojson`;
const DOT_RADIUS = 4;
const HIT_RADIUS = 10;

let landGeoJsonPromise: Promise<LandGeoJSON> | null = null;

function loadLandGeoJSON(): Promise<LandGeoJSON> {
  if (!landGeoJsonPromise) {
    landGeoJsonPromise = fetch(LAND_GEOJSON_URL).then((r) => {
      if (!r.ok) throw new Error(`land geojson ${r.status}`);
      return r.json() as Promise<LandGeoJSON>;
    });
  }
  return landGeoJsonPromise;
}

function projectLonLat(lon: number, lat: number, layout: MapLayout) {
  return {
    x: layout.pad + ((lon + 180) / 360) * layout.w,
    y: layout.pad + ((90 - lat) / 180) * layout.h,
  };
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

function nearestCity(
  cities: MapCity[],
  layout: MapLayout,
  mx: number,
  my: number,
): MapCity | null {
  let best: MapCity | null = null;
  let bestD = HIT_RADIUS;
  for (const city of cities) {
    const { x, y } = projectLonLat(city.lon, city.lat, layout);
    const d = Math.hypot(mx - x, my - y);
    if (d <= bestD) {
      best = city;
      bestD = d;
    }
  }
  return best;
}

function WeatherMapPanelInner({ panelId: _panelId }: { panelId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const layoutRef = useRef<MapLayout | null>(null);
  const hoverSlugRef = useRef<WeatherCitySlug | null>(null);
  const [land, setLand] = useState<LandGeoJSON | null>(null);
  const [loadError, setLoadError] = useState('');
  const [drawTick, setDrawTick] = useState(0);
  const [hoverTip, setHoverTip] = useState<{ x: number; y: number; label: string } | null>(null);
  const bumpDraw = useCallback(() => setDrawTick((n) => n + 1), []);

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

    const pad = 6;
    const layout: MapLayout = {
      pad,
      w: width - pad * 2,
      h: height - pad * 2,
      width,
      height,
    };
    layoutRef.current = layout;

    ctx.fillStyle = '#0b1018';
    ctx.fillRect(0, 0, width, height);

    if (land) {
      drawLand(ctx, land, layout);
    }

    const hoverSlug = hoverSlugRef.current;
    for (const city of cities) {
      const { x, y } = projectLonLat(city.lon, city.lat, layout);
      const active = hoverSlug === city.slug;
      ctx.beginPath();
      ctx.arc(x, y, active ? DOT_RADIUS + 1.5 : DOT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#fde047' : '#facc15';
      ctx.fill();
      if (active) {
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
  }, [cities, land, loadError]);

  useLayoutEffect(() => {
    draw();
  }, [draw, drawTick]);

  useEffect(() => {
    const ro = new ResizeObserver(() => bumpDraw());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [bumpDraw]);

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const layout = layoutRef.current;
      if (!layout) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = nearestCity(cities, layout, mx, my);
      const slug = hit?.slug ?? null;
      if (hoverSlugRef.current === slug) {
        if (hit) setHoverTip({ x: mx, y: my, label: hit.label });
        else setHoverTip(null);
        return;
      }
      hoverSlugRef.current = slug;
      setHoverTip(hit ? { x: mx, y: my, label: hit.label } : null);
      bumpDraw();
    },
    [bumpDraw, cities],
  );

  const onPointerLeave = useCallback(() => {
    if (!hoverSlugRef.current) return;
    hoverSlugRef.current = null;
    setHoverTip(null);
    bumpDraw();
  }, [bumpDraw]);

  const onClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const layout = layoutRef.current;
      if (!layout) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const hit = nearestCity(cities, layout, mx, my);
      if (!hit) return;
      selectTempOddsCity(hit.slug, { linkSidebar: true });
    },
    [cities],
  );

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-2 h-full flex flex-col min-h-0">
      <div className="panel-header mb-1 flex shrink-0 cursor-grab items-center gap-2">
        <span className="text-xs font-bold text-gray-500">Weather Map</span>
        <span className="text-[10px] text-gray-500">click city → Temp Odds</span>
      </div>
      <div
        ref={containerRef}
        className="no-drag relative min-h-0 flex-1 cursor-crosshair"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onClick={onClick}
      >
        <canvas ref={canvasRef} className="block h-full w-full rounded border border-gray-700/80" />
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
