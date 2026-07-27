import type { Plugin } from 'vite';

const AW_METAR = 'https://aviationweather.gov/api/data/metar';

const F_CITY_SLUGS = new Set([
  'atlanta',
  'austin',
  'chicago',
  'dallas',
  'denver',
  'houston',
  'los-angeles',
  'miami',
  'nyc',
  'san-francisco',
  'seattle',
]);

const CITY_ICAO: Record<string, string> = {
  amsterdam: 'EHAM',
  ankara: 'LTAC',
  atlanta: 'KATL',
  austin: 'KAUS',
  beijing: 'ZBAA',
  'buenos-aires': 'SAEZ',
  busan: 'RKPK',
  'cape-town': 'FACT',
  chengdu: 'ZUUU',
  chicago: 'KORD',
  chongqing: 'ZUCK',
  dallas: 'KDAL',
  denver: 'KBKF',
  guangzhou: 'ZGGG',
  helsinki: 'EFHK',
  'hong-kong': 'VHHH',
  houston: 'KHOU',
  istanbul: 'LTFM',
  jeddah: 'OEJN',
  karachi: 'OPKC',
  'kuala-lumpur': 'WMKK',
  london: 'EGLC',
  'los-angeles': 'KLAX',
  lucknow: 'VILK',
  madrid: 'LEMD',
  manila: 'RPLL',
  'mexico-city': 'MMMX',
  miami: 'KMIA',
  milan: 'LIMC',
  moscow: 'UUWW',
  munich: 'EDDM',
  nyc: 'KLGA',
  'panama-city': 'MPMG',
  paris: 'LFPB',
  qingdao: 'ZSQD',
  'san-francisco': 'KSFO',
  'sao-paulo': 'SBGR',
  seattle: 'KSEA',
  seoul: 'RKSI',
  shanghai: 'ZSPD',
  shenzhen: 'ZGSZ',
  singapore: 'WSSS',
  taipei: 'RCSS',
  'tel-aviv': 'LLBG',
  tokyo: 'RJTT',
  toronto: 'CYYZ',
  warsaw: 'EPWA',
  wellington: 'NZWN',
  wuhan: 'ZHHH',
};

type MetarRow = {
  icaoId?: string;
  name?: string;
  reportTime?: string;
  obsTime?: number;
  temp?: number;
  dewp?: number;
  wdir?: number | string;
  wspd?: number;
  visib?: number;
  altim?: number;
  cover?: string;
  fltCat?: string;
  clouds?: { cover?: string; base?: number }[];
  rawOb?: string;
};

function cToF(c: number): number {
  return (c * 9) / 5 + 32;
}

function parseWdir(wdir: MetarRow['wdir']): number | undefined {
  if (wdir == null) return undefined;
  if (typeof wdir === 'number' && Number.isFinite(wdir)) return wdir;
  const s = String(wdir).trim().toUpperCase();
  if (!s || s === 'VRB') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function pickLatest(rows: MetarRow[]): MetarRow | null {
  let best: MetarRow | null = null;
  let bestSec = 0;
  for (const r of rows) {
    if (r.temp == null || r.obsTime == null) continue;
    if (!best || r.obsTime >= bestSec) {
      best = r;
      bestSec = r.obsTime;
    }
  }
  return best;
}

function toDetail(city: string, icao: string, r: MetarRow) {
  const useF = F_CITY_SLUGS.has(city);
  const tempC = r.temp!;
  const dewpC = r.dewp;
  const temp = useF ? cToF(tempC) : tempC;
  const dewp = dewpC != null ? (useF ? cToF(dewpC) : dewpC) : undefined;
  return {
    city,
    icao,
    name: r.name?.trim() || undefined,
    reportTime: r.reportTime?.trim() || undefined,
    obsTimeMs: (r.obsTime ?? 0) * 1000,
    temp,
    obsTempUnit: useF ? 'F' : 'C',
    dewp,
    wdirDeg: parseWdir(r.wdir),
    wspdKt: r.wspd,
    visibSm: r.visib,
    altimMb: r.altim,
    skyCover: r.cover?.trim() || undefined,
    fltCat: r.fltCat?.trim() || undefined,
    clouds: (r.clouds ?? [])
      .filter((c) => c.cover?.trim() || (c.base ?? 0) > 0)
      .map((c) => ({ cover: c.cover?.trim() ?? '', baseFt: c.base ?? 0 })),
    rawOb: r.rawOb?.trim() ?? '',
  };
}

/** Dev-only: serve /api/weather-metar/{city} when polycandles lacks the route. */
export function weatherMetarDevPlugin(): Plugin {
  return {
    name: 'weather-metar-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        const m = url.match(/^\/api\/weather-metar\/([^/?]+)/);
        if (!m || req.method !== 'GET') {
          next();
          return;
        }
        const city = decodeURIComponent(m[1]).trim().toLowerCase();
        const icao = CITY_ICAO[city];
        if (!icao) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'text/plain');
          res.end('invalid city');
          return;
        }
        try {
          const awUrl = `${AW_METAR}?ids=${encodeURIComponent(icao)}&hours=0&sep=true&format=json`;
          const aw = await fetch(awUrl, { headers: { 'User-Agent': 'polybot-react-dev/1.0' } });
          if (!aw.ok) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'text/plain');
            res.end('metar unavailable');
            return;
          }
          const rows = (await aw.json()) as MetarRow[];
          const latest = pickLatest(Array.isArray(rows) ? rows : []);
          if (!latest) {
            res.statusCode = 502;
            res.setHeader('Content-Type', 'text/plain');
            res.end('metar unavailable');
            return;
          }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(toDetail(city, icao, latest)));
        } catch {
          res.statusCode = 502;
          res.setHeader('Content-Type', 'text/plain');
          res.end('metar unavailable');
        }
      });
    },
  };
}
