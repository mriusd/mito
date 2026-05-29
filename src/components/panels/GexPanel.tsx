import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  GEX_ASSETS,
  useDeribitGexConnection,
  useDeribitGexSnapshot,
  type GexAsset,
  type GexAssetSnapshot,
  type GexStrikeBucket,
} from '../../lib/deribitGexFeed';

function readStoredGexAsset(panelId: string): GexAsset {
  const saved = localStorage.getItem(`polybot-gex-asset-${panelId}`);
  return GEX_ASSETS.includes(saved as GexAsset) ? (saved as GexAsset) : 'BTC';
}

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtStrike(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 100000 ? 0 : 1)}k`;
  return v.toFixed(0);
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
  const prevRef = useRef<number | null>(null);
  const display = value == null || !Number.isFinite(value) ? '—' : children(fmtUsd(value));

  useEffect(() => {
    if (value == null || !Number.isFinite(value)) {
      prevRef.current = null;
      return;
    }
    const el = ref.current;
    if (!el) return;
    const prev = prevRef.current;
    if (prev != null && value !== prev) {
      if (mode === 'directional') {
        pulseFlash(el, value > prev ? 'updown-flash-up' : 'updown-flash-down');
      } else {
        pulseFlash(el, 'gex-flash-change');
      }
    }
    prevRef.current = value;
  }, [value, mode]);

  if (typeof display === 'string' && display === '—') {
    return <span className={className}>—</span>;
  }
  return (
    <span ref={ref} className={className}>
      {display}
    </span>
  );
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
  const prevRef = useRef<number | null>(null);

  useEffect(() => {
    if (value == null || !Number.isFinite(value)) {
      prevRef.current = null;
      return;
    }
    const el = ref.current;
    if (!el) return;
    const prev = prevRef.current;
    if (prev != null && value !== prev) {
      if (mode === 'directional') {
        pulseFlash(el, value > prev ? 'updown-flash-up' : 'updown-flash-down');
      } else {
        pulseFlash(el, 'gex-flash-change');
      }
    }
    prevRef.current = value;
  }, [value, mode]);

  if (value == null || !Number.isFinite(value)) {
    return <span className={className}>—</span>;
  }
  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}

const StrikeRow = memo(function StrikeRow({
  bucket,
  spot,
  maxAbs,
}: {
  bucket: GexStrikeBucket;
  spot: number;
  maxAbs: number;
}) {
  const frac = maxAbs > 0 ? Math.min(1, Math.abs(bucket.gex) / maxAbs) : 0;
  const positive = bucket.gex >= 0;
  const nearSpot = Math.abs(bucket.strike - spot) / spot < 0.012;
  return (
    <div className="flex items-center gap-1 h-[14px]">
      <div
        className={`w-[42px] shrink-0 text-right text-[9px] tabular-nums ${
          nearSpot ? 'text-yellow-300 font-bold' : 'text-gray-400'
        }`}
      >
        {fmtStrike(bucket.strike)}
      </div>
      <div className="relative flex-1 h-[11px] flex items-center">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-700" />
        <div className="absolute left-1/2 right-0 flex items-center justify-start">
          {positive ? (
            <div
              className="h-[9px] bg-green-500/70 rounded-sm"
              style={{ width: `${frac * 100}%` }}
              title={fmtUsd(bucket.gex)}
            />
          ) : null}
        </div>
        <div className="absolute left-0 right-1/2 flex items-center justify-end">
          {!positive ? (
            <div
              className="h-[9px] bg-red-500/70 rounded-sm"
              style={{ width: `${frac * 100}%` }}
              title={fmtUsd(bucket.gex)}
            />
          ) : null}
        </div>
      </div>
      <GexFlashValue
        value={bucket.gex}
        mode="directional"
        className={`w-[48px] shrink-0 text-[9px] tabular-nums text-right ${
          positive ? 'text-green-400/90' : 'text-red-400/90'
        }`}
      >
        {(s) => s}
      </GexFlashValue>
    </div>
  );
});

function AssetGex({ snap }: { snap: GexAssetSnapshot }) {
  const negative = snap.regime === 'negative';
  const maxAbs = snap.strikes.reduce((m, s) => Math.max(m, Math.abs(s.gex)), 0);
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
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px] font-bold text-white">{snap.asset}</span>
          <GexFlashText
            value={snap.spot}
            mode="directional"
            className="text-[10px] tabular-nums text-gray-400"
            format={(p) => `$${p.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          />
        </div>
        <span
          ref={regimeRef}
          className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide ${
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

      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9.5px] mb-1.5">
        <div className="flex justify-between">
          <span className="text-gray-500">Net GEX/1%</span>
          <GexFlashValue
            value={snap.netGex}
            mode="directional"
            className={`tabular-nums font-bold ${snap.netGex >= 0 ? 'text-green-400' : 'text-red-400'}`}
          >
            {(s) => s}
          </GexFlashValue>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">γ-flip</span>
          <span className="tabular-nums text-gray-200">
            {snap.gammaFlip != null ? (
              <>
                <GexFlashText value={snap.gammaFlip} format={fmtStrike} /> ({pctTo(snap.spot, snap.gammaFlip)})
              </>
            ) : (
              '—'
            )}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Put wall</span>
          <span className="tabular-nums text-red-300/90">
            <GexFlashText value={snap.putWall} format={fmtStrike} />{' '}
            <span className="text-gray-600">{pctTo(snap.spot, snap.putWall)}</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Call wall</span>
          <span className="tabular-nums text-green-300/90">
            <GexFlashText value={snap.callWall} format={fmtStrike} />{' '}
            <span className="text-gray-600">{pctTo(snap.spot, snap.callWall)}</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Pin</span>
          <span className="tabular-nums text-yellow-300/90">
            <GexFlashText value={snap.pinStrike} format={fmtStrike} />{' '}
            <span className="text-gray-600">{pctTo(snap.spot, snap.pinStrike)}</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">OI</span>
          <GexFlashText
            value={snap.totalOi}
            className="tabular-nums text-gray-300"
            format={(v) => v.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          />
        </div>
      </div>

      <div className="text-[8px] text-gray-500 mb-0.5 px-1">dealer $γ per 1% by strike (red=short/amplify · green=long/dampen)</div>
      <div className="flex flex-col gap-px">
        {snap.strikes.length === 0 ? (
          <div className="text-[9px] text-gray-600 px-1">no strikes</div>
        ) : (
          snap.strikes.map((b) => <StrikeRow key={b.strike} bucket={b} spot={snap.spot} maxAbs={maxAbs} />)
        )}
      </div>
    </div>
  );
}

export function GexPanel({ panelId }: { panelId: string }) {
  useDeribitGexConnection(true);
  const snap = useDeribitGexSnapshot();
  const [asset, setAsset] = useState<GexAsset>(() => readStoredGexAsset(panelId));

  const selected = snap?.assets[asset] ?? null;

  return (
    <div className="panel-wrapper flex h-full min-h-0 flex-col overflow-hidden rounded-lg bg-gray-800/50 p-3">
      <div className="panel-header mb-1.5 flex items-center justify-between gap-2 shrink-0 cursor-grab">
        <div className="text-[11px] font-bold text-yellow-400">Dealer GEX (Deribit)</div>
        <div className="no-drag" onMouseDown={(e) => e.stopPropagation()}>
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
          <AssetGex key={asset} snap={selected} />
        ) : (
          <div className="text-[10px] text-gray-500 p-2">Connecting to Deribit option chain…</div>
        )}
      </div>
    </div>
  );
}
