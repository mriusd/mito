import { useCallback, useState, Fragment } from 'react';
import { useAppStore } from '../../stores/appStore';
import { HelpTooltip } from '../HelpTooltip';
import type { Market } from '../../types';
import type { AssetSymbol } from '../../types';
import { getMarketProbability } from '../../utils/bsMath';

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

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
const TIMEFRAMES = ['5m', '15m', '1h', '24h'] as const;
const ASSET_COLORS: Record<string, string> = {
  BTC: 'text-orange-400',
  ETH: 'text-blue-400',
  SOL: 'text-purple-400',
  XRP: 'text-cyan-400',
};

const THRESHOLD_KEY = 'updown-cheap-threshold';
const SHOW_TARGET_KEY = 'updown-show-target';

const TARGET_STRIKE_DECIMALS: Record<(typeof ASSETS)[number], number> = {
  BTC: 0,
  ETH: 1,
  SOL: 2,
  XRP: 4,
};

function formatTargetStrikePrice(p: number | undefined | null, fractionDigits: number): string {
  if (p == null || !Number.isFinite(p)) return '-';
  return p.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function strikePriceFromMarket(market: Market, tokenId: string, lookup: Record<string, Market>): number | undefined {
  const p = market.priceToBeat ?? (tokenId ? lookup[tokenId]?.priceToBeat : undefined);
  return p != null && Number.isFinite(p) ? p : undefined;
}

export function UpDownMarketsPanel() {
  const [showTarget, setShowTarget] = useState(() => localStorage.getItem(SHOW_TARGET_KEY) !== 'false');

  const [thresholdStr, setThresholdStr] = useState<string>(() => {
    const saved = localStorage.getItem(THRESHOLD_KEY);
    return saved ?? '10';
  });
  const threshold = parseFloat(thresholdStr) || 0;
  const thresholdFactor = 1 - threshold / 100;

  const handleThresholdChange = (val: string) => {
    setThresholdStr(val);
    const n = parseFloat(val);
    if (!isNaN(n) && n >= 0 && n <= 100) {
      localStorage.setItem(THRESHOLD_KEY, String(n));
    }
  };

  const setShowTargetColumn = (on: boolean) => {
    setShowTarget(on);
    localStorage.setItem(SHOW_TARGET_KEY, on ? 'true' : 'false');
  };

  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const _bidAskLookup = useAppStore((s) => s.marketLookup);
  useAppStore((s) => s.bidAskTick);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const positions = useAppStore((s) => s.positions);
  const orders = useAppStore((s) => s.orders);
  const progOrderMap = useAppStore((s) => s.progOrderMap);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);
  const priceData = useAppStore((s) => s.priceData);

  // Build position lookup by tokenId
  const positionLookup: Record<string, { size: number }> = {};
  for (const pos of positions) {
    const tid = pos.asset || '';
    const sz = pos.size || 0;
    if (tid && sz > 0) positionLookup[tid] = { size: sz };
  }

  // Build order lookup by tokenId (exclude prog orders)
  const orderLookup: Record<string, typeof orders> = {};
  for (const o of orders) {
    if (progOrderMap[o.id]) continue;
    const tid = o.asset_id || o.token_id || '';
    if (!tid) continue;
    if (!orderLookup[tid]) orderLookup[tid] = [];
    orderLookup[tid].push(o);
  }

  const fmtSz = (sz: number) => {
    const v = Math.floor(sz);
    return v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : v.toLocaleString();
  };

  const getLiveBidAsk = (m: Market) => {
    const tid = m.clobTokenIds?.[0];
    const live = tid ? _bidAskLookup[tid] : null;
    return { bestBid: live?.bestBid ?? m.bestBid, bestAsk: live?.bestAsk ?? m.bestAsk };
  };

  const handleCellClick = useCallback((market: Market, outcome: 'YES' | 'NO' = 'YES') => {
    setSelectedMarket(market);
    setSidebarOutcome(outcome);
    setSidebarOpen(true);
  }, [setSelectedMarket, setSidebarOutcome, setSidebarOpen]);

  const now = Date.now();

  // For each asset+timeframe, find the current market
  const getCurrentMarket = (asset: string, tf: string): Market | null => {
    const assetData = upOrDownMarkets[asset] || {};
    const markets = (assetData[tf] || [])
      .filter((m: Market) => !m.closed)
      .sort((a: Market, b: Market) => {
        const ta = a.endDate ? new Date(a.endDate).getTime() : Infinity;
        const tb = b.endDate ? new Date(b.endDate).getTime() : Infinity;
        return ta - tb;
      });
    const currentIdx = markets.findIndex((m: Market) => m.endDate && new Date(m.endDate).getTime() > now);
    if (currentIdx === -1) return null;
    return markets[currentIdx];
  };

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0">
      <div className="panel-header flex items-center gap-2 mb-2 cursor-grab flex-wrap">
        <h3 className="text-sm font-bold text-yellow-400">Up or Down Markets</h3>
        <div className="ml-auto flex items-center gap-3 cursor-default flex-wrap">
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              max={100}
              value={thresholdStr}
              onChange={(e) => handleThresholdChange(e.target.value)}
              className="w-10 bg-gray-700 text-white text-[10px] text-center rounded px-0.5 py-0.5 border border-gray-600 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <span className="text-[10px] text-gray-400">%</span>
            <HelpTooltip text="Highlight bids and asks that are this % cheaper than the average of the other assets in the same timeframe." />
          </div>
          <label
            className="flex items-center gap-1 cursor-default text-[10px] text-gray-300 select-none"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span>Show Target:</span>
            <input
              type="checkbox"
              checked={showTarget}
              onChange={(e) => setShowTargetColumn(e.target.checked)}
              className="accent-blue-500 rounded"
            />
          </label>
        </div>
      </div>
      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-gray-900">
            <tr>
              <th className="px-2 py-1 text-center text-gray-400 font-bold border-b border-r border-gray-700 bg-gray-900" rowSpan={showTarget ? 2 : 1} />
              {ASSETS.map((asset) => (
                <th
                  key={asset}
                  colSpan={showTarget ? 2 : 1}
                  className={`px-2 py-1 text-center border-b border-gray-700 bg-gray-900 font-bold ${ASSET_COLORS[asset] || 'text-white'}`}
                >
                  {asset}
                </th>
              ))}
            </tr>
            {showTarget && (
              <tr>
                {ASSETS.map((asset) => (
                  <Fragment key={asset}>
                    <th className="px-1 py-0.5 text-center border-b border-l border-r border-gray-700 bg-gray-900 text-[9px] text-gray-400 font-semibold">Target</th>
                    <th className="px-1 py-0.5 text-center border-b border-gray-700 bg-gray-900/80 text-[9px] text-gray-400 font-semibold">Market</th>
                  </Fragment>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {TIMEFRAMES.map((tf) => {
              // Pre-compute yes/no ask prices per asset for cheap-detection
              const askByAsset: Record<string, number> = {};
              const noAskByAsset: Record<string, number> = {};
              for (const a of ASSETS) {
                const m = getCurrentMarket(a, tf);
                if (m) {
                  const { bestBid: bb, bestAsk: ba } = getLiveBidAsk(m);
                  if (ba) askByAsset[a] = ba;
                  if (bb) noAskByAsset[a] = 1 - bb;
                }
              }
              const otherAsks = (asset: string) => {
                const vals = ASSETS.filter(a => a !== asset && askByAsset[a] !== undefined).map(a => askByAsset[a]);
                return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
              };
              const otherNoAsks = (asset: string) => {
                const vals = ASSETS.filter(a => a !== asset && noAskByAsset[a] !== undefined).map(a => noAskByAsset[a]);
                return vals.length > 0 ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
              };

              // Progress for this timeframe (use first available market)
              const tfDurations: Record<string, number> = { '5m': 5*60*1000, '15m': 15*60*1000, '1h': 60*60*1000, '24h': 24*60*60*1000 };
              const duration = tfDurations[tf] || 0;
              const firstMarket = ASSETS.map(a => getCurrentMarket(a, tf)).find(m => m !== null);
              const endMs = firstMarket?.endDate ? new Date(firstMarket.endDate).getTime() : 0;
              const startMs = endMs - duration;
              const tfProgress = endMs > 0 && duration > 0 ? Math.max(0, Math.min(1, (now - startMs) / duration)) : 0;
              const tfProgressPct = (tfProgress * 100).toFixed(1);

              return (
              <tr key={tf} className="hover:bg-gray-800/50">
                <td className="px-1 py-1 font-bold text-white border-b border-r border-gray-700 bg-gray-900 whitespace-nowrap relative">
                  <div className="flex items-center justify-between gap-1">
                    <span>{tf}</span>
                    <span className={`text-[8px] font-normal ${endMs > 0 && endMs - now < 60000 ? 'text-red-400' : endMs > 0 && endMs - now < 300000 ? 'text-yellow-400' : 'text-green-400'}`}>{endMs > 0 ? formatCountdown(endMs) : ''}</span>
                  </div>
                  <div className="absolute bottom-0 left-0 h-[2px]" style={{ width: `${tfProgressPct}%`, backgroundColor: 'rgba(6,182,212,0.6)' }} />
                </td>
                {ASSETS.map((asset) => {
                  const market = getCurrentMarket(asset, tf);
                  if (!market) {
                    return (
                      <td
                        key={asset}
                        colSpan={showTarget ? 2 : 1}
                        className="px-1 py-1 text-center border-b border-gray-700/50 text-gray-600"
                      >
                        -
                      </td>
                    );
                  }

                  const { bestBid, bestAsk } = getLiveBidAsk(market);
                  const tokenIds = market.clobTokenIds || [];
                  const yesTokenId = tokenIds[0] || '';
                  const noTokenId = tokenIds[1] || '';
                  const sym = (asset + 'USDT') as AssetSymbol;
                  const livePrice = priceData[sym]?.price;
                  const strikeTarget = strikePriceFromMarket(market, yesTokenId, _bidAskLookup);

                  let mathYesProb: number | null = null;
                  let yesDiff: number | null = null;
                  let noDiff: number | null = null;
                  if (livePrice && strikeTarget !== undefined && market.endDate) {
                    const sigma = (volatilityData[sym] || 0.60) * volMultiplier;
                    const bsYes = getMarketProbability('>' + strikeTarget, livePrice, market.endDate, sigma, bsTimeOffsetHours);
                    if (bsYes !== null) {
                      mathYesProb = bsYes;
                      const bsYesPct = bsYes * 100;
                      const bsNoPct = (1 - bsYes) * 100;
                      if (bestAsk) yesDiff = bestAsk * 100 - bsYesPct;
                      if (bestBid) noDiff = (1 - bestBid) * 100 - bsNoPct;
                    }
                  }

                  const targetCell = showTarget ? (
                    <td
                      key={`${asset}-target`}
                      className={`px-1 py-1 align-middle border-b border-l border-r border-gray-700 text-center text-[9px] whitespace-nowrap ${ASSET_COLORS[asset] || 'text-gray-300'} bg-gray-900/50`}
                    >
                      <div className="flex flex-row items-center justify-center gap-1 leading-none">
                        <span className="font-medium tabular-nums">
                          {formatTargetStrikePrice(strikeTarget, TARGET_STRIKE_DECIMALS[asset])}
                        </span>
                        {mathYesProb !== null && (
                          <div
                            className={`inline-flex h-4 w-9 shrink-0 items-center justify-center rounded px-0.5 text-[8px] font-bold tabular-nums ${
                              mathYesProb > 0.5
                                ? 'bg-green-900/55 text-green-200 border border-green-700/40'
                                : 'bg-red-900/55 text-red-200 border border-red-700/40'
                            }`}
                            title="Math: terminal P(Up) vs target (Binance spot, σ)"
                          >
                            {(mathYesProb * 100).toFixed(0)}%
                          </div>
                        )}
                      </div>
                    </td>
                  ) : null;
                  const yesAsk = bestAsk ? (bestAsk * 100).toFixed(1) : '-';
                  const noAsk = bestBid ? ((1 - bestBid) * 100).toFixed(1) : '-';
                  const yesProb = bestBid || 0;
                  const bgColor = yesProb > 0.5 ? 'bg-green-900/30' : 'bg-red-900/30';
                  const isSelected = selectedMarket?.id === market.id;
                  const avg = otherAsks(asset);
                  const isCheap = bestAsk !== undefined && avg > 0 && bestAsk <= avg * thresholdFactor;
                  const noAskVal = bestBid ? 1 - bestBid : undefined;
                  const noAvg = otherNoAsks(asset);
                  const isNoCheap = noAskVal !== undefined && noAvg > 0 && noAskVal <= noAvg * thresholdFactor;

                  const quoteCell = (
                    <td
                      key={asset}
                      data-market-id={market.id}
                      className={`market-cell px-0.5 py-1 text-center border-b border-gray-700/50 whitespace-nowrap border border-gray-700 relative cursor-pointer hover:brightness-125 ${isSelected ? 'selected ring-2 ring-blue-500 ring-inset z-10' : ''} ${bgColor}`}
                      style={{ minWidth: 60 }}
                      onClick={() => handleCellClick(market)}
                    >
                      {yesDiff !== null && yesDiff < 0 && <span className="absolute left-0 top-0 z-10 text-[7px] leading-none px-[2px] rounded-br-sm font-bold text-black bg-green-400">{yesDiff.toFixed(1)}</span>}
                      {noDiff !== null && noDiff < 0 && <span className="absolute right-0 top-0 z-10 text-[7px] leading-none px-[2px] rounded-bl-sm font-bold text-black bg-green-400">{noDiff.toFixed(1)}</span>}
                      {positionLookup[yesTokenId] && <span className="absolute left-0 top-0 bottom-0 flex items-center px-[4px] text-green-300 text-[8px] bg-green-900/40">{fmtSz(positionLookup[yesTokenId].size)}</span>}
                      {positionLookup[noTokenId] && <span className="absolute right-0 top-0 bottom-0 flex items-center px-[4px] text-red-300 text-[8px] bg-red-900/40">{fmtSz(positionLookup[noTokenId].size)}</span>}
                      <div className="text-[10px] text-gray-400">
                        <span
                          className={`cursor-pointer hover:underline ${isCheap ? 'bg-green-700 text-white font-extrabold rounded px-0.5 text-[11px]' : 'text-green-400'}`}
                          onClick={(e) => { e.stopPropagation(); handleCellClick(market, 'YES'); }}
                        >{yesAsk}</span>
                        {'\\'}
                        <span
                          className={`cursor-pointer hover:underline ${isNoCheap ? 'bg-red-700 text-white font-extrabold rounded px-0.5 text-[11px]' : 'text-red-400'}`}
                          onClick={(e) => { e.stopPropagation(); handleCellClick(market, 'NO'); }}
                        >{noAsk}</span>
                      </div>

                      {/* Order badges - YES bottom-left, NO bottom-right */}
                      {(() => {
                        const yesOrders = orderLookup[yesTokenId] || [];
                        const noOrders = orderLookup[noTokenId] || [];
                        const yesBuy = yesOrders.filter(o => o.side === 'BUY');
                        const yesSell = yesOrders.filter(o => o.side === 'SELL');
                        const noBuy = noOrders.filter(o => o.side === 'BUY');
                        const noSell = noOrders.filter(o => o.side === 'SELL');
                        return <>
                          {yesBuy.length > 0 && <div className="absolute bottom-0 left-0 bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tr-sm">{(Math.max(...yesBuy.map(o => parseFloat(o.price || '0') * 100))).toFixed(1)}</div>}
                          {yesSell.length > 0 && <div className={`absolute ${yesBuy.length > 0 ? 'bottom-[9px]' : 'bottom-0'} left-0 bg-yellow-400 text-[7px] px-[2px] leading-none font-bold rounded-tr-sm`} style={{ color: '#78350f' }}>{(Math.min(...yesSell.map(o => parseFloat(o.price || '0') * 100))).toFixed(1)}</div>}
                          {noBuy.length > 0 && <div className="absolute bottom-0 right-0 bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tl-sm">{(Math.max(...noBuy.map(o => parseFloat(o.price || '0') * 100))).toFixed(1)}</div>}
                          {noSell.length > 0 && <div className={`absolute ${noBuy.length > 0 ? 'bottom-[9px]' : 'bottom-0'} right-0 bg-yellow-400 text-[7px] px-[2px] leading-none font-bold rounded-tl-sm`} style={{ color: '#78350f' }}>{(Math.min(...noSell.map(o => parseFloat(o.price || '0') * 100))).toFixed(1)}</div>}
                        </>;
                      })()}
                    </td>
                  );

                  return (
                    <Fragment key={asset}>
                      {targetCell}
                      {quoteCell}
                    </Fragment>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
