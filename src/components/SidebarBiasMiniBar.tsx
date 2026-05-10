import { memo } from 'react';

const FLASH_TILT = 0.2;

function barPct(v: number): number {
  return Math.max(2, Math.min(98, 50 + v * 50));
}

function pctToneClass(v: number): string {
  return v > 0.01 ? 'text-green-400' : v < -0.01 ? 'text-red-400' : 'text-gray-500';
}

export type SidebarBiasMiniBarProps = {
  label: string;
  value: number;
  leftColor: string;
  rightColor: string;
  tooltip?: string;
};

/** Stable identity (module-level memo) — do not define inline inside Sidebar or rows remount every parent render. */
export const SidebarBiasMiniBar = memo(function SidebarBiasMiniBar({
  label,
  value,
  leftColor,
  rightColor,
  tooltip,
}: SidebarBiasMiniBarProps) {
  const flashLeft = Number.isFinite(value) && value >= FLASH_TILT;
  const flashRight = Number.isFinite(value) && value <= -FLASH_TILT;
  const widthPct = barPct(value);
  return (
    <div className="flex items-center gap-1 min-w-0" title={tooltip}>
      <span className="text-[8px] text-gray-500 w-[38px] shrink-0 truncate">{label}</span>
      <div className="h-[5px] bg-gray-700 rounded-full overflow-hidden flex flex-1 min-w-0">
        <div
          className={`${leftColor} h-full min-w-0 transition-[width] duration-150 ease-out shrink-0${
            flashLeft ? ' sidebar-bar-seg-flash-left' : ''
          }`}
          style={{ width: `${widthPct}%` }}
        />
        <div
          className={`${rightColor} h-full flex-1 min-w-0${flashRight ? ' sidebar-bar-seg-flash-right' : ''}`}
        />
      </div>
      <span className={`text-[8px] font-bold w-[28px] shrink-0 text-right ${pctToneClass(value)}`}>
        {(value * 100) > 0 ? '+' : ''}
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
});
