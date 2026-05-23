import { pitchMulFromNotifyFreqSlider, playNotifyBeep, readNotifySoundFreqSlider } from './tiltNotifySound';
import { isNotifySoundPriceMuted } from './notifySoundPriceMute';

export const SIDEBAR_NOTIFY_VOLUME_SPIKE_RING_KEY = 'polybot-sidebar-notify-volume-spike-ring';
/** Current open bar must reach this multiple of avg prior bar volume (sidebar flash + sound). */
export const CHART_VOLUME_SPIKE_MIN_RATIO = 5;
/** Minimum bars before volume spike ring plays. */
export const MIN_CHART_CANDLES_FOR_VOLUME_SPIKE_SOUND = 10;
/** Flash duration — keep in sync with buy/sell flash classes in index.css */
export const CHART_VOLUME_SPIKE_FLASH_MS = 600;

export type ChartVolumeSpikeSide = 'BUY' | 'SELL';

export type ChartVolumeSpike = {
  barTime: number;
  volume: number;
  avgPrevVolume: number;
  ratio: number;
  side: ChartVolumeSpikeSide;
};

type SpikeTradeRow = {
  side?: string | null;
  price?: string | number | null;
  size?: string | number | null;
  timestamp?: number | null;
};

/** Dominant taker notional in spike bar — falls back to candle direction. */
export function resolveChartVolumeSpikeSide(
  trades: readonly SpikeTradeRow[],
  barTime: number,
  candleMs: number,
  candle?: { o?: number; c?: number } | null,
): ChartVolumeSpikeSide {
  const end = barTime + candleMs;
  let buyUsd = 0;
  let sellUsd = 0;
  for (const t of trades) {
    const ts = Number(t.timestamp ?? 0);
    if (!Number.isFinite(ts) || ts < barTime || ts >= end) continue;
    const sz = parseFloat(String(t.size ?? ''));
    const pr = parseFloat(String(t.price ?? ''));
    if (!Number.isFinite(sz) || !Number.isFinite(pr) || sz <= 0 || pr <= 0) continue;
    const usd = sz * pr;
    const side = String(t.side ?? '').trim().toUpperCase();
    if (side === 'BUY') buyUsd += usd;
    else if (side === 'SELL') sellUsd += usd;
  }
  if (buyUsd > sellUsd) return 'BUY';
  if (sellUsd > buyUsd) return 'SELL';
  const o = candle?.o;
  const c = candle?.c;
  if (typeof o === 'number' && typeof c === 'number' && Number.isFinite(o) && Number.isFinite(c)) {
    return c >= o ? 'BUY' : 'SELL';
  }
  return 'BUY';
}

/** Current open bar only: volume ≥ CHART_VOLUME_SPIKE_MIN_RATIO × average of all prior bars. */
export function detectChartVolumeSpike(
  candles: readonly { time: number; v: number; o?: number; c?: number }[],
  candleMs: number,
  trades: readonly SpikeTradeRow[] = [],
  nowMs = Date.now(),
): ChartVolumeSpike | null {
  if (candles.length < 2 || !Number.isFinite(candleMs) || candleMs <= 0) return null;
  const sorted = [...candles].sort((a, b) => a.time - b.time);
  const latest = sorted[sorted.length - 1];
  if (!latest) return null;
  const currentBucket = Math.floor(nowMs / candleMs) * candleMs;
  if (latest.time !== currentBucket) return null;
  const prev = sorted.slice(0, -1);
  if (prev.length === 0) return null;
  const avgPrev = prev.reduce((s, c) => s + c.v, 0) / prev.length;
  if (!Number.isFinite(avgPrev) || avgPrev <= 0) return null;
  if (!Number.isFinite(latest.v) || latest.v <= 0) return null;
  if (latest.v < avgPrev * CHART_VOLUME_SPIKE_MIN_RATIO) return null;
  const side = resolveChartVolumeSpikeSide(trades, latest.time, candleMs, latest);
  return {
    barTime: latest.time,
    volume: latest.v,
    avgPrevVolume: avgPrev,
    ratio: latest.v / avgPrev,
    side,
  };
}

export function readNotifyVolumeSpikeRingEnabled(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_VOLUME_SPIKE_RING_KEY);
    if (v === '0') return false;
    return true;
  } catch {
    return true;
  }
}

export async function playChartVolumeSpikeRing(
  yesTokenId?: string | null,
  noTokenId?: string | null,
): Promise<void> {
  if (!readNotifyVolumeSpikeRingEnabled()) return;
  if (isNotifySoundPriceMuted(yesTokenId, noTokenId)) return;
  const mul = pitchMulFromNotifyFreqSlider(readNotifySoundFreqSlider());
  await playNotifyBeep(mul);
}
