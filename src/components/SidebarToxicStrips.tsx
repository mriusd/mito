import { memo, useEffect, useMemo, useState } from 'react';
import { ToxicFlowStakePreview, TOXIC_TOTAL_STAKE_BAR_HELP } from './ToxicFlowStakePreview';
import { useSidebarToxicFlowData } from '../lib/sidebarToxicFlowStore';
import {
  buildToxicFlowTabWalletViews,
  cohortSurplusLean,
  dominantStakedLegAvgPriceCents,
  toxicCohortStakedNetSurplusHalves,
  toxicRowLedgerLifetimePnlNegative,
} from '../lib/toxicFlowStakeCohort';
import {
  TOXIC_FAVOURITE_WALLETS_LS_KEY,
  TOXIC_FAVOURITES_CHANGED_EVENT,
  readToxicFavouriteWallets,
} from '../lib/toxicFavouriteWallets';
import { setSidebarToxicNotify, resetSidebarToxicNotify } from '../lib/sidebarToxicNotifyStore';
import type { MarketStakedLegsResponse } from '../api';

const SIDEBAR_TOXIC_STRIP_FLASH_FRAC = 0.3;

const TOXIC_SIDEBAR_STRIP_HELP = {
  total: TOXIC_TOTAL_STAKE_BAR_HELP,
  holders: 'Biggest wallets active on this market. Green = YES bets, red = NO bets.',
  smart: 'Wallets with strong winning record. Only those who profit often.',
  top20: 'Top 20 position holders on this market (by |staked net|, same ordering as Holders).',
  fav: 'Your favorite wallets betting here right now.',
  greens: 'Wallets with profits in tracked time. Green = more dollars staked on YES, red = more on NO.',
  whales:
    'Wallets with |Staked Net| USD ≥ Whale amount (Tilt bell). Same cohort as Toxic Flow Whales tab. Bar pulse = cohort lean ≥ sidebar strip threshold.',
} as const;

export const SidebarToxicStrips = memo(function SidebarToxicStrips({
  sidebarStakedLegs,
  notifyTiltAppliesToSelectedMarket,
  notifyWhaleAmountUsd,
  notifyWhaleMaxPriceCents,
  notifyWhaleIgnoreNegativePnl,
  notifyHolderTiltPct,
  notifySmartTiltPct,
  notifyFavouriteTiltPct,
  notifyGreensTiltPct,
}: {
  sidebarStakedLegs: MarketStakedLegsResponse | null;
  notifyTiltAppliesToSelectedMarket: boolean;
  notifyWhaleAmountUsd: number;
  notifyWhaleMaxPriceCents: number;
  notifyWhaleIgnoreNegativePnl: boolean;
  notifyHolderTiltPct: number;
  notifySmartTiltPct: number;
  notifyFavouriteTiltPct: number;
  notifyGreensTiltPct: number;
}) {
  const toxicFlowData = useSidebarToxicFlowData();
  const [toxicFavSet, setToxicFavSet] = useState(readToxicFavouriteWallets);
  useEffect(() => {
    const sync = () => setToxicFavSet(readToxicFavouriteWallets());
    const onStorage = (e: StorageEvent) => {
      if (e.key === TOXIC_FAVOURITE_WALLETS_LS_KEY) sync();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(TOXIC_FAVOURITES_CHANGED_EVENT, sync);
    };
  }, []);

  const toxicTabViews = useMemo(
    () => (toxicFlowData ? buildToxicFlowTabWalletViews(toxicFlowData, toxicFavSet, notifyWhaleAmountUsd) : null),
    [toxicFlowData, toxicFavSet, notifyWhaleAmountUsd],
  );

  const toxicStripModel = useMemo(() => {
    const lists = toxicTabViews?.stripLists ?? null;
    if (!lists) return { lists: null, bars: null };
    return {
      lists,
      bars: {
        holders: toxicCohortStakedNetSurplusHalves(lists.holders),
        smart: toxicCohortStakedNetSurplusHalves(lists.smart),
        top20: toxicCohortStakedNetSurplusHalves(lists.top20),
        favourites: toxicCohortStakedNetSurplusHalves(lists.favourites),
        pnlPlus: toxicCohortStakedNetSurplusHalves(lists.pnlPlus),
      },
    };
  }, [toxicTabViews]);

  const toxicStripWhaleWallets = toxicTabViews?.whales ?? [];

  useEffect(() => {
    if (!toxicTabViews) {
      resetSidebarToxicNotify();
      return;
    }

    let whalePassesPriceGate = false;
    for (const w of toxicTabViews.whales) {
      if (notifyWhaleIgnoreNegativePnl && toxicRowLedgerLifetimePnlNegative(w)) continue;
      const pc = dominantStakedLegAvgPriceCents(w);
      if (pc == null || !Number.isFinite(pc)) continue;
      if (pc < notifyWhaleMaxPriceCents) {
        whalePassesPriceGate = true;
        break;
      }
    }

    let topBarExtremeBgFlash: 'green' | 'red' | null = null;
    if (notifyTiltAppliesToSelectedMarket) {
      const bars = toxicStripModel.bars;
      const barLean = (bar: { sumYUsd: number; sumNUsd: number } | undefined): number | null => {
        if (!bar || !(bar.sumYUsd + bar.sumNUsd > 1e-9)) return null;
        return cohortSurplusLean(bar.sumYUsd, bar.sumNUsd);
      };
      const legs = [
        { pct: notifyHolderTiltPct, lean: barLean(bars?.holders) },
        { pct: notifySmartTiltPct, lean: barLean(bars?.smart) },
        { pct: notifyFavouriteTiltPct, lean: barLean(bars?.favourites) },
        { pct: notifyGreensTiltPct, lean: barLean(bars?.pnlPlus) },
      ].filter((x) => x.pct > 0);
      if (legs.length > 0) {
        let greenOk = true;
        let redOk = true;
        for (const { pct, lean } of legs) {
          const frac = pct / 100;
          if (lean == null || lean < frac) greenOk = false;
          if (lean == null || lean > -frac) redOk = false;
        }
        if (greenOk && !redOk) topBarExtremeBgFlash = 'green';
        else if (redOk && !greenOk) topBarExtremeBgFlash = 'red';
      }
    }

    setSidebarToxicNotify({ topBarExtremeBgFlash, whalePassesPriceGate });
  }, [
    toxicTabViews,
    toxicStripModel,
    notifyTiltAppliesToSelectedMarket,
    notifyWhaleMaxPriceCents,
    notifyWhaleIgnoreNegativePnl,
    notifyHolderTiltPct,
    notifySmartTiltPct,
    notifyFavouriteTiltPct,
    notifyGreensTiltPct,
  ]);

  useEffect(() => () => resetSidebarToxicNotify(), []);

  return (
    <div className="mt-1 w-full min-w-0 flex flex-col gap-y-2 pb-0.5">
      <ToxicFlowStakePreview
        layout="stacked"
        helpText={TOXIC_SIDEBAR_STRIP_HELP.total}
        label="Total"
        marketGrossLegsUsd={sidebarStakedLegs}
        wallets={[]}
        flashExtremeTilt
        extremeFlashTiltThreshold={SIDEBAR_TOXIC_STRIP_FLASH_FRAC}
      />
      <ToxicFlowStakePreview
        layout="stacked"
        helpText={TOXIC_SIDEBAR_STRIP_HELP.holders}
        label="Holders"
        wallets={toxicStripModel.lists?.holders ?? []}
        flashExtremeTilt
        extremeFlashTiltThreshold={SIDEBAR_TOXIC_STRIP_FLASH_FRAC}
      />
      <ToxicFlowStakePreview
        layout="stacked"
        helpText={TOXIC_SIDEBAR_STRIP_HELP.smart}
        label="Smart"
        wallets={toxicStripModel.lists?.smart ?? []}
        flashExtremeTilt
        extremeFlashTiltThreshold={SIDEBAR_TOXIC_STRIP_FLASH_FRAC}
      />
      <ToxicFlowStakePreview
        layout="stacked"
        helpText={TOXIC_SIDEBAR_STRIP_HELP.greens}
        label="Greens"
        wallets={toxicStripModel.lists?.pnlPlus ?? []}
        flashExtremeTilt
        extremeFlashTiltThreshold={SIDEBAR_TOXIC_STRIP_FLASH_FRAC}
      />
      <ToxicFlowStakePreview
        layout="stacked"
        helpText={TOXIC_SIDEBAR_STRIP_HELP.top20}
        label="Top20"
        wallets={toxicStripModel.lists?.top20 ?? []}
        flashExtremeTilt
        extremeFlashTiltThreshold={SIDEBAR_TOXIC_STRIP_FLASH_FRAC}
      />
      <ToxicFlowStakePreview
        layout="stacked"
        helpText={TOXIC_SIDEBAR_STRIP_HELP.whales}
        label="Whales"
        wallets={toxicStripWhaleWallets}
        flashExtremeTilt
        extremeFlashTiltThreshold={SIDEBAR_TOXIC_STRIP_FLASH_FRAC}
      />
      <ToxicFlowStakePreview
        layout="stacked"
        helpText={TOXIC_SIDEBAR_STRIP_HELP.fav}
        label="Fav"
        wallets={toxicStripModel.lists?.favourites ?? []}
        flashExtremeTilt
        extremeFlashTiltThreshold={SIDEBAR_TOXIC_STRIP_FLASH_FRAC}
      />
    </div>
  );
});
