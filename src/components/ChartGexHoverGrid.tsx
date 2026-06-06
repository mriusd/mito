import type { GexAssetSnapshot, GexExpiryBucket } from '../lib/deribitGexFeed';
import {
  fmtGexStrike,
  fmtPinProb,
  gexPinStrikesDown,
  gexPinStrikesUp,
  pinProbabilities,
  pinRowKey,
  pinRowOpacity,
  type PinRowRef,
} from '../lib/deribitGexFeed';

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtHours(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return '—';
  if (h >= 48) return `${Math.round(h / 24)}d`;
  if (h >= 1) return `${Math.round(h)}h`;
  return `${Math.max(1, Math.round(h * 60))}m`;
}

function topExpiries(expirations: GexExpiryBucket[]): GexExpiryBucket[] {
  return [...expirations].sort((a, b) => a.expiryMs - b.expiryMs).slice(0, 3);
}

function hasPinLadder(row: GexExpiryBucket): boolean {
  return gexPinStrikesDown(row).length > 0 || gexPinStrikesUp(row).length > 0;
}

type PinHoverRow = {
  ref: PinRowRef;
  gex: number | null;
  strike: number | null | undefined;
  dim?: boolean;
};

function pinHoverRows(row: GexExpiryBucket, expanded: boolean): PinHoverRow[] {
  if (!expanded) {
    return [{ ref: { kind: 'main' }, gex: row.pinStrikeGex ?? row.netGex, strike: row.pinStrike }];
  }
  return [
    ...gexPinStrikesDown(row).map((p, idx) => ({
      ref: { kind: 'down' as const, idx },
      gex: p.gex,
      strike: p.strike,
      dim: true,
    })),
    { ref: { kind: 'main' }, gex: row.pinStrikeGex ?? row.netGex, strike: row.pinStrike },
    ...gexPinStrikesUp(row).map((p, idx) => ({
      ref: { kind: 'up' as const, idx },
      gex: p.gex,
      strike: p.strike,
      dim: true,
    })),
  ];
}

export function ChartGexHoverGrid({ gex, source = 'Deribit' }: { gex: GexAssetSnapshot; source?: string }) {
  const negative = gex.regime === 'negative';
  const expiries = topExpiries(gex.expirations ?? []);

  return (
    <div className="mt-2 pt-2 border-t border-gray-700">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[10px] font-bold text-gray-300">
          {gex.asset} {source} GEX
        </div>
        <span
          className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wide ${
            negative ? 'bg-red-900/60 text-red-300' : 'bg-green-900/60 text-green-300'
          }`}
        >
          {negative ? 'NEG γ' : 'POS γ'}
        </span>
      </div>
      <div className="flex justify-between gap-3 text-[9px] mb-1">
        <div className="flex justify-between gap-2 flex-1">
          <span className="text-gray-500">Net/1%</span>
          <span className={`tabular-nums font-bold ${gex.netGex >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {fmtUsd(gex.netGex)}
          </span>
        </div>
        <div className="flex justify-between gap-2 flex-1">
          <span className="text-gray-500">OI</span>
          <span className="tabular-nums text-gray-300">
            {gex.totalOi.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </span>
        </div>
      </div>
      {expiries.length > 0 ? (
        <div>
          <div className="text-[8px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">Top expiries</div>
          <table className="w-full border-collapse text-[8px] tabular-nums">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left py-0.5 pr-1 font-medium">Exp</th>
                <th className="text-left py-0.5 pr-1 font-medium">T−</th>
                <th className="text-right py-0.5 px-0.5 font-medium">Net/1%</th>
                <th className="text-center py-0.5 px-0.5 font-medium">γ</th>
                <th className="text-right py-0.5 px-0.5 font-medium">Pin</th>
                <th className="text-right py-0.5 pl-0.5 font-medium">OI</th>
              </tr>
            </thead>
            <tbody>
              {expiries.map((row, idx) => {
                const neg = row.regime === 'negative';
                const expanded = idx === 0 && hasPinLadder(row);
                const pinProbs = expanded ? pinProbabilities(row) : null;
                const pinRows = pinHoverRows(row, expanded);
                return pinRows.map((pinRow, pinIdx) => {
                  const pinNeg = pinRow.gex != null && pinRow.gex < 0;
                  const pinProb = pinProbs?.get(pinRowKey(row, pinRow.ref));
                  const rowOpacity = expanded ? pinRowOpacity(row, pinRow.ref, pinProbs) : 1;
                  const pinCellStyle = rowOpacity < 1 ? { opacity: rowOpacity } : undefined;
                  return (
                    <tr
                      key={`${row.expiryMs}-${pinIdx}`}
                      className={`border-b border-gray-800/60 ${pinRow.dim && rowOpacity >= 1 ? 'opacity-50' : ''}`}
                    >
                      {pinIdx === 0 ? (
                        <>
                          <td
                            rowSpan={pinRows.length}
                            className="py-0.5 pr-1 text-gray-300 font-semibold whitespace-nowrap align-top"
                          >
                            {row.label}
                          </td>
                          <td
                            rowSpan={pinRows.length}
                            className="py-0.5 pr-1 text-cyan-300/90 whitespace-nowrap align-top"
                          >
                            {fmtHours(row.hoursToExp)}
                          </td>
                        </>
                      ) : null}
                      <td
                        style={pinCellStyle}
                        className={`py-0.5 px-0.5 text-right font-bold ${
                          pinRow.gex == null ? 'text-gray-500' : pinNeg ? 'text-red-400' : 'text-green-400'
                        }`}
                      >
                        {pinRow.gex != null ? fmtUsd(pinRow.gex) : '—'}
                      </td>
                      {pinIdx === 0 ? (
                        <td rowSpan={pinRows.length} className="py-0.5 px-0.5 text-center align-top">
                          <span
                            className={`inline-block min-w-[1.1em] px-0.5 rounded text-[7px] font-bold ${
                              neg ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'
                            }`}
                          >
                            {neg ? 'N' : 'P'}
                          </span>
                        </td>
                      ) : null}
                      <td
                        style={pinCellStyle}
                        className="py-0.5 px-0.5 text-right text-yellow-300/90 whitespace-nowrap"
                      >
                        <span className="inline-flex items-center justify-end gap-0.5 max-w-full">
                          {pinProb != null ? (
                            <span className="text-white text-[7px] tabular-nums">{fmtPinProb(pinProb)}</span>
                          ) : null}
                          <span className={`tabular-nums ${pinRow.ref.kind === 'main' ? 'font-semibold' : ''}`}>
                            {fmtGexStrike(pinRow.strike)}
                          </span>
                        </span>
                      </td>
                      {pinIdx === 0 ? (
                        <td rowSpan={pinRows.length} className="py-0.5 pl-0.5 text-right text-gray-300 align-top">
                          {row.totalOi.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                      ) : null}
                    </tr>
                  );
                });
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
