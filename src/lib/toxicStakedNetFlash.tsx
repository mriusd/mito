import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Triangle } from 'lucide-react';
import { STAKED_NET_EPS } from './toxicFlowStakeCohort';
import { useCancelDomAnimationsOnUnmount } from './cancelDomAnimations';

export const STAKED_NET_FLASH_MIN_USD = 1;
export const STAKED_NET_FLASH_MS = 2000;

export type StakedNetFlashDir = 'up' | 'down';

function stakedNetDominantSide(signed: number): 'yes' | 'no' | 'flat' {
  if (signed < -STAKED_NET_EPS) return 'yes';
  if (signed > STAKED_NET_EPS) return 'no';
  return 'flat';
}

/** Row staked cell: same Y/N side, |signed net| up/down. */
export function stakedNetDeltaFlashDir(prev: number, next: number): StakedNetFlashDir | null {
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return null;
  const prevSide = stakedNetDominantSide(prev);
  const nextSide = stakedNetDominantSide(next);
  if (prevSide === 'flat' || nextSide === 'flat' || prevSide !== nextSide) return null;
  const prevMag = Math.abs(prev);
  const nextMag = Math.abs(next);
  if (nextMag > prevMag + STAKED_NET_FLASH_MIN_USD) return 'up';
  if (nextMag < prevMag - STAKED_NET_FLASH_MIN_USD) return 'down';
  return null;
}

/** Progress bar / unsigned USD totals. */
export function usdMagnitudeFlashDir(prev: number, next: number): StakedNetFlashDir | null {
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return null;
  if (next > prev + STAKED_NET_FLASH_MIN_USD) return 'up';
  if (next < prev - STAKED_NET_FLASH_MIN_USD) return 'down';
  return null;
}

const STAKED_NET_FLASH_BADGE_BASE =
  'inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded updown-triangle-badge-flash-finite';

export function StakedNetFlashBadge({ dir }: { dir: StakedNetFlashDir }) {
  const ref = useRef<HTMLSpanElement>(null);
  useCancelDomAnimationsOnUnmount(ref);
  if (dir === 'up') {
    return (
      <span
        ref={ref}
        className={`${STAKED_NET_FLASH_BADGE_BASE} border border-green-600/45 bg-green-900/65 text-green-100`}
        title="Staked USD increased"
      >
        <Triangle className="h-2 w-2 fill-current stroke-current" strokeWidth={1.5} aria-hidden />
      </span>
    );
  }
  return (
    <span
      ref={ref}
      className={`${STAKED_NET_FLASH_BADGE_BASE} border border-red-600/45 bg-red-900/65 text-red-100`}
      title="Staked USD decreased"
    >
      <Triangle className="h-2 w-2 rotate-180 fill-current stroke-current" strokeWidth={1.5} aria-hidden />
    </span>
  );
}

export function StakedNetFlashInline({
  flash,
  children,
}: {
  flash: StakedNetFlashDir | null;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center justify-end gap-0.5 max-w-full">
      {flash ? <StakedNetFlashBadge dir={flash} /> : null}
      {children}
    </span>
  );
}

/** Flash when a displayed USD total moves up/down (stake bar right column). */
function stakedNetUsdTableCell(signed: number): ReactNode {
  if (!Number.isFinite(signed)) return '–';
  const mag = Math.round(Math.abs(signed)).toLocaleString('en-US');
  if (Math.abs(signed) <= STAKED_NET_EPS) {
    return <span className="tabular-nums font-bold text-gray-500">${mag}</span>;
  }
  if (signed < -STAKED_NET_EPS) {
    return (
      <span className="tabular-nums font-bold text-green-400">
        ${mag} Y
      </span>
    );
  }
  return (
    <span className="tabular-nums font-bold text-red-400">
      ${mag} N
    </span>
  );
}

export function stakedNetUsdTableCellWithFlash(signed: number, flash: StakedNetFlashDir | null): ReactNode {
  return (
    <span className="inline-flex w-full items-center justify-end gap-0.5">
      {flash ? <StakedNetFlashBadge dir={flash} /> : null}
      {stakedNetUsdTableCell(signed)}
    </span>
  );
}

export function useUsdMagnitudeFlash(value: number | null | undefined): StakedNetFlashDir | null {
  const [flash, setFlash] = useState<StakedNetFlashDir | null>(null);
  const prevRef = useRef<number | null>(null);
  useEffect(() => {
    const next = typeof value === 'number' && Number.isFinite(value) ? value : null;
    const prev = prevRef.current;
    prevRef.current = next;
    if (prev === null || next === null) {
      setFlash(null);
      return;
    }
    const dir = usdMagnitudeFlashDir(prev, next);
    if (!dir) return;
    setFlash(dir);
    const t = window.setTimeout(() => setFlash(null), STAKED_NET_FLASH_MS);
    return () => window.clearTimeout(t);
  }, [value]);
  return flash;
}
