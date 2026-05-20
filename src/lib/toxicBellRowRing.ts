import { useEffect, useRef } from 'react';
import {
  ensureTiltAudioUnlockListeners,
  pitchMulFromNotifyFreqSlider,
  playTiltNotifySoundStrikes,
  readNotifyRingTimeS,
  readNotifySoundFreqSlider,
} from './tiltNotifySound';

/** Must match `.toxic-flow-bell-row-flash` animation duration in index.css. */
export const TOXIC_BELL_ROW_FLASH_MS = 1350;

const SIDEBAR_NOTIFY_BELL_RING_KEY = 'polybot-sidebar-notify-bell-ring';
export const SIDEBAR_NOTIFY_BELL_MIN_STAKE_USD_KEY = 'polybot-sidebar-notify-bell-min-stake-usd';
export const NOTIFY_BELL_MIN_STAKE_CHANGED_EVENT = 'polybot-sidebar-notify-bell-min-stake-changed';

export function readNotifyBellRingEnabled(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_BELL_RING_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}

export function getNotifyBellMinStakeUsdSnapshot(): string {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_BELL_MIN_STAKE_USD_KEY);
    if (raw === null || raw === '') return '100';
    return raw;
  } catch {
    return '100';
  }
}

export function readNotifyBellMinStakeUsd(): number {
  try {
    const n = parseFloat(getNotifyBellMinStakeUsdSnapshot());
    if (!Number.isFinite(n) || n < 0) return 100;
    return Math.min(1e12, n);
  } catch {
    return 100;
  }
}

export function subscribeNotifyBellMinStakeUsd(listener: () => void): () => void {
  const onChange = () => listener();
  const onStorage = (e: StorageEvent) => {
    if (e.key === SIDEBAR_NOTIFY_BELL_MIN_STAKE_USD_KEY || e.key === null) onChange();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(NOTIFY_BELL_MIN_STAKE_CHANGED_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(NOTIFY_BELL_MIN_STAKE_CHANGED_EVENT, onChange);
  };
}

/** One strike per flashing bell row, aligned to row flash peak (~50% of 1.35s cycle). */
export function useToxicBellRowRingSound(bellFlashingCount: number, active: boolean): void {
  const countRef = useRef(bellFlashingCount);
  countRef.current = bellFlashingCount;

  useEffect(() => {
    if (!active) return;
    ensureTiltAudioUnlockListeners();

    const tick = () => {
      const n = countRef.current;
      if (n <= 0 || !readNotifyBellRingEnabled()) return;
      const mul = pitchMulFromNotifyFreqSlider(readNotifySoundFreqSlider()) * 1.12;
      const rt = readNotifyRingTimeS();
      void playTiltNotifySoundStrikes('green', mul, rt, n);
    };

    const peakMs = TOXIC_BELL_ROW_FLASH_MS / 2;
    let intervalId: number | undefined;
    const startId = window.setTimeout(() => {
      tick();
      intervalId = window.setInterval(tick, TOXIC_BELL_ROW_FLASH_MS);
    }, peakMs);

    return () => {
      window.clearTimeout(startId);
      if (intervalId != null) window.clearInterval(intervalId);
    };
  }, [active]);
}
