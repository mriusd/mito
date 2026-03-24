import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { useAppStore } from '../stores/appStore';
import { appKit } from '../lib/wallet';
import { placeOrder, cancelOrder, signOrder, submitSignedOrder } from '../api';
import { triggerWalletRefresh } from '../lib/clobClient';
import { showToast } from '../utils/toast';
import { signingDialog, isDialogHidden } from './SigningDialog';
import { getTokenOutcome, extractAssetFromMarket, shortenMarketName } from '../utils/format';
import { getMarketProbability } from '../utils/bsMath';
import { API_BASE } from '../lib/env';
import { usePolymarketOB } from '../hooks/usePolymarketOB';
import { BsFlower } from './BsFlower';
import { HelpTooltip } from './HelpTooltip';
import { PriceChart } from './PriceChart';
import { LiveTradeChart } from './LiveTradeChart';
import { ChainlinkChart } from './ChainlinkChart';
import { usePolymarketPrice } from '../hooks/usePolymarketPrice';
import { ToxicFlowDialog } from './ToxicFlowDialog';
import { Biohazard, Clock } from 'lucide-react';
import type { AssetSymbol } from '../types';

export function Sidebar() {
  const { isConnected: walletConnected } = useAccount();
  const sidebarOpen = useAppStore((s) => s.sidebarOpen);
  // const setProgDialogOpen = useAppStore((s) => s.setProgDialogOpen);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const positions = useAppStore((s) => s.positions);
  const orders = useAppStore((s) => s.orders);
  const trades = useAppStore((s) => s.trades);
  const marketLookup = useAppStore((s) => s.marketLookup);
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
  const [orderAmount, setOrderAmount] = useState('');
  const [orderExpiry, setOrderExpiry] = useState(localStorage.getItem('polymarket-order-expiry') || '180');
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [editingOrderPrice, setEditingOrderPrice] = useState('');
  const [cancellingOrderIds, setCancellingOrderIds] = useState<Set<string>>(new Set());
  const [positionsRefreshing, setPositionsRefreshing] = useState(false);
  const [toxicDialogOpen, setToxicDialogOpen] = useState(false);
  // Inline signing step display when dialog is hidden
  const [signingState, setSigningState] = useState(signingDialog.getState());
  useEffect(() => signingDialog.subscribe(setSigningState), []);
  // Live WebSocket orderbook from Polymarket
  const obTokenId = useMemo(() => {
    if (!sidebarOpen || !selectedMarket?.clobTokenIds) return null;
    return selectedMarket.clobTokenIds[orderOutcome === 'YES' ? 0 : 1] || null;
  }, [sidebarOpen, selectedMarket, orderOutcome]);
  const { bids, asks, trades: liveTrades, loading: obLoading } = usePolymarketOB(obTokenId);

  // Filter positions/orders/trades for selected market
  const marketTokenIds = selectedMarket?.clobTokenIds || [];
  const myPositions = positions.filter((p) => marketTokenIds.includes(p.asset || ''));
  const allMarketOrders = orders.filter((o) => marketTokenIds.includes(o.asset_id || o.token_id || o.market || ''));
  const myOrders = allMarketOrders.filter((o) => !progOrderMap[o.id]);
  const progOrders = allMarketOrders.filter((o) => !!progOrderMap[o.id]);
  const myTrades = trades.filter((t) => marketTokenIds.includes(t.asset_id || t.token_id || t.market || ''));

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
    const probYes = getMarketProbability(ps, livePrice, endDate, sigma, bsTimeOffsetHours);
    if (probYes === null) return 0;
    const prob = orderOutcome === 'YES' ? probYes : 1 - probYes;
    return prob * 100;
  }, [selectedMarket, orderOutcome, vwapData, priceData, volatilityData, volMultiplier, bsTimeOffsetHours]);


  // Up or Down market detection and state
  const [upDownTargetPrice, setUpDownTargetPrice] = useState<number | null>(null);
  const isUpDownMarket = !!(selectedMarket?.question?.match(/up\s+or\s+down/i) || selectedMarket?.eventSlug?.match(/up-or-down|updown/i));
  const upDownPriceRef = useRef<HTMLDivElement>(null);
  const prevPriceRef = useRef<number>(0);
  const [upDownCountdown, setUpDownCountdown] = useState('');
  const [upDownRemaining, setUpDownRemaining] = useState(Infinity);

  // Polymarket live price via Chainlink WS
  const upDownAsset = isUpDownMarket ? extractAssetFromMarket(selectedMarket!) : null;
  const polyPrice = usePolymarketPrice(upDownAsset);

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
    let cancelled = false;

    if (is5m) {
      // 5m markets: priceToBeat comes from backend Chainlink collector via market refresh.
      // Nothing to fetch here — it will arrive with the next market data refresh.
      return;
    } else {
      // 15m/1h/24h: crypto-price API works correctly for these
      let variant = 'hourly';
      let intervalMs = 60 * 60 * 1000;
      if (combined.match(/updown-15m/i) || combined.match(/\b15[- ]?min/i)) { variant = 'fifteen'; intervalMs = 15 * 60 * 1000; }
      else if (combined.match(/up-or-down-on-/i) || combined.match(/\b24[- ]?h/i)) { variant = 'daily'; intervalMs = 24 * 60 * 60 * 1000; }

      const startISO = new Date(endMs - intervalMs).toISOString();
      const asset = extractAssetFromMarket(selectedMarket);
      const endISO = new Date(endMs).toISOString();

      fetch(`${API_BASE}/api/polyproxy/site/api/crypto/crypto-price?symbol=${asset}&eventStartTime=${startISO}&variant=${variant}&endDate=${endISO}`)
        .then(r => r.json())
        .then(d => { if (!cancelled && d?.openPrice) setUpDownTargetPrice(d.openPrice); })
        .catch(() => {});
    }
    return () => { cancelled = true; };
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

  const cost = (() => {
    const p = parseFloat(orderPrice) / 100;
    const a = parseFloat(orderAmount);
    if (!p || !a) return 0;
    if (orderSide === 'BUY') return p * a;
    return (1 - p) * a;
  })();

  const payout = (() => {
    const a = parseFloat(orderAmount);
    if (!a) return 0;
    if (orderSide === 'BUY') return a;
    return a;
  })();

  const handleSubmitOrder = async () => {
    if (!selectedMarket) return;
    const tokenId = selectedMarket.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1];
    if (!tokenId) return;
    const price = parseFloat(orderPrice) / 100;
    const size = parseFloat(orderAmount);
    if (!price || !size) return;
    const expMinutes = parseInt(orderExpiry) || 180;
    // Compute expiration as Unix timestamp: market end time minus expMinutes
    const marketEndDate = selectedMarket.endDate;
    let expiration: number;
    if (marketEndDate) {
      const endTimeSec = Math.floor(new Date(marketEndDate).getTime() / 1000);
      const marketDurationMin = (endTimeSec - Math.floor(Date.now() / 1000)) / 60;
      // For short markets (< expMinutes remaining), expire 30s before market end
      if (marketDurationMin < expMinutes) {
        expiration = endTimeSec - 30;
      } else {
        expiration = endTimeSec - expMinutes * 60;
      }
    } else {
      // Fallback: now + 24h if no market end date
      expiration = Math.floor(Date.now() / 1000) + 86400;
    }
    // Ensure expiration is in the future (at least now + 2 min)
    const minExpiration = Math.floor(Date.now() / 1000) + 120;
    if (expiration < minExpiration) expiration = minExpiration;
    const orderInfo = `${orderSide} ${size} ${orderOutcome} for ${marketName} @ ${orderPrice}¢`;
    try {
      const result = await placeOrder({ tokenId, side: orderSide, price, size, expiration, orderInfo });
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
    const outcome = getTokenOutcome(tokenId, marketLookup);
    const orderInfo = `${side} ${size} ${outcome} for ${marketName} @ ${newPriceCents}¢`;
    signingDialog.open(false, { title: 'Replacing Order', signLabel: 'Sign new order in wallet', submitLabel: 'Cancel old & submit new', orderInfo });
    try {
      // Step 1: Sign new order (wallet popup) — user can reject here without affecting old order
      signingDialog.setStep('sign', 'active');
      const expMinutes = parseInt(orderExpiry) || 180;
      const marketEndDate = selectedMarket?.endDate;
      let expiration: number;
      if (marketEndDate) {
        const endTimeSec = Math.floor(new Date(marketEndDate).getTime() / 1000);
        const marketDurationMin = (endTimeSec - Math.floor(Date.now() / 1000)) / 60;
        if (marketDurationMin < expMinutes) {
          expiration = endTimeSec - 30;
        } else {
          expiration = endTimeSec - expMinutes * 60;
        }
      } else {
        expiration = Math.floor(Date.now() / 1000) + 86400;
      }
      const minExpiration = Math.floor(Date.now() / 1000) + 120;
      if (expiration < minExpiration) expiration = minExpiration;

      const signResult = await signOrder({ tokenId, side, price: newPrice, size, expiration });
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

  const setOrderAmountDollar = (dollars: number) => {
    const price = parseFloat(orderPrice) / 100;
    if (price > 0) {
      const shares = Math.floor(dollars / price);
      setOrderAmount(String(shares));
    }
  };

  const marketName = selectedMarket
    ? shortenMarketName(selectedMarket.question || selectedMarket.groupItemTitle, undefined, undefined, selectedMarket.eventSlug)
    : '';

  const sidebarAsset = selectedMarket ? extractAssetFromMarket(selectedMarket) : '';
  const assetColorMap: Record<string, string> = { BTC: 'text-orange-400', ETH: 'text-blue-400', SOL: 'text-purple-400', XRP: 'text-cyan-400' };
  const sidebarTitleColor = selectedMarket ? (assetColorMap[sidebarAsset] || 'text-gray-500') : 'text-white';
  const polymarketUrl = selectedMarket?.eventSlug ? `https://polymarket.com/event/${selectedMarket.eventSlug}` : null;

  return (
    <>
    <ToxicFlowDialog
      open={toxicDialogOpen}
      marketId={selectedMarket?.id || ''}
      marketName={marketName}
      onClose={() => setToxicDialogOpen(false)}
    />
    <div className={`right-sidebar ${sidebarOpen ? 'open' : ''}`}>
      {/* Portfolio Summary */}
      {selectedMarket && (
        <div className="sidebar-section bg-gray-800/80 py-1">
          <div className="flex items-center gap-1">
            <div className="flex-1 truncate">
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
        </div>
      )}

      {!selectedMarket && (
        <div className="sidebar-section px-3 py-4 text-xs text-gray-300 leading-relaxed">
          <p className="text-gray-400 mb-3">Professional dashboard for Polymarket crypto markets.</p>

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
                <div className="text-gray-400 mt-0.5">Model probability across ranges and fast-forward expiry with the Time Machine.</div>
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
          {/* Chainlink price chart (asset candles for all markets) */}
          {(() => {
            const chartAsset = isUpDownMarket ? upDownAsset : extractAssetFromMarket(selectedMarket);
            if (!chartAsset) return null;
            return <ChainlinkChart asset={chartAsset} eventSlug={isUpDownMarket ? selectedMarket.eventSlug : undefined} targetPrice={isUpDownMarket ? upDownTargetPrice : undefined} />;
          })()}

          {/* Price History Chart (or Live Trade Chart for Up or Down) */}
          {isUpDownMarket
            ? <LiveTradeChart trades={liveTrades} isNo={orderOutcome === 'NO'} tokenId={selectedMarket.clobTokenIds?.[0] || ''} startTime={upDownStartTime} endTime={selectedMarket.endDate ? new Date(selectedMarket.endDate).getTime() : undefined} eventSlug={selectedMarket.eventSlug} chainlinkAsset={upDownAsset || undefined} targetPrice={upDownTargetPrice} />
            : <PriceChart market={selectedMarket} isNo={orderOutcome === 'NO'} />
          }


          {/* Up or Down: Target & Current Price (below chart) */}
          {isUpDownMarket && (() => {
            const binanceSym = (upDownAsset?.toUpperCase() + 'USDT') as AssetSymbol;
            const currentPrice = priceData[binanceSym]?.price || 0;
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

            // B-S probability for up/down: "Up" = above target price at expiry
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
                      <div className="text-[10px] text-gray-500">B-S</div>
                      <div className="text-xs font-bold text-gray-500">&gt;⏱</div>
                    </div>
                  ) : bsUpDown !== null ? (
                    <div className="text-center">
                      <div className="text-[10px] text-gray-500 flex items-center justify-center gap-0.5">B-S <HelpTooltip text={"Black-Scholes fair value for this Up/Down market.\n\nCalculated using the Polymarket Chainlink current price as the underlying, the target price as the strike, time to expiry, and implied volatility (σ).\n\nFor Up (YES): probability that price will be above the target at expiry.\nFor Down (NO): probability that price will be below the target at expiry.\n\nCompare this to the market price to find mispricings."} /></div>
                      {(() => {
                        const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) * 100 : null;
                        let bsColor = 'text-yellow-400';
                        if (bestAsk !== null && bsUpDown !== null) {
                          if (bestAsk < bsUpDown * 0.95) bsColor = 'text-green-400';
                          else if (bestAsk > bsUpDown * 1.05) bsColor = 'text-red-400';
                        }
                        return <div className={`text-xs font-bold ${bsColor} cursor-pointer hover:underline`} onClick={() => setOrderPrice(bsUpDown!.toFixed(1))}>{bsUpDown!.toFixed(1)}¢</div>;
                      })()}
                    </div>
                  ) : null}
                  <div className="text-right">
                    <div className="text-[10px] text-gray-500 flex items-center justify-end gap-1">Current <span className="px-0.5 rounded-sm text-[8px] font-bold bg-yellow-400 text-black leading-tight">BINANCE</span></div>
                    <div ref={upDownPriceRef} className="text-xs font-bold text-white">{currentPrice ? `$${currentPrice.toLocaleString(undefined, { minimumFractionDigits: priceDec, maximumFractionDigits: priceDec })}` : '...'}</div>
                    {diff !== null && diffPct !== null && (
                      <div className={`text-[10px] font-bold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                        {isUp ? '↑' : '↓'}{Math.abs(diff).toLocaleString(undefined, { minimumFractionDigits: priceDec, maximumFractionDigits: priceDec })} ({diffPct >= 0 ? '+' : ''}{diffPct.toFixed(2)}%)
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
                  <span className="text-xs text-gray-400">B-S Probability</span>
                  <HelpTooltip text={"Black-Scholes (B-S) is a mathematical model for pricing options, adapted here to estimate the probability of an asset reaching a given strike price by expiry.\n\nInputs:\n• Underlying price (VWAP or live price)\n• Strike price (the market's target price)\n• Time to expiry\n• Implied volatility (σ multiplier in header)\n\nThe flower petals show the max and min B-S probability values calculated across the set price ranges. This gives a visual sense of the probability spread.\n\nA high B-S probability means the model considers it likely the asset will reach the strike. Comparing B-S probability to the market price reveals potential mispricings."} />
                </div>
                <BsFlower asset={bsAsset} strike={bsStrike} endDate={bsEndDate} isYes={orderOutcome === 'YES'} onPriceClick={(cents) => setOrderPrice(String(cents))} />
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
                  <span className="text-xs text-gray-400">B-S Probability</span>
                  <HelpTooltip text={"Black-Scholes probability for this 24h Up/Down market.\n\nUses the target price as the strike, current price as the underlying, time to expiry, and implied volatility (σ).\n\nThe flower petals show the probability spread across your configured price ranges."} />
                </div>
                <BsFlower asset={bsAsset} strike={bsStrike} endDate={bsEndDate} isYes={orderOutcome === 'YES'} onPriceClick={(cents) => setOrderPrice(String(cents))} />
              </div>
            ) : null;
          })()}

          {/* Live Orderbook + Trades */}
          <div className="sidebar-section">
            <div className="text-xs text-gray-400 mb-2 flex items-center justify-between">
              <span>Live Orderbook</span>
              {/* HIDDEN: Toxic Flow button disabled while polygon RPC is off
              <button
                onClick={() => setToxicDialogOpen(true)}
                className="p-0.5 rounded hover:bg-yellow-400/20 transition-colors"
                title="Toxic Flow Analysis"
              >
                <Biohazard size={14} className="text-yellow-400" />
              </button>
              */}
            </div>
            {obLoading && (
              <div className="w-full h-0.5 bg-gray-700 rounded overflow-hidden mb-2">
                <div className="h-full bg-blue-500 rounded animate-pulse" style={{ width: '100%' }} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-500 mb-1">
                  <span>Bid</span><span className="text-right">Size</span>
                </div>
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {bids.map((bid, i) => {
                    const bp = (parseFloat(bid.price) * 100).toFixed(1);
                    const hl = sidebarUserBidPrices.has(bp) ? 'bg-blue-900/50 font-bold' : '';
                    return (
                      <div key={i} className={`grid grid-cols-2 gap-1 text-[11px] px-1 hover:bg-green-900/30 cursor-pointer ${hl}`}>
                        <span className="live-ob-bid">{bp}¢</span>
                        <span className="text-right text-gray-400">{parseFloat(bid.size).toFixed(0)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-500 mb-1">
                  <span>Ask</span><span className="text-right">Size</span>
                </div>
                <div className="space-y-0.5 max-h-40 overflow-y-auto">
                  {asks.map((ask, i) => {
                    const ap = (parseFloat(ask.price) * 100).toFixed(1);
                    const hl = sidebarUserAskPrices.has(ap) ? 'bg-orange-900/50 font-bold' : '';
                    return (
                      <div key={i} className={`grid grid-cols-2 gap-1 text-[11px] px-1 hover:bg-red-900/30 cursor-pointer ${hl}`}>
                        <span className="live-ob-ask">{ap}¢</span>
                        <span className="text-right text-gray-400">{parseFloat(ask.size).toFixed(0)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* Live Trades */}
          <div className="sidebar-section">
            <div className="text-xs text-gray-400 mb-2">Live Trades</div>
            <div className="grid grid-cols-5 gap-1 text-[10px] text-gray-500 mb-1">
              <span>Price</span><span className="text-right">Side</span><span className="text-right">Size</span><span className="text-right">USD</span><span className="text-right">Time</span>
            </div>
            <div className="space-y-0.5 max-h-32 overflow-y-auto">
              {liveTrades.map((t, i) => {
                const tp = (parseFloat(t.price) * 100).toFixed(1);
                const isBuy = t.side === 'BUY';
                const agoSec = Math.max(0, Math.floor((tradeTickNow - t.timestamp) / 1000));
                const agoStr = agoSec < 60 ? `${agoSec}s` : agoSec < 3600 ? `${Math.floor(agoSec / 60)}m` : agoSec < 86400 ? `${Math.floor(agoSec / 3600)}h` : `${Math.floor(agoSec / 86400)}d`;
                const usdValue = (parseFloat(t.price) * parseFloat(t.size)).toFixed(2);
                return (
                  <div key={i} className="grid grid-cols-5 gap-1 text-[11px] px-1">
                    <span className={isBuy ? 'text-green-400' : 'text-red-400'}>{tp}¢</span>
                    <span className={`text-right text-[9px] ${isBuy ? 'text-green-400' : 'text-red-400'}`}>{isBuy ? 'Buy' : 'Sell'}</span>
                    <span className="text-right text-gray-400">{parseFloat(t.size).toFixed(0)}</span>
                    <span className="text-right text-gray-400">{usdValue}</span>
                    <span className="text-right text-gray-500">{agoStr}</span>
                  </div>
                );
              })}
              {liveTrades.length === 0 && (
                <div className="text-[10px] text-gray-600 px-1">Waiting...</div>
              )}
            </div>
          </div>

          {/* Order Form */}
          <div className="sidebar-section">
            <div className="text-xs text-gray-400 mb-3">Place Order</div>

            {/* BUY/SELL Toggle */}
            <div className="flex gap-2 mb-3">
              <button
                className={`toggle-btn flex-1 ${orderSide === 'BUY' ? 'active' : ''}`}
                onClick={() => setOrderSide('BUY')}
              >BUY</button>
              <button
                className={`toggle-btn flex-1 ${orderSide === 'SELL' ? 'active' : ''}`}
                onClick={() => setOrderSide('SELL')}
              >SELL</button>
            </div>

            {/* YES/NO Toggle (UP/DOWN for Up or Down markets) */}
            <div className="flex gap-2 mb-3">
              <button
                className={`toggle-btn flex-1`}
                style={orderOutcome === 'YES' ? { background: '#10b981', color: 'black' } : undefined}
                onClick={() => setOrderOutcome('YES')}
              >{isUpDownMarket ? 'UP' : 'YES'}</button>
              <button
                className={`toggle-btn flex-1 ${orderOutcome === 'NO' ? 'active' : ''}`}
                style={orderOutcome === 'NO' ? { background: '#ef4444', color: 'black' } : undefined}
                onClick={() => setOrderOutcome('NO')}
              >{isUpDownMarket ? 'DOWN' : 'NO'}</button>
            </div>

            {/* Price Input */}
            <div className="mb-3">
              <label className="text-[10px] text-gray-400 block mb-1">Limit Price (¢)</label>
              <div className="flex gap-1 items-stretch">
                <input
                  type="number"
                  value={orderPrice}
                  onChange={(e) => setOrderPrice(e.target.value)}
                  className="order-input"
                  style={{ width: '50%', flexShrink: 0 }}
                  placeholder="e.g. 50"
                  min={0.1}
                  max={99.9}
                  step={0.1}
                />
                <div style={{ width: '50%', display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '2px' }}>
                  {[0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9].map((d) => (
                    <button
                      key={d}
                      onClick={() => setOrderPriceDecimal(d)}
                      className="bg-gray-700 hover:bg-gray-600 rounded text-[9px] text-gray-300"
                      style={d === 0.1 ? { gridColumn: 'span 2' } : undefined}
                    >
                      .{Math.round(d * 10)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Amount Input */}
            <div className="mb-3">
              <label className="text-[10px] text-gray-400 block mb-1">Amount (shares)</label>
              <div className="flex gap-1 items-stretch">
                <div className="relative" style={{ width: '50%', flexShrink: 0 }}>
                  <input
                    type="number"
                    value={orderAmount}
                    onChange={(e) => setOrderAmount(e.target.value)}
                    className="order-input pr-5 w-full"
                    placeholder="100"
                    min={1}
                    step={1}
                  />
                  <button
                    onClick={() => setOrderAmount('')}
                    className="absolute right-1 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white text-sm px-0.5"
                  >×</button>
                </div>
                {orderSide === 'BUY' ? (
                  <div style={{ width: '50%', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '2px' }}>
                    {[1, 5, 10, 25, 50, 100, 250, 500].map((d) => (
                      <button
                        key={d}
                        onClick={() => setOrderAmountDollar(d)}
                        className={`bg-gray-700 hover:bg-gray-600 rounded text-[9px] ${d === 1 ? 'text-yellow-400' : 'text-green-400'}`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={{ width: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <button
                      onClick={() => {
                        const tokenId = selectedMarket?.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1] || '';
                        const pos = positions.find(p => p.asset === tokenId && p.size > 0);
                        if (pos) setOrderAmount(String(Math.floor(pos.size * 100) / 100));
                      }}
                      className="bg-red-700 hover:bg-red-600 rounded text-xs text-white font-bold px-4 py-1 w-full h-full"
                    >
                      MAX
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Order Summary */}
            <div className="flex gap-1 mb-3 items-stretch">
              <div className="bg-gray-700/50 rounded p-2 text-[10px] text-gray-400 flex flex-col items-center justify-center" style={{ width: '60px', flexShrink: 0 }}>
                <label className="text-[8px] text-gray-500 mb-0.5 flex items-center gap-0.5">
                  T-EXP
                  <span className="relative group cursor-help">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" className="text-gray-500 hover:text-gray-300"><circle cx="8" cy="8" r="7.5" fill="none" stroke="currentColor" strokeWidth="1"/><text x="8" y="12" textAnchor="middle" fontSize="11" fill="currentColor">?</text></svg>
                    <span className="absolute bottom-full left-0 mb-1 hidden group-hover:block bg-gray-900 border border-gray-600 text-gray-200 text-[9px] rounded px-2 py-1 w-40 text-left whitespace-normal z-50 leading-tight">
                      Minutes before market expiration. Order expires at: market end time minus this value.
                    </span>
                  </span>
                </label>
                <input
                  type="number"
                  value={orderExpiry}
                  onChange={(e) => {
                    setOrderExpiry(e.target.value);
                    localStorage.setItem('polymarket-order-expiry', e.target.value);
                  }}
                  className="bg-transparent text-center text-white text-[11px] w-full outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  min={0}
                  step={10}
                />
              </div>
              <div className="bg-gray-700/50 rounded p-2 text-[10px] flex-1 flex flex-col text-gray-400">
                <div className="flex justify-between"><span>Cost:</span><span>Payout:</span></div>
                <div className="flex justify-between items-baseline mt-0.5">
                  <span className="text-red-400 font-bold text-[13px]">${cost.toFixed(2)}</span>
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
                  className={`flex-1 py-2 rounded-lg font-bold text-sm transition ${
                    orderSide === 'BUY' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {isDialogHidden() && signingState.visible && signingState.sign === 'active' ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      Sign in wallet
                    </span>
                  ) : isDialogHidden() && signingState.visible && signingState.submit === 'active' ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                      Submitting...
                    </span>
                  ) : orderSide}
                </button>
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
                  const bestBid = bids.length > 0 ? parseFloat(bids[0].price) : 0;
                  const bestAsk = asks.length > 0 ? parseFloat(asks[0].price) : 0;
                  const currentPrice = outcome === 'YES' ? bestBid : (bestAsk ? (1 - bestAsk) : 0);
                  const currentValue = size * currentPrice;
                  const pnl = currentValue - cost;
                  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
                  const pnlColor = pnl >= 0 ? 'text-green-400' : 'text-red-400';
                  const pnlSign = pnl >= 0 ? '+' : '';
                  return (
                    <div key={i} className="bg-gray-700/30 rounded px-1.5 py-0.5 flex items-center gap-1 text-[12px] whitespace-nowrap">
                      <span className={`${outcomeColor} font-medium`}>{outcomeLabel}</span>
                      <span className="text-gray-300">{Math.floor(size * 100) / 100}</span>
                      <span className="text-gray-500">@</span>
                      <span className="text-yellow-400">{(avg * 100).toFixed(1)}¢</span>
                      <span className="text-gray-400">${currentValue.toFixed(2)}\${cost.toFixed(2)}</span>
                      <span className={pnlColor}>{pnlSign}${Math.abs(Math.round(pnl))} ({pnlSign}{Math.round(pnlPct)}%)</span>
                    </div>
                  );
                })
              )}
            </div>
            <div className="text-xs text-gray-400 mb-2 mt-3">My Orders</div>
            <div className="space-y-1 text-xs">
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
                  const sizeDisplay = filled > 0 ? `${(totalSize - filled).toFixed(2)}\\${totalSize.toFixed(2)}` : totalSize.toFixed(2);

                  const isEditing = editingOrderId === order.id;
                  return (
                    <div key={order.id}>
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
                                      handleReplaceOrder(order.id, newP, order.asset_id || order.token_id || '', order.side as 'BUY' | 'SELL', size);
                                    } else { setEditingOrderId(null); }
                                  }
                                  if (e.key === 'Escape') setEditingOrderId(null);
                                }}
                              />
                              <button
                                onClick={() => {
                                  const newP = parseFloat(editingOrderPrice);
                                  if (newP && newP !== parseFloat((price * 100).toFixed(1))) {
                                    handleReplaceOrder(order.id, newP, order.asset_id || order.token_id || '', order.side as 'BUY' | 'SELL', size);
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
                          {' '}<span className="bg-green-800/50 text-green-400 rounded px-1 py-0 text-[10px] font-medium">${(size * price).toFixed(2)}</span>
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
                      {!isEditing && (
                        <div className="mt-0.5 flex items-center gap-0.5 flex-wrap">
                          {[-10, -5, -2, -1, 1, 2, 5, 10].map((delta) => {
                            const newP = parseFloat((price * 100 + delta).toFixed(1));
                            if (newP < 0.1 || newP > 99.9) return null;
                            return (
                              <button
                                key={delta}
                                onClick={() => {
                                  handleReplaceOrder(order.id, newP, order.asset_id || order.token_id || '', order.side as 'BUY' | 'SELL', size);
                                }}
                                className={`text-[9px] px-1 py-0 rounded ${delta < 0 ? 'bg-red-900/50 text-red-300 hover:bg-red-800/70' : 'bg-green-900/50 text-green-300 hover:bg-green-800/70'}`}
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
                                handleReplaceOrder(order.id, newP, order.asset_id || order.token_id || '', order.side as 'BUY' | 'SELL', size);
                              }
                            }}
                            onTouchEnd={() => {
                              const newP = parseFloat(editingOrderPrice);
                              if (newP && newP !== parseFloat((price * 100).toFixed(1))) {
                                handleReplaceOrder(order.id, newP, order.asset_id || order.token_id || '', order.side as 'BUY' | 'SELL', size);
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
                    </div>
                  );
                })}
              </div>
            </>)}
          </div>


          {/* My Trades */}
          <div className="sidebar-section">
            <div className="text-xs text-gray-400 mb-2">My Trades</div>
            <div className="space-y-1 text-xs max-h-48 overflow-y-auto">
              {myTrades.length === 0 ? (
                <div className="text-gray-600">No trades</div>
              ) : (
                myTrades.slice(0, 20).map((trade, i) => {
                  const outcome = getTokenOutcome(trade.asset_id || trade.token_id || '', marketLookup);
                  const rawPrice = parseFloat(trade.price);
                  const size = parseFloat(trade.size);
                  const isClaim = rawPrice === 0 && !(trade as { side?: string | null }).side;
                  const side = isClaim ? 'CLAIM' : trade.side;
                  const ts = trade.timestamp || trade.created_at || trade.matchTime;
                  return (
                    <div key={i} className="flex justify-between">
                      <span>
                        <span className={side === 'BUY' ? 'text-green-400' : side === 'CLAIM' ? 'text-blue-400' : 'text-red-400'}>{side}</span>
                        {' '}{outcome} {size.toFixed(0)} @{(rawPrice * 100).toFixed(1)}¢
                      </span>
                      <span className="text-gray-600 text-[9px]">
                        {ts ? new Date(ts).toLocaleTimeString() : ''}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      )}
    </div>
    </>
  );
}
