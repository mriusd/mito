import type { ReactNode } from 'react';

type Props = {
  className?: string;
  separator?: ReactNode;
  left: ReactNode;
  right: ReactNode;
};

/** YES/NO or bid/ask style row: separator stays centered regardless of digit width */
export function MarketCellMidRow({ className = '', separator = '|', left, right }: Props) {
  return (
    <div
      className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-0 tabular-nums ${className}`.trim()}
    >
      <span className="min-w-0 justify-self-end text-end">{left}</span>
      <span className="shrink-0 justify-self-center px-px select-none" aria-hidden>
        {separator}
      </span>
      <span className="min-w-0 justify-self-start text-start">{right}</span>
    </div>
  );
}
