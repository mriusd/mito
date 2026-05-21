import { pitchMulFromNotifyFreqSlider, playNotifyBeep, readNotifySoundFreqSlider } from './tiltNotifySound';
import { isNotifySoundPriceMuted } from './notifySoundPriceMute';

export const SIDEBAR_NOTIFY_VOLUME_SPIKE_RING_KEY = 'polybot-sidebar-notify-volume-spike-ring';
/** Flash duration — keep in sync with `.live-trade-chart-volume-spike-flash` in index.css */
export const CHART_VOLUME_SPIKE_FLASH_MS = 2800;

export type ChartVolumeSpike = {
  barTime: number;
  volume: number;
  avgPrevVolume: number;
  ratio: number;
};

/** Current open bar only: volume ≥ 2× average of all prior bars (100% above average). */
export function detectChartVolumeSpike(
  candles: readonly { time: number; v: number }[],
  candleMs: number,
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
  if (latest.v < avgPrev * 2) return null;
  return {
    barTime: latest.time,
    volume: latest.v,
    avgPrevVolume: avgPrev,
    ratio: latest.v / avgPrev,
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
