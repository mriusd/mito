import { useState, useEffect, useMemo, useRef, useCallback, Suspense } from 'react';
import { useAccount } from 'wagmi';
import { createPortal } from 'react-dom';
import { useAppStore } from '../stores/appStore';
import { appKit } from '../lib/wallet';
import {
  fetchMarketStakedLegs,
  mergeMarketStakedLegsResponse,
  placeOrder,
  cancelOrder,
  signOrder,
  submitSignedOrder,
  type MarketStakedLegsResponse,
} from '../api';
import { fetchProxyWallet } from '../api/polymarket';
import { resolvePolymarketMakerAddress } from '../lib/polymarketTradingMaker';
import { triggerWalletRefresh } from '../lib/clobClient';
import { executeMergePositions } from '../lib/mergePositions';
import { showToast } from '../utils/toast';
import { signingDialog, isDialogHidden } from './SigningDialog';
import {
  extractAssetFromMarket,
  formatPolymarketVolumeK,
  formatPriceShort,
  getMarketPriceCondition,
  getOrderClobTokenId,
  getPolymarketVolumeUsd,
  getTokenOutcome,
  getTradeClobTokenId,
  outcomeTokenBelongsToSelectedMarket,
  pickLiveUpDownMarketInTfBucket,
  pickNextMarketOnExpiry,
  shortenMarketName,
  tradeMatchesSelectedMarket,
  hitStrikeMetaForBs,
  upDownMarketUsesChainlinkSpot,
  upDownTimeframeKeyFromMarket,
} from '../utils/format';
import { getHitMarketProbability, getMarketProbability, isMarketInWeeklyHitMarkets } from '../utils/bsMath';
import { API_BASE } from '../lib/env';
import { fetchUpDownTargetFromCrypto, upDownCryptoTimeframe } from '../lib/upDownTargetFromCrypto';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import { useOnchainTradesWS } from '../hooks/useOnchainTradesWS';
import { BsFlower } from './BsFlower';
import { HelpTooltip } from './HelpTooltip';
import { usePolymarketPrice } from '../hooks/usePolymarketPrice';
import { StakedLegUsdBar } from './StakedLegUsdBar';
import { SidebarBiasMiniBar } from './SidebarBiasMiniBar';
import { SidebarChartsRow } from './SidebarChartsRow';
import { SidebarPolymarketOBHost, type SidebarPolymarketBookSnapshot } from './SidebarPolymarketOBHost';
import { SidebarLiveTradesSection } from './SidebarLiveTradesSection';
import { ArrowRight, Bell, CirclePercent, Clock, GripVertical, Pencil, Plus, X } from 'lucide-react';
import type { AssetSymbol, Market, Position } from '../types';
import { importWithChunkReload, lazyWithChunkReload } from '../utils/lazyWithChunkReload';

const ToxicFlowDialogLazy = lazyWithChunkReload(() =>
  import('./ToxicFlowDialog').then((m) => ({ default: m.ToxicFlowDialog })),
);

function preloadToxicFlowDialog() {
  void importWithChunkReload(() => import('./ToxicFlowDialog'));
}

const MergePositionsDialogLazy = lazyWithChunkReload(() =>
  import('./MergePositionsDialog').then((m) => ({ default: m.MergePositionsDialog })),
);

function preloadMergePositionsDialog() {
  void importWithChunkReload(() => import('./MergePositionsDialog'));
}
const SIDEBAR_ORDER_KIND_KEY = 'polymarket-sidebar-order-kind';
const SIDEBAR_CUSTOM_BUTTONS_KEY = 'polymarket-sidebar-custom-buttons';

const LS_ORDER_EXPIRY_UPDOWN = 'polymarket-order-expiry-updown';
const LS_ORDER_EXPIRY_OTHER = 'polymarket-order-expiry-other';
const LS_ORDER_EXPIRY_UNIT_UPDOWN = 'polymarket-order-expiry-unit-updown';
const LS_ORDER_EXPIRY_UNIT_OTHER = 'polymarket-order-expiry-unit-other';
const LS_ORDER_EXPIRY_LEGACY = 'polymarket-order-expiry';
const LS_ORDER_EXPIRY_UNIT_LEGACY = 'polymarket-order-expiry-unit';
const LS_ORDER_EXPIRY_MIGRATED_FLAG = 'polybot-order-expiry-two-buckets-v1';

function normalizeExpiryUnit(raw: string | null): 's' | 'm' | 'h' {
  return raw === 's' || raw === 'h' ? raw : 'm';
}

/** Seed up/down vs other buckets once from legacy single keys. */
function ensureOrderExpiryBucketsFromLegacy(): void {
  try {
    if (localStorage.getItem(LS_ORDER_EXPIRY_MIGRATED_FLAG) === '1') return;
    const leg = localStorage.getItem(LS_ORDER_EXPIRY_LEGACY);
    const legU = localStorage.getItem(LS_ORDER_EXPIRY_UNIT_LEGACY);
    const v = leg != null && leg !== '' ? leg : '180';
    const u = normalizeExpiryUnit(legU);
    if (localStorage.getItem(LS_ORDER_EXPIRY_UPDOWN) == null) localStorage.setItem(LS_ORDER_EXPIRY_UPDOWN, v);
    if (localStorage.getItem(LS_ORDER_EXPIRY_OTHER) == null) localStorage.setItem(LS_ORDER_EXPIRY_OTHER, v);
    if (localStorage.getItem(LS_ORDER_EXPIRY_UNIT_UPDOWN) == null) localStorage.setItem(LS_ORDER_EXPIRY_UNIT_UPDOWN, u);
    if (localStorage.getItem(LS_ORDER_EXPIRY_UNIT_OTHER) == null) localStorage.setItem(LS_ORDER_EXPIRY_UNIT_OTHER, u);
    localStorage.setItem(LS_ORDER_EXPIRY_MIGRATED_FLAG, '1');
  } catch {
    /* ignore */
  }
}

function readOrderExpirySlot(isUpDownMarket: boolean): { value: string; unit: 's' | 'm' | 'h' } {
  ensureOrderExpiryBucketsFromLegacy();
  const vKey = isUpDownMarket ? LS_ORDER_EXPIRY_UPDOWN : LS_ORDER_EXPIRY_OTHER;
  const uKey = isUpDownMarket ? LS_ORDER_EXPIRY_UNIT_UPDOWN : LS_ORDER_EXPIRY_UNIT_OTHER;
  const value = localStorage.getItem(vKey) ?? localStorage.getItem(LS_ORDER_EXPIRY_LEGACY) ?? '180';
  const uRaw = localStorage.getItem(uKey) ?? localStorage.getItem(LS_ORDER_EXPIRY_UNIT_LEGACY);
  return { value, unit: normalizeExpiryUnit(uRaw) };
}

function writeOrderExpirySlot(isUpDownMarket: boolean, value: string, unit: 's' | 'm' | 'h'): void {
  try {
    ensureOrderExpiryBucketsFromLegacy();
    const vKey = isUpDownMarket ? LS_ORDER_EXPIRY_UPDOWN : LS_ORDER_EXPIRY_OTHER;
    const uKey = isUpDownMarket ? LS_ORDER_EXPIRY_UNIT_UPDOWN : LS_ORDER_EXPIRY_UNIT_OTHER;
    localStorage.setItem(vKey, value);
    localStorage.setItem(uKey, unit);
  } catch {
    /* ignore */
  }
}

/** Match `StakedLegUsdBar` flash + `sidebar-stats-flash-*` CSS. */
const TILT_EXTREME_FLASH_MS = 550;

let tiltExtremeAudioCtx: AudioContext | null = null;
let tiltAudioUnlockListenersDone = false;

/** Browsers suspend AudioContext until a user gesture; prime unlock on first tap/key. */
function ensureTiltAudioUnlockListeners() {
  if (tiltAudioUnlockListenersDone || typeof window === 'undefined') return;
  tiltAudioUnlockListenersDone = true;
  const tryResume = () => {
    try {
      const ACtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!ACtx) return;
      if (!tiltExtremeAudioCtx || tiltExtremeAudioCtx.state === 'closed') tiltExtremeAudioCtx = new ACtx();
      void tiltExtremeAudioCtx.resume();
    } catch {
      /* */
    }
  };
  window.addEventListener('pointerdown', tryResume, { passive: true });
  window.addEventListener('keydown', tryResume, { passive: true });
}

/** Glass ping: `pitchMul` = timbre scale; `ringTimeS` = decay length (s); ref 0.5s. */
async function playUpdownTiltExtremeSound(kind: 'green' | 'red', pitchMul = 1, ringTimeS = 0.5) {
  try {
    ensureTiltAudioUnlockListeners();
    const ACtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!ACtx) return;
    if (!tiltExtremeAudioCtx || tiltExtremeAudioCtx.state === 'closed') tiltExtremeAudioCtx = new ACtx();
    const ctx = tiltExtremeAudioCtx;
    await ctx.resume();
    if (ctx.state !== 'running') return;
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
    master.gain.setValueAtTime(1, t0);
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

/** ms between rings when Double ring is on (second strike right after first). */
const NOTIFY_DOUBLE_RING_GAP_MS = 95;

async function playTiltNotifySoundWithDoubleRing(
  kind: 'green' | 'red',
  pitchMul: number,
  ringTimeS: number,
  doubleRing: boolean,
): Promise<void> {
  await playUpdownTiltExtremeSound(kind, pitchMul, ringTimeS);
  if (!doubleRing) return;
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, NOTIFY_DOUBLE_RING_GAP_MS);
  });
  await playUpdownTiltExtremeSound(kind, pitchMul, ringTimeS);
}

function pitchMulFromNotifyFreqSlider(slider0to100: number): number {
  const s = Math.min(100, Math.max(0, slider0to100));
  return 0.25 * 16 ** (s / 100);
}

const SIDEBAR_NOTIFY_PLAY_SOUND_KEY = 'polybot-sidebar-notify-play-sound';
const SIDEBAR_NOTIFY_FLASH_BG_KEY = 'polybot-sidebar-notify-flash-bg';
const SIDEBAR_NOTIFY_TOP_THRESHOLD_PCT_KEY = 'polybot-sidebar-notify-top-threshold-pct';
const SIDEBAR_NOTIFY_STAKED_MIN_USD_KEY = 'polybot-sidebar-notify-staked-min-usd';
const SIDEBAR_NOTIFY_SOUND_FREQ_KEY = 'polybot-sidebar-notify-sound-freq';
const SIDEBAR_NOTIFY_RING_TIME_S_KEY = 'polybot-sidebar-notify-ring-time-s';
const SIDEBAR_NOTIFY_SOUND_MAX_PRICE_CENTS_KEY = 'polybot-sidebar-notify-sound-max-price-cents';
const SIDEBAR_NOTIFY_DOUBLE_RING_KEY = 'polybot-sidebar-notify-double-ring';
const SIDEBAR_NOTIFY_TILT_MKT_UPDOWN_KEY = 'polybot-sidebar-notify-tilt-mkt-updown';
const SIDEBAR_NOTIFY_TILT_MKT_HIT_KEY = 'polybot-sidebar-notify-tilt-mkt-hit';
const SIDEBAR_NOTIFY_TILT_MKT_ABOVE_KEY = 'polybot-sidebar-notify-tilt-mkt-above';
const SIDEBAR_NOTIFY_TILT_MKT_BETWEEN_KEY = 'polybot-sidebar-notify-tilt-mkt-between';
const SIDEBAR_NOTIFY_TILT_UD_5M_KEY = 'polybot-sidebar-notify-tilt-ud-5m';
const SIDEBAR_NOTIFY_TILT_UD_15M_KEY = 'polybot-sidebar-notify-tilt-ud-15m';
const SIDEBAR_NOTIFY_TILT_UD_1H_KEY = 'polybot-sidebar-notify-tilt-ud-1h';
const SIDEBAR_NOTIFY_TILT_UD_4H_KEY = 'polybot-sidebar-notify-tilt-ud-4h';

type NotifyTiltMarketFiltersPersisted = {
  upDown: boolean;
  hit: boolean;
  above: boolean;
  between: boolean;
  ud5m: boolean;
  ud15m: boolean;
  ud1h: boolean;
  ud4h: boolean;
};

function readNotifyTiltMktUpDown(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_TILT_MKT_UPDOWN_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}
function readNotifyTiltMktHit(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_TILT_MKT_HIT_KEY);
    if (v === null) return false;
    return v === '1';
  } catch {
    return false;
  }
}
function readNotifyTiltMktAbove(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_TILT_MKT_ABOVE_KEY);
    if (v === null) return false;
    return v === '1';
  } catch {
    return false;
  }
}
function readNotifyTiltMktBetween(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_TILT_MKT_BETWEEN_KEY);
    if (v === null) return false;
    return v === '1';
  } catch {
    return false;
  }
}
function readNotifyTiltUd5m(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_TILT_UD_5M_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}
function readNotifyTiltUd15m(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_TILT_UD_15M_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}
function readNotifyTiltUd1h(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_TILT_UD_1H_KEY);
    if (v === null) return false;
    return v === '1';
  } catch {
    return false;
  }
}
function readNotifyTiltUd4h(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_TILT_UD_4H_KEY);
    if (v === null) return false;
    return v === '1';
  } catch {
    return false;
  }
}

/** Tilt sound/flash/top-cohort tilt only when the selected market matches user filters. */
function marketMatchesNotifyTiltFilters(
  market: Parameters<typeof hitStrikeMetaForBs>[0] | null | undefined,
  f: NotifyTiltMarketFiltersPersisted,
  isWeeklyListedHit: boolean,
): boolean {
  if (!market) return false;
  if (!(f.upDown || f.hit || f.above || f.between)) return false;
  const isUd = !!(market.question?.match(/up\s+or\s+down/i) || market.eventSlug?.match(/up-or-down|updown/i));
  if (isUd && f.upDown) {
    const tf = upDownTimeframeKeyFromMarket(market);
    if (tf === '5m') return f.ud5m;
    if (tf === '15m') return f.ud15m;
    if (tf === '1h') return f.ud1h;
    if (tf === '4h') return f.ud4h;
    return false;
  }
  if (isUd) return false;
  const isHit = isWeeklyListedHit || hitStrikeMetaForBs(market) != null;
  const q = (market.question || '').trim();
  const isBetween = /\bbetween\b.+\band\b/i.test(q);
  if (isHit && f.hit) return true;
  if (isBetween && f.between) return true;
  if (!isHit && !isBetween && f.above) return true;
  return false;
}

function readNotifyPlaySound(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_PLAY_SOUND_KEY);
    if (v === null) return false;
    return v === '1';
  } catch {
    return false;
  }
}
function readNotifyFlashBg(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_FLASH_BG_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}
function readNotifyTopThresholdPct(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_TOP_THRESHOLD_PCT_KEY);
    const n = parseFloat(raw ?? '30');
    if (!Number.isFinite(n)) return 30;
    return Math.min(99, Math.max(1, Math.round(n)));
  } catch {
    return 30;
  }
}
function readNotifyStakedMinUsd(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_STAKED_MIN_USD_KEY);
    const n = parseFloat(raw ?? '0');
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(1e12, n);
  } catch {
    return 0;
  }
}
/** 0 = low pitch, 100 = high; persisted slider position. */
function readNotifySoundFreqSlider(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_SOUND_FREQ_KEY);
    const n = parseFloat(raw ?? '50');
    if (!Number.isFinite(n)) return 50;
    return Math.min(100, Math.max(0, Math.round(n)));
  } catch {
    return 50;
  }
}
function readNotifyRingTimeS(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_RING_TIME_S_KEY);
    const n = parseFloat(raw ?? '5');
    if (!Number.isFinite(n)) return 5;
    return Math.min(5, Math.max(0.05, Math.round(n * 100) / 100));
  } catch {
    return 5;
  }
}
function readNotifySoundMaxPriceCents(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_SOUND_MAX_PRICE_CENTS_KEY);
    const n = parseFloat(raw ?? '95');
    if (!Number.isFinite(n)) return 95;
    return Math.min(99, Math.max(1, Math.round(n)));
  } catch {
    return 95;
  }
}
function readNotifyDoubleRing(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_DOUBLE_RING_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}
/** FAK buy: pay up to this per share to lift asks. */
const MARKET_AGGRESSIVE_BUY = 0.99;
/** FAK sell: accept down to this per share to hit bids. */
const MARKET_AGGRESSIVE_SELL = 0.01;

/** (ΣY − ΣN) / (ΣY + ΣN) over gross staked USD legs — same basis as Stake mini bar (`stakedUsdYesLeg` / `stakedUsdNoLeg`). */
function stakedGrossUsdTilt(sumYesUsd: number, sumNoUsd: number): number {
  const t = sumYesUsd + sumNoUsd;
  if (!Number.isFinite(sumYesUsd) || !Number.isFinite(sumNoUsd) || t <= 1e-9) return 0;
  return (sumYesUsd - sumNoUsd) / t;
}

/** Polymarket rows may include `size_filled`; on-chain mapped trades only have `size`. */
function tradeFilledSizeShares(trade: { size: string; size_filled?: string }): number {
  return parseFloat(trade.size_filled ?? trade.size);
}

type CustomSidebarButton = {
  id: string;
  side: 'BUY' | 'SELL';
  priceCents: number;
  maxSell: boolean;
  label: string;
  color: string;
};

function readCustomSidebarButtons(): CustomSidebarButton[] {
  try {
    const raw = localStorage.getItem(SIDEBAR_CUSTOM_BUTTONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((b) => b && (b.side === 'BUY' || b.side === 'SELL'))
      .map((b) => ({
        id: String(b.id || `${Date.now()}-${Math.random()}`),
        side: b.side as 'BUY' | 'SELL',
        priceCents: Number(b.priceCents) || 0,
        maxSell: !!b.maxSell,
        label: String(b.label || '?').slice(0, 3),
        color: String(b.color || '#2563eb'),
      }));
  } catch {
    return [];
  }
}

function readSidebarOrderKind(): 'limit' | 'market' {
  try {
    const v = localStorage.getItem(SIDEBAR_ORDER_KIND_KEY);
    if (v === 'market' || v === 'limit') return v;
  } catch {
    /* ignore */
  }
  return 'limit';
}

function positionTokenKey(id: string): string {
  const s = String(id || '').trim();
  if (!s) return '';
  try {
    return BigInt(s).toString();
  } catch {
    return s;
  }
}

/** Prefer on-chain WS sizes; drop REST row when WS shows closed; keep REST metadata when merging. */
function mergeSidebarPositionsWsRest(
  rest: Position[],
  wsRows: Array<{ tokenId: string; size: number; avgPrice: number }>,
): Position[] {
  const wsMap = new Map<string, { tokenId: string; size: number; avgPrice: number }>();
  for (const w of wsRows) {
    const k = positionTokenKey(w.tokenId);
    if (k) wsMap.set(k, w);
  }
  const usedWs = new Set<string>();
  const out: Position[] = [];
  for (const p of rest) {
    const k = positionTokenKey(p.asset || '');
    if (!k) continue;
    const w = wsMap.get(k);
    if (w) {
      usedWs.add(k);
      if (w.size <= 0) continue;
      const avg = w.avgPrice > 0 ? w.avgPrice : p.avgPrice ?? 0;
      out.push({ ...p, size: w.size, avgPrice: avg });
      continue;
    }
    if ((p.size || 0) > 0 && !p.redeemable) out.push(p);
  }
  for (const w of wsRows) {
    const k = positionTokenKey(w.tokenId);
    if (!k || usedWs.has(k) || w.size <= 0) continue;
    out.push({ asset: w.tokenId, size: w.size, avgPrice: w.avgPrice });
  }
  return out;
}

export function Sidebar() {
  const { isConnected: walletConnected, address: walletAddress } = useAccount();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  // const setProgDialogOpen = useAppStore((s) => s.setProgDialogOpen);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const positions = useAppStore((s) => s.positions);
  const makerAddressForMerge = useAppStore((s) => s.makerAddress);
  const orders = useAppStore((s) => s.orders);
  const trades = useAppStore((s) => s.trades);
  const marketLookupEpoch = useAppStore((s) => s.marketLookupEpoch);
  const weeklyHitMarkets = useAppStore((s) => s.weeklyHitMarkets);
  const marketLookup = useMemo(() => useAppStore.getState().marketLookup, [marketLookupEpoch]);
  const autoSwitchNextMarketOnExpiry = useAppStore((s) => s.autoSwitchNextMarketOnExpiry);
  /** Edge-detect expiry on the same sidebar selection — skip when user navigates to an already-expired market. */
  const autoSwitchPrevSelectedIdRef = useRef<string | null>(null);
  const autoSwitchPrevExpiredRef = useRef(false);
  const freqSliderPreviewLastMs = useRef(0);

  const liveOrderbookVolumeDisplay = useMemo(() => {
    if (!selectedMarket?.clobTokenIds?.[0]) return null;
    const usd = getPolymarketVolumeUsd(selectedMarket, selectedMarket.clobTokenIds[0], marketLookup);
    return formatPolymarketVolumeK(usd);
  }, [selectedMarket, marketLookup]);
  const liveShareStats = useMemo(() => {
    const tokenId = selectedMarket?.clobTokenIds?.[0];
    if (!tokenId) return null;
    const entry = marketLookup[tokenId];
    if (!entry) return null;
    return {
      sharesInExistence: entry.sharesInExistence,
      marketNetDirection: entry.marketNetDirection,
      holders: entry.holders,
      smartMoneyBias: entry.smartMoneyBias,
      provenSMS: entry.provenSMS,
      crowdBias: entry.crowdBias,
      liveBias: entry.liveBias,
      liveBiasWindowMin: entry.liveBiasWindowMin,
      concentration: entry.concentration,
      winnerBiasYesWR: entry.winnerBiasYesWR,
      winnerBiasNoWR: entry.winnerBiasNoWR,
      winBiasShares: entry.winBiasShares,
      winBiasSharesYes: entry.winBiasSharesYes,
      winBiasSharesNo: entry.winBiasSharesNo,
      winnerBiasConvictionYesWR: entry.winnerBiasConvictionYesWR,
      winnerBiasConvictionNoWR: entry.winnerBiasConvictionNoWR,
      winBiasConvictionShares: entry.winBiasConvictionShares,
      winBiasConvictionSharesYes: entry.winBiasConvictionSharesYes,
      winBiasConvictionSharesNo: entry.winBiasConvictionSharesNo,
      stakedTopHoldersCohortYesUsd: entry.stakedTopHoldersCohortYesUsd,
      stakedTopHoldersCohortNoUsd: entry.stakedTopHoldersCohortNoUsd,
    };
  }, [selectedMarket, marketLookup]);
  const [notifyPlaySound, setNotifyPlaySound] = useState(readNotifyPlaySound);
  const [notifyFlashBg, setNotifyFlashBg] = useState(readNotifyFlashBg);
  const [notifyTopThresholdPct, setNotifyTopThresholdPct] = useState(readNotifyTopThresholdPct);
  const [notifyStakedMinUsd, setNotifyStakedMinUsd] = useState(readNotifyStakedMinUsd);
  const [notifySoundFreqSlider, setNotifySoundFreqSlider] = useState(readNotifySoundFreqSlider);
  const [notifyRingTimeS, setNotifyRingTimeS] = useState(readNotifyRingTimeS);
  const [notifySoundMaxPriceCents, setNotifySoundMaxPriceCents] = useState(readNotifySoundMaxPriceCents);
  const [notifyDoubleRing, setNotifyDoubleRing] = useState(readNotifyDoubleRing);
  const [notifyTiltMktUpDown, setNotifyTiltMktUpDown] = useState(readNotifyTiltMktUpDown);
  const [notifyTiltMktHit, setNotifyTiltMktHit] = useState(readNotifyTiltMktHit);
  const [notifyTiltMktAbove, setNotifyTiltMktAbove] = useState(readNotifyTiltMktAbove);
  const [notifyTiltMktBetween, setNotifyTiltMktBetween] = useState(readNotifyTiltMktBetween);
  const [notifyTiltUd5m, setNotifyTiltUd5m] = useState(readNotifyTiltUd5m);
  const [notifyTiltUd15m, setNotifyTiltUd15m] = useState(readNotifyTiltUd15m);
  const [notifyTiltUd1h, setNotifyTiltUd1h] = useState(readNotifyTiltUd1h);
  const [notifyTiltUd4h, setNotifyTiltUd4h] = useState(readNotifyTiltUd4h);
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_PLAY_SOUND_KEY, notifyPlaySound ? '1' : '0');
    } catch {
      /* */
    }
  }, [notifyPlaySound]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_FLASH_BG_KEY, notifyFlashBg ? '1' : '0');
    } catch {
      /* */
    }
  }, [notifyFlashBg]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_TOP_THRESHOLD_PCT_KEY, String(notifyTopThresholdPct));
    } catch {
      /* */
    }
  }, [notifyTopThresholdPct]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_STAKED_MIN_USD_KEY, String(notifyStakedMinUsd));
    } catch {
      /* */
    }
  }, [notifyStakedMinUsd]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_SOUND_FREQ_KEY, String(notifySoundFreqSlider));
    } catch {
      /* */
    }
  }, [notifySoundFreqSlider]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_RING_TIME_S_KEY, String(notifyRingTimeS));
    } catch {
      /* */
    }
  }, [notifyRingTimeS]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_SOUND_MAX_PRICE_CENTS_KEY, String(notifySoundMaxPriceCents));
    } catch {
      /* */
    }
  }, [notifySoundMaxPriceCents]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_DOUBLE_RING_KEY, notifyDoubleRing ? '1' : '0');
    } catch {
      /* */
    }
  }, [notifyDoubleRing]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_TILT_MKT_UPDOWN_KEY, notifyTiltMktUpDown ? '1' : '0');
    } catch {
      /* */
    }
  }, [notifyTiltMktUpDown]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_TILT_MKT_HIT_KEY, notifyTiltMktHit ? '1' : '0');
    } catch {
      /* */
    }
  }, [notifyTiltMktHit]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_TILT_MKT_ABOVE_KEY, notifyTiltMktAbove ? '1' : '0');
    } catch {
      /* */
    }
  }, [notifyTiltMktAbove]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_TILT_MKT_BETWEEN_KEY, notifyTiltMktBetween ? '1' : '0');
    } catch {
      /* */
    }
  }, [notifyTiltMktBetween]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_TILT_UD_5M_KEY, notifyTiltUd5m ? '1' : '0');
    } catch {
      /* */
    }
  }, [notifyTiltUd5m]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_TILT_UD_15M_KEY, notifyTiltUd15m ? '1' : '0');
    } catch {
      /* */
    }
  }, [notifyTiltUd15m]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_TILT_UD_1H_KEY, notifyTiltUd1h ? '1' : '0');
    } catch {
      /* */
    }
  }, [notifyTiltUd1h]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_TILT_UD_4H_KEY, notifyTiltUd4h ? '1' : '0');
    } catch {
      /* */
    }
  }, [notifyTiltUd4h]);

  /** Slider 0 → 0.25×, 50 → 1×, 100 → 4× (exponential). */
  const notifySoundPitchMul = useMemo(
    () => pitchMulFromNotifyFreqSlider(notifySoundFreqSlider),
    [notifySoundFreqSlider],
  );

  const notifyTiltAppliesToSelectedMarket = useMemo(() => {
    return marketMatchesNotifyTiltFilters(
      selectedMarket,
      {
        upDown: notifyTiltMktUpDown,
        hit: notifyTiltMktHit,
        above: notifyTiltMktAbove,
        between: notifyTiltMktBetween,
        ud5m: notifyTiltUd5m,
        ud15m: notifyTiltUd15m,
        ud1h: notifyTiltUd1h,
        ud4h: notifyTiltUd4h,
      },
      isMarketInWeeklyHitMarkets(selectedMarket?.id, weeklyHitMarkets),
    );
  }, [
    selectedMarket,
    weeklyHitMarkets,
    notifyTiltMktUpDown,
    notifyTiltMktHit,
    notifyTiltMktAbove,
    notifyTiltMktBetween,
    notifyTiltUd5m,
    notifyTiltUd15m,
    notifyTiltUd1h,
    notifyTiltUd4h,
  ]);

  /** Same rule as sidebar flash/sound Top cohort tilt: |lean| ≥ threshold when market passes notify filters. */
  const topBarExtremeBgFlash = useMemo((): 'green' | 'red' | null => {
    if (!notifyTiltAppliesToSelectedMarket) return null;
    const cy = liveShareStats?.stakedTopHoldersCohortYesUsd;
    const cn = liveShareStats?.stakedTopHoldersCohortNoUsd;
    if (
      typeof cy !== 'number' ||
      !Number.isFinite(cy) ||
      typeof cn !== 'number' ||
      !Number.isFinite(cn) ||
      cy + cn <= 1e-9
    ) {
      return null;
    }
    const total = cy + cn;
    const lean = (cy - cn) / total;
    const tiltThresholdFrac = notifyTopThresholdPct / 100;
    if (lean >= tiltThresholdFrac) return 'green';
    if (lean <= -tiltThresholdFrac) return 'red';
    return null;
  }, [
    notifyTiltAppliesToSelectedMarket,
    liveShareStats?.stakedTopHoldersCohortYesUsd,
    liveShareStats?.stakedTopHoldersCohortNoUsd,
    notifyTopThresholdPct,
  ]);

  useEffect(() => {
    ensureTiltAudioUnlockListeners();
  }, []);

  const holdersCountDisplay = useMemo(() => {
    const v = liveShareStats?.holders;
    if (typeof v !== 'number' || !Number.isFinite(v)) return '--';
    return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }, [liveShareStats]);
  const sharesInExistenceDisplay = useMemo(() => {
    const v = liveShareStats?.sharesInExistence;
    if (typeof v !== 'number' || !Number.isFinite(v)) return '--';
    return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }, [liveShareStats]);
  const progOrderMap = useAppStore((s) => s.progOrderMap) as Record<string, number>;

  // Tick every second so relative trade times update
  const [tradeTickNow, setTradeTickNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setTradeTickNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const orderOutcome = useAppStore((s) => s.sidebarOutcome);
  const setOrderOutcome = useAppStore((s) => s.setSidebarOutcome);
  const [orderPrice, setOrderPrice] = useState('');
  const [orderKind, setOrderKind] = useState<'limit' | 'market'>(() => readSidebarOrderKind());
  const [orderAmount, setOrderAmount] = useState(() => localStorage.getItem('polymarket-order-amount') || '');
  const [customButtons, setCustomButtons] = useState<CustomSidebarButton[]>(() => readCustomSidebarButtons());
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customSide, setCustomSide] = useState<'BUY' | 'SELL'>('BUY');
  const [customPrice, setCustomPrice] = useState('');
  const [customSellMax, setCustomSellMax] = useState(false);
  const [customLabel, setCustomLabel] = useState('');
  const [customColor, setCustomColor] = useState('#2563eb');
  const [editingCustomButtonId, setEditingCustomButtonId] = useState<string | null>(null);
  const [draggingCustomId, setDraggingCustomId] = useState<string | null>(null);
  const [orderExpiry, setOrderExpiry] = useState(() => readOrderExpirySlot(false).value);
  const [orderExpiryUnit, setOrderExpiryUnit] = useState<'s' | 'm' | 'h'>(() => readOrderExpirySlot(false).unit);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingOrderPrice, setEditingOrderPrice] = useState('');
  const [cancellingOrderIds, setCancellingOrderIds] = useState<Set<string>>(new Set());
  const [closingPositionTokens, setClosingPositionTokens] = useState<Set<string>>(new Set());
  const [positionsRefreshing, setPositionsRefreshing] = useState(false);
  const [toxicDialogOpen, setToxicDialogOpen] = useState(false);
  const [marketStakedLegs, setMarketStakedLegs] = useState<MarketStakedLegsResponse | null>(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  useEffect(() => {
    setMergeDialogOpen(false);
  }, [selectedMarket?.id]);
  useEffect(() => {
    const mid = ((selectedMarket?.conditionId ?? selectedMarket?.id) || '').trim();
    if (!mid) {
      setMarketStakedLegs(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const row = await fetchMarketStakedLegs(mid);
        if (!cancelled) setMarketStakedLegs(row);
      } catch {
        if (!cancelled) setMarketStakedLegs(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMarket?.conditionId, selectedMarket?.id]);
  const liveStakedLegUsd = useMemo(() => {
    const tokenId = selectedMarket?.clobTokenIds?.[0];
    if (!tokenId) return null;
    const wy = marketLookup[tokenId]?.stakedUsdYesLeg;
    const wn = marketLookup[tokenId]?.stakedUsdNoLeg;
    const sumAbs = marketLookup[tokenId]?.stakedSumAbsSignedNetUsd;
    if (typeof wy === 'number' && Number.isFinite(wy) && typeof wn === 'number' && Number.isFinite(wn)) {
      const row: MarketStakedLegsResponse = { stakedUsdYesLeg: wy, stakedUsdNoLeg: wn };
      if (typeof sumAbs === 'number' && Number.isFinite(sumAbs)) {
        row.stakedSumAbsSignedNetUsd = sumAbs;
      }
      return row;
    }
    return null;
  }, [selectedMarket, marketLookup]);
  const sidebarStakedLegs = useMemo(
    () => mergeMarketStakedLegsResponse(liveStakedLegUsd, marketStakedLegs),
    [liveStakedLegUsd, marketStakedLegs],
  );
  const marketStakedNetUsdAbs = useMemo(() => {
    if (!sidebarStakedLegs) return null;
    const net =
      typeof sidebarStakedLegs.stakedSumAbsSignedNetUsd === 'number' &&
      Number.isFinite(sidebarStakedLegs.stakedSumAbsSignedNetUsd)
        ? sidebarStakedLegs.stakedSumAbsSignedNetUsd
        : Math.abs(sidebarStakedLegs.stakedUsdYesLeg - sidebarStakedLegs.stakedUsdNoLeg);
    return Number.isFinite(net) ? net : null;
  }, [sidebarStakedLegs]);

  /** Tilt flash/sound only when net staked (pill) exceeds configured USD; 0 = no minimum. */
  const notifyStakedGatePasses = useMemo(() => {
    if (notifyStakedMinUsd <= 0) return true;
    if (marketStakedNetUsdAbs == null || !Number.isFinite(marketStakedNetUsdAbs)) return false;
    return marketStakedNetUsdAbs > notifyStakedMinUsd;
  }, [notifyStakedMinUsd, marketStakedNetUsdAbs]);

  const effectiveSidebarBgFlash = useMemo((): 'green' | 'red' | null => {
    if (!notifyFlashBg || !notifyStakedGatePasses) return null;
    return topBarExtremeBgFlash;
  }, [notifyFlashBg, notifyStakedGatePasses, topBarExtremeBgFlash]);

  const marketStakedNetKDisplay = useMemo(() => {
    if (marketStakedNetUsdAbs == null) return null;
    return formatPolymarketVolumeK(marketStakedNetUsdAbs);
  }, [marketStakedNetUsdAbs]);
  const marketStakedGrossUsd = useMemo(() => {
    if (!sidebarStakedLegs) return null;
    const y = sidebarStakedLegs.stakedUsdYesLeg;
    const n = sidebarStakedLegs.stakedUsdNoLeg;
    if (!Number.isFinite(y) || !Number.isFinite(n)) return null;
    return y + n;
  }, [sidebarStakedLegs]);
  /** Same USD basis as pill number (|net staked|, not Σ legs): <15k red, 15k–30k yellow, >30k green */
  const stakedPillTier = useMemo((): 'muted' | 'low' | 'mid' | 'high' => {
    if (typeof marketStakedNetUsdAbs !== 'number' || !Number.isFinite(marketStakedNetUsdAbs)) return 'muted';
    if (marketStakedNetUsdAbs < 15_000) return 'low';
    if (marketStakedNetUsdAbs <= 30_000) return 'mid';
    return 'high';
  }, [marketStakedNetUsdAbs]);
  const [crossingConfirmOpen, setCrossingConfirmOpen] = useState(false);
  const [crossingConfirmMessage, setCrossingConfirmMessage] = useState('');
  const crossingConfirmResolver = useRef<((confirmed: boolean) => void) | null>(null);
  // Inline signing step display when dialog is hidden
  const [signingState, setSigningState] = useState(signingDialog.getState());
  useEffect(() => signingDialog.subscribe(setSigningState), []);
  // Live WebSocket orderbook from Polymarket
  const obTokenId = useMemo(() => {
    if (!sidebarOpen || !selectedMarket?.clobTokenIds) return null;
    return selectedMarket.clobTokenIds[orderOutcome === 'YES' ? 0 : 1] || null;
  }, [sidebarOpen, selectedMarket, orderOutcome]);
  const sidebarBookRef = useRef<SidebarPolymarketBookSnapshot | null>(null);
  /** Keep latest market/book lookup for tilt sound mute check — must not rerun sound interval on each book bump. */
  const tiltSoundMarketRef = useRef(selectedMarket);
  const tiltSoundLookupRef = useRef(marketLookup);
  tiltSoundMarketRef.current = selectedMarket;
  tiltSoundLookupRef.current = marketLookup;
  /** Recomputed summary / spot-strip when Host reports top-of-book change (not every depth tick). */
  const [topOfBookDigest, setTopOfBookDigest] = useState(0);
  const bumpTopOfBookDigest = useCallback(() => {
    setTopOfBookDigest((n) => n + 1);
  }, []);

  const [polymarketTape, setPolymarketTape] = useState<LiveTrade[]>([]);

  useEffect(() => {
    if (!topBarExtremeBgFlash || !notifyPlaySound || !notifyStakedGatePasses) return;

    const k = topBarExtremeBgFlash;
    const mul = notifySoundPitchMul;
    const rt = notifyRingTimeS;
    const maxCents = notifySoundMaxPriceCents;
    const doubleRing = notifyDoubleRing;

    const bidOkForSound = (): boolean => {
      const sm = tiltSoundMarketRef.current;
      const lookup = tiltSoundLookupRef.current;
      const ids = sm?.clobTokenIds;
      /** Green tilt = cohort YES-heavy → mute gate uses YES token WS quotes; red → NO token (not sidebar OB outcome). */
      const tid =
        k === 'green' ? ids?.[0] : k === 'red' ? ids?.[1] : undefined;
      let compareCents: number | null = null;
      if (tid) {
        const row = lookup[tid];
        if (row) {
          const b =
            typeof row.bestBid === 'number' && Number.isFinite(row.bestBid) ? row.bestBid * 100 : null;
          const a =
            typeof row.bestAsk === 'number' && Number.isFinite(row.bestAsk) ? row.bestAsk * 100 : null;
          if (b != null && a != null) compareCents = (b + a) / 2;
          else if (b != null) compareCents = b;
        }
      }
      return !(compareCents != null && compareCents > maxCents);
    };

    const tick = () => {
      if (!bidOkForSound()) return;
      void playTiltNotifySoundWithDoubleRing(k, mul, rt, doubleRing);
    };

    tick();
    const repeatMs = Math.max(TILT_EXTREME_FLASH_MS, Math.ceil(rt * 1000) + 80);
    const id = window.setInterval(tick, repeatMs);
    return () => clearInterval(id);
  }, [
    topBarExtremeBgFlash,
    notifyPlaySound,
    notifyStakedGatePasses,
    notifySoundPitchMul,
    notifyRingTimeS,
    notifySoundMaxPriceCents,
    notifyDoubleRing,
  ]);

  const onPolymarketTradesFromHost = useCallback((t: LiveTrade[]) => {
    setPolymarketTape(t);
  }, []);
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  /** On-chain WS + REST prefetch: must not depend on sidebarOpen or tables stay empty after refresh until sidebar opens. */
  const onchainHookTokenId = useMemo(() => {
    if (liveTradesSource !== 'onchain' || !selectedMarket?.clobTokenIds?.length) return null;
    return selectedMarket.clobTokenIds[orderOutcome === 'YES' ? 0 : 1] || null;
  }, [liveTradesSource, selectedMarket, orderOutcome]);
  useEffect(() => {
    setTradeTickNow(Date.now());
  }, [selectedMarket?.conditionId, liveTradesSource]);
  const setOnchainGridPositions = useAppStore((s) => s.setOnchainGridPositions);

  const [proxyWallet, setProxyWallet] = useState<string | null>(null);
  const pkAddress = useAppStore((s) => s.pkAddress);
  const signingMode = useAppStore((s) => s.signingMode);
  const effectiveSidebarEoa = signingMode === 'privateKey' && pkAddress ? pkAddress : walletAddress;
  useEffect(() => {
    if (!effectiveSidebarEoa) { setProxyWallet(null); return; }
    let cancelled = false;
    fetchProxyWallet(effectiveSidebarEoa).then((pw) => {
      if (cancelled) return;
      try {
        setProxyWallet(resolvePolymarketMakerAddress(effectiveSidebarEoa, pw));
      } catch {
        setProxyWallet(null);
      }
    });
    return () => { cancelled = true; };
  }, [effectiveSidebarEoa]);

  /** Trading maker (proxy): WS `subscribeWallet` for live positions whenever resolved — not only when tape is on-chain. */
  const walletForLivePositions =
    ((proxyWallet || makerAddressForMerge || '').trim().toLowerCase() || null);
  /** Same resolution as on-chain sidebar: proxy / maker for DB wallet keys. */
  const mergeFunderWallet = (makerAddressForMerge || proxyWallet || '').trim();
  const scopedClobPair = useMemo(() => {
    if (!selectedMarket?.clobTokenIds?.length) return null;
    return selectedMarket.clobTokenIds.map((x) => String(x || '').trim()).filter(Boolean);
  }, [selectedMarket?.clobTokenIds]);
  const { trades: onchainLiveTrades, walletPositions: wsPositions, gridWalletPositions, walletTrades: wsTrades, refreshWallet } = useOnchainTradesWS({
    marketId:
      liveTradesSource === 'onchain' && selectedMarket?.conditionId?.trim()
        ? String(selectedMarket.conditionId).trim()
        : null,
    tokenId: liveTradesSource === 'onchain' ? onchainHookTokenId : null,
    wallet: walletForLivePositions,
    scopedClobTokenIds: scopedClobPair,
  });
  const displayLiveTrades = useMemo(
    () => (liveTradesSource === 'onchain' ? onchainLiveTrades : polymarketTape),
    [liveTradesSource, onchainLiveTrades, polymarketTape],
  );
  const onchainSidebarPositions = useMemo(
    () => (liveTradesSource === 'onchain' ? wsPositions : []),
    [liveTradesSource, wsPositions],
  );
  const onchainSidebarTrades = useMemo(
    () => (liveTradesSource === 'onchain' ? wsTrades : []),
    [liveTradesSource, wsTrades],
  );

  const requestCrossingConfirm = useCallback((bestPriceCents: number) => {
    if (useAppStore.getState().disableMarketPriceWarning) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      crossingConfirmResolver.current = resolve;
      setCrossingConfirmMessage(`Current best price is ${bestPriceCents.toFixed(1)}¢, your order will be instantly executed`);
      setCrossingConfirmOpen(true);
    });
  }, []);
  const closeCrossingConfirm = useCallback((confirmed: boolean) => {
    setCrossingConfirmOpen(false);
    const resolver = crossingConfirmResolver.current;
    crossingConfirmResolver.current = null;
    if (resolver) resolver(confirmed);
  }, []);

  const [liveOrderbookExpanded, setLiveOrderbookExpanded] = useState(() => localStorage.getItem('sidebar-live-orderbook-expanded') !== 'false');
  const [liveTradesExpanded, setLiveTradesExpanded] = useState(() => {
    const saved = localStorage.getItem('sidebar-live-trades-expanded');
    if (saved === 'true') return true;
    if (saved === 'false') return false;
    // Default to collapsed on shorter screens.
    return window.innerHeight >= 1000;
  });
  const toggleLiveOrderbookExpanded = useCallback(() => setLiveOrderbookExpanded((v) => !v), []);
  const toggleLiveTradesExpanded = useCallback(() => setLiveTradesExpanded((v) => !v), []);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_CUSTOM_BUTTONS_KEY, JSON.stringify(customButtons));
  }, [customButtons]);
  useEffect(() => {
    if (liveTradesSource !== 'onchain') return;
    setOnchainGridPositions(gridWalletPositions.map((p) => ({ tokenId: p.tokenId, size: p.size })));
  }, [liveTradesSource, gridWalletPositions, setOnchainGridPositions]);

  useEffect(() => {
    localStorage.setItem('sidebar-live-orderbook-expanded', liveOrderbookExpanded ? 'true' : 'false');
  }, [liveOrderbookExpanded]);
  useEffect(() => {
    localStorage.setItem('sidebar-live-trades-expanded', liveTradesExpanded ? 'true' : 'false');
  }, [liveTradesExpanded]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_ORDER_KIND_KEY, orderKind);
    } catch {
      /* ignore */
    }
  }, [orderKind]);
  useEffect(() => {
    localStorage.setItem('polymarket-order-amount', orderAmount);
  }, [orderAmount]);

  const isMarketExpired =
    !!selectedMarket &&
    (Boolean(selectedMarket.closed) ||
      (!!selectedMarket.endDate &&
        Number.isFinite(new Date(selectedMarket.endDate).getTime()) &&
        new Date(selectedMarket.endDate).getTime() <= Date.now()));
  const marketForOrderbookOutcome = useMemo((): Market | null => {
    if (!selectedMarket) return null;
    const t0 = selectedMarket.clobTokenIds?.[0];
    const row = t0 ? marketLookup[t0] : undefined;
    if (!row) return selectedMarket;
    return {
      ...selectedMarket,
      outcomePrices: row.outcomePrices ?? selectedMarket.outcomePrices,
      closed: row.closed ?? selectedMarket.closed,
    };
  }, [selectedMarket, marketLookup]);
  const myPositions = useMemo(() => {
    const wsMarketRows = onchainSidebarPositions
      .filter((p) => outcomeTokenBelongsToSelectedMarket(p.tokenId, selectedMarket, marketLookup))
      .map((p) => ({ tokenId: p.tokenId, size: p.size, avgPrice: p.avgPrice }));
    if (liveTradesSource === 'onchain') {
      return wsMarketRows.map((p) => ({ asset: p.tokenId, size: p.size, avgPrice: p.avgPrice }));
    }
    const restMarket = positions.filter((p) =>
      outcomeTokenBelongsToSelectedMarket(String(p.asset || '').trim(), selectedMarket, marketLookup),
    );
    return mergeSidebarPositionsWsRest(restMarket, wsMarketRows);
  }, [liveTradesSource, positions, selectedMarket, marketLookup, onchainSidebarPositions]);

  const mergeEligible = useMemo(() => {
    if (!selectedMarket?.clobTokenIds || selectedMarket.clobTokenIds.length < 2) {
      return { showButton: false, canOpenDialog: false, maxMerge: 0, conditionId: '' };
    }
    const yesT = selectedMarket.clobTokenIds[0] || '';
    const noT = selectedMarket.clobTokenIds[1] || '';
    const yesP = myPositions.find((p) => (p.asset || '').trim() === yesT);
    const noP = myPositions.find((p) => (p.asset || '').trim() === noT);
    const yesSz = yesP?.size || 0;
    const noSz = noP?.size || 0;
    if (yesSz <= 0 || noSz <= 0) {
      return { showButton: false, canOpenDialog: false, maxMerge: 0, conditionId: '' };
    }
    let conditionId = (selectedMarket.conditionId || '').trim();
    if (!conditionId && yesP && typeof (yesP as { conditionId?: string }).conditionId === 'string') {
      conditionId = String((yesP as { conditionId?: string }).conditionId).trim();
    }
    const maxMerge = Math.min(yesSz, noSz);
    const canOpenDialog = !!conditionId && !!mergeFunderWallet;
    return { showButton: true, canOpenDialog, maxMerge, conditionId };
  }, [selectedMarket, myPositions, mergeFunderWallet]);

  const { myOrders, progOrders } = useMemo(() => {
    const all = orders.filter((o) => outcomeTokenBelongsToSelectedMarket(getOrderClobTokenId(o), selectedMarket, marketLookup));
    const sideRank = (side: string | undefined) => {
      const s = (side || '').toUpperCase();
      if (s === 'BUY') return 0;
      if (s === 'SELL') return 1;
      return 2;
    };
    const sortBuyFirst = <T extends { side?: string }>(arr: T[]) =>
      [...arr].sort((a, b) => sideRank(a.side) - sideRank(b.side));
    return {
      myOrders: sortBuyFirst(all.filter((o) => !progOrderMap[o.id])),
      progOrders: sortBuyFirst(all.filter((o) => !!progOrderMap[o.id])),
    };
  }, [orders, progOrderMap, selectedMarket, marketLookup]);
  const myTrades = useMemo(() => {
    if (liveTradesSource !== 'onchain') {
      return trades.filter((t) => tradeMatchesSelectedMarket(t, selectedMarket, marketLookup));
    }
    const rows = onchainSidebarTrades.filter((f) =>
      outcomeTokenBelongsToSelectedMarket(String(f.tokenId || '').trim(), selectedMarket, marketLookup),
    );
    return rows
      .sort((a, b) => b.blockTime - a.blockTime)
      .map((f) => ({
        asset_id: f.tokenId,
        token_id: f.tokenId,
        side: f.side,
        price: String(f.price),
        size: String(f.size),
        fee: String(f.fee || 0),
        timestamp: f.blockTime > 0 ? f.blockTime * 1000 : Date.now(),
        created_at: '',
        matchTime: '',
      }));
  }, [liveTradesSource, trades, selectedMarket, marketLookup, onchainSidebarTrades]);
  const myTradesDisplay = useMemo(
    /** Hard cap to ~100 rendered rows — older context not useful in sidebar and each row mounts an anchor + SVG. */
    () => (liveTradesSource === 'onchain' ? myTrades.slice(0, 100) : myTrades.slice(0, 20)),
    [liveTradesSource, myTrades],
  );
  const myOnchainWalletLower = (walletForLivePositions || '').toLowerCase();
  const myTradesPnl = useMemo(() => {
    let totalSellCost = 0;
    let totalBuyCost = 0;
    for (const trade of myTradesDisplay) {
      const rawPrice = parseFloat(trade.price);
      const size = tradeFilledSizeShares(trade);
      if (!Number.isFinite(rawPrice) || !Number.isFinite(size)) continue;
      const cost = rawPrice * size;
      if (trade.side === 'SELL' || trade.side === 'MERGE') totalSellCost += cost;
      else if (trade.side === 'BUY' || trade.side === 'SPLIT') totalBuyCost += cost;
    }
    return totalSellCost - totalBuyCost;
  }, [myTradesDisplay]);

  // Build set of user order prices for sidebar OB highlighting
  const sidebarUserBidPrices = useMemo(() => {
    const s = new Set<string>();
    const tokenId = selectedMarket?.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1] || '';
    if (!tokenId) return s;
    for (const o of orders) {
      const oid = o.asset_id || o.token_id || '';
      if (oid === tokenId && o.side === 'BUY') s.add((parseFloat(o.price) * 100).toFixed(1));
    }
    return s;
  }, [orders, selectedMarket, orderOutcome]);
  const sidebarUserAskPrices = useMemo(() => {
    const s = new Set<string>();
    const tokenId = selectedMarket?.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1] || '';
    if (!tokenId) return s;
    for (const o of orders) {
      const oid = o.asset_id || o.token_id || '';
      if (oid === tokenId && o.side === 'SELL') s.add((parseFloat(o.price) * 100).toFixed(1));
    }
    return s;
  }, [orders, selectedMarket, orderOutcome]);

  // Compute BS probability for orderbook % diff
  const vwapData = useAppStore((s) => s.vwapData);
  const priceData = useAppStore((s) => s.priceData);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);
  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const lastUpdated = useAppStore((s) => s.lastUpdated);

  const selectedMarketIsHit = useMemo(
    () => isMarketInWeeklyHitMarkets(selectedMarket?.id, weeklyHitMarkets),
    [selectedMarket?.id, weeklyHitMarkets],
  );

  const _bsProbCents = useMemo(() => {
    if (!selectedMarket) return 0;
    const asset = extractAssetFromMarket(selectedMarket);
    const strike = selectedMarket.groupItemTitle || '';
    const endDate = selectedMarket.endDate || '';
    if (!asset || !strike || !endDate) return 0;
    const sym = (asset + 'USDT') as AssetSymbol;
    const livePrice = vwapData[sym]?.price || priceData[sym]?.price || 0;
    if (!livePrice) return 0;
    const sigma = (volatilityData[sym] || 0.60) * volMultiplier;
    const cleaned = strike.replace(/^Hit\s*/i, '').replace(/[\$,]/g, '').replace(/↑/g, '>').replace(/↓/g, '<').trim();
    const ps = (cleaned.startsWith('>') || cleaned.startsWith('<') || cleaned.includes('-')) ? cleaned : '>' + cleaned;
    const probYes = selectedMarketIsHit
      ? getHitMarketProbability(ps, livePrice, endDate, sigma, bsTimeOffsetHours)
      : getMarketProbability(ps, livePrice, endDate, sigma, bsTimeOffsetHours);
    if (probYes === null) return 0;
    const prob = orderOutcome === 'YES' ? probYes : 1 - probYes;
    return prob * 100;
  }, [selectedMarket, orderOutcome, vwapData, priceData, volatilityData, volMultiplier, bsTimeOffsetHours, selectedMarketIsHit]);


  // Up or Down market detection and state
  const [upDownTargetPrice, setUpDownTargetPrice] = useState<number | null>(null);
  const isUpDownMarket = !!(selectedMarket?.question?.match(/up\s+or\s+down/i) || selectedMarket?.eventSlug?.match(/up-or-down|updown/i));

  useEffect(() => {
    const slot = readOrderExpirySlot(isUpDownMarket);
    setOrderExpiry(slot.value);
    setOrderExpiryUnit(slot.unit);
  }, [isUpDownMarket, selectedMarket?.id]);

  const sidebarSpotCurrentPriceRef = useRef<HTMLDivElement>(null);
  const prevPriceRef = useRef<number>(0);
  const [upDownCountdown, setUpDownCountdown] = useState('');
  const [upDownRemaining, setUpDownRemaining] = useState(Infinity);
  /** Countdown stops calling setState after "Expired"; pulse keeps re-reading `upOrDownMarkets` until next window arrives. */
  const [expiredLivePickPulse, setExpiredLivePickPulse] = useState(0);

  // Chainlink spot only for 5m/15m Up/Down; 1h/4h/24h use Binance in UI
  const upDownAsset = isUpDownMarket ? extractAssetFromMarket(selectedMarket!) : null;
  const upDownSpotUsesChainlink = useMemo(
    () => !!(isUpDownMarket && selectedMarket && upDownMarketUsesChainlinkSpot(selectedMarket)),
    [isUpDownMarket, selectedMarket],
  );
  const upDownIntervalContext = useMemo(() => {
    if (!isUpDownMarket || !selectedMarket) return undefined;
    return `${selectedMarket.eventSlug || ''} ${selectedMarket.question || ''} ${selectedMarket.groupItemTitle || ''}`.trim();
  }, [isUpDownMarket, selectedMarket?.eventSlug, selectedMarket?.question, selectedMarket?.groupItemTitle]);
  /** Default kline size for right chart; 1h (explicit or implicit) → 5m — aligned with upDownStartTime window detection. */
  const upDownKlineDefaultInterval = useMemo((): string | undefined => {
    if (!isUpDownMarket || !selectedMarket) return undefined;
    const combined = `${selectedMarket.eventSlug || ''} ${selectedMarket.question || ''}`;
    if (combined.match(/updown-5m/i) || combined.match(/\b5[- ]?min/i)) return '1m';
    if (combined.match(/updown-15m/i) || combined.match(/\b15[- ]?min/i)) return '1m';
    if (combined.match(/updown-4h/i) || combined.match(/\b4[- ]?h/i)) return '15m';
    if (combined.match(/up-or-down-on-/i) || combined.match(/\b24[- ]?h/i)) return '15m';
    return '5m';
  }, [isUpDownMarket, selectedMarket?.eventSlug, selectedMarket?.question]);
  const polyPrice = usePolymarketPrice(upDownSpotUsesChainlink ? upDownAsset : null);

  // Compute market start time for Up or Down charts
  const upDownStartTime = useMemo(() => {
    if (!isUpDownMarket || !selectedMarket?.endDate) return 0;
    const endMs = new Date(selectedMarket.endDate).getTime();
    if (isNaN(endMs)) return 0;
    const slug = selectedMarket.eventSlug || '';
    const q = selectedMarket.question || '';
    const combined = `${slug} ${q}`;
    let intervalMs = 60 * 60 * 1000;
    if (combined.match(/updown-5m/i) || combined.match(/\b5[- ]?min/i)) intervalMs = 5 * 60 * 1000;
    else if (combined.match(/updown-15m/i) || combined.match(/\b15[- ]?min/i)) intervalMs = 15 * 60 * 1000;
    else if (combined.match(/updown-4h/i) || combined.match(/\b4[- ]?h/i)) intervalMs = 4 * 60 * 60 * 1000;
    else if (combined.match(/up-or-down-on-/i) || combined.match(/\b24[- ]?h/i)) intervalMs = 24 * 60 * 60 * 1000;
    return endMs - intervalMs;
  }, [isUpDownMarket, selectedMarket?.endDate, selectedMarket?.eventSlug, selectedMarket?.question]);

  const liveUpDownSameTfMarket = useMemo(() => {
    if (!isUpDownMarket || !selectedMarket || !isMarketExpired || !upDownAsset) return null;
    const tf = upDownTimeframeKeyFromMarket(selectedMarket);
    if (!tf) return null;
    const live = pickLiveUpDownMarketInTfBucket(upOrDownMarkets[upDownAsset]?.[tf]);
    if (!live || live.id === selectedMarket.id) return null;
    return live;
  }, [isUpDownMarket, selectedMarket, isMarketExpired, upDownAsset, upOrDownMarkets, lastUpdated, expiredLivePickPulse]);

  useEffect(() => {
    if (!selectedMarket) {
      autoSwitchPrevSelectedIdRef.current = null;
      autoSwitchPrevExpiredRef.current = false;
      return;
    }
    const id = selectedMarket.id;
    if (id !== autoSwitchPrevSelectedIdRef.current) {
      autoSwitchPrevSelectedIdRef.current = id;
      autoSwitchPrevExpiredRef.current = isMarketExpired;
      return;
    }
    const transitionedToExpired = !autoSwitchPrevExpiredRef.current && isMarketExpired;
    autoSwitchPrevExpiredRef.current = isMarketExpired;

    if (!autoSwitchNextMarketOnExpiry || !transitionedToExpired) return;
    const lookup = useAppStore.getState().marketLookup;
    const next = pickNextMarketOnExpiry(selectedMarket, Date.now(), upOrDownMarkets, lookup);
    if (next) setSelectedMarket(next);
  }, [
    autoSwitchNextMarketOnExpiry,
    isMarketExpired,
    selectedMarket,
    upOrDownMarkets,
    lastUpdated,
    marketLookupEpoch,
    setSelectedMarket,
  ]);

  // Target price: use priceToBeat from Gamma API (set by backend), fallback to crypto-price API
  // Look up fresh priceToBeat from marketLookup (refreshes every 30s) since selectedMarket is a stale snapshot
  const livePriceToBeat = useMemo(() => {
    if (!selectedMarket?.clobTokenIds?.[0]) return selectedMarket?.priceToBeat;
    const fresh = marketLookup[selectedMarket.clobTokenIds[0]];
    return fresh?.priceToBeat || selectedMarket?.priceToBeat;
  }, [selectedMarket?.clobTokenIds, selectedMarket?.priceToBeat, marketLookup]);

  useEffect(() => {
    setUpDownTargetPrice(null);
    if (!isUpDownMarket || !selectedMarket?.endDate) return;

    // Prefer priceToBeat from backend cache (Gamma API eventMetadata)
    if (livePriceToBeat) {
      setUpDownTargetPrice(livePriceToBeat);
      return;
    }

    const endMs = new Date(selectedMarket.endDate).getTime();
    if (isNaN(endMs)) return;
    const slug = selectedMarket.eventSlug || '';
    const q = selectedMarket.question || '';
    const combined = `${slug} ${q}`;
    const is5m = !!(combined.match(/updown-5m/i) || combined.match(/\b5[- ]?min/i));

    if (is5m) {
      // 5m markets: priceToBeat comes from backend Chainlink collector via market refresh.
      // Nothing to fetch here — it will arrive with the next market data refresh.
      return;
    }
    if (!upDownCryptoTimeframe(combined)) return;

    const asset = extractAssetFromMarket(selectedMarket);
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const p = await fetchUpDownTargetFromCrypto(API_BASE, asset, endMs, combined);
      if (!cancelled && p != null) setUpDownTargetPrice(p);
    };
    void tick();
    // Hourly openPrice often lags ~5m; retry briefly so target appears as soon as the API has it.
    const iv = setInterval(() => void tick(), 12_000);
    const stopIv = setTimeout(() => clearInterval(iv), 150_000);
    return () => {
      cancelled = true;
      clearInterval(iv);
      clearTimeout(stopIv);
    };
  }, [isUpDownMarket, selectedMarket?.endDate, selectedMarket?.eventSlug, selectedMarket, livePriceToBeat]);

  // Countdown timer for market expiry (all markets)
  useEffect(() => {
    if (!selectedMarket?.endDate) { setUpDownCountdown(''); return; }
    const endMs = new Date(selectedMarket.endDate).getTime();
    if (isNaN(endMs)) { setUpDownCountdown(''); return; }
    const tick = () => {
      const remaining = endMs - Date.now();
      if (remaining <= 0) { setUpDownCountdown('Expired'); setUpDownRemaining(0); return; }
      setUpDownRemaining(remaining);
      const d = Math.floor(remaining / 86400000);
      const h = Math.floor((remaining % 86400000) / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      const parts = [];
      if (d > 0) parts.push(`${d}d`);
      if (h > 0) parts.push(`${h}h`);
      parts.push(`${m}m`);
      if (d === 0) parts.push(`${s}s`);
      setUpDownCountdown(parts.join(' '));
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [selectedMarket?.endDate]);

  useEffect(() => {
    if (upDownCountdown !== 'Expired' || !isUpDownMarket) return;
    const id = window.setInterval(() => setExpiredLivePickPulse((n) => n + 1), 1500);
    return () => clearInterval(id);
  }, [upDownCountdown, isUpDownMarket]);

  useEffect(() => {
    prevPriceRef.current = 0;
  }, [selectedMarket?.id]);

  /** Target | Math | Current row below charts (Up/Down + all strike markets). */
  const sidebarSpotStrip = useMemo(() => {
    if (!selectedMarket?.endDate) return null;
    const endDate = selectedMarket.endDate;
    const asset = extractAssetFromMarket(selectedMarket);
    if (!asset) return null;
    const sym = (asset + 'USDT') as AssetSymbol;
    const sigma = (volatilityData[sym] || 0.60) * volMultiplier;
    const priceDec = asset.toUpperCase() === 'XRP' ? 4 : 2;

    const nowOffset = Date.now() + bsTimeOffsetHours * 3600000;
    const expiryMs = new Date(endDate).getTime();
    const pastExpiry = bsTimeOffsetHours > 0 && nowOffset >= expiryMs;

    if (isUpDownMarket) {
      const binanceSym = (asset.toUpperCase() + 'USDT') as AssetSymbol;
      const chainlinkPrice =
        upDownSpotUsesChainlink && polyPrice.price != null && polyPrice.price > 0 ? polyPrice.price : 0;
      const binancePrice = priceData[binanceSym]?.price || 0;
      const currentPrice = upDownSpotUsesChainlink ? chainlinkPrice || binancePrice : binancePrice;
      const currentSource: 'chainlink' | 'binance' =
        upDownSpotUsesChainlink && chainlinkPrice > 0 ? 'chainlink' : 'binance';

      let mathCents: number | null = null;
      let yesMathCents: number | null = null;
      if (!pastExpiry && upDownTargetPrice && currentPrice) {
        const probUp = getMarketProbability('>' + upDownTargetPrice, currentPrice, endDate, sigma, bsTimeOffsetHours);
        if (probUp !== null) {
          yesMathCents = probUp * 100;
          mathCents = (orderOutcome === 'YES' ? probUp : 1 - probUp) * 100;
        }
      }

      const diff =
        upDownTargetPrice && currentPrice
          ? (() => {
              const signedDelta = currentPrice - upDownTargetPrice;
              return {
                abs: Math.abs(signedDelta),
                pct: (signedDelta / upDownTargetPrice) * 100,
                isUp: signedDelta >= 0,
              };
            })()
          : null;

      return {
        mode: 'updown' as const,
        targetDisplay:
          upDownTargetPrice != null
            ? `$${upDownTargetPrice.toLocaleString(undefined, { minimumFractionDigits: priceDec, maximumFractionDigits: priceDec })}`
            : '...',
        priceDec,
        countdown: upDownCountdown,
        remaining: upDownRemaining,
        mathCents,
        yesMathCents,
        pastExpiry,
        currentPrice,
        currentSource,
        diff,
      };
    }

    const strikeRaw = (selectedMarket.groupItemTitle || '').trim();
    if (!strikeRaw) return null;

    const currentPrice = priceData[sym]?.price || 0;
    const currentSource = 'binance' as const;

    const cleaned = strikeRaw.replace(/^Hit\s*/i, '').replace(/[\$,]/g, '').replace(/↑/g, '>').replace(/↓/g, '<').trim();
    const ps = (cleaned.startsWith('>') || cleaned.startsWith('<') || cleaned.includes('-')) ? cleaned : '>' + cleaned;

    const targetDisplay =
      getMarketPriceCondition(
        selectedMarket.question || selectedMarket.groupItemTitle,
        selectedMarket.clobTokenIds?.[0],
        marketLookup,
      ) || formatPriceShort(ps, asset === 'ETH' ? 'ETH' : undefined);

    let mathCents: number | null = null;
    let yesMathCents: number | null = null;
    if (!pastExpiry && currentPrice > 0) {
      const probYes = selectedMarketIsHit
        ? getHitMarketProbability(ps, currentPrice, endDate, sigma, bsTimeOffsetHours)
        : getMarketProbability(ps, currentPrice, endDate, sigma, bsTimeOffsetHours);
      if (probYes !== null) {
        yesMathCents = probYes * 100;
        mathCents = (orderOutcome === 'YES' ? probYes : 1 - probYes) * 100;
      }
    }

    let diff: { abs: number; pct: number; isUp: boolean } | null = null;
    if (currentPrice > 0 && !ps.includes('-')) {
      let rest = ps.replace(/,/g, '');
      if (rest.startsWith('>') || rest.startsWith('<')) rest = rest.slice(1);
      let K: number;
      if (rest.toLowerCase().endsWith('k')) {
        const n = parseFloat(rest.slice(0, -1));
        if (isNaN(n) || n <= 0) K = NaN;
        else K = n * 1000;
      } else {
        K = parseFloat(rest);
      }
      if (!isNaN(K) && K > 0) {
        const signedDelta = currentPrice - K;
        diff = {
          abs: Math.abs(signedDelta),
          pct: (signedDelta / K) * 100,
          isUp: signedDelta >= 0,
        };
      }
    }

    return {
      mode: 'generic' as const,
      targetDisplay,
      priceDec,
      countdown: upDownCountdown,
      remaining: upDownRemaining,
      mathCents,
      yesMathCents,
      pastExpiry,
      currentPrice,
      currentSource,
      diff,
      hitModel: selectedMarketIsHit,
    };
  }, [
    selectedMarket,
    marketLookup,
    isUpDownMarket,
    upDownTargetPrice,
    upDownSpotUsesChainlink,
    polyPrice.price,
    priceData,
    volatilityData,
    volMultiplier,
    bsTimeOffsetHours,
    orderOutcome,
    selectedMarketIsHit,
    upDownCountdown,
    upDownRemaining,
  ]);

  useEffect(() => {
    const p = sidebarSpotStrip?.currentPrice;
    if (!p || p <= 0 || !sidebarSpotCurrentPriceRef.current) return;
    const el = sidebarSpotCurrentPriceRef.current;
    if (prevPriceRef.current && p !== prevPriceRef.current) {
      const cls = p > prevPriceRef.current ? 'updown-flash-up' : 'updown-flash-down';
      el.classList.remove('updown-flash-up', 'updown-flash-down');
      void el.offsetWidth;
      el.classList.add(cls);
    }
    prevPriceRef.current = p;
  }, [sidebarSpotStrip?.currentPrice]);

  const summaryPriceDecimal = useMemo(() => {
    if (orderKind === 'market') {
      if (orderSide === 'BUY') {
        const displayAsks = sidebarBookRef.current?.displayAsks ?? [];
        return displayAsks.length > 0 ? parseFloat(displayAsks[0].price) : MARKET_AGGRESSIVE_BUY;
      }
      const displayBids = sidebarBookRef.current?.displayBids ?? [];
      const bestBid = displayBids.length > 0 ? displayBids[displayBids.length - 1] : null;
      return bestBid ? parseFloat(bestBid.price) : MARKET_AGGRESSIVE_SELL;
    }
    return (parseFloat(orderPrice) || 0) / 100;
  }, [orderKind, orderSide, orderPrice, topOfBookDigest]);
  const cost = useMemo(() => {
    const a = parseFloat(orderAmount);
    if (!a) return 0;
    const p = summaryPriceDecimal;
    if (orderKind === 'limit' && (!orderPrice || !p)) return 0;
    if (orderSide === 'BUY') return p * a;
    return (1 - p) * a;
  }, [orderAmount, summaryPriceDecimal, orderSide, orderKind, orderPrice]);

  const payout = useMemo(() => {
    const a = parseFloat(orderAmount);
    if (!a) return 0;
    if (orderSide === 'SELL') {
      const p = summaryPriceDecimal;
      if (orderKind === 'limit' && (!orderPrice || !p)) return 0;
      return p * a;
    }
    return a;
  }, [orderAmount, orderSide, summaryPriceDecimal, orderKind, orderPrice]);

  const getOrderExpiryLeadSeconds = () => {
    const n = parseFloat(orderExpiry);
    if (!Number.isFinite(n) || n < 0) return 0;
    if (orderExpiryUnit === 's') return Math.floor(n);
    if (orderExpiryUnit === 'h') return Math.floor(n * 3600);
    return Math.floor(n * 60);
  };

  const computeLimitExpiration = (marketEndDate?: string): { expiration: number; invalidLead: boolean } => {
    const CLOB_MIN_EXPIRY_SEC = 90; // CLOB requires expiration >= now + 60s; use 90s buffer
    const expLeadSec = getOrderExpiryLeadSeconds();
    const nowSec = Math.floor(Date.now() / 1000);
    if (marketEndDate) {
      const endTimeSec = Math.floor(new Date(marketEndDate).getTime() / 1000);
      if (expLeadSec <= 0) {
        return { expiration: 0, invalidLead: false };
      }
      const expiration = endTimeSec - expLeadSec;
      const invalidLead = (endTimeSec - nowSec) <= expLeadSec;
      if (expiration - nowSec < CLOB_MIN_EXPIRY_SEC) {
        return { expiration: 0, invalidLead }; // too close → GTC fallback
      }
      return { expiration, invalidLead };
    }
    return { expiration: nowSec + 86400, invalidLead: false };
  };

  const formatPreExpiryLead = (orderExpiration?: string): string | null => {
    if (!orderExpiration || !selectedMarket?.endDate) return null;
    const endMs = new Date(selectedMarket.endDate).getTime();
    if (!Number.isFinite(endMs)) return null;

    const raw = Number(orderExpiration);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    const expMs = raw < 1e12 ? raw * 1000 : raw;

    const leadMs = endMs - expMs;
    if (leadMs <= 0) return null;

    const leadSec = leadMs / 1000;
    const leadMin = leadMs / 60000;
    const leadHr = leadMs / 3600000;
    if (leadSec < 60) return `${Math.round(leadSec)}s`;
    if (leadMin < 60) return `${Math.round(leadMin)}m`;
    if (leadHr < 48) return `${leadHr.toFixed(1)}h`;
    return `${(leadMs / 86400000).toFixed(1)}d`;
  };

  const marketName = selectedMarket
    ? shortenMarketName(selectedMarket.question || selectedMarket.groupItemTitle, undefined, undefined, selectedMarket.eventSlug)
    : '';

  /** Market FAK path shared by type dropdown Market and close-position ✕. */
  const submitSidebarMarketFak = useCallback(
    async (args: {
      tokenId: string;
      side: 'BUY' | 'SELL';
      size: number;
      orderInfo: string;
      bids: SidebarPolymarketBookSnapshot['displayBids'];
      asks: SidebarPolymarketBookSnapshot['displayAsks'];
      afterSuccess?: () => void;
    }) => {
      const { tokenId, side, size, orderInfo, bids, asks, afterSuccess } = args;
      if (side === 'BUY') {
        if (!asks.length) {
          showToast('No asks in book — cannot market buy', 'error');
          return;
        }
      } else if (!bids.length) {
        showToast('No bids in book — cannot market sell', 'error');
        return;
      }
      const price = side === 'BUY' ? MARKET_AGGRESSIVE_BUY : MARKET_AGGRESSIVE_SELL;
      try {
        const result = await placeOrder({
          tokenId,
          side,
          price,
          size,
          expiration: 0,
          orderType: 'FAK',
          orderInfo,
        });
        if (result.success) {
          showToast('Market order submitted', 'success');
          triggerWalletRefresh();
          afterSuccess?.();
        } else {
          showToast(result.error || 'Order failed', 'error');
        }
      } catch {
        showToast('Order failed', 'error');
      }
    },
    [],
  );

  const handleSubmitOrder = async () => {
    if (!selectedMarket) return;
    const tokenId = selectedMarket.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1];
    if (!tokenId) return;
    const displayBids = sidebarBookRef.current?.displayBids ?? [];
    const displayAsks = sidebarBookRef.current?.displayAsks ?? [];
    const size = parseFloat(orderAmount);

    if (!size) return;

    const isMarket = orderKind === 'market';
    if (isMarket) {
      await submitSidebarMarketFak({
        tokenId,
        side: orderSide,
        size,
        orderInfo: `${orderSide} ${size} ${orderOutcome} for ${marketName} (market FAK)`,
        bids: displayBids,
        asks: displayAsks,
      });
      return;
    }

    const price = parseFloat(orderPrice) / 100;
    if (!price) return;
    const orderPriceCents = parseFloat(orderPrice);
    const bestBidCents = displayBids.length > 0 ? parseFloat(displayBids[0].price) * 100 : null;
    const bestAskCents = displayAsks.length > 0 ? parseFloat(displayAsks[0].price) * 100 : null;
    const crossesBook =
      (orderSide === 'SELL' && bestBidCents !== null && orderPriceCents <= bestBidCents) ||
      (orderSide === 'BUY' && bestAskCents !== null && orderPriceCents >= bestAskCents);
    if (crossesBook) {
      const bestPrice = orderSide === 'SELL' ? bestBidCents : bestAskCents;
      const confirmed = await requestCrossingConfirm(bestPrice ?? 0);
      if (!confirmed) return;
    }

    let expiration: number | undefined;
    if (orderSide === 'SELL') {
      expiration = 0;
    } else {
      const exp = computeLimitExpiration(selectedMarket.endDate);
      expiration = exp.expiration;
      if (exp.invalidLead) {
        showToast('Lead time to expiration already passed for this market', 'error');
        return;
      }
    }
    const orderInfo = `${orderSide} ${size} ${orderOutcome} for ${marketName} @ ${orderPrice}¢`;
    try {
      const result = await placeOrder({
        tokenId,
        side: orderSide,
        price,
        size,
        expiration,
        orderInfo,
      });
      if (result.success) {
        showToast('Order placed', 'success');
        triggerWalletRefresh();
      } else {
        showToast(result.error || 'Order failed', 'error');
      }
    } catch (e) {
      showToast('Order failed', 'error');
    }
  };

  const handleCreateCustomButton = () => {
    const priceCents = parseFloat(customPrice);
    const label = customLabel.trim();
    if (!label) { showToast('Enter button label (1-3 chars)', 'error'); return; }
    if (!Number.isFinite(priceCents) || priceCents <= 0 || priceCents >= 100) { showToast('Invalid price', 'error'); return; }
    if (label.length < 1 || label.length > 3) { showToast('Button label must be 1-3 characters', 'error'); return; }

    const next: CustomSidebarButton = {
      id: editingCustomButtonId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      side: customSide,
      priceCents,
      maxSell: customSide === 'SELL' ? customSellMax : false,
      label,
      color: customColor,
    };
    if (editingCustomButtonId) {
      setCustomButtons((prev) => prev.map((b) => (b.id === editingCustomButtonId ? next : b)));
    } else {
      setCustomButtons((prev) => [...prev, next]);
    }
    setEditingCustomButtonId(null);
    setCustomDialogOpen(false);
  };

  const handleRemoveCustomButton = (id: string) => {
    setCustomButtons((prev) => prev.filter((b) => b.id !== id));
  };

  const handleEditCustomButton = (btn: CustomSidebarButton) => {
    setEditingCustomButtonId(btn.id);
    setCustomSide(btn.side);
    setCustomPrice(String(btn.priceCents));
    setCustomSellMax(!!btn.maxSell);
    setCustomLabel(btn.label);
    setCustomColor(btn.color);
    setCustomDialogOpen(true);
  };

  const handleCustomButtonClick = async (btn: CustomSidebarButton) => {
    if (!selectedMarket) return;
    const displayBids = sidebarBookRef.current?.displayBids ?? [];
    const displayAsks = sidebarBookRef.current?.displayAsks ?? [];
    const tokenId = selectedMarket.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1];

    if (!tokenId) return;

    let size = parseFloat(orderAmount);
    if (btn.side === 'SELL' && btn.maxSell) {
      const pos = positions.find((p) => p.asset === tokenId && p.size > 0);
      size = pos ? Math.floor(pos.size * 100) / 100 : 0;
    }
    if (!size || size <= 0) {
      showToast(btn.side === 'SELL' && btn.maxSell ? 'No position size available for MAX sell' : 'Invalid amount', 'error');
      return;
    }

    let expiration = 0;
    if (btn.side === 'BUY') {
      const exp = computeLimitExpiration(selectedMarket.endDate);
      expiration = exp.expiration;
      if (exp.invalidLead) {
        showToast('Lead time to expiration already passed for this market', 'error');
        return;
      }
    }

    const bestBidCents = displayBids.length > 0 ? parseFloat(displayBids[0].price) * 100 : null;
    const bestAskCents = displayAsks.length > 0 ? parseFloat(displayAsks[0].price) * 100 : null;
    const crossesBook =
      (btn.side === 'SELL' && bestBidCents !== null && btn.priceCents <= bestBidCents) ||
      (btn.side === 'BUY' && bestAskCents !== null && btn.priceCents >= bestAskCents);
    if (crossesBook) {
      const bestPrice = btn.side === 'SELL' ? bestBidCents : bestAskCents;
      const confirmed = await requestCrossingConfirm(bestPrice ?? 0);
      if (!confirmed) return;
    }

    const result = await placeOrder({
      tokenId,
      side: btn.side,
      price: btn.priceCents / 100,
      size,
      expiration,
      orderInfo: `${btn.side} ${size} ${orderOutcome} for ${marketName} @ ${btn.priceCents}¢`,
    });
    if (result.success) {
      showToast('Custom order placed', 'success');
      triggerWalletRefresh();
    } else {
      showToast(result.error || 'Custom order failed', 'error');
    }
  };

  const reorderCustomButtons = (fromId: string, toId: string) => {
    if (!fromId || !toId || fromId === toId) return;
    setCustomButtons((prev) => {
      const fromIdx = prev.findIndex((b) => b.id === fromId);
      const toIdx = prev.findIndex((b) => b.id === toId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const handleCancelOrder = async (orderId: string) => {
    setCancellingOrderIds(prev => new Set(prev).add(orderId));
    try {
      const result = await cancelOrder(orderId);
      if (result.success) {
        showToast('Order cancelled', 'success');
        triggerWalletRefresh();
      } else {
        showToast(result.error || 'Cancel failed', 'error');
      }
    } catch {
      showToast('Cancel failed', 'error');
    } finally {
      setCancellingOrderIds(prev => { const s = new Set(prev); s.delete(orderId); return s; });
    }
  };

  const handleReplaceOrder = async (orderId: string, newPriceCents: number, tokenId: string, side: 'BUY' | 'SELL', size: number) => {
    const displayBids = sidebarBookRef.current?.displayBids ?? [];
    const displayAsks = sidebarBookRef.current?.displayAsks ?? [];
    const newPrice = newPriceCents / 100;

    if (!newPrice || newPrice <= 0 || newPrice >= 1 || !size) { setEditingOrderId(null); return; }
    const bestBidCents = displayBids.length > 0 ? parseFloat(displayBids[0].price) * 100 : null;
    const bestAskCents = displayAsks.length > 0 ? parseFloat(displayAsks[0].price) * 100 : null;
    const crossesBook =
      (side === 'SELL' && bestBidCents !== null && newPriceCents <= bestBidCents) ||
      (side === 'BUY' && bestAskCents !== null && newPriceCents >= bestAskCents);
    if (crossesBook) {
      const bestPrice = side === 'SELL' ? bestBidCents : bestAskCents;
      const confirmed = await requestCrossingConfirm(bestPrice ?? 0);
      if (!confirmed) {
        setEditingOrderId(null);
        return;
      }
    }
    const outcome = getTokenOutcome(tokenId, marketLookup);
    const orderInfo = `${side} ${size} ${outcome} for ${marketName} @ ${newPriceCents}¢`;
    signingDialog.open(false, { title: 'Replacing Order', signLabel: 'Sign new order in wallet', submitLabel: 'Cancel old & submit new', orderInfo });
    try {
      // Step 1: Sign new order (wallet popup) — user can reject here without affecting old order
      signingDialog.setStep('sign', 'active');
      let expiration = 0;
      if (side === 'BUY') {
        const exp = computeLimitExpiration(selectedMarket?.endDate);
        expiration = exp.expiration;
        if (exp.invalidLead) {
          showToast('Lead time to expiration already passed for this market', 'error');
          setEditingOrderId(null);
          return;
        }
      }

      const signResult = await signOrder({
        tokenId,
        side,
        price: newPrice,
        size,
        expiration,
      });
      if (!signResult.success || !signResult.signedPayload) {
        signingDialog.setStep('sign', 'error', signResult.error || 'Signing failed');
        showToast(signResult.error || 'Signing failed', 'error');
        setEditingOrderId(null);
        return;
      }
      signingDialog.setStep('sign', 'done');

      // Step 2: Cancel old order to free up balance
      signingDialog.setStep('submit', 'active');
      const cancelResult = await cancelOrder(orderId);
      if (!cancelResult.success) {
        signingDialog.setStep('submit', 'error', cancelResult.error || 'Cancel old order failed');
        showToast(cancelResult.error || 'Cancel old order failed', 'error');
        setEditingOrderId(null);
        return;
      }

      // Step 3: Submit the pre-signed new order
      const submitResult = await submitSignedOrder(signResult.signedPayload);
      if (!submitResult.success) {
        signingDialog.setStep('submit', 'error', submitResult.error || 'Submit failed');
        showToast(submitResult.error || 'Submit failed (resting order was already cancelled)', 'error');
        setEditingOrderId(null);
        return;
      }
      signingDialog.setStep('submit', 'done');
      setTimeout(() => signingDialog.close(), 1200);
      showToast('Order replaced', 'success');
      triggerWalletRefresh();
    } catch {
      signingDialog.setStep('submit', 'error', 'Replace failed');
      showToast('Replace failed', 'error');
    }
    setEditingOrderId(null);
  };

  const setOrderPriceDecimal = (decimal: number) => {
    const current = parseFloat(orderPrice) || 0;
    const base = Math.floor(current);
    setOrderPrice(String(base + decimal));
  };

  const adjustOrderPriceCents = (deltaCents: number) => {
    const current = parseFloat(orderPrice) || 0;
    const next = Math.max(0.1, Math.min(99.9, current + deltaCents));
    setOrderPrice(next.toFixed(1).replace(/\.0$/, ''));
  };

  const setOrderAmountDollar = (dollars: number) => {
    if (orderKind === 'market') {
      setOrderAmount(String(dollars));
      return;
    }
    const price = parseFloat(orderPrice) / 100;
    if (price > 0) {
      const shares = Math.floor(dollars / price);
      setOrderAmount(String(shares));
    }
  };

  /** Close ✕ uses same FAK + liquidity gate as sidebar type Market. */
  const handleClosePosition = useCallback(
    async (tokenId: string, rawSize: number) => {
      const tid = String(tokenId || '').trim();
      const size = Math.floor(rawSize * 100) / 100;
      if (!tid || !selectedMarket || !size || size <= 0) return;
      const displayBids = sidebarBookRef.current?.displayBids ?? [];
      const displayAsks = sidebarBookRef.current?.displayAsks ?? [];
      const sidebarBookToken = selectedMarket.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1] || '';
      const sameBook = tid === sidebarBookToken;
      const bestBid = marketLookup[tid]?.bestBid;
      const hasBidsFromLookup = typeof bestBid === 'number' && Number.isFinite(bestBid) && bestBid > 0;
      const bids =
        sameBook && displayBids.length > 0
          ? displayBids
          : !sameBook && hasBidsFromLookup
            ? [{ price: String(bestBid), size: '1' }]
            : [];
      const bestAsk = marketLookup[tid]?.bestAsk;
      const hasAsksFromLookup = typeof bestAsk === 'number' && Number.isFinite(bestAsk) && bestAsk > 0;
      const asks =
        sameBook && displayAsks.length > 0
          ? displayAsks
          : !sameBook && hasAsksFromLookup
            ? [{ price: String(bestAsk), size: '1' }]
            : [];
      setClosingPositionTokens((prev) => new Set(prev).add(tid));
      try {
        const outcome = getTokenOutcome(tid, marketLookup);
        const ol = isUpDownMarket ? (outcome === 'YES' ? 'UP' : 'DOWN') : outcome;
        await submitSidebarMarketFak({
          tokenId: tid,
          side: 'SELL',
          size,
          orderInfo: `SELL ${size} ${ol} close position (${marketName})`,
          bids,
          asks,
          afterSuccess: () => {
            if (liveTradesSource === 'onchain') refreshWallet();
          },
        });
      } finally {
        setClosingPositionTokens((prev) => {
          const s = new Set(prev);
          s.delete(tid);
          return s;
        });
      }
    },
    [
      selectedMarket,
      orderOutcome,
      marketLookup,
      isUpDownMarket,
      marketName,
      liveTradesSource,
      refreshWallet,
      submitSidebarMarketFak,
    ],
  );

  const fullMarketName = selectedMarket ? (selectedMarket.question || selectedMarket.groupItemTitle || '') : '';

  const sidebarAsset = selectedMarket ? extractAssetFromMarket(selectedMarket) : '';
  const assetColorMap: Record<string, string> = { BTC: 'text-orange-400', ETH: 'text-blue-400', SOL: 'text-purple-400', XRP: 'text-cyan-400' };
  const sidebarTitleColor = selectedMarket ? (assetColorMap[sidebarAsset] || 'text-gray-500') : 'text-white';
  const polymarketUrl = selectedMarket?.eventSlug ? `https://polymarket.com/event/${selectedMarket.eventSlug}?r=mito` : null;
  const sidebarSectionHeight = 'max(100px, calc((100vh - 44px) * 0.15))';
  const sidebarDoubleSectionHeight = 'max(100px, calc((100vh - 44px) * 0.30))';
  const collapsedSectionHeight = '36px';
  const orderbookSectionHeight = liveOrderbookExpanded ? sidebarSectionHeight : collapsedSectionHeight;
  const liveTradesSectionHeight = liveTradesExpanded
    ? (liveOrderbookExpanded ? sidebarSectionHeight : sidebarDoubleSectionHeight)
    : collapsedSectionHeight;
  const [isMobileSheet, setIsMobileSheet] = useState(() => window.innerWidth < 768);
  const [mobileDragOffset, setMobileDragOffset] = useState(0);
  const [mobileDragging, setMobileDragging] = useState(false);
  const mobileDragStartYRef = useRef<number | null>(null);

  useEffect(() => {
    const onResize = () => setIsMobileSheet(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) {
      setMobileDragOffset(0);
      setMobileDragging(false);
      mobileDragStartYRef.current = null;
    }
  }, [sidebarOpen]);

  const startMobileDrag = (clientY: number) => {
    if (!isMobileSheet || !sidebarOpen) return;
    mobileDragStartYRef.current = clientY;
    setMobileDragging(true);
    setMobileDragOffset(0);
  };

  const moveMobileDrag = (clientY: number) => {
    if (!mobileDragging || mobileDragStartYRef.current == null) return;
    const delta = Math.max(0, clientY - mobileDragStartYRef.current);
    setMobileDragOffset(delta);
  };

  const endMobileDrag = () => {
    if (!mobileDragging) return;
    const closeThresholdPx = 90;
    if (mobileDragOffset > closeThresholdPx) {
      setSidebarOpen(false);
    }
    setMobileDragging(false);
    setMobileDragOffset(0);
    mobileDragStartYRef.current = null;
  };

  const handleMergeSubmit = useCallback(
    async (amount: number) => {
      if (!mergeEligible.conditionId || !mergeFunderWallet) {
        return { success: false, error: 'Missing condition id or proxy wallet' };
      }
      const res = await executeMergePositions({
        conditionId: mergeEligible.conditionId,
        amount,
        funderAddress: mergeFunderWallet,
      });
      if (res.success) {
        showToast('Merge confirmed', 'success');
        triggerWalletRefresh();
        if (liveTradesSource === 'onchain') refreshWallet();
      } else {
        showToast(res.error, 'error');
      }
      return res;
    },
    [mergeEligible.conditionId, mergeFunderWallet, liveTradesSource, refreshWallet],
  );

  return (
    <>
    {mergeDialogOpen && !!mergeEligible.conditionId && (
      <Suspense fallback={null}>
        <MergePositionsDialogLazy
          open
          onClose={() => setMergeDialogOpen(false)}
          maxShares={mergeEligible.maxMerge}
          conditionId={mergeEligible.conditionId}
          title={fullMarketName || marketName}
          outcomePairLabel={isUpDownMarket ? 'UP / DOWN' : 'YES / NO'}
          onSubmit={handleMergeSubmit}
        />
      </Suspense>
    )}
    {toxicDialogOpen && !!selectedMarket?.conditionId?.trim() && (
      <Suspense fallback={null}>
        <ToxicFlowDialogLazy
          open
          marketId={selectedMarket?.conditionId || ''}
          marketName={marketName}
          yesTokenId={selectedMarket?.clobTokenIds?.[0] || ''}
          onClose={() => setToxicDialogOpen(false)}
        />
      </Suspense>
    )}
    {notifyDialogOpen && typeof document !== 'undefined' &&
      createPortal(
        <div
          className="fixed inset-0 z-[60200] bg-black/70 flex items-center justify-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setNotifyDialogOpen(false);
          }}
        >
          <div
            className="w-full max-w-sm mx-4 rounded-lg border border-gray-600 bg-gray-800 p-4"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-bold text-white">Tilt notifications</div>
              <button
                type="button"
                className="p-1 rounded hover:bg-gray-700 text-gray-400"
                aria-label="Close"
                onClick={() => setNotifyDialogOpen(false)}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
            <div className="space-y-3 text-xs text-gray-200">
              <div className="border border-gray-600/80 rounded-md p-2 space-y-2 bg-gray-900/40">
                <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Markets</div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded accent-amber-500"
                    checked={notifyTiltMktUpDown}
                    onChange={(e) => setNotifyTiltMktUpDown(e.target.checked)}
                  />
                  <span>Up or Down</span>
                </label>
                {notifyTiltMktUpDown ? (
                  <div className="pl-5 flex flex-wrap gap-x-3 gap-y-1.5 border-l border-gray-600 ml-1">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded accent-amber-500"
                        checked={notifyTiltUd5m}
                        onChange={(e) => setNotifyTiltUd5m(e.target.checked)}
                      />
                      <span>5m</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded accent-amber-500"
                        checked={notifyTiltUd15m}
                        onChange={(e) => setNotifyTiltUd15m(e.target.checked)}
                      />
                      <span>15m</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded accent-amber-500"
                        checked={notifyTiltUd1h}
                        onChange={(e) => setNotifyTiltUd1h(e.target.checked)}
                      />
                      <span>1h</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded accent-amber-500"
                        checked={notifyTiltUd4h}
                        onChange={(e) => setNotifyTiltUd4h(e.target.checked)}
                      />
                      <span>4h</span>
                    </label>
                  </div>
                ) : null}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded accent-amber-500"
                    checked={notifyTiltMktHit}
                    onChange={(e) => setNotifyTiltMktHit(e.target.checked)}
                  />
                  <span>Hit</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded accent-amber-500"
                    checked={notifyTiltMktAbove}
                    onChange={(e) => setNotifyTiltMktAbove(e.target.checked)}
                  />
                  <span>Above</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded accent-amber-500"
                    checked={notifyTiltMktBetween}
                    onChange={(e) => setNotifyTiltMktBetween(e.target.checked)}
                  />
                  <span>Between</span>
                </label>
                <p className="text-[10px] text-gray-500 m-0">Sound and flash only for checked market types.</p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded accent-amber-500"
                  checked={notifyPlaySound}
                  onChange={(e) => setNotifyPlaySound(e.target.checked)}
                />
                <span>Play Sound</span>
              </label>
              <div className={notifyPlaySound ? '' : 'opacity-50 pointer-events-none'}>
                <div className="text-gray-400 mb-1">Sound frequency</div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={notifySoundFreqSlider}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      const nv = Math.min(100, Math.max(0, Math.round(v)));
                      setNotifySoundFreqSlider(nv);
                      const now = Date.now();
                      if (now - freqSliderPreviewLastMs.current < 160) return;
                      freqSliderPreviewLastMs.current = now;
                      void playTiltNotifySoundWithDoubleRing(
                        'green',
                        pitchMulFromNotifyFreqSlider(nv),
                        notifyRingTimeS,
                        notifyDoubleRing,
                      );
                    }}
                    className="flex-1 min-w-0 accent-amber-500 h-2"
                    aria-label="Notification sound frequency"
                  />
                  <span className="text-gray-300 tabular-nums w-8 text-right shrink-0">{notifySoundFreqSlider}</span>
                </div>
                <p className="text-[10px] text-gray-500 mt-1">Left = much lower, right = much higher (×0.25–×4 at ends; center = normal).</p>
                <div className="flex items-center gap-2 flex-wrap mt-3">
                  <span className="text-gray-400 shrink-0">Ring time (s)</span>
                  <input
                    type="number"
                    min={0.05}
                    max={5}
                    step={0.05}
                    className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-20 tabular-nums no-spin"
                    value={notifyRingTimeS}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      setNotifyRingTimeS(Math.min(5, Math.max(0.05, Math.round(v * 100) / 100)));
                    }}
                  />
                </div>
                <p className="text-[10px] text-gray-500 mt-1">Glass ring decay length; default 5s (max 5).</p>
                <div className="flex items-center gap-2 flex-wrap mt-3">
                  <span className="text-gray-400 shrink-0">Sound max (¢)</span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    step={1}
                    className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-16 tabular-nums no-spin"
                    value={notifySoundMaxPriceCents}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isFinite(v)) return;
                      setNotifySoundMaxPriceCents(Math.min(99, Math.max(1, Math.round(v))));
                    }}
                  />
                </div>
                <p className="text-[10px] text-gray-500 mt-1">
                  Mute when WS mid for the tilt leg (YES token if green tilt, NO if red) is above this — (bestBid+bestAsk)/2,
                  or bestBid only if no ask (default 95¢).
                </p>
                <label className="flex items-center gap-2 cursor-pointer mt-3">
                  <input
                    type="checkbox"
                    className="rounded accent-amber-500"
                    checked={notifyDoubleRing}
                    onChange={(e) => setNotifyDoubleRing(e.target.checked)}
                  />
                  <span>Double ring</span>
                </label>
                <p className="text-[10px] text-gray-500 mt-1 m-0">Play two strikes ~{NOTIFY_DOUBLE_RING_GAP_MS}ms apart.</p>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded accent-amber-500"
                  checked={notifyFlashBg}
                  onChange={(e) => setNotifyFlashBg(e.target.checked)}
                />
                <span>Flash Background</span>
              </label>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 shrink-0">Top threshold (%)</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  step={1}
                  className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-20 tabular-nums"
                  value={notifyTopThresholdPct}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v)) return;
                    setNotifyTopThresholdPct(Math.min(99, Math.max(1, Math.round(v))));
                  }}
                />
              </div>
              <p className="text-[10px] text-gray-500">Notify when Top cohort USD tilt reaches this absolute lean (same as Top bar).</p>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-400 shrink-0">Staked min (USDC)</span>
                <input
                  type="number"
                  min={0}
                  step={100}
                  className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-28 tabular-nums"
                  value={notifyStakedMinUsd}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (!Number.isFinite(v)) return;
                    setNotifyStakedMinUsd(Math.min(1e12, Math.max(0, v)));
                  }}
                />
              </div>
              <p className="text-[10px] text-gray-500">
                Flash/sound only when net staked (sidebar pill) is greater than this. 0 = no minimum.
              </p>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="px-3 py-1.5 rounded bg-gray-600 hover:bg-gray-500 text-xs font-medium"
                onClick={() => setNotifyDialogOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    {isMobileSheet && sidebarOpen && (
      <button
        type="button"
        className="sidebar-mobile-overlay"
        onClick={() => setSidebarOpen(false)}
        aria-label="Close sidebar"
      />
    )}
    <div
      className={`right-sidebar ${sidebarOpen ? 'open' : ''} ${mobileDragging ? 'mobile-dragging' : ''}`}
      style={{ ['--mobile-sheet-offset' as string]: `${mobileDragOffset}px` } as React.CSSProperties}
    >
      <div
        className="mobile-sidebar-drag-zone no-drag"
        onTouchStart={(e) => startMobileDrag(e.touches[0].clientY)}
        onTouchMove={(e) => {
          moveMobileDrag(e.touches[0].clientY);
          if (mobileDragging) e.preventDefault();
        }}
        onTouchEnd={endMobileDrag}
        onMouseDown={(e) => startMobileDrag(e.clientY)}
        onMouseMove={(e) => moveMobileDrag(e.clientY)}
        onMouseUp={endMobileDrag}
        onMouseLeave={endMobileDrag}
      >
        <div className="mobile-sidebar-drag-handle" />
      </div>
      {/* Portfolio Summary */}
      {selectedMarket && (
        <div className="sidebar-section bg-gray-800/80 py-1">
          <div className="flex items-center gap-1 min-w-0">
            <div className="flex-1 min-w-0 truncate">
              {polymarketUrl ? (
                <a href={polymarketUrl} target="_blank" rel="noreferrer" className={`${sidebarTitleColor} font-bold text-sm hover:underline`}>
                  {marketName}
                </a>
              ) : (
                <span className={`${sidebarTitleColor} font-bold text-sm`}>{marketName}</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setNotifyDialogOpen(true)}
              onPointerDown={(e) => e.stopPropagation()}
              className="shrink-0 rounded-sm border border-gray-600 bg-gray-900/60 p-0.5 w-[18px] min-w-[18px] flex items-center justify-center text-amber-300 hover:bg-gray-700/80 transition-colors"
              title="Tilt notification settings"
              aria-label="Tilt notification settings"
            >
              <Bell className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
            </button>
            {upDownCountdown && (
              <span className={`text-xs font-bold flex-shrink-0 flex items-center gap-0.5 ${upDownCountdown === 'Expired' ? 'text-red-400' : upDownRemaining < 60000 ? 'text-red-400' : upDownRemaining < 300000 ? 'text-yellow-400' : 'text-green-400'}`}>
                <Clock size={12} /> {upDownCountdown}
              </span>
            )}
          </div>
          <div className="text-[10px] text-gray-200 leading-tight mt-0.5 break-words w-full">
            {fullMarketName}
          </div>
        </div>
      )}

      {!selectedMarket && (
        <div className="sidebar-section px-3 py-4 text-xs text-gray-300 leading-relaxed">
          <p className="text-gray-400 mb-3">Dashboard for Polymarket crypto markets.</p>

          <div className="space-y-2.5">
            <div className="rounded-lg bg-gray-900/40 border border-gray-700/60 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <svg width="40" height="40" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect x="8" y="10" width="28" height="24" rx="6" stroke="#60A5FA" strokeWidth="1.5"/>
                  <path d="M12.5 28.5L18.5 22.5L23 26L30.5 18.5" stroke="#38BDF8" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  <circle cx="18.5" cy="22.5" r="2.2" fill="#38BDF8"/>
                  <circle cx="23" cy="26" r="2.2" fill="#22C55E"/>
                  <circle cx="30.5" cy="18.5" r="2.2" fill="#F59E0B"/>
                  <path d="M12 14L14.5 11.5L17 14" stroke="#93C5FD" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div className="text-white font-bold">1. Birdseye crypto markets</div>
              </div>
              <div className="min-w-0 mt-1">
                <div className="text-gray-400 mt-0.5">Scan the full grid of Polymarket crypto markets at a glance, with active orders and positions visible directly in the grid.</div>
              </div>
            </div>

            <div className="rounded-lg bg-gray-900/40 border border-gray-700/60 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <svg width="40" height="40" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect x="8" y="10" width="28" height="24" rx="6" stroke="#FBBF24" strokeWidth="1.5"/>
                  <path d="M14 30C18 26 20 26 24 20C27 16 30 16 34 13" stroke="#F59E0B" strokeWidth="1.8" strokeLinecap="round"/>
                  <path d="M14 20H18" stroke="#FDE68A" strokeWidth="1.6" strokeLinecap="round"/>
                  <path d="M14 24H21" stroke="#FDE68A" strokeWidth="1.6" strokeLinecap="round"/>
                  <path d="M14 28H22" stroke="#FDE68A" strokeWidth="1.6" strokeLinecap="round"/>
                  <text x="16" y="16" fontSize="8" fill="#FBBF24" fontFamily="monospace">BS</text>
                </svg>
                <div className="text-white font-bold">2. Black-Scholes probability</div>
              </div>
              <div className="min-w-0 mt-1">
                <div className="text-gray-400 mt-0.5">Theoretical fair probability for each market, computed from volatility and time.</div>
              </div>
            </div>

            <div className="rounded-lg bg-gray-900/40 border border-gray-700/60 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <svg width="40" height="40" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect x="10" y="12" width="24" height="20" rx="5" stroke="#34D399" strokeWidth="1.5"/>
                  <path d="M15 18H29" stroke="#6EE7B7" strokeWidth="1.6" strokeLinecap="round"/>
                  <path d="M15 22H26" stroke="#6EE7B7" strokeWidth="1.6" strokeLinecap="round"/>
                  <path d="M15 26H22" stroke="#6EE7B7" strokeWidth="1.6" strokeLinecap="round"/>
                  <circle cx="30.5" cy="26.5" r="6" stroke="#10B981" strokeWidth="1.5" opacity="0.9"/>
                  <path d="M30.5 23.8V26.9L33.2 28.2" stroke="#10B981" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div className="text-white font-bold">3. Place/Edit orders</div>
              </div>
              <div className="min-w-0 mt-1">
                <div className="text-gray-400 mt-0.5">Fast order UI with expiration and replace flows once you open a market.</div>
              </div>
            </div>

            <div className="rounded-lg bg-gray-900/40 border border-gray-700/60 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <svg width="40" height="40" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect x="8" y="10" width="28" height="24" rx="6" stroke="#60A5FA" strokeWidth="1.5" opacity="0.9"/>
                  <circle cx="22" cy="23" r="8" stroke="#A78BFA" strokeWidth="1.6"/>
                  <path d="M18 23L22 19L26 23L22 27L18 23Z" fill="#A78BFA" opacity="0.25"/>
                  <path d="M30 30L35 35" stroke="#A78BFA" strokeWidth="1.8" strokeLinecap="round"/>
                  <path d="M19 24L21.5 22L22.8 18.8" stroke="#FCA5A5" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <div className="text-white font-bold">4. Underpriced signals</div>
              </div>
              <div className="min-w-0 mt-1">
                <div className="text-gray-400 mt-0.5">Highlights where B-S fair probability diverges from market price.</div>
              </div>
            </div>

            <div className="rounded-lg bg-gray-900/40 border border-gray-700/60 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <svg width="40" height="40" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect x="8" y="10" width="28" height="24" rx="6" stroke="#FB7185" strokeWidth="1.5" opacity="0.95"/>
                  <path d="M14 20H22" stroke="#F472B6" strokeWidth="1.7" strokeLinecap="round"/>
                  <path d="M22 20C24.5 18 24.5 26 22 28C19.5 30 19.5 22 22 20Z" fill="#F472B6" opacity="0.2"/>
                  <path d="M24 17L30 13" stroke="#FB7185" strokeWidth="1.7" strokeLinecap="round"/>
                  <path d="M24 32L30 28" stroke="#FB7185" strokeWidth="1.7" strokeLinecap="round"/>
                  <path d="M28 18V26" stroke="#F472B6" strokeWidth="1.5" strokeLinecap="round" opacity="0.9"/>
                  <text x="26" y="24" fontSize="7" fill="#FB7185" fontFamily="monospace">TM</text>
                </svg>
                <div className="text-white font-bold">5. Range & time-machine modeling</div>
              </div>
              <div className="min-w-0 mt-1">
                <div className="text-gray-400 mt-0.5">Model probability across asset price ranges and fast-forward expiry with the Time Machine.</div>
              </div>
            </div>

            <div className="rounded-lg bg-gray-900/40 border border-gray-700/60 px-2.5 py-2">
              <div className="flex items-center gap-2">
                <svg width="40" height="40" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                  <rect x="12" y="12" width="20" height="16" rx="4" stroke="#22C55E" strokeWidth="1.5"/>
                  <rect x="18" y="18" width="20" height="16" rx="4" stroke="#60A5FA" strokeWidth="1.5" opacity="0.95"/>
                  <path d="M16 16L18 14" stroke="#22C55E" strokeWidth="1.6" strokeLinecap="round"/>
                  <path d="M16 19H19" stroke="#22C55E" strokeWidth="1.6" strokeLinecap="round"/>
                  <path d="M24 24H27" stroke="#60A5FA" strokeWidth="1.6" strokeLinecap="round"/>
                  <path d="M28 22L30 20" stroke="#60A5FA" strokeWidth="1.6" strokeLinecap="round"/>
                  <path d="M34 22L36 24" stroke="#93C5FD" strokeWidth="1.5" strokeLinecap="round"/>
                  <circle cx="15" cy="28" r="1.4" fill="#22C55E"/>
                </svg>
                <div className="text-white font-bold">6. Resizable movable dashboard</div>
              </div>
              <div className="min-w-0 mt-1">
                <div className="text-gray-400 mt-0.5">Panels are draggable in the main terminal. Configure the layout as you trade.</div>
              </div>
            </div>
          </div>

          <p className="text-gray-500 text-[10px] italic mt-3">Click any market cell in the grid to open it here.</p>
        </div>
      )}

      {selectedMarket && (
        <>
          <SidebarChartsRow
            selectedMarket={selectedMarket}
            isUpDownMarket={isUpDownMarket}
            upDownAsset={upDownAsset}
            upDownIntervalContext={upDownIntervalContext}
            upDownTargetPrice={upDownTargetPrice}
            upDownSpotUsesChainlink={upDownSpotUsesChainlink}
            displayLiveTrades={displayLiveTrades}
            orderOutcome={orderOutcome}
            upDownStartTime={upDownStartTime}
            upDownKlineDefaultInterval={upDownKlineDefaultInterval}
          />


          {/* Target, math probability, current spot — Up/Down and all strike-based markets */}
          {sidebarSpotStrip && (() => {
            const row = sidebarSpotStrip;
            const mathTooltip =
              row.mode === 'updown'
                ? 'Mathematical fair value for this Up/Down market (Black-Scholes–style terminal probability).\n\nUses the same spot as “Current” on the right: Polymarket Chainlink for 5m/15m windows, Binance spot for 1h/4h/24h. Inputs: target strike, time to expiry, implied volatility (σ).\n\nFor Up (YES): probability price is above the target at expiry. For Down (NO): below.\n\nCompare to the market price to spot mispricings.'
                : row.hitModel
                  ? 'Fair-value probability for this Hit market (one-touch / first-passage under GBM): risk-neutral chance price touches the strike by expiry. Same Binance spot as “Current”, σ from settings.\n\nCompare to the order book to spot mispricings.'
                  : 'Fair-value probability (terminal Black-Scholes–style) for this market’s strike vs spot.\n\nUses Binance spot, time to expiry, and σ. For YES/NO: YES uses model YES probability; NO uses 100% − YES.\n\nCompare to the market price to spot mispricings.';

            const currentBadge =
              row.mode === 'updown'
                ? {
                    label: row.currentSource === 'chainlink' ? 'CHAINLINK' : 'BINANCE',
                    className: row.currentSource === 'chainlink' ? 'bg-blue-600 text-white' : 'bg-yellow-400 text-black',
                    title:
                      row.currentSource === 'chainlink'
                        ? 'Polymarket RTDS Chainlink (via backend)'
                        : upDownSpotUsesChainlink
                          ? 'Binance spot (fallback until Chainlink connects)'
                          : 'Binance spot (1h/4h/24h Up/Down)',
                  }
                : {
                    label: 'BINANCE',
                    className: 'bg-yellow-400 text-black',
                    title: 'Binance spot',
                  };

            const obAsks = sidebarBookRef.current?.displayAsks ?? [];
            const bestAsk = obAsks.length > 0 ? parseFloat(obAsks[0].price) * 100 : null;
            let bsColor = 'text-yellow-400';
            if (bestAsk !== null && row.mathCents !== null) {
              if (bestAsk < row.mathCents * 0.95) bsColor = 'text-green-400';
              else if (bestAsk > row.mathCents * 1.05) bsColor = 'text-red-400';
            }

            return (
              <div className="sidebar-section py-1 px-3">
                <div className="flex items-start justify-between">
                  <div className="text-left">
                    <div className="text-[10px] text-gray-500">Target</div>
                    <div className="text-xs font-bold text-white">{row.targetDisplay}</div>
                    {row.countdown && (
                      <div className="flex flex-wrap items-center gap-1 mt-0.5">
                        <div
                          className={`text-[10px] ${row.countdown === 'Expired' ? 'text-red-400' : row.remaining < 60000 ? 'text-red-400' : row.remaining > 300000 ? 'text-green-400' : 'text-yellow-400'}`}
                        >
                          {row.countdown}
                        </div>
                        {row.countdown === 'Expired' && row.mode === 'updown' && liveUpDownSameTfMarket ? (
                          <button
                            type="button"
                            className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-2 py-0.5 rounded bg-green-600 hover:bg-green-500 text-black leading-none shrink-0"
                            onClick={() => setSelectedMarket(liveUpDownSameTfMarket)}
                          >
                            <ArrowRight size={12} strokeWidth={2.5} className="shrink-0" aria-hidden />
                            live
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                  {row.pastExpiry ? (
                    <div className="text-center" title="Time machine ahead of expiration">
                      <div className="text-[10px] text-gray-500 flex items-center justify-center gap-0.5">
                        <CirclePercent className="h-2.5 w-2.5 shrink-0 opacity-80" strokeWidth={2.5} aria-hidden />
                        Math
                      </div>
                      <div className="text-xs font-bold text-gray-500">&gt;⏱</div>
                    </div>
                  ) : row.mathCents !== null ? (
                    <div className="text-center">
                      <div className="text-[10px] text-gray-500 flex items-center justify-center gap-0.5">
                        <CirclePercent className="h-2.5 w-2.5 shrink-0 opacity-80" strokeWidth={2.5} aria-hidden />
                        Math
                        <HelpTooltip text={mathTooltip} />
                      </div>
                      <div
                        className={`inline-flex items-center justify-center gap-0.5 text-xs font-bold ${bsColor} cursor-pointer hover:underline`}
                        onClick={() => setOrderPrice(row.mathCents!.toFixed(1))}
                      >
                        <CirclePercent className="h-3 w-3 shrink-0 opacity-90" strokeWidth={2.5} aria-hidden />
                        <span className="tabular-nums">{row.mathCents!.toFixed(1)}</span>
                      </div>
                    </div>
                  ) : null}
                  <div className="text-right">
                    <div className="text-[10px] text-gray-500 flex items-center justify-end gap-1">
                      Current{' '}
                      <span
                        className={`px-0.5 rounded-sm text-[8px] font-bold leading-tight ${currentBadge.className}`}
                        title={currentBadge.title}
                      >
                        {currentBadge.label}
                      </span>
                    </div>
                    <div ref={sidebarSpotCurrentPriceRef} className="text-xs font-bold text-white">
                      {row.currentPrice
                        ? `$${row.currentPrice.toLocaleString(undefined, { minimumFractionDigits: row.priceDec, maximumFractionDigits: row.priceDec })}`
                        : '...'}
                    </div>
                    {row.diff && row.currentPrice > 0 && (
                      <div
                        className={`text-[10px] font-bold flex flex-wrap items-center justify-end gap-0.5 ${row.diff.isUp ? 'text-green-400' : 'text-red-400'}`}
                      >
                        <span>
                          {row.diff.isUp ? '↑' : '↓'}
                          {row.diff.abs.toLocaleString(undefined, { minimumFractionDigits: row.priceDec, maximumFractionDigits: row.priceDec })}
                        </span>
                        <span className="inline-flex items-center gap-0.5 tabular-nums">
                          (
                          {row.diff.pct >= 0 ? '+' : ''}
                          {row.diff.pct.toFixed(2)}%)
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                {!row.pastExpiry && row.yesMathCents != null && (
                  (() => {
                    const yesTid = (selectedMarket?.clobTokenIds?.[0] || '').trim();
                    const wsRow = yesTid ? marketLookup[yesTid] : undefined;
                    const bb = wsRow?.bestBid;
                    const ba = wsRow?.bestAsk;
                    const tb = bb != null && Number.isFinite(bb) ? bb * 100 : NaN;
                    const ta = ba != null && Number.isFinite(ba) ? ba * 100 : NaN;
                    let yesMidCents: number | null = null;
                    if (Number.isFinite(tb) && Number.isFinite(ta)) yesMidCents = (tb + ta) / 2;
                    else if (Number.isFinite(tb)) yesMidCents = tb;
                    else if (Number.isFinite(ta)) yesMidCents = ta;
                    const yMidOk =
                      yesMidCents != null ? Math.min(100, Math.max(0, yesMidCents)) : null;

                    const m = row.yesMathCents;
                    const delta = yMidOk != null ? yMidOk - m : null;
                    /** GREEN on the left (% width): 50% when YES mid ≡ math; grows left when YES mid > math. RED fills the remainder on the right. */
                    const greenLeftPct =
                      delta == null
                        ? 50
                        : Math.min(97, Math.max(3, 50 + (delta / 22) * 46));

                    const tip =
                      yMidOk == null
                        ? `Model YES ${m.toFixed(1)}¢ — no WS best bid/ask for YES yet`
                        : `YES mid ${yMidOk.toFixed(1)}¢ (bid/ask WS) vs model ${m.toFixed(1)}¢ (Δ ${delta! >= 0 ? '+' : ''}${delta!.toFixed(1)}¢)`;

                    return (
                      <div className="mt-2 pt-1.5 border-t border-gray-800/70" title={tip}>
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <span className="flex items-center gap-0.5 text-[10px] text-gray-500">
                            Prob
                            <HelpTooltip
                              text={
                                'YES midpoint: average of live best bid and best ask from `/ws/chart` (YES token asset id).\n\n' +
                                  'Not the sidebar CLOB ladder. Same readings when you toggle sidebar YES/NO.\n\n' +
                                  'Compared to Math (model YES). Green left grows when WS mid is above math.'
                              }
                            />
                          </span>
                          <span className="text-[10px] text-gray-400 tabular-nums">
                            <span className="text-gray-500">YES mid</span>{' '}
                            {yMidOk != null ? (
                              <span
                                className={`font-semibold ${
                                  delta != null ? (delta > 0.4 ? 'text-emerald-400' : delta < -0.4 ? 'text-red-400' : 'text-gray-200') : 'text-white'
                                }`}
                              >
                                {yMidOk.toFixed(1)}
                              </span>
                            ) : (
                              <span className="text-gray-600">–</span>
                            )}
                            <span className="text-gray-600 mx-0.5">/</span>
                            <span className="text-gray-400">{m.toFixed(1)} math</span>
                          </span>
                        </div>
                        <div className="relative h-[7px] w-full rounded-full overflow-hidden bg-gray-900 ring-1 ring-gray-700/80">
                          <div
                            className="absolute inset-y-0 left-0 rounded-l-[999px] bg-emerald-600/90"
                            style={{ width: `${greenLeftPct}%` }}
                          />
                          <div
                            className="absolute inset-y-0 rounded-r-[999px] bg-red-800/95"
                            style={{ left: `${greenLeftPct}%`, width: `${100 - greenLeftPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()
                )}
              </div>
            );
          })()}

          {/* BS Flower */}
          {(() => {
            const bsAsset = extractAssetFromMarket(selectedMarket);
            const bsStrike = selectedMarket.groupItemTitle || '';
            const bsEndDate = selectedMarket.endDate || '';
            return bsAsset && bsStrike ? (
              <div className="sidebar-section py-1">
                <div className="flex items-center gap-1 mb-1">
                  {isUpDownMarket ? (
                    <CirclePercent className="h-3.5 w-3.5 shrink-0 text-gray-400" strokeWidth={2} aria-hidden />
                  ) : null}
                  <span className="text-xs text-gray-400">Mathematical Probability</span>
                  <HelpTooltip text={selectedMarketIsHit
                    ? "For Hit markets, this uses a one-touch (first-passage) barrier formula under geometric Brownian motion: risk-neutral probability that price touches the strike level at or before expiry. That matches path-dependent resolution better than terminal Black-Scholes.\n\nInputs: underlying (VWAP or live), strike, time to expiry, σ (same vol as other markets). r is taken as 0 for short crypto horizons.\n\nFlower petals: min/max across your configured price ranges."
                    : isUpDownMarket
                    ? "Mathematical probability for this Up/Down market (Black-Scholes–style terminal model).\n\nInputs: underlying price, target strike, time to expiry, and implied volatility (σ).\n\nThe flower petals show the max and min probability values across your configured price ranges."
                    : "Black-Scholes (B-S) is a mathematical model for pricing options, adapted here to estimate the probability of an asset reaching a given strike price by expiry.\n\nInputs:\n• Underlying price (VWAP or live price)\n• Strike price (the market's target price)\n• Time to expiry\n• Implied volatility (σ multiplier in header)\n\nThe flower petals show the max and min B-S probability values calculated across the set price ranges. This gives a visual sense of the probability spread.\n\nA high B-S probability means the model considers it likely the asset will reach the strike. Comparing B-S probability to the market price reveals potential mispricings."} />
                </div>
                <BsFlower asset={bsAsset} strike={bsStrike} endDate={bsEndDate} isYes={orderOutcome === 'YES'} hitBarrierModel={selectedMarketIsHit} onPriceClick={(cents) => setOrderPrice(String(cents))} />
              </div>
            ) : null;
          })()}

          {/* BS Flower for 24h Up or Down markets */}
          {(() => {
            if (!isUpDownMarket || !upDownTargetPrice) return null;
            const slug = selectedMarket.eventSlug || '';
            const q = selectedMarket.question || '';
            const combined = `${slug} ${q}`;
            const is24h = !!(combined.match(/up-or-down-on-/i) || combined.match(/\b24[- ]?h/i));
            if (!is24h) return null;
            const bsAsset = extractAssetFromMarket(selectedMarket);
            const bsEndDate = selectedMarket.endDate || '';
            const bsStrike = '>' + upDownTargetPrice;
            return bsAsset ? (
              <div className="sidebar-section py-1">
                <div className="flex items-center gap-1 mb-1">
                  <CirclePercent className="h-3.5 w-3.5 shrink-0 text-gray-400" strokeWidth={2} aria-hidden />
                  <span className="text-xs text-gray-400">Mathematical Probability</span>
                  <HelpTooltip text={"Mathematical probability for this 24h Up/Down market (Black-Scholes–style terminal model).\n\nUses the target price as the strike, current price as the underlying, time to expiry, and implied volatility (σ).\n\nThe flower petals show the probability spread across your configured price ranges."} />
                </div>
                <BsFlower asset={bsAsset} strike={bsStrike} endDate={bsEndDate} isYes={orderOutcome === 'YES'} onPriceClick={(cents) => setOrderPrice(String(cents))} />
              </div>
            ) : null;
          })()}

          <div className="sidebar-section py-1">
            <div
              className={`min-w-0 min-h-0 rounded-md px-1 py-0.5 -mx-1${
                effectiveSidebarBgFlash === 'green'
                  ? ' sidebar-stats-flash-green'
                  : effectiveSidebarBgFlash === 'red'
                    ? ' sidebar-stats-flash-red'
                    : ''
              }`}
            >
              <div className="grid w-full grid-cols-4 gap-1.5 text-[10px] min-w-0 items-stretch">
              <div className="rounded border border-gray-700/70 bg-gray-900/50 px-1.5 py-1 min-w-0">
                <div className="text-[8px] uppercase tracking-wide text-gray-500 truncate">Volume</div>
                <div
                  className="tabular-nums font-bold text-green-400 truncate"
                  title="Toxic Flow USDC volume (wallet_market_positions usdc_in), same source as Up/Down grid"
                >
                  {liveOrderbookVolumeDisplay && liveOrderbookVolumeDisplay !== '--'
                    ? `$${liveOrderbookVolumeDisplay}`
                    : '--'}
                </div>
              </div>
              <div
                className={`rounded px-1.5 py-1 min-w-0 border ${
                  stakedPillTier === 'low'
                    ? 'border-red-700/65 bg-red-950/35'
                    : stakedPillTier === 'mid'
                      ? 'border-amber-600/55 bg-amber-950/35'
                      : stakedPillTier === 'high'
                        ? 'border-emerald-800/60 bg-emerald-950/30'
                        : 'border-gray-700/70 bg-gray-900/50'
                }`}
              >
                <div
                  className={`text-[8px] uppercase tracking-wide truncate ${
                    stakedPillTier === 'low'
                      ? 'text-red-400/90'
                      : stakedPillTier === 'mid'
                        ? 'text-amber-400/90'
                        : stakedPillTier === 'high'
                          ? 'text-emerald-500/90'
                          : 'text-gray-500'
                  }`}
                >
                  Staked
                </div>
                <div
                  className={`tabular-nums font-bold truncate ${
                    stakedPillTier === 'low'
                      ? 'text-red-300'
                      : stakedPillTier === 'mid'
                        ? 'text-amber-200'
                        : stakedPillTier === 'high'
                          ? 'text-emerald-300'
                          : 'text-gray-200'
                  }`}
                  title={`Net staked (pill value): |Σ|YES leg| − Σ|NO leg|| USD ≈ $${typeof marketStakedNetUsdAbs === 'number' && Number.isFinite(marketStakedNetUsdAbs) ? marketStakedNetUsdAbs.toFixed(0) : '—'}. Σ|legs| gross USD: $${typeof marketStakedGrossUsd === 'number' && Number.isFinite(marketStakedGrossUsd) ? marketStakedGrossUsd.toFixed(0) : '—'}`}
                >
                  {marketStakedNetKDisplay ? `$${marketStakedNetKDisplay}` : '--'}
                </div>
              </div>
              <div className="rounded border border-gray-700/70 bg-gray-900/50 px-1.5 py-1 min-w-0">
                <div className="text-[8px] uppercase tracking-wide text-gray-500 truncate">Shares</div>
                <div className="tabular-nums font-bold text-gray-200 truncate" title="Shares in existence from net wallet balances: sum(abs(YES-NO))">
                  {sharesInExistenceDisplay}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setToxicDialogOpen(true)}
                onMouseEnter={preloadToxicFlowDialog}
                onFocus={preloadToxicFlowDialog}
                onPointerDown={(e) => e.stopPropagation()}
                className="rounded border border-yellow-500/50 bg-yellow-900/20 px-1.5 py-1 text-left hover:bg-yellow-500/20 transition-colors min-w-0"
                title="Holders Analysis"
              >
                <div className="text-[8px] uppercase tracking-wide text-yellow-400 truncate">Holders</div>
                <div className="tabular-nums font-bold text-yellow-300 truncate">{holdersCountDisplay}</div>
              </button>
            </div>
            {/* Compact bias bars */}
            {(() => {
              const posLabel = isUpDownMarket ? 'UP' : 'YES';
              const negLabel = isUpDownMarket ? 'DOWN' : 'NO';

              const wb = sidebarStakedLegs
                ? stakedGrossUsdTilt(sidebarStakedLegs.stakedUsdYesLeg, sidebarStakedLegs.stakedUsdNoLeg)
                : 0;
              const yesWR = liveShareStats?.winnerBiasYesWR ?? 0;
              const noWR = liveShareStats?.winnerBiasNoWR ?? 0;
              const cyTop = liveShareStats?.stakedTopHoldersCohortYesUsd;
              const cnTop = liveShareStats?.stakedTopHoldersCohortNoUsd;
              const hasTopCohortUsd =
                typeof cyTop === 'number' &&
                Number.isFinite(cyTop) &&
                typeof cnTop === 'number' &&
                Number.isFinite(cnTop) &&
                cyTop + cnTop > 1e-9;
              const wbcvUsd = hasTopCohortUsd
                ? stakedGrossUsdTilt(cyTop, cnTop)
                : sidebarStakedLegs
                  ? stakedGrossUsdTilt(sidebarStakedLegs.stakedUsdYesLeg, sidebarStakedLegs.stakedUsdNoLeg)
                  : 0;
              const yesWRcvUsd = liveShareStats?.winnerBiasConvictionYesWR ?? 0;
              const noWRcvUsd = liveShareStats?.winnerBiasConvictionNoWR ?? 0;
              const sms = liveShareStats?.provenSMS ?? 0;

              const winUsdTip = `Staked USD tilt (Σ|YES leg| vs Σ|NO leg|, inv×px) — same as Stake row. WR in market (all wallets): ${posLabel} ${(yesWR * 100).toFixed(0)}% / ${negLabel} ${(noWR * 100).toFixed(0)}%.`;
              const cvUsdTip = hasTopCohortUsd
                ? `Staked USD tilt for Top-|net| cohort (inv×px surplus halves) — same basis as Top bar. Conviction wallets (|net|/vol≥99.9%): ${posLabel} ${(yesWRcvUsd * 100).toFixed(0)}% / ${negLabel} ${(noWRcvUsd * 100).toFixed(0)}% WR.`
                : `Staked USD tilt from all-wallet legs (Top cohort USD N/A). Conviction wallets (|net|/vol≥99.9%): ${posLabel} ${(yesWRcvUsd * 100).toFixed(0)}% / ${negLabel} ${(noWRcvUsd * 100).toFixed(0)}% WR.`;

              return (
                <div className="mt-1 space-y-0.5">
                  <SidebarBiasMiniBar label="Win$" value={wb} leftColor="bg-cyan-400/75" rightColor="bg-pink-400/75" tooltip={winUsdTip} />
                  <SidebarBiasMiniBar label="Cv$" value={wbcvUsd} leftColor="bg-emerald-400/75" rightColor="bg-orange-400/75" tooltip={cvUsdTip} />
                  <SidebarBiasMiniBar label="Smart" value={sms} leftColor="bg-lime-500/75" rightColor="bg-red-600/75" tooltip={`Smart Money: proven wallets (≥60% WR, ≥10 mkts, PNL>0) with ≥$2k in this market — ${sms > 0 ? posLabel : negLabel} leaning ${(Math.abs(sms) * 100).toFixed(0)}%`} />
                  {sidebarStakedLegs ? (
                    <StakedLegUsdBar
                      sumYUsd={sidebarStakedLegs.stakedUsdYesLeg}
                      sumNUsd={sidebarStakedLegs.stakedUsdNoLeg}
                      compact
                      dense
                      compactLabel="Stake"
                      barMode="grossLegTotals"
                      flashExtremeTilt={
                        !!(notifyTiltAppliesToSelectedMarket && notifyFlashBg && notifyStakedGatePasses)
                      }
                    />
                  ) : null}
                  {(() => {
                    const cy = liveShareStats?.stakedTopHoldersCohortYesUsd;
                    const cn = liveShareStats?.stakedTopHoldersCohortNoUsd;
                    if (
                      typeof cy === 'number' &&
                      Number.isFinite(cy) &&
                      typeof cn === 'number' &&
                      Number.isFinite(cn) &&
                      cy + cn > 1e-9
                    ) {
                      return (
                        <StakedLegUsdBar
                          sumYUsd={cy}
                          sumNUsd={cn}
                          compact
                          dense
                          compactLabel="Top"
                          barMode="cohortSurplusHalves"
                          flashExtremeTilt={
                            !!(notifyTiltAppliesToSelectedMarket && notifyFlashBg && notifyStakedGatePasses)
                          }
                          extremeFlashTiltThreshold={notifyTopThresholdPct / 100}
                        />
                      );
                    }
                    return null;
                  })()}
                </div>
              );
            })()}
          </div>
          </div>

          {/* Live Orderbook + Trades */}
          <SidebarPolymarketOBHost
            obTokenId={obTokenId}
            sidebarBookRef={sidebarBookRef}
            onTopOfBookDigestBump={bumpTopOfBookDigest}
            onPolymarketTrades={onPolymarketTradesFromHost}
            orderbookSectionHeight={orderbookSectionHeight}
            liveOrderbookExpanded={liveOrderbookExpanded}
            onToggleLiveOrderbookExpanded={toggleLiveOrderbookExpanded}
            isMarketExpired={isMarketExpired}
            isUpDownMarket={isUpDownMarket}
            sidebarUserBidPrices={sidebarUserBidPrices}
            sidebarUserAskPrices={sidebarUserAskPrices}
            selectedMarket={selectedMarket}
            orderOutcome={orderOutcome}
            positions={positions}
            outcomeMarket={marketForOrderbookOutcome}
            setOrderSide={setOrderSide}
            setOrderPrice={setOrderPrice}
            setOrderAmount={setOrderAmount}
          />

          <SidebarLiveTradesSection
            liveTradesExpanded={liveTradesExpanded}
            onToggleLiveTradesExpanded={toggleLiveTradesExpanded}
            liveTradesSectionHeight={liveTradesSectionHeight}
            liveOrderbookExpanded={liveOrderbookExpanded}
            displayLiveTrades={displayLiveTrades}
            tradeTickBucket={Math.floor(tradeTickNow / 5000) * 5000}
            liveTradesSource={liveTradesSource}
            myOnchainWalletLower={myOnchainWalletLower}
          />

          {/* Order Form */}
          <div className="sidebar-section">
            {/* BUY/SELL (wider) + narrow Limit/Market */}
            <div className="mb-3 flex gap-2 items-end cursor-default" onPointerDown={(e) => e.stopPropagation()}>
              <div className="min-w-0 flex-1 border-b border-gray-700 inline-flex">
                <button
                  type="button"
                  className={`flex-1 h-7 text-[11px] font-bold transition border-b-[3px] ${
                    orderSide === 'BUY'
                      ? 'text-emerald-400 border-emerald-400'
                      : 'text-slate-400 border-transparent hover:text-slate-200'
                  }`}
                  onClick={() => setOrderSide('BUY')}
                >
                  BUY
                </button>
                <button
                  type="button"
                  className={`flex-1 h-7 text-[11px] font-bold transition border-b-[3px] ${
                    orderSide === 'SELL'
                      ? 'text-rose-400 border-rose-400'
                      : 'text-slate-400 border-transparent hover:text-slate-200'
                  }`}
                  onClick={() => setOrderSide('SELL')}
                >
                  SELL
                </button>
              </div>
              <div className="w-1/4 max-w-[4.5rem] shrink-0 min-w-0">
                <label className="text-[8px] text-gray-500 block mb-0.5">Type</label>
                <select
                  value={orderKind}
                  onChange={(e) => setOrderKind(e.target.value as 'limit' | 'market')}
                  className="w-full max-w-full h-7 rounded border border-gray-600 bg-gray-900/90 px-1 text-[10px] font-semibold text-gray-200 outline-none focus:border-cyan-600 focus:ring-1 focus:ring-cyan-600/30"
                  aria-label="Order type"
                >
                  <option value="limit">Limit</option>
                  <option value="market">Market</option>
                </select>
              </div>
            </div>

            {/* YES/NO Toggle (UP/DOWN for Up or Down markets) */}
            <div className="mb-3">
              <div className="inline-flex w-full rounded-md bg-gray-900 border border-gray-700 p-0.5">
                <button
                  className={`flex-1 h-9 rounded-sm text-sm font-bold transition ${
                    orderOutcome === 'YES'
                      ? 'bg-emerald-500 text-black shadow-[0_0_12px_rgba(16,185,129,0.4)]'
                      : 'text-gray-300 hover:text-white'
                  }`}
                  onClick={() => setOrderOutcome('YES')}
                >
                  {isUpDownMarket ? 'UP' : 'YES'}
                </button>
                <button
                  className={`flex-1 h-9 rounded-sm text-sm font-bold transition ${
                    orderOutcome === 'NO'
                      ? 'bg-rose-500 text-black shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                      : 'text-gray-300 hover:text-white'
                  }`}
                  onClick={() => setOrderOutcome('NO')}
                >
                  {isUpDownMarket ? 'DOWN' : 'NO'}
                </button>
              </div>
            </div>

            {/* Price + Amount Inputs */}
            <div className="grid grid-cols-2 gap-2 mb-3 items-start">
              <div className={orderKind === 'market' ? 'opacity-55' : ''}>
                <label className="text-[10px] text-gray-400 block mb-1">
                  {orderKind === 'market' ? 'Price (market FAK)' : 'Limit Price (¢)'}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    spellCheck={false}
                    value={orderPrice}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/[^\d.]/g, '');
                      const dot = cleaned.indexOf('.');
                      const v =
                        dot === -1 ? cleaned : `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/\./g, '')}`;
                      setOrderPrice(v);
                    }}
                    disabled={orderKind === 'market'}
                    className="order-input w-full h-[38px] text-center text-lg font-bold leading-none px-10 disabled:cursor-not-allowed disabled:opacity-70"
                    placeholder="50"
                  />
                  <button
                    type="button"
                    disabled={orderKind === 'market'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (orderKind === 'market') return;
                      adjustOrderPriceCents(-1);
                    }}
                    className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md text-gray-300 hover:text-white hover:bg-gray-700/70 text-2xl leading-none flex items-center justify-center disabled:pointer-events-none disabled:opacity-40"
                    aria-label="Decrease price by 1 cent"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    disabled={orderKind === 'market'}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (orderKind === 'market') return;
                      adjustOrderPriceCents(1);
                    }}
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md text-gray-300 hover:text-white hover:bg-gray-700/70 text-2xl leading-none flex items-center justify-center disabled:pointer-events-none disabled:opacity-40"
                    aria-label="Increase price by 1 cent"
                  >
                    +
                  </button>
                </div>
                <div className="mt-1 grid grid-cols-4 gap-[2px]">
                  {[1, 5, 10, 25].map((c) => (
                    <button
                      key={c}
                      type="button"
                      disabled={orderKind === 'market'}
                      onClick={() => setOrderPrice(String(c))}
                      className="bg-gray-700 hover:bg-gray-600 rounded text-[9px] text-gray-300 h-6 disabled:pointer-events-none disabled:opacity-40"
                    >
                      {c}c
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[10px] text-gray-400 block mb-1">
                  {orderKind === 'market' && orderSide === 'BUY' ? 'Amount ($)' : 'Amount (shares)'}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={orderAmount}
                    onChange={(e) => setOrderAmount(e.target.value)}
                    onWheel={(e) => e.preventDefault()}
                    className="order-input no-spin h-[38px] pr-5 w-full"
                    placeholder="100"
                    min={1}
                    step={1}
                  />
                  <button
                    onClick={() => setOrderAmount('')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-sm px-0.5"
                  >×</button>
                </div>
                <div className="mt-1 h-6">
                  {orderSide === 'BUY' ? (
                    <div className="h-full grid grid-cols-5 gap-[2px]">
                      {[
                        { value: 1, label: '1$' },
                        { value: 5, label: '$5' },
                        { value: 10, label: '10$' },
                        { value: 25, label: '25$' },
                        { value: 50, label: '$50' },
                      ].map((d) => (
                        <button
                          key={d.value}
                          onClick={() => setOrderAmountDollar(d.value)}
                          className={`bg-gray-700 hover:bg-gray-600 rounded text-[9px] h-full ${d.value === 1 ? 'text-yellow-400' : 'text-green-400'}`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        const tokenId = selectedMarket?.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1] || '';
                        const pos = positions.find(p => p.asset === tokenId && p.size > 0);
                        if (pos) setOrderAmount(String(Math.floor(pos.size * 100) / 100));
                      }}
                      className="bg-red-700 hover:bg-red-600 rounded text-[10px] text-white font-bold h-full w-full leading-none flex items-center justify-center"
                    >
                      MAX
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Order Summary */}
            <div className="flex gap-1 mb-3 items-stretch">
              <div className="bg-gray-700/50 rounded p-2 text-[10px] text-gray-400 flex flex-col items-center justify-center" style={{ width: '90px', flexShrink: 0 }}>
                <label className="text-[10px] text-gray-400 mb-0.5 flex items-center justify-start gap-0.5 w-full">
                  T-EXP
                  <span className="relative group cursor-help">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="text-gray-500 hover:text-gray-300"><circle cx="8" cy="8" r="7.5" fill="none" stroke="currentColor" strokeWidth="1"/><text x="8" y="12" textAnchor="middle" fontSize="11" fill="currentColor">?</text></svg>
                    <span className="absolute bottom-full left-0 mb-1 hidden group-hover:block bg-gray-900 border border-gray-600 text-gray-200 text-[9px] rounded px-2 py-1 w-40 text-left whitespace-normal z-50 leading-tight">
                      Time before market expiration: order expiry = market end minus this lead (GTD buys). 0 = good-til-cancelled (no time-based expiry).
                    </span>
                  </span>
                </label>
                <div className="flex items-center gap-1 w-full">
                  <input
                    type="number"
                    value={orderExpiry}
                    disabled={orderKind === 'market'}
                    title={orderKind === 'market' ? 'T-EXP applies to limit (GTD) buys only' : undefined}
                    onChange={(e) => {
                      const v = e.target.value;
                      setOrderExpiry(v);
                      writeOrderExpirySlot(isUpDownMarket, v, orderExpiryUnit);
                    }}
                    onWheel={(e) => e.preventDefault()}
                    className="bg-transparent text-left text-white text-[11px] w-full outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:cursor-not-allowed disabled:opacity-40"
                    min={0}
                    step={10}
                  />
                  <select
                    value={orderExpiryUnit}
                    disabled={orderKind === 'market'}
                    onChange={(e) => {
                      const u = e.target.value as 's' | 'm' | 'h';
                      setOrderExpiryUnit(u);
                      writeOrderExpirySlot(isUpDownMarket, orderExpiry, u);
                    }}
                    className="bg-gray-800 text-gray-200 text-[10px] rounded px-1 py-0.5 outline-none border border-gray-600 disabled:cursor-not-allowed disabled:opacity-40"
                    title="Expiration unit"
                  >
                    <option value="s">s</option>
                    <option value="m">m</option>
                    <option value="h">h</option>
                  </select>
                </div>
              </div>
              <div className="bg-gray-700/50 rounded p-2 text-[10px] flex-1 flex flex-col text-gray-400">
                <div className="flex justify-between"><span>Cost:</span><span>Payout:</span></div>
                <div className="flex justify-between items-baseline mt-0.5">
                  <span className="text-red-400 font-bold text-[13px]">{orderSide === 'SELL' ? '' : `$${cost.toFixed(2)}`}</span>
                  <span className="text-green-400 font-bold text-[13px]">${payout.toFixed(2)}</span>
                </div>
              </div>
            </div>

            {/* Submit Button + BOT */}
            {!walletConnected ? (
              <button
                onClick={() => appKit.open()}
                className="w-full py-2 rounded-lg font-bold text-sm transition bg-blue-600 hover:bg-blue-700"
              >
                Connect Wallet
              </button>
            ) : (
              <div className="flex gap-1">
                <button
                  onClick={handleSubmitOrder}
                  className={`flex-1 h-9 rounded-lg font-bold text-sm transition whitespace-nowrap overflow-hidden ${
                    orderSide === 'BUY' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {isDialogHidden() && signingState.visible && signingState.sign === 'active' ? (
                    <span className="flex items-center justify-center gap-1 whitespace-nowrap text-xs">
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      {useAppStore.getState().signingMode === 'privateKey' ? 'Signing PK' : 'Sign wallet'}
                    </span>
                  ) : isDialogHidden() && signingState.visible && signingState.submit === 'active' ? (
                    <span className="flex items-center justify-center gap-1 whitespace-nowrap text-xs">
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      Submitting...
                    </span>
                  ) : orderKind === 'market' ? (
                    orderSide === 'BUY' ? 'MARKET BUY' : 'MARKET SELL'
                  ) : (
                    orderSide
                  )}
                </button>
                {customButtons.length > 4 ? (
                  <div className="h-9 grid grid-rows-2 grid-flow-col auto-cols-max gap-1">
                    {customButtons.map((btn) => (
                      <button
                        key={btn.id}
                        onClick={() => handleCustomButtonClick(btn)}
                        draggable
                        onDragStart={() => setDraggingCustomId(btn.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggingCustomId) reorderCustomButtons(draggingCustomId, btn.id);
                          setDraggingCustomId(null);
                        }}
                        onDragEnd={() => setDraggingCustomId(null)}
                        className="relative group w-7 h-4 rounded text-[11px] font-extrabold leading-none transition text-white"
                        style={{ backgroundColor: btn.color, textShadow: '-1px 0 #000, 0 1px #000, 1px 0 #000, 0 -1px #000' }}
                        title={`${btn.side} ${btn.maxSell ? 'MAX' : (orderAmount || '?')} @ ${btn.priceCents}¢`}
                      >
                        {btn.label}
                        <span
                          className="absolute -top-1 -left-1 hidden group-hover:flex items-center justify-center rounded-full bg-black/70 text-white w-3 h-3 cursor-grab active:cursor-grabbing"
                          title="Drag to reorder"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <GripVertical className="w-2 h-2" />
                        </span>
                        <span className="absolute -top-1 -right-1 hidden group-hover:flex items-center gap-0.5">
                          <span
                            onClick={(e) => { e.stopPropagation(); handleEditCustomButton(btn); }}
                            className="flex items-center justify-center rounded-full bg-black/70 text-white w-3 h-3"
                          >
                            <Pencil className="w-2 h-2" />
                          </span>
                          <span
                            onClick={(e) => { e.stopPropagation(); handleRemoveCustomButton(btn.id); }}
                            className="flex items-center justify-center rounded-full bg-black/70 text-white w-3 h-3"
                          >
                            <X className="w-2 h-2" />
                          </span>
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCustomDialogOpen(true)}
                      className="w-7 h-4 rounded text-[9px] font-bold leading-none transition bg-gray-700 hover:bg-gray-600 text-gray-200 flex items-center justify-center"
                      title="Create Custom Button"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <>
                    {customButtons.map((btn) => (
                      <button
                        key={btn.id}
                        onClick={() => handleCustomButtonClick(btn)}
                        draggable
                        onDragStart={() => setDraggingCustomId(btn.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => {
                          if (draggingCustomId) reorderCustomButtons(draggingCustomId, btn.id);
                          setDraggingCustomId(null);
                        }}
                        onDragEnd={() => setDraggingCustomId(null)}
                        className="relative group w-9 py-2 text-[16px] rounded-lg font-extrabold transition text-white"
                        style={{ backgroundColor: btn.color, textShadow: '-1px 0 #000, 0 1px #000, 1px 0 #000, 0 -1px #000' }}
                        title={`${btn.side} ${btn.maxSell ? 'MAX' : (orderAmount || '?')} @ ${btn.priceCents}¢`}
                      >
                        {btn.label}
                        <span
                          className="absolute -top-1 -left-1 hidden group-hover:flex items-center justify-center rounded-full bg-black/70 text-white w-3.5 h-3.5 cursor-grab active:cursor-grabbing"
                          title="Drag to reorder"
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <GripVertical className="w-2.5 h-2.5" />
                        </span>
                        <span className="absolute -top-1 -right-1 hidden group-hover:flex items-center gap-0.5">
                          <span
                            onClick={(e) => { e.stopPropagation(); handleEditCustomButton(btn); }}
                            className="flex items-center justify-center rounded-full bg-black/70 text-white w-3.5 h-3.5"
                          >
                            <Pencil className="w-2.5 h-2.5" />
                          </span>
                          <span
                            onClick={(e) => { e.stopPropagation(); handleRemoveCustomButton(btn.id); }}
                            className="flex items-center justify-center rounded-full bg-black/70 text-white w-3.5 h-3.5"
                          >
                            <X className="w-2.5 h-2.5" />
                          </span>
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCustomDialogOpen(true)}
                      className="w-9 py-2 rounded-lg font-bold text-sm transition bg-gray-700 hover:bg-gray-600 text-gray-200 flex items-center justify-center"
                      title="Create Custom Button"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </>
                )}
                {/* Smart Order button hidden — use backend bot mode via API */}
              </div>
            )}
          </div>

          {/* My Positions & Orders */}
          <div className="sidebar-section">
            <div className="flex items-center justify-between mb-2 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-gray-400 shrink-0">My Positions</span>
                {mergeEligible.showButton && !isMarketExpired && (
                  <button
                    type="button"
                    disabled={!mergeEligible.canOpenDialog}
                    onClick={() => mergeEligible.canOpenDialog && setMergeDialogOpen(true)}
                    onMouseEnter={preloadMergePositionsDialog}
                    onFocus={preloadMergePositionsDialog}
                    title={
                      !mergeEligible.canOpenDialog
                        ? !mergeEligible.conditionId
                          ? 'Market conditionId missing — refresh markets or re-open sidebar'
                          : 'Resolve Polymarket proxy wallet (connect wallet / API keys)'
                        : `Merge complementary ${isUpDownMarket ? 'UP/DOWN' : 'YES/NO'} shares into USDC`
                    }
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded border border-cyan-600/60 text-cyan-300 hover:bg-cyan-900/40 disabled:opacity-35 disabled:cursor-not-allowed shrink-0"
                  >
                    Merge
                  </button>
                )}
              </div>
              <button
                onClick={() => {
                  setPositionsRefreshing(true);
                  triggerWalletRefresh();
                  if (walletForLivePositions) refreshWallet();
                  setTimeout(() => setPositionsRefreshing(false), 2000);
                }}
                className="text-gray-500 hover:text-white transition shrink-0"
                title="Refresh positions"
              >
                <svg className={`w-3 h-3 ${positionsRefreshing ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
              </button>
            </div>
            <div className="space-y-1 text-xs">
              {myPositions.length === 0 ? (
                <div className="text-gray-600">No positions</div>
              ) : (
                myPositions.map((pos, i) => {
                  const outcome = getTokenOutcome(pos.asset || '', marketLookup);
                  const outcomeLabel = isUpDownMarket ? (outcome === 'YES' ? 'UP' : 'DOWN') : outcome;
                  const outcomeColor = outcome === 'YES' ? 'text-green-400' : 'text-red-400';
                  const size = pos.size || 0;
                  const avg = pos.avgPrice || 0;
                  const cost = size * avg;
                  // Mark each position to its own token's live bid (same outcome token),
                  // not the currently viewed opposite-side orderbook.
                  const tokenId = pos.asset || '';
                  const tokenLive = tokenId ? marketLookup[tokenId] : undefined;
                  const tokenBestBid = tokenLive?.bestBid;
                  const currentPrice =
                    typeof tokenBestBid === 'number' && Number.isFinite(tokenBestBid) && tokenBestBid > 0
                      ? tokenBestBid
                      : 0;
                  const currentValue = size * currentPrice;
                  const pnl = currentValue - cost;
                  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
                  const pnlColor = pnl >= 0 ? 'text-green-400' : 'text-red-400';
                  const pnlSign = pnl >= 0 ? '+' : '';
                  const posTok = String(tokenId || '').trim();
                  const closing = closingPositionTokens.has(posTok);
                  return (
                    <div key={posTok || i} className="bg-gray-700/30 rounded px-1.5 py-0.5 text-[12px] min-w-0">
                      <div className="flex justify-between items-start gap-1">
                        <div
                          className="min-w-0 flex-1 text-gray-300 leading-tight break-words"
                          style={{
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          <span className={`${outcomeColor} font-medium`}>{outcomeLabel}</span>
                          <span
                            className="cursor-pointer hover:underline"
                            onClick={() => setOrderAmount((Math.floor(size * 100) / 100).toString())}
                            title="Net contracts held for this outcome (after sells; fills may report slightly different share amounts vs order size due to fees/rounding). Click to use as order amount."
                          >
                            {' '}{Math.floor(size * 100) / 100}
                          </span>
                          <span className="text-gray-500"> @ </span>
                          <span className="text-yellow-400">{(avg * 100).toFixed(1)}¢</span>
                          <span className="text-gray-400"> ${currentValue.toFixed(2)}\${cost.toFixed(2)}</span>
                        </div>
                        {!isMarketExpired && (
                          <button
                            type="button"
                            onClick={() => !closing && handleClosePosition(posTok, size)}
                            disabled={closing}
                            className="w-4 h-4 shrink-0 rounded-sm flex items-center justify-center bg-red-600 hover:bg-red-500 disabled:bg-red-600/50"
                            title="Market sell entire position (FAK)"
                          >
                            {closing ? <span className="cancel-spinner" /> : <span className="text-black text-[10px] font-bold leading-none">✕</span>}
                          </button>
                        )}
                      </div>
                      <div className={`${pnlColor} w-full leading-tight`}>
                        {pnlSign}${Math.abs(Math.round(pnl))} ({pnlSign}{Math.round(pnlPct)}%)
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="my-3 border-t border-gray-700/70" />
            <div className="text-xs text-gray-400 mb-2 mt-3">My Orders</div>
            <div className="space-y-2 text-xs">
              {myOrders.length === 0 && progOrders.length === 0 ? (
                <div className="text-gray-600">No orders</div>
              ) : (
                myOrders.map((order) => {
                  const outcome = getTokenOutcome(order.asset_id || order.token_id || '', marketLookup);
                  const outcomeLabel = isUpDownMarket ? (outcome === 'YES' ? 'UP' : 'DOWN') : outcome;
                  const outcomeColor = outcome === 'YES' ? 'text-green-400' : 'text-red-400';
                  const price = parseFloat(order.price);
                  const totalSize = Math.floor(parseFloat(order.original_size || order.size || '0') * 100) / 100;
                  const filled = Math.floor(parseFloat(order.size_matched || '0') * 100) / 100;
                  const size = parseFloat(order.original_size || order.size);
                  const remainingSize = Math.max(0, totalSize - filled);
                  const sizeDisplay = filled > 0 ? `${(totalSize - filled).toFixed(2)}\\${totalSize.toFixed(2)}` : totalSize.toFixed(2);
                  const expiresBeforeContract = formatPreExpiryLead(order.expiration);

                  const isEditing = editingOrderId === order.id;
                  const orderCardClass =
                    order.side === 'BUY'
                      ? 'rounded-md border border-emerald-900/60 bg-emerald-950/35'
                      : 'rounded-md border border-rose-900/60 bg-rose-950/35';
                  return (
                    <div key={order.id} className={`${orderCardClass} px-2 py-1.5`}>
                      <div className="flex justify-between items-center">
                        <span>
                          <span className={order.side === 'BUY' ? 'text-green-400' : 'text-red-400'}>{order.side}</span>
                          {' '}<span className={outcomeColor}>{outcomeLabel}</span> {filled > 0 ? <>{(totalSize - filled).toFixed(2)}<span className="text-gray-500">\{totalSize.toFixed(2)}</span></> : totalSize.toFixed(2)} @{isEditing ? (
                            <>
                              <input
                                type="number"
                                autoFocus
                                onFocus={(e) => e.target.select()}
                                className="inline-block w-14 bg-gray-800 border border-gray-600 rounded px-1 text-white text-xs font-mono [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                value={editingOrderPrice}
                                onChange={(e) => setEditingOrderPrice(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    const newP = parseFloat(editingOrderPrice);
                                    if (newP && newP !== parseFloat((price * 100).toFixed(1))) {
                                      handleReplaceOrder(order.id, newP, order.asset_id || order.token_id || '', order.side as 'BUY' | 'SELL', remainingSize);
                                    } else { setEditingOrderId(null); }
                                  }
                                  if (e.key === 'Escape') setEditingOrderId(null);
                                }}
                              />
                              <button
                                onClick={() => {
                                  const newP = parseFloat(editingOrderPrice);
                                  if (newP && newP !== parseFloat((price * 100).toFixed(1))) {
                                    handleReplaceOrder(order.id, newP, order.asset_id || order.token_id || '', order.side as 'BUY' | 'SELL', remainingSize);
                                  } else { setEditingOrderId(null); }
                                }}
                                className="w-4 h-4 rounded-sm inline-flex items-center justify-center bg-green-600 hover:bg-green-500 ml-1"
                                title="Confirm replace"
                              ><span className="text-black text-[10px] font-bold leading-none">✓</span></button>
                              <button
                                onClick={() => setEditingOrderId(null)}
                                className="w-4 h-4 rounded-sm inline-flex items-center justify-center bg-gray-600 hover:bg-gray-500 ml-0.5"
                                title="Cancel edit"
                              ><span className="text-black text-[10px] font-bold leading-none">✕</span></button>
                            </>
                          ) : (
                            <span className="cursor-pointer hover:underline text-yellow-400" onClick={() => { setEditingOrderId(order.id); setEditingOrderPrice((price * 100).toFixed(1)); }}>{(price * 100).toFixed(1)}¢</span>
                          )}
                          {' '}<span className="bg-green-800/50 text-green-400 rounded px-1 py-0 text-[10px] font-medium">${(remainingSize * price).toFixed(2)}</span>
                        </span>
                        {!isEditing && (
                          <button
                            onClick={() => !cancellingOrderIds.has(order.id) && handleCancelOrder(order.id)}
                            disabled={cancellingOrderIds.has(order.id)}
                            className="w-4 h-4 rounded-sm flex items-center justify-center flex-shrink-0 bg-red-600 hover:bg-red-500 disabled:bg-red-600/50"
                            title="Cancel order"
                          >{cancellingOrderIds.has(order.id) ? <span className="cancel-spinner"/> : <span className="text-black text-[10px] font-bold leading-none">✕</span>}</button>
                        )}
                      </div>
                      {expiresBeforeContract && (
                        <div
                          className="mt-0.5 flex items-center gap-1 text-[10px] text-cyan-300"
                          title={`Expires ${expiresBeforeContract} before market expiry (order expiration lead time).`}
                        >
                          <Clock size={10} />
                          <span>{expiresBeforeContract}</span>
                        </div>
                      )}
                      {!isEditing && (
                        <div className="mt-0.5 flex items-center gap-0.5 flex-wrap">
                          {[-10, -5, -2, -1, 1, 2, 5, 10].map((delta) => {
                            const newP = parseFloat((price * 100 + delta).toFixed(1));
                            if (newP < 0.1 || newP > 99.9) return null;
                            const deltaClass =
                              delta < 0
                                ? (Math.abs(delta) >= 10
                                    ? 'bg-red-950/85 text-red-200 hover:bg-red-900'
                                    : Math.abs(delta) >= 5
                                      ? 'bg-red-900/80 text-red-200 hover:bg-red-800'
                                      : Math.abs(delta) >= 2
                                      ? 'bg-red-900/65 text-red-200 hover:bg-red-800/80'
                                        : 'bg-red-900/45 text-red-300 hover:bg-red-800/70')
                                : (delta >= 10
                                    ? 'bg-green-900/35 text-green-300 hover:bg-green-800/60'
                                    : delta >= 5
                                      ? 'bg-green-900/45 text-green-300 hover:bg-green-800/70'
                                      : delta >= 2
                                        ? 'bg-green-900/65 text-green-200 hover:bg-green-800/80'
                                        : 'bg-green-900/80 text-green-200 hover:bg-green-700/90');
                            return (
                              <button
                                key={delta}
                                onClick={() => {
                                  handleReplaceOrder(order.id, newP, order.asset_id || order.token_id || '', order.side as 'BUY' | 'SELL', remainingSize);
                                }}
                                className={`text-[9px] px-1 py-0 rounded ${deltaClass}`}
                              >
                                {delta > 0 ? '+' : ''}{delta}¢
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {isEditing && (
                        <div className="mt-1 flex items-center gap-1">
                          <span className="text-[9px] text-gray-500 w-4 text-right">1</span>
                          <input
                            type="range"
                            min={1}
                            max={99}
                            step={1}
                            value={Math.round(parseFloat(editingOrderPrice) || 0)}
                            onChange={(e) => setEditingOrderPrice(e.target.value)}
                            onMouseUp={() => {
                              const newP = parseFloat(editingOrderPrice);
                              if (newP && newP !== parseFloat((price * 100).toFixed(1))) {
                                handleReplaceOrder(order.id, newP, order.asset_id || order.token_id || '', order.side as 'BUY' | 'SELL', remainingSize);
                              }
                            }}
                            onTouchEnd={() => {
                              const newP = parseFloat(editingOrderPrice);
                              if (newP && newP !== parseFloat((price * 100).toFixed(1))) {
                                handleReplaceOrder(order.id, newP, order.asset_id || order.token_id || '', order.side as 'BUY' | 'SELL', remainingSize);
                              }
                            }}
                            className="flex-1 h-1 accent-blue-500 cursor-pointer"
                          />
                          <span className="text-[9px] text-gray-500 w-5">99</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {progOrders.length > 0 && (<>
              <div className="space-y-1 text-xs mt-1">
                {progOrders.map((order) => {
                  const outcome = getTokenOutcome(order.asset_id || order.token_id || '', marketLookup);
                  const price = parseFloat(order.price);
                  const size = parseFloat(order.original_size || order.size);
                  const filled = Math.round(parseFloat(order.size_matched || '0'));
                  const sizeNum = Math.round(parseFloat(order.original_size || order.size || '0'));
                  const filledDisplay = filled > 0 ? `${filled}/${sizeNum}` : String(sizeNum);
                  const value = (price * size).toFixed(2);
                  const pId = progOrderMap[order.id];
                  const expiresBeforeContract = formatPreExpiryLead(order.expiration);
                  return (
                    <div key={order.id} className="bg-purple-900/40 border border-purple-700/40 rounded px-1.5 py-0.5 text-[12px]">
                      <div className="flex items-center gap-1">
                        {pId && <span className="text-cyan-400 text-[9px]">#{pId}</span>}
                        <span className={order.side === 'BUY' ? 'text-green-400 font-medium' : 'text-red-400 font-medium'}>{order.side}</span>
                        <span className={outcome === 'YES' ? 'text-green-400' : 'text-red-400'}>{outcome}</span>
                        <span className="text-gray-300">{filledDisplay}</span>
                        <span className="text-gray-500">@</span>
                        <span className="text-gray-300">{(price * 100).toFixed(1)}¢</span>
                        <span className="text-gray-500">${value}</span>
                        <button onClick={() => !cancellingOrderIds.has(order.id) && handleCancelOrder(order.id)} disabled={cancellingOrderIds.has(order.id)} className="w-4 h-4 rounded-sm flex items-center justify-center ml-auto flex-shrink-0 bg-red-600 hover:bg-red-500 disabled:bg-red-600/50" title="Cancel order">
                          {cancellingOrderIds.has(order.id) ? <span className="cancel-spinner"/> : <span className="text-black text-[10px] font-bold leading-none">✕</span>}
                        </button>
                      </div>
                      {expiresBeforeContract && (
                        <div
                          className="mt-0.5 flex items-center gap-1 text-[10px] text-cyan-300"
                          title={`Expires ${expiresBeforeContract} before market expiry (order expiration lead time).`}
                        >
                          <Clock size={10} />
                          <span>{expiresBeforeContract}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>)}
          </div>


          {/* My Trades */}
          <div className="sidebar-section">
            <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
              <span>My Trades</span>
              <span className={myTradesPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                PnL {myTradesPnl >= 0 ? '+' : ''}${Math.abs(myTradesPnl).toFixed(2)}
              </span>
            </div>
            <div className="max-h-48 overflow-y-auto text-[11px]">
              {myTradesDisplay.length === 0 ? (
                <div className="text-gray-600">No trades</div>
              ) : (
                <table className="w-full table-fixed border-separate border-spacing-y-0.5">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wide text-gray-500">
                      <th className="text-left font-medium">Dir</th>
                      <th className="text-left font-medium">Side</th>
                      <th className="text-right font-medium">Size</th>
                      <th className="text-right font-medium">Price</th>
                      <th className="text-right font-medium">Fee</th>
                      <th className="text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                {myTradesDisplay.map((trade, i) => {
                  const tid = getTradeClobTokenId(trade) || String(trade.asset_id || trade.token_id || '').trim();
                  const outcome = getTokenOutcome(tid, marketLookup);
                  const sideLabel = isUpDownMarket ? (outcome === 'YES' ? 'UP' : 'DOWN') : outcome;
                  const rawPrice = parseFloat(trade.price);
                  const size = tradeFilledSizeShares(trade);
                  const isClaim = rawPrice === 0 && !(trade as { side?: string | null }).side;
                  const side = isClaim ? 'CLAIM' : trade.side;
                  const cost = Number.isFinite(rawPrice) && Number.isFinite(size) ? rawPrice * size : 0;
                  const signedCost =
                    side === 'BUY' || side === 'SPLIT'
                      ? -cost
                      : side === 'SELL' || side === 'MERGE'
                        ? cost
                        : 0;
                  const tradeFee = parseFloat(trade.fee || '0');
                  const dirTone =
                    side === 'BUY'
                      ? 'text-emerald-400'
                      : side === 'CLAIM'
                        ? 'text-blue-400'
                        : side === 'SPLIT' || side === 'MERGE'
                          ? 'text-purple-400'
                          : 'text-rose-400';
                  return (
                    <tr key={i} className="text-gray-300">
                      <td className={`py-0.5 ${dirTone}`}>{side || '-'}</td>
                      <td className={outcome === 'YES' ? 'py-0.5 text-emerald-400' : 'py-0.5 text-rose-400'}>{sideLabel}</td>
                      <td className="py-0.5 text-right">{Number.isFinite(size) ? size.toFixed(2) : '-'}</td>
                      <td className="py-0.5 text-right">{Number.isFinite(rawPrice) ? `${(rawPrice * 100).toFixed(1)}¢` : '-'}</td>
                      <td className="py-0.5 text-right text-yellow-400/80">{tradeFee > 0 ? `$${tradeFee.toFixed(2)}` : '-'}</td>
                      <td
                        className={`py-0.5 text-right ${
                          side === 'BUY' || side === 'SPLIT'
                            ? 'text-rose-400'
                            : side === 'SELL' || side === 'MERGE'
                              ? 'text-emerald-400'
                              : 'text-gray-300'
                        }`}
                      >
                        {signedCost >= 0 ? '+' : '-'}${Math.abs(signedCost).toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
      {customDialogOpen && typeof document !== 'undefined' && createPortal((
        <div className="fixed inset-0 z-[60000] bg-black/70 flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) setCustomDialogOpen(false); }}>
          <div className="w-full max-w-sm mx-4 rounded-lg border border-gray-600 bg-gray-800 p-4">
            <div className="text-sm font-bold text-white mb-3">{editingCustomButtonId ? 'Edit Custom Button' : 'Create Custom Button'}</div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-gray-400 w-16">Side</span>
                <select value={customSide} onChange={(e) => setCustomSide(e.target.value as 'BUY' | 'SELL')} className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white flex-1">
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 w-16">Price ¢</span>
                <input value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} type="number" min="0.1" max="99.9" step="0.1" className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white flex-1" />
              </div>
              {customSide === 'SELL' && (
                <label className="flex items-center gap-2 ml-[4.5rem] text-gray-300">
                  <input type="checkbox" checked={customSellMax} onChange={(e) => setCustomSellMax(e.target.checked)} className="rounded accent-red-500" />
                  <span>Max</span>
                </label>
              )}
              <div className="flex items-center gap-2">
                <span className="text-gray-400 w-16">Label</span>
                <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value.slice(0, 3))} maxLength={3} className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-16 text-center font-bold" />
                <span className="text-gray-500 text-[10px]">1-3 chars</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 w-16">Color</span>
                <input value={customColor} onChange={(e) => setCustomColor(e.target.value)} type="color" className="w-10 h-8 bg-transparent border border-gray-600 rounded cursor-pointer" />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => { setCustomDialogOpen(false); setEditingCustomButtonId(null); }} className="px-3 py-1.5 rounded bg-gray-600 hover:bg-gray-500 text-xs font-medium">Cancel</button>
              <button onClick={handleCreateCustomButton} className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-xs font-bold">{editingCustomButtonId ? 'Save' : 'Create'}</button>
            </div>
          </div>
        </div>
      ), document.body)}
      {crossingConfirmOpen && typeof document !== 'undefined' && createPortal((
        <div className="fixed inset-0 z-[61000] bg-black/70 flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) closeCrossingConfirm(false); }}>
          <div className="w-full max-w-sm mx-4 rounded-lg border border-amber-500/40 bg-gray-900 p-4">
            <div className="text-sm font-bold text-amber-300 mb-2">Instant execution warning</div>
            <div className="text-xs text-gray-200">{crossingConfirmMessage}</div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => closeCrossingConfirm(false)} className="px-3 py-1.5 rounded bg-gray-700 hover:bg-gray-600 text-xs font-medium">Cancel</button>
              <button onClick={() => closeCrossingConfirm(true)} className="px-3 py-1.5 rounded bg-amber-600 hover:bg-amber-500 text-xs font-bold text-black">Continue</button>
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
    </>
  );
}
