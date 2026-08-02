import { useCallback, useMemo, useState, memo, Fragment } from 'react';
import type { CSSProperties } from 'react';
import { useAppStore } from '../../stores/appStore';
import { HelpTooltip } from '../HelpTooltip';
import type { Market, AssetSymbol } from '../../types';
import { getPositionClobTokenId, normalizeClobTokenId } from '../../utils/format';
import {
  useThrottledGridOrders,
  useThrottledGridPositions,
  useThrottledOnchainGridPositions,
} from '../../hooks/useThrottledGridWallet';
import { GRID_BID_ASK_THROTTLE_MS } from '../../lib/bidAskMarketLookup';
import { UpDownTimeframeRowsBody } from './UpDownTimeframeRow';
import { useUpDownNextMarketFlashWhaleSound } from '../../lib/upDownNextMarketFlashSound';

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '24h'] as const;
const ASSET_COLORS: Record<string, string> = {
  BTC: 'text-orange-400',
  ETH: 'text-blue-400',
  SOL: 'text-purple-400',
  XRP: 'text-cyan-400',
};

const ASSET_BORDER_COLOR: Record<(typeof ASSETS)[number], string> = {
  BTC: 'rgba(251, 146, 60, 0.9)',
  ETH: 'rgba(96, 165, 250, 0.9)',
  SOL: 'rgba(192, 132, 252, 0.9)',
  XRP: 'rgba(34, 211, 238, 0.9)',
};

function assetBorderStyle(
  asset: (typeof ASSETS)[number],
  sides: { L?: boolean; R?: boolean; B?: boolean },
): CSSProperties {
  const c = ASSET_BORDER_COLOR[asset];
  const s: CSSProperties = {};
  if (sides.L) s.borderLeftColor = c;
  if (sides.R) s.borderRightColor = c;
  if (sides.B) s.borderBottomColor = c;
  return s;
}

const NEXT_MARKETS_COUNT_KEY = 'updown-next-markets-count';
const ASSET_VISIBILITY_KEY = 'updown-panel-asset-visibility';
const SHOW_TARGET_KEY = 'updown-show-target';
const SHOW_TARGET_PROB_KEY = 'updown-show-target-prob';

type AssetVisibility = Record<(typeof ASSETS)[number], boolean>;

function allAssetsVisible(): AssetVisibility {
  return { BTC: true, ETH: true, SOL: true, XRP: true };
}

function readAssetVisibility(): AssetVisibility {
  try {
    const raw = localStorage.getItem(ASSET_VISIBILITY_KEY);
    if (!raw) return allAssetsVisible();
    const o = JSON.parse(raw) as Partial<AssetVisibility>;
    const out = allAssetsVisible();
    for (const a of ASSETS) {
      if (o[a] === false) out[a] = false;
    }
    if (!ASSETS.some((a) => out[a])) return allAssetsVisible();
    return out;
  } catch {
    return allAssetsVisible();
  }
}

function persistAssetVisibility(v: AssetVisibility) {
  try {
    localStorage.setItem(ASSET_VISIBILITY_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

function UpDownMarketsPanelInner() {
  const [showTarget, setShowTarget] = useState(() => localStorage.getItem(SHOW_TARGET_KEY) !== 'false');
  const [showTargetProb, setShowTargetProb] = useState(() => localStorage.getItem(SHOW_TARGET_PROB_KEY) !== 'false');
  const [nextMarketsCountStr, setNextMarketsCountStr] = useState<string>(
    () => localStorage.getItem(NEXT_MARKETS_COUNT_KEY) ?? '1',
  );
  const [assetVisible, setAssetVisible] = useState<AssetVisibility>(() => readAssetVisibility());

  const nextMarketsCount = Math.max(1, Math.min(20, Math.trunc(Number.parseInt(nextMarketsCountStr, 10)) || 1));

  const handleNextMarketsCountChange = (val: string) => {
    setNextMarketsCountStr(val);
    const n = Number.parseInt(val, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 20) {
      localStorage.setItem(NEXT_MARKETS_COUNT_KEY, String(n));
    }
  };

  const toggleAssetVisible = (asset: (typeof ASSETS)[number]) => {
    setAssetVisible((prev) => {
      const flipped = !prev[asset];
      const next = { ...prev, [asset]: flipped };
      if (!ASSETS.some((a) => next[a])) return prev;
      persistAssetVisibility(next);
      return next;
    });
  };

  const visibleAssets = useMemo(
    (): (typeof ASSETS)[number][] => ASSETS.filter((a) => assetVisible[a]),
    [assetVisible],
  );

  const setShowTargetColumn = (on: boolean) => {
    setShowTarget(on);
    localStorage.setItem(SHOW_TARGET_KEY, on ? 'true' : 'false');
  };

  const setShowTargetProbColumn = (on: boolean) => {
    setShowTargetProb(on);
    localStorage.setItem(SHOW_TARGET_PROB_KEY, on ? 'true' : 'false');
  };

  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const selectedMarketKey = useAppStore((s) => s.selectedMarketKey);
  const selectedMarketId = useAppStore((s) => s.selectedMarket?.id ?? '');
  const selectedMarketHighlightId = selectedMarketKey || selectedMarketId;
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const positions = useThrottledGridPositions(GRID_BID_ASK_THROTTLE_MS);
  const onchainGridPositions = useThrottledOnchainGridPositions(GRID_BID_ASK_THROTTLE_MS);
  const orders = useThrottledGridOrders(GRID_BID_ASK_THROTTLE_MS);
  const progOrderMap = useAppStore((s) => s.progOrderMap);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volBySym = useMemo((): Record<AssetSymbol, number> => {
    const out = {} as Record<AssetSymbol, number>;
    for (const sym of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'WTIUSDT', 'NGUSDT', 'SPYUSDT', 'AAPLUSDT', 'GOOGLUSDT', 'NVDAUSDT', 'AMZNUSDT'] as AssetSymbol[]) {
      out[sym] = volatilityData[sym] ?? 0.6;
    }
    return out;
  }, [volatilityData]);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);

  const positionTokenIds = useMemo(() => {
    const s = new Set<string>();
    if (liveTradesSource === 'onchain') {
      for (const p of onchainGridPositions) {
        const k = normalizeClobTokenId(p.tokenId);
        if (k && Math.abs(p.size) > 1e-9) s.add(k);
      }
      return s;
    }
    for (const pos of positions) {
      const k = normalizeClobTokenId(getPositionClobTokenId(pos));
      if (k && (pos.size || 0) > 0) s.add(k);
    }
    return s;
  }, [liveTradesSource, onchainGridPositions, positions]);

  const orderLookup = useMemo(() => {
    const lookup: Record<string, typeof orders> = {};
    for (const o of orders) {
      if (progOrderMap[o.id]) continue;
      const tid = o.asset_id || o.token_id || '';
      if (!tid) continue;
      if (!lookup[tid]) lookup[tid] = [];
      lookup[tid].push(o);
    }
    return lookup;
  }, [orders, progOrderMap]);

  const handleCellClick = useCallback((market: Market, outcome: 'YES' | 'NO' = 'YES') => {
    setSelectedMarket(market);
    setSidebarOutcome(outcome);
    setSidebarOpen(true);
  }, [setSelectedMarket, setSidebarOutcome, setSidebarOpen]);

  const sortedOpenByAssetTf = useMemo(() => {
    const out: Partial<Record<(typeof ASSETS)[number], Partial<Record<(typeof TIMEFRAMES)[number], Market[]>>>> = {};
    for (const asset of visibleAssets) {
      out[asset] = {};
      for (const tf of TIMEFRAMES) {
        out[asset]![tf] = ((upOrDownMarkets[asset] || {})[tf] || [])
          .filter((m: Market) => !m.closed)
          .sort((a: Market, b: Market) => {
            const ta = a.endDate ? new Date(a.endDate).getTime() : Infinity;
            const tb = b.endDate ? new Date(b.endDate).getTime() : Infinity;
            return ta - tb;
          });
      }
    }
    return out;
  }, [upOrDownMarkets, visibleAssets]);

  const colsPerAsset = (showTarget ? 1 : 0) + 1 + nextMarketsCount;

  useUpDownNextMarketFlashWhaleSound(sortedOpenByAssetTf, visibleAssets, nextMarketsCount);

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0 h-full overflow-hidden">
      <div className="panel-header flex items-center gap-2 mb-2 cursor-grab flex-wrap">
        <h3 className="text-sm font-bold text-yellow-400">Up or Down Markets</h3>
        <div className="ml-auto flex items-center gap-3 cursor-default flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400 whitespace-nowrap">Next markets</span>
            <input
              type="number"
              min={1}
              max={20}
              value={nextMarketsCountStr}
              onChange={(e) => handleNextMarketsCountChange(e.target.value)}
              className="w-9 bg-gray-700 text-white text-[10px] text-center rounded px-0.5 py-0.5 border border-gray-600 focus:outline-none focus:border-blue-500 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            />
            <HelpTooltip text="How many upcoming windows to show after Current (nearest first). 1–20." />
          </div>
          <div className="flex items-center gap-2">
            {ASSETS.map((asset) => (
              <label
                key={asset}
                className="flex items-center gap-0.5 cursor-default text-[10px] select-none"
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={assetVisible[asset]}
                  onChange={() => toggleAssetVisible(asset)}
                  className="accent-blue-500 rounded"
                />
                <span className={`font-bold ${ASSET_COLORS[asset] || 'text-white'}`}>{asset}</span>
              </label>
            ))}
          </div>
          <label
            className="flex items-center gap-1 cursor-default text-[10px] text-gray-300 select-none"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={showTarget}
              onChange={(e) => setShowTargetColumn(e.target.checked)}
              className="accent-blue-500 rounded"
            />
            <span>Show Target</span>
          </label>
          <label
            className="flex items-center gap-1 cursor-default text-[10px] text-gray-300 select-none"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={showTargetProb}
              onChange={(e) => setShowTargetProbColumn(e.target.checked)}
              className="accent-blue-500 rounded"
            />
            <span>Show Prob %</span>
          </label>
        </div>
      </div>
      <div className="overflow-x-auto overflow-y-hidden flex-1 min-h-0 flex flex-col">
        {visibleAssets.length === 0 ? (
          <div className="text-center text-[10px] text-gray-500 py-8">Select at least one asset (BTC, ETH, SOL, XRP).</div>
        ) : (
        <table className="updown-markets-panel-table w-full h-full min-h-0 border-collapse text-xs">
          <thead className="bg-gray-900">
            <tr>
              <th className="px-2 py-1 text-center text-gray-400 font-bold border-b border-r border-gray-700 bg-gray-900" rowSpan={2} />
              {visibleAssets.map((asset) => (
                <th
                  key={asset}
                  colSpan={colsPerAsset}
                  className={`px-2 py-1 text-center border-b border-l border-r border-gray-700 border-solid bg-gray-900 font-bold ${ASSET_COLORS[asset] || 'text-white'}`}
                  style={assetBorderStyle(asset, { L: true, R: true })}
                >
                  {asset}
                </th>
              ))}
            </tr>
            <tr>
              {visibleAssets.map((asset) => (
                <Fragment key={asset}>
                  {showTarget && (
                    <th
                      key={`${asset}-target-h`}
                      className="px-1 py-0.5 text-center border-b border-r border-l border-gray-700 border-solid bg-gray-900 text-[9px] text-gray-400 font-semibold"
                      style={assetBorderStyle(asset, { L: true })}
                    >
                      Target
                    </th>
                  )}
                  <th
                    key={`${asset}-current-h`}
                    className="px-1 py-0.5 text-center border-b border-l border-r border-gray-700 border-solid bg-gray-900/80 text-[9px] text-gray-400 font-semibold"
                    style={assetBorderStyle(asset, showTarget ? {} : { L: true })}
                  >
                    Current
                  </th>
                  {Array.from({ length: nextMarketsCount }, (_, i) => (
                    <th
                      key={`${asset}-next-h-${i}`}
                      className="px-1 py-0.5 text-center border-b border-l border-r border-gray-700 border-solid bg-gray-900/70 text-[9px] text-gray-400 font-semibold"
                      style={assetBorderStyle(
                        asset,
                        i < nextMarketsCount - 1 ? {} : { R: true },
                      )}
                    >
                      Next {i + 1}
                    </th>
                  ))}
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody className="updown-markets-panel-tbody">
            <UpDownTimeframeRowsBody
              visibleAssets={visibleAssets}
              sortedOpenByAssetTf={sortedOpenByAssetTf}
              nextMarketsCount={nextMarketsCount}
              showTarget={showTarget}
              showTargetProb={showTargetProb}
              colsPerAsset={colsPerAsset}
              volBySym={volBySym}
              volMultiplier={volMultiplier}
              bsTimeOffsetHours={bsTimeOffsetHours}
              positionTokenIds={positionTokenIds}
              orderLookup={orderLookup}
              selectedMarketId={selectedMarketHighlightId}
              onCellClick={handleCellClick}
              liveTradesSource={liveTradesSource}
            />
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
}

export const UpDownMarketsPanel = memo(UpDownMarketsPanelInner);
