import { useCallback, useEffect, useMemo, useRef, useState, Fragment, memo } from 'react';
import type { CSSProperties } from 'react';
import { useAppStore } from '../../stores/appStore';
import { HelpTooltip } from '../HelpTooltip';
import type { Market } from '../../types';
import type { AssetSymbol } from '../../types';
import { getPositionClobTokenId, normalizeClobTokenId } from '../../utils/format';
import { useThrottledChainlinkPricesMap } from '../../hooks/usePolymarketPrice';
import { useThrottledStorePrice } from '../../hooks/useThrottledStorePrice';
import { UpDownAssetLaneCells } from './UpDownAssetLaneCells';

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
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '24h'] as const;
const ASSET_COLORS: Record<string, string> = {
  BTC: 'text-orange-400',
  ETH: 'text-blue-400',
  SOL: 'text-purple-400',
  XRP: 'text-cyan-400',
};

/**
 * Asset envelope border colors as inline RGBA so production CSS always includes them.
 * (Tailwind JIT sometimes omits `border-{color}-400/85` for some hues in minified builds.)
 */
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

const LAST_TIMEFRAME = TIMEFRAMES[TIMEFRAMES.length - 1];

const TF_DURATIONS_MS: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

/** Elapsed fraction [0,1] of fixed window ending at endMs (same as AssetMarketTable). */
function expiryProgress(nowMs: number, endMs: number, durationMs: number): number {
  if (endMs <= 0 || durationMs <= 0) return 0;
  const startMs = endMs - durationMs;
  return Math.max(0, Math.min(1, (nowMs - startMs) / durationMs));
}

const EXPIRY_BAR_BG = 'rgba(6, 182, 212, 0.6)';

const NEXT_MARKETS_COUNT_KEY = 'updown-next-markets-count';
const ASSET_VISIBILITY_KEY = 'updown-panel-asset-visibility';
const SHOW_TARGET_KEY = 'updown-show-target';

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

  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const positions = useAppStore((s) => s.positions);
  const liveTradesSource = useAppStore((s) => s.liveTradesSource);
  const onchainGridPositions = useAppStore((s) => s.onchainGridPositions);
  const orders = useAppStore((s) => s.orders);
  const progOrderMap = useAppStore((s) => s.progOrderMap);
  const btcPrice = useThrottledStorePrice('BTCUSDT', 1000);
  const ethPrice = useThrottledStorePrice('ETHUSDT', 1000);
  const solPrice = useThrottledStorePrice('SOLUSDT', 1000);
  const xrpPrice = useThrottledStorePrice('XRPUSDT', 1000);
  const priceBySym = useMemo((): Partial<Record<AssetSymbol, number>> => ({
    BTCUSDT: btcPrice > 0 ? btcPrice : undefined,
    ETHUSDT: ethPrice > 0 ? ethPrice : undefined,
    SOLUSDT: solPrice > 0 ? solPrice : undefined,
    XRPUSDT: xrpPrice > 0 ? xrpPrice : undefined,
  }), [btcPrice, ethPrice, solPrice, xrpPrice]);
  const btcVol = useAppStore((s) => s.volatilityData.BTCUSDT ?? 0.6);
  const ethVol = useAppStore((s) => s.volatilityData.ETHUSDT ?? 0.6);
  const solVol = useAppStore((s) => s.volatilityData.SOLUSDT ?? 0.6);
  const xrpVol = useAppStore((s) => s.volatilityData.XRPUSDT ?? 0.6);
  const volBySym = useMemo((): Record<AssetSymbol, number> => ({
    BTCUSDT: btcVol,
    ETHUSDT: ethVol,
    SOLUSDT: solVol,
    XRPUSDT: xrpVol,
  }), [btcVol, ethVol, solVol, xrpVol]);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);
  const chainlinkPrices = useThrottledChainlinkPricesMap(1000);

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

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

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

  type UpDownLane = { current: Market | null; futures: (Market | null)[] };
  const laneCacheRef = useRef(new Map<string, UpDownLane>());

  const laneByAssetTf = useMemo(() => {
    const out: Partial<Record<(typeof ASSETS)[number], Partial<Record<(typeof TIMEFRAMES)[number], UpDownLane>>>> = {};
    const cache = laneCacheRef.current;
    for (const asset of visibleAssets) {
      out[asset] = {};
      for (const tf of TIMEFRAMES) {
        const markets = sortedOpenByAssetTf[asset]?.[tf] ?? [];
        const currentIdx = markets.findIndex((m) => m.endDate && new Date(m.endDate).getTime() > now);
        let raw: UpDownLane;
        if (currentIdx === -1) {
          raw = { current: null, futures: Array.from({ length: nextMarketsCount }, () => null) };
        } else {
          const futures: (Market | null)[] = [];
          for (let i = 0; i < nextMarketsCount; i++) {
            futures.push(markets[currentIdx + 1 + i] ?? null);
          }
          raw = { current: markets[currentIdx], futures };
        }
        const key = `${asset}\0${tf}`;
        const prev = cache.get(key);
        if (
          prev &&
          prev.current === raw.current &&
          prev.futures.length === raw.futures.length &&
          prev.futures.every((m, i) => m === raw.futures[i])
        ) {
          out[asset]![tf] = prev;
        } else {
          cache.set(key, raw);
          out[asset]![tf] = raw;
        }
      }
    }
    return out;
  }, [sortedOpenByAssetTf, visibleAssets, now, nextMarketsCount]);

  /** Timeframe rows whose current window ends at the same instant as another row (2+ timeframes). */
  const timeframesWithSharedExpiry = useMemo(() => {
    const endMsByTf: Partial<Record<(typeof TIMEFRAMES)[number], number>> = {};
    for (const tf of TIMEFRAMES) {
      let endMs = 0;
      for (const a of visibleAssets) {
        const markets = sortedOpenByAssetTf[a]?.[tf] ?? [];
        const currentIdx = markets.findIndex((m) => m.endDate && new Date(m.endDate).getTime() > now);
        const m = currentIdx === -1 ? null : markets[currentIdx];
        if (m?.endDate) {
          endMs = new Date(m.endDate).getTime();
          break;
        }
      }
      endMsByTf[tf] = endMs;
    }
    const byEnd = new Map<number, (typeof TIMEFRAMES)[number][]>();
    for (const tf of TIMEFRAMES) {
      const e = endMsByTf[tf];
      if (!e || e <= 0) continue;
      if (!byEnd.has(e)) byEnd.set(e, []);
      byEnd.get(e)!.push(tf);
    }
    const dup = new Set<string>();
    for (const list of byEnd.values()) {
      if (list.length >= 2) list.forEach((t) => dup.add(t));
    }
    return dup;
  }, [visibleAssets, sortedOpenByAssetTf, now]);

  const colsPerAsset = (showTarget ? 1 : 0) + 1 + nextMarketsCount;

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0">
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
        </div>
      </div>
      <div className="overflow-x-auto overflow-y-auto flex-1 min-h-0">
        {visibleAssets.length === 0 ? (
          <div className="text-center text-[10px] text-gray-500 py-8">Select at least one asset (BTC, ETH, SOL, XRP).</div>
        ) : (
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-gray-900">
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
                      className="px-1 py-0.5 text-center border-b border-r border-l border-gray-700 border-solid bg-gray-900 text-[9px] text-gray-400 font-semibold"
                      style={assetBorderStyle(asset, { L: true })}
                    >
                      Target
                    </th>
                  )}
                  <th
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
          <tbody>
            {TIMEFRAMES.map((tf) => {
              const duration = TF_DURATIONS_MS[tf] || 0;
              const firstMarket = visibleAssets
                .map((a) => laneByAssetTf[a]?.[tf]?.current ?? null)
                .find((m) => m !== null);
              const endMs = firstMarket?.endDate ? new Date(firstMarket.endDate).getTime() : 0;
              const tfProgress = expiryProgress(now, endMs, duration);
              const tfProgressPct = (tfProgress * 100).toFixed(1);
              const isLastTfRow = tf === LAST_TIMEFRAME;

              const tfDupExpiry = timeframesWithSharedExpiry.has(tf);
              return (
              <tr key={tf} className="hover:bg-gray-800/50">
                <td
                  className={`px-1 py-1 font-bold text-white border-b border-r border-gray-700 whitespace-nowrap relative ${
                    tfDupExpiry ? 'bg-red-950/70' : 'bg-gray-900'
                  }`}
                  title={tfDupExpiry ? 'This timeframe shares the same expiry instant as another row' : undefined}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span>{tf}</span>
                    <span className={`text-[8px] font-normal ${endMs > 0 && endMs - now < 60000 ? 'text-red-400' : endMs > 0 && endMs - now < 300000 ? 'text-yellow-400' : 'text-green-400'}`}>{endMs > 0 ? formatCountdown(endMs) : ''}</span>
                  </div>
                  {endMs > 0 && duration > 0 && (
                    <div
                      className="absolute bottom-0 left-0 z-0 h-[2px] pointer-events-none"
                      style={{ width: `${tfProgressPct}%`, backgroundColor: EXPIRY_BAR_BG }}
                    />
                  )}
                </td>
                {visibleAssets.map((asset) => {
                  const lane = laneByAssetTf[asset]?.[tf];
                  const market = lane?.current ?? null;
                  const futuresSlots = lane?.futures ?? Array.from({ length: nextMarketsCount }, () => null);
                  if (!market) {
                    return (
                      <td
                        key={asset}
                        colSpan={colsPerAsset}
                        className={`px-1 py-1 text-center border-l border-r border-solid border-gray-700 text-gray-600 ${isLastTfRow ? 'border-b' : 'border-b border-gray-700/50'}`}
                        style={assetBorderStyle(asset, { L: true, R: true, B: isLastTfRow })}
                      >
                        -
                      </td>
                    );
                  }

                  const sym = (asset + 'USDT') as AssetSymbol;
                  return (
                    <UpDownAssetLaneCells
                      key={asset}
                      asset={asset}
                      tf={tf}
                      market={market}
                      futuresSlots={futuresSlots}
                      showTarget={showTarget}
                      isLastTfRow={isLastTfRow}
                      nextMarketsCount={nextMarketsCount}
                      chainlinkSpot={chainlinkPrices[asset]}
                      binanceSpot={priceBySym[sym]}
                      vol={volBySym[sym]}
                      volMultiplier={volMultiplier}
                      bsTimeOffsetHours={bsTimeOffsetHours}
                      positionTokenIds={positionTokenIds}
                      orderLookup={orderLookup}
                      selectedMarketId={selectedMarket?.id}
                      onCellClick={handleCellClick}
                      liveTradesSource={liveTradesSource}
                    />
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
}

export const UpDownMarketsPanel = memo(UpDownMarketsPanelInner);
