import { notifyVolatilityGatePasses } from './sidebarChartVolStore';

/** Glass ping tilt / bell notification sounds (Web Audio). */

/** ms between successive strikes inside one notification burst (double / triple ring). */
export const NOTIFY_MULTI_RING_GAP_MS = 95;

export const SIDEBAR_NOTIFY_SOUND_FREQ_KEY = 'polybot-sidebar-notify-sound-freq';
export const SIDEBAR_TRADE_SOUND_FREQ_KEY = 'polybot-sidebar-trade-sound-freq';
export const SIDEBAR_NOTIFY_RING_TIME_S_KEY = 'polybot-sidebar-notify-ring-time-s';

/** Slider 0 → 0.25×, 50 → 1×, 100 → 4× (exponential). */
export function pitchMulFromNotifyFreqSlider(slider0to100: number): number {
  const s = Math.min(100, Math.max(0, slider0to100));
  return 0.25 * 16 ** (s / 100);
}

export function readNotifySoundFreqSlider(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_SOUND_FREQ_KEY);
    const n = parseFloat(raw ?? '50');
    if (!Number.isFinite(n)) return 50;
    return Math.min(100, Math.max(0, Math.round(n)));
  } catch {
    return 50;
  }
}

export function readTradeSoundFreqSlider(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_TRADE_SOUND_FREQ_KEY);
    const n = parseFloat(raw ?? '20');
    if (!Number.isFinite(n)) return 20;
    return Math.min(100, Math.max(0, Math.round(n)));
  } catch {
    return 20;
  }
}

export const SIDEBAR_TRADE_SOUND_VOLUME_KEY = 'polybot-sidebar-trade-sound-volume';
export const SIDEBAR_NOTIFY_TRADE_SOUND_KEY = 'polybot-sidebar-notify-trade-sound';

export function readNotifyTradeSound(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_TRADE_SOUND_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}

export function readTradeSoundVolumeSlider(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_TRADE_SOUND_VOLUME_KEY);
    const n = parseFloat(raw ?? '100');
    if (!Number.isFinite(n)) return 100;
    return Math.min(100, Math.max(0, Math.round(n)));
  } catch {
    return 100;
  }
}

export function readNotifyRingTimeS(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_RING_TIME_S_KEY);
    const n = parseFloat(raw ?? '5');
    if (!Number.isFinite(n)) return 5;
    return Math.min(5, Math.max(0.05, Math.round(n * 100) / 100));
  } catch {
    return 5;
  }
}

let tiltExtremeAudioCtx: AudioContext | null = null;
let tiltAudioUnlockListenersDone = false;

/** Browsers suspend AudioContext until a user gesture; prime unlock on first tap/key. */
export function ensureTiltAudioUnlockListeners(): void {
  if (tiltAudioUnlockListenersDone || typeof window === 'undefined') return;
  tiltAudioUnlockListenersDone = true;
  const tryResume = () => {
    primeTiltAudioContextFromUserGesture();
  };
  window.addEventListener('pointerdown', tryResume, { passive: true });
  window.addEventListener('keydown', tryResume, { passive: true });
}

/** Call synchronously from click/key handlers so AudioContext can resume. */
export function primeTiltAudioContextFromUserGesture(): void {
  try {
    const ACtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ACtx) return;
    if (!tiltExtremeAudioCtx || tiltExtremeAudioCtx.state === 'closed') tiltExtremeAudioCtx = new ACtx();
    void tiltExtremeAudioCtx.resume();
  } catch {
    /* */
  }
}

/** Glass ping: `pitchMul` = timbre scale; `ringTimeS` = decay length (s); ref 0.5s. */
export const SIDEBAR_NOTIFY_SOUND_VOLUME_KEY = 'polybot-sidebar-notify-sound-volume';

export function readNotifySoundVolumeSlider(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_SOUND_VOLUME_KEY);
    const n = parseFloat(raw ?? '100');
    if (!Number.isFinite(n)) return 100;
    return Math.min(100, Math.max(0, Math.round(n)));
  } catch {
    return 100;
  }
}

function readNotifySoundVolumeMul(): number {
  return readNotifySoundVolumeSlider() / 100;
}

async function playUpdownTiltExtremeSound(
  kind: 'green' | 'red',
  pitchMul = 1,
  ringTimeS = 0.5,
  volumeMul = readNotifySoundVolumeMul(),
) {
  try {
    ensureTiltAudioUnlockListeners();
    const ACtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ACtx) return;
    if (!tiltExtremeAudioCtx || tiltExtremeAudioCtx.state === 'closed') tiltExtremeAudioCtx = new ACtx();
    const ctx = tiltExtremeAudioCtx;
    await ctx.resume();
    if (ctx.state !== 'running') return;
    if (volumeMul <= 0) return;
    const t0 = ctx.currentTime;

    const rt = Math.min(5, Math.max(0.05, ringTimeS));
    /** Decays tuned at 0.5s reference; scale stretches ring length. */
    const scale = rt / 0.5;
    const partialDecayS = [0.5, 0.34, 0.2, 0.12].map((d) => d * scale);
    const maxPartialDecay = partialDecayS[0] ?? rt;
    const tEnd = t0 + 0.02 + maxPartialDecay;

    const m = Math.min(3.15, Math.max(0.22, pitchMul));
    const root = (kind === 'green' ? 3350 : 2520) * m;
    /** Stiff-plate-ish partial ratios (not harmonic — reads as glass/crystal). */
    const partialRatios = [1, 1.43, 2.07, 2.89];
    const partialPeaks = [0.13, 0.076, 0.042, 0.022];

    const master = ctx.createGain();
    master.gain.setValueAtTime(volumeMul, t0);
    master.connect(ctx.destination);

    for (let i = 0; i < partialRatios.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(root * partialRatios[i], t0);
      const g = ctx.createGain();
      const decay = partialDecayS[i] ?? partialDecayS[0]!;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(partialPeaks[i], t0 + 0.0025);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.004 + decay);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(tEnd);
    }

    /** Knife-on-rim strike + thin ring (very bright, decays fast). */
    const strikeOsc = ctx.createOscillator();
    strikeOsc.type = 'triangle';
    strikeOsc.frequency.setValueAtTime((kind === 'green' ? 7200 : 5600) * m, t0);
    const strikeGain = ctx.createGain();
    strikeGain.gain.setValueAtTime(0.0001, t0);
    strikeGain.gain.linearRampToValueAtTime(0.11, t0 + 0.0012);
    strikeGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.028);
    strikeOsc.connect(strikeGain);
    strikeGain.connect(master);

    const shimmer = ctx.createOscillator();
    shimmer.type = 'sine';
    shimmer.frequency.setValueAtTime(root * 4.2, t0);
    const shimG = ctx.createGain();
    const shimDecay = 0.09 * scale;
    shimG.gain.setValueAtTime(0.0001, t0);
    shimG.gain.linearRampToValueAtTime(0.035, t0 + 0.002);
    shimG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.002 + shimDecay);
    shimmer.connect(shimG);
    shimG.connect(master);

    const strikeStop = t0 + 0.035;
    const shimStop = t0 + 0.004 + shimDecay + 0.02;
    strikeOsc.start(t0);
    strikeOsc.stop(strikeStop);
    shimmer.start(t0);
    shimmer.stop(shimStop);
  } catch {
    /* autoplay / no AudioContext */
  }
}

export async function playTiltNotifySoundStrikes(
  kind: 'green' | 'red',
  pitchMul: number,
  ringTimeS: number,
  strikes: number,
): Promise<void> {
  if (!notifyVolatilityGatePasses()) return;
  const n = Math.max(1, Math.min(16, Math.trunc(strikes)));
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, NOTIFY_MULTI_RING_GAP_MS);
      });
    }
    await playUpdownTiltExtremeSound(kind, pitchMul, ringTimeS);
  }
}

export async function playTiltNotifySoundWithDoubleRing(
  kind: 'green' | 'red',
  pitchMul: number,
  ringTimeS: number,
  doubleRing: boolean,
): Promise<void> {
  await playTiltNotifySoundStrikes(kind, pitchMul, ringTimeS, doubleRing ? 2 : 1);
}

export async function playTradeNotifySound(
  kind: 'green' | 'red',
  pitchMul: number,
  ringTimeS: number,
): Promise<void> {
  if (!notifyVolatilityGatePasses()) return;
  const volumeMul = readTradeSoundVolumeSlider() / 100;
  await playUpdownTiltExtremeSound(kind, pitchMul, ringTimeS, volumeMul);
}

/** Short single beep (not glass bell) — volume spike, etc. */
export async function playNotifyBeep(
  pitchMul = 1,
  volumeMul = readNotifySoundVolumeMul(),
): Promise<void> {
  if (!notifyVolatilityGatePasses()) return;
  try {
    ensureTiltAudioUnlockListeners();
    const ACtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ACtx) return;
    if (!tiltExtremeAudioCtx || tiltExtremeAudioCtx.state === 'closed') tiltExtremeAudioCtx = new ACtx();
    const ctx = tiltExtremeAudioCtx;
    await ctx.resume();
    if (ctx.state !== 'running') return;
    if (volumeMul <= 0) return;

    const t0 = ctx.currentTime;
    const m = Math.min(2.5, Math.max(0.5, pitchMul));
    const freq = 880 * m;
    const dur = 0.1;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, t0);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(0.1 * volumeMul, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  } catch {
    /* autoplay / no AudioContext */
  }
}
