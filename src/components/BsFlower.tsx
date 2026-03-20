import { useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import { getBsTriple, type BsTripleResult } from '../utils/bsMath';
import type { AssetSymbol } from '../types';

interface BsFlowerProps {
  asset: string;
  strike: string;
  endDate: string;
  isYes: boolean;
  onPriceClick?: (cents: number) => void;
}

const fmt = (v: number | null) => {
  if (v === null) return '-';
  const pct = v * 100;
  return pct < 0.1 ? '0.0%' : pct.toFixed(1) + '%';
};

const fmtNo = (v: number | null) => {
  if (v === null) return '-';
  const pct = (1 - v) * 100;
  return pct < 0.1 ? '0.0%' : pct.toFixed(1) + '%';
};

const fmtPrice = (v: number | null) => {
  if (v === null || v === undefined) return '-';
  if (v >= 1000) return (v / 1000).toFixed(v % 1000 === 0 ? 0 : 1) + 'k';
  if (v >= 1) return v.toFixed(0);
  return v.toFixed(4);
};

const fmtLivePrice = (v: number) => {
  if (!v) return '-';
  if (v >= 1000) return v.toFixed(0);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(4);
};

// Shared flower grid renderer
function FlowerGrid({ label, fmtFn, bsLive, s0HasRange, s1HasRange, v0L, v0R, v1L, v1R, hasDual, probColor, isYes, onPriceClick }: {
  label: string;
  fmtFn: (v: number | null) => string;
  bsLive: number | null;
  s0HasRange: boolean;
  s1HasRange: boolean;
  v0L: number | null;
  v0R: number | null;
  v1L: number | null;
  v1R: number | null;
  hasDual: boolean;
  probColor: string;
  isYes?: boolean;
  onPriceClick?: (cents: number) => void;
}) {
  const clickable = (v: number | null) => {
    if (v === null || !onPriceClick) return undefined;
    const cents = isYes ? v * 100 : (1 - v) * 100;
    return () => onPriceClick(Math.round(cents * 10) / 10);
  };
  const clickClass = onPriceClick ? 'cursor-pointer hover:underline' : '';
  if (!hasDual) {
    return (
      <span className={probColor}>
        {label}: <span className={`text-white font-bold ${clickClass}`} onClick={clickable(bsLive)}>{fmtFn(bsLive)}</span>
      </span>
    );
  }
  return (
    <div className="flex items-center gap-3">
      <span className={probColor}>{label}:</span>
      <span
        className="inline-grid items-center justify-items-center"
        style={{ gridTemplateColumns: 'auto auto auto', gridTemplateRows: 'auto auto', columnGap: 3, lineHeight: 1.2 }}
      >
        <span style={{ gridRow: 1, gridColumn: 1 }}>
          {s0HasRange ? <span className={`text-cyan-300 ${clickClass}`} onClick={clickable(v0L)}>{fmtFn(v0L)}</span> : <span className="text-gray-700">-</span>}
        </span>
        <span style={{ gridRow: '1/3', gridColumn: 2, fontSize: 14, lineHeight: 1 }}>
          <span className={`text-white font-bold ${clickClass}`} onClick={clickable(bsLive)}>{fmtFn(bsLive)}</span>
        </span>
        <span style={{ gridRow: 1, gridColumn: 3 }}>
          {s0HasRange ? <span className={`text-cyan-300 ${clickClass}`} onClick={clickable(v0R)}>{fmtFn(v0R)}</span> : <span className="text-gray-700">-</span>}
        </span>
        <span style={{ gridRow: 2, gridColumn: 1 }}>
          {s1HasRange ? <span className={`text-pink-400 ${clickClass}`} onClick={clickable(v1L)}>{fmtFn(v1L)}</span> : <span className="text-gray-700">-</span>}
        </span>
        <span style={{ gridRow: 2, gridColumn: 3 }}>
          {s1HasRange ? <span className={`text-pink-400 ${clickClass}`} onClick={clickable(v1R)}>{fmtFn(v1R)}</span> : <span className="text-gray-700">-</span>}
        </span>
      </span>
    </div>
  );
}

function PriceFlower({ s0HasRange, s1HasRange, r0Low, r0High, r1Low, r1High, livePrice }: {
  s0HasRange: boolean;
  s1HasRange: boolean;
  r0Low: number | null;
  r0High: number | null;
  r1Low: number | null;
  r1High: number | null;
  livePrice: number;
}) {
  if (!s0HasRange && !s1HasRange) return null;
  return (
    <span
      className="inline-grid items-center justify-items-center text-gray-400"
      style={{ gridTemplateColumns: 'auto auto auto', gridTemplateRows: 'auto auto', columnGap: 3, lineHeight: 1.2 }}
    >
      <span style={{ gridRow: 1, gridColumn: 1 }}>
        {s0HasRange ? <span className="text-cyan-300">{fmtPrice(r0Low)}</span> : <span className="text-gray-700">-</span>}
      </span>
      <span style={{ gridRow: '1/3', gridColumn: 2, fontSize: 14, lineHeight: 1 }}>
        <span className="text-white font-bold text-sm">{fmtLivePrice(livePrice)}</span>
      </span>
      <span style={{ gridRow: 1, gridColumn: 3 }}>
        {s0HasRange ? <span className="text-cyan-300">{fmtPrice(r0High)}</span> : <span className="text-gray-700">-</span>}
      </span>
      <span style={{ gridRow: 2, gridColumn: 1 }}>
        {s1HasRange ? <span className="text-pink-400">{fmtPrice(r1Low)}</span> : <span className="text-gray-700">-</span>}
      </span>
      <span style={{ gridRow: 2, gridColumn: 3 }}>
        {s1HasRange ? <span className="text-pink-400">{fmtPrice(r1High)}</span> : <span className="text-gray-700">-</span>}
      </span>
    </span>
  );
}

// Extract slot BS values for rendering, accounting for YES/NO and range/above
function extractSlotValues(
  isYes: boolean, isRange: boolean,
  s0: { low: number | null; high: number | null; min: number | null; max: number | null; hasRange: boolean },
  s1: { low: number | null; high: number | null; min: number | null; max: number | null; hasRange: boolean },
) {
  // YES: left=max(agg), right=min(cons); NO: left=1-min(agg), right=1-max(cons)
  const s0L = isRange && s0.max !== null ? (isYes ? s0.max : s0.min) : s0.low;
  const s0R = isRange && s0.min !== null ? (isYes ? s0.min : s0.max) : s0.high;
  const s1L = isRange && s1.max !== null ? (isYes ? s1.max : s1.min) : s1.low;
  const s1R = isRange && s1.min !== null ? (isYes ? s1.min : s1.max) : s1.high;
  return { v0L: s0L, v0R: s0R, v1L: s1L, v1R: s1R };
}

export function BsFlower({ asset, strike, endDate, isYes, onPriceClick }: BsFlowerProps) {
  // Store data for frontend BS
  const sym = (asset + 'USDT') as AssetSymbol;
  const vwapData = useAppStore((s) => s.vwapData);
  const priceData = useAppStore((s) => s.priceData);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const manualPriceSlots = useAppStore((s) => s.manualPriceSlots);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const vwapCorrection = useAppStore((s) => s.vwapCorrection);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);

  // Compute frontend BS
  const feTriple: BsTripleResult | null = useMemo(() => {
    if (!asset || !strike || !endDate) return null;
    const livePrice = vwapData[sym]?.price || priceData[sym]?.price || 0;
    if (!livePrice) return null;
    const sigma = (volatilityData[sym] || 0.60) * volMultiplier;
    const slots = manualPriceSlots[sym] || [null, null];
    return getBsTriple(strike, endDate, livePrice, sigma, slots, vwapCorrection, bsTimeOffsetHours);
  }, [asset, strike, endDate, sym, vwapData, priceData, volatilityData, manualPriceSlots, volMultiplier, vwapCorrection, bsTimeOffsetHours]);

  const fmtFn = isYes ? fmt : fmtNo;
  const probColor = isYes ? 'text-green-400' : 'text-red-400';
  const isRange = strike.replace(/[\$,]/g, '').includes('-') && !strike.replace(/[\$,]/g, '').startsWith('>') && !strike.replace(/[\$,]/g, '').startsWith('<');

  // Frontend flower
  const feFlower = useMemo(() => {
    if (!feTriple) return null;
    const feVals = extractSlotValues(isYes, isRange, feTriple.s0, feTriple.s1);
    return {
      bsLive: feTriple.bsLive,
      hasDual: feTriple.hasDual,
      s0HasRange: feTriple.s0.hasRange,
      s1HasRange: feTriple.s1.hasRange,
      ...feVals,
      range0: feTriple.range0,
      range1: feTriple.range1,
      livePrice: feTriple.livePrice,
    };
  }, [feTriple, isYes, isRange]);


  // Check if time machine pushes past expiry
  const timeMachinePastExpiry = useMemo(() => {
    if (!endDate || bsTimeOffsetHours <= 0) return false;
    const nowOffset = Date.now() + bsTimeOffsetHours * 3600000;
    return nowOffset >= new Date(endDate).getTime();
  }, [endDate, bsTimeOffsetHours]);

  if (timeMachinePastExpiry) {
    return (
      <div className="text-[11px] text-gray-500" title="Time machine ahead of expiration">
        <span className="text-gray-400">B-S:</span> <span className="font-bold">&gt;⏱</span>
      </div>
    );
  }

  if (!feFlower) return null;

  return (
    <div className="text-[11px] space-y-1">
      {/* Frontend BS */}
      <div className="flex items-center gap-3">
        <FlowerGrid
          label="B-S"
          fmtFn={fmtFn}
          bsLive={feFlower.bsLive}
          s0HasRange={feFlower.s0HasRange}
          s1HasRange={feFlower.s1HasRange}
          v0L={feFlower.v0L}
          v0R={feFlower.v0R}
          v1L={feFlower.v1L}
          v1R={feFlower.v1R}
          hasDual={feFlower.hasDual}
          probColor={probColor}
          isYes={isYes}
          onPriceClick={onPriceClick}
        />
        {feFlower.hasDual && (
          <PriceFlower
            s0HasRange={feFlower.s0HasRange}
            s1HasRange={feFlower.s1HasRange}
            r0Low={feFlower.range0?.low ?? null}
            r0High={feFlower.range0?.high ?? null}
            r1Low={feFlower.range1?.low ?? null}
            r1High={feFlower.range1?.high ?? null}
            livePrice={feFlower.livePrice}
          />
        )}
      </div>
    </div>
  );
}
