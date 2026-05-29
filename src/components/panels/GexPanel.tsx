import { memo } from 'react';
import {
  GEX_ASSETS,
  useDeribitGexConnection,
  useDeribitGexSnapshot,
  type GexAssetSnapshot,
  type GexStrikeBucket,
} from '../../lib/deribitGexFeed';

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
      <div
        className={`w-[48px] shrink-0 text-[9px] tabular-nums text-right ${
          positive ? 'text-green-400/90' : 'text-red-400/90'
        }`}
      >
        {fmtUsd(bucket.gex)}
      </div>
    </div>
  );
});

function AssetGex({ snap }: { snap: GexAssetSnapshot }) {
  const negative = snap.regime === 'negative';
  const maxAbs = snap.strikes.reduce((m, s) => Math.max(m, Math.abs(s.gex)), 0);
  return (
    <div className="mb-3 last:mb-0 border-b border-gray-800 pb-2 last:border-b-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[12px] font-bold text-white">{snap.asset}</span>
          <span className="text-[10px] tabular-nums text-gray-400">${snap.spot.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
        </div>
        <span
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
          <span className={`tabular-nums font-bold ${snap.netGex >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {fmtUsd(snap.netGex)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">γ-flip</span>
          <span className="tabular-nums text-gray-200">
            {snap.gammaFlip != null ? `${fmtStrike(snap.gammaFlip)} (${pctTo(snap.spot, snap.gammaFlip)})` : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Put wall</span>
          <span className="tabular-nums text-red-300/90">
            {fmtStrike(snap.putWall)} <span className="text-gray-600">{pctTo(snap.spot, snap.putWall)}</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Call wall</span>
          <span className="tabular-nums text-green-300/90">
            {fmtStrike(snap.callWall)} <span className="text-gray-600">{pctTo(snap.spot, snap.callWall)}</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Pin</span>
          <span className="tabular-nums text-yellow-300/90">
            {fmtStrike(snap.pinStrike)} <span className="text-gray-600">{pctTo(snap.spot, snap.pinStrike)}</span>
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">OI</span>
          <span className="tabular-nums text-gray-300">{snap.totalOi.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
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

export function GexPanel() {
  useDeribitGexConnection(true);
  const snap = useDeribitGexSnapshot();

  const hasData = snap != null && GEX_ASSETS.some((a) => snap.assets[a] != null);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-gray-900/40 p-2">
      <div className="panel-header mb-1.5 flex items-center justify-between gap-2 shrink-0 cursor-grab">
        <div className="text-[11px] font-bold text-yellow-400">Dealer GEX (Deribit)</div>
        <div className="text-[8px] text-gray-500">net gamma exposure</div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {!hasData ? (
          <div className="text-[10px] text-gray-500 p-2">Connecting to Deribit option chain…</div>
        ) : (
          GEX_ASSETS.map((asset) => {
            const a = snap!.assets[asset];
            return a ? <AssetGex key={asset} snap={a} /> : null;
          })
        )}
      </div>
    </div>
  );
}
