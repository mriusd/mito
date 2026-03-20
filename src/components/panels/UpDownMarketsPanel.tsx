import { useCallback, useState } from 'react';
import { useAppStore } from '../../stores/appStore';
import { HelpTooltip } from '../HelpTooltip';
import type { Market } from '../../types';

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
const TIMEFRAMES = ['5m', '15m', '1h', '24h'] as const;
const ASSET_COLORS: Record<string, string> = {
  BTC: 'text-orange-400',
  ETH: 'text-blue-400',
  SOL: 'text-purple-400',
  XRP: 'text-cyan-400',
};

const THRESHOLD_KEY = 'updown-cheap-threshold';

export function UpDownMarketsPanel() {
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

  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const _bidAskLookup = useAppStore((s) => s.marketLookup);
  useAppStore((s) => s.bidAskTick);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const positions = useAppStore((s) => s.positions);

  // Build position lookup by tokenId
  const positionLookup: Record<string, { size: number }> = {};
  for (const pos of positions) {
    const tid = pos.asset || '';
    const sz = pos.size || 0;
    if (tid && sz > 0) positionLookup[tid] = { size: sz };
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
      <div className="panel-header flex items-center gap-1 mb-2 cursor-grab">
        <h3 className="text-sm font-bold text-yellow-400">Up or Down Markets</h3>
        <div className="ml-auto flex items-center gap-1 cursor-default">
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
      </div>
      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-gray-900">
            <tr>
              <th className="px-2 py-1 text-center text-gray-400 font-bold border-b border-gray-700 bg-gray-900"></th>
              {ASSETS.map((asset) => (
                <th key={asset} className={`px-2 py-1 text-center border-b border-gray-700 bg-gray-900 font-bold ${ASSET_COLORS[asset] || 'text-white'}`}>
                  {asset}
                </th>
              ))}
            </tr>
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
                <td className="px-2 py-1 font-bold text-gray-300 border-b border-gray-700/50 text-center bg-gray-900 whitespace-nowrap relative">
                  {tf}
                  <div className="absolute bottom-0 left-0 h-[2px]" style={{ width: `${tfProgressPct}%`, backgroundColor: 'rgba(6,182,212,0.6)' }} />
                </td>
                {ASSETS.map((asset) => {
                  const market = getCurrentMarket(asset, tf);
                  if (!market) {
                    return <td key={asset} className="px-1 py-1 text-center border-b border-gray-700/50 text-gray-600">-</td>;
                  }

                  const { bestBid, bestAsk } = getLiveBidAsk(market);
                  const tokenIds = market.clobTokenIds || [];
                  const yesTokenId = tokenIds[0] || '';
                  const noTokenId = tokenIds[1] || '';
                  const yesAsk = bestAsk ? (bestAsk * 100).toFixed(1) : '-';
                  const noAsk = bestBid ? ((1 - bestBid) * 100).toFixed(1) : '-';
                  const isSelected = selectedMarket?.id === market.id;
                  const avg = otherAsks(asset);
                  const isCheap = bestAsk !== undefined && avg > 0 && bestAsk <= avg * thresholdFactor;
                  const noAskVal = bestBid ? 1 - bestBid : undefined;
                  const noAvg = otherNoAsks(asset);
                  const isNoCheap = noAskVal !== undefined && noAvg > 0 && noAskVal <= noAvg * thresholdFactor;

                  return (
                    <td
                      key={asset}
                      className={`market-cell px-0.5 py-1 text-center border-b border-gray-700/50 whitespace-nowrap border border-gray-700 relative cursor-pointer hover:brightness-125 ${isSelected ? 'ring-2 ring-blue-500 ring-inset z-10' : ''}`}
                      style={{ minWidth: 60 }}
                      onClick={() => handleCellClick(market)}
                    >
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
                    </td>
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
