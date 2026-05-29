import type { GexExpiryBucket } from '../lib/deribitGexFeed';

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

function fmtHoursToExp(h: number): string {
  if (!Number.isFinite(h) || h <= 0) return '0h';
  if (h < 24) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

type GexExpirationsTableProps = {
  expirations: GexExpiryBucket[];
  compact?: boolean;
};

export function GexExpirationsTable({ expirations, compact = false }: GexExpirationsTableProps) {
  if (expirations.length === 0) return null;
  const text = compact ? 'text-[8px]' : 'text-[9px]';
  return (
    <div className={compact ? 'mt-1.5' : 'mb-1.5'}>
      <div className={`${text} font-semibold text-gray-400 uppercase tracking-wide mb-1`}>Upcoming expiries</div>
      <div className="overflow-x-auto">
        <table className={`w-full border-collapse ${text} tabular-nums`}>
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-0.5 pr-1 font-medium">Exp</th>
              <th className="text-right py-0.5 px-0.5 font-medium">Net/1%</th>
              <th className="text-center py-0.5 px-0.5 font-medium">γ</th>
              <th className="text-right py-0.5 px-0.5 font-medium">OI</th>
              {!compact ? (
                <>
                  <th className="text-right py-0.5 px-0.5 font-medium">C/P</th>
                  <th className="text-right py-0.5 px-0.5 font-medium">Flip</th>
                  <th className="text-right py-0.5 pl-0.5 font-medium">Pin</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {expirations.map((row) => {
              const neg = row.regime === 'negative';
              return (
                <tr key={row.expiryMs} className="border-b border-gray-800/60">
                  <td className="py-0.5 pr-1 text-gray-300 whitespace-nowrap">
                    <span className="font-semibold">{row.label}</span>
                    <span className="text-gray-600 ml-1">{fmtHoursToExp(row.hoursToExp)}</span>
                  </td>
                  <td className={`py-0.5 px-0.5 text-right font-bold ${neg ? 'text-red-400' : 'text-green-400'}`}>
                    {fmtUsd(row.netGex)}
                  </td>
                  <td className="py-0.5 px-0.5 text-center">
                    <span
                      className={`inline-block px-1 rounded text-[7px] font-bold uppercase ${
                        neg ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'
                      }`}
                    >
                      {neg ? 'neg' : 'pos'}
                    </span>
                  </td>
                  <td className="py-0.5 px-0.5 text-right text-gray-300">
                    {row.totalOi.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  {!compact ? (
                    <>
                      <td className="py-0.5 px-0.5 text-right text-gray-400 whitespace-nowrap">
                        {row.callOi.toLocaleString(undefined, { maximumFractionDigits: 0 })}/
                        {row.putOi.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="py-0.5 px-0.5 text-right text-gray-300">{fmtStrike(row.gammaFlip)}</td>
                      <td className="py-0.5 pl-0.5 text-right text-yellow-300/90">{fmtStrike(row.pinStrike)}</td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
