import { memo } from 'react';
import { ArrowRight } from 'lucide-react';
import type { Market } from '../types';
import { useExpiryNow } from '../hooks/useExpiryNow';
import { formatMarketCountdown } from '../lib/marketCountdown';

type Props = {
  endDate: string;
  mode: 'updown' | 'generic';
  liveUpDownSameTfMarket?: Market | null;
  onSwitchLiveMarket?: () => void;
};

/** Isolated 1 Hz countdown — does not re-render Sidebar parent. */
export const SidebarMarketCountdownLabel = memo(function SidebarMarketCountdownLabel({
  endDate,
  mode,
  liveUpDownSameTfMarket,
  onSwitchLiveMarket,
}: Props) {
  const now = useExpiryNow();
  const { text, remaining } = formatMarketCountdown(endDate, now);
  if (!text) return null;
  return (
    <>
      <span
        className={`shrink-0 ${text === 'Expired' ? 'text-red-400' : remaining < 60000 ? 'text-red-400' : remaining > 300000 ? 'text-green-400' : 'text-yellow-400'}`}
      >
        {text}
      </span>
      {text === 'Expired' && mode === 'updown' && liveUpDownSameTfMarket && onSwitchLiveMarket ? (
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-0.5 rounded bg-green-600 px-1.5 py-px text-[9px] font-semibold leading-none text-black hover:bg-green-500"
          onClick={onSwitchLiveMarket}
        >
          <ArrowRight size={10} strokeWidth={2.5} className="shrink-0" aria-hidden />
          live
        </button>
      ) : null}
    </>
  );
});
