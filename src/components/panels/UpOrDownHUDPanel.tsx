import { useEffect, useMemo, useState } from 'react';
import { CirclePercent, Minus, Triangle } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import type { AssetName, AssetSymbol, Market } from '../../types';
import { ASSET_COLORS } from '../../types';
import { assetToSymbol, formatPolymarketVolumeK, formatPrice, getPolymarketVolumeUsd } from '../../utils/format';
import { outcomeMidOrOneSideProb } from '../../lib/outcomeQuote';
import { BinanceChartPanel } from './BinanceChartPanel';
import { MarketCellMidRow } from './MarketCellMidRow';
import { useChainlinkPricesMap } from '../../hooks/usePolymarketPrice';
import { getMarketProbability } from '../../utils/bsMath';

const ASSETS: AssetName[] = ['BTC', 'ETH', 'SOL', 'XRP'];
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '24h'] as const;
const TF_DURATIONS_MS: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};
const EXPIRY_BAR_BG = 'rgba(6, 182, 212, 0.6)';
const MATH_PROB_NEUTRAL_BAND = 1;
const MATH_VS_BID_NEUTRAL_PCT = 5;
const MATH_VS_BID_FLASH_REL = 0.30;
const TARGET_STRIKE_DECIMALS: Record<AssetName, number> = { BTC: 0, ETH: 1, SOL: 2, XRP: 4 };

function formatCountdown(ms: number): string {
  const rem = ms - Date.now();
  if (rem <= 0) return '0s';
  const sec = Math.floor(rem / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}
function expiryProgress(nowMs: number, endMs: number, durationMs: number): number {
  if (endMs <= 0 || durationMs <= 0) return 0;
  const startMs = endMs - durationMs;
  return Math.max(0, Math.min(1, (nowMs - startMs) / durationMs));
}
function formatBadgePriceCents(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function getCurrentAndNext(assetMarkets: Record<string, Market[]>, tf: string): { current: Market | null; next: Market | null } {
  const now = Date.now();
  const markets = (assetMarkets[tf] || [])
    .filter((m) => !m.closed)
    .sort((a, b) => {
      const ta = a.endDate ? new Date(a.endDate).getTime() : Infinity;
      const tb = b.endDate ? new Date(b.endDate).getTime() : Infinity;
      return ta - tb;
    });
  const currentIdx = markets.findIndex((m) => m.endDate && new Date(m.endDate).getTime() > now);
  if (currentIdx < 0) return { current: null, next: null };
  return { current: markets[currentIdx], next: markets[currentIdx + 1] || null };
}

export function UpOrDownHUDPanel({ panelId }: { panelId: string }) {
  const [asset, setAsset] = useState<AssetName>(() => {
    const saved = localStorage.getItem(`polybot-updown-hud-asset-${panelId}`);
    if (saved && ASSETS.includes(saved as AssetName)) return saved as AssetName;
    return 'BTC';
  });
  const [assetDropdownOpen, setAssetDropdownOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const marketLookup = useAppStore((s) => s.marketLookup);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const sidebarOutcome = useAppStore((s) => s.sidebarOutcome);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const positions = useAppStore((s) => s.positions);
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const onchainGridPositions = useAppStore((s) => s.onchainGridPositions);
  const orders = useAppStore((s) => s.orders);
  const progOrderMap = useAppStore((s) => s.progOrderMap) as Record<string, number>;
  const priceData = useAppStore((s) => s.priceData);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);
  const chainlinkPrices = useChainlinkPricesMap();

  const sym = assetToSymbol(asset) as AssetSymbol;
  const livePrice = priceData[sym]?.price ?? 0;
  const clPrice = chainlinkPrices[asset];
  const headerPrice = (clPrice && clPrice > 0) ? clPrice : livePrice;
  const titleColor = ASSET_COLORS[asset] || 'text-white';
  const assetMarkets = upOrDownMarkets[asset] || {};
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    localStorage.setItem(`polybot-updown-hud-asset-${panelId}`, asset);
  }, [panelId, asset]);

  const rows = useMemo(() => {
    return TIMEFRAMES.map((tf) => {
      const { current, next } = getCurrentAndNext(assetMarkets, tf);
      const yesToken = current?.clobTokenIds?.[0] || '';
      const currentYes = current ? outcomeMidOrOneSideProb(yesToken, marketLookup, { bestBid: current.bestBid, bestAsk: current.bestAsk }) : null;
      const nextYesToken = next?.clobTokenIds?.[0] || '';
      const nextYes = next ? outcomeMidOrOneSideProb(nextYesToken, marketLookup, { bestBid: next.bestBid, bestAsk: next.bestAsk }) : null;
      return { tf, current, next, currentYes, nextYes };
    });
  }, [assetMarkets, marketLookup]);

  const selectedMarketInPanel = useMemo(() => {
    const id = selectedMarket?.id;
    if (!id) return false;
    return rows.some((r) => r.current?.id === id || r.next?.id === id);
  }, [selectedMarket?.id, rows]);
  const selectedMarketTf = useMemo(() => {
    const id = selectedMarket?.id;
    if (!id) return null;
    const hit = rows.find((r) => r.current?.id === id || r.next?.id === id);
    return hit?.tf ?? null;
  }, [selectedMarket?.id, rows]);
  const highlightLeftChart = selectedMarketTf === '5m' || selectedMarketTf === '15m';
  const highlightRightChart = selectedMarketTf === '1h' || selectedMarketTf === '4h' || selectedMarketTf === '24h';
  const chartSideHighlightClass =
    sidebarOutcome === 'NO'
      ? 'ring-2 ring-red-500 shadow-[0_0_12px_rgba(239,68,68,0.65),0_0_24px_rgba(220,38,38,0.30)]'
      : 'ring-2 ring-green-500 shadow-[0_0_12px_rgba(34,197,94,0.65),0_0_24px_rgba(22,163,74,0.30)]';

  const positionTokenIds = useMemo(() => {
    const s = new Set<string>();
    if (liveTradesSource === 'onchain') {
      for (const p of onchainGridPositions) {
        if (p.tokenId && p.size > 0) s.add(p.tokenId);
      }
      return s;
    }
    for (const pos of positions) {
      const tid = pos.asset || '';
      if (tid && (pos.size || 0) > 0) s.add(tid);
    }
    return s;
  }, [liveTradesSource, onchainGridPositions, positions]);
  const orderLookup: Record<string, typeof orders> = {};
  for (const o of orders) {
    if (progOrderMap[o.id]) continue;
    const tid = o.asset_id || o.token_id || '';
    if (!tid) continue;
    if (!orderLookup[tid]) orderLookup[tid] = [];
    orderLookup[tid].push(o);
  }

  const openMarket = (m: Market, side: 'YES' | 'NO') => {
    setSelectedMarket(m);
    setSidebarOutcome(side);
    setSidebarOpen(true);
  };

  return (
    <div
      className={`panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0 h-full gap-2 ${
        selectedMarketInPanel
          ? 'ring-2 ring-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.65),0_0_28px_rgba(37,99,235,0.35)] z-[1]'
          : ''
      }`}
    >
      <div className="panel-header flex items-center gap-2 cursor-grab">
        <h3 className={`text-sm font-bold ${titleColor}`}>
          <span
            className="relative no-drag inline-flex items-center cursor-pointer select-none"
            onClick={() => setAssetDropdownOpen((v) => !v)}
          >
            {asset}: {headerPrice > 0 ? formatPrice(headerPrice, asset) : '--'}
            <svg className="w-3 h-3 ml-0.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="6 9 12 15 18 9" />
            </svg>
            {assetDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-50 min-w-[80px]">
                {ASSETS.map((a) => (
                  <div
                    key={a}
                    className={`px-3 py-1 text-xs font-bold hover:bg-gray-700 cursor-pointer ${a === asset ? 'text-white bg-gray-700' : 'text-gray-300'}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setAsset(a);
                      setAssetDropdownOpen(false);
                    }}
                  >
                    {a}
                  </div>
                ))}
              </div>
            )}
          </span>
          <span className="text-gray-400 font-normal ml-2">UpOrDown HUD</span>
        </h3>
      </div>

      <div className="overflow-x-auto overflow-y-auto border border-gray-700/70 rounded">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-gray-900">
            <tr>
              <th className="px-2 py-1 text-center text-gray-400 font-bold border-b border-r border-gray-700 bg-gray-900">TF</th>
              <th className="px-1 py-0.5 text-center border-b border-r border-l border-gray-700 border-solid bg-gray-900 text-[9px] text-gray-400 font-semibold">Target</th>
              <th className="px-1 py-0.5 text-center border-b border-l border-r border-gray-700 border-solid bg-gray-900/80 text-[9px] text-gray-400 font-semibold">Current</th>
              <th className="px-1 py-0.5 text-center border-b border-l border-r border-gray-700 border-solid bg-gray-900/70 text-[9px] text-gray-400 font-semibold">Next</th>
              <th className="px-1 py-0.5 text-right border-b border-l border-r border-gray-700 border-solid bg-gray-900/40 text-[9px] text-sky-400/90 font-semibold" title="Toxic Flow USDC (wallet usdc_in), thousands">
                Vol
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ tf, current, next, currentYes, nextYes }) => {
              const duration = TF_DURATIONS_MS[tf] || 0;
              const endMs = current?.endDate ? new Date(current.endDate).getTime() : 0;
              const tfProgress = expiryProgress(now, endMs, duration);
              const volYesToken = current?.clobTokenIds?.[0] || '';
              const polymarketVol =
                current && volYesToken ? getPolymarketVolumeUsd(current, volYesToken, marketLookup) : null;
              return (
                <tr key={tf} className="hover:bg-gray-800/50">
                  <td className="px-1 py-1 font-bold text-white border-b border-r border-gray-700 whitespace-nowrap relative bg-gray-900">
                    <div className="flex items-center justify-between gap-1">
                      <span>{tf}</span>
                      <span className={`text-[8px] font-normal ${endMs > 0 && endMs - now < 60000 ? 'text-red-400' : endMs > 0 && endMs - now < 300000 ? 'text-yellow-400' : 'text-green-400'}`}>
                        {endMs > 0 ? formatCountdown(endMs) : ''}
                      </span>
                    </div>
                    {endMs > 0 && duration > 0 && (
                      <div className="absolute bottom-0 left-0 z-0 h-[2px] pointer-events-none" style={{ width: `${(tfProgress * 100).toFixed(1)}%`, backgroundColor: EXPIRY_BAR_BG }} />
                    )}
                  </td>
                  {(() => {
                    const sym = assetToSymbol(asset) as AssetSymbol;
                    const yesTokenId = current?.clobTokenIds?.[0] || '';
                    const liveEntry = yesTokenId ? marketLookup[yesTokenId] : undefined;
                    const bestBid = liveEntry?.bestBid ?? current?.bestBid;
                    const cl = chainlinkPrices[asset];
                    const binanceSpot = priceData[sym]?.price;
                    const preferChainlink = tf === '5m' || tf === '15m';
                    const liveSpot = preferChainlink
                      ? (cl != null && cl > 0 ? cl : (binanceSpot != null && binanceSpot > 0 ? binanceSpot : undefined))
                      : (binanceSpot != null && binanceSpot > 0 ? binanceSpot : undefined);
                    const strike = current?.priceToBeat;
                    let mathYesProb: number | null = null;
                    if (liveSpot != null && liveSpot > 0 && strike != null && current?.endDate) {
                      const sigma = (volatilityData[sym] || 0.6) * volMultiplier;
                      const p = getMarketProbability('>' + strike, liveSpot, current.endDate, sigma, bsTimeOffsetHours);
                      if (p != null) mathYesProb = p;
                    }
                    let bidVsMath: 'bidAbove' | 'bidBelow' | 'tie' | null = null;
                    let triangleBadgeFlash = false;
                    if (mathYesProb !== null && bestBid != null && Number.isFinite(bestBid)) {
                      const gapPts = Math.abs(bestBid * 100 - mathYesProb * 100);
                      const d = bestBid - mathYesProb;
                      if (gapPts <= MATH_VS_BID_NEUTRAL_PCT) bidVsMath = 'tie';
                      else if (d > 0) bidVsMath = 'bidAbove';
                      else bidVsMath = 'bidBelow';
                      const flashDenom = Math.max(mathYesProb, 1e-9);
                      triangleBadgeFlash = Math.abs(bestBid - mathYesProb) / flashDenom >= MATH_VS_BID_FLASH_REL;
                    }
                    const mathPctRounded = mathYesProb !== null ? Math.round(mathYesProb * 100) : null;
                    const mathProbNeutral =
                      mathPctRounded !== null &&
                      mathPctRounded >= 50 - MATH_PROB_NEUTRAL_BAND &&
                      mathPctRounded <= 50 + MATH_PROB_NEUTRAL_BAND;
                    const mathBadgeColorClass =
                      mathPctRounded === null
                        ? 'bg-gray-800/70 text-gray-300 border border-gray-600/50'
                        : mathProbNeutral
                          ? 'bg-gray-800/40 text-gray-300/90 border border-gray-500/30'
                          : mathPctRounded > 50
                            ? 'bg-green-900/55 text-green-200 border border-green-700/40'
                            : 'bg-red-900/55 text-red-200 border border-red-700/40';
                    const wbUsdc =
                      typeof liveEntry?.winnerBias === 'number' && Number.isFinite(liveEntry.winnerBias)
                        ? liveEntry.winnerBias
                        : 0;
                    const wbPct = Math.max(2, Math.min(98, 50 + wbUsdc * 50));
                    const winnerBiasBarFlash = wbPct > 60 || wbPct < 40;
                    return (
                      <>
                        <td className="px-1 py-1 align-middle border-l border-r border-solid border-gray-700 text-center text-[9px] whitespace-nowrap text-gray-300 bg-gray-900/50 border-b border-gray-700/50">
                          <div className="flex flex-row items-center justify-center gap-1 leading-none">
                            <span className={`font-medium tabular-nums ${titleColor}`}>
                              {strike != null ? strike.toLocaleString(undefined, { minimumFractionDigits: TARGET_STRIKE_DECIMALS[asset], maximumFractionDigits: TARGET_STRIKE_DECIMALS[asset] }) : '-'}
                            </span>
                            {mathYesProb !== null && (
                              <div className="inline-flex items-center gap-0.5 shrink-0">
                                <div className={`inline-flex h-4 min-w-[2.75rem] shrink-0 items-center justify-center gap-0.5 rounded px-1 text-[8px] font-bold tabular-nums ${mathBadgeColorClass}`}>
                                  <CirclePercent className="h-2.5 w-2.5 shrink-0 opacity-90" strokeWidth={2.5} aria-hidden />
                                  <span>{(mathYesProb * 100).toFixed(0)}</span>
                                </div>
                                {bidVsMath !== null && (
                                  <div
                                    className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                      bidVsMath === 'bidAbove'
                                        ? 'bg-green-900/65 border-green-600/45 text-green-100'
                                        : bidVsMath === 'bidBelow'
                                          ? 'bg-red-900/65 border-red-600/45 text-red-100'
                                          : 'bg-gray-800/40 border-gray-500/30 text-gray-300/90'
                                    } ${triangleBadgeFlash && bidVsMath !== 'tie' ? 'updown-triangle-badge-flash' : ''}`}
                                  >
                                    {bidVsMath === 'bidAbove' && <Triangle className="h-2.5 w-2.5 fill-current stroke-current" strokeWidth={1.5} aria-hidden />}
                                    {bidVsMath === 'bidBelow' && <Triangle className="h-2.5 w-2.5 rotate-180 fill-current stroke-current" strokeWidth={1.5} aria-hidden />}
                                    {bidVsMath === 'tie' && <Minus className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                        <td
                          className={`px-0.5 py-1 text-center whitespace-nowrap border-l border-r border-solid border-gray-700 relative cursor-pointer hover:brightness-125 border-b border-gray-700/50 ${
                            selectedMarket?.id === current?.id ? 'bg-purple-600/35 z-10' : ''
                          }`}
                        >
                          {current && positionTokenIds.has(current.clobTokenIds?.[0] || '') && (
                            <span
                              className="absolute left-0.5 top-0.5 z-10 h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_3px_rgba(52,211,153,0.8)]"
                              title={liveTradesSource === 'onchain' ? 'YES position (on-chain)' : 'YES position'}
                            />
                          )}
                          {current && positionTokenIds.has(current.clobTokenIds?.[1] || '') && (
                            <span
                              className="absolute right-0.5 top-0.5 z-10 h-1.5 w-1.5 rounded-full bg-rose-400 shadow-[0_0_3px_rgba(251,113,133,0.8)]"
                              title={liveTradesSource === 'onchain' ? 'NO position (on-chain)' : 'NO position'}
                            />
                          )}
                          {current ? (
                            <MarketCellMidRow
                              className="text-[9px] text-gray-400"
                              left={
                                <span className="text-green-400 cursor-pointer hover:underline" onClick={() => openMarket(current, 'YES')}>
                                  {currentYes != null ? (currentYes * 100).toFixed(1) : '-'}
                                </span>
                              }
                              right={
                                <span className="text-red-400 cursor-pointer hover:underline" onClick={() => openMarket(current, 'NO')}>
                                  {currentYes != null ? (100 - currentYes * 100).toFixed(1) : '-'}
                                </span>
                              }
                            />
                          ) : (
                            <span className="text-gray-600">-</span>
                          )}
                          {(() => {
                            if (!current) return null;
                            const yesTokenId = current.clobTokenIds?.[0] || '';
                            const noTokenId = current.clobTokenIds?.[1] || '';
                            const yesOrders = orderLookup[yesTokenId] || [];
                            const noOrders = orderLookup[noTokenId] || [];
                            const yesBuy = yesOrders.filter(o => o.side === 'BUY');
                            const yesSell = yesOrders.filter(o => o.side === 'SELL');
                            const noBuy = noOrders.filter(o => o.side === 'BUY');
                            const noSell = noOrders.filter(o => o.side === 'SELL');
                            const liveRow = yesTokenId ? marketLookup[yesTokenId] : undefined;
                            const concRaw =
                              typeof liveRow?.concentration === 'number' && Number.isFinite(liveRow.concentration)
                                ? liveRow.concentration
                                : 0;
                            const concPct = Math.max(0, Math.min(100, concRaw * 100));
                            const cR = Math.round(Math.min(255, concRaw * 2 * 255));
                            const cG = Math.round(Math.min(255, (1 - concRaw) * 2 * 255));
                            const concColor = `rgb(${cR}, ${cG}, 0)`;
                            return (
                              <>
                                {yesBuy.length > 0 && (
                                  <div className="absolute bottom-0 left-0 bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tr-sm">
                                    {formatBadgePriceCents(Math.max(...yesBuy.map(o => parseFloat(o.price || '0') * 100)))}
                                  </div>
                                )}
                                {yesSell.length > 0 && (
                                  <div
                                    className={`absolute left-0 bg-yellow-400 text-[7px] px-[2px] leading-none font-bold rounded-tr-sm ${yesBuy.length > 0 ? 'bottom-[9px]' : 'bottom-0'}`}
                                    style={{ color: '#78350f' }}
                                  >
                                    {formatBadgePriceCents(Math.min(...yesSell.map(o => parseFloat(o.price || '0') * 100)))}
                                  </div>
                                )}
                                {noBuy.length > 0 && (
                                  <div className="absolute bottom-0 right-0 bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tl-sm">
                                    {formatBadgePriceCents(Math.max(...noBuy.map(o => parseFloat(o.price || '0') * 100)))}
                                  </div>
                                )}
                                {noSell.length > 0 && (
                                  <div
                                    className={`absolute right-0 bg-yellow-400 text-[7px] px-[2px] leading-none font-bold rounded-tl-sm ${noBuy.length > 0 ? 'bottom-[9px]' : 'bottom-0'}`}
                                    style={{ color: '#78350f' }}
                                  >
                                    {formatBadgePriceCents(Math.min(...noSell.map(o => parseFloat(o.price || '0') * 100)))}
                                  </div>
                                )}
                                {/* Concentration — left vertical bar, grows upward */}
                                <div
                                  className="absolute left-0 bottom-0 w-[2px] pointer-events-none z-0 bg-gray-800/80 overflow-hidden"
                                  style={{ height: '100%' }}
                                  title={`Concentration (top wallets): ${concPct.toFixed(0)}%`}
                                >
                                  <div
                                    className="absolute bottom-0 left-0 w-full transition-all"
                                    style={{ height: `${concPct}%`, backgroundColor: concColor }}
                                  />
                                </div>
                                {/* Winners $ (USDC bias) — horizontal bottom of market cell (outer stripe) */}
                                <div
                                  className={`absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none z-0 flex${winnerBiasBarFlash ? ' updown-winner-bias-bar-flash' : ''}`}
                                  title={`Winners $ (USDC bias, top 30%): ${(wbUsdc * 100).toFixed(0)}%`}
                                >
                                  <div className="bg-cyan-400/75 h-full shrink-0 transition-[width]" style={{ width: `${wbPct}%` }} />
                                  <div className="bg-pink-400/75 h-full flex-1 min-w-0" />
                                </div>
                              </>
                            );
                          })()}
                        </td>
                      </>
                    );
                  })()}
                  <td
                    className={`px-1 py-1 text-center border-l border-r border-solid border-gray-700 text-[10px] whitespace-nowrap cursor-pointer hover:brightness-125 relative border-b border-gray-700/50 ${
                      selectedMarket?.id === next?.id ? 'bg-purple-600/35 z-10' : 'bg-gray-900/30'
                    }`}
                  >
                    {next ? (
                      <MarketCellMidRow
                        className="text-gray-400"
                        left={
                          <span className="text-green-400 cursor-pointer hover:underline" onClick={() => openMarket(next, 'YES')}>
                            {nextYes != null ? (nextYes * 100).toFixed(1) : '-'}
                          </span>
                        }
                        right={
                          <span className="text-red-400 cursor-pointer hover:underline" onClick={() => openMarket(next, 'NO')}>
                            {nextYes != null ? (100 - nextYes * 100).toFixed(1) : '-'}
                          </span>
                        }
                      />
                    ) : (
                      <span className="text-gray-600">-</span>
                    )}
                    {next?.endDate && duration > 0 && (
                      <div
                        className="absolute bottom-0 left-0 z-0 h-[2px] pointer-events-none"
                        style={{ width: `${(expiryProgress(now, new Date(next.endDate).getTime(), duration) * 100).toFixed(1)}%`, backgroundColor: EXPIRY_BAR_BG }}
                      />
                    )}
                  </td>
                  <td
                    className="px-1 py-1 text-right border-l border-r border-solid border-gray-700 bg-gray-900/40 text-sky-300/95 font-bold tabular-nums text-[9px] whitespace-nowrap border-b border-gray-700/50 align-middle"
                    title="Toxic Flow USDC volume (wallet_positions usdc_in), shown in thousands"
                  >
                    {formatPolymarketVolumeK(polymarketVol)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-2 gap-2 min-h-0 flex-1">
        <div
          className={`min-h-0 rounded ${
            highlightLeftChart
              ? chartSideHighlightClass
              : ''
          }`}
        >
          <BinanceChartPanel
            panelId={`${panelId}-chainlink`}
            initialAsset={asset}
            assetOverride={asset}
            forcedPriceSource="chainlink"
            compact
            hideRbsSettings
            hudGateSupportLinesByExchange
            hudSyncIntervalFromMarket
          />
        </div>
        <div
          className={`min-h-0 rounded ${
            highlightRightChart
              ? chartSideHighlightClass
              : ''
          }`}
        >
          <BinanceChartPanel
            panelId={`${panelId}-binance`}
            initialAsset={asset}
            assetOverride={asset}
            forcedPriceSource="binance"
            compact
            hideRbsSettings
            hudGateSupportLinesByExchange
            hudSyncIntervalFromMarket
          />
        </div>
      </div>
    </div>
  );
}

