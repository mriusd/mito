import type { GexAssetSnapshot } from '../lib/deribitGexFeed';

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
  return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
}

export function ChartGexHoverGrid({ gex }: { gex: GexAssetSnapshot }) {
  const negative = gex.regime === 'negative';
  const maxAbs = gex.strikes.reduce((m, s) => Math.max(m, Math.abs(s.gex)), 0);
  return (
    <div className="mt-2 pt-2 border-t border-gray-700">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] font-bold text-gray-300">{gex.asset} Dealer GEX</div>
        <span
          className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide ${
            negative ? 'bg-red-900/60 text-red-300' : 'bg-green-900/60 text-green-300'
          }`}
        >
          {negative ? 'NEG γ · unstable' : 'POS γ · pinned'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px] mb-1.5">
        <div className="flex justify-between">
          <span className="text-gray-500">Net/1%</span>
          <span className={`tabular-nums font-bold ${gex.netGex >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {fmtUsd(gex.netGex)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">γ-flip</span>
          <span className="tabular-nums text-gray-200">
            {gex.gammaFlip != null ? `${fmtStrike(gex.gammaFlip)} (${pctTo(gex.spot, gex.gammaFlip)})` : '—'}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Put wall</span>
          <span className="tabular-nums text-red-300/90">{fmtStrike(gex.putWall)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Call wall</span>
          <span className="tabular-nums text-green-300/90">{fmtStrike(gex.callWall)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Pin</span>
          <span className="tabular-nums text-yellow-300/90">{fmtStrike(gex.pinStrike)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-500">Spot</span>
          <span className="tabular-nums text-gray-300">{fmtStrike(gex.spot)}</span>
        </div>
      </div>
      <div className="flex flex-col gap-px">
        {gex.strikes.map((b) => {
          const frac = maxAbs > 0 ? Math.min(1, Math.abs(b.gex) / maxAbs) : 0;
          const positive = b.gex >= 0;
          const nearSpot = gex.spot > 0 && Math.abs(b.strike - gex.spot) / gex.spot < 0.012;
          return (
            <div key={b.strike} className="flex items-center gap-1 h-[12px]">
              <div className={`w-[40px] shrink-0 text-right text-[8px] tabular-nums ${nearSpot ? 'text-yellow-300 font-bold' : 'text-gray-400'}`}>
                {fmtStrike(b.strike)}
              </div>
              <div className="relative flex-1 h-[9px] flex items-center">
                <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-700" />
                <div className="absolute left-1/2 right-0 flex justify-start">
                  {positive ? <div className="h-[8px] bg-green-500/70 rounded-sm" style={{ width: `${frac * 100}%` }} /> : null}
                </div>
                <div className="absolute left-0 right-1/2 flex justify-end">
                  {!positive ? <div className="h-[8px] bg-red-500/70 rounded-sm" style={{ width: `${frac * 100}%` }} /> : null}
                </div>
              </div>
              <div className={`w-[44px] shrink-0 text-[8px] tabular-nums text-right ${positive ? 'text-green-400/90' : 'text-red-400/90'}`}>
                {fmtUsd(b.gex)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
