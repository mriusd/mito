import { memo, useMemo } from 'react';
import type { Market, Position } from '../types';
import type { SidebarObAggStep } from '../lib/sidebarOrderbookAggregate';
import { sidebarObAggOrderPriceCents, sidebarUserPriceHitsBucket } from '../lib/sidebarOrderbookAggregate';
import { SidebarBarMidMarker } from './SidebarBarMidMarker';

export type SidebarObLevel = { price: string; size: string; bandUsd?: number };

function obLevelUsd(level: SidebarObLevel): number {
  const size = parseFloat(level.size);
  const price = parseFloat(level.price);
  if (!Number.isFinite(size) || !Number.isFinite(price)) return 0;
  return size * price;
}

function fmtObLevelUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0';
  if (usd < 10) return `$${usd.toFixed(2).replace(/\.?0+$/, '')}`;
  const n = Math.round(usd);
  if (n >= 1_000_000) return `$${Math.round(n / 1_000_000)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000)}k`;
  return `$${n}`;
}

export type SidebarOrderbookBookGridProps = {
  displayBids: SidebarObLevel[];
  displayAsks: SidebarObLevel[];
  obAggStep: SidebarObAggStep;
  yesBidUsd?: number;
  noBidUsd?: number;
  displayBidFullUsd?: number;
  displayAskFullUsd?: number;
  sidebarUserBidPrices: Set<string>;
  sidebarUserAskPrices: Set<string>;
  readOnly?: boolean;
  selectedMarket?: Market | null;
  orderOutcome?: 'YES' | 'NO';
  positions?: Position[];
  setOrderSide?: (s: 'BUY' | 'SELL') => void;
  setOrderPrice?: (p: string) => void;
  setOrderAmount?: (a: string) => void;
  overlay?: { text: string; className: string } | null;
};

const OB_ROW_GRID = 'grid grid-cols-3 gap-1 text-[11px] px-1';

type ObRowSide = 'bid' | 'ask';

type ObBookRowProps = {
  side: ObRowSide;
  orderPk: string;
  bpDisp: string;
  levelSize: number;
  levelUsd: number;
  cumulativeUsd: number;
  cumulativeSize: number;
  depthPct: number;
  levelPct: number;
  hl: string;
  readOnly: boolean;
  title: string;
  onClick?: () => void;
};

function obBookRowEqual(a: ObBookRowProps, b: ObBookRowProps): boolean {
  return (
    a.side === b.side &&
    a.orderPk === b.orderPk &&
    a.bpDisp === b.bpDisp &&
    a.levelSize === b.levelSize &&
    a.levelUsd === b.levelUsd &&
    a.cumulativeUsd === b.cumulativeUsd &&
    a.cumulativeSize === b.cumulativeSize &&
    a.depthPct === b.depthPct &&
    a.levelPct === b.levelPct &&
    a.hl === b.hl &&
    a.readOnly === b.readOnly &&
    a.title === b.title &&
    a.onClick === b.onClick
  );
}

const SidebarObBookRow = memo(function SidebarObBookRow({
  side,
  bpDisp,
  levelSize,
  cumulativeUsd,
  depthPct,
  levelPct,
  hl,
  readOnly,
  title,
  onClick,
}: ObBookRowProps) {
  const isBid = side === 'bid';
  const hoverCls = readOnly ? '' : isBid ? 'hover:bg-green-900/30 cursor-pointer' : 'hover:bg-red-900/30 cursor-pointer';
  const depthBarCls = isBid ? 'sidebar-ob-depth-bar-bid' : 'sidebar-ob-depth-bar-ask';
  const levelBarCls = isBid ? 'sidebar-ob-level-bar-bid' : 'sidebar-ob-level-bar-ask';
  const barAnchor = isBid ? 'right-0' : 'left-0';
  const priceCls = isBid ? 'live-ob-bid' : 'live-ob-ask';

  return (
    <div
      className={`relative ${OB_ROW_GRID} ${hoverCls} ${hl}`}
      title={title}
      onClick={readOnly ? undefined : onClick}
    >
      <div className="absolute inset-0 z-0 pointer-events-none" aria-hidden>
        <div className={`absolute inset-y-0 ${barAnchor} ${depthBarCls}`} style={{ width: `${depthPct}%` }} />
        <div
          className={`absolute inset-y-0 ${barAnchor} ${levelBarCls}`}
          style={{ width: `${levelPct}%`, minWidth: levelPct > 0 ? 2 : 0 }}
        />
      </div>
      <span className={`relative z-[1] block min-w-0 w-full text-left ${priceCls}`}>{bpDisp}¢</span>
      <span className="relative z-[1] block min-w-0 w-full text-right live-ob-size tabular-nums sidebar-readable-value">
        {levelSize.toFixed(0)}
      </span>
      <span className="relative z-[1] block min-w-0 w-full text-right live-ob-usd tabular-nums sidebar-readable-value">
        {fmtObLevelUsd(cumulativeUsd)}
      </span>
    </div>
  );
}, obBookRowEqual);

type ObPreparedRow = Omit<ObBookRowProps, 'readOnly' | 'onClick'> & { onClick?: () => void };

/** Row USD = actual size×price (band clamp 5–95¢ is for depth bar only). */
function obLevelDisplayUsd(level: SidebarObLevel): number {
  return obLevelUsd(level);
}

function prepareObSideRows(
  levels: SidebarObLevel[],
  side: ObRowSide,
  obAggStep: SidebarObAggStep,
  userPrices: Set<string>,
  maxBookLevelSize: number,
  readOnly: boolean,
  onLevelClick: (orderPk: string, levelSize: number, cumulativeSize: number) => void,
  sideFullUsd?: number,
): ObPreparedRow[] {
  let cumul = 0;
  let cumulUsd = 0;
  const cumuls: number[] = [];
  const cumulUsds: number[] = [];
  for (const level of levels) {
    cumul += parseFloat(level.size) || 0;
    cumuls.push(cumul);
    cumulUsd += obLevelDisplayUsd(level);
    cumulUsds.push(cumulUsd);
  }
  const lastIdx = levels.length - 1;
  const maxCumul = cumuls.length > 0 ? cumuls[cumuls.length - 1] : 1;

  let prevCumulUsd = 0;
  return levels.map((level, i) => {
    const levelSize = parseFloat(level.size) || 0;
    const levelUsd = obLevelDisplayUsd(level);
    let cumulativeUsd = cumulUsds[i];
    if (i === lastIdx && typeof sideFullUsd === 'number' && Number.isFinite(sideFullUsd) && sideFullUsd > 0) {
      cumulativeUsd = Math.max(cumulativeUsd, sideFullUsd);
    }
    cumulativeUsd = Math.max(cumulativeUsd, prevCumulUsd);
    prevCumulUsd = cumulativeUsd;
    const cumulativeSize = cumuls[i];
    const centsNum = Math.round(parseFloat(level.price) * 1000) / 10;
    const bpDisp = obAggStep === '0.1' ? centsNum.toFixed(1) : String(Math.round(centsNum));
    const orderPk = sidebarObAggOrderPriceCents(centsNum, obAggStep, side);
    const hl = sidebarUserPriceHitsBucket(userPrices, centsNum, obAggStep, side)
      ? side === 'bid'
        ? 'bg-blue-900/50 font-bold'
        : 'bg-orange-900/50 font-bold'
      : '';
    const depthPct = maxCumul > 0 ? (cumulativeSize / maxCumul) * 100 : 0;
    const levelPct = maxBookLevelSize > 0 ? (levelSize / maxBookLevelSize) * 100 : 0;
    const sideLabel = side === 'bid' ? 'Bid' : 'Ask';
    const title = `${sideLabel} ${bpDisp}¢ · ${levelSize.toFixed(0)} shares · level ${fmtObLevelUsd(levelUsd)} · cumulative ${cumulativeSize.toFixed(0)} shares / ${fmtObLevelUsd(cumulativeUsd)} (${depthPct.toFixed(0)}% of book shares · ${levelPct.toFixed(0)}% of max bid/ask size at level)`;

    return {
      side,
      orderPk: `${side}-${orderPk}`,
      bpDisp,
      levelSize,
      levelUsd,
      cumulativeUsd,
      cumulativeSize,
      depthPct,
      levelPct,
      hl,
      title,
      onClick: readOnly ? undefined : () => onLevelClick(orderPk, levelSize, cumulativeSize),
    };
  });
}

export const SidebarOrderbookBookGrid = memo(function SidebarOrderbookBookGrid({
  displayBids,
  displayAsks,
  obAggStep,
  yesBidUsd = 0,
  noBidUsd = 0,
  displayBidFullUsd,
  displayAskFullUsd,
  sidebarUserBidPrices,
  sidebarUserAskPrices,
  readOnly = false,
  selectedMarket = null,
  orderOutcome = 'YES',
  positions = [],
  setOrderSide,
  setOrderPrice,
  setOrderAmount,
  overlay = null,
}: SidebarOrderbookBookGridProps) {
  const maxBookLevelSize = useMemo(() => {
    let max = 0;
    for (const level of displayBids) max = Math.max(max, parseFloat(level.size) || 0);
    for (const level of displayAsks) max = Math.max(max, parseFloat(level.size) || 0);
    return max || 1;
  }, [displayBids, displayAsks]);

  const { leftBarUsd, rightBarUsd, barImbalance } = useMemo(() => {
    const left = yesBidUsd;
    const right = noBidUsd;
    const denom = left + right;
    return {
      leftBarUsd: left,
      rightBarUsd: right,
      barImbalance: denom > 0 ? (left - right) / denom : 0,
    };
  }, [yesBidUsd, noBidUsd]);

  const longShortImbalance = barImbalance;
  const longBarPct = Math.max(2, Math.min(98, 50 + longShortImbalance * 50));

  const bidRows = useMemo(
    () =>
      prepareObSideRows(
        displayBids,
        'bid',
        obAggStep,
        sidebarUserBidPrices,
        maxBookLevelSize,
        readOnly,
        (orderPk, _levelSize, _cumulativeSize) => {
          setOrderSide?.('SELL');
          setOrderPrice?.(orderPk);
          const tokenId = selectedMarket?.clobTokenIds?.[orderOutcome === 'YES' ? 0 : 1] || '';
          const pos = positions.find((p) => p.asset === tokenId && p.size > 0);
          if (pos) setOrderAmount?.(String(Math.floor(pos.size * 100) / 100));
          else setOrderAmount?.('');
        },
        displayBidFullUsd,
      ),
    [
      displayBids,
      obAggStep,
      sidebarUserBidPrices,
      maxBookLevelSize,
      readOnly,
      setOrderSide,
      setOrderPrice,
      setOrderAmount,
      selectedMarket,
      orderOutcome,
      positions,
      displayBidFullUsd,
    ],
  );

  const askRows = useMemo(
    () =>
      prepareObSideRows(
        displayAsks,
        'ask',
        obAggStep,
        sidebarUserAskPrices,
        maxBookLevelSize,
        readOnly,
        (orderPk, _levelSize, cumulativeSize) => {
          setOrderSide?.('BUY');
          setOrderPrice?.(orderPk);
          setOrderAmount?.(cumulativeSize.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1'));
        },
        displayAskFullUsd,
      ),
    [
      displayAsks,
      obAggStep,
      sidebarUserAskPrices,
      maxBookLevelSize,
      readOnly,
      setOrderSide,
      setOrderPrice,
      setOrderAmount,
      displayAskFullUsd,
    ],
  );

  return (
    <>
      <div
        className="shrink-0 mb-1.5 px-0.5"
        title={`YES bids $${Math.round(leftBarUsd).toLocaleString()} · NO bids $${Math.round(rightBarUsd).toLocaleString()} · full book 5–95¢ · ${(longShortImbalance * 100).toFixed(1)}% YES-bid-heavy (blue)`}
      >
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-[9px] tabular-nums font-semibold text-blue-400 sidebar-readable-value min-w-[2.25rem] text-left">
            {fmtObLevelUsd(leftBarUsd)}
          </span>
          <div className="relative h-[5px] bg-gray-700 rounded-full overflow-hidden flex flex-1 min-w-0">
            <div
              className="h-full"
              style={{
                width: `${longBarPct}%`,
                backgroundColor: 'rgb(37 99 235 / 0.7)',
              }}
            />
            <div className="h-full flex-1" style={{ backgroundColor: 'rgb(250 204 21 / 0.7)' }} />
            <SidebarBarMidMarker />
          </div>
          <span className="shrink-0 text-[9px] tabular-nums font-semibold text-yellow-400 sidebar-readable-value min-w-[2.25rem] text-right">
            {fmtObLevelUsd(rightBarUsd)}
          </span>
        </div>
      </div>
      <div className="relative grid grid-cols-2 gap-2 flex-1 min-h-0">
        <div>
          <div className={`${OB_ROW_GRID} text-gray-500 mb-1`}>
            <span className="block min-w-0 w-full text-left">Bid</span>
            <span className="block min-w-0 w-full text-right">Size</span>
            <span className="block min-w-0 w-full text-right">USD</span>
          </div>
          <div className="space-y-0.5">
            {bidRows.map((row) => (
              <SidebarObBookRow key={row.orderPk} {...row} readOnly={readOnly} />
            ))}
          </div>
        </div>
        <div>
          <div className={`${OB_ROW_GRID} text-gray-500 mb-1`}>
            <span className="block min-w-0 w-full text-left">Ask</span>
            <span className="block min-w-0 w-full text-right">Size</span>
            <span className="block min-w-0 w-full text-right">USD</span>
          </div>
          <div className="space-y-0.5">
            {askRows.map((row) => (
              <SidebarObBookRow key={row.orderPk} {...row} readOnly={readOnly} />
            ))}
          </div>
        </div>
        {overlay ? (
          <div className="absolute inset-0 z-10 bg-gray-900/55 backdrop-blur-[1px] flex items-center justify-center pointer-events-none px-2">
            <div className={`text-[11px] text-center leading-tight ${overlay.className}`}>{overlay.text}</div>
          </div>
        ) : null}
      </div>
    </>
  );
});
