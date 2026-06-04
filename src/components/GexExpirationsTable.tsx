import { useEffect, useState } from 'react';
import type { GexExpiryBucket } from '../lib/deribitGexFeed';
import { fmtGexStrike } from '../lib/deribitGexFeed';

const H72_MS = 72 * 60 * 60 * 1000;

function fmtUsd(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

function fmtPinFlipGap(
  pin: number | null | undefined,
  flip: number | null | undefined,
): { text: string; tight: boolean } | null {
  if (pin == null || flip == null || !Number.isFinite(pin) || !Number.isFinite(flip) || pin <= 0) {
    return null;
  }
  const pct = ((flip - pin) / pin) * 100;
  const s = pct >= 0 ? '+' : '';
  return { text: `${s}${pct.toFixed(1)}%`, tight: Math.abs(pct) < 1 };
}

function pctFromSpot(spot: number, level: number | null | undefined): string {
  if (level == null || !Number.isFinite(level) || spot <= 0) return '—';
  const p = ((level - spot) / spot) * 100;
  const s = p >= 0 ? '+' : '';
  return `${s}${p.toFixed(1)}%`;
}

const PIN_AT_SPOT_DEV_PCT = 0.1;

function spotPinDevPct(spot: number, pin: number): number {
  return (Math.abs(spot - pin) / pin) * 100;
}

function pinVsSpotBias(
  spot: number | undefined,
  pin: number | null | undefined,
): 'up' | 'down' | null {
  if (spot == null || spot <= 0 || pin == null || !Number.isFinite(pin) || pin <= 0) return null;
  if (spotPinDevPct(spot, pin) < PIN_AT_SPOT_DEV_PCT) return null;
  if (pin > spot) return 'up';
  if (pin < spot) return 'down';
  return null;
}

function PinBiasPill({ spot, pin }: { spot?: number; pin: number | null | undefined }) {
  if (spot == null || spot <= 0 || pin == null || !Number.isFinite(pin) || pin <= 0) return null;
  const devPct = spotPinDevPct(spot, pin);
  if (devPct < PIN_AT_SPOT_DEV_PCT) {
    return (
      <span
        className="inline-block mr-0.5 px-0.5 rounded text-[7px] font-bold leading-none bg-blue-900/55 text-blue-300"
        title={`Spot within ${devPct.toFixed(2)}% of pin`}
      >
        PIN
      </span>
    );
  }
  const bias = pinVsSpotBias(spot, pin);
  if (bias == null) return null;
  const up = bias === 'up';
  return (
    <span
      className={`inline-block mr-0.5 px-0.5 rounded text-[7px] font-bold leading-none ${
        up ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'
      }`}
      title={up ? 'Pin above spot' : 'Pin below spot'}
    >
      {up ? 'UP' : 'DOWN'}
    </span>
  );
}

function fmtCountdown(expiryMs: number, nowMs: number): string {
  const ms = expiryMs - nowMs;
  if (ms <= 0) return '0s';
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}:${String(s).padStart(2, '0')}`;
  return `${s}s`;
}

type GexExpirationsTableProps = {
  expirations: GexExpiryBucket[];
  spot?: number;
  compact?: boolean;
};

export function GexExpirationsTable({ expirations, spot, compact = false }: GexExpirationsTableProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const upcoming = expirations.filter((row) => {
    const ms = row.expiryMs - now;
    if (ms <= 0) return false;
    if (compact) return ms <= H72_MS;
    return true;
  });

  if (upcoming.length === 0) return null;
  const nearest = upcoming[0];
  const nearestPin = nearest?.pinStrike;
  const nearestFlip = nearest?.gammaFlip;
  const nearestGap = fmtPinFlipGap(nearestPin, nearestFlip);
  const text = compact ? 'text-[8px]' : 'text-[9px]';
  return (
    <div className={compact ? 'mt-1.5' : 'mb-1.5'}>
      <div className={`${text} font-semibold text-gray-400 uppercase tracking-wide mb-1`}>
        {compact ? 'Next 72h expiries' : 'Expiries'}
      </div>
      <div className="overflow-x-auto">
        <table className={`w-full border-collapse ${text} tabular-nums`}>
          <thead>
            <tr className="text-gray-500 border-b border-gray-800">
              <th className="text-left py-0.5 pr-1 font-medium">Exp</th>
              <th className="text-left py-0.5 pr-0.5 font-medium w-0">T−</th>
              <th className="text-right py-0.5 px-0.5 font-medium">Net/1%</th>
              <th className="text-center py-0.5 px-0.5 font-medium">γ</th>
              <th className="text-right py-0.5 px-0.5 font-medium">OI</th>
              <th className="text-right py-0.5 px-0.5 font-medium">Pin</th>
              {!compact ? (
                <>
                  <th className="text-right py-0.5 px-0.5 font-medium">C/P</th>
                  <th className="text-right py-0.5 px-0.5 font-medium">Flip</th>
                  <th className="text-right py-0.5 pl-0.5 font-medium" title="Flip minus pin (% of pin)">
                    P↔F
                  </th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {upcoming.map((row) => {
              const neg = row.regime === 'negative';
              const urgent = row.expiryMs - now <= 60 * 60 * 1000;
              const pinFlipGap = fmtPinFlipGap(row.pinStrike, row.gammaFlip);
              return (
                <tr key={row.expiryMs} className="border-b border-gray-800/60">
                  <td className="py-0.5 pr-1 text-gray-300 whitespace-nowrap font-semibold">{row.label}</td>
                  <td
                    className={`py-0.5 pr-0.5 whitespace-nowrap font-bold tracking-tight ${
                      urgent ? 'text-amber-300' : 'text-cyan-300/90'
                    }`}
                  >
                    {fmtCountdown(row.expiryMs, now)}
                  </td>
                  <td className={`py-0.5 px-0.5 text-right font-bold ${neg ? 'text-red-400' : 'text-green-400'}`}>
                    {fmtUsd(row.netGex)}
                  </td>
                  <td className="py-0.5 px-0.5 text-center">
                    <span
                      className={`inline-block min-w-[1.1em] px-0.5 rounded text-[7px] font-bold ${
                        neg ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'
                      }`}
                    >
                      {neg ? 'N' : 'P'}
                    </span>
                  </td>
                  <td className="py-0.5 px-0.5 text-right text-gray-300">
                    {row.totalOi.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                  </td>
                  <td className="py-0.5 px-0.5 text-right text-yellow-300/90 whitespace-nowrap">
                    <span className="inline-flex items-center justify-end gap-0.5 max-w-full">
                      <span className="text-gray-500 text-[8px] tabular-nums" title="Next pin down">
                        {row.pinStrikeDown != null ? fmtGexStrike(row.pinStrikeDown) : '—'}
                      </span>
                      <PinBiasPill spot={spot} pin={row.pinStrike} />
                      <span className="font-semibold tabular-nums">{fmtGexStrike(row.pinStrike)}</span>
                      <span className="text-gray-500 text-[8px] tabular-nums" title="Next pin up">
                        {row.pinStrikeUp != null ? fmtGexStrike(row.pinStrikeUp) : '—'}
                      </span>
                    </span>
                  </td>
                  {!compact ? (
                    <>
                      <td className="py-0.5 px-0.5 text-right text-gray-400 whitespace-nowrap">
                        {row.callOi.toLocaleString(undefined, { maximumFractionDigits: 0 })}/
                        {row.putOi.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </td>
                      <td className="py-0.5 px-0.5 text-right text-gray-300">{fmtGexStrike(row.gammaFlip)}</td>
                      <td
                        className={`py-0.5 pl-0.5 text-right whitespace-nowrap ${
                          pinFlipGap?.tight ? 'text-amber-300 font-bold' : 'text-gray-400'
                        }`}
                      >
                        {pinFlipGap?.text ?? '—'}
                      </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!compact && spot != null && spot > 0 && nearestGap ? (
        <div className={`${text} text-gray-500 mt-1 px-0.5 leading-snug`}>
          <span className="text-gray-400 font-semibold">{nearest.label}</span>
          {' · '}
          pin {fmtGexStrike(nearestPin)} ({pctFromSpot(spot, nearestPin)} spot)
          {' · '}
          flip {fmtGexStrike(nearestFlip)} ({pctFromSpot(spot, nearestFlip)} spot)
          {' · '}
          <span className={nearestGap.tight ? 'text-amber-300/90' : ''}>
            pin→flip {nearestGap.text}
          </span>
        </div>
      ) : null}
    </div>
  );
}
