import { useState, useEffect, useMemo, useRef, useCallback, Suspense, useSyncExternalStore, memo } from 'react';
import { useAccount } from 'wagmi';
import { createPortal } from 'react-dom';
import { useAppStore } from '../stores/appStore';
import { appKit } from '../lib/wallet';
import {
  fetchMarketStakedLegs,
  mergeMarketStakedLegsResponse,
  placeOrder,
  cancelOrder,
  cancelOrders,
  signOrder,
  submitSignedOrder,
  type MarketStakedLegsResponse,
} from '../api';
import { fetchProxyWallet } from '../api/polymarket';
import { resolvePolymarketMakerAddress } from '../lib/polymarketTradingMaker';
import { polymarketSiteUrl } from '../lib/polymarketSiteUrl';
import { triggerWalletRefresh } from '../lib/clobClient';
import { executeMergePositions } from '../lib/mergePositions';
import { showToast } from '../utils/toast';
import { signingDialog, isDialogHidden } from './SigningDialog';
import {
  extractAssetFromMarket,
  formatPolymarketVolumeK,
  getOrderClobTokenId,
  getTokenOutcome,
  getTradeClobTokenId,
  outcomeTokenBelongsToSelectedMarket,
  shortenMarketName,
  tradeMatchesSelectedMarket,
  hitStrikeMetaForBs,
  upDownMarketUsesChainlinkSpot,
  upDownTimeframeKeyFromMarket,
} from '../utils/format';
import { isMarketInWeeklyHitMarkets } from '../utils/bsMath';
import type { LiveTrade } from '../hooks/usePolymarketOB';
import { BsFlower } from './BsFlower';
import { HelpTooltip } from './HelpTooltip';
import { sidebarChartIntervalFromContext } from '../lib/chartVolatility';
import { useSidebarChartVolatility } from '../hooks/useSidebarChartVolatility';
import { useThrottledBidAskMarketRow } from '../hooks/useThrottledBidAskMarketRow';
import {
  TOXIC_FAVOURITE_WALLETS_LS_KEY,
  TOXIC_FAVOURITES_CHANGED_EVENT,
  readToxicFavouriteWallets,
} from '../lib/toxicFavouriteWallets';
import {
  readToxicXWallets,
  TOXIC_X_CHANGED_EVENT,
  TOXIC_X_WALLETS_LS_KEY,
} from '../lib/toxicXWallets';
import { persistTiltWhaleAmountUsd, readTiltWhaleAmountUsd } from '../lib/tiltWhaleAmountUsd';
import {
  bumpNotifyTiltMarketFiltersRevision,
  useNotifyTiltAppliesToSelectedMarket,
} from '../lib/notifyTiltMarketFilters';
import {
  NOTIFY_MULTI_RING_GAP_MS,
  pitchMulFromNotifyFreqSlider,
  playTiltNotifySoundStrikes,
  playTiltNotifySoundWithDoubleRing,
  playTradeNotifySound,
  primeTiltAudioContextFromUserGesture,
  readNotifyRingTimeS,
  readNotifySoundFreqSlider,
  readNotifySoundVolumeSlider,
  readNotifyTradeSound,
  readTradeSoundFreqSlider,
  readTradeSoundVolumeSlider,
  SIDEBAR_NOTIFY_RING_TIME_S_KEY,
  SIDEBAR_NOTIFY_TRADE_SOUND_KEY,
  SIDEBAR_NOTIFY_SOUND_FREQ_KEY,
  SIDEBAR_NOTIFY_SOUND_VOLUME_KEY,
  SIDEBAR_TRADE_SOUND_FREQ_KEY,
  SIDEBAR_TRADE_SOUND_VOLUME_KEY,
} from '../lib/tiltNotifySound';
import { isMarketExpired as marketIsExpired } from '../lib/marketExpiry';
import {
  readNotifySoundMaxPriceCents,
  SIDEBAR_NOTIFY_SOUND_MAX_PRICE_CENTS_KEY,
} from '../lib/notifySoundPriceMute';
import {
  NOTIFY_BELL_MIN_STAKE_CHANGED_EVENT,
  readNotifyBellMinStakeUsd,
  SIDEBAR_NOTIFY_BELL_MIN_STAKE_USD_KEY,
} from '../lib/toxicBellRowRing';
import {
  playChartVolumeSpikeRing,
  readNotifyVolumeSpikeRingEnabled,
  SIDEBAR_NOTIFY_VOLUME_SPIKE_RING_KEY,
} from '../lib/chartVolumeSpikeAlert';
import {
  publishUpDownNextHiSettings,
  readNotifyUpDownNextHi,
  readNotifyUpDownNextHiCents,
  SIDEBAR_NOTIFY_UPDOWN_NEXT_HI_CENTS_KEY,
  SIDEBAR_NOTIFY_UPDOWN_NEXT_HI_KEY,
} from '../lib/upDownNextMarketFlashSound';
import {
  getMarketNotifyMutedSnapshot,
  isMarketNotifyMuted,
  subscribeMarketNotifyMuted,
  toggleMarketNotifyMuted,
} from '../lib/marketNotifyMute';
import { SidebarChartsRow } from './SidebarChartsRow';
import { SidebarPolymarketOBHost, type SidebarPolymarketBookSnapshot } from './SidebarPolymarketOBHost';
import { SidebarOrderCostDisplay } from './SidebarOrderCostDisplay';
import { SidebarMarketStatsCells, SidebarNotifyStakedGateSync } from './SidebarMarketStatsCells';
import {
  getSidebarSpotStripBsSnapshot,
} from '../lib/sidebarSpotStripStore';
import { SidebarSpotStripSection } from './SidebarSpotStripSection';
import { SidebarOrderBsMathButton } from './SidebarOrderBsMathButton';
import { SidebarOrderReplaceBsButton } from './SidebarOrderReplaceBsButton';
import { SidebarLiveTradesSection } from './SidebarLiveTradesSection';
import { SidebarOnchainTradesHost } from './SidebarOnchainTradesHost';
import { SidebarOnchainGridPositionsSync } from './SidebarOnchainGridPositionsSync';
import { SidebarMyTradesSection } from './SidebarMyTradesSection';
import {
  refreshSidebarOnchainMarketTrades,
  refreshSidebarOnchainWallet,
} from '../lib/sidebarOnchainTradesStore';
import { SidebarMyPositionsPanel, type SidebarMergeEligible } from './SidebarMyPositionsPanel';
import { SidebarToxicFlowHost } from './SidebarToxicFlowHost';
import { SidebarToxicStrips } from './SidebarToxicStrips';
import { SidebarToxicPanel, preloadSidebarToxicFlowDialog } from './SidebarToxicPanel';
import { resetSidebarToxicWalletExtraWidth } from '../lib/sidebarToxicWalletWidthStore';
import { setSidebarChartAnnualVolPct } from '../lib/sidebarChartVolStore';
import { SidebarToxicWalletWidthHost } from './SidebarToxicWalletWidthHost';
import { SidebarToxicNotifySoundHost } from './SidebarToxicNotifySoundHost';
import { SidebarToxicStatsFlashWrap } from './SidebarToxicStatsFlashWrap';
import { NotifyDialogNumberInput } from './NotifyDialogNumberInput';
import { SidebarUpDownTargetHost } from './SidebarUpDownTargetHost';
import { SidebarUpDownEndPicker } from './SidebarUpDownEndPicker';
import { SidebarOrderHighlightHost } from './SidebarOrderHighlightHost';
import {
  useSidebarUpDownTargetPrice,
} from '../lib/sidebarUpDownTargetStore';
import { computeSidebarMyPositions } from '../lib/sidebarMyPositions';
import { getSidebarOnchainTradesSnapshot } from '../lib/sidebarOnchainTradesStore';
import { SidebarDataSourceBadge } from './SidebarDataSourceBadge';
import { SidebarHoldersExpandTip } from './SidebarHoldersExpandTip';
import { SidebarNotifyGearTip } from './SidebarNotifyGearTip';
import { SidebarHistoryTip } from './SidebarHistoryTip';
import {
  isDesktopScreenViewport,
  persistSidebarHoldersExpandTipDismissed,
  readSidebarHoldersExpandTipDismissed,
} from '../lib/sidebarHoldersExpandTip';
import {
  persistSidebarNotifyGearTipDismissed,
  readSidebarNotifyGearTipDismissed,
} from '../lib/sidebarNotifyGearTip';
import {
  persistSidebarHistoryTipDismissed,
  readSidebarHistoryTipDismissed,
} from '../lib/sidebarHistoryTip';
import { readToxicFlowRowActionsTipDismissed } from '../lib/toxicFlowRowActionsTip';
import { isOnboardingBlockingUiOpen, subscribeOnboardingBlockingUi } from '../lib/onboardingBlockingUi';
import { getBidAskMarketRow } from '../lib/bidAskMarketLookup';
import {
  ArrowRight,
  History,
  Bell,
  BellOff,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePercent,
  Clock,
  GripVertical,
  Pencil,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import type { AssetSymbol, Market, Position } from '../types';
import type { WalletPosition } from '../api';
import { importWithChunkReload, lazyWithChunkReload } from '../utils/lazyWithChunkReload';

const MergePositionsDialogLazy = lazyWithChunkReload(() =>
  import('./MergePositionsDialog').then((m) => ({ default: m.MergePositionsDialog })),
);

function preloadMergePositionsDialog() {
  void importWithChunkReload(() => import('./MergePositionsDialog'));
}
const SIDEBAR_ORDER_KIND_KEY = 'polymarket-sidebar-order-kind';
const SIDEBAR_CUSTOM_BUTTONS_KEY = 'polymarket-sidebar-custom-buttons';
const SIDEBAR_TOXIC_EXPANDED_KEY = 'polybot-sidebar-toxic-expanded';
const SIDEBAR_CHART_OUTCOME_SYNC_KEY = 'polybot-sidebar-chart-outcome-sync';
function readChartOutcomeSync(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_CHART_OUTCOME_SYNC_KEY);
    if (v === '0') return false;
    return true;
  } catch {
    return true;
  }
}

/** Quick limit buttons (¢) below cost/payout — one row buy / one row sell: 5, then +10 through 95. */
const SIDEBAR_QUICK_LIMIT_GRID_CENTS: readonly number[] = Array.from({ length: 10 }, (_, i) => 5 + i * 10);

/** Buy row: emerald-style green; left starts darker, right unchanged (~10% L). */
function sidebarQuickBuyBg(i: number, n: number): string {
  const t = n <= 1 ? 0 : i / (n - 1);
  const lStart = 28;
  const lEnd = 10;
  const l = lStart - t * (lStart - lEnd);
  return `hsl(158 70% ${l}%)`;
}

/** Sell row: rose/red; left starts darker, right unchanged (~10% L). */
function sidebarQuickSellBg(i: number, n: number): string {
  const t = n <= 1 ? 0 : i / (n - 1);
  const lStart = 28;
  const lEnd = 10;
  const l = lStart - t * (lStart - lEnd);
  return `hsl(351 78% ${l}%)`;
}

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


const SIDEBAR_NOTIFY_PLAY_SOUND_KEY = 'polybot-sidebar-notify-play-sound';
const SIDEBAR_NOTIFY_FLASH_BG_KEY = 'polybot-sidebar-notify-flash-bg';
/** Legacy TOP tilt — migrated into holder tilt on read. */
const SIDEBAR_NOTIFY_TOP_THRESHOLD_PCT_LEGACY_KEY = 'polybot-sidebar-notify-top-threshold-pct';
const SIDEBAR_NOTIFY_HOLDER_TILT_PCT_KEY = 'polybot-sidebar-notify-holder-tilt-pct';
const SIDEBAR_NOTIFY_SMART_TILT_PCT_KEY = 'polybot-sidebar-notify-smart-tilt-pct';
const SIDEBAR_NOTIFY_FAVOURITE_TILT_PCT_KEY = 'polybot-sidebar-notify-favourite-tilt-pct';
const SIDEBAR_NOTIFY_GREENS_TILT_PCT_KEY = 'polybot-sidebar-notify-greens-tilt-pct';
/** Legacy cohort tilt key (Profiter / PnL+). */
const SIDEBAR_NOTIFY_PROFIT_TILT_PCT_LEGACY_KEY = 'polybot-sidebar-notify-profit-tilt-pct';
const SIDEBAR_NOTIFY_STAKED_MIN_USD_KEY = 'polybot-sidebar-notify-staked-min-usd';
const SIDEBAR_NOTIFY_WHALE_MAX_PRICE_CENTS_KEY = 'polybot-sidebar-notify-whale-max-price-cents';
const SIDEBAR_NOTIFY_WHALE_IGNORE_NEGATIVE_PNL_KEY = 'polybot-sidebar-notify-whale-ignore-negative-pnl';
const SIDEBAR_NOTIFY_DOUBLE_RING_KEY = 'polybot-sidebar-notify-double-ring';
const SIDEBAR_NOTIFY_WHALE_RING_KEY = 'polybot-sidebar-notify-whale-ring';
const SIDEBAR_NOTIFY_WHALE_RING_MUTABLE_KEY = 'polybot-sidebar-notify-whale-ring-mutable';
const SIDEBAR_NOTIFY_BELL_RING_KEY = 'polybot-sidebar-notify-bell-ring';
const SIDEBAR_NOTIFY_TILT_MKT_UPDOWN_KEY = 'polybot-sidebar-notify-tilt-mkt-updown';
const SIDEBAR_NOTIFY_TILT_MKT_HIT_KEY = 'polybot-sidebar-notify-tilt-mkt-hit';
const SIDEBAR_NOTIFY_TILT_MKT_ABOVE_KEY = 'polybot-sidebar-notify-tilt-mkt-above';
const SIDEBAR_NOTIFY_TILT_MKT_BETWEEN_KEY = 'polybot-sidebar-notify-tilt-mkt-between';
const SIDEBAR_NOTIFY_TILT_UD_5M_KEY = 'polybot-sidebar-notify-tilt-ud-5m';
const SIDEBAR_NOTIFY_TILT_UD_15M_KEY = 'polybot-sidebar-notify-tilt-ud-15m';
const SIDEBAR_NOTIFY_TILT_UD_1H_KEY = 'polybot-sidebar-notify-tilt-ud-1h';
const SIDEBAR_NOTIFY_TILT_UD_4H_KEY = 'polybot-sidebar-notify-tilt-ud-4h';
const SIDEBAR_NOTIFY_MAX_VOLATILITY_PCT_KEY = 'polybot-sidebar-notify-max-volatility-pct';
const SIDEBAR_NOTIFY_VOLATILITY_CANDLES_KEY = 'polybot-sidebar-notify-volatility-candles';

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
function readNotifyHolderTiltPct(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_HOLDER_TILT_PCT_KEY);
    if (raw != null && raw !== '') {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) return Math.min(99, Math.max(0, Math.round(n)));
    }
    const legacy = localStorage.getItem(SIDEBAR_NOTIFY_TOP_THRESHOLD_PCT_LEGACY_KEY);
    const n = parseFloat(legacy ?? '');
    if (Number.isFinite(n)) return Math.min(99, Math.max(0, Math.round(n)));
    return 30;
  } catch {
    return 30;
  }
}
function readNotifySmartTiltPct(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_SMART_TILT_PCT_KEY);
    const n = parseFloat(raw ?? '30');
    if (!Number.isFinite(n)) return 30;
    return Math.min(99, Math.max(0, Math.round(n)));
  } catch {
    return 30;
  }
}
function readNotifyFavouriteTiltPct(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_FAVOURITE_TILT_PCT_KEY);
    const n = parseFloat(raw ?? '0');
    if (!Number.isFinite(n)) return 0;
    return Math.min(99, Math.max(0, Math.round(n)));
  } catch {
    return 0;
  }
}
function readNotifyGreensTiltPct(): number {
  try {
    let raw = localStorage.getItem(SIDEBAR_NOTIFY_GREENS_TILT_PCT_KEY);
    if (raw == null || raw === '') {
      raw = localStorage.getItem(SIDEBAR_NOTIFY_PROFIT_TILT_PCT_LEGACY_KEY);
    }
    const n = parseFloat(raw ?? '30');
    if (!Number.isFinite(n)) return 30;
    return Math.min(99, Math.max(0, Math.round(n)));
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
function readNotifyDoubleRing(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_DOUBLE_RING_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}
function readNotifyWhaleRing(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_WHALE_RING_KEY);
    if (v === null) return false;
    return v === '1';
  } catch {
    return false;
  }
}

function readNotifyWhaleRingMutable(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_WHALE_RING_MUTABLE_KEY);
    if (v === null) return false;
    return v === '1';
  } catch {
    return false;
  }
}

function readNotifyBellRing(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_BELL_RING_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}

function readNotifyWhaleMaxPriceCents(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_WHALE_MAX_PRICE_CENTS_KEY);
    const n = parseFloat(raw ?? '75');
    if (!Number.isFinite(n)) return 75;
    return Math.min(99, Math.max(1, Math.round(n)));
  } catch {
    return 75;
  }
}

function readNotifyWhaleIgnoreNegativePnl(): boolean {
  try {
    const v = localStorage.getItem(SIDEBAR_NOTIFY_WHALE_IGNORE_NEGATIVE_PNL_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}

/** Annualized σ% ceiling for tilt: alerts pause while chart σ is above this. 0 = off. Default 15. */
function readNotifyMaxVolatilityPct(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_MAX_VOLATILITY_PCT_KEY);
    const n = parseFloat(raw ?? '15');
    if (!Number.isFinite(n) || n < 0) return 15;
    return Math.min(500, Math.round(n));
  } catch {
    return 15;
  }
}

/** Completed sidebar-chart candles for σ (excluding in-progress bar). Min 3. Default 5. */
function readNotifyVolatilityCandles(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_NOTIFY_VOLATILITY_CANDLES_KEY);
    const n = parseInt(raw ?? '5', 10);
    if (!Number.isFinite(n)) return 5;
    return Math.min(500, Math.max(3, n));
  } catch {
    return 5;
  }
}

/** FAK buy: pay up to this per share to lift asks. */
const MARKET_AGGRESSIVE_BUY = 0.99;
/** FAK sell: accept down to this per share to hit bids. */
const MARKET_AGGRESSIVE_SELL = 0.01;

/** Max-USD cap uses notional price × size (BUY and SELL). */
function orderNotionalUsd(priceDecimal: number, size: number): number {
  if (!Number.isFinite(priceDecimal) || !Number.isFinite(size) || size <= 0 || priceDecimal <= 0) return 0;
  return priceDecimal * size;
}

function maxOrderUsdViolationMessage(maxUsd: number, valueUsd: number): string | null {
  if (!Number.isFinite(maxUsd) || maxUsd <= 0) return null;
  if (!Number.isFinite(valueUsd) || valueUsd <= maxUsd) return null;
  const lim =
    Number.isInteger(maxUsd) || Math.abs(maxUsd - Math.round(maxUsd)) < 1e-9 ? String(Math.round(maxUsd)) : maxUsd.toFixed(2);
  return `Max order size ${lim} USD. To increase the limit go to settings menu in the header.`;
}

/** Market-crossing check using live WS best bid/ask (pending patch), not throttled grid store. */
function orderCrossesBookFromWsLookup(
  tokenId: string,
  side: 'BUY' | 'SELL',
  orderPriceCents: number,
): { crosses: boolean; bestCounterpartyCents: number | null } {
  const row = getBidAskMarketRow(String(tokenId || '').trim());
  const bestBidDec = typeof row?.bestBid === 'number' && Number.isFinite(row.bestBid) ? row.bestBid : null;
  const bestAskDec = typeof row?.bestAsk === 'number' && Number.isFinite(row.bestAsk) ? row.bestAsk : null;
  const bestBidCents = bestBidDec != null && bestBidDec > 0 ? bestBidDec * 100 : null;
  const bestAskCents = bestAskDec != null && bestAskDec > 0 ? bestAskDec * 100 : null;
  if (side === 'BUY') {
    if (bestAskCents == null) return { crosses: false, bestCounterpartyCents: null };
    return {
      crosses: orderPriceCents >= bestAskCents,
      bestCounterpartyCents: bestAskCents,
    };
  }
  if (bestBidCents == null) return { crosses: false, bestCounterpartyCents: null };
  return {
    crosses: orderPriceCents <= bestBidCents,
    bestCounterpartyCents: bestBidCents,
  };
}

/** Polymarket rows may include `size_filled`; on-chain mapped trades only have `size`. */
function tradeFilledSizeShares(trade: { size: string; size_filled?: string }): number {
  return parseFloat(trade.size_filled ?? trade.size);
}

/** Polymarket positions API default sizeThreshold — sub-threshold shares are dust. */
const SIDEBAR_POSITION_DUST_SIZE = 0.01;

function isSidebarDustPosition(size: number): boolean {
  return !Number.isFinite(size) || size < SIDEBAR_POSITION_DUST_SIZE;
}

type CustomSidebarOrderOutcome = 'YES' | 'NO' | 'AUTO';

type CustomSidebarPriceMode = 'FIXED' | 'BS_MINUS_C' | 'BS_PLUS_C' | 'BS_MINUS_PCT' | 'BS_PLUS_PCT';

type CustomSidebarOrderSpec = {
  side: 'BUY' | 'SELL';
  priceMode: CustomSidebarPriceMode;
  /** Fixed ¢, or BS offset (¢ or percentage points). */
  priceValue: number;
  maxSell: boolean;
  /** AUTO = use sidebar Place Order YES/NO toggle. */
  outcome: CustomSidebarOrderOutcome;
};

type CustomSidebarButton = {
  id: string;
  label: string;
  color: string;
  orders: CustomSidebarOrderSpec[];
};

type CustomOrderDraft = {
  side: 'BUY' | 'SELL';
  priceMode: CustomSidebarPriceMode;
  price: string;
  maxSell: boolean;
  outcome: CustomSidebarOrderOutcome;
};

const DEFAULT_CUSTOM_ORDER_DRAFT = (): CustomOrderDraft => ({
  side: 'BUY',
  priceMode: 'FIXED',
  price: '',
  maxSell: false,
  outcome: 'AUTO',
});

function normalizeCustomSidebarPriceMode(raw: unknown): CustomSidebarPriceMode {
  const s = String(raw || 'FIXED').toUpperCase();
  if (s === 'BS_MINUS_C') return 'BS_MINUS_C';
  if (s === 'BS_PLUS_C') return 'BS_PLUS_C';
  if (s === 'BS_MINUS_PCT') return 'BS_MINUS_PCT';
  if (s === 'BS_PLUS_PCT') return 'BS_PLUS_PCT';
  return 'FIXED';
}

function customOrderPriceInputSuffix(mode: CustomSidebarPriceMode): string {
  return mode === 'BS_MINUS_PCT' || mode === 'BS_PLUS_PCT' ? '%' : '¢';
}

function customOrderPriceLabel(spec: CustomSidebarOrderSpec): string {
  switch (spec.priceMode) {
    case 'BS_MINUS_C':
      return `BS-${spec.priceValue}¢`;
    case 'BS_PLUS_C':
      return `BS+${spec.priceValue}¢`;
    case 'BS_MINUS_PCT':
      return `BS-${spec.priceValue}%`;
    case 'BS_PLUS_PCT':
      return `BS+${spec.priceValue}%`;
    default:
      return `${spec.priceValue}¢`;
  }
}

function resolveCustomOrderPriceCents(spec: CustomSidebarOrderSpec, mathProbCents: number | null): number | null {
  const v = spec.priceValue;
  if (spec.priceMode === 'FIXED') {
    if (!Number.isFinite(v) || v <= 0 || v >= 100) return null;
    return v;
  }
  if (mathProbCents == null || !Number.isFinite(mathProbCents)) return null;
  let cents: number;
  switch (spec.priceMode) {
    case 'BS_MINUS_C':
      cents = mathProbCents - v;
      break;
    case 'BS_PLUS_C':
      cents = mathProbCents + v;
      break;
    case 'BS_MINUS_PCT':
      cents = mathProbCents - v;
      break;
    case 'BS_PLUS_PCT':
      cents = mathProbCents + v;
      break;
    default:
      return null;
  }
  if (!Number.isFinite(cents) || cents <= 0 || cents >= 100) return null;
  return Math.round(cents * 10) / 10;
}

/** BS offsets apply to bs_yes; YES uses that value, NO uses 100 − that value. */
function resolveBsAnchoredCustomOrderPriceCents(
  spec: CustomSidebarOrderSpec,
  bsYesCents: number | null | undefined,
  outcome: 'YES' | 'NO',
): number | null {
  if (spec.priceMode === 'FIXED') return resolveCustomOrderPriceCents(spec, null);
  const yesAnchored = resolveCustomOrderPriceCents(spec, bsYesCents ?? null);
  if (yesAnchored == null) return null;
  const cents = outcome === 'YES' ? yesAnchored : 100 - yesAnchored;
  if (!Number.isFinite(cents) || cents <= 0 || cents >= 100) return null;
  return Math.round(cents * 10) / 10;
}

function normalizeCustomSidebarOrderSpec(raw: unknown): CustomSidebarOrderSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const side = o.side === 'SELL' ? 'SELL' : o.side === 'BUY' ? 'BUY' : null;
  if (!side) return null;
  const priceMode = normalizeCustomSidebarPriceMode(o.priceMode);
  const priceValue =
    Number.isFinite(Number(o.priceValue)) ? Number(o.priceValue) : Number(o.priceCents);
  if (!Number.isFinite(priceValue)) return null;
  if (priceMode === 'FIXED' && (priceValue <= 0 || priceValue >= 100)) return null;
  if (priceMode !== 'FIXED' && priceValue < 0) return null;
  const outcomeRaw = String(o.outcome || 'AUTO').toUpperCase();
  const outcome: CustomSidebarOrderOutcome =
    outcomeRaw === 'YES' ? 'YES' : outcomeRaw === 'NO' ? 'NO' : 'AUTO';
  return {
    side,
    priceMode,
    priceValue,
    maxSell: side === 'SELL' ? !!o.maxSell : false,
    outcome,
  };
}

function customButtonTitle(btn: CustomSidebarButton, orderAmount: string): string {
  return btn.orders
    .map((o) => {
      const outLabel = o.outcome === 'AUTO' ? '↔' : o.outcome;
      return `${o.side} ${o.maxSell ? 'MAX' : orderAmount || '?'} ${outLabel} @ ${customOrderPriceLabel(o)}`;
    })
    .join(' + ');
}

function readCustomSidebarButtons(): CustomSidebarButton[] {
  try {
    const raw = localStorage.getItem(SIDEBAR_CUSTOM_BUTTONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((b) => {
        if (!b || typeof b !== 'object') return null;
        const label = String(b.label || '?').slice(0, 3);
        if (!label) return null;
        const base = {
        id: String(b.id || `${Date.now()}-${Math.random()}`),
          label,
          color: String(b.color || '#2563eb'),
        };
        if (Array.isArray(b.orders) && b.orders.length > 0) {
          const orders = (b.orders as unknown[])
            .map(normalizeCustomSidebarOrderSpec)
            .filter((o): o is CustomSidebarOrderSpec => o != null)
            .slice(0, 2);
          if (orders.length === 0) return null;
          return { ...base, orders };
        }
        if (b.side !== 'BUY' && b.side !== 'SELL') return null;
        const priceCents = Number(b.priceCents);
        if (!Number.isFinite(priceCents) || priceCents <= 0 || priceCents >= 100) return null;
        return {
          ...base,
          orders: [
            {
        side: b.side as 'BUY' | 'SELL',
              priceMode: 'FIXED' as const,
              priceValue: priceCents,
        maxSell: !!b.maxSell,
              outcome: 'AUTO' as const,
            },
          ],
        };
      })
      .filter((b): b is CustomSidebarButton => b != null);
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

export const Sidebar = memo(function Sidebar() {
  const { isConnected: walletConnected, address: walletAddress } = useAccount();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  // const setProgDialogOpen = useAppStore((s) => s.setProgDialogOpen);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setMarketViewDialogOpen = useAppStore((s) => s.setMarketViewDialogOpen);
  const positions = useAppStore((s) => s.positions);
  const makerAddressForMerge = useAppStore((s) => s.makerAddress);
  const orders = useAppStore((s) => s.orders);
  const trades = useAppStore((s) => s.trades);
  const marketLookupEpoch = useAppStore((s) => s.marketLookupEpoch);
  const weeklyHitMarkets = useAppStore((s) => s.weeklyHitMarkets);
  const marketLookup = useMemo(() => useAppStore.getState().marketLookup, [marketLookupEpoch]);
  const freqSliderPreviewLastMs = useRef(0);

  const [notifyPlaySound, setNotifyPlaySound] = useState(readNotifyPlaySound);
  const [notifyFlashBg, setNotifyFlashBg] = useState(readNotifyFlashBg);
  const [notifyHolderTiltPct, setNotifyHolderTiltPct] = useState(readNotifyHolderTiltPct);
  const [notifySmartTiltPct, setNotifySmartTiltPct] = useState(readNotifySmartTiltPct);
  const [notifyFavouriteTiltPct, setNotifyFavouriteTiltPct] = useState(readNotifyFavouriteTiltPct);
  const [notifyGreensTiltPct, setNotifyGreensTiltPct] = useState(readNotifyGreensTiltPct);
  const [notifyStakedMinUsd, setNotifyStakedMinUsd] = useState(readNotifyStakedMinUsd);
  const [notifyWhaleAmountUsd, setNotifyWhaleAmountUsd] = useState(readTiltWhaleAmountUsd);
  const [notifyWhaleRing, setNotifyWhaleRing] = useState(readNotifyWhaleRing);
  const [notifyWhaleRingMutable, setNotifyWhaleRingMutable] = useState(readNotifyWhaleRingMutable);
  const [notifyBellRing, setNotifyBellRing] = useState(readNotifyBellRing);
  const [notifyVolumeSpikeRing, setNotifyVolumeSpikeRing] = useState(readNotifyVolumeSpikeRingEnabled);
  const [chartOutcomeSync, setChartOutcomeSync] = useState(readChartOutcomeSync);
  const [notifyBellMinStakeUsd, setNotifyBellMinStakeUsd] = useState(readNotifyBellMinStakeUsd);
  const [notifyWhaleMaxPriceCents, setNotifyWhaleMaxPriceCents] = useState(readNotifyWhaleMaxPriceCents);
  const [notifyWhaleIgnoreNegativePnl, setNotifyWhaleIgnoreNegativePnl] = useState(readNotifyWhaleIgnoreNegativePnl);
  const [notifySoundFreqSlider, setNotifySoundFreqSlider] = useState(readNotifySoundFreqSlider);
  const [notifySoundVolumeSlider, setNotifySoundVolumeSlider] = useState(readNotifySoundVolumeSlider);
  const [notifyTradeSound, setNotifyTradeSound] = useState(readNotifyTradeSound);
  const [notifyTradeSoundFreqSlider, setNotifyTradeSoundFreqSlider] = useState(readTradeSoundFreqSlider);
  const [notifyTradeSoundVolumeSlider, setNotifyTradeSoundVolumeSlider] = useState(readTradeSoundVolumeSlider);
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
  const [notifyUpDownNextHi, setNotifyUpDownNextHi] = useState(readNotifyUpDownNextHi);
  const [notifyUpDownNextHiCents, setNotifyUpDownNextHiCents] = useState(readNotifyUpDownNextHiCents);
  const [notifyDialogOpen, setNotifyDialogOpen] = useState(false);
  const [notifyMaxVolatilityPct, setNotifyMaxVolatilityPct] = useState(readNotifyMaxVolatilityPct);
  const [notifyVolatilityCandles, setNotifyVolatilityCandles] = useState(readNotifyVolatilityCandles);
  const [notifyVolatilityCandlesDraft, setNotifyVolatilityCandlesDraft] = useState(() =>
    String(readNotifyVolatilityCandles()),
  );

  useEffect(() => {
    if (!notifyDialogOpen) return;
    setNotifyVolatilityCandlesDraft(String(notifyVolatilityCandles));
  }, [notifyDialogOpen, notifyVolatilityCandles]);

  const closeNotifyDialog = useCallback(() => {
    const raw = notifyVolatilityCandlesDraft.trim();
    let nextCandles = notifyVolatilityCandles;
    if (raw !== '') {
      const v = parseInt(raw, 10);
      if (Number.isFinite(v)) nextCandles = Math.min(500, Math.max(3, v));
    }
    setNotifyVolatilityCandles(nextCandles);
    setNotifyVolatilityCandlesDraft(String(nextCandles));
    setNotifyDialogOpen(false);
  }, [notifyVolatilityCandlesDraft, notifyVolatilityCandles]);

  const handleSidebarChartAnnualVolPct = useCallback((pct: number | null) => {
    setSidebarChartAnnualVolPct(pct);
  }, []);
  const sidebarRootRef = useRef<HTMLDivElement>(null);

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
      localStorage.setItem(SIDEBAR_NOTIFY_HOLDER_TILT_PCT_KEY, String(notifyHolderTiltPct));
    } catch {
      /* */
    }
  }, [notifyHolderTiltPct]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_SMART_TILT_PCT_KEY, String(notifySmartTiltPct));
    } catch {
      /* */
    }
  }, [notifySmartTiltPct]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_FAVOURITE_TILT_PCT_KEY, String(notifyFavouriteTiltPct));
    } catch {
      /* */
    }
  }, [notifyFavouriteTiltPct]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_GREENS_TILT_PCT_KEY, String(notifyGreensTiltPct));
    } catch {
      /* */
    }
  }, [notifyGreensTiltPct]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_STAKED_MIN_USD_KEY, String(notifyStakedMinUsd));
    } catch {
      /* */
    }
  }, [notifyStakedMinUsd]);
  useEffect(() => {
    persistTiltWhaleAmountUsd(notifyWhaleAmountUsd);
  }, [notifyWhaleAmountUsd]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_WHALE_RING_KEY, notifyWhaleRing ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [notifyWhaleRing]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_WHALE_RING_MUTABLE_KEY, notifyWhaleRingMutable ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [notifyWhaleRingMutable]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_BELL_RING_KEY, notifyBellRing ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [notifyBellRing]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_VOLUME_SPIKE_RING_KEY, notifyVolumeSpikeRing ? '1' : '0');
    } catch {
      /* */
    }
  }, [notifyVolumeSpikeRing]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_CHART_OUTCOME_SYNC_KEY, chartOutcomeSync ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [chartOutcomeSync]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_BELL_MIN_STAKE_USD_KEY, String(notifyBellMinStakeUsd));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event(NOTIFY_BELL_MIN_STAKE_CHANGED_EVENT));
  }, [notifyBellMinStakeUsd]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_WHALE_MAX_PRICE_CENTS_KEY, String(notifyWhaleMaxPriceCents));
    } catch {
      /* ignore */
    }
  }, [notifyWhaleMaxPriceCents]);
  useEffect(() => {
    try {
      localStorage.setItem(
        SIDEBAR_NOTIFY_WHALE_IGNORE_NEGATIVE_PNL_KEY,
        notifyWhaleIgnoreNegativePnl ? '1' : '0',
      );
    } catch {
      /* ignore */
    }
  }, [notifyWhaleIgnoreNegativePnl]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_SOUND_FREQ_KEY, String(notifySoundFreqSlider));
    } catch {
      /* */
    }
  }, [notifySoundFreqSlider]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_SOUND_VOLUME_KEY, String(notifySoundVolumeSlider));
    } catch {
      /* ignore */
    }
  }, [notifySoundVolumeSlider]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_TRADE_SOUND_KEY, notifyTradeSound ? '1' : '0');
    } catch {
      /* */
    }
  }, [notifyTradeSound]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_TRADE_SOUND_FREQ_KEY, String(notifyTradeSoundFreqSlider));
    } catch {
      /* */
    }
  }, [notifyTradeSoundFreqSlider]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_TRADE_SOUND_VOLUME_KEY, String(notifyTradeSoundVolumeSlider));
    } catch {
      /* */
    }
  }, [notifyTradeSoundVolumeSlider]);
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
  useEffect(() => {
    bumpNotifyTiltMarketFiltersRevision();
  }, [
    notifyTiltMktUpDown,
    notifyTiltMktHit,
    notifyTiltMktAbove,
    notifyTiltMktBetween,
    notifyTiltUd5m,
    notifyTiltUd15m,
    notifyTiltUd1h,
    notifyTiltUd4h,
  ]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_UPDOWN_NEXT_HI_KEY, notifyUpDownNextHi ? '1' : '0');
      localStorage.setItem(SIDEBAR_NOTIFY_UPDOWN_NEXT_HI_CENTS_KEY, String(notifyUpDownNextHiCents));
    } catch {
      /* */
    }
    publishUpDownNextHiSettings(notifyUpDownNextHi, notifyUpDownNextHiCents);
  }, [notifyUpDownNextHi, notifyUpDownNextHiCents]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_MAX_VOLATILITY_PCT_KEY, String(notifyMaxVolatilityPct));
    } catch {
      /* */
    }
  }, [notifyMaxVolatilityPct]);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_NOTIFY_VOLATILITY_CANDLES_KEY, String(notifyVolatilityCandles));
    } catch {
      /* */
    }
  }, [notifyVolatilityCandles]);

  /** Slider 0 → 0.25×, 50 → 1×, 100 → 4× (exponential). */
  const notifySoundPitchMul = useMemo(
    () => pitchMulFromNotifyFreqSlider(notifySoundFreqSlider),
    [notifySoundFreqSlider],
  );
  const notifyTradeSoundPitchMul = useMemo(
    () => pitchMulFromNotifyFreqSlider(notifyTradeSoundFreqSlider),
    [notifyTradeSoundFreqSlider],
  );

  const notifyTiltAppliesToSelectedMarket = useNotifyTiltAppliesToSelectedMarket();

  const toxicFlowMarketId = useMemo(
    () => ((selectedMarket?.conditionId ?? selectedMarket?.id) || '').trim(),
    [selectedMarket?.conditionId, selectedMarket?.id],
  );
  const mutedMarketsKey = useSyncExternalStore(
    subscribeMarketNotifyMuted,
    getMarketNotifyMutedSnapshot,
    () => '[]',
  );
  const isCurrentMarketMuted = useMemo(
    () => isMarketNotifyMuted(toxicFlowMarketId),
    [toxicFlowMarketId, mutedMarketsKey],
  );
  const progOrderMap = useAppStore((s) => s.progOrderMap) as Record<string, number>;

  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const orderOutcome = useAppStore((s) => s.sidebarOutcome);
  const setOrderOutcome = useAppStore((s) => s.setSidebarOutcome);
  const maxOrderSizeUsd = useAppStore((s) => s.maxOrderSizeUsd);
  const [orderPrice, setOrderPrice] = useState('');
  const [orderKind, setOrderKind] = useState<'limit' | 'market'>(() => readSidebarOrderKind());
  const [orderAmount, setOrderAmount] = useState(() => localStorage.getItem('polymarket-order-amount') || '');
  const [customButtons, setCustomButtons] = useState<CustomSidebarButton[]>(() => readCustomSidebarButtons());
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [customOrderDrafts, setCustomOrderDrafts] = useState<CustomOrderDraft[]>(() => [DEFAULT_CUSTOM_ORDER_DRAFT()]);
  const [customLabel, setCustomLabel] = useState('');
  const [customColor, setCustomColor] = useState('#2563eb');
  const [editingCustomButtonId, setEditingCustomButtonId] = useState<string | null>(null);
  const [draggingCustomId, setDraggingCustomId] = useState<string | null>(null);
  const [orderExpiry, setOrderExpiry] = useState(() => readOrderExpirySlot(false).value);
  const [orderExpiryUnit, setOrderExpiryUnit] = useState<'s' | 'm' | 'h'>(() => readOrderExpirySlot(false).unit);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingOrderPrice, setEditingOrderPrice] = useState('');
  const [cancellingOrderIds, setCancellingOrderIds] = useState<Set<string>>(new Set());
  const [cancellingAllOrders, setCancellingAllOrders] = useState(false);
  const [closingPositionTokens, setClosingPositionTokens] = useState<Set<string>>(new Set());
  const [limitSellingPositionTokens, setLimitSellingPositionTokens] = useState<Set<string>>(new Set());
  const [toxicSidebarExpanded, setToxicSidebarExpanded] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_TOXIC_EXPANDED_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [marketStakedLegs, setMarketStakedLegs] = useState<MarketStakedLegsResponse | null>(null);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_TOXIC_EXPANDED_KEY, toxicSidebarExpanded ? 'true' : 'false');
    } catch {
      /* ignore */
    }
  }, [toxicSidebarExpanded]);
  const closeToxicSidebarPanel = useCallback(() => {
    setToxicSidebarExpanded(false);
    resetSidebarToxicWalletExtraWidth();
  }, []);
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
  const sidebarStakedLiveRow = useThrottledBidAskMarketRow(selectedMarket?.clobTokenIds?.[0] ?? '');
  const sidebarStakedLegs = useMemo(() => {
    let live: MarketStakedLegsResponse | null = null;
    const row = sidebarStakedLiveRow;
    if (row) {
      const wy = row.stakedUsdYesLeg;
      const wn = row.stakedUsdNoLeg;
      const sumAbs = row.stakedSumAbsSignedNetUsd;
      if (typeof wy === 'number' && Number.isFinite(wy) && typeof wn === 'number' && Number.isFinite(wn)) {
        live = { stakedUsdYesLeg: wy, stakedUsdNoLeg: wn };
        if (typeof sumAbs === 'number' && Number.isFinite(sumAbs)) {
          live.stakedSumAbsSignedNetUsd = sumAbs;
        }
      }
    }
    return mergeMarketStakedLegsResponse(live, marketStakedLegs);
  }, [sidebarStakedLiveRow, marketStakedLegs]);
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

  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  /** On-chain WS + REST prefetch: must not depend on sidebarOpen or tables stay empty after refresh until sidebar opens. */
  const onchainHookTokenId = useMemo(() => {
    if (liveTradesSource !== 'onchain' || !selectedMarket?.clobTokenIds?.length) return null;
    return selectedMarket.clobTokenIds[orderOutcome === 'YES' ? 0 : 1] || null;
  }, [liveTradesSource, selectedMarket, orderOutcome]);
  const liveTradesSelectedTokenId = useMemo(() => {
    if (!selectedMarket?.clobTokenIds?.length) return null;
    return selectedMarket.clobTokenIds[orderOutcome === 'YES' ? 0 : 1] || null;
  }, [selectedMarket, orderOutcome]);
  const liveTradesOppositeTokenId = useMemo(() => {
    if (!selectedMarket?.clobTokenIds?.length) return null;
    return selectedMarket.clobTokenIds[orderOutcome === 'YES' ? 1 : 0] || null;
  }, [selectedMarket, orderOutcome]);

  const [proxyWallet, setProxyWallet] = useState<string | null>(null);
  const pkAddress = useAppStore((s) => s.pkAddress);
  const signingMode = useAppStore((s) => s.signingMode);
  const effectiveSidebarEoa = signingMode === 'privateKey' && pkAddress ? pkAddress : walletAddress;
  const effectiveSidebarConnected =
    signingMode === 'privateKey' && pkAddress ? true : walletConnected;
  useEffect(() => {
    if (!effectiveSidebarEoa) {
      setProxyWallet(null);
      return;
    }
    setProxyWallet(null);
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
  const selectedConditionId = useMemo(() => {
    if (liveTradesSource !== 'onchain' || !selectedMarket) return null;
    const m = (selectedMarket.conditionId ?? selectedMarket.id ?? '').trim();
    return m || null;
  }, [liveTradesSource, selectedMarket?.conditionId, selectedMarket?.id]);
  const refreshMyMarketTrades = useCallback(() => {
    const w = (walletForLivePositions || '').trim().toLowerCase();
    const m = selectedConditionId;
    if (w && m) refreshSidebarOnchainMarketTrades(w, m);
  }, [walletForLivePositions, selectedConditionId]);

  const getMyPositionsSnapshot = useCallback(
    () =>
      computeSidebarMyPositions(
        liveTradesSource,
        positions,
        selectedMarket,
        marketLookup,
        getSidebarOnchainTradesSnapshot().walletPositions,
      ),
    [liveTradesSource, positions, selectedMarket, marketLookup],
  );

  const [mergeDialogParams, setMergeDialogParams] = useState<SidebarMergeEligible | null>(null);
  const handleOpenMergeDialog = useCallback((eligible: SidebarMergeEligible) => {
    setMergeDialogParams(eligible);
    setMergeDialogOpen(true);
  }, []);

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
  const myOnchainWalletLower = (walletForLivePositions || '').toLowerCase();
  const yesTokenIdForSoundMute = selectedMarket?.clobTokenIds?.[0] || '';
  const noTokenIdForSoundMute = selectedMarket?.clobTokenIds?.[1] || '';

  const selectedMarketIsHit = useMemo(
    () => isMarketInWeeklyHitMarkets(selectedMarket?.id, weeklyHitMarkets),
    [selectedMarket?.id, weeklyHitMarkets],
  );

  // Up or Down market detection and state
  const isUpDownMarket = !!(selectedMarket?.question?.match(/up\s+or\s+down/i) || selectedMarket?.eventSlug?.match(/up-or-down|updown/i));

  useEffect(() => {
    const slot = readOrderExpirySlot(isUpDownMarket);
    setOrderExpiry(slot.value);
    setOrderExpiryUnit(slot.unit);
  }, [isUpDownMarket, selectedMarket?.id]);

  const [isMarketExpired, setIsMarketExpired] = useState(() => marketIsExpired(selectedMarket));

  useEffect(() => {
    const expired = marketIsExpired(selectedMarket);
    setIsMarketExpired((prev) => (prev === expired ? prev : expired));
    if (!selectedMarket?.endDate || expired) return;
    const endMs = new Date(selectedMarket.endDate).getTime();
    if (!Number.isFinite(endMs)) return;
    const flip = () => {
      setIsMarketExpired((prev) => {
        const next = marketIsExpired(selectedMarket);
        return prev === next ? prev : next;
      });
    };
    const remaining = endMs - Date.now();
    if (remaining <= 0) return;
    const timeout = window.setTimeout(flip, remaining);
    const iv = window.setInterval(flip, Math.min(1000, remaining));
    return () => {
      clearTimeout(timeout);
      clearInterval(iv);
    };
  }, [selectedMarket?.id, selectedMarket?.endDate, selectedMarket?.closed]);

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
  const sidebarChartKlineLabel = useMemo(
    () => sidebarChartIntervalFromContext(isUpDownMarket ? upDownIntervalContext : undefined),
    [isUpDownMarket, upDownIntervalContext],
  );
  const sidebarChartAsset = useMemo(() => {
    if (!selectedMarket) return null;
    const a = isUpDownMarket ? upDownAsset : extractAssetFromMarket(selectedMarket);
    return a || null;
  }, [selectedMarket, isUpDownMarket, upDownAsset]);
  useSidebarChartVolatility({
    asset: sidebarChartAsset,
    intervalContext: upDownIntervalContext,
    chainlinkCandles: !!(isUpDownMarket && upDownSpotUsesChainlink),
    volatilityLookbackCandles: notifyVolatilityCandles,
    recalcKey: selectedMarket?.id ?? '',
    onAnnualizedVolPct: handleSidebarChartAnnualVolPct,
  });
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

  const upDownTargetPrice = useSidebarUpDownTargetPrice();

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

  const setOrderPriceFromMath = useCallback((cents: string) => {
    setOrderPrice(cents);
  }, []);

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
      const px =
        side === 'BUY'
          ? parseFloat(String(asks[0]?.price ?? ''))
          : parseFloat(String(bids[bids.length - 1]?.price ?? ''));
      if (side === 'BUY') {
        if (maxOrderSizeUsd > 0 && (!Number.isFinite(px) || px <= 0)) {
          showToast('Cannot estimate order USD for max-size check (book price missing)', 'error');
          return;
        }
        const vusd = orderNotionalUsd(px, size);
        const capMsg = maxOrderUsdViolationMessage(maxOrderSizeUsd, vusd);
        if (capMsg) {
          showToast(capMsg, 'error');
          return;
        }
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
    [maxOrderSizeUsd],
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
    if (orderSide === 'BUY') {
      const limitSubmitVusd = orderNotionalUsd(price, size);
      const limitSubmitCap = maxOrderUsdViolationMessage(maxOrderSizeUsd, limitSubmitVusd);
      if (limitSubmitCap) {
        showToast(limitSubmitCap, 'error');
        return;
      }
    }
    const orderPriceCents = parseFloat(orderPrice);
    const { crosses: crossesBook, bestCounterpartyCents } = orderCrossesBookFromWsLookup(
      tokenId,
      orderSide,
      orderPriceCents,
    );
    if (crossesBook) {
      const confirmed = await requestCrossingConfirm(bestCounterpartyCents ?? 0);
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

  const submitQuickGridLimitOrder = async (side: 'BUY' | 'SELL', priceCents: number) => {
    if (!selectedMarket) return;
    if (orderKind === 'market') {
      showToast('Set order type to Limit to use quick price buttons', 'error');
      return;
    }
    if (isMarketExpired) {
      showToast('Market expired', 'error');
      return;
    }
    const tokenId = selectedMarket.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1];
    if (!tokenId) return;
    const size = parseFloat(orderAmount);
    if (!size || size <= 0) {
      showToast('Enter amount (shares)', 'error');
      return;
    }
    if (!Number.isFinite(priceCents) || priceCents < 1 || priceCents > 99) return;

    const price = priceCents / 100;
    if (side === 'BUY') {
      const limitSubmitVusd = orderNotionalUsd(price, size);
      const limitSubmitCap = maxOrderUsdViolationMessage(maxOrderSizeUsd, limitSubmitVusd);
      if (limitSubmitCap) {
        showToast(limitSubmitCap, 'error');
        return;
      }
    }
    const { crosses: crossesBook, bestCounterpartyCents } = orderCrossesBookFromWsLookup(
      tokenId,
      side,
      priceCents,
    );
    if (crossesBook) {
      const confirmed = await requestCrossingConfirm(bestCounterpartyCents ?? 0);
      if (!confirmed) return;
    }

    let expiration: number | undefined;
    if (side === 'SELL') {
      expiration = 0;
    } else {
      const exp = computeLimitExpiration(selectedMarket.endDate);
      expiration = exp.expiration;
      if (exp.invalidLead) {
        showToast('Lead time to expiration already passed for this market', 'error');
        return;
      }
    }

    const orderInfo = `${side} ${size} ${orderOutcome} for ${marketName} @ ${priceCents}¢`;
    try {
      const result = await placeOrder({
        tokenId,
        side,
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
    } catch {
      showToast('Order failed', 'error');
    }
  };

  const handleCreateCustomButton = () => {
    const label = customLabel.trim();
    if (!label) { showToast('Enter button label (1-3 chars)', 'error'); return; }
    if (label.length < 1 || label.length > 3) { showToast('Button label must be 1-3 characters', 'error'); return; }

    const orders: CustomSidebarOrderSpec[] = [];
    for (const draft of customOrderDrafts) {
      const priceValue = parseFloat(draft.price);
      if (!Number.isFinite(priceValue)) {
        showToast('Invalid price in one of the orders', 'error');
        return;
      }
      if (draft.priceMode === 'FIXED') {
        if (priceValue <= 0 || priceValue >= 100) {
          showToast('Fixed price must be between 0.1 and 99.9¢', 'error');
          return;
        }
      } else if (priceValue < 0) {
        showToast('BS offset cannot be negative', 'error');
        return;
      }
      orders.push({
        side: draft.side,
        priceMode: draft.priceMode,
        priceValue,
        maxSell: draft.side === 'SELL' ? draft.maxSell : false,
        outcome: draft.outcome,
      });
    }
    if (orders.length === 0) {
      showToast('Add at least one order', 'error');
      return;
    }

    const next: CustomSidebarButton = {
      id: editingCustomButtonId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label,
      color: customColor,
      orders,
    };
    if (editingCustomButtonId) {
      setCustomButtons((prev) => prev.map((b) => (b.id === editingCustomButtonId ? next : b)));
    } else {
      setCustomButtons((prev) => [...prev, next]);
    }
    setEditingCustomButtonId(null);
    setCustomDialogOpen(false);
  };

  const openCustomDialogForCreate = () => {
    setEditingCustomButtonId(null);
    setCustomOrderDrafts([DEFAULT_CUSTOM_ORDER_DRAFT()]);
    setCustomLabel('');
    setCustomColor('#2563eb');
    setCustomDialogOpen(true);
  };

  const updateCustomOrderDraft = (index: number, patch: Partial<CustomOrderDraft>) => {
    setCustomOrderDrafts((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const handleAddCustomOrderDraft = () => {
    setCustomOrderDrafts((prev) => (prev.length >= 2 ? prev : [...prev, DEFAULT_CUSTOM_ORDER_DRAFT()]));
  };

  const handleRemoveCustomOrderDraft = (index: number) => {
    setCustomOrderDrafts((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleRemoveCustomButton = (id: string) => {
    setCustomButtons((prev) => prev.filter((b) => b.id !== id));
  };

  const handleEditCustomButton = (btn: CustomSidebarButton) => {
    setEditingCustomButtonId(btn.id);
    setCustomOrderDrafts(
      btn.orders.map((o) => ({
        side: o.side,
        priceMode: o.priceMode,
        price: String(o.priceValue),
        maxSell: !!o.maxSell,
        outcome: o.outcome,
      })),
    );
    setCustomLabel(btn.label);
    setCustomColor(btn.color);
    setCustomDialogOpen(true);
  };

  const handleCustomButtonClick = async (btn: CustomSidebarButton) => {
    if (!selectedMarket) return;

    let placed = 0;
    for (const spec of btn.orders) {
      const resolvedOutcome: 'YES' | 'NO' = spec.outcome === 'AUTO' ? orderOutcome : spec.outcome;
      const priceCents = resolveBsAnchoredCustomOrderPriceCents(
        spec,
        getSidebarSpotStripBsSnapshot()?.yesMathCents,
        resolvedOutcome,
      );
      if (priceCents == null) {
        showToast(
          spec.priceMode === 'FIXED' ? 'Invalid custom order price' : 'Cannot resolve BS price (math prob unavailable)',
          'error',
        );
        return;
      }
      const tokenId = selectedMarket.clobTokenIds?.[resolvedOutcome === 'YES' ? 0 : 1];
      if (!tokenId) {
        showToast('Missing token for custom order', 'error');
        return;
      }

    let size = parseFloat(orderAmount);
      if (spec.side === 'SELL' && spec.maxSell) {
        const tidKey = positionTokenKey(tokenId);
        const pos = tidKey
          ? getMyPositionsSnapshot().find(
              (p) => positionTokenKey(String(p.asset || '')) === tidKey && (p.size || 0) > 0,
            )
          : undefined;
        size = pos ? Math.floor(Number(pos.size) * 100) / 100 : 0;
    }
    if (!size || size <= 0) {
        showToast(
          spec.side === 'SELL' && spec.maxSell ? 'No position size available for MAX sell' : 'Invalid amount',
          'error',
        );
      return;
    }

    let expiration = 0;
      if (spec.side === 'BUY') {
      const exp = computeLimitExpiration(selectedMarket.endDate);
      expiration = exp.expiration;
      if (exp.invalidLead) {
        showToast('Lead time to expiration already passed for this market', 'error');
        return;
      }
    }

      if (spec.side === 'BUY') {
        const customEarlyVusd = orderNotionalUsd(priceCents / 100, size);
        const customEarlyCap = maxOrderUsdViolationMessage(maxOrderSizeUsd, customEarlyVusd);
        if (customEarlyCap) {
          showToast(customEarlyCap, 'error');
          return;
        }
      }

      const { crosses: crossesBook, bestCounterpartyCents } = orderCrossesBookFromWsLookup(
        tokenId,
        spec.side,
        priceCents,
      );
    if (crossesBook) {
        const confirmed = await requestCrossingConfirm(bestCounterpartyCents ?? 0);
      if (!confirmed) return;
    }

    const result = await placeOrder({
      tokenId,
        side: spec.side,
        price: priceCents / 100,
      size,
      expiration,
        orderInfo: `${spec.side} ${size} ${resolvedOutcome} for ${marketName} @ ${priceCents}¢`,
    });
      if (!result.success) {
      showToast(result.error || 'Custom order failed', 'error');
        if (placed > 0) triggerWalletRefresh();
        return;
    }
      placed += 1;
    }

    showToast(placed > 1 ? `${placed} custom orders placed` : 'Custom order placed', 'success');
    triggerWalletRefresh();
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

  const handleCancelAllOrders = async () => {
    const ids = [...myOrders, ...progOrders].map((o) => o.id).filter(Boolean);
    if (ids.length === 0 || cancellingAllOrders) return;
    setCancellingAllOrders(true);
    setCancellingOrderIds((prev) => {
      const s = new Set(prev);
      for (const id of ids) s.add(id);
      return s;
    });
    try {
      const result = await cancelOrders(ids);
      if (result.success) {
        const n = result.cancelled ?? ids.length;
        showToast(n > 1 ? `${n} orders cancelled` : 'Order cancelled', 'success');
        triggerWalletRefresh();
      } else {
        showToast(result.error || 'Cancel all failed', 'error');
      }
    } catch {
      showToast('Cancel all failed', 'error');
    } finally {
      setCancellingAllOrders(false);
      setCancellingOrderIds((prev) => {
        const s = new Set(prev);
        for (const id of ids) s.delete(id);
        return s;
      });
    }
  };

  const handleReplaceOrder = async (orderId: string, newPriceCents: number, tokenId: string, side: 'BUY' | 'SELL', size: number) => {
    const newPrice = newPriceCents / 100;

    if (!newPrice || newPrice <= 0 || newPrice >= 1 || !size) { setEditingOrderId(null); return; }
    if (side === 'BUY') {
      const replaceVusd = orderNotionalUsd(newPrice, size);
      const replaceCap = maxOrderUsdViolationMessage(maxOrderSizeUsd, replaceVusd);
      if (replaceCap) {
        showToast(replaceCap, 'error');
        setEditingOrderId(null);
        return;
      }
    }
    const { crosses: crossesBook, bestCounterpartyCents } = orderCrossesBookFromWsLookup(
      tokenId,
      side,
      newPriceCents,
    );
    if (crossesBook) {
      const confirmed = await requestCrossingConfirm(bestCounterpartyCents ?? 0);
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
      const bestBid = getBidAskMarketRow(tid)?.bestBid;
      const hasBidsFromLookup = typeof bestBid === 'number' && Number.isFinite(bestBid) && bestBid > 0;
      const bids =
        sameBook && displayBids.length > 0
          ? displayBids
          : !sameBook && hasBidsFromLookup
            ? [{ price: String(bestBid), size: '1' }]
            : [];
      const bestAsk = getBidAskMarketRow(tid)?.bestAsk;
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
            if (liveTradesSource === 'onchain') refreshMyMarketTrades();
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
      refreshMyMarketTrades,
      submitSidebarMarketFak,
    ],
  );

  const handlePositionLimitSell = useCallback(
    async (tokenId: string, rawSize: number, priceCents: number) => {
      const tid = String(tokenId || '').trim();
      const size = Math.floor(rawSize * 100) / 100;
      if (!tid || !selectedMarket || !size || size <= 0) return;
      if (isMarketExpired) {
        showToast('Market expired', 'error');
        return;
      }
      if (!Number.isFinite(priceCents) || priceCents < 1 || priceCents > 99) return;

      const tidKey = positionTokenKey(tid);
      const existingSellIds = [...myOrders, ...progOrders]
        .filter(
          (o) =>
            (o.side || '').toUpperCase() === 'SELL' &&
            positionTokenKey(getOrderClobTokenId(o)) === tidKey,
        )
        .map((o) => o.id)
        .filter((id): id is string => Boolean(id));
      if (existingSellIds.length > 0) {
        const cancelResult =
          existingSellIds.length === 1
            ? await cancelOrder(existingSellIds[0]!)
            : await cancelOrders(existingSellIds);
        if (!cancelResult.success) {
          showToast(cancelResult.error || 'Cancel existing sell failed', 'error');
          return;
        }
      }

      const price = priceCents / 100;
      const { crosses: crossesBook, bestCounterpartyCents } = orderCrossesBookFromWsLookup(
        tid,
        'SELL',
        priceCents,
      );
      if (crossesBook) {
        const confirmed = await requestCrossingConfirm(bestCounterpartyCents ?? 0);
        if (!confirmed) return;
      }

      const outcome = getTokenOutcome(tid, marketLookup);
      const ol = isUpDownMarket ? (outcome === 'YES' ? 'UP' : 'DOWN') : outcome;

      setLimitSellingPositionTokens((prev) => new Set(prev).add(tid));
      try {
        const result = await placeOrder({
          tokenId: tid,
          side: 'SELL',
          price,
          size,
          expiration: 0,
          orderInfo: `SELL ${size} ${ol} for ${marketName} @ ${priceCents}¢ (position limit)`,
        });
        if (result.success) {
          showToast(existingSellIds.length > 0 ? 'Sell order replaced' : 'Order placed', 'success');
          triggerWalletRefresh();
        } else {
          showToast(result.error || 'Order failed', 'error');
        }
      } catch {
        showToast('Order failed', 'error');
      } finally {
        setLimitSellingPositionTokens((prev) => {
          const s = new Set(prev);
          s.delete(tid);
          return s;
        });
      }
    },
    [
      selectedMarket,
      isMarketExpired,
      marketLookup,
      isUpDownMarket,
      marketName,
      requestCrossingConfirm,
      myOrders,
      progOrders,
    ],
  );

  const fullMarketName = selectedMarket ? (selectedMarket.question || selectedMarket.groupItemTitle || '') : '';

  const sidebarAsset = selectedMarket ? extractAssetFromMarket(selectedMarket) : '';
  const assetColorMap: Record<string, string> = { BTC: 'text-orange-400', ETH: 'text-blue-400', SOL: 'text-purple-400', XRP: 'text-cyan-400' };
  const sidebarTitleColor = selectedMarket ? (assetColorMap[sidebarAsset] || 'text-gray-500') : 'text-white';
  const polymarketUrl = selectedMarket?.eventSlug ? polymarketSiteUrl(`event/${selectedMarket.eventSlug}`) : null;
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

  const canShowEmbeddedToxic =
    !isMobileSheet && !!selectedMarket && (selectedMarket.conditionId || '').trim().length > 0;
  const sidebarToxicEffective = toxicSidebarExpanded && canShowEmbeddedToxic;
  const toxicExpandHandleRef = useRef<HTMLButtonElement>(null);
  const [holdersExpandTipOpen, setHoldersExpandTipOpen] = useState(false);
  const onboardingBlockingUiOpen = useSyncExternalStore(
    subscribeOnboardingBlockingUi,
    isOnboardingBlockingUiOpen,
    () => false,
  );
  const dismissHoldersExpandTip = useCallback(() => {
    persistSidebarHoldersExpandTipDismissed();
    setHoldersExpandTipOpen(false);
  }, []);

  useEffect(() => {
    if (readSidebarHoldersExpandTipDismissed()) {
      setHoldersExpandTipOpen(false);
      return;
    }
    if (!isDesktopScreenViewport()) {
      setHoldersExpandTipOpen(false);
      return;
    }
    if (onboardingBlockingUiOpen) {
      setHoldersExpandTipOpen(false);
      return;
    }
    if (!sidebarOpen || !canShowEmbeddedToxic || sidebarToxicEffective) {
      setHoldersExpandTipOpen(false);
      return;
    }
    setHoldersExpandTipOpen(true);
  }, [
    sidebarOpen,
    canShowEmbeddedToxic,
    sidebarToxicEffective,
    selectedMarket?.conditionId,
    onboardingBlockingUiOpen,
  ]);

  useEffect(() => {
    if (sidebarToxicEffective && holdersExpandTipOpen) dismissHoldersExpandTip();
  }, [sidebarToxicEffective, holdersExpandTipOpen, dismissHoldersExpandTip]);

  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const [historyTipOpen, setHistoryTipOpen] = useState(false);
  const dismissHistoryTip = useCallback(() => {
    persistSidebarHistoryTipDismissed();
    setHistoryTipOpen(false);
  }, []);

  const notifyGearRef = useRef<HTMLButtonElement>(null);
  const [notifyGearTipOpen, setNotifyGearTipOpen] = useState(false);
  const dismissNotifyGearTip = useCallback(() => {
    persistSidebarNotifyGearTipDismissed();
    setNotifyGearTipOpen(false);
  }, []);

  useEffect(() => {
    if (readSidebarHistoryTipDismissed()) {
      setHistoryTipOpen(false);
      return;
    }
    if (!isDesktopScreenViewport()) {
      setHistoryTipOpen(false);
      return;
    }
    if (onboardingBlockingUiOpen || notifyDialogOpen) {
      setHistoryTipOpen(false);
      return;
    }
    if (!sidebarOpen || !selectedMarket) {
      setHistoryTipOpen(false);
      return;
    }
    if (holdersExpandTipOpen) {
      setHistoryTipOpen(false);
      return;
    }
    if (!readToxicFlowRowActionsTipDismissed()) {
      const holdersExpandDone = readSidebarHoldersExpandTipDismissed();
      if (!holdersExpandDone || sidebarToxicEffective) {
        setHistoryTipOpen(false);
        return;
      }
    }
    setHistoryTipOpen(true);
  }, [
    sidebarOpen,
    selectedMarket?.id,
    onboardingBlockingUiOpen,
    notifyDialogOpen,
    holdersExpandTipOpen,
    sidebarToxicEffective,
  ]);

  useEffect(() => {
    if (readSidebarNotifyGearTipDismissed()) {
      setNotifyGearTipOpen(false);
      return;
    }
    if (!readSidebarHistoryTipDismissed() || historyTipOpen) {
      setNotifyGearTipOpen(false);
      return;
    }
    if (!isDesktopScreenViewport()) {
      setNotifyGearTipOpen(false);
      return;
    }
    if (onboardingBlockingUiOpen || notifyDialogOpen) {
      setNotifyGearTipOpen(false);
      return;
    }
    if (!sidebarOpen || !selectedMarket) {
      setNotifyGearTipOpen(false);
      return;
    }
    if (holdersExpandTipOpen) {
      setNotifyGearTipOpen(false);
      return;
    }
    if (!readToxicFlowRowActionsTipDismissed()) {
      const holdersExpandDone = readSidebarHoldersExpandTipDismissed();
      if (!holdersExpandDone || sidebarToxicEffective) {
        setNotifyGearTipOpen(false);
        return;
      }
    }
    setNotifyGearTipOpen(true);
  }, [
    sidebarOpen,
    selectedMarket?.id,
    onboardingBlockingUiOpen,
    notifyDialogOpen,
    holdersExpandTipOpen,
    sidebarToxicEffective,
    historyTipOpen,
  ]);

  useEffect(() => {
    if (!sidebarToxicEffective) resetSidebarToxicWalletExtraWidth();
  }, [sidebarToxicEffective]);

  const expandSidebarToxicFlowPanel = useCallback(() => {
    if (!canShowEmbeddedToxic) return;
    preloadSidebarToxicFlowDialog();
    dismissHoldersExpandTip();
    setToxicSidebarExpanded(true);
  }, [canShowEmbeddedToxic, dismissHoldersExpandTip]);

  useEffect(() => {
    if (!canShowEmbeddedToxic || !toxicSidebarExpanded) return;
    preloadSidebarToxicFlowDialog();
  }, [canShowEmbeddedToxic, toxicSidebarExpanded, toxicFlowMarketId]);

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
      if (!mergeDialogParams?.conditionId || !mergeFunderWallet) {
        return { success: false, error: 'Missing condition id or proxy wallet' };
      }
      const res = await executeMergePositions({
        conditionId: mergeDialogParams.conditionId,
        amount,
        funderAddress: mergeFunderWallet,
      });
      if (res.success) {
        showToast('Merge confirmed', 'success');
        triggerWalletRefresh();
        if (liveTradesSource === 'onchain') {
          refreshSidebarOnchainWallet();
          refreshMyMarketTrades();
          for (const delayMs of [2000, 5000, 12000]) {
            window.setTimeout(() => {
              refreshSidebarOnchainWallet();
              refreshMyMarketTrades();
            }, delayMs);
          }
        }
      } else {
        showToast(res.error, 'error');
      }
      return res;
    },
    [mergeDialogParams?.conditionId, mergeFunderWallet, liveTradesSource, refreshMyMarketTrades],
  );

  return (
    <>
    {mergeDialogOpen && !!mergeDialogParams?.conditionId && (
      <Suspense fallback={null}>
        <MergePositionsDialogLazy
          open
      onClose={() => setMergeDialogOpen(false)}
      maxShares={mergeDialogParams.maxMerge}
      conditionId={mergeDialogParams.conditionId}
      title={fullMarketName || marketName}
      outcomePairLabel={isUpDownMarket ? 'UP / DOWN' : 'YES / NO'}
      onSubmit={handleMergeSubmit}
    />
      </Suspense>
    )}
    {notifyDialogOpen && typeof document !== 'undefined' &&
      createPortal(
        <div
          className="fixed inset-0 z-[60200] bg-black/70 flex items-center justify-center"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) closeNotifyDialog();
          }}
        >
          <div
            className="w-full max-w-md mx-4 rounded-lg border border-gray-600 bg-gray-800 p-4 max-h-[90vh] overflow-y-auto"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm font-bold text-white">Tilt notifications</div>
              <button
                type="button"
                className="p-1 rounded hover:bg-gray-700 text-gray-400"
                aria-label="Close"
                onClick={() => closeNotifyDialog()}
              >
                <X className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
            <div className="space-y-3 text-xs text-gray-200">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-400 shrink-0">Mute sounds above (c)</span>
                <NotifyDialogNumberInput
                  min={1}
                  max={99}
                  step={1}
                  integer
                  className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-16 tabular-nums no-spin"
                  value={notifySoundMaxPriceCents}
                  onChange={setNotifySoundMaxPriceCents}
                />
              </div>
              <p className="text-[10px] text-gray-500 m-0 leading-snug">
                Mute all notification sounds when YES or NO WS mid exceeds this — (bestBid+bestAsk)/2, or bestBid only if no ask.
              </p>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="rounded accent-amber-500"
                  checked={notifyPlaySound}
                  onChange={(e) => setNotifyPlaySound(e.target.checked)}
                />
                <span>Tilt Ring</span>
              </label>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded accent-amber-500"
                    checked={notifyBellRing}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setNotifyBellRing(on);
                      if (on) {
                        primeTiltAudioContextFromUserGesture();
                        void playTiltNotifySoundStrikes('green', notifySoundPitchMul * 1.12, notifyRingTimeS, 1);
                      }
                    }}
                  />
                  <span>Bell Ring</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded accent-amber-500"
                    checked={notifyVolumeSpikeRing}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setNotifyVolumeSpikeRing(on);
                      try {
                        localStorage.setItem(SIDEBAR_NOTIFY_VOLUME_SPIKE_RING_KEY, on ? '1' : '0');
                      } catch {
                        /* */
                      }
                      if (on) {
                        primeTiltAudioContextFromUserGesture();
                        void playChartVolumeSpikeRing();
                      }
                    }}
                  />
                  <span>Volume Spike Ring</span>
                </label>
                <label className="flex items-center gap-2 shrink-0">
                  <span className="text-gray-400 whitespace-nowrap">Min usd stake</span>
                  <NotifyDialogNumberInput
                    min={0}
                    step={50}
                    className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-28 tabular-nums no-spin"
                    value={notifyBellMinStakeUsd}
                    onChange={setNotifyBellMinStakeUsd}
                  />
                </label>
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded accent-amber-500"
                    checked={notifyWhaleRing}
                    onChange={(e) => setNotifyWhaleRing(e.target.checked)}
                  />
                  <span>Whale Ring</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded accent-amber-500"
                    checked={notifyWhaleRingMutable}
                    onChange={(e) => setNotifyWhaleRingMutable(e.target.checked)}
                  />
                  <span>Mutable</span>
                </label>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-2 shrink-0">
                  <span className="text-gray-400 whitespace-nowrap">Whale amount (USDC)</span>
                  <NotifyDialogNumberInput
                    min={0}
                    max={1e12}
                    step={500}
                    className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-28 tabular-nums no-spin"
                    value={notifyWhaleAmountUsd}
                    onChange={setNotifyWhaleAmountUsd}
                  />
                </label>
                <label className="flex items-center gap-2 shrink-0">
                  <span className="text-gray-400 whitespace-nowrap">Max Whale Price (¢)</span>
                  <NotifyDialogNumberInput
                    min={1}
                    max={99}
                    step={1}
                    integer
                    className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-16 tabular-nums no-spin"
                    value={notifyWhaleMaxPriceCents}
                    onChange={setNotifyWhaleMaxPriceCents}
                  />
                </label>
                <label className="flex items-center gap-2 shrink-0 cursor-pointer">
                  <input
                    type="checkbox"
                    className="rounded accent-amber-500"
                    checked={notifyWhaleIgnoreNegativePnl}
                    onChange={(e) => setNotifyWhaleIgnoreNegativePnl(e.target.checked)}
                  />
                  <span className="text-gray-400 whitespace-nowrap">Ignore negative pnl</span>
                </label>
              </div>
              <p className="text-[10px] text-gray-500 m-0 leading-snug">
                Wallets with |Staked Net| USD ≥ Whale amount are whales (same as Toxic Flow tab). Whale Ring fires only when at least one such wallet has avg entry on its heavier staked leg **below** Max Whale Price (ledger price_yes / price_no). Ignore negative pnl skips whales whose batched ledger lifetime PnL is &lt; 0.
              </p>
              <p className="text-[10px] text-gray-500 m-0 leading-snug">
                Whale Ring repeats while that condition holds (triple strike per repeat, ~{NOTIFY_MULTI_RING_GAP_MS}ms between strikes). Does not require Tilt Ring, market filters, minimum staked, volatility cap, or WS mid mute. Cohort tilt bursts still obey those gates plus Double Ring. Mutable off (default): per-market mute does not silence Whale Ring. Mutable on: market mute also silences whales.
              </p>
              <p className="text-[10px] text-gray-500 m-0 leading-snug">
                Bell Ring: one strike per flashing 🔔 row in Top Holders every 1.35s when |Staked Net| ≥ Min usd stake (default 100). Row flash ignores stake; sound does not. 0 = any stake.
              </p>
              <p className="text-[10px] text-gray-500 m-0 leading-snug">
                Volume Spike Ring: Price YES chart flashes and plays one beep when the current open bar volume is ≥5× the average of all prior bars.
              </p>
              <div className="flex items-start gap-3 flex-wrap mt-3">
                <label className="flex items-center gap-2 cursor-pointer shrink-0 self-center">
                  <input
                    type="checkbox"
                    className="rounded accent-amber-500"
                    checked={notifyTradeSound}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setNotifyTradeSound(on);
                      if (on) {
                        primeTiltAudioContextFromUserGesture();
                        void playTradeNotifySound('green', notifyTradeSoundPitchMul, notifyRingTimeS);
                      }
                    }}
                  />
                  <span>Trade Ring</span>
                </label>
                <div
                  className={`grid grid-cols-2 gap-x-4 gap-y-2 flex-1 min-w-0${
                    notifyTradeSound
                      ? ''
                      : ' opacity-35 blur-[2.5px] pointer-events-none select-none transition-opacity'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-gray-400 mb-1">Trade sound pitch</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={notifyTradeSoundFreqSlider}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          const nv = Math.min(100, Math.max(0, Math.round(v)));
                          setNotifyTradeSoundFreqSlider(nv);
                          const now = Date.now();
                          if (now - freqSliderPreviewLastMs.current < 160) return;
                          freqSliderPreviewLastMs.current = now;
                          void playTradeNotifySound('green', pitchMulFromNotifyFreqSlider(nv), notifyRingTimeS);
                        }}
                        className="flex-1 min-w-0 accent-amber-500 h-2"
                        aria-label="Trade sound pitch"
                      />
                      <span className="text-gray-300 tabular-nums w-8 text-right shrink-0">{notifyTradeSoundFreqSlider}</span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-gray-400 mb-1">Trade sound volume</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={notifyTradeSoundVolumeSlider}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          const nv = Math.min(100, Math.max(0, Math.round(v)));
                          setNotifyTradeSoundVolumeSlider(nv);
                          try {
                            localStorage.setItem(SIDEBAR_TRADE_SOUND_VOLUME_KEY, String(nv));
                          } catch {
                            /* */
                          }
                          const now = Date.now();
                          if (now - freqSliderPreviewLastMs.current < 160) return;
                          freqSliderPreviewLastMs.current = now;
                          void playTradeNotifySound('green', notifyTradeSoundPitchMul, notifyRingTimeS);
                        }}
                        className="flex-1 min-w-0 accent-amber-500 h-2"
                        aria-label="Trade sound volume"
                      />
                      <span className="text-gray-300 tabular-nums w-8 text-right shrink-0">{notifyTradeSoundVolumeSlider}</span>
                    </div>
                  </div>
                </div>
              </div>
              <div
                className={
                  notifyPlaySound || notifyWhaleRing || notifyBellRing || notifyVolumeSpikeRing
                    ? 'transition-opacity'
                    : 'opacity-35 blur-[2.5px] pointer-events-none select-none transition-opacity'
                }
              >
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
                  <div className="min-w-0">
                    <div className="text-gray-400 mb-1">Notification sound pitch</div>
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
                        aria-label="Notification sound pitch"
                      />
                      <span className="text-gray-300 tabular-nums w-8 text-right shrink-0">{notifySoundFreqSlider}</span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="text-gray-400 mb-1">Notification sound volume</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={notifySoundVolumeSlider}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (!Number.isFinite(v)) return;
                          const nv = Math.min(100, Math.max(0, Math.round(v)));
                          setNotifySoundVolumeSlider(nv);
                          const now = Date.now();
                          if (now - freqSliderPreviewLastMs.current < 160) return;
                          freqSliderPreviewLastMs.current = now;
                          void playTiltNotifySoundWithDoubleRing(
                            'green',
                            notifySoundPitchMul,
                            notifyRingTimeS,
                            notifyDoubleRing,
                          );
                        }}
                        className="flex-1 min-w-0 accent-amber-500 h-2"
                        aria-label="Notification sound volume"
                      />
                      <span className="text-gray-300 tabular-nums w-8 text-right shrink-0">{notifySoundVolumeSlider}</span>
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-gray-500 mt-1">Left = much lower, right = much higher (×0.25–×4 at ends; center = normal). 0 volume = mute.</p>
              </div>
              <div
                className={
                  notifyPlaySound
                    ? 'transition-opacity'
                    : 'opacity-35 blur-[2.5px] pointer-events-none select-none transition-opacity'
                }
              >
                <label className="flex items-center gap-2 cursor-pointer mt-3">
                  <input
                    type="checkbox"
                    className="rounded accent-amber-500"
                    checked={notifyDoubleRing}
                    onChange={(e) => setNotifyDoubleRing(e.target.checked)}
                  />
                  <span>Double ring</span>
                </label>
                <p className="text-[10px] text-gray-500 mt-1 m-0">Tilt bursts: play two strikes ~{NOTIFY_MULTI_RING_GAP_MS}ms apart.</p>
              </div>
              <div
                className={
                  notifyTradeSound || notifyPlaySound || notifyWhaleRing || notifyBellRing || notifyVolumeSpikeRing
                    ? 'transition-opacity'
                    : 'opacity-35 blur-[2.5px] pointer-events-none select-none transition-opacity'
                }
              >
                <div className="flex items-center gap-2 flex-wrap mt-3">
                  <span className="text-gray-400 shrink-0">Ring time (s)</span>
                  <NotifyDialogNumberInput
                    min={0.05}
                    max={5}
                    step={0.05}
                    precision={2}
                    className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-20 tabular-nums no-spin"
                    value={notifyRingTimeS}
                    onChange={setNotifyRingTimeS}
                  />
                </div>
                <p className="text-[10px] text-gray-500 mt-1 m-0">Glass ring decay length; default 5s (max 5).</p>
              </div>
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
                    <label className="flex items-center gap-1.5 cursor-pointer w-full mt-1">
                      <input
                        type="checkbox"
                        className="rounded accent-amber-500"
                        checked={notifyUpDownNextHi}
                        onChange={(e) => setNotifyUpDownNextHi(e.target.checked)}
                      />
                      <span>Next market hi</span>
                    </label>
                    {notifyUpDownNextHi ? (
                      <div className="flex items-center gap-2 pl-5 w-full">
                        <span className="text-[10px] text-gray-400 shrink-0">≥</span>
                        <NotifyDialogNumberInput
                          min={1}
                          max={99}
                          step={1}
                          integer
                          className="bg-gray-900 border border-gray-600 rounded px-2 py-0.5 text-white w-14 tabular-nums text-xs no-spin"
                          value={notifyUpDownNextHiCents}
                          onChange={setNotifyUpDownNextHiCents}
                        />
                        <span className="text-[10px] text-gray-400">¢ flash + sound</span>
                      </div>
                    ) : null}
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
                  checked={notifyFlashBg}
                  onChange={(e) => setNotifyFlashBg(e.target.checked)}
                />
                <span>Flash Background</span>
              </label>
              <div className="border border-gray-600/80 rounded-md p-2 space-y-3 bg-gray-900/40">
                <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Toxic cohort tilts</div>
                <p className="text-[10px] text-gray-500 m-0 leading-snug">
                  Set how far each group must tilt before alarm rings. Rings only if all active groups agree on direction. Use 0 to ignore a group.
                </p>
                  <div className="space-y-2">
                    <div className="rounded border border-gray-700/55 p-2 space-y-1.5 bg-gray-950/25">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[11px] font-medium text-gray-300 shrink-0">Holder Tilt (%)</span>
                        <NotifyDialogNumberInput
                          min={0}
                          max={99}
                          step={1}
                          integer
                          className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-[4.75rem] tabular-nums text-xs no-spin"
                          value={notifyHolderTiltPct}
                          onChange={setNotifyHolderTiltPct}
                        />
                      </div>
                      <p className="text-[10px] text-gray-500 m-0 leading-snug">
                        Biggest position wallets. Default 30. Set 0 to ignore.
                      </p>
                    </div>
                    <div className="rounded border border-gray-700/55 p-2 space-y-1.5 bg-gray-950/25">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[11px] font-medium text-gray-300 shrink-0">Smart Tilt (%)</span>
                        <NotifyDialogNumberInput
                          min={0}
                          max={99}
                          step={1}
                          integer
                          className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-[4.75rem] tabular-nums text-xs no-spin"
                          value={notifySmartTiltPct}
                          onChange={setNotifySmartTiltPct}
                        />
                      </div>
                      <p className="text-[10px] text-gray-500 m-0 leading-snug">
                        Wallets with good win record. Default 30. Set 0 to ignore.
                      </p>
                    </div>
                    <div className="rounded border border-gray-700/55 p-2 space-y-1.5 bg-gray-950/25">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[11px] font-medium text-gray-300 shrink-0">Favourite Tilt (%)</span>
                        <NotifyDialogNumberInput
                          min={0}
                          max={99}
                          step={1}
                          integer
                          className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-[4.75rem] tabular-nums text-xs no-spin"
                          value={notifyFavouriteTiltPct}
                          onChange={setNotifyFavouriteTiltPct}
                        />
                      </div>
                      <p className="text-[10px] text-gray-500 m-0 leading-snug">
                        Your favorite wallets here. Default 0. Set 0 to ignore.
                      </p>
                    </div>
                    <div className="rounded border border-gray-700/55 p-2 space-y-1.5 bg-gray-950/25">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="text-[11px] font-medium text-gray-300 shrink-0">Greens Tilt (%)</span>
                        <NotifyDialogNumberInput
                          min={0}
                          max={99}
                          step={1}
                          integer
                          className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-[4.75rem] tabular-nums text-xs no-spin"
                          value={notifyGreensTiltPct}
                          onChange={setNotifyGreensTiltPct}
                        />
                      </div>
                      <p className="text-[10px] text-gray-500 m-0 leading-snug">
                        Wallets with profits in tracked period. Green = YES lean. Default 30. Set 0 to ignore.
                      </p>
                    </div>
                  </div>
              </div>
              <div className="border border-gray-600/80 rounded-md p-2 space-y-3 bg-gray-900/40 mt-2">
                <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold">Chart volatility</div>
                <div className="flex items-center gap-2 flex-wrap justify-between">
                  <span className="text-gray-400 shrink-0 text-[11px]">Max volatility (%)</span>
                  <NotifyDialogNumberInput
                    min={0}
                    max={500}
                    step={1}
                    integer
                    className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-[4.75rem] tabular-nums text-xs no-spin"
                    value={notifyMaxVolatilityPct}
                    onChange={setNotifyMaxVolatilityPct}
                  />
                </div>
                <p className="text-[10px] text-gray-500 m-0 leading-snug">
                  Tilt flash/sound pause while sidebar chart σ (annualized) is above this. 0 = no cap. Raise if alerts rarely fire.
                </p>
                <div className="flex items-center gap-2 flex-wrap justify-between">
                  <span className="text-gray-400 shrink-0 text-[11px]">Volatility candles</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    spellCheck={false}
                    className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-[4.75rem] tabular-nums text-xs"
                    value={notifyVolatilityCandlesDraft}
                    onChange={(e) => {
                      setNotifyVolatilityCandlesDraft(e.target.value.replace(/\D/g, ''));
                    }}
                    onBlur={() => {
                      const raw = notifyVolatilityCandlesDraft.trim();
                      if (raw === '') {
                        setNotifyVolatilityCandlesDraft(String(notifyVolatilityCandles));
                        return;
                      }
                      const v = parseInt(raw, 10);
                      const c = Math.min(
                        500,
                        Math.max(3, Number.isFinite(v) ? v : notifyVolatilityCandles),
                      );
                      setNotifyVolatilityCandles(c);
                      setNotifyVolatilityCandlesDraft(String(c));
                    }}
                  />
                </div>
                <p className="text-[10px] text-gray-500 m-0 leading-snug">
                  Completed candles used for σ (in-progress bar excluded). Interval follows the market (5m → 5m candles, 15m → 15m, etc.).
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-400 shrink-0">Staked min (USDC)</span>
                <NotifyDialogNumberInput
                  min={0}
                  max={1e12}
                  step={100}
                  className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-28 tabular-nums no-spin"
                  value={notifyStakedMinUsd}
                  onChange={setNotifyStakedMinUsd}
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
                onClick={() => closeNotifyDialog()}
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
      ref={sidebarRootRef}
      className={`right-sidebar ${sidebarOpen ? 'open' : ''} ${mobileDragging ? 'mobile-dragging' : ''}${canShowEmbeddedToxic && !sidebarToxicEffective ? ' sidebar-toxic-collapsed' : ''}${sidebarToxicEffective ? ' sidebar-toxic-expanded' : ''}`}
      style={
        {
          ['--mobile-sheet-offset' as string]: `${mobileDragOffset}px`,
        } as React.CSSProperties
      }
    >
      <SidebarToxicWalletWidthHost rootRef={sidebarRootRef} />
      <SidebarToxicNotifySoundHost
        notifyPlaySound={notifyPlaySound}
        notifyWhaleRing={notifyWhaleRing}
        notifyWhaleRingMutable={notifyWhaleRingMutable}
        notifySoundPitchMul={notifySoundPitchMul}
        notifyRingTimeS={notifyRingTimeS}
        notifySoundMaxPriceCents={notifySoundMaxPriceCents}
        notifyDoubleRing={notifyDoubleRing}
        notifyMaxVolatilityPct={notifyMaxVolatilityPct}
        isMarketExpired={isMarketExpired}
      />
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
      <div
        className={
          isMobileSheet
            ? 'flex-1 min-h-0 overflow-y-auto'
            : 'flex flex-1 min-h-0 min-w-0 flex-row overflow-hidden'
        }
      >
        <div
          className={
            isMobileSheet
              ? 'min-h-0 min-w-0'
              : canShowEmbeddedToxic
                ? 'w-72 shrink-0 min-h-0 overflow-y-auto min-w-0'
                : 'min-h-0 min-w-0 flex-1 overflow-y-auto'
          }
        >
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
            <SidebarUpDownEndPicker titleColor={sidebarTitleColor} />
            <button
              ref={historyButtonRef}
              type="button"
              onClick={() => {
                dismissHistoryTip();
                setMarketViewDialogOpen(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="shrink-0 rounded-sm border border-gray-600 bg-gray-900/60 p-0.5 w-[18px] min-w-[18px] flex items-center justify-center text-amber-300 hover:bg-gray-700/80 transition-colors"
              title="Market view — browse markets, traders, and trades"
              aria-label="Market view"
            >
              <History className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
            </button>
            <button
              ref={notifyGearRef}
              type="button"
              onClick={() => {
                dismissNotifyGearTip();
                setNotifyDialogOpen(true);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="shrink-0 rounded-sm border border-gray-600 bg-gray-900/60 p-0.5 w-[18px] min-w-[18px] flex items-center justify-center text-amber-300 hover:bg-gray-700/80 transition-colors"
              title="Tilt notification settings"
              aria-label="Tilt notification settings"
            >
              <Settings className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => {
                if (toxicFlowMarketId) toggleMarketNotifyMuted(toxicFlowMarketId);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              disabled={!toxicFlowMarketId}
              className={`shrink-0 rounded-sm border border-gray-600 bg-gray-900/60 p-0.5 w-[18px] min-w-[18px] flex items-center justify-center hover:bg-gray-700/80 transition-colors disabled:opacity-40 disabled:pointer-events-none ${
                isCurrentMarketMuted ? 'text-gray-500' : 'text-amber-300'
              }`}
              title={
                isCurrentMarketMuted
                  ? 'Unmute notifications for this market'
                  : 'Mute notifications for this market'
              }
              aria-label={
                isCurrentMarketMuted
                  ? 'Unmute notifications for this market'
                  : 'Mute notifications for this market'
              }
              aria-pressed={isCurrentMarketMuted}
            >
              {isCurrentMarketMuted ? (
                <BellOff className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
              ) : (
                <Bell className="h-3 w-3 shrink-0" strokeWidth={2} aria-hidden />
              )}
            </button>
          </div>
          <div className="text-[10px] text-gray-200 leading-tight mt-0.5 break-words w-full">
            {fullMarketName}
          </div>
          <SidebarHistoryTip
            anchorRef={historyButtonRef}
            open={historyTipOpen}
            onDismiss={dismissHistoryTip}
          />
          <SidebarNotifyGearTip
            anchorRef={notifyGearRef}
            open={notifyGearTipOpen}
            onDismiss={dismissNotifyGearTip}
          />
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
          <SidebarOnchainTradesHost
            marketId={selectedConditionId}
            tokenId={liveTradesSource === 'onchain' ? onchainHookTokenId : null}
            wallet={walletForLivePositions}
            scopedClobTokenIds={scopedClobPair}
          />
          <SidebarUpDownTargetHost />
          <SidebarOrderHighlightHost />
          <SidebarOnchainGridPositionsSync liveTradesSource={liveTradesSource} />
          {toxicFlowMarketId ? <SidebarToxicFlowHost marketId={toxicFlowMarketId} /> : null}
          <SidebarNotifyStakedGateSync
            yesTokenId={selectedMarket.clobTokenIds?.[0] ?? ''}
            marketConditionId={toxicFlowMarketId}
            notifyStakedMinUsd={notifyStakedMinUsd}
          />
          <SidebarChartsRow
            selectedMarket={selectedMarket}
            orderOutcome={orderOutcome}
            onOrderOutcomeChange={setOrderOutcome}
            chartOutcomeSync={chartOutcomeSync}
            onChartOutcomeSyncChange={setChartOutcomeSync}
            marketLookup={marketLookup}
          />


          <SidebarSpotStripSection
            selectedMarket={selectedMarket}
            marketLookup={marketLookup}
            orderOutcome={orderOutcome}
            isUpDownMarket={isUpDownMarket}
            selectedMarketIsHit={selectedMarketIsHit}
            upDownSpotUsesChainlink={upDownSpotUsesChainlink}
            sidebarChartKlineLabel={sidebarChartKlineLabel}
            notifyMaxVolatilityPct={notifyMaxVolatilityPct}
            notifyVolatilityCandles={notifyVolatilityCandles}
            sidebarBookRef={sidebarBookRef}
            onPickPrice={setOrderPriceFromMath}
            onSwitchLiveMarket={setSelectedMarket}
          />

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
          <SidebarToxicStatsFlashWrap
            notifyFlashBg={notifyFlashBg}
            notifyMaxVolatilityPct={notifyMaxVolatilityPct}
          >
              <div className="grid w-full grid-cols-4 gap-1.5 text-[10px] min-w-0 items-stretch">
              <SidebarMarketStatsCells
                yesTokenId={selectedMarket?.clobTokenIds?.[0] ?? ''}
                canShowEmbeddedToxic={canShowEmbeddedToxic}
                onExpandToxic={expandSidebarToxicFlowPanel}
              />
                </div>
            <div className="mt-1 w-full min-w-0">
              <SidebarToxicStrips
                toxicFlowMarketId={toxicFlowMarketId}
                notifyTiltAppliesToSelectedMarket={notifyTiltAppliesToSelectedMarket}
                notifyWhaleAmountUsd={notifyWhaleAmountUsd}
                notifyWhaleMaxPriceCents={notifyWhaleMaxPriceCents}
                notifyWhaleIgnoreNegativePnl={notifyWhaleIgnoreNegativePnl}
                notifyHolderTiltPct={notifyHolderTiltPct}
                notifySmartTiltPct={notifySmartTiltPct}
                notifyFavouriteTiltPct={notifyFavouriteTiltPct}
                notifyGreensTiltPct={notifyGreensTiltPct}
              />
              </div>
          </SidebarToxicStatsFlashWrap>
          </div>

          {/* Live Orderbook + Trades */}
          <SidebarPolymarketOBHost
            obTokenId={obTokenId}
            sidebarBookRef={sidebarBookRef}
            orderbookSectionHeight={orderbookSectionHeight}
            liveOrderbookExpanded={liveOrderbookExpanded}
            onToggleLiveOrderbookExpanded={toggleLiveOrderbookExpanded}
            isMarketExpired={isMarketExpired}
            isUpDownMarket={isUpDownMarket}
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
            liveTradesSource={liveTradesSource}
            myOnchainWalletLower={myOnchainWalletLower}
            selectedTokenId={liveTradesSelectedTokenId}
            oppositeTokenId={liveTradesOppositeTokenId}
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
                <div className="mt-1 grid grid-cols-5 gap-[2px]">
                  <SidebarOrderBsMathButton orderKind={orderKind} onPickPrice={setOrderPriceFromMath} />
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
                <div className="mt-1 min-h-6">
                  {orderKind === 'limit' ? (
                    <div className="grid grid-cols-5 gap-[2px]">
                      {[10, 25, 50, 100, 500].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setOrderAmount(String(n))}
                          className="bg-gray-700 hover:bg-gray-600 rounded text-[9px] text-gray-200 h-6 font-medium tabular-nums"
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  ) : orderSide === 'BUY' ? (
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
                          type="button"
                          onClick={() => setOrderAmountDollar(d.value)}
                          className={`bg-gray-700 hover:bg-gray-600 rounded text-[9px] h-full ${d.value === 1 ? 'text-yellow-400' : 'text-green-400'}`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const tid = selectedMarket?.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1] || '';
                        const tidKey = positionTokenKey(tid);
                        const pos = tidKey
                          ? getMyPositionsSnapshot().find(
                              (p) =>
                                positionTokenKey(String(p.asset || '')) === tidKey && (p.size || 0) > 0,
                            )
                          : undefined;
                        if (pos) setOrderAmount(String(Math.floor(Number(pos.size) * 100) / 100));
                      }}
                      className="bg-red-700 hover:bg-red-600 rounded text-[10px] text-white font-bold h-full w-full leading-none flex items-center justify-center min-h-6"
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
              <SidebarOrderCostDisplay
                sidebarBookRef={sidebarBookRef}
                orderKind={orderKind}
                orderSide={orderSide}
                orderPrice={orderPrice}
                orderAmount={orderAmount}
              />
                </div>

            <div className="mb-2 flex flex-col gap-0.5">
              <div
                className="grid w-full min-w-0 gap-px"
                style={{ gridTemplateColumns: `repeat(${SIDEBAR_QUICK_LIMIT_GRID_CENTS.length}, minmax(0, 1fr))` }}
              >
                {SIDEBAR_QUICK_LIMIT_GRID_CENTS.map((c, i) => (
                  <button
                    key={`quick-buy-${c}`}
                    type="button"
                    title={`Limit BUY @ ${c}¢ (amount field)`}
                    disabled={!effectiveSidebarConnected || !selectedMarket || orderKind === 'market' || isMarketExpired}
                    onClick={() => void submitQuickGridLimitOrder('BUY', c)}
                    style={{
                      backgroundColor: sidebarQuickBuyBg(i, SIDEBAR_QUICK_LIMIT_GRID_CENTS.length),
                      WebkitTextStroke: '1px #000',
                      paintOrder: 'stroke fill',
                    }}
                    className="min-h-0 h-[15px] min-w-0 rounded text-[12px] font-bold text-white tabular-nums leading-none p-0 m-0 hover:brightness-110 active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {c}
                  </button>
                ))}
              </div>
              <div
                className="grid w-full min-w-0 gap-px"
                style={{ gridTemplateColumns: `repeat(${SIDEBAR_QUICK_LIMIT_GRID_CENTS.length}, minmax(0, 1fr))` }}
              >
                {SIDEBAR_QUICK_LIMIT_GRID_CENTS.map((c, i) => (
                  <button
                    key={`quick-sell-${c}`}
                    type="button"
                    title={`Limit SELL @ ${c}¢ (amount field)`}
                    disabled={!effectiveSidebarConnected || !selectedMarket || orderKind === 'market' || isMarketExpired}
                    onClick={() => void submitQuickGridLimitOrder('SELL', c)}
                    style={{
                      backgroundColor: sidebarQuickSellBg(i, SIDEBAR_QUICK_LIMIT_GRID_CENTS.length),
                      WebkitTextStroke: '1px #000',
                      paintOrder: 'stroke fill',
                    }}
                    className="min-h-0 h-[15px] min-w-0 rounded text-[12px] font-bold text-white tabular-nums leading-none p-0 m-0 hover:brightness-110 active:brightness-95 disabled:opacity-40 disabled:pointer-events-none"
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>

            {/* Submit Button + BOT */}
            {!effectiveSidebarConnected ? (
              signingMode === 'privateKey' ? (
                <div className="w-full py-2 text-center text-xs text-gray-400">Import PK in header</div>
              ) : (
              <button
                  type="button"
                onClick={() => appKit.open()}
                className="w-full py-2 rounded-lg font-bold text-sm transition bg-blue-600 hover:bg-blue-700"
              >
                Connect Wallet
              </button>
              )
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
                        title={customButtonTitle(btn, orderAmount)}
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
                      onClick={openCustomDialogForCreate}
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
                        title={customButtonTitle(btn, orderAmount)}
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
                      onClick={openCustomDialogForCreate}
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
            <SidebarMyPositionsPanel
              selectedMarket={selectedMarket}
              marketLookup={marketLookup}
              liveTradesSource={liveTradesSource}
              positions={positions}
              isUpDownMarket={isUpDownMarket}
              isMarketExpired={isMarketExpired}
              mergeFunderWallet={mergeFunderWallet}
              closingPositionTokens={closingPositionTokens}
              limitSellingPositionTokens={limitSellingPositionTokens}
              onSetOrderAmount={setOrderAmount}
              onClosePosition={handleClosePosition}
              onLimitSellAtPrice={handlePositionLimitSell}
              onOpenMergeDialog={handleOpenMergeDialog}
              walletForLivePositions={walletForLivePositions}
              onRefreshMyMarketTrades={refreshMyMarketTrades}
              preloadMergePositionsDialog={preloadMergePositionsDialog}
            />
            <div className="my-3 border-t border-gray-700/70" />
            <div className="flex items-center justify-between gap-2 mb-2 mt-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="text-xs text-gray-400">My Orders</span>
                <SidebarDataSourceBadge source="polymarket" />
              </div>
              {(myOrders.length > 0 || progOrders.length > 0) && (
                  <button
                    type="button"
                  onClick={() => !cancellingAllOrders && handleCancelAllOrders()}
                  disabled={cancellingAllOrders}
                  className="w-4 h-4 rounded-sm flex items-center justify-center flex-shrink-0 bg-red-600 hover:bg-red-500 disabled:bg-red-600/50"
                  title="Cancel all orders"
                  aria-label="Cancel all orders"
                >
                  {cancellingAllOrders ? (
                    <span className="cancel-spinner" />
                  ) : (
                    <span className="text-black text-[10px] font-bold leading-none">✕</span>
                  )}
                          </button>
                        )}
                      </div>
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
                          {([-20, -15, -10, -5] as const).map((delta) => {
                            const newP = parseFloat((price * 100 + delta).toFixed(1));
                            if (newP < 0.1 || newP > 99.9) return null;
                            const mag = Math.abs(delta);
                            const deltaClass =
                              mag >= 20
                                ? 'bg-red-950/90 text-red-100 hover:bg-red-900'
                                : mag >= 15
                                    ? 'bg-red-950/85 text-red-200 hover:bg-red-900'
                                  : mag >= 10
                                      ? 'bg-red-900/80 text-red-200 hover:bg-red-800'
                                    : 'bg-red-900/65 text-red-200 hover:bg-red-800/80';
                            return (
                              <button
                                key={delta}
                                onClick={() => {
                                  handleReplaceOrder(order.id, newP, order.asset_id || order.token_id || '', order.side as 'BUY' | 'SELL', remainingSize);
                                }}
                                className={`text-[9px] px-1 py-0 rounded ${deltaClass}`}
                              >
                                {delta}¢
                              </button>
                            );
                          })}
                          {(() => {
                            return (
                              <SidebarOrderReplaceBsButton
                                outcome={outcome}
                                onReplace={(orderBsCents) =>
                                  handleReplaceOrder(
                                    order.id,
                                    orderBsCents,
                                    order.asset_id || order.token_id || '',
                                    order.side as 'BUY' | 'SELL',
                                    remainingSize,
                                  )
                                }
                              />
                            );
                          })()}
                          {([5, 10, 15, 20] as const).map((delta) => {
                            const newP = parseFloat((price * 100 + delta).toFixed(1));
                            if (newP < 0.1 || newP > 99.9) return null;
                            const mag = Math.abs(delta);
                            const deltaClass =
                              mag >= 20
                                ? 'bg-green-950/55 text-green-200 hover:bg-green-900/70'
                                : mag >= 15
                                  ? 'bg-green-900/40 text-green-200 hover:bg-green-800/55'
                                  : mag >= 10
                                    ? 'bg-green-900/50 text-green-200 hover:bg-green-800/65'
                                    : 'bg-green-900/65 text-green-200 hover:bg-green-800/80';
                            return (
                              <button
                                key={delta}
                                onClick={() => {
                                  handleReplaceOrder(order.id, newP, order.asset_id || order.token_id || '', order.side as 'BUY' | 'SELL', remainingSize);
                                }}
                                className={`text-[9px] px-1 py-0 rounded ${deltaClass}`}
                              >
                                +{delta}¢
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


          <SidebarMyTradesSection
            selectedMarket={selectedMarket}
            marketLookup={marketLookup}
            liveTradesSource={liveTradesSource}
            isUpDownMarket={isUpDownMarket}
            walletForLivePositions={walletForLivePositions}
            yesTokenIdForSoundMute={yesTokenIdForSoundMute}
            noTokenIdForSoundMute={noTokenIdForSoundMute}
          />
        </>
      )}
            </div>
        {!isMobileSheet && selectedMarket ? (
          <>
          <div className="hidden md:block w-6 shrink-0" aria-hidden />
          <button
            ref={toxicExpandHandleRef}
            type="button"
            className={`sidebar-toxic-expand-handle relative hidden md:flex shrink-0 w-6 flex-col justify-center items-center border-l border-gray-700/55 bg-gray-800/95 text-gray-500 hover:text-gray-400 ${sidebarToxicEffective ? '' : holdersExpandTipOpen ? 'sidebar-expand-handle-tip-flash' : 'sidebar-expand-handle-idle-flash'}`}
            title={sidebarToxicEffective ? 'Collapse holders panel' : 'Expand holders panel in sidebar'}
            aria-expanded={toxicSidebarExpanded}
            aria-label={sidebarToxicEffective ? 'Collapse holders panel' : 'Expand holders panel'}
            onClick={() => {
              dismissHoldersExpandTip();
              setToxicSidebarExpanded((v) => {
                if (!v) preloadSidebarToxicFlowDialog();
                return !v;
              });
            }}
            onMouseEnter={preloadSidebarToxicFlowDialog}
            onFocus={preloadSidebarToxicFlowDialog}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {sidebarToxicEffective ? (
              <ChevronLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
            ) : (
              <ChevronRight className="h-4 w-4" strokeWidth={2} aria-hidden />
            )}
          </button>
          <SidebarHoldersExpandTip
            anchorRef={toxicExpandHandleRef}
            open={holdersExpandTipOpen}
            onDismiss={dismissHoldersExpandTip}
          />
          </>
        ) : null}
        {sidebarToxicEffective && selectedMarket ? (
          <SidebarToxicPanel
            marketId={selectedMarket.conditionId || ''}
            marketName={marketName}
            yesTokenId={selectedMarket.clobTokenIds?.[0] || ''}
            noTokenId={selectedMarket.clobTokenIds?.[1] || ''}
            marketExpired={isMarketExpired}
            onClose={closeToxicSidebarPanel}
          />
        ) : null}
      </div>
      {customDialogOpen && typeof document !== 'undefined' && createPortal((
        <div className="fixed inset-0 z-[60000] bg-black/70 flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) setCustomDialogOpen(false); }}>
          <div className="w-full max-w-md mx-4 rounded-lg border border-gray-600 bg-gray-800 p-4 max-h-[90vh] overflow-y-auto">
            <div className="text-sm font-bold text-white mb-3">{editingCustomButtonId ? 'Edit Custom Button' : 'Create Custom Button'}</div>
            <div className="space-y-3 text-xs">
              {customOrderDrafts.map((draft, index) => (
                <div key={index} className="rounded border border-gray-600/80 bg-gray-900/50 p-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-gray-300 font-semibold">Order {index + 1}</span>
                    {customOrderDrafts.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => handleRemoveCustomOrderDraft(index)}
                        className="text-[10px] text-rose-400 hover:text-rose-300"
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
              <div className="flex items-center gap-2">
                    <span className="text-gray-400 w-16 shrink-0">Side</span>
                    <select
                      value={draft.side}
                      onChange={(e) => updateCustomOrderDraft(index, { side: e.target.value as 'BUY' | 'SELL' })}
                      className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white flex-1"
                    >
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                    <span className="text-gray-400 w-16 shrink-0">Direction</span>
                    <select
                      value={draft.outcome}
                      onChange={(e) =>
                        updateCustomOrderDraft(index, { outcome: e.target.value as CustomSidebarOrderOutcome })
                      }
                      className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white flex-1"
                    >
                      <option value="AUTO">—</option>
                      <option value="YES">YES</option>
                      <option value="NO">NO</option>
                    </select>
              </div>
                  <div className="flex items-center gap-2">
                    <span className="text-gray-400 w-16 shrink-0">Price</span>
                    <select
                      value={draft.priceMode}
                      onChange={(e) =>
                        updateCustomOrderDraft(index, { priceMode: e.target.value as CustomSidebarPriceMode })
                      }
                      className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white min-w-0 flex-[1.2]"
                    >
                      <option value="FIXED">Fixed Price</option>
                      <option value="BS_MINUS_C">BS-¢</option>
                      <option value="BS_PLUS_C">BS+¢</option>
                      <option value="BS_MINUS_PCT">BS-%</option>
                      <option value="BS_PLUS_PCT">BS+%</option>
                    </select>
                    <input
                      value={draft.price}
                      onChange={(e) => updateCustomOrderDraft(index, { price: e.target.value })}
                      type="number"
                      min="0"
                      max={draft.priceMode === 'FIXED' ? '99.9' : undefined}
                      step="0.1"
                      className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-16 tabular-nums"
                    />
                    <span className="text-gray-400 w-3 shrink-0 text-center">{customOrderPriceInputSuffix(draft.priceMode)}</span>
                  </div>
                  {draft.side === 'SELL' && (
                <label className="flex items-center gap-2 ml-[4.5rem] text-gray-300">
                      <input
                        type="checkbox"
                        checked={draft.maxSell}
                        onChange={(e) => updateCustomOrderDraft(index, { maxSell: e.target.checked })}
                        className="rounded accent-red-500"
                      />
                  <span>Max</span>
                </label>
              )}
                </div>
              ))}
              {customOrderDrafts.length < 2 ? (
                <button
                  type="button"
                  onClick={handleAddCustomOrderDraft}
                  className="w-full rounded border border-dashed border-gray-600 px-2 py-1.5 text-gray-300 hover:bg-gray-700/40"
                >
                  Add order
                </button>
              ) : null}
              <p className="text-[10px] text-gray-500 leading-snug">
                Direction — uses YES/NO from Place Order box. BS ± applies to sidebar YES math prob; NO price = 100 − that.
              </p>
              <div className="flex items-center gap-2 pt-1 border-t border-gray-700/80">
                <span className="text-gray-400 w-16 shrink-0">Label</span>
                <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value.slice(0, 3))} maxLength={3} className="bg-gray-900 border border-gray-600 rounded px-2 py-1 text-white w-16 text-center font-bold" />
                <span className="text-gray-500 text-[10px]">1-3 chars</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-400 w-16 shrink-0">Color</span>
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
});
