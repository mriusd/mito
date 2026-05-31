import { useEffect, useMemo, useState, memo } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { AssetName, AssetSymbol, Market } from '../../types';
import { ASSET_COLORS } from '../../types';
import { assetToSymbol } from '../../utils/format';
import { useChainlinkPricesMap } from '../../hooks/usePolymarketPrice';
import { getMarketProbability } from '../../utils/bsMath';
import { useMarkovUpDown, markovNextUpProb, type MarkovTFModel } from '../../hooks/useMarkovUpDown';

const ASSETS: AssetName[] = ['BTC', 'ETH', 'SOL', 'XRP'];
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '24h'] as const;

function getCurrentMarket(assetMarkets: Record<string, Market[]>, tf: string): Market | null {
  const now = Date.now();
  const markets = (assetMarkets[tf] || [])
    .filter((m) => !m.closed)
    .sort((a, b) => {
      const ta = a.endDate ? new Date(a.endDate).getTime() : Infinity;
      const tb = b.endDate ? new Date(b.endDate).getTime() : Infinity;
      return ta - tb;
    });
  const cur = markets.find((m) => m.endDate && new Date(m.endDate).getTime() > now);
  return cur || null;
}

const pct = (p: number | null | undefined): string =>
  p == null || !Number.isFinite(p) ? '-' : (p * 100).toFixed(0);

function probColor(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return 'text-gray-500';
  if (Math.abs(p * 100 - 50) <= 1) return 'text-gray-300/90';
  return p > 0.5 ? 'text-green-300' : 'text-red-300';
}

function edgeColor(edgePts: number): string {
  if (Math.abs(edgePts) < 1.5) return 'text-gray-500';
  return edgePts > 0 ? 'text-green-400' : 'text-red-400';
}

function arrow(state: number): string {
  return state === 1 ? '↑' : state === 0 ? '↓' : '·';
}

// Long-run UP frequency of the 1st-order chain (stationary distribution).
function stationaryUp(m: MarkovTFModel): number | null {
  const denom = 1 - m.t1[1] + m.t1[0];
  if (Math.abs(denom) < 1e-9) return null;
  const piUp = m.t1[0] / denom;
  return Number.isFinite(piUp) ? Math.max(0, Math.min(1, piUp)) : null;
}

function MarkovPanelInner({ panelId }: { panelId: string }) {
  const [asset, setAsset] = useState<AssetName>(() => {
    const saved = localStorage.getItem(`polybot-markov-asset-${panelId}`);
    if (saved && ASSETS.includes(saved as AssetName)) return saved as AssetName;
    return 'BTC';
  });
  const [, setNow] = useState(() => Date.now());

  const models = useMarkovUpDown();
  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const priceData = useAppStore((s) => s.priceData);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);
  const chainlinkPrices = useChainlinkPricesMap();

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    localStorage.setItem(`polybot-markov-asset-${panelId}`, asset);
  }, [panelId, asset]);

  const titleColor = ASSET_COLORS[asset] || 'text-white';

  // Per-tf: live current-window UP prob (pUpCur) + Markov predictions, recomputed each render.
  const rows = useMemo(() => {
    const assetMarkets = upOrDownMarkets[asset] || {};
    const sym = assetToSymbol(asset) as AssetSymbol;
    return TIMEFRAMES.map((tf) => {
      const model = models?.[asset]?.[tf];
      const current = getCurrentMarket(assetMarkets, tf);
      const cl = chainlinkPrices[asset];
      const binanceSpot = priceData[sym]?.price;
      const preferChainlink = tf === '5m' || tf === '15m';
      const liveSpot = preferChainlink
        ? (cl != null && cl > 0 ? cl : (binanceSpot != null && binanceSpot > 0 ? binanceSpot : undefined))
        : (binanceSpot != null && binanceSpot > 0 ? binanceSpot : undefined);
      const strike = current?.priceToBeat;
      let pUpCur: number | null = null;
      if (liveSpot != null && liveSpot > 0 && strike != null && current?.endDate) {
        const sigma = (volatilityData[sym] || 0.6) * volMultiplier;
        const p = getMarketProbability('>' + strike, liveSpot, current.endDate, sigma, bsTimeOffsetHours);
        if (p != null) pUpCur = p;
      }
      const pred = markovNextUpProb(model, pUpCur);
      return { tf, model, pUpCur, pred };
    });
  }, [asset, models, upOrDownMarkets, chainlinkPrices, priceData, volatilityData, volMultiplier, bsTimeOffsetHours]);

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0 h-full gap-2">
      <div className="panel-header flex items-center gap-2 cursor-grab">
        <h3 className="text-sm font-bold text-amber-300">
          <span className="no-drag inline-flex items-center gap-1">
            {ASSETS.map((a) => (
              <button
                key={a}
                onClick={() => setAsset(a)}
                className={`px-1.5 py-0.5 rounded text-[11px] font-bold ${
                  a === asset ? `${ASSET_COLORS[a]} bg-gray-700` : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {a}
              </button>
            ))}
          </span>
          <span className={`ml-2 ${titleColor}`}>Markov Chains</span>
          <span className="text-gray-500 font-normal ml-1 text-[10px]">UP/DOWN next-market</span>
        </h3>
      </div>

      <div className="overflow-auto flex flex-col gap-2 min-h-0">
        {!models && <div className="text-gray-500 text-xs p-2">Loading model…</div>}
        {models && rows.map(({ tf, model, pUpCur, pred }) => {
          if (!model || model.n === 0) {
            return (
              <div key={tf} className="border border-gray-700/70 rounded p-2 text-[10px] text-gray-500">
                <span className="font-bold text-gray-300">{tf}</span> — no data
              </div>
            );
          }
          const base = model.marginalUp;
          const stat = stationaryUp(model);
          const prev = model.prev;
          const prev2 = model.prev2;
          return (
            <div key={tf} className="border border-gray-700/70 rounded p-2 flex flex-col gap-1.5">
              {/* Header line: tf, sample, base rate, long-run, current state, live pUp, predictions */}
              <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 text-[10px]">
                <span className="font-bold text-white text-xs">{tf}</span>
                <span className="text-gray-500">n=<span className="text-gray-300 tabular-nums">{model.n}</span></span>
                <span className="text-gray-500">base <span className={`tabular-nums ${probColor(base)}`}>{pct(base)}</span></span>
                <span className="text-gray-500">long-run <span className={`tabular-nums ${probColor(stat)}`}>{pct(stat)}</span></span>
                <span className="text-gray-500">
                  state <span className="text-gray-200 font-bold tabular-nums">{arrow(prev2)}{arrow(prev)}</span>
                </span>
                <span className="text-gray-500">
                  pUp(now) <span className={`tabular-nums font-bold ${probColor(pUpCur)}`}>{pct(pUpCur)}</span>
                </span>
                <span className="ml-auto flex items-center gap-2 font-bold">
                  <span className="text-gray-500 font-normal">o1</span>
                  <span className={`tabular-nums ${probColor(pred.order1)}`}>{pct(pred.order1)}</span>
                  <span className="text-gray-500 font-normal">o2</span>
                  <span className={`tabular-nums ${probColor(pred.order2)}`}>{pct(pred.order2)}</span>
                </span>
              </div>

              <div className="flex flex-wrap gap-3">
                {/* 1st order T1: P(up | prev) */}
                <div className="flex flex-col gap-0.5">
                  <div className="text-[9px] text-gray-500 font-semibold">1st order · P(up | prev)</div>
                  <div className="flex gap-1">
                    {([0, 1] as const).map((s) => {
                      const p = model.t1[s];
                      const n = model.n1[s];
                      const active = prev === s;
                      const edge = (p - base) * 100;
                      return (
                        <div
                          key={s}
                          className={`flex flex-col items-center rounded px-2 py-1 border ${
                            active ? 'border-amber-500/70 bg-amber-900/20' : 'border-gray-700 bg-gray-900/40'
                          }`}
                          title={`prev=${s === 1 ? 'UP' : 'DOWN'} · n=${n} · edge vs base ${edge >= 0 ? '+' : ''}${edge.toFixed(1)}pts`}
                        >
                          <span className="text-[9px] text-gray-500">{s === 1 ? '↑' : '↓'}→</span>
                          <span className={`text-[11px] font-bold tabular-nums ${probColor(p)}`}>{pct(p)}</span>
                          <span className="text-[8px] text-gray-600 tabular-nums">n{n}</span>
                          <span className={`text-[8px] tabular-nums ${edgeColor(edge)}`}>{edge >= 0 ? '+' : ''}{edge.toFixed(0)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 2nd order T2: P(up | prev2, prev1) */}
                <div className="flex flex-col gap-0.5">
                  <div className="text-[9px] text-gray-500 font-semibold">2nd order · P(up | prev2, prev1)</div>
                  <div className="grid grid-cols-2 gap-1">
                    {([0, 1] as const).flatMap((p2) =>
                      ([0, 1] as const).map((p1) => {
                        const p = model.t2[p2][p1];
                        const n = model.n2[p2][p1];
                        const active = prev2 === p2 && prev === p1;
                        const edge = (p - base) * 100;
                        return (
                          <div
                            key={`${p2}-${p1}`}
                            className={`flex items-center gap-1 rounded px-1.5 py-0.5 border ${
                              active ? 'border-amber-500/70 bg-amber-900/20' : 'border-gray-700 bg-gray-900/40'
                            }`}
                            title={`prev2=${p2 === 1 ? 'UP' : 'DOWN'}, prev1=${p1 === 1 ? 'UP' : 'DOWN'} · n=${n} · edge ${edge >= 0 ? '+' : ''}${edge.toFixed(1)}pts`}
                          >
                            <span className="text-[9px] text-gray-500 tabular-nums">
                              {p2 === 1 ? '↑' : '↓'}{p1 === 1 ? '↑' : '↓'}→
                            </span>
                            <span className={`text-[11px] font-bold tabular-nums ${probColor(p)}`}>{pct(p)}</span>
                            <span className="text-[8px] text-gray-600 tabular-nums">n{n}</span>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const MarkovPanel = memo(MarkovPanelInner);
