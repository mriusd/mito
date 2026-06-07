import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { GexExpiryBucket } from '../lib/deribitGexFeed';
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

function nearestPinRows(row: GexExpiryBucket): PinRowRef[] {
  const downs = gexPinStrikesDown(row);
  const ups = gexPinStrikesUp(row);
  return [
    ...downs.map((_, idx) => ({ kind: 'down' as const, idx })),
    { kind: 'main' as const },
    ...ups.map((_, idx) => ({ kind: 'up' as const, idx })),
  ];
}

function pinForRef(row: GexExpiryBucket, ref: PinRowRef): number | null | undefined {
  if (ref.kind === 'down') return gexPinStrikesDown(row)[ref.idx]?.strike;
  if (ref.kind === 'up') return gexPinStrikesUp(row)[ref.idx]?.strike;
  return row.pinStrike;
}

function pinGexForRef(row: GexExpiryBucket, ref: PinRowRef): number | null {
  if (ref.kind === 'down') return gexPinStrikesDown(row)[ref.idx]?.gex ?? null;
  if (ref.kind === 'up') return gexPinStrikesUp(row)[ref.idx]?.gex ?? null;
  return row.pinStrikeGex ?? row.netGex;
}

function hasPinLadder(row: GexExpiryBucket): boolean {
  return gexPinStrikesDown(row).length > 0 || gexPinStrikesUp(row).length > 0;
}

function pinProbMassAboveBelowSpot(
  row: GexExpiryBucket,
  spot: number,
  pinProbs: Map<string, number>,
): { above: number; below: number } {
  let above = 0;
  let below = 0;
  for (const ref of nearestPinRows(row)) {
    const prob = pinProbs.get(pinRowKey(row, ref)) ?? 0;
    if (prob <= 0) continue;
    const strike = pinForRef(row, ref);
    if (strike == null || !Number.isFinite(strike)) continue;
    if (strike > spot) above += prob;
    else if (strike < spot) below += prob;
  }
  return { above, below };
}

function PinProbSpotMass({
  row,
  spot,
  pinProbs,
}: {
  row: GexExpiryBucket;
  spot: number;
  pinProbs: Map<string, number>;
}) {
  const { above, below } = pinProbMassAboveBelowSpot(row, spot, pinProbs);
  if (above <= 0 && below <= 0) return null;
  return (
    <div className="inline-flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold tabular-nums leading-none">
      {above > 0 ? (
        <span className="text-green-400" title="Σ P(pin) for strikes above index">
          <span aria-hidden>▲</span> {fmtPinProb(above)}
        </span>
      ) : null}
      {below > 0 ? (
        <span className="text-red-400" title="Σ P(pin) for strikes below index">
          <span aria-hidden>▼</span> {fmtPinProb(below)}
        </span>
      ) : null}
    </div>
  );
}

function ExpiryLabelCell({
  label,
  expandable,
  expanded,
  onToggle,
}: {
  label: string;
  expandable?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-0.5 min-w-0">
      {expandable ? (
        <button
          type="button"
          className="no-drag shrink-0 p-0 text-gray-500 hover:text-gray-300"
          onClick={(e) => {
            e.stopPropagation();
            onToggle?.();
          }}
          onMouseDown={(e) => e.stopPropagation()}
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse pin ladder' : 'Expand pin ladder'}
        >
          {expanded ? (
            <ChevronDown size={10} strokeWidth={2} aria-hidden />
          ) : (
            <ChevronRight size={10} strokeWidth={2} aria-hidden />
          )}
        </button>
      ) : null}
      <span>{label}</span>
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

function pinLadderExpandedKey(panelId?: string): string {
  return panelId ? `polybot-gex-pin-ladder-expanded-${panelId}` : 'polybot-gex-pin-ladder-expanded';
}

function readPinLadderExpanded(panelId?: string): boolean {
  try {
    return localStorage.getItem(pinLadderExpandedKey(panelId)) === '1';
  } catch {
    return false;
  }
}

type GexExpirationsTableProps = {
  expirations: GexExpiryBucket[];
  spot?: number;
  compact?: boolean;
  panelId?: string;
};

export function GexExpirationsTable({ expirations, spot, compact = false, panelId }: GexExpirationsTableProps) {
  const [now, setNow] = useState(() => Date.now());
  const [pinLadderExpanded, setPinLadderExpanded] = useState(() => readPinLadderExpanded(panelId));

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (compact) return;
    try {
      localStorage.setItem(pinLadderExpandedKey(panelId), pinLadderExpanded ? '1' : '0');
    } catch {
      /* ignore quota / private mode */
    }
  }, [pinLadderExpanded, panelId, compact]);

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
            {upcoming.map((row, index) => {
              const neg = row.regime === 'negative';
              const urgent = row.expiryMs - now <= 60 * 60 * 1000;
              const pinFlipGap = fmtPinFlipGap(row.pinStrike, row.gammaFlip);
              const canPinLadder = !compact && index === 0 && hasPinLadder(row);
              const splitNearestPins = canPinLadder && pinLadderExpanded;
              const pinProbs = canPinLadder ? pinProbabilities(row) : null;

              if (splitNearestPins) {
                const pinKinds = nearestPinRows(row);
                const rowSpan = pinKinds.length;
                const showSpotPinMass = spot != null && spot > 0 && pinProbs != null;
                return pinKinds.map((ref, pinIdx) => {
                  const pinProb = pinProbs?.get(pinRowKey(row, ref));
                  const pin = pinForRef(row, ref);
                  const pinGex = pinGexForRef(row, ref);
                  const pinGexNeg = pinGex != null && pinGex < 0;
                  const rowOpacity = pinRowOpacity(row, ref, pinProbs);
                  const pinCellStyle = rowOpacity < 1 ? { opacity: rowOpacity } : undefined;
                  return (
                    <tr key={pinRowKey(row, ref)} className="border-b border-gray-800/60">
                      {pinIdx === 0 ? (
                        <>
                          <td
                            rowSpan={rowSpan}
                            className="py-0.5 pr-1 text-gray-300 whitespace-nowrap font-semibold align-top"
                          >
                            <ExpiryLabelCell
                              label={row.label}
                              expandable={canPinLadder}
                              expanded={pinLadderExpanded}
                              onToggle={() => setPinLadderExpanded((v) => !v)}
                            />
                          </td>
                          <td
                            rowSpan={rowSpan}
                            className={`relative py-0.5 pr-0.5 whitespace-nowrap font-bold tracking-tight align-top ${
                              urgent ? 'text-amber-300' : 'text-cyan-300/90'
                            }`}
                          >
                            <span className="relative z-10">{fmtCountdown(row.expiryMs, now)}</span>
                            {showSpotPinMass ? (
                              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                <PinProbSpotMass row={row} spot={spot!} pinProbs={pinProbs!} />
                              </div>
                            ) : null}
                          </td>
                        </>
                      ) : null}
                      <td
                        style={pinCellStyle}
                        className={`py-0.5 px-0.5 text-right font-bold ${
                          pinGex == null ? 'text-gray-500' : pinGexNeg ? 'text-red-400' : 'text-green-400'
                        }`}
                      >
                        {pinGex != null ? fmtUsd(pinGex) : '—'}
                      </td>
                      <td style={pinCellStyle} className="py-0.5 px-0.5 text-center">
                        <span
                          className={`inline-block min-w-[1.1em] px-0.5 rounded text-[7px] font-bold ${
                            neg ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'
                          }`}
                        >
                          {neg ? 'N' : 'P'}
                        </span>
                      </td>
                      {pinIdx === 0 ? (
                        <td rowSpan={rowSpan} className="py-0.5 px-0.5 text-right text-gray-300 align-middle">
                          {row.totalOi.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </td>
                      ) : null}
                      <td
                        style={pinCellStyle}
                        className="py-0.5 px-0.5 text-right text-yellow-300/90 whitespace-nowrap"
                        title={ref.kind === 'down' ? 'Pin down' : ref.kind === 'up' ? 'Pin up' : 'Pin'}
                      >
                        <span className="inline-flex items-center justify-end gap-0.5 max-w-full">
                          {ref.kind === 'main' ? <PinBiasPill spot={spot} pin={pin} /> : null}
                          {pinProb != null ? (
                            <span
                              className="text-white text-[9px] tabular-nums"
                              title="P(main pin) ≈ |GEX at strike| / Σ|GEX| on ladder"
                            >
                              {fmtPinProb(pinProb)}
                            </span>
                          ) : null}
                          <span className={`tabular-nums ${ref.kind === 'main' ? 'font-semibold' : ''}`}>
                            {fmtGexStrike(pin)}
                          </span>
                        </span>
                      </td>
                      {pinIdx === 0 ? (
                        <>
                          <td rowSpan={rowSpan} className="py-0.5 px-0.5 text-right text-gray-400 whitespace-nowrap align-middle">
                            {row.callOi.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                            {'\\'}
                            {row.putOi.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                          </td>
                          <td rowSpan={rowSpan} className="py-0.5 px-0.5 text-right text-gray-300 align-middle">
                            {fmtGexStrike(row.gammaFlip)}
                          </td>
                          <td
                            rowSpan={rowSpan}
                            className={`py-0.5 pl-0.5 text-right whitespace-nowrap align-middle ${
                              pinFlipGap?.tight ? 'text-amber-300 font-bold' : 'text-gray-400'
                            }`}
                          >
                            {pinFlipGap?.text ?? '—'}
                          </td>
                        </>
                      ) : null}
                    </tr>
                  );
                });
              }

              const mainPinProb = pinProbs?.get(pinRowKey(row, { kind: 'main' }));

              return (
                <tr key={row.expiryMs} className="border-b border-gray-800/60">
                  <td className="py-0.5 pr-1 text-gray-300 whitespace-nowrap font-semibold">
                    <ExpiryLabelCell
                      label={row.label}
                      expandable={canPinLadder}
                      expanded={pinLadderExpanded}
                      onToggle={() => setPinLadderExpanded((v) => !v)}
                    />
                  </td>
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
                      <PinBiasPill spot={spot} pin={row.pinStrike} />
                      {mainPinProb != null ? (
                        <span
                          className="text-white text-[9px] tabular-nums"
                          title="P(main pin) ≈ |GEX at strike| / Σ|GEX| on ladder"
                        >
                          {fmtPinProb(mainPinProb)}
                        </span>
                      ) : null}
                      <span className="font-semibold tabular-nums">{fmtGexStrike(row.pinStrike)}</span>
                    </span>
                  </td>
                  {!compact ? (
                    <>
                      <td className="py-0.5 px-0.5 text-right text-gray-400 whitespace-nowrap">
                        {row.callOi.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        {'\\'}
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
