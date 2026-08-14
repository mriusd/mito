/**
 * Up/Down Target strike via polycandles /api/crypto-price.
 *
 * For 5m/15m the backend prefers TWAP-60 at market-window open (local capture),
 * then Polymarket crypto-price open — same source polycandles uses for priceToBeat /
 * mitobot K. Window start must match the event-slug unix suffix (not endDate−TF).
 */

export function upDownCryptoTimeframe(combined: string): '5m' | '15m' | '1h' | '4h' | '24h' | null {
  if (combined.match(/updown-5m/i) || combined.match(/\b5[- ]?min/i)) return '5m';
  if (combined.match(/updown-15m/i) || combined.match(/\b15[- ]?min/i)) return '15m';
  if (combined.match(/updown-4h/i) || combined.match(/\b4[- ]?h/i)) return '4h';
  if (combined.match(/up-or-down-on-/i) || combined.match(/\b24[- ]?h/i)) return '24h';
  return '1h';
}

/**
 * Unix window start from event slug suffix (e.g. btc-updown-5m-1774353300).
 * Same rules as polycandles extractEventStartUnix — not endDate−duration.
 */
export function extractEventStartUnixFromSlug(slug: string | null | undefined): number | null {
  const s = String(slug || '').trim();
  if (!s) return null;
  const i = s.lastIndexOf('-');
  if (i < 0 || i + 1 >= s.length) return null;
  const suffix = s.slice(i + 1);
  // Reject short year suffixes like "...-2026"
  if (suffix.length < 10 || !/^\d+$/.test(suffix)) return null;
  const ts = Number(suffix);
  if (!Number.isFinite(ts) || ts < 946684800) return null;
  const nowSec = Date.now() / 1000;
  if (ts > nowSec + 2 * 365 * 24 * 3600) return null;
  return ts;
}

export async function fetchUpDownTargetFromCrypto(
  apiBase: string,
  asset: string,
  endMs: number,
  combined: string,
  eventSlug?: string | null,
): Promise<number | null> {
  const tf = upDownCryptoTimeframe(combined);
  if (!tf) return null;

  let variant = 'hourly';
  let intervalMs = 60 * 60 * 1000;
  if (tf === '5m') {
    variant = 'fiveminute';
    intervalMs = 5 * 60 * 1000;
  } else if (tf === '15m') {
    variant = 'fifteen';
    intervalMs = 15 * 60 * 1000;
  } else if (tf === '4h') {
    variant = 'hourly';
    intervalMs = 4 * 60 * 60 * 1000;
  } else if (tf === '24h') {
    variant = 'daily';
    intervalMs = 24 * 60 * 60 * 1000;
  }

  // Prefer slug unix (matches polycandles TWAP-open key + bot priceToBeat). Fall back to end−TF.
  const slugUnix = extractEventStartUnixFromSlug(eventSlug) ?? extractEventStartUnixFromSlug(combined);
  let startMs: number;
  let resolvedEndMs = endMs;
  if (slugUnix != null && (tf === '5m' || tf === '15m')) {
    startMs = slugUnix * 1000;
    // Keep window length consistent with TF when endDate is slightly off slug+duration.
    resolvedEndMs = startMs + intervalMs;
  } else {
    startMs = endMs - intervalMs;
  }

  const startISO = new Date(startMs).toISOString();
  const endISO = new Date(resolvedEndMs).toISOString();
  const q = (s: string) => encodeURIComponent(s);
  const url = (v: string, s: string, e: string) =>
    `${apiBase}/api/crypto-price?symbol=${asset}&eventStartTime=${q(s)}&variant=${v}&endDate=${q(e)}`;

  const parse = async (r: Response): Promise<number | null> => {
    if (!r.ok) return null;
    try {
      const d = (await r.json()) as { openPrice?: number };
      const op = d?.openPrice;
      return typeof op === 'number' && op > 0 && Number.isFinite(op) ? op : null;
    } catch {
      return null;
    }
  };

  const fetchOpen = async (v: string, s: string, e: string): Promise<number | null> => {
    try {
      return await parse(await fetch(url(v, s, e)));
    } catch {
      return null;
    }
  };

  let p = await fetchOpen(variant, startISO, endISO);
  if (p != null) return p;

  const fiveEndMs = Math.min(startMs + 5 * 60 * 1000, resolvedEndMs);
  p = await fetchOpen('fiveminute', startISO, new Date(fiveEndMs).toISOString());
  return p;
}
