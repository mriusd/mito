export function formatMarketCountdown(
  endDate: string | undefined,
  nowMs: number,
): { text: string; remaining: number } {
  const raw = String(endDate || '').trim();
  if (!raw) return { text: '', remaining: Infinity };
  const endMs = new Date(raw).getTime();
  if (!Number.isFinite(endMs)) return { text: '', remaining: Infinity };
  const remaining = endMs - nowMs;
  if (remaining <= 0) return { text: 'Expired', remaining: 0 };
  const d = Math.floor(remaining / 86400000);
  const h = Math.floor((remaining % 86400000) / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  if (d === 0) parts.push(`${s}s`);
  return { text: parts.join(' '), remaining };
}
