import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { createPortal } from 'react-dom';
import { useAppStore } from '../stores/appStore';
import { appKit } from '../lib/wallet';
import { placeOrder, cancelOrder, signOrder, submitSignedOrder } from '../api';
import { fetchProxyWallet } from '../api/polymarket';
import { triggerWalletRefresh } from '../lib/clobClient';
import { showToast } from '../utils/toast';
import { signingDialog, isDialogHidden } from './SigningDialog';
import {
  extractAssetFromMarket,
  formatPolymarketVolumeK,
  getOrderClobTokenId,
  getPolymarketVolumeUsd,
  getTokenOutcome,
  getTradeClobTokenId,
  outcomeTokenBelongsToSelectedMarket,
  shortenMarketName,
  tradeMatchesSelectedMarket,
  upDownMarketUsesChainlinkSpot,
} from '../utils/format';
import { getHitMarketProbability, getMarketProbability, isMarketInWeeklyHitMarkets } from '../utils/bsMath';
import { API_BASE } from '../lib/env';
import { fetchUpDownTargetFromCrypto, upDownCryptoTimeframe } from '../lib/upDownTargetFromCrypto';
import { usePolymarketOB } from '../hooks/usePolymarketOB';
import { useOnchainTradesWS } from '../hooks/useOnchainTradesWS';
import { BsFlower } from './BsFlower';
import { HelpTooltip } from './HelpTooltip';
import { LiveTradeChart } from './LiveTradeChart';
import { ChainlinkChart } from './ChainlinkChart';
import { usePolymarketPrice } from '../hooks/usePolymarketPrice';
import { ToxicFlowDialog } from './ToxicFlowDialog';
import { ChevronDown, ChevronRight, CirclePercent, Clock, ExternalLink, GripVertical, Pencil, Plus, UsersRound, X } from 'lucide-react';
import type { AssetSymbol } from '../types';

const SIDEBAR_ORDER_KIND_KEY = 'polymarket-sidebar-order-kind';
const SIDEBAR_CUSTOM_BUTTONS_KEY = 'polymarket-sidebar-custom-buttons';
/** FAK buy: pay up to this per share to lift asks. */
const MARKET_AGGRESSIVE_BUY = 0.99;
/** FAK sell: accept down to this per share to hit bids. */
const MARKET_AGGRESSIVE_SELL = 0.01;

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

export function Sidebar() {
  const { isConnected: walletConnected, address: walletAddress } = useAccount();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  // const setProgDialogOpen = useAppStore((s) => s.setProgDialogOpen);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const positions = useAppStore((s) => s.positions);
  const orders = useAppStore((s) => s.orders);
  const trades = useAppStore((s) => s.trades);
  const marketLookup = useAppStore((s) => s.marketLookup);

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
      winnerBias: entry.winnerBias,
      winnerBiasYesWR: entry.winnerBiasYesWR,
      winnerBiasNoWR: entry.winnerBiasNoWR,
      winBiasShares: entry.winBiasShares,
      winBiasSharesYes: entry.winBiasSharesYes,
      winBiasSharesNo: entry.winBiasSharesNo,
    };
  }, [selectedMarket, marketLookup]);
  const sharesInExistenceDisplay = useMemo(() => {
    const v = liveShareStats?.sharesInExistence;
    if (typeof v !== 'number' || !Number.isFinite(v)) return '--';
    return Math.abs(v) >= 1000
      ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
      : v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }, [liveShareStats]);
  const holdersCountDisplay = useMemo(() => {
    const v = liveShareStats?.holders;
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
  const [orderExpiry, setOrderExpiry] = useState(localStorage.getItem('polymarket-order-expiry') || '180');
  const [orderExpiryUnit, setOrderExpiryUnit] = useState<'s' | 'm' | 'h'>(() => {
    const v = localStorage.getItem('polymarket-order-expiry-unit');
    return v === 's' || v === 'h' ? v : 'm';
  });
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingOrderPrice, setEditingOrderPrice] = useState('');
  const [cancellingOrderIds, setCancellingOrderIds] = useState<Set<string>>(new Set());
  const [positionsRefreshing, setPositionsRefreshing] = useState(false);
  const [toxicDialogOpen, setToxicDialogOpen] = useState(false);
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
  const { bids, asks, trades: polymarketLiveTrades, loading: obLoading } = usePolymarketOB(obTokenId);
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const setLiveTradesSource = useAppStore((s) => s.setLiveTradesSource);
  const setOnchainGridPositions = useAppStore((s) => s.setOnchainGridPositions);
  const [displayBids, setDisplayBids] = useState(bids);
  const [displayAsks, setDisplayAsks] = useState(asks);
  const [onchainSidebarPositions, setOnchainSidebarPositions] = useState<Array<{
    tokenId: string;
    size: number;
    avgPrice: number;
  }>>([]);
  const [onchainSidebarTrades, setOnchainSidebarTrades] = useState<Array<{
    tokenId: string;
    side: 'BUY' | 'SELL';
    price: number;
    size: number;
    blockTime: number;
  }>>([]);
  const [proxyWallet, setProxyWallet] = useState<string | null>(null);
  const pkAddress = useAppStore((s) => s.pkAddress);
  const signingMode = useAppStore((s) => s.signingMode);
  const effectiveSidebarEoa = signingMode === 'privateKey' && pkAddress ? pkAddress : walletAddress;
  useEffect(() => {
    if (!effectiveSidebarEoa) { setProxyWallet(null); return; }
    let cancelled = false;
    fetchProxyWallet(effectiveSidebarEoa).then((pw) => { if (!cancelled) setProxyWallet(pw); });
    return () => { cancelled = true; };
  }, [effectiveSidebarEoa]);

  const onchainWallet = liveTradesSource === 'onchain' ? proxyWallet : null;
  const { trades: onchainLiveTrades, walletPositions: wsPositions, walletTrades: wsTrades, refreshWallet } = useOnchainTradesWS(obTokenId, onchainWallet);
  const [displayLiveTrades, setDisplayLiveTrades] = useState(onchainLiveTrades);

  const requestCrossingConfirm = useCallback((bestPriceCents: number) => {
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
  useEffect(() => {
    if (!obLoading) {
      setDisplayBids(bids);
      setDisplayAsks(asks);
    }
  }, [obLoading, bids, asks]);
  useEffect(() => {
    localStorage.setItem(SIDEBAR_CUSTOM_BUTTONS_KEY, JSON.stringify(customButtons));
  }, [customButtons]);
  useEffect(() => {
    setDisplayLiveTrades(liveTradesSource === 'onchain' ? onchainLiveTrades : polymarketLiveTrades);
  }, [liveTradesSource, onchainLiveTrades, polymarketLiveTrades]);
  // Sync WS-pushed wallet positions/trades into sidebar state
  useEffect(() => {
    if (liveTradesSource !== 'onchain') return;
    setOnchainSidebarPositions(wsPositions);
    setOnchainGridPositions(wsPositions.map((p) => ({ tokenId: p.tokenId, size: p.size })));
  }, [liveTradesSource, wsPositions, setOnchainGridPositions]);
  useEffect(() => {
    if (liveTradesSource !== 'onchain') return;
    setOnchainSidebarTrades(wsTrades);
  }, [liveTradesSource, wsTrades]);

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
    localStorage.setItem('polymarket-order-expiry-unit', orderExpiryUnit);
  }, [orderExpiryUnit]);
  useEffect(() => {
    localStorage.setItem('polymarket-order-amount', orderAmount);
  }, [orderAmount]);

  const isMarketExpired = useMemo(() => {
    if (!selectedMarket) return false;
    if (selectedMarket.closed) return true;
    if (!selectedMarket.endDate) return false;
    const endMs = new Date(selectedMarket.endDate).getTime();
    return Number.isFinite(endMs) && endMs <= Date.now();
  }, [selectedMarket]);
  const myPositions = useMemo(() => {
    if (liveTradesSource !== 'onchain') {
      return positions.filter((p) => outcomeTokenBelongsToSelectedMarket(String(p.asset || '').trim(), selectedMarket, marketLookup));
    }
    return onchainSidebarPositions
      .filter((p) => outcomeTokenBelongsToSelectedMarket(p.tokenId, selectedMarket, marketLookup))
      .map((p) => ({ asset: p.tokenId, size: p.size, avgPrice: p.avgPrice }));
  }, [liveTradesSource, positions, selectedMarket, marketLookup, onchainSidebarPositions]);
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
    return onchainSidebarTrades
      .filter((f) => f.size >= 0.01 && outcomeTokenBelongsToSelectedMarket(f.tokenId, selectedMarket, marketLookup))
      .sort((a, b) => b.blockTime - a.blockTime)
      .map((f) => ({
        asset_id: f.tokenId,
        token_id: f.tokenId,
        side: f.side,
        price: String(f.price),
        size: String(f.size),
        timestamp: f.blockTime > 0 ? f.blockTime * 1000 : Date.now(),
        created_at: '',
        matchTime: '',
      }));
  }, [liveTradesSource, trades, selectedMarket, marketLookup, onchainSidebarTrades]);
  const myTradesDisplay = useMemo(() => myTrades.slice(0, 20), [myTrades]);
  const myTradesPnl = useMemo(() => {
    let totalSellCost = 0;
    let totalBuyCost = 0;
    for (const trade of myTradesDisplay) {
      const rawPrice = parseFloat(trade.price);
      const size = tradeFilledSizeShares(trade);
      if (!Number.isFinite(rawPrice) || !Number.isFinite(size)) continue;
      const cost = rawPrice * size;
      if (trade.side === 'SELL') totalSellCost += cost;
      else if (trade.side === 'BUY') totalBuyCost += cost;
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
  const weeklyHitMarkets = useAppStore((s) => s.weeklyHitMarkets);

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
  const upDownPriceRef = useRef<HTMLDivElement>(null);
  const prevPriceRef = useRef<number>(0);
  const [upDownCountdown, setUpDownCountdown] = useState('');
  const [upDownRemaining, setUpDownRemaining] = useState(Infinity);

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

  const summaryPriceDecimal = useMemo(() => {
    if (orderKind === 'market') {
      if (orderSide === 'BUY') {
        return displayAsks.length > 0 ? parseFloat(displayAsks[0].price) : MARKET_AGGRESSIVE_BUY;
      }
      const bestBid = displayBids.length > 0 ? displayBids[displayBids.length - 1] : null;
      return bestBid ? parseFloat(bestBid.price) : MARKET_AGGRESSIVE_SELL;
    }
    return (parseFloat(orderPrice) || 0) / 100;
  }, [orderKind, orderSide, orderPrice, displayBids, displayAsks]);

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
        if (endTimeSec - nowSec < CLOB_MIN_EXPIRY_SEC) {
          return { expiration: 0, invalidLead: false }; // too close to end → GTC
        }
        return { expiration: endTimeSec, invalidLead: false };
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

  const handleSubmitOrder = async () => {
    if (!selectedMarket) return;
    const tokenId = selectedMarket.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1];
    if (!tokenId) return;
    const size = parseFloat(orderAmount);
    if (!size) return;

    const isMarket = orderKind === 'market';
    let price: number;
    if (isMarket) {
      if (orderSide === 'BUY') {
        if (!displayAsks.length) {
          showToast('No asks in book — cannot market buy', 'error');
          return;
        }
        price = MARKET_AGGRESSIVE_BUY;
      } else {
        if (!displayBids.length) {
          showToast('No bids in book — cannot market sell', 'error');
          return;
        }
        price = MARKET_AGGRESSIVE_SELL;
      }
    } else {
      price = parseFloat(orderPrice) / 100;
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
    }

    let expiration: number | undefined;
    if (isMarket) {
      expiration = 0;
    } else if (orderSide === 'SELL') {
      expiration = 0;
    } else {
      const exp = computeLimitExpiration(selectedMarket.endDate);
      expiration = exp.expiration;
      if (exp.invalidLead) {
        showToast('Lead time to expiration already passed for this market', 'error');
        return;
      }
    }
    const orderInfo = isMarket
      ? `${orderSide} ${size} ${orderOutcome} for ${marketName} (market FAK)`
      : `${orderSide} ${size} ${orderOutcome} for ${marketName} @ ${orderPrice}¢`;
    try {
      const result = await placeOrder({
        tokenId,
      side: orderSide,
        price,
        size,
      expiration,
        ...(isMarket ? { orderType: 'FAK' as const } : {}),
        orderInfo,
      });
      if (result.success) {
        showToast(isMarket ? 'Market order submitted' : 'Order placed', 'success');
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
        showToast(submitResult.error || 'Submit failed (old order was cancelled)', 'error');
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

  const marketName = selectedMarket
    ? shortenMarketName(selectedMarket.question || selectedMarket.groupItemTitle, undefined, undefined, selectedMarket.eventSlug)
    : '';
  const fullMarketName = selectedMarket ? (selectedMarket.question || selectedMarket.groupItemTitle || '') : '';

  const sidebarAsset = selectedMarket ? extractAssetFromMarket(selectedMarket) : '';
  const assetColorMap: Record<string, string> = { BTC: 'text-orange-400', ETH: 'text-blue-400', SOL: 'text-purple-400', XRP: 'text-cyan-400' };
  const sidebarTitleColor = selectedMarket ? (assetColorMap[sidebarAsset] || 'text-gray-500') : 'text-white';
  const polymarketUrl = selectedMarket?.eventSlug ? `https://polymarket.com/event/${selectedMarket.eventSlug}?r=mito` : null;
  const sidebarSectionHeight = 'max(100px, calc((100vh - 44px) * 0.15))';
  const sidebarDoubleSectionHeight = 'max(100px, calc((100vh - 44px) * 0.30))';
  const collapsedSectionHeight = '36px';
  const orderbookSectionHeight = liveOrderbookExpanded
    ? (liveTradesExpanded ? sidebarSectionHeight : sidebarDoubleSectionHeight)
    : collapsedSectionHeight;
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

  return (
    <>
    <ToxicFlowDialog
      open={toxicDialogOpen}
      marketId={selectedMarket?.id || ''}
      marketName={marketName}
      yesTokenId={selectedMarket?.clobTokenIds?.[0] || ''}
      onClose={() => setToxicDialogOpen(false)}
    />
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
          <div className="flex items-center gap-1">
            <div className="flex-1 min-w-0 truncate">
              {polymarketUrl ? (
                <a href={polymarketUrl} target="_blank" rel="noreferrer" className={`${sidebarTitleColor} font-bold text-sm hover:underline`}>
                  {marketName}
                </a>
              ) : (
                <span className={`${sidebarTitleColor} font-bold text-sm`}>{marketName}</span>
              )}
            </div>
            {upDownCountdown && (
              <span className={`text-xs font-bold flex-shrink-0 flex items-center gap-0.5 ${upDownCountdown === 'Expired' ? 'text-red-400' : upDownRemaining < 60000 ? 'text-red-400' : upDownRemaining < 300000 ? 'text-yellow-400' : 'text-green-400'}`}>
                <Clock size={12} /> {upDownCountdown}
              </span>
            )}
          </div>
          <div className="text-[10px] text-gray-500 leading-tight mt-0.5 break-words w-full">
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
          <div className="sidebar-chart-row">
            {/* Chainlink price chart (asset candles for all markets) */}
            {(() => {
              const chartAsset = isUpDownMarket ? upDownAsset : extractAssetFromMarket(selectedMarket);
              if (!chartAsset) return null;
              return (
                <ChainlinkChart
                  asset={chartAsset}
                  intervalContext={upDownIntervalContext}
                  targetPrice={isUpDownMarket ? upDownTargetPrice : undefined}
                  chainlinkCandles={isUpDownMarket && upDownSpotUsesChainlink}
                />
              );
            })()}

            {/* Price History Chart (or Live Trade Chart for Up or Down) */}
            {isUpDownMarket ? (
              <LiveTradeChart
                trades={displayLiveTrades}
                isNo={orderOutcome === 'NO'}
                tokenId={selectedMarket.clobTokenIds?.[0] || ''}
                startTime={upDownStartTime}
                endTime={selectedMarket.endDate ? new Date(selectedMarket.endDate).getTime() : undefined}
                intervalContext={upDownIntervalContext}
                defaultIntervalOverride={upDownKlineDefaultInterval}
                chainlinkAsset={upDownAsset || undefined}
                targetPrice={upDownTargetPrice}
                hidePriceLines
              />
            ) : (
              <LiveTradeChart
                trades={displayLiveTrades}
                isNo={orderOutcome === 'NO'}
                tokenId={selectedMarket.clobTokenIds?.[0] || ''}
                endTime={selectedMarket.endDate ? new Date(selectedMarket.endDate).getTime() : undefined}
                defaultIntervalOverride="5m"
                hidePriceLines
              />
            )}
          </div>


          {/* Up or Down: Target & Current Price (below chart) */}
          {isUpDownMarket && (() => {
            const binanceSym = (upDownAsset?.toUpperCase() + 'USDT') as AssetSymbol;
            const chainlinkPrice =
              upDownSpotUsesChainlink && polyPrice.price != null && polyPrice.price > 0 ? polyPrice.price : 0;
            const binancePrice = priceData[binanceSym]?.price || 0;
            const currentPrice = upDownSpotUsesChainlink ? chainlinkPrice || binancePrice : binancePrice;
            const currentPriceSource: 'chainlink' | 'binance' =
              upDownSpotUsesChainlink && chainlinkPrice > 0 ? 'chainlink' : 'binance';
            // Use 4 decimals for low-priced assets (XRP), 2 for others
            const priceDec = upDownAsset?.toUpperCase() === 'XRP' ? 4 : 2;
            const diff = upDownTargetPrice && currentPrice ? currentPrice - upDownTargetPrice : null;
            const diffPct = upDownTargetPrice && diff !== null ? (diff / upDownTargetPrice) * 100 : null;
            const isUp = diff !== null && diff >= 0;

            // Flash animation on price change
            if (currentPrice && currentPrice !== prevPriceRef.current && upDownPriceRef.current) {
              const el = upDownPriceRef.current;
              const cls = currentPrice > prevPriceRef.current ? 'updown-flash-up' : 'updown-flash-down';
              el.classList.remove('updown-flash-up', 'updown-flash-down');
              void el.offsetWidth; // force reflow
              el.classList.add(cls);
              prevPriceRef.current = currentPrice;
            } else if (currentPrice && !prevPriceRef.current) {
              prevPriceRef.current = currentPrice;
            }

            // Math (terminal BS) probability for up/down: "Up" = above target price at expiry
            let bsUpDown: number | null = null;
            let bsTimeMachinePastExpiry = false;
            if (upDownTargetPrice && currentPrice && selectedMarket?.endDate) {
              // Check if time machine pushes past expiry
              const nowOffset = Date.now() + bsTimeOffsetHours * 3600000;
              const expiryMs = new Date(selectedMarket.endDate).getTime();
              if (bsTimeOffsetHours > 0 && nowOffset >= expiryMs) {
                bsTimeMachinePastExpiry = true;
              } else {
                const asset = extractAssetFromMarket(selectedMarket);
                const sym = (asset + 'USDT') as AssetSymbol;
                const sigma = (volatilityData[sym] || 0.60) * volMultiplier;
                const probUp = getMarketProbability('>' + upDownTargetPrice, currentPrice, selectedMarket.endDate, sigma, bsTimeOffsetHours);
                if (probUp !== null) {
                  bsUpDown = (orderOutcome === 'YES' ? probUp : 1 - probUp) * 100;
                }
              }
            }

            return (
              <div className="sidebar-section py-1 px-3">
                <div className="flex items-start justify-between">
                  <div className="text-left">
                    <div className="text-[10px] text-gray-500">Target</div>
                    <div className="text-xs font-bold text-white">{upDownTargetPrice ? `$${upDownTargetPrice.toLocaleString(undefined, { minimumFractionDigits: priceDec, maximumFractionDigits: priceDec })}` : '...'}</div>
                    {upDownCountdown && <div className={`text-[10px] ${upDownCountdown === 'Expired' ? 'text-red-400' : upDownRemaining < 60000 ? 'text-red-400' : upDownRemaining > 300000 ? 'text-green-400' : 'text-yellow-400'}`}>{upDownCountdown}</div>}
                  </div>
                  {bsTimeMachinePastExpiry ? (
                    <div className="text-center" title="Time machine ahead of expiration">
                      <div className="text-[10px] text-gray-500 flex items-center justify-center gap-0.5">
                        <CirclePercent className="h-2.5 w-2.5 shrink-0 opacity-80" strokeWidth={2.5} aria-hidden />
                        Math
                      </div>
                      <div className="text-xs font-bold text-gray-500">&gt;⏱</div>
                    </div>
                  ) : bsUpDown !== null ? (
                    <div className="text-center">
                      <div className="text-[10px] text-gray-500 flex items-center justify-center gap-0.5">
                        <CirclePercent className="h-2.5 w-2.5 shrink-0 opacity-80" strokeWidth={2.5} aria-hidden />
                        Math
                        <HelpTooltip
                          text={
                            'Mathematical fair value for this Up/Down market (Black-Scholes–style terminal probability).\n\nUses the same spot as “Current” on the right: Polymarket Chainlink for 5m/15m windows, Binance spot for 1h/4h/24h. Inputs: target strike, time to expiry, implied volatility (σ).\n\nFor Up (YES): probability price is above the target at expiry. For Down (NO): below.\n\nCompare to the market price to spot mispricings.'
                          }
                        />
                      </div>
                      {(() => {
                        const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) * 100 : null;
                        let bsColor = 'text-yellow-400';
                        if (bestAsk !== null && bsUpDown !== null) {
                          if (bestAsk < bsUpDown * 0.95) bsColor = 'text-green-400';
                          else if (bestAsk > bsUpDown * 1.05) bsColor = 'text-red-400';
                        }
                        return (
                          <div
                            className={`inline-flex items-center justify-center gap-0.5 text-xs font-bold ${bsColor} cursor-pointer hover:underline`}
                            onClick={() => setOrderPrice(bsUpDown!.toFixed(1))}
                          >
                            <CirclePercent className="h-3 w-3 shrink-0 opacity-90" strokeWidth={2.5} aria-hidden />
                            <span className="tabular-nums">{bsUpDown!.toFixed(1)}</span>
                          </div>
                        );
                      })()}
                    </div>
                  ) : null}
                  <div className="text-right">
                    <div className="text-[10px] text-gray-500 flex items-center justify-end gap-1">
                      Current{' '}
                      <span
                        className={`px-0.5 rounded-sm text-[8px] font-bold leading-tight ${currentPriceSource === 'chainlink' ? 'bg-blue-600 text-white' : 'bg-yellow-400 text-black'}`}
                        title={
                          currentPriceSource === 'chainlink'
                            ? 'Polymarket RTDS Chainlink (via backend)'
                            : upDownSpotUsesChainlink
                              ? 'Binance spot (fallback until Chainlink connects)'
                            : 'Binance spot (1h/4h/24h Up/Down)'
                        }
                      >
                        {currentPriceSource === 'chainlink' ? 'CHAINLINK' : 'BINANCE'}
                      </span>
                    </div>
                    <div ref={upDownPriceRef} className="text-xs font-bold text-white">{currentPrice ? `$${currentPrice.toLocaleString(undefined, { minimumFractionDigits: priceDec, maximumFractionDigits: priceDec })}` : '...'}</div>
                    {diff !== null && diffPct !== null && (
                      <div className={`text-[10px] font-bold flex flex-wrap items-center justify-end gap-0.5 ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                        <span>
                          {isUp ? '↑' : '↓'}{Math.abs(diff).toLocaleString(undefined, { minimumFractionDigits: priceDec, maximumFractionDigits: priceDec })}
                        </span>
                        <span className="inline-flex items-center gap-0.5 tabular-nums">
                          (
                          {diffPct >= 0 ? '+' : ''}
                          {diffPct.toFixed(2)}%
                          {')'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
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
            <div className="grid grid-cols-3 gap-2 text-[10px]">
              <div className="rounded border border-gray-700/70 bg-gray-900/50 px-2 py-1">
                <div className="text-[9px] uppercase tracking-wide text-gray-500">Volume</div>
                <div
                  className="tabular-nums font-bold text-green-400"
                  title="Toxic Flow USDC volume (wallet_positions usdc_in), same source as Up/Down grid"
                >
                  {liveOrderbookVolumeDisplay && liveOrderbookVolumeDisplay !== '--'
                    ? `$${liveOrderbookVolumeDisplay}`
                    : '--'}
                </div>
              </div>
              <div className="rounded border border-gray-700/70 bg-gray-900/50 px-2 py-1">
                <div className="text-[9px] uppercase tracking-wide text-gray-500">Shares</div>
                <div className="tabular-nums font-bold text-gray-200" title="Shares in existence from net wallet balances: sum(abs(YES-NO))">
                  {sharesInExistenceDisplay}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setToxicDialogOpen(true)}
                onPointerDown={(e) => e.stopPropagation()}
                className="rounded border border-yellow-500/50 bg-yellow-900/20 px-2 py-1 text-left hover:bg-yellow-500/20 transition-colors"
                title="Holders Analysis"
              >
                <div className="text-[9px] uppercase tracking-wide text-yellow-400">Holders</div>
                <div className="tabular-nums font-bold text-yellow-300">{holdersCountDisplay}</div>
              </button>
            </div>
            {/* Compact bias bars */}
            {(() => {
              const posLabel = isUpDownMarket ? 'UP' : 'YES';
              const negLabel = isUpDownMarket ? 'DOWN' : 'NO';
              const colorFor = (v: number) => v > 0.01 ? 'text-green-400' : v < -0.01 ? 'text-red-400' : 'text-gray-500';
              const barFor = (v: number) => Math.max(2, Math.min(98, 50 + v * 50));

              const live = liveShareStats?.liveBias ?? 0;
              const liveWin = liveShareStats?.liveBiasWindowMin || 30;

              const bidTotal = displayBids.reduce((s, l) => {
                const pCents = parseFloat(l.price) * 100;
                if (!Number.isFinite(pCents) || pCents < 5 || pCents > 95) return s;
                return s + parseFloat(l.size);
              }, 0);
              const askTotal = displayAsks.reduce((s, l) => {
                const pCents = parseFloat(l.price) * 100;
                if (!Number.isFinite(pCents) || pCents < 5 || pCents > 95) return s;
                return s + parseFloat(l.size);
              }, 0);
              const bookDenom = bidTotal + askTotal;
              const book = bookDenom > 0 ? (bidTotal - askTotal) / bookDenom : 0;

              const conc = liveShareStats?.concentration ?? 0;
              const concPct = Math.max(0, Math.min(100, conc * 100));
              const cR = Math.round(Math.min(255, conc * 2 * 255));
              const cG = Math.round(Math.min(255, (1 - conc) * 2 * 255));
              const concColor = `rgb(${cR}, ${cG}, 0)`;

              const wb = liveShareStats?.winnerBias ?? 0;
              const yesWR = liveShareStats?.winnerBiasYesWR ?? 0;
              const noWR = liveShareStats?.winnerBiasNoWR ?? 0;
              const wbs = liveShareStats?.winBiasShares ?? 0;
              const yesWRs = liveShareStats?.winBiasSharesYes ?? 0;
              const noWRs = liveShareStats?.winBiasSharesNo ?? 0;

              const MiniBar = ({ label, value, leftColor, rightColor, tooltip }: { label: string; value: number; leftColor: string; rightColor: string; tooltip?: string }) => (
                <div className="flex items-center gap-1 min-w-0" title={tooltip}>
                  <span className="text-[8px] text-gray-500 w-[38px] shrink-0 truncate">{label}</span>
                  <div className="h-[5px] bg-gray-700 rounded-full overflow-hidden flex flex-1 min-w-0">
                    <div className={`${leftColor} h-full transition-all`} style={{ width: `${barFor(value)}%` }} />
                    <div className={`${rightColor} h-full transition-all flex-1`} />
                  </div>
                  <span className={`text-[8px] font-bold w-[28px] shrink-0 text-right ${colorFor(value)}`}>
                    {(value * 100) > 0 ? '+' : ''}{(value * 100).toFixed(0)}%
                  </span>
                </div>
              );

              return (
                <div className="mt-1 space-y-0.5">
                  <MiniBar label="Book" value={book} leftColor="bg-emerald-500/70" rightColor="bg-amber-500/70" tooltip={`Book Imbalance: ${(book * 100).toFixed(1)}%`} />
                  <MiniBar label={`Flow${liveWin}m`} value={live} leftColor="bg-cyan-500/70" rightColor="bg-pink-500/70" tooltip={`Live Flow (${liveWin}m): ${(live * 100).toFixed(1)}%`} />
                  <MiniBar label="Win$" value={wb} leftColor="bg-cyan-400/75" rightColor="bg-pink-400/75" tooltip={`Winner Bias (USDC): ${posLabel} WR ${(yesWR * 100).toFixed(0)}% / ${negLabel} WR ${(noWR * 100).toFixed(0)}%`} />
                  <MiniBar label="WinS" value={wbs} leftColor="bg-cyan-400/75" rightColor="bg-pink-400/75" tooltip={`Winner Bias (Shares): ${posLabel} WR ${(yesWRs * 100).toFixed(0)}% / ${negLabel} WR ${(noWRs * 100).toFixed(0)}%`} />
                  <div className="flex items-center gap-1 min-w-0" title={`Concentration: ${concPct.toFixed(0)}%`}>
                    <span className="text-[8px] text-gray-500 w-[38px] shrink-0 truncate">Conc</span>
                    <div className="h-[5px] bg-gray-700 rounded-full overflow-hidden flex-1 min-w-0">
                      <div className="h-full transition-all rounded-full" style={{ width: `${concPct}%`, backgroundColor: concColor }} />
                    </div>
                    <span className="text-[8px] font-bold w-[28px] shrink-0 text-right" style={{ color: concColor }}>
                      {concPct.toFixed(0)}%
                    </span>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Live Orderbook + Trades */}
          <div className="sidebar-section flex flex-col min-h-0 overflow-hidden" style={{ height: orderbookSectionHeight, minHeight: orderbookSectionHeight, maxHeight: orderbookSectionHeight }}>
            <div className="text-xs text-gray-400 mb-2 flex w-full min-w-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setLiveOrderbookExpanded(v => !v)}
                className="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition"
                title={liveOrderbookExpanded ? 'Collapse' : 'Expand'}
              >
                {liveOrderbookExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              <span className="shrink-0">Live Orderbook</span>
              <span
                className="inline-flex items-center rounded px-1 py-0.5 text-[9px] font-bold leading-none border border-[#2d57ff] bg-[#2f5cff]"
                title="This orderbook data comes from Polymarket's live market feed."
              >
                <img
                  src="/polymarket-favicon.ico"
                  alt="Polymarket"
                  className="h-3 w-3 rounded-[2px]"
                  style={{ filter: 'brightness(0) invert(1)' }}
                />
              </span>
            </div>
            {liveOrderbookExpanded && (
              <div className="relative grid grid-cols-2 gap-2 flex-1 min-h-0 overflow-y-auto" style={{ minHeight: 120 }}>
                <div>
                  <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-500 mb-1">
                    <span>Bid</span><span className="text-right">Size</span>
                  </div>
                  <div className="space-y-0.5">
                    {(() => {
                      let cumul = 0;
                      const cumuls = displayBids.map((b) => { cumul += parseFloat(b.size) || 0; return cumul; });
                      const maxCumul = cumuls.length > 0 ? cumuls[cumuls.length - 1] : 1;
                      return displayBids.map((bid, i) => {
                        const bp = (parseFloat(bid.price) * 100).toFixed(1);
                        const hl = sidebarUserBidPrices.has(bp) ? 'bg-blue-900/50 font-bold' : '';
                        const depthPct = maxCumul > 0 ? (cumuls[i] / maxCumul) * 100 : 0;
                        return (
                          <div
                            key={i}
                            className={`relative grid grid-cols-2 gap-1 text-[11px] px-1 hover:bg-green-900/30 cursor-pointer ${hl}`}
                            onClick={() => {
                              setOrderSide('SELL');
                              setOrderPrice(bp.replace(/\.0$/, ''));
                              const tokenId = selectedMarket?.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1] || '';
                              const pos = positions.find((p) => p.asset === tokenId && p.size > 0);
                              if (pos) setOrderAmount(String(Math.floor(pos.size * 100) / 100));
                              else setOrderAmount('');
                            }}
                          >
                            <div className="absolute inset-y-0 right-0 bg-green-500/10 pointer-events-none" style={{ width: `${depthPct}%` }} />
                            <span className="relative live-ob-bid">{bp}¢</span>
                            <span className="relative text-right text-gray-400">{parseFloat(bid.size).toFixed(0)}</span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
                <div>
                  <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-500 mb-1">
                    <span>Ask</span><span className="text-right">Size</span>
                  </div>
                  <div className="space-y-0.5">
                    {(() => {
                      let cumul = 0;
                      const cumuls = displayAsks.map((a) => { cumul += parseFloat(a.size) || 0; return cumul; });
                      const maxCumul = cumuls.length > 0 ? cumuls[cumuls.length - 1] : 1;
                      return displayAsks.map((ask, i) => {
                        const ap = (parseFloat(ask.price) * 100).toFixed(1);
                        const hl = sidebarUserAskPrices.has(ap) ? 'bg-orange-900/50 font-bold' : '';
                        const cumulativeAskSize = cumuls[i];
                        const depthPct = maxCumul > 0 ? (cumulativeAskSize / maxCumul) * 100 : 0;
                        return (
                          <div
                            key={i}
                            className={`relative grid grid-cols-2 gap-1 text-[11px] px-1 hover:bg-red-900/30 cursor-pointer ${hl}`}
                            onClick={() => {
                              setOrderSide('BUY');
                              setOrderPrice(ap.replace(/\.0$/, ''));
                              setOrderAmount(cumulativeAskSize.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1'));
                            }}
                          >
                            <div className="absolute inset-y-0 left-0 bg-red-500/10 pointer-events-none" style={{ width: `${depthPct}%` }} />
                            <span className="relative live-ob-ask">{ap}¢</span>
                            <span className="relative text-right text-gray-400">{parseFloat(ask.size).toFixed(0)}</span>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
                {obLoading && (
                  <div className="absolute inset-0 z-10 bg-gray-900/55 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
                    <div className={`text-[10px] ${isMarketExpired ? 'text-red-400' : 'text-gray-300'}`}>
                      {isMarketExpired ? 'Market Expired' : 'Loading orderbook...'}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Live Trades */}
          <div className={`sidebar-section live-trades-section ${liveTradesExpanded ? 'expanded' : ''} ${liveTradesExpanded && !liveOrderbookExpanded ? 'boosted' : ''} flex flex-col min-h-0 overflow-hidden flex-shrink-0`} style={{ height: liveTradesSectionHeight, minHeight: liveTradesSectionHeight, maxHeight: liveTradesSectionHeight }}>
            <div className="text-xs text-gray-400 mb-2 flex items-center gap-1">
              <button
                type="button"
                onClick={() => setLiveTradesExpanded(v => !v)}
                className="shrink-0 rounded p-0.5 text-gray-400 hover:text-gray-200 hover:bg-gray-700/50 transition"
                title={liveTradesExpanded ? 'Collapse' : 'Expand'}
              >
                {liveTradesExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              <span>Live Trades</span>
              <div className="ml-1 inline-flex overflow-hidden rounded border border-gray-600/70">
                <button
                  type="button"
                  className={`px-1.5 py-0.5 text-[9px] font-bold leading-none transition ${
                    liveTradesSource === 'onchain'
                      ? 'bg-purple-700/60 text-purple-100'
                      : 'bg-gray-900/80 text-gray-400 hover:text-gray-200'
                  }`}
                  onClick={() => setLiveTradesSource('onchain')}
                  title="Show on-chain live trades"
                >
                  ONCHAIN
                </button>
                <button
                  type="button"
                  className={`px-1.5 py-0.5 text-[9px] font-bold leading-none transition ${
                    liveTradesSource === 'polymarket'
                      ? 'bg-blue-700/60 text-blue-100'
                      : 'bg-gray-900/80 text-gray-400 hover:text-gray-200'
                  }`}
                  onClick={() => setLiveTradesSource('polymarket')}
                  title="Show Polymarket live trades"
                >
                  POLYMARKET
                </button>
              </div>
            </div>
            {liveTradesExpanded && (
              <>
                <div className="grid grid-cols-5 gap-1 text-[10px] text-gray-500 mb-1">
                  <span>Price</span><span className="text-right">Side</span><span className="text-right">Size</span><span className="text-right">USD</span><span className="text-right">Time</span>
                </div>
                <div className="relative space-y-0.5 overflow-y-auto flex-1 min-h-0" style={{ minHeight: 90 }}>
                  {displayLiveTrades.map((t, i) => {
                    const tp = (parseFloat(t.price) * 100).toFixed(1);
                    const isBuy = t.side === 'BUY';
                    const agoSec = Math.max(0, Math.floor((tradeTickNow - t.timestamp) / 1000));
                    const agoStr = agoSec < 60 ? `${agoSec}s` : agoSec < 3600 ? `${Math.floor(agoSec / 60)}m` : agoSec < 86400 ? `${Math.floor(agoSec / 3600)}h` : `${Math.floor(agoSec / 86400)}d`;
                    const usdValue = (parseFloat(t.price) * parseFloat(t.size)).toFixed(2);
                    return (
                      <div key={i} className="grid grid-cols-5 gap-1 text-[11px] px-1">
                        <span className={`inline-flex items-center gap-1 ${isBuy ? 'text-green-400' : 'text-red-400'}`}>
                          {tp}¢
                          {liveTradesSource === 'onchain' && t.txHash && (
                            <a
                              href={`https://polygonscan.com/tx/${t.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              title="View transaction on Polygonscan"
                              className="text-gray-400 hover:text-blue-300"
                            >
                              <ExternalLink size={11} />
                            </a>
                          )}
                        </span>
                        <span className={`text-right text-[9px] ${isBuy ? 'text-green-400' : 'text-red-400'}`}>{isBuy ? 'Buy' : 'Sell'}</span>
                        <span className="text-right text-gray-400">{parseFloat(t.size).toFixed(0)}</span>
                        <span className="text-right text-gray-400">{usdValue}</span>
                        <span className="text-right text-gray-500">{agoStr}</span>
                      </div>
                    );
                  })}
                  {displayLiveTrades.length === 0 && (
                    <div className="text-[10px] text-gray-600 px-1">Waiting...</div>
                  )}
                </div>
              </>
            )}
          </div>

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
                    type="number"
                    value={orderPrice}
                    onChange={(e) => setOrderPrice(e.target.value)}
                    disabled={orderKind === 'market'}
                    className="order-input w-full h-[38px] text-center text-lg font-bold leading-none px-10 no-spin disabled:cursor-not-allowed disabled:opacity-70"
                    placeholder="50"
                    min={0.1}
                    max={99.9}
                    step={0.1}
                  />
                  <button
                    type="button"
                    disabled={orderKind === 'market'}
                    onClick={() => adjustOrderPriceCents(-1)}
                    className="absolute left-1 top-1/2 -translate-y-1/2 h-7 w-7 rounded-md text-gray-300 hover:text-white hover:bg-gray-700/70 text-2xl leading-none flex items-center justify-center disabled:pointer-events-none disabled:opacity-40"
                    aria-label="Decrease price by 1 cent"
                  >
                    -
                  </button>
                  <button
                    type="button"
                    disabled={orderKind === 'market'}
                    onClick={() => adjustOrderPriceCents(1)}
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
                    className="order-input h-[38px] pr-5 w-full"
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
                      Time before market expiration. Order expires at: market end time minus this value/unit.
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
                      setOrderExpiry(e.target.value);
                      localStorage.setItem('polymarket-order-expiry', e.target.value);
                    }}
                    className="bg-transparent text-left text-white text-[11px] w-full outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none disabled:cursor-not-allowed disabled:opacity-40"
                    min={0}
                    step={10}
                  />
                  <select
                    value={orderExpiryUnit}
                    disabled={orderKind === 'market'}
                    onChange={(e) => setOrderExpiryUnit(e.target.value as 's' | 'm' | 'h')}
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
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">My Positions</span>
              <button
                onClick={() => {
                  setPositionsRefreshing(true);
                  triggerWalletRefresh();
                  if (liveTradesSource === 'onchain') {
                    refreshWallet();
                  }
                  setTimeout(() => setPositionsRefreshing(false), 2000);
                }}
                className="text-gray-500 hover:text-white transition"
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
                  return (
                    <div key={i} className="bg-gray-700/30 rounded px-1.5 py-0.5 text-[12px] min-w-0">
                      <div
                        className="w-full text-gray-300 leading-tight break-words"
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
                  const signedCost = side === 'BUY' ? -cost : cost;
                  return (
                    <tr key={i} className="text-gray-300">
                      <td className={`py-0.5 ${side === 'BUY' ? 'text-emerald-400' : side === 'CLAIM' ? 'text-blue-400' : 'text-rose-400'}`}>{side || '-'}</td>
                      <td className={outcome === 'YES' ? 'py-0.5 text-emerald-400' : 'py-0.5 text-rose-400'}>{sideLabel}</td>
                      <td className="py-0.5 text-right">{Number.isFinite(size) ? size.toFixed(2) : '-'}</td>
                      <td className="py-0.5 text-right">{Number.isFinite(rawPrice) ? `${(rawPrice * 100).toFixed(1)}¢` : '-'}</td>
                      <td className={`py-0.5 text-right ${side === 'BUY' ? 'text-rose-400' : side === 'SELL' ? 'text-emerald-400' : 'text-gray-300'}`}>
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
