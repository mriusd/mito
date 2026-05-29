import { memo, useEffect, useMemo, useState } from 'react';
import { Triangle } from 'lucide-react';
import { formatSpotObImpactUsd, formatSpotObMovePctLabel } from '../../lib/binanceSpotObImpact';
import {
  BINANCE_SPOT_OB_ASSETS,
  SPOT_OB_MOVE_PCT_LEVELS,
  binanceObDepthLimit,
  useBinanceObFeedStatus,
  useBinanceObPanels,
  type BinanceObAssetPanel,
  type BinanceObFeedStatus,
  type BinanceObImpactCell,
  type BinanceObMarket,
  type BinanceSpotObAsset,
} from '../../lib/binanceSpotOrderbookFeed';
import {
  okxObDepthLimit,
  useOkxObFeedStatus,
  useOkxObPanels,
} from '../../lib/okxSpotOrderbookFeed';
import { formatPrice } from '../../utils/format';

type ObExchange = 'binance' | 'okx';

type ExchangeSelection = {
  binance: boolean;
  okx: boolean;
};

const MARKET_LABEL: Record<BinanceObMarket, string> = {
  spot: 'spot',
  futures: 'futures',
};

function cellForPct(cells: BinanceObImpactCell[], pct: number): BinanceObImpactCell | null {
  return cells.find((c) => c.pct === pct) ?? null;
}

function impactFromCell(cell: BinanceObImpactCell | null) {
  if (!cell) return null;
  return { usd: cell.usd, depthCapped: cell.capped };
}

function mergeImpactCells(a: BinanceObImpactCell[], b: BinanceObImpactCell[]): BinanceObImpactCell[] {
  const out: BinanceObImpactCell[] = [];
  for (const pct of SPOT_OB_MOVE_PCT_LEVELS) {
    const ca = cellForPct(a, pct);
    const cb = cellForPct(b, pct);
    const usd = (ca?.usd ?? 0) + (cb?.usd ?? 0);
    if (usd <= 0) continue;
    out.push({ pct, usd, capped: ca?.capped === true || cb?.capped === true });
  }
  return out;
}

function combineAssetPanel(
  bin: BinanceObAssetPanel | null,
  okx: BinanceObAssetPanel | null,
  sel: ExchangeSelection,
): BinanceObAssetPanel | null {
  if (sel.binance && sel.okx) {
    if (!bin && !okx) return null;
    const mids = [bin?.mid, okx?.mid].filter((m): m is number => m != null && Number.isFinite(m));
    const mid = mids.length > 0 ? mids.reduce((s, m) => s + m, 0) / mids.length : null;
    return {
      synced: (sel.binance ? bin?.synced === true : true) && (sel.okx ? okx?.synced === true : true),
      mid,
      up: mergeImpactCells(bin?.up ?? [], okx?.up ?? []),
      down: mergeImpactCells(bin?.down ?? [], okx?.down ?? []),
    };
  }
  if (sel.binance) return bin;
  if (sel.okx) return okx;
  return null;
}

function combinePanels(
  binPanels: Record<BinanceSpotObAsset, BinanceObAssetPanel | null>,
  okxPanels: Record<BinanceSpotObAsset, BinanceObAssetPanel | null>,
  sel: ExchangeSelection,
): Record<BinanceSpotObAsset, BinanceObAssetPanel | null> {
  const out = {} as Record<BinanceSpotObAsset, BinanceObAssetPanel | null>;
  for (const asset of BINANCE_SPOT_OB_ASSETS) {
    out[asset] = combineAssetPanel(binPanels[asset], okxPanels[asset], sel);
  }
  return out;
}

function combineFeedStatus(
  bin: BinanceObFeedStatus,
  okx: BinanceObFeedStatus,
  sel: ExchangeSelection,
): BinanceObFeedStatus {
  const feeds = [
    sel.binance ? bin : null,
    sel.okx ? okx : null,
  ].filter((f): f is BinanceObFeedStatus => f != null);
  if (feeds.length === 0) {
    return { hasBook: false, wsLive: false, allSynced: false, wsAgeSec: null, bookAgeSec: null };
  }
  const hasBook = feeds.every((f) => f.hasBook);
  const wsLive = feeds.every((f) => f.wsLive);
  const allSynced = feeds.every((f) => f.allSynced);
  const wsAgeSec = Math.max(...feeds.map((f) => f.wsAgeSec ?? 0));
  const bookAgeSec = Math.max(...feeds.map((f) => f.bookAgeSec ?? 0));
  return {
    hasBook,
    wsLive,
    allSynced,
    wsAgeSec: wsLive ? 0 : wsAgeSec,
    bookAgeSec,
  };
}

function impactPair(panel: BinanceObAssetPanel | null, pct: number) {
  const up = impactFromCell(cellForPct(panel?.up ?? [], pct));
  const down = impactFromCell(cellForPct(panel?.down ?? [], pct));
  const upUsd = up?.usd ?? 0;
  const downUsd = down?.usd ?? 0;
  const total = upUsd + downUsd;
  return {
    up,
    down,
    upFrac: total > 0 ? upUsd / total : 0,
    downFrac: total > 0 ? downUsd / total : 0,
  };
}

const COL_ASSET = 'w-[72px]';
const COL_UD = 'w-[26px]';
const COL_IMPACT = 'w-[58px]';

function ImpactCell({
  value,
  frac,
  tone,
  title,
}: {
  value: ReturnType<typeof impactFromCell>;
  frac: number;
  tone: 'up' | 'down';
  title: string;
}) {
  const barClass = tone === 'up' ? 'bg-green-900/55' : 'bg-red-900/55';
  const textClass = tone === 'up' ? 'text-green-300/95' : 'text-red-300/95';
  const widthPct = Math.max(0, Math.min(100, frac * 100));
  return (
    <td
      className={`relative overflow-hidden py-1 px-1.5 text-right text-[10px] tabular-nums font-bold whitespace-nowrap ${COL_IMPACT} ${textClass}`}
      title={title}
    >
      {widthPct > 0 ? (
        <div className={`absolute inset-y-0 right-0 ${barClass}`} style={{ width: `${widthPct}%` }} />
      ) : null}
      <span className="relative z-[1]">{formatSpotObImpactUsd(value)}</span>
    </td>
  );
}

const AssetRows = memo(function AssetRows({
  asset,
  panel,
  connected,
  market,
  exchanges,
}: {
  asset: BinanceSpotObAsset;
  panel: BinanceObAssetPanel | null;
  connected: boolean;
  market: BinanceObMarket;
  exchanges: ExchangeSelection;
}) {
  const mkt = MARKET_LABEL[market];
  const mid = panel?.mid ?? null;
  const depthParts: string[] = [];
  if (exchanges.binance) depthParts.push(`BIN ${binanceObDepthLimit(market)}`);
  if (exchanges.okx) depthParts.push(`OKX ${okxObDepthLimit(market)}`);
  const depthLabel = depthParts.join(' + ');

  return (
    <>
      <tr className="border-b border-gray-800/80">
        <td rowSpan={2} className={`py-1.5 px-2 align-middle border-r border-gray-800 ${COL_ASSET}`}>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="text-[11px] font-bold text-white">{asset}</span>
            <span className="text-[9px] tabular-nums font-medium text-gray-400 truncate">
              {mid != null ? formatPrice(mid, asset) : '—'}
            </span>
          </div>
        </td>
        <td className={`py-1 px-1 text-center whitespace-nowrap border-r border-gray-800/60 ${COL_UD}`}>
          <Triangle className="mx-auto h-2.5 w-2.5 fill-green-400 stroke-green-400 text-green-400" strokeWidth={1.5} aria-label="Up" />
        </td>
        {SPOT_OB_MOVE_PCT_LEVELS.map((pct) => {
          const { up, upFrac } = impactPair(panel, pct);
          const pctLabel = formatSpotObMovePctLabel(pct);
          return (
            <ImpactCell
              key={`${asset}-up-${pct}`}
              value={up}
              frac={upFrac}
              tone="up"
              title={
                connected
                  ? up?.depthCapped
                    ? `Book depth exhausted before ~${pctLabel} up (+ = capped at ${depthLabel} levels)`
                    : `USD to lift ${mkt} ~${pctLabel}`
                  : 'Waiting for orderbook'
              }
            />
          );
        })}
      </tr>
      <tr className="border-b border-gray-800">
        <td className={`py-1 px-1 text-center whitespace-nowrap border-r border-gray-800/60 ${COL_UD}`}>
          <Triangle className="mx-auto h-2.5 w-2.5 rotate-180 fill-red-400 stroke-red-400 text-red-400" strokeWidth={1.5} aria-label="Down" />
        </td>
        {SPOT_OB_MOVE_PCT_LEVELS.map((pct) => {
          const { down, downFrac } = impactPair(panel, pct);
          const pctLabel = formatSpotObMovePctLabel(pct);
          return (
            <ImpactCell
              key={`${asset}-down-${pct}`}
              value={down}
              frac={downFrac}
              tone="down"
              title={
                connected
                  ? down?.depthCapped
                    ? `Book depth exhausted before ~${pctLabel} down (+ = capped at ${depthLabel} levels)`
                    : `USD to hit ${mkt} ~${pctLabel}`
                  : 'Waiting for orderbook'
              }
            />
          );
        })}
      </tr>
    </>
  );
});

function readStoredMarket(panelId: string): BinanceObMarket {
  const saved = localStorage.getItem(`polybot-spot-ob-market-${panelId}`);
  return saved === 'futures' ? 'futures' : 'spot';
}

function readStoredExchanges(panelId: string): ExchangeSelection {
  const saved = localStorage.getItem(`polybot-ob-exchanges-${panelId}`);
  if (!saved) return { binance: true, okx: true };
  try {
    const parsed = JSON.parse(saved) as Partial<ExchangeSelection>;
    const binance = parsed.binance !== false;
    const okx = parsed.okx !== false;
    if (!binance && !okx) return { binance: true, okx: true };
    return { binance, okx };
  } catch {
    return { binance: true, okx: true };
  }
}

function storeExchanges(panelId: string, sel: ExchangeSelection): void {
  localStorage.setItem(`polybot-ob-exchanges-${panelId}`, JSON.stringify(sel));
}

function exchangeLabel(sel: ExchangeSelection): string {
  if (sel.binance && sel.okx) return 'BIN+OKX';
  if (sel.binance) return 'BIN';
  return 'OKX';
}

export function SpotOrderbookPanel({ panelId }: { panelId: string }) {
  const [market, setMarket] = useState<BinanceObMarket>(() => readStoredMarket(panelId));
  const [exchanges, setExchanges] = useState<ExchangeSelection>(() => readStoredExchanges(panelId));

  const binPanels = useBinanceObPanels(market, exchanges.binance);
  const okxPanels = useOkxObPanels(market, exchanges.okx);
  const binFeed = useBinanceObFeedStatus(market, exchanges.binance);
  const okxFeed = useOkxObFeedStatus(market, exchanges.okx);

  const panels = useMemo(
    () => combinePanels(binPanels, okxPanels, exchanges),
    [binPanels, okxPanels, exchanges],
  );
  const feed = useMemo(
    () => combineFeedStatus(binFeed, okxFeed, exchanges),
    [binFeed, okxFeed, exchanges],
  );

  const [, ageTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => ageTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const exLabel = exchangeLabel(exchanges);
  const liveLabel = !feed.hasBook
    ? 'Connecting…'
    : !feed.wsLive
      ? feed.wsAgeSec != null
        ? `${exLabel} ${MARKET_LABEL[market]} · stream ${feed.wsAgeSec}s stale`
        : `${exLabel} ${MARKET_LABEL[market]} · waiting stream`
      : !feed.allSynced
        ? `${exLabel} ${MARKET_LABEL[market]} · syncing`
        : feed.bookAgeSec != null && feed.bookAgeSec > 2
          ? `${exLabel} ${MARKET_LABEL[market]} · book ${feed.bookAgeSec}s stale`
          : `${exLabel} ${MARKET_LABEL[market]} live`;

  const liveClass =
    feed.hasBook && feed.wsLive && feed.allSynced && (feed.bookAgeSec ?? 0) <= 2
      ? 'text-emerald-400'
      : feed.hasBook
        ? 'text-amber-400'
        : 'text-gray-500';

  const toggleExchange = (key: ObExchange) => {
    setExchanges((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (!next.binance && !next.okx) return prev;
      storeExchanges(panelId, next);
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-900/40 p-2">
      <div className="panel-header mb-2 flex items-center justify-between gap-2 shrink-0 cursor-grab">
        <div className="text-[11px] font-bold text-yellow-400">Orderbook</div>
        <div className="flex items-center gap-2 no-drag" onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex shrink-0 items-center gap-2 rounded border border-gray-600 px-2 py-0.5">
            <label className="flex cursor-pointer items-center gap-1 text-[9px] font-semibold text-gray-300">
              <input
                type="checkbox"
                className="h-3 w-3 accent-cyan-400"
                checked={exchanges.binance}
                onChange={() => toggleExchange('binance')}
              />
              BIN
            </label>
            <label className="flex cursor-pointer items-center gap-1 text-[9px] font-semibold text-gray-300">
              <input
                type="checkbox"
                className="h-3 w-3 accent-cyan-400"
                checked={exchanges.okx}
                onChange={() => toggleExchange('okx')}
              />
              OKX
            </label>
          </div>
          <div className="flex shrink-0 overflow-hidden rounded border border-gray-600">
            <button
              type="button"
              className={`px-2 py-0.5 text-[9px] font-semibold ${market === 'spot' ? 'bg-cyan-900/75 text-cyan-200' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}
              onClick={() => {
                setMarket('spot');
                localStorage.setItem(`polybot-spot-ob-market-${panelId}`, 'spot');
              }}
            >
              Spot
            </button>
            <button
              type="button"
              className={`border-l border-gray-600 px-2 py-0.5 text-[9px] font-semibold ${market === 'futures' ? 'bg-cyan-900/75 text-cyan-200' : 'bg-gray-900 text-gray-500 hover:text-gray-300'}`}
              onClick={() => {
                setMarket('futures');
                localStorage.setItem(`polybot-spot-ob-market-${panelId}`, 'futures');
              }}
            >
              Futures
            </button>
          </div>
          <div className={`text-[9px] tabular-nums ${liveClass}`}>
            {liveLabel}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className={COL_ASSET} />
            <col className={COL_UD} />
            {SPOT_OB_MOVE_PCT_LEVELS.map((n) => (
              <col key={n} className={COL_IMPACT} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-[1] bg-gray-900">
            <tr className="text-[9px] font-medium text-gray-500 border-b border-gray-700">
              <th className={`py-1 px-2 font-medium ${COL_ASSET}`}>Asset</th>
              <th className={`py-1 px-1 font-medium text-center ${COL_UD}`}>U/D</th>
              {SPOT_OB_MOVE_PCT_LEVELS.map((n) => (
                <th key={n} className={`py-1 px-1.5 text-right font-medium tabular-nums ${COL_IMPACT}`}>
                  {formatSpotObMovePctLabel(n)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BINANCE_SPOT_OB_ASSETS.map((asset) => (
              <AssetRows
                key={asset}
                asset={asset}
                panel={panels[asset]}
                connected={feed.hasBook && feed.wsLive && feed.allSynced}
                market={market}
                exchanges={exchanges}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
