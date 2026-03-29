/**
 * Polymarket /api/crypto/crypto-price often omits hourly (and similar) openPrice for the first ~5 minutes
 * of a window. The fiveminute variant for [windowStart, windowStart+5m] returns the same open sooner.
 */

export function upDownCryptoTimeframe(combined: string): '15m' | '1h' | '24h' | null {
  if (combined.match(/updown-5m/i) || combined.match(/\b5[- ]?min/i)) return null;
  if (combined.match(/updown-15m/i) || combined.match(/\b15[- ]?min/i)) return '15m';
  if (combined.match(/up-or-down-on-/i) || combined.match(/\b24[- ]?h/i)) return '24h';
  return '1h';
}

export async function fetchUpDownTargetFromCrypto(
  apiBase: string,
  asset: string,
  endMs: number,
  combined: string,
): Promise<number | null> {
  const tf = upDownCryptoTimeframe(combined);
  if (!tf) return null;

  let variant = 'hourly';
  let intervalMs = 60 * 60 * 1000;
  if (tf === '15m') {
    variant = 'fifteen';
    intervalMs = 15 * 60 * 1000;
  } else if (tf === '24h') {
    variant = 'daily';
    intervalMs = 24 * 60 * 60 * 1000;
  }

  const startMs = endMs - intervalMs;
  const startISO = new Date(startMs).toISOString();
  const endISO = new Date(endMs).toISOString();
  const q = (s: string) => encodeURIComponent(s);
  const url = (v: string, s: string, e: string) =>
    `${apiBase}/api/polyproxy/site/api/crypto/crypto-price?symbol=${asset}&eventStartTime=${q(s)}&variant=${v}&endDate=${q(e)}`;

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

  let p = await parse(await fetch(url(variant, startISO, endISO)));
  if (p != null) return p;

  const fiveEndMs = Math.min(startMs + 5 * 60 * 1000, endMs);
  p = await parse(await fetch(url('fiveminute', startISO, new Date(fiveEndMs).toISOString())));
  return p;
}
