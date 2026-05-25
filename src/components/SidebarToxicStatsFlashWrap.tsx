import { memo, useMemo, type ReactNode } from 'react';
import { useSidebarChartAnnualVolPct } from '../lib/sidebarChartVolStore';
import { useSidebarNotifyStakedGatePasses } from '../lib/sidebarNotifyStakedGateStore';
import { useSidebarToxicNotify } from '../lib/sidebarToxicNotifyStore';

export const SidebarToxicStatsFlashWrap = memo(function SidebarToxicStatsFlashWrap({
  children,
  notifyFlashBg,
  notifyMaxVolatilityPct,
}: {
  children: ReactNode;
  notifyFlashBg: boolean;
  notifyMaxVolatilityPct: number;
}) {
  const { topBarExtremeBgFlash } = useSidebarToxicNotify();
  const notifyStakedGatePasses = useSidebarNotifyStakedGatePasses();
  const sidebarChartAnnualVolPct = useSidebarChartAnnualVolPct();

  const effectiveFlash = useMemo((): 'green' | 'red' | null => {
    if (!notifyFlashBg || !notifyStakedGatePasses) return null;
    if (notifyMaxVolatilityPct > 0) {
      if (sidebarChartAnnualVolPct == null || !Number.isFinite(sidebarChartAnnualVolPct)) return null;
      if (sidebarChartAnnualVolPct > notifyMaxVolatilityPct) return null;
    }
    return topBarExtremeBgFlash;
  }, [
    notifyFlashBg,
    notifyStakedGatePasses,
    notifyMaxVolatilityPct,
    sidebarChartAnnualVolPct,
    topBarExtremeBgFlash,
  ]);

  return (
    <div
      className={`min-w-0 min-h-0 rounded-md px-1 py-0.5 -mx-1${
        effectiveFlash === 'green'
          ? ' sidebar-stats-flash-green'
          : effectiveFlash === 'red'
            ? ' sidebar-stats-flash-red'
            : ''
      }`}
    >
      {children}
    </div>
  );
});
