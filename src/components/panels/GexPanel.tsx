import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  GEX_ASSETS,
  GEX_SOURCES,
  GEX_SOURCE_LABELS,
  useGexConnection,
  useGexSnapshot,
  gexReferenceSpot,
  type GexAsset,
  type GexAssetSnapshot,
  type GexSource,
  fmtGexStrike,
} from '../../lib/deribitGexFeed';
import { GexExpirationsTable } from '../GexExpirationsTable';
import { GexPinChart } from '../GexPinChart';

function readStoredGexAsset(panelId: string): GexAsset {
  const saved = localStorage.getItem(`polybot-gex-asset-${panelId}`);
  return GEX_ASSETS.includes(saved as GexAsset) ? (saved as GexAsset) : 'BTC';
}

function readStoredGexSource(panelId: string): GexSource {
  const saved = localStorage.getItem(`polybot-gex-source-${panelId}`);
  return GEX_SOURCES.includes(saved as GexSource) ? (saved as GexSource) : 'deribit';
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function pctTo(spot: number, level: number | null | undefined): string {
  if (level == null || !Number.isFinite(level) || spot <= 0) return '';
  const p = ((level - spot) / spot) * 100;
  const s = p >= 0 ? '+' : '';
  return `${s}${p.toFixed(1)}%`;
}

const FLASH_CLASSES = ['updown-flash-up', 'updown-flash-down', 'gex-flash-change'] as const;

function pulseFlash(el: HTMLElement, cls: (typeof FLASH_CLASSES)[number]): void {
  el.classList.remove(...FLASH_CLASSES);
  void el.offsetWidth;
  el.classList.add(cls);
}

type GexFlashMode = 'directional' | 'change';

function useGexValueFlash(
  ref: RefObject<HTMLElement | null>,
  value: number | null | undefined,
  format: (v: number) => string,
  mode: GexFlashMode,
): void {
  const formatRef = useRef(format);
  formatRef.current = format;
  const prevRawRef = useRef<number | null>(null);
  const prevFmtRef = useRef<string | null>(null);

  useEffect(() => {
    if (value == null || !Number.isFinite(value)) {
      prevRawRef.current = null;
      prevFmtRef.current = null;
      return;
    }
    const el = ref.current;
    if (!el) return;
    const fmt = formatRef.current(value);
    const prevRaw = prevRawRef.current;
    const prevFmt = prevFmtRef.current;
    if (prevRaw != null && prevFmt != null && prevFmt !== fmt) {
      if (mode === 'directional') {
        pulseFlash(el, value > prevRaw ? 'updown-flash-up' : 'updown-flash-down');
      } else {
        pulseFlash(el, 'gex-flash-change');
      }
    }
    prevRawRef.current = value;
    prevFmtRef.current = fmt;
  }, [value, mode, ref]);
}

function GexFlashValue({
  value,
  className,
  mode = 'directional',
  children,
}: {
  value: number | null | undefined;
  className?: string;
  mode?: GexFlashMode;
  children: (formatted: string) => ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useGexValueFlash(ref, value, fmtUsd, mode);
  const display = value == null || !Number.isFinite(value) ? '—' : children(fmtUsd(value));

  if (typeof display === 'string' && display === '—') {
    return <span className={className}>—</span>;
  }
  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
}

function formatGexSpot(v: number): string {
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatGexOi(v: number): string {
  return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function GexFlashText({
  value,
  className,
  format,
  mode = 'change',
}: {
  value: number | null | undefined;
  className?: string;
  format: (v: number) => string;
  mode?: GexFlashMode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useGexValueFlash(ref, value, format, mode);

  if (value == null || !Number.isFinite(value)) {
    return <span className={className}>—</span>;
  }
  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}

function AssetGex({ snap }: { snap: GexAssetSnapshot }) {
  const negative = snap.regime === 'negative';
  const idx = gexReferenceSpot(snap);
  const regimeRef = useRef<HTMLSpanElement>(null);
  const prevRegimeRef = useRef<string | null>(null);

  useEffect(() => {
    const el = regimeRef.current;
    if (!el) return;
    const prev = prevRegimeRef.current;
    if (prev != null && prev !== snap.regime) {
      pulseFlash(el, 'gex-flash-change');
    }
    prevRegimeRef.current = snap.regime;
  }, [snap.regime]);

  return (
    <div className="mb-3 last:mb-0 border-b border-gray-800 pb-2 last:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.15fr)] grid-rows-[auto_auto_auto] gap-x-2 gap-y-0 text-[9px] leading-tight mb-1.5">
        <div className="col-span-3 row-start-1 flex items-center gap-1.5 min-w-0 flex-wrap">
          <span className="text-[11px] font-bold text-white leading-none">{snap.asset}</span>
          <GexFlashText
            value={idx}
            mode="directional"
            className="text-[10px] tabular-nums text-gray-400 leading-none"
            format={formatGexSpot}
          />
          <span className="text-[8px] text-gray-600 leading-none" title="Deribit composite index (btc_usd / eth_usd)">
            idx
          </span>
          <span
            ref={regimeRef}
            className={`px-1 py-px rounded text-[8px] font-bold uppercase tracking-wide leading-none ${
              negative ? 'bg-red-900/60 text-red-300' : 'bg-green-900/60 text-green-300'
            }`}
            title={
              negative
                ? 'Dealers short gamma → hedging amplifies moves. Easiest regime to push price.'
                : 'Dealers long gamma → hedging dampens moves. Price tends to pin near big strikes.'
            }
          >
            {negative ? 'NEG γ · unstable' : 'POS γ · pinned'}
          </span>
        </div>
        <div className="row-span-3 row-start-1 col-start-4 flex min-h-0 min-w-0 w-full self-stretch">
          <GexPinChart expirations={snap.expirations} spot={idx} compact />
        </div>
        <div className="row-start-2 flex justify-between gap-1 min-w-0 items-center">
          <span className="text-gray-500 shrink-0">Net GEX/1%</span>
          <GexFlashValue
            value={snap.netGex}
            mode="directional"
            className={`tabular-nums font-bold truncate ${snap.netGex >= 0 ? 'text-green-400' : 'text-red-400'}`}
          >
            {(s) => s}
          </GexFlashValue>
        </div>
        <div className="row-start-2 flex justify-between gap-1 min-w-0 items-center">
          <span className="text-gray-500 shrink-0">γ-flip</span>
          <span className="tabular-nums text-gray-200 truncate text-right">
            {snap.gammaFlip != null ? (
              <>
                <GexFlashText value={snap.gammaFlip} format={fmtGexStrike} /> ({pctTo(idx, snap.gammaFlip)})
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="row-start-2 flex justify-between gap-1 min-w-0 items-center">
          <span className="text-gray-500 shrink-0">Put wall</span>
          <span className="tabular-nums text-red-300/90 truncate text-right">
            <GexFlashText value={snap.putWall} format={fmtGexStrike} />{' '}
            <span className="text-gray-600">{pctTo(idx, snap.putWall)}</span>
          </span>
        </div>
        <div className="row-start-3 flex justify-between gap-1 min-w-0 items-center">
          <span className="text-gray-500 shrink-0">Call wall</span>
          <span className="tabular-nums text-green-300/90 truncate text-right">
            <GexFlashText value={snap.callWall} format={fmtGexStrike} />{' '}
            <span className="text-gray-600">{pctTo(idx, snap.callWall)}</span>
          </span>
        </div>
        <div className="row-start-3 flex justify-between gap-1 min-w-0 items-center">
          <span className="text-gray-500 shrink-0">Pin</span>
          <span className="tabular-nums text-yellow-300/90 truncate text-right">
            <GexFlashText value={snap.pinStrike} format={fmtGexStrike} />{' '}
            <span className="text-gray-600">{pctTo(idx, snap.pinStrike)}</span>
          </span>
        </div>
        <div className="row-start-3 flex justify-between gap-1 min-w-0 items-center">
          <span className="text-gray-500 shrink-0">OI</span>
          <GexFlashText
            value={snap.totalOi}
            className="tabular-nums text-gray-300 truncate text-right"
            format={formatGexOi}
          />
        </div>
      </div>

      <GexExpirationsTable expirations={snap.expirations} spot={idx} />
    </div>
  );
}

export function GexPanel({ panelId }: { panelId: string }) {
  const [source, setSource] = useState<GexSource>(() => readStoredGexSource(panelId));
  const [asset, setAsset] = useState<GexAsset>(() => readStoredGexAsset(panelId));
  useGexConnection(source, true);
  const snap = useGexSnapshot(source);

  const selected = snap?.assets[asset] ?? null;

  return (
    <div className="panel-wrapper flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-gray-800/50 p-3">
      <div className="panel-header mb-1.5 flex items-center justify-between gap-2 shrink-0 cursor-grab">
        <div className="text-[11px] font-bold text-yellow-400">Dealer GEX ({GEX_SOURCE_LABELS[source]})</div>
        <div className="no-drag flex items-center gap-1" onMouseDown={(e) => e.stopPropagation()}>
          <select
            className="rounded border border-gray-600 bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-gray-200 focus:outline-none"
            value={source}
            onChange={(e) => {
              const next = e.target.value as GexSource;
              setSource(next);
              localStorage.setItem(`polybot-gex-source-${panelId}`, next);
            }}
          >
            {GEX_SOURCES.map((s) => (
              <option key={s} value={s}>
                {GEX_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
          <select
            className="rounded border border-gray-600 bg-gray-900 px-1.5 py-0.5 text-[10px] font-semibold text-gray-200 focus:outline-none"
            value={asset}
            onChange={(e) => {
              const next = e.target.value as GexAsset;
              setAsset(next);
              localStorage.setItem(`polybot-gex-asset-${panelId}`, next);
            }}
          >
            {GEX_ASSETS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {selected ? (
          <AssetGex key={`${source}-${asset}`} snap={selected} />
        ) : (
          <div className="text-[10px] text-gray-500 p-2">
            Connecting to {GEX_SOURCE_LABELS[source]} option chain…
          </div>
        )}
      </div>
    </div>
  );
}
