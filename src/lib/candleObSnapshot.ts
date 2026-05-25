export type CandleObLevel = { p: string; s: string };

export type CandleObSnapshot = {
  ts: number;
  h?: string;
  bids: CandleObLevel[];
  asks: CandleObLevel[];
};

export type OBEntry = { price: string; size: string };

export function parseCandleOb(raw: unknown): CandleObSnapshot | undefined {
  if (raw == null || raw === '') return undefined;
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  if (!Array.isArray(o.bids) || !Array.isArray(o.asks)) return undefined;
  const level = (x: unknown): CandleObLevel | null => {
    if (!x || typeof x !== 'object') return null;
    const row = x as Record<string, unknown>;
    const p = String(row.p ?? '').trim();
    const s = String(row.s ?? '').trim();
    if (!p || !s) return null;
    return { p, s };
  };
  const bids = o.bids.map(level).filter((x): x is CandleObLevel => x != null);
  const asks = o.asks.map(level).filter((x): x is CandleObLevel => x != null);
  if (bids.length === 0 && asks.length === 0) return undefined;
  return {
    ts: Number(o.ts) || 0,
    h: typeof o.h === 'string' ? o.h : undefined,
    bids,
    asks,
  };
}

export function candleObToSortedEntries(ob: CandleObSnapshot): { bids: OBEntry[]; asks: OBEntry[] } {
  const bids = ob.bids
    .map((l) => ({ price: l.p, size: l.s }))
    .sort((a, b) => parseFloat(b.price) - parseFloat(a.price))
    .slice(0, 20);
  const asks = ob.asks
    .map((l) => ({ price: l.p, size: l.s }))
    .sort((a, b) => parseFloat(a.price) - parseFloat(b.price))
    .slice(0, 20);
  return { bids, asks };
}
