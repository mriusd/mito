import { memo, useMemo } from 'react';
import type { CSSProperties } from 'react';
import { CirclePercent, Minus, Triangle } from 'lucide-react';
import type { Market, Order, AssetSymbol } from '../../types';
import { getMarketProbability } from '../../utils/bsMath';
import { normalizeClobTokenId } from '../../utils/format';
import { outcomeMidOrOneSideProb } from '../../lib/outcomeQuote';
import { nextMarketHiFlashSides, useUpDownNextHiSettings } from '../../lib/upDownNextMarketFlashSound';
import { marketRowContentEqual } from '../../lib/marketDataDedupe';
import { useThrottledMarketLookupSubset } from '../../hooks/useThrottledMarketLookupSubset';
import { useThrottledStorePrice } from '../../hooks/useThrottledStorePrice';
import { useThrottledChainlinkPricesMap } from '../../hooks/usePolymarketPrice';
import { GRID_BID_ASK_THROTTLE_MS } from '../../lib/bidAskMarketLookup';
import { useExpiryNow } from '../../hooks/useExpiryNow';
import { MarketCellMidRow } from './MarketCellMidRow';

const ASSET_COLORS: Record<string, string> = {
  BTC: 'text-orange-400',
  ETH: 'text-blue-400',
  SOL: 'text-purple-400',
  XRP: 'text-cyan-400',
};

const ASSET_BORDER_COLOR: Record<string, string> = {
  BTC: 'rgba(251, 146, 60, 0.9)',
  ETH: 'rgba(96, 165, 250, 0.9)',
  SOL: 'rgba(192, 132, 252, 0.9)',
  XRP: 'rgba(34, 211, 238, 0.9)',
};

const TF_DURATIONS_MS: Record<string, number> = {
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
};

const TARGET_STRIKE_DECIMALS: Record<string, number> = {
  BTC: 0,
  ETH: 1,
  SOL: 2,
  XRP: 4,
};

const MATH_PROB_NEUTRAL_BAND = 1;
const MATH_VS_BID_NEUTRAL_PCT = 5;
const MATH_VS_BID_FLASH_REL = 0.30;
const EXPIRY_BAR_BG = 'rgba(6, 182, 212, 0.6)';

function assetBorderStyle(
  asset: string,
  sides: { L?: boolean; R?: boolean; B?: boolean },
): CSSProperties {
  const c = ASSET_BORDER_COLOR[asset];
  const s: CSSProperties = {};
  if (sides.L) s.borderLeftColor = c;
  if (sides.R) s.borderRightColor = c;
  if (sides.B) s.borderBottomColor = c;
  return s;
}

function expiryProgress(nowMs: number, endMs: number, durationMs: number): number {
  if (endMs <= 0 || durationMs <= 0) return 0;
  const startMs = endMs - durationMs;
  return Math.max(0, Math.min(1, (nowMs - startMs) / durationMs));
}

function formatTargetStrikePrice(p: number | undefined | null, fractionDigits: number): string {
  if (p == null || !Number.isFinite(p)) return '-';
  return p.toLocaleString(undefined, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function strikePriceFromMarket(market: Market, tokenId: string, lookup: Record<string, Market>): number | undefined {
  const p = market.priceToBeat ?? (tokenId ? lookup[tokenId]?.priceToBeat : undefined);
  return p != null && Number.isFinite(p) ? p : undefined;
}

const UpDownExpiryBar = memo(function UpDownExpiryBar({
  endDate,
  durationMs,
  className = 'absolute bottom-[2px] left-0 z-0 h-[2px] pointer-events-none',
}: {
  endDate: string;
  durationMs: number;
  className?: string;
}) {
  const now = useExpiryNow();
  const mEnd = new Date(endDate).getTime();
  const p = expiryProgress(now, mEnd, durationMs);
  return (
    <div
      className={className}
      style={{ width: `${(p * 100).toFixed(1)}%`, backgroundColor: EXPIRY_BAR_BG }}
    />
  );
});

function UpDownCellPositionDots({
  yesTokenId,
  noTokenId,
  positionTokenIds,
  liveTradesSource,
}: {
  yesTokenId: string;
  noTokenId: string;
  positionTokenIds: Set<string>;
  liveTradesSource: string;
}) {
  const posTitle = liveTradesSource === 'onchain' ? 'position (on-chain)' : 'position';
  return (
    <>
      {yesTokenId && positionTokenIds.has(normalizeClobTokenId(yesTokenId)) && (
        <span
          className="absolute left-0.5 top-0.5 z-10 h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_3px_rgba(52,211,153,0.8)]"
          title={`YES ${posTitle}`}
        />
      )}
      {noTokenId && positionTokenIds.has(normalizeClobTokenId(noTokenId)) && (
        <span
          className="absolute right-0.5 top-0.5 z-10 h-1.5 w-1.5 rounded-full bg-rose-400 shadow-[0_0_3px_rgba(251,113,133,0.8)]"
          title={`NO ${posTitle}`}
        />
      )}
    </>
  );
}

function UpDownCellOrderBadges({
  yesTokenId,
  noTokenId,
  orderLookup,
}: {
  yesTokenId: string;
  noTokenId: string;
  orderLookup: Record<string, Order[]>;
}) {
  const yesOrders = orderLookup[yesTokenId] || [];
  const noOrders = orderLookup[noTokenId] || [];
  const yesBuy = yesOrders.filter((o) => o.side === 'BUY');
  const yesSell = yesOrders.filter((o) => o.side === 'SELL');
  const noBuy = noOrders.filter((o) => o.side === 'BUY');
  const noSell = noOrders.filter((o) => o.side === 'SELL');
  return (
    <>
      {yesBuy.length > 0 && (
        <div className="absolute bottom-0 left-0 bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tr-sm z-[2]">
          {Math.max(...yesBuy.map((o) => parseFloat(o.price || '0') * 100)).toFixed(1)}
        </div>
      )}
      {yesSell.length > 0 && (
        <div
          className={`absolute ${yesBuy.length > 0 ? 'bottom-[9px]' : 'bottom-0'} left-0 bg-yellow-400 text-[7px] px-[2px] leading-none font-bold rounded-tr-sm z-[2]`}
          style={{ color: '#78350f' }}
        >
          {Math.min(...yesSell.map((o) => parseFloat(o.price || '0') * 100)).toFixed(1)}
        </div>
      )}
      {noBuy.length > 0 && (
        <div className="absolute bottom-0 right-0 bg-blue-600 text-white text-[7px] px-[2px] leading-none font-bold rounded-tl-sm z-[2]">
          {Math.max(...noBuy.map((o) => parseFloat(o.price || '0') * 100)).toFixed(1)}
        </div>
      )}
      {noSell.length > 0 && (
        <div
          className={`absolute ${noBuy.length > 0 ? 'bottom-[9px]' : 'bottom-0'} right-0 bg-yellow-400 text-[7px] px-[2px] leading-none font-bold rounded-tl-sm z-[2]`}
          style={{ color: '#78350f' }}
        >
          {Math.min(...noSell.map((o) => parseFloat(o.price || '0') * 100)).toFixed(1)}
        </div>
      )}
    </>
  );
}

export type UpDownAssetLaneCellsProps = {
  asset: string;
  tf: string;
  market: Market;
  futuresSlots: (Market | null)[];
  showTarget: boolean;
  isLastTfRow: boolean;
  nextMarketsCount: number;
  vol: number;
  volMultiplier: number;
  bsTimeOffsetHours: number;
  positionTokenIds: Set<string>;
  orderLookup: Record<string, Order[]>;
  selectedMarketId?: string;
  onCellClick: (market: Market, outcome?: 'YES' | 'NO') => void;
  liveTradesSource: string;
};

function UpDownAssetLaneCellsInner({
  asset,
  tf,
  market,
  futuresSlots,
  showTarget,
  isLastTfRow,
  nextMarketsCount,
  vol,
  volMultiplier,
  bsTimeOffsetHours,
  positionTokenIds,
  orderLookup,
  selectedMarketId,
  onCellClick,
  liveTradesSource,
}: UpDownAssetLaneCellsProps) {
  const tokenIds = market.clobTokenIds || [];
  const yesTokenId = tokenIds[0] || '';
  const noTokenId = tokenIds[1] || '';
  const sym = (asset + 'USDT') as AssetSymbol;
  const duration = TF_DURATIONS_MS[tf] ?? 0;
  const binanceSpot = useThrottledStorePrice(sym, GRID_BID_ASK_THROTTLE_MS);
  const chainlinkSpot = useThrottledChainlinkPricesMap(GRID_BID_ASK_THROTTLE_MS)[asset];

  const lookupTokenIds = useMemo(() => {
    const ids = new Set<string>();
    if (yesTokenId) ids.add(yesTokenId);
    if (noTokenId) ids.add(noTokenId);
    for (const fm of futuresSlots) {
      if (!fm) continue;
      for (const t of fm.clobTokenIds || []) {
        const k = String(t || '').trim();
        if (k) ids.add(k);
      }
    }
    return [...ids];
  }, [yesTokenId, noTokenId, futuresSlots]);

  const bidAskLookup = useThrottledMarketLookupSubset(lookupTokenIds);
  const { alertEnabled: upDownNextHiAlertEnabled, hiThreshold: upDownNextHiThreshold } =
    useUpDownNextHiSettings();

  const getLiveBidAsk = (m: Market) => {
    const tid = m.clobTokenIds?.[0];
    const live = tid ? bidAskLookup[tid] : null;
    return { bestBid: live?.bestBid ?? m.bestBid, bestAsk: live?.bestAsk ?? m.bestAsk };
  };

  const { bestBid } = getLiveBidAsk(market);
  const preferChainlink = tf === '5m' || tf === '15m';
  const livePrice = preferChainlink
    ? chainlinkSpot != null && chainlinkSpot > 0
      ? chainlinkSpot
      : binanceSpot > 0
        ? binanceSpot
        : undefined
    : binanceSpot > 0
      ? binanceSpot
      : undefined;
  const strikeTarget = strikePriceFromMarket(market, yesTokenId, bidAskLookup);

  let mathYesProb: number | null = null;
  if (livePrice != null && livePrice > 0 && strikeTarget !== undefined && market.endDate) {
    const sigma = vol * volMultiplier;
    const bsYes = getMarketProbability('>' + strikeTarget, livePrice, market.endDate, sigma, bsTimeOffsetHours);
    if (bsYes !== null) mathYesProb = bsYes;
  }

  let bidVsMath: 'bidAbove' | 'bidBelow' | 'tie' | null = null;
  let triangleBadgeFlash = false;
  if (mathYesProb !== null && bestBid != null && Number.isFinite(bestBid)) {
    const gapPts = Math.abs(bestBid * 100 - mathYesProb * 100);
    const d = bestBid - mathYesProb;
    if (gapPts <= MATH_VS_BID_NEUTRAL_PCT) bidVsMath = 'tie';
    else if (d > 0) bidVsMath = 'bidAbove';
    else bidVsMath = 'bidBelow';
    const flashDenom = Math.max(mathYesProb, 1e-9);
    triangleBadgeFlash = Math.abs(bestBid - mathYesProb) / flashDenom >= MATH_VS_BID_FLASH_REL;
  }
  const mathPctRounded = mathYesProb !== null ? Math.round(mathYesProb * 100) : null;
  const mathProbNeutral =
    mathPctRounded !== null &&
    mathPctRounded >= 50 - MATH_PROB_NEUTRAL_BAND &&
    mathPctRounded <= 50 + MATH_PROB_NEUTRAL_BAND;
  const mathBadgeColorClass =
    mathPctRounded === null
      ? 'bg-gray-800/70 text-gray-300 border border-gray-600/50'
      : mathProbNeutral
        ? 'bg-gray-800/40 text-gray-300/90 border border-gray-500/30'
        : mathPctRounded > 50
          ? 'bg-green-900/55 text-green-200 border border-green-700/40'
          : 'bg-red-900/55 text-red-200 border border-red-700/40';

  const gammaYes = { bestBid: market.bestBid, bestAsk: market.bestAsk };
  const yesMidProb = outcomeMidOrOneSideProb(yesTokenId, bidAskLookup, gammaYes);
  const noProb = yesMidProb != null ? 1 - yesMidProb : null;
  const yesMidStr = yesMidProb != null ? (yesMidProb * 100).toFixed(1) : '-';
  const noProbStr = noProb != null ? (noProb * 100).toFixed(1) : '-';
  const isSelected = selectedMarketId === market.id;
  const provenSMS = yesTokenId ? (bidAskLookup[yesTokenId]?.provenSMS ?? 0) : 0;
  const smartMoneyBarPct = Math.max(2, Math.min(98, 50 + provenSMS * 50));
  const concRaw =
    typeof bidAskLookup[yesTokenId]?.concentration === 'number' &&
    Number.isFinite(bidAskLookup[yesTokenId]?.concentration)
      ? bidAskLookup[yesTokenId]!.concentration!
      : 0;
  const concPct = Math.max(0, Math.min(100, concRaw * 100));
  const cR = Math.round(Math.min(255, concRaw * 2 * 255));
  const cG = Math.round(Math.min(255, (1 - concRaw) * 2 * 255));
  const concColor = `rgb(${cR}, ${cG}, 0)`;

  const targetCell = showTarget ? (
    <td
      key={`${asset}-target`}
      className={`px-1 py-1 align-middle border-l border-r border-solid border-gray-700 text-center text-[9px] whitespace-nowrap ${ASSET_COLORS[asset] || 'text-gray-300'} bg-gray-900/50 ${isLastTfRow ? 'border-b' : 'border-b border-gray-700/50'}`}
      style={assetBorderStyle(asset, { L: true, B: isLastTfRow })}
    >
      <div className="flex flex-row items-center justify-center gap-1 leading-none">
        <span className="font-medium tabular-nums">
          {formatTargetStrikePrice(strikeTarget, TARGET_STRIKE_DECIMALS[asset] ?? 0)}
        </span>
        {mathYesProb !== null && (
          <div className="inline-flex items-center gap-0.5 shrink-0">
            <div
              className={`inline-flex h-4 min-w-[2.75rem] shrink-0 items-center justify-center gap-0.5 rounded px-1 text-[8px] font-bold tabular-nums ${mathBadgeColorClass}`}
            >
              <CirclePercent className="h-2.5 w-2.5 shrink-0 opacity-90" strokeWidth={2.5} aria-hidden />
              <span>{(mathYesProb * 100).toFixed(0)}</span>
            </div>
            {bidVsMath !== null && (
              <div
                className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                  bidVsMath === 'bidAbove'
                    ? 'bg-green-900/65 border-green-600/45 text-green-100'
                    : bidVsMath === 'bidBelow'
                      ? 'bg-red-900/65 border-red-600/45 text-red-100'
                      : 'bg-gray-800/40 border-gray-500/30 text-gray-300/90'
                } ${triangleBadgeFlash ? 'updown-triangle-badge-flash' : ''}`}
              >
                {bidVsMath === 'bidAbove' && (
                  <Triangle className="h-2.5 w-2.5 fill-current stroke-current" strokeWidth={1.5} aria-hidden />
                )}
                {bidVsMath === 'bidBelow' && (
                  <Triangle className="h-2.5 w-2.5 rotate-180 fill-current stroke-current" strokeWidth={1.5} aria-hidden />
                )}
                {bidVsMath === 'tie' && <Minus className="h-2.5 w-2.5" strokeWidth={2.5} aria-hidden />}
              </div>
            )}
          </div>
        )}
      </div>
    </td>
  ) : null;

  const quoteCell = (
    <td
      key={asset}
      data-market-id={market.id}
      className={`market-cell px-0.5 py-1 text-center whitespace-nowrap border-l border-r border-solid border-gray-700 relative cursor-pointer hover:brightness-125 ${isSelected ? 'selected ring-2 ring-blue-500 ring-inset z-10' : ''} ${isLastTfRow ? 'border-b' : 'border-b border-gray-700/50'}`}
      style={{
        minWidth: 60,
        ...assetBorderStyle(asset, showTarget ? { B: isLastTfRow } : { L: true, B: isLastTfRow }),
      }}
      onClick={() => onCellClick(market)}
    >
      <UpDownCellPositionDots
        yesTokenId={yesTokenId}
        noTokenId={noTokenId}
        positionTokenIds={positionTokenIds}
        liveTradesSource={liveTradesSource}
      />
      <MarketCellMidRow
        className="text-[10px] text-gray-400"
        left={
          <span className="cursor-pointer hover:underline text-green-400" onClick={(e) => { e.stopPropagation(); onCellClick(market, 'YES'); }}>
            {yesMidStr}
          </span>
        }
        right={
          <span className="cursor-pointer hover:underline text-red-400" onClick={(e) => { e.stopPropagation(); onCellClick(market, 'NO'); }}>
            {noProbStr}
          </span>
        }
      />
      <UpDownCellOrderBadges yesTokenId={yesTokenId} noTokenId={noTokenId} orderLookup={orderLookup} />
      <div className="absolute left-0 bottom-0 w-[2px] pointer-events-none z-0 bg-gray-800/80 overflow-hidden" style={{ height: '100%' }} title={`Concentration (top wallets): ${concPct.toFixed(0)}%`}>
        <div className="absolute bottom-0 left-0 w-full transition-all" style={{ height: `${concPct}%`, backgroundColor: concColor }} />
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[2px] pointer-events-none z-[1] flex" title={`Smart Money (proven wallets): ${(provenSMS * 100).toFixed(0)}%`}>
        <div className="bg-yellow-400/75 h-full shrink-0 transition-[width]" style={{ width: `${smartMoneyBarPct}%` }} />
        <div className="bg-purple-400/75 h-full flex-1 min-w-0" />
      </div>
      {market.endDate && duration > 0 && <UpDownExpiryBar endDate={market.endDate} durationMs={duration} />}
    </td>
  );

  const futureCells = futuresSlots.map((nextMarket, slotIdx) => {
    const isLastSlot = slotIdx === nextMarketsCount - 1;
    const env = assetBorderStyle(asset, isLastSlot ? { R: true, B: isLastTfRow } : { B: isLastTfRow });
    if (!nextMarket) {
      return (
        <td
          key={`${asset}-next-${slotIdx}`}
          className={`px-1 py-1 text-center border-l border-r border-solid border-gray-700 bg-gray-900/30 text-gray-600 text-[10px] whitespace-nowrap ${isLastTfRow ? 'border-b' : 'border-b border-gray-700/50'}`}
          style={env}
        >
          -
        </td>
      );
    }
    const nextTokenIds = nextMarket.clobTokenIds || [];
    const nextYesTokenId = nextTokenIds[0] || '';
    const nextGammaYes = { bestBid: nextMarket.bestBid, bestAsk: nextMarket.bestAsk };
    const nextYesMid = outcomeMidOrOneSideProb(nextYesTokenId, bidAskLookup, nextGammaYes);
    const nextNoProb = nextYesMid != null ? 1 - nextYesMid : null;
    const nextNoTokenId = nextTokenIds[1] || '';
    const nextHi = upDownNextHiAlertEnabled
      ? nextMarketHiFlashSides(nextMarket, bidAskLookup, {
          liveOnly: true,
          hiThreshold: upDownNextHiThreshold,
        })
      : { yesHi: false, noHi: false };
    const nextBidHi = nextHi.yesHi;
    const nextNoHi = nextHi.noHi;
    const nextHiPillBase =
      'inline-flex min-h-[1.125rem] items-center justify-center rounded border px-0.5 text-[10px] font-extrabold tabular-nums text-white shrink-0';
    const isNextSelected = selectedMarketId === nextMarket.id;
    return (
      <td
        key={`${asset}-next-${slotIdx}`}
        data-market-id={nextMarket.id}
        className={`px-1 py-1 text-center border-l border-r border-solid border-gray-700 bg-gray-900/30 text-[10px] whitespace-nowrap cursor-pointer hover:brightness-125 relative ${isNextSelected ? 'selected ring-2 ring-blue-500 ring-inset z-10' : ''} ${isLastTfRow ? 'border-b' : 'border-b border-gray-700/50'}`}
        style={env}
        onClick={() => onCellClick(nextMarket)}
        title={`Next market +${slotIdx + 1} in this lane`}
      >
        <UpDownCellPositionDots
          yesTokenId={nextYesTokenId}
          noTokenId={nextNoTokenId}
          positionTokenIds={positionTokenIds}
          liveTradesSource={liveTradesSource}
        />
        <MarketCellMidRow
          className="text-gray-400"
          left={
            <span
              className={
                nextBidHi
                  ? `${nextHiPillBase} updown-triangle-badge-flash cursor-pointer hover:brightness-110 bg-green-900/65 border-green-600/45`
                  : 'text-green-400 cursor-pointer hover:underline'
              }
              onClick={(e) => {
                e.stopPropagation();
                onCellClick(nextMarket, 'YES');
              }}
            >
              {nextYesMid != null ? (nextYesMid * 100).toFixed(1) : '-'}
            </span>
          }
          right={
            <span
              className={
                nextNoHi
                  ? `${nextHiPillBase} updown-triangle-badge-flash cursor-pointer hover:brightness-110 bg-red-900/65 border-red-600/45`
                  : 'text-red-400 cursor-pointer hover:underline'
              }
              onClick={(e) => {
                e.stopPropagation();
                onCellClick(nextMarket, 'NO');
              }}
            >
              {nextNoProb != null ? (nextNoProb * 100).toFixed(1) : '-'}
            </span>
          }
        />
        <UpDownCellOrderBadges
          yesTokenId={nextYesTokenId}
          noTokenId={nextNoTokenId}
          orderLookup={orderLookup}
        />
        {nextMarket.endDate && duration > 0 && (
          <UpDownExpiryBar endDate={nextMarket.endDate} durationMs={duration} className="absolute bottom-0 left-0 z-0 h-[2px] pointer-events-none" />
        )}
      </td>
    );
  });

  return (
    <>
      {targetCell}
      {quoteCell}
      {futureCells}
    </>
  );
}

function futuresSlotsEqual(a: (Market | null)[], b: (Market | null)[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ma = a[i];
    const mb = b[i];
    if (ma === mb) continue;
    if (ma == null || mb == null) return false;
    if (!marketRowContentEqual(ma, mb)) return false;
  }
  return true;
}

export const UpDownAssetLaneCells = memo(UpDownAssetLaneCellsInner, (a, b) => {
  if (
    a.asset !== b.asset ||
    a.tf !== b.tf ||
    a.showTarget !== b.showTarget ||
    a.isLastTfRow !== b.isLastTfRow ||
    a.nextMarketsCount !== b.nextMarketsCount ||
    a.vol !== b.vol ||
    a.volMultiplier !== b.volMultiplier ||
    a.bsTimeOffsetHours !== b.bsTimeOffsetHours ||
    a.selectedMarketId !== b.selectedMarketId ||
    a.onCellClick !== b.onCellClick ||
    a.liveTradesSource !== b.liveTradesSource ||
    a.positionTokenIds !== b.positionTokenIds ||
    a.orderLookup !== b.orderLookup
  ) {
    return false;
  }
  if (!marketRowContentEqual(a.market, b.market)) return false;
  return futuresSlotsEqual(a.futuresSlots, b.futuresSlots);
});
