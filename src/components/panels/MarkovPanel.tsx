import { useEffect, useMemo, useRef, useState, memo } from 'react';
import { useAppStore } from '../../stores/appStore';
import type { AssetName, AssetSymbol, Market } from '../../types';
import { ASSET_COLORS } from '../../types';
import { assetToSymbol } from '../../utils/format';
import { useChainlinkPricesMap } from '../../hooks/usePolymarketPrice';
import { getMarketProbability } from '../../utils/bsMath';
import { useMarkovUpDown, markovNextUpProb, type MarkovTFModel } from '../../hooks/useMarkovUpDown';
import { useLogregUpDown, type LrTFModel } from '../../hooks/useLogregUpDown';

const ASSETS: AssetName[] = ['BTC', 'ETH', 'SOL', 'XRP'];
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '24h'] as const;
const GRID_TIMEFRAMES = ['5m', '15m', '1h', '4h'] as const;
const WIDE_GRID_MIN_PX = 720;

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

function stationaryUp(m: MarkovTFModel): number | null {
  const t1 = m.t1;
  if (!t1) return null;
  const denom = 1 - t1[1] + t1[0];
  if (Math.abs(denom) < 1e-9) return null;
  const piUp = t1[0] / denom;
  return Number.isFinite(piUp) ? Math.max(0, Math.min(1, piUp)) : null;
}

interface TFRow {
  tf: string;
  model: MarkovTFModel | undefined;
  lr: LrTFModel | undefined;
  pUpCur: number | null;
  pred: ReturnType<typeof markovNextUpProb>;
}

function computeTFRow(
  asset: AssetName,
  tf: string,
  models: ReturnType<typeof useMarkovUpDown>,
  lrModels: ReturnType<typeof useLogregUpDown>,
  upOrDownMarkets: Record<string, Record<string, Market[]>>,
  chainlinkPrices: Partial<Record<AssetName, number>>,
  priceData: Record<string, { price?: number }>,
  volatilityData: Record<string, number>,
  volMultiplier: number,
  bsTimeOffsetHours: number,
): TFRow {
  const model = models?.[asset]?.[tf];
  const lr = lrModels?.[asset]?.[tf];
  const assetMarkets = upOrDownMarkets[asset] || {};
  const sym = assetToSymbol(asset) as AssetSymbol;
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
  return { tf, model, lr, pUpCur, pred };
}

// LrRow renders the logistic-regression prediction + its walk-forward backtest quality.
function LrRow({ lr }: { lr: LrTFModel | undefined }) {
  if (!lr) return null;
  if (!lr.ok) {
    return (
      <div className="flex items-center gap-2 text-[9px] text-gray-600 border-t border-gray-700/50 pt-1">
        <span className="font-bold text-amber-400/60">LR</span>
        <span>insufficient data (n={lr.n})</span>
      </div>
    );
  }
  const bt = lr.backtest;
  const edge = bt.edgeAcc * 100;
  // Edge over the always-pick-majority baseline is the headline: is the model actually useful?
  const edgeCls = edge >= 1 ? 'text-green-400' : edge <= -1 ? 'text-red-400' : 'text-gray-500';
  const aucCls = bt.auc >= 0.55 ? 'text-green-400' : bt.auc <= 0.45 ? 'text-red-400' : 'text-gray-400';
  return (
    <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[9px] border-t border-gray-700/50 pt-1">
      <span className="font-bold text-amber-400">LR</span>
      <span className="text-gray-500">
        next <span className={`tabular-nums font-bold ${probColor(lr.prediction)}`}>{pct(lr.prediction)}</span>
      </span>
      <span className="ml-auto text-gray-500" title="Walk-forward out-of-sample accuracy">
        acc <span className="tabular-nums text-gray-300">{(bt.accuracy * 100).toFixed(1)}</span>
      </span>
      <span className="text-gray-500" title="Accuracy minus always-pick-majority baseline">
        edge <span className={`tabular-nums font-bold ${edgeCls}`}>{edge >= 0 ? '+' : ''}{edge.toFixed(1)}</span>
      </span>
      <span className="text-gray-500" title="ROC AUC (0.5 = no skill)">
        auc <span className={`tabular-nums ${aucCls}`}>{bt.auc.toFixed(2)}</span>
      </span>
      <span className="text-gray-600" title={`Brier ${bt.brier.toFixed(3)} · logloss ${bt.logLoss.toFixed(3)} · ${bt.refits} refits`}>
        n<span className="tabular-nums">{bt.n}</span>
      </span>
    </div>
  );
}

function MarkovTFCard({
  tf,
  model,
  lr,
  pUpCur,
  pred,
  compact,
}: TFRow & { compact?: boolean }) {
  if (!model || model.n === 0) {
    return (
      <div className="border border-gray-700/70 rounded p-2 text-[10px] text-gray-500 h-full">
        <span className="font-bold text-gray-300">{tf}</span> — no data
      </div>
    );
  }

  const base = model.marginalUp;
  const stat = stationaryUp(model);
  const prev = model.prev;
  const prev2 = model.prev2;
  const prev3 = model.prev3 ?? -1;
  const prev4 = model.prev4 ?? -1;
  const showT3 = hasMarkovTensor(model.t3, 3);
  const showT4 = hasMarkovTensor(model.t4, 4);
  const t3Cells = showT3 ? deepCells(3, model.t3 as unknown as Nested, model.n3 as unknown as Nested) : [];
  const t4Cells = showT4 ? deepCells(4, model.t4 as unknown as Nested, model.n4 as unknown as Nested) : [];

  return (
    <div className={`border border-gray-700/70 rounded p-2 flex flex-col gap-1.5 h-full ${compact ? 'min-w-0' : ''}`}>
      <div className={`flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[10px] ${compact ? 'flex-col items-start' : ''}`}>
        <div className={`flex items-center flex-wrap gap-x-2 gap-y-0.5 ${compact ? 'w-full' : ''}`}>
          <span className="font-bold text-white text-xs">{tf}</span>
          <span className="text-gray-500">n=<span className="text-gray-300 tabular-nums">{model.n}</span></span>
          {!compact && (
            <>
              <span className="text-gray-500">base <span className={`tabular-nums ${probColor(base)}`}>{pct(base)}</span></span>
              <span className="text-gray-500">long-run <span className={`tabular-nums ${probColor(stat)}`}>{pct(stat)}</span></span>
            </>
          )}
          {compact && (
            <>
              <span className="text-gray-500">base <span className={`tabular-nums ${probColor(base)}`}>{pct(base)}</span></span>
              <span className="text-gray-500">stat <span className={`tabular-nums ${probColor(stat)}`}>{pct(stat)}</span></span>
            </>
          )}
        </div>
        <div className={`flex items-center flex-wrap gap-x-2 gap-y-0.5 ${compact ? 'w-full' : ''}`}>
          <span className="text-gray-500">
            state <span className="text-gray-200 font-bold tabular-nums">{arrow(prev4)}{arrow(prev3)}{arrow(prev2)}{arrow(prev)}</span>
          </span>
          <span className="text-gray-500">
            pUp <span className={`tabular-nums font-bold ${probColor(pUpCur)}`}>{pct(pUpCur)}</span>
          </span>
          <span className={`flex flex-wrap items-center gap-x-1 gap-y-0.5 font-bold ${compact ? 'w-full' : 'ml-auto'}`}>
            <span className="text-gray-500 font-normal">o1</span>
            <span className={`tabular-nums ${probColor(pred.order1)}`}>{pct(pred.order1)}</span>
            <span className="text-gray-500 font-normal">o2</span>
            <span className={`tabular-nums ${probColor(pred.order2)}`}>{pct(pred.order2)}</span>
            <span className="text-gray-500 font-normal">o3</span>
            <span className={`tabular-nums ${probColor(pred.order3)}`}>{pct(pred.order3)}</span>
            <span className="text-gray-500 font-normal">o4</span>
            <span className={`tabular-nums ${probColor(pred.order4)}`}>{pct(pred.order4)}</span>
          </span>
        </div>
      </div>

      <LrRow lr={lr} />


      <div className={`flex gap-2 min-w-0 ${compact ? 'flex-col' : 'flex-wrap'}`}>
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="text-[9px] text-gray-500 font-semibold">1st · P(up|prev)</div>
          <div className="flex gap-1">
            {([0, 1] as const).map((s) => {
              const p = model.t1?.[s];
              const n = model.n1?.[s] ?? 0;
              const active = prev === s;
              const edge = p != null ? (p - base) * 100 : 0;
              return (
                <div
                  key={s}
                  className={`flex flex-col items-center rounded px-1.5 py-0.5 border min-w-0 flex-1 ${
                    active ? 'border-amber-500/70 bg-amber-900/20' : 'border-gray-700 bg-gray-900/40'
                  }`}
                  title={`prev=${s === 1 ? 'UP' : 'DOWN'} · n=${n} · edge ${edge >= 0 ? '+' : ''}${edge.toFixed(1)}pts`}
                >
                  <span className="text-[9px] text-gray-500">{s === 1 ? '↑' : '↓'}→</span>
                  <span className={`text-[11px] font-bold tabular-nums ${probColor(p)}`}>{pct(p)}</span>
                  <span className="text-[8px] text-gray-600 tabular-nums">n{n}</span>
                  {!compact && (
                    <span className={`text-[8px] tabular-nums ${edgeColor(edge)}`}>{edge >= 0 ? '+' : ''}{edge.toFixed(0)}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="text-[9px] text-gray-500 font-semibold">2nd · P(up|prev2,prev1)</div>
          <div className="grid grid-cols-2 gap-1">
            {([0, 1] as const).flatMap((p2) =>
              ([0, 1] as const).map((p1) => {
                const p = model.t2?.[p2]?.[p1];
                const n = model.n2?.[p2]?.[p1] ?? 0;
                const active = prev2 === p2 && prev === p1;
                const edge = p != null ? (p - base) * 100 : 0;
                return (
                  <div
                    key={`${p2}-${p1}`}
                    className={`flex items-center gap-0.5 rounded px-1 py-0.5 border min-w-0 ${
                      active ? 'border-amber-500/70 bg-amber-900/20' : 'border-gray-700 bg-gray-900/40'
                    }`}
                    title={`prev2=${p2 === 1 ? 'UP' : 'DOWN'}, prev1=${p1 === 1 ? 'UP' : 'DOWN'} · n=${n} · edge ${edge >= 0 ? '+' : ''}${edge.toFixed(1)}pts`}
                  >
                    <span className="text-[8px] text-gray-500 tabular-nums shrink-0">
                      {p2 === 1 ? '↑' : '↓'}{p1 === 1 ? '↑' : '↓'}→
                    </span>
                    <span className={`text-[10px] font-bold tabular-nums ${probColor(p)}`}>{pct(p)}</span>
                    <span className="text-[7px] text-gray-600 tabular-nums ml-auto">{n}</span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 3rd/4th order — shown in both compact (wide grid) and single-asset views when API provides t3/t4. */}
        {showT3 && (
          <DeepOrderMatrix
            title="3rd · P(up|p3,p2,p1)"
            cells={t3Cells}
            base={base}
            activeCtx={[prev3, prev2, prev]}
            compact={compact}
          />
        )}
        {showT4 && (
          <DeepOrderMatrix
            title="4th · P(up|p4,p3,p2,p1)"
            cells={t4Cells}
            base={base}
            activeCtx={[prev4, prev3, prev2, prev]}
            compact={compact}
          />
        )}
      </div>
    </div>
  );
}

type Nested = number | Nested[];

interface DeepCell {
  ctx: number[]; // [oldest ... newest] conditioning states
  p: number;
  n: number;
}

// deepCells flattens a nested [2]^order transition tensor into ordered context cells.
function deepCells(order: number, t: Nested | undefined, nArr: Nested | undefined): DeepCell[] {
  if (t == null || nArr == null) return [];
  const out: DeepCell[] = [];
  const walk = (tt: Nested, nn: Nested, ctx: number[]) => {
    if (ctx.length === order) {
      out.push({ ctx: [...ctx], p: tt as number, n: nn as number });
      return;
    }
    const tArr = tt as Nested[];
    const nNest = nn as Nested[];
    if (!tArr || !nNest) return;
    for (let s = 0; s < 2; s++) {
      if (tArr[s] == null || nNest[s] == null) continue;
      walk(tArr[s], nNest[s], [...ctx, s]);
    }
  };
  walk(t, nArr, []);
  return out;
}

function hasMarkovTensor(t: unknown, depth: number): boolean {
  if (depth === 0) return typeof t === 'number' && Number.isFinite(t);
  if (!Array.isArray(t) || t.length < 2) return false;
  return hasMarkovTensor(t[0], depth - 1) && hasMarkovTensor(t[1], depth - 1);
}

function DeepOrderMatrix({
  title,
  cells,
  base,
  activeCtx,
  compact,
}: {
  title: string;
  cells: DeepCell[];
  base: number;
  activeCtx: number[];
  compact?: boolean;
}) {
  if (cells.length === 0) return null;
  const ctxValid = activeCtx.every((s) => s === 0 || s === 1);
  return (
    <div className="flex flex-col gap-0.5 min-w-0 w-full">
      <div className={`text-gray-500 font-semibold ${compact ? 'text-[7px]' : 'text-[9px]'}`}>{title}</div>
      <div className={`grid grid-cols-4 ${compact ? 'gap-px' : 'gap-0.5'}`}>
        {cells.map(({ ctx, p, n }) => {
          const active = ctxValid && ctx.every((s, i) => s === activeCtx[i]);
          const edge = (p - base) * 100;
          const arrows = ctx.map((s) => (s === 1 ? '↑' : '↓')).join('');
          return (
            <div
              key={ctx.join('')}
              className={`flex items-center gap-0.5 rounded border min-w-0 ${
                compact ? 'px-0.5 py-px' : 'px-1 py-0.5'
              } ${active ? 'border-amber-500/70 bg-amber-900/20' : 'border-gray-700 bg-gray-900/40'}`}
              title={`ctx ${arrows} (old→new) · n=${n} · edge ${edge >= 0 ? '+' : ''}${edge.toFixed(1)}pts`}
            >
              <span className={`text-gray-500 tabular-nums shrink-0 ${compact ? 'text-[6px]' : 'text-[8px]'}`}>
                {arrows}
              </span>
              <span className={`font-bold tabular-nums ${probColor(p)} ${compact ? 'text-[8px]' : 'text-[10px]'}`}>
                {pct(p)}
              </span>
              {!compact && (
                <span className="text-[7px] text-gray-600 tabular-nums ml-auto">{n}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MarkovPanelInner({ panelId }: { panelId: string }) {
  const [asset, setAsset] = useState<AssetName>(() => {
    const saved = localStorage.getItem(`polybot-markov-asset-${panelId}`);
    if (saved && ASSETS.includes(saved as AssetName)) return saved as AssetName;
    return 'BTC';
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(false);

  const models = useMarkovUpDown();
  const lrModels = useLogregUpDown();
  const upOrDownMarkets = useAppStore((s) => s.upOrDownMarkets);
  const priceData = useAppStore((s) => s.priceData);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);
  const chainlinkPrices = useChainlinkPricesMap();

  useEffect(() => {
    localStorage.setItem(`polybot-markov-asset-${panelId}`, asset);
  }, [panelId, asset]);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => setWide(el.clientWidth >= WIDE_GRID_MIN_PX);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const gridCells = useMemo(() => {
    const cells: Record<string, Record<string, TFRow>> = {};
    for (const a of ASSETS) {
      cells[a] = {};
      for (const tf of TIMEFRAMES) {
        cells[a][tf] = computeTFRow(
          a, tf, models, lrModels, upOrDownMarkets, chainlinkPrices, priceData, volatilityData, volMultiplier, bsTimeOffsetHours,
        );
      }
    }
    return cells;
  }, [models, lrModels, upOrDownMarkets, chainlinkPrices, priceData, volatilityData, volMultiplier, bsTimeOffsetHours]);

  const narrowRows = useMemo(
    () => TIMEFRAMES.map((tf) => gridCells[asset][tf]),
    [gridCells, asset],
  );

  const titleColor = ASSET_COLORS[asset] || 'text-white';

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0 h-full gap-2">
      <div className="panel-header flex items-center gap-2 cursor-grab">
        <h3 className="text-sm font-bold text-amber-300">
          {!wide && (
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
          )}
          <span className={`${wide ? '' : 'ml-2'} ${wide ? 'text-amber-300' : titleColor}`}>Markov Chains</span>
          <span className="text-gray-500 font-normal ml-1 text-[10px]">UP/DOWN next-market</span>
        </h3>
      </div>

      <div ref={bodyRef} className="overflow-auto min-h-0 flex-1">
        {!models && <div className="text-gray-500 text-xs p-2">Loading model…</div>}

        {models && wide && (
          <div className="flex flex-col gap-2 min-h-0">
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: 'auto repeat(4, minmax(0, 1fr))' }}
            >
              <div className="col-start-1 row-start-1" />
              {ASSETS.map((a, ci) => (
                <div
                  key={a}
                  className={`text-center text-[11px] font-bold py-0.5 ${ASSET_COLORS[a]}`}
                  style={{ gridColumn: ci + 2, gridRow: 1 }}
                >
                  {a}
                </div>
              ))}

              {GRID_TIMEFRAMES.map((tf, ri) => [
                <div
                  key={`label-${tf}`}
                  className="text-[11px] font-bold text-white flex items-center pr-1"
                  style={{ gridColumn: 1, gridRow: ri + 2 }}
                >
                  {tf}
                </div>,
                ...ASSETS.map((a, ci) => (
                  <div key={`${a}-${tf}`} style={{ gridColumn: ci + 2, gridRow: ri + 2 }} className="min-w-0">
                    <MarkovTFCard {...gridCells[a][tf]} compact />
                  </div>
                )),
              ])}
            </div>

            <div className="grid gap-2" style={{ gridTemplateColumns: 'auto repeat(4, minmax(0, 1fr))' }}>
              <div className="text-[11px] font-bold text-white flex items-center pr-1">24h</div>
              {ASSETS.map((a) => (
                <div key={`${a}-24h`} className="min-w-0">
                  <MarkovTFCard {...gridCells[a]['24h']} compact />
                </div>
              ))}
            </div>
          </div>
        )}

        {models && !wide && (
          <div className="flex flex-col gap-2">
            {narrowRows.map((row) => (
              <MarkovTFCard key={row.tf} {...row} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export const MarkovPanel = memo(MarkovPanelInner);
