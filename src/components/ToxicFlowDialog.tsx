import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, TrendingUp, TrendingDown, Users, BarChart3, AlertTriangle, Crown, ShieldAlert, UsersRound, ExternalLink, Copy } from 'lucide-react';
import { fetchToxicFlow, fetchWalletSummary, fetchWalletPositions, fetchOnchainFills } from '../api';
import type { ToxicFlowData, WalletPosition, WalletSummary, OnchainFillRow } from '../api';
import { shortenMarketName } from '../utils/format';
import { useAppStore } from '../stores/appStore';

interface ToxicFlowDialogProps {
  open: boolean;
  marketId: string;
  marketName: string;
  yesTokenId?: string;
  onClose: () => void;
}

type Tab = 'topHolders' | 'topYes' | 'topNo' | 'topVolume' | 'topTraders';

function walletInvY(w: WalletPosition): number {
  return typeof w.invYes === 'number' && Number.isFinite(w.invYes) ? w.invYes : w.netYes ?? 0;
}
function walletInvN(w: WalletPosition): number {
  return typeof w.invNo === 'number' && Number.isFinite(w.invNo) ? w.invNo : w.netNo ?? 0;
}
/** Net = Inv Y − Inv N (matches holders table). */
function walletNet(w: WalletPosition): number {
  return walletInvY(w) - walletInvN(w);
}

function fmtPriceShare(p: number | undefined): string {
  if (p == null || !Number.isFinite(p)) return '–';
  if (Math.abs(p) < 1e-12) return '-';
  return `${(p * 100).toFixed(1)}¢`;
}

function rPnlToneClass(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return 'text-gray-400';
  return v > 0 ? 'text-green-400' : 'text-red-400';
}

/** Same wallet must not rank both tabs: keep stronger |leg| only (tie → YES). */
function filterTopYesNoTab(wallets: WalletPosition[] | undefined, tab: 'yes' | 'no'): WalletPosition[] {
  const arr = wallets ?? [];
  return arr.filter((w) => {
    const ny = walletInvY(w);
    const nn = walletInvN(w);
    if (tab === 'yes') return ny > 0.001 && Math.abs(ny) >= Math.abs(nn);
    return nn > 0.001 && Math.abs(nn) > Math.abs(ny);
  });
}

function getDateDisplay(endDate: string | null): { label: string; color: string } {
  if (!endDate) return { label: '-', color: 'text-gray-400' };
  const dt = new Date(endDate);
  const hoursLeft = (dt.getTime() - Date.now()) / (1000 * 60 * 60);
  const isToday = hoursLeft > 0 && hoursLeft < 24;
  const isTmr = !isToday && hoursLeft > 0 && hoursLeft < 48;
  const dayAbbr = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][dt.getDay()];
  if (isToday) return { label: 'TODAY', color: 'text-red-400 font-bold' };
  if (isTmr) return { label: 'TMR', color: 'text-yellow-400 font-bold' };
  const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
  return { label: `${dayAbbr} ${dt.getDate()}`, color: isWeekend ? 'text-purple-400' : 'text-gray-400' };
}

function getResolvedDisplay(market: any, row?: WalletPosition): { label: string; color: string } {
  const isUpDown = /up\s+or\s+down|updown|up-or-down/i.test(`${market?.question || ''} ${market?.eventSlug || ''}`);
  const yesLabel = isUpDown ? 'UP' : 'YES';
  const noLabel = isUpDown ? 'DOWN' : 'NO';
  // Prefer backend truth from market_results join on wallet-positions response.
  if (typeof row?.resultYes === 'number' && row.resultYes >= 0) {
    if (row.resultYes === 1) return { label: `Resolved ${yesLabel}`, color: 'text-green-400 font-bold' };
    return { label: `Resolved ${noLabel}`, color: 'text-red-400 font-bold' };
  }
  if (!market?.closed) return { label: '-', color: 'text-gray-500' };
  const raw = market?.outcomePrices;
  let yesPrice: number | null = null;
  let noPrice: number | null = null;
  if (Array.isArray(raw) && raw.length >= 2) {
    yesPrice = Number(raw[0]);
    noPrice = Number(raw[1]);
  } else if (typeof raw === 'string' && raw.trim()) {
    const cleaned = raw.replace(/^\[/, '').replace(/\]$/, '');
    const parts = cleaned.split(',').map((s) => Number(String(s).trim()));
    if (parts.length >= 2) {
      yesPrice = parts[0];
      noPrice = parts[1];
    }
  }
  if (yesPrice != null && noPrice != null && Number.isFinite(yesPrice) && Number.isFinite(noPrice)) {
    if (yesPrice > noPrice) return { label: `Resolved ${yesLabel}`, color: 'text-green-400 font-bold' };
    if (noPrice > yesPrice) return { label: `Resolved ${noLabel}`, color: 'text-red-400 font-bold' };
  }
  return { label: 'Resolved', color: 'text-gray-400' };
}

function shortenWallet(w: string): string {
  if (w.length <= 12) return w;
  return w.slice(0, 6) + '…' + w.slice(-4);
}

function sameClobToken(a: string, b: string): boolean {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  try {
    return BigInt(sa) === BigInt(sb);
  } catch {
    return false;
  }
}

function isUpDownFromFill(mk: any, f: OnchainFillRow): boolean {
  const blob = `${f.marketType || ''} ${mk?.marketType || ''} ${mk?.question || ''} ${mk?.eventSlug || ''}`.toLowerCase();
  return /upordown|up-down|up\s*or\s*down|updown/.test(blob);
}

/** API `side` varies (Yes/No/YES/empty). Infer YES/NO (or UP/DOWN) from `tokenId` vs market clob ids when missing. */
function isLedgerFillRow(f: OnchainFillRow): boolean {
  return f.fillSource === 'wallet_fill_ledger';
}

function fillOutcomeDisplay(f: OnchainFillRow, mk: any): { text: string; tone: 'yes' | 'no' | 'muted' } {
  const upDown = isUpDownFromFill(mk, f);
  const yesLab = upDown ? 'UP' : 'YES';
  const noLab = upDown ? 'DOWN' : 'NO';
  const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '');
  const raw = String(f.side ?? '').trim();
  if (raw) {
    const u = norm(raw);
    if (u === 'YES' || u === 'Y' || u === 'UP') return { text: yesLab, tone: 'yes' };
    if (u === 'NO' || u === 'N' || u === 'DOWN') return { text: noLab, tone: 'no' };
    return { text: raw, tone: 'muted' };
  }
  const tid = String(f.tokenId || '').trim();
  const yT = String(mk?.clobTokenIds?.[0] ?? '').trim();
  const nT = String(mk?.clobTokenIds?.[1] ?? '').trim();
  if (tid && yT && sameClobToken(tid, yT)) return { text: yesLab, tone: 'yes' };
  if (tid && nT && sameClobToken(tid, nT)) return { text: noLab, tone: 'no' };
  return { text: '-', tone: 'muted' };
}

function normalizeWinRate(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  // Accept either 0..1 or 0..100 from backend variants.
  const scaled = v > 1 ? v / 100 : v;
  return Math.max(0, Math.min(1, scaled));
}

/** Gold “smart” only if proven smart and this-market cash flow is not negative. */
function isSmartGold(row: Pick<WalletPosition, 'isSmart' | 'cashFlow'>): boolean {
  if (!row.isSmart) return false;
  const c = row.cashFlow;
  const n = typeof c === 'number' && Number.isFinite(c) ? c : 0;
  return n >= -1e-6;
}

/** Holder-row stats when /api/wallet-summary has no DB row (do not cache misses — avoids poisoned tooltip cache). */
function rowHolderSummary(row: WalletPosition): WalletSummary | null {
  const usdcIn = row.usdcIn || 0;
  const usdcOut = row.usdcOut || 0;
  const tc = row.tradeCount || 0;
  const net = row.net || 0;
  const wr = normalizeWinRate(row.winRate);
  const wlt = row.winLossTotal || 0;
  const wins = typeof row.wins === 'number' && Number.isFinite(row.wins) ? row.wins : 0;
  const losses = typeof row.losses === 'number' && Number.isFinite(row.losses) ? row.losses : 0;
  const flat = typeof row.flat === 'number' && Number.isFinite(row.flat) ? row.flat : 0;
  const scoredBreakdown = wins + losses + flat;
  const hasVol = usdcIn + usdcOut > 1e-6;
  const hasPos = Math.abs(net) > 1e-6;
  const hasWin = wlt > 0 && wr != null;
  if (!hasVol && tc === 0 && !hasPos && !hasWin) return null;
  const tradingPnl =
    typeof row.cashFlow === 'number' && Number.isFinite(row.cashFlow) ? row.cashFlow : usdcOut - usdcIn;
  return {
    found: true,
    wallet: (row.wallet || '').toLowerCase(),
    totalMarkets: 0,
    resolvedMarkets: scoredBreakdown > 0 ? scoredBreakdown : wlt,
    totalTrades: tc,
    totalUsdcIn: usdcIn,
    totalUsdcOut: usdcOut,
    tradingPnl,
    resolutionValue: 0,
    pnl: typeof row.pnl === 'number' && Number.isFinite(row.pnl) ? row.pnl : tradingPnl,
    wins,
    losses,
    flat,
    winRate: wr ?? 0,
  };
}

/** Green segment = win rate, red = loss rate (0–1). Use as cell bottom edge or stacked under wallet. */
function WinRateBottomBar({ winRate, className }: { winRate: number; className?: string }) {
  const w = normalizeWinRate(winRate) ?? 0;
  const pctWin = w * 100;
  const pctLoss = (1 - w) * 100;
  return (
    <div
      className={`flex h-0.5 w-full min-w-[40px] overflow-hidden rounded-[1px] ${className ?? ''}`}
      title={`Win ${pctWin.toFixed(0)}% · loss ${pctLoss.toFixed(0)}%`}
    >
      <div className="h-full shrink-0 bg-emerald-500" style={{ width: `${pctWin}%` }} />
      <div className="h-full shrink-0 bg-red-600" style={{ width: `${pctLoss}%` }} />
    </div>
  );
}

// Wallet hover tooltip — fetches summary on hover, caches results
const summaryCache: Record<string, WalletSummary | null> = {};

type WalletTipPos = { left: number; top: number; placeAbove: boolean };

function WalletLink({
  wallet,
  netShares,
  onOpenWallet,
  isSmart,
  holderRow,
}: {
  wallet: string;
  netShares?: number;
  onOpenWallet?: (wallet: string, netShares?: number) => void;
  isSmart?: boolean;
  /** Toxic-flow table row: used for tooltip when wallet-summary API misses. */
  holderRow?: WalletPosition;
}) {
  const [summary, setSummary] = useState<WalletSummary | null | undefined>(undefined);
  const [show, setShow] = useState(false);
  const [tipPos, setTipPos] = useState<WalletTipPos | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const enterTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);

  const clearLeaveTimer = () => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  };

  const scheduleHide = () => {
    clearLeaveTimer();
    leaveTimerRef.current = window.setTimeout(() => {
      leaveTimerRef.current = null;
      setShow(false);
      setSummary(undefined);
      setTipPos(null);
    }, 220);
  };

  const updateTipPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el || !show) return;
    const r = el.getBoundingClientRect();
    const estH = 260;
    const margin = 6;
    const spaceBelow = window.innerHeight - r.bottom - 12;
    const placeAbove = spaceBelow < estH && r.top > estH + 32;
    const minW = 200;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - minW - 16));
    setTipPos({
      left,
      top: placeAbove ? r.top - margin : r.bottom + margin,
      placeAbove,
    });
  }, [show]);

  useLayoutEffect(() => {
    if (!show) {
      setTipPos(null);
      return;
    }
    updateTipPosition();
  }, [show, summary, wallet, updateTipPosition]);

  useEffect(() => {
    if (!show) return;
    updateTipPosition();
    const onMove = () => updateTipPosition();
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [show, updateTipPosition]);

  const onEnterAnchor = () => {
    clearLeaveTimer();
    enterTimerRef.current = window.setTimeout(async () => {
      enterTimerRef.current = null;
      setShow(true);
      const wk = wallet.toLowerCase();
      const hit = summaryCache[wk];
      if (hit) {
        setSummary(hit);
        return;
      }
      const s = await fetchWalletSummary(wallet);
      if (s) summaryCache[wk] = s;
      setSummary(s);
    }, 300);
  };

  const onLeaveAnchor = () => {
    if (enterTimerRef.current) {
      clearTimeout(enterTimerRef.current);
      enterTimerRef.current = null;
    }
    scheduleHide();
  };

  const displaySummary = summary === null && holderRow ? rowHolderSummary(holderRow) : summary;
  const rowOnly = displaySummary && summary === null && holderRow && displaySummary.totalMarkets === 0;

  const tooltipInner = (
    <>
          <div className="font-mono text-blue-400 mb-1 text-[8px]">{wallet.slice(0, 10)}...{wallet.slice(-6)}</div>
          {summary === undefined && <div className="text-gray-500">Loading...</div>}
          {summary === null && !displaySummary && <div className="text-gray-500">No data yet</div>}
          {displaySummary && (
            <div className="space-y-0.5">
          {rowOnly && <div className="text-gray-500 mb-0.5">This market (summary API n/a)</div>}
          {typeof netShares === 'number' && Number.isFinite(netShares) && (
            <>
              <div className="flex justify-between gap-3">
                <span className="text-gray-500">Net shares</span>
                <span className={`font-bold ${netShares > 0.001 ? 'text-green-400' : netShares < -0.001 ? 'text-red-400' : 'text-gray-400'}`}>
                  {netShares > 0 ? '+' : ''}{netShares.toFixed(2)}
                </span>
              </div>
              <div className="border-t border-gray-700 my-0.5" />
            </>
          )}
              <div className="flex justify-between gap-3"><span className="text-gray-500">Markets</span><span className="text-white font-bold">{displaySummary.totalMarkets}{displaySummary.resolvedMarkets > 0 && displaySummary.totalMarkets > 0 ? <span className="text-gray-500 font-normal"> ({displaySummary.resolvedMarkets} resolved)</span> : displaySummary.resolvedMarkets > 0 && displaySummary.totalMarkets === 0 ? <span className="text-gray-500 font-normal"> ({displaySummary.resolvedMarkets} scored)</span> : ''}</span></div>
              <div className="flex justify-between gap-3"><span className="text-gray-500">Trades</span><span className="text-white">{displaySummary.totalTrades}</span></div>
              <div className="flex justify-between gap-3"><span className="text-gray-500">Vol In</span><span className="text-yellow-400">${displaySummary.totalUsdcIn.toFixed(2)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-gray-500">Vol Out</span><span className="text-yellow-400">${displaySummary.totalUsdcOut.toFixed(2)}</span></div>
              <div className="border-t border-gray-700 my-0.5" />
              <div className="flex justify-between gap-3"><span className="text-gray-500">Cash flow</span><span className={`${displaySummary.tradingPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{displaySummary.tradingPnl >= 0 ? '+' : ''}{displaySummary.tradingPnl.toFixed(2)}</span></div>
              {displaySummary.resolvedMarkets > 0 && displaySummary.totalMarkets > 0 && (
                <div className="flex justify-between gap-3"><span className="text-gray-500">Resolution</span><span className={`${displaySummary.resolutionValue >= 0 ? 'text-green-400' : 'text-red-400'}`}>{displaySummary.resolutionValue >= 0 ? '+' : ''}{displaySummary.resolutionValue.toFixed(2)}</span></div>
              )}
              <div className="flex justify-between gap-3"><span className="text-gray-500">Total PnL</span><span className={`font-bold ${displaySummary.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{displaySummary.pnl >= 0 ? '+' : ''}{displaySummary.pnl.toFixed(2)}</span></div>
              {((displaySummary.wins > 0 || displaySummary.losses > 0 || displaySummary.flat > 0) ||
                (rowOnly && (holderRow?.winLossTotal || 0) > 0 && normalizeWinRate(holderRow?.winRate) != null)) && (
                <>
                  <div className="border-t border-gray-700 my-0.5" />
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Win Rate</span><span className={`font-bold ${displaySummary.winRate >= 0.5 ? 'text-green-400' : 'text-red-400'}`}>{(displaySummary.winRate * 100).toFixed(0)}%</span></div>
                  {(displaySummary.wins > 0 || displaySummary.losses > 0 || displaySummary.flat > 0) ? (
                    <div className="flex justify-between gap-3"><span className="text-gray-500">W / L / F</span><span className="text-white">{displaySummary.wins}/{displaySummary.losses}/{displaySummary.flat}</span></div>
                  ) : holderRow && (holderRow.winLossTotal || 0) > 0 ? (
                    <div className="flex justify-between gap-3"><span className="text-gray-500">Scored</span><span className="text-white">{holderRow.winLossTotal} mkts</span></div>
                  ) : null}
                </>
              )}
            </div>
          )}
    </>
  );

  const portalTooltip =
    show &&
    tipPos &&
    typeof document !== 'undefined' &&
    createPortal(
      <div
        className="bg-gray-900 border border-gray-600 rounded shadow-xl p-2 min-w-[190px] max-w-[min(260px,calc(100vw-16px))] max-h-[min(320px,70vh)] overflow-y-auto text-[9px] pointer-events-auto"
        style={{
          position: 'fixed',
          left: tipPos.left,
          top: tipPos.top,
          transform: tipPos.placeAbove ? 'translateY(-100%)' : undefined,
          zIndex: 70000,
        }}
        onMouseEnter={clearLeaveTimer}
        onMouseLeave={scheduleHide}
      >
        {tooltipInner}
      </div>,
      document.body,
    );

  return (
    <span ref={anchorRef} className="relative inline-block" onMouseEnter={onEnterAnchor} onMouseLeave={onLeaveAnchor}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenWallet?.(wallet, netShares);
        }}
        className={`${isSmart ? 'text-yellow-400' : 'text-blue-400'} hover:underline font-mono inline-flex items-baseline flex-wrap gap-x-0`}
        title={isSmart ? 'Proven smart wallet' : undefined}
      >
        <span>{shortenWallet(wallet)}</span>
      </button>
      {portalTooltip}
    </span>
  );
}

function WalletTable({ wallets, label, totalShares, onOpenWallet }: { wallets: WalletPosition[] | null; label: string; totalShares?: number; onOpenWallet?: (wallet: string, netShares?: number) => void }) {
  const rows = wallets || [];
  const [walletSummaryMap, setWalletSummaryMap] = useState<Record<string, WalletSummary | null>>({});
  useEffect(() => {
    let cancelled = false;
    const uniq = Array.from(new Set(rows.map((w) => (w.wallet || '').toLowerCase()).filter(Boolean)));
    if (uniq.length === 0) {
      setWalletSummaryMap({});
      return;
    }
    (async () => {
      const pairs = await Promise.all(
        uniq.map(async (w) => {
          const hit = summaryCache[w];
          if (hit) return [w, hit] as const;
          const s = await fetchWalletSummary(w);
          if (s) summaryCache[w] = s;
          return [w, s] as const;
        }),
      );
      if (cancelled) return;
      const next: Record<string, WalletSummary | null> = {};
      for (const [w, s] of pairs) next[w] = s;
      setWalletSummaryMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [rows]);

  if (rows.length === 0) {
    return <div className="text-gray-500 text-center py-3 text-[10px]">No {label} data yet</div>;
  }

  const fmtInt = (v: number) => Math.round(v).toLocaleString();
  const fmtSignedInt = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v).toLocaleString()}`;
  const fmtUsdSigned = (v: number) => {
    if (!Number.isFinite(v)) return '–';
    const a = Math.abs(v);
    const s = v >= 0 ? '+' : '−';
    return `${s}$${a.toFixed(2)}`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full whitespace-nowrap text-[10px]">
        <thead>
          <tr className="text-gray-500 border-b border-gray-700">
            <th className="text-left py-1 px-1">#</th>
            <th className="text-left px-1">Wallet</th>
            <th className="text-right px-1 bg-green-900/15" title="inv_yes">
              Inv Y
            </th>
            <th className="text-right px-1 bg-red-900/15 text-red-300" title="inv_no">
              Inv N
            </th>
            <th className="text-right px-1" title="inv_yes − inv_no">
              Net
            </th>
            <th className="text-right px-1 text-gray-400" title="usd_yes">
              $ Y
            </th>
            <th className="text-right px-1 text-gray-400" title="usd_no">
              $ N
            </th>
            <th className="text-right px-1 text-gray-400" title="price_yes">
              Px Y
            </th>
            <th className="text-right px-1 text-gray-400" title="price_no">
              Px N
            </th>
            <th className="text-right px-1">Trades</th>
            <th className="text-right px-1" title="fee_total">
              Fees
            </th>
            <th className="text-right px-1" title="Σ ledger delta_usd (cash flow)">
              Cash Flow
            </th>
            <th className="text-right px-1 text-gray-400" title="pnl_yes">
              rPnL Y
            </th>
            <th className="text-right px-1 text-gray-400" title="pnl_no">
              rPnL N
            </th>
            <th className="text-right px-1" title="pnl_yes + pnl_no">
              rPnL
            </th>
            <th className="text-right px-1">%</th>
            <th className="text-right px-1">Cum%</th>
            <th className="text-right px-1">Bias</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            let cumSharesPct = 0;
            return rows.map((w, i) => {
              const wk = (w.wallet || '').toLowerCase();
              const sum = walletSummaryMap[wk];
              const summaryWinLossTotal = sum ? ((sum.wins || 0) + (sum.losses || 0)) : 0;
              const fallbackWinLossTotal = typeof w.winLossTotal === 'number' ? w.winLossTotal : 0;
              const effectiveWinLossTotal = sum ? summaryWinLossTotal : fallbackWinLossTotal;
              const effectiveWinRate = normalizeWinRate(sum ? sum.winRate : w.winRate);
            const iy = typeof w.invYes === 'number' && Number.isFinite(w.invYes) ? w.invYes : w.netYes ?? 0;
            const inn = typeof w.invNo === 'number' && Number.isFinite(w.invNo) ? w.invNo : w.netNo ?? 0;
            const signedLegNet = iy - inn;
            const grossLeg = Math.abs(iy) + Math.abs(inn);
            const bias =
              typeof w.inventoryBias === 'number' && Number.isFinite(w.inventoryBias)
                ? w.inventoryBias
                : grossLeg > 0
                  ? Math.abs(signedLegNet) / grossLeg
                  : 0;
            const biasColor = bias > 0.5 ? 'text-yellow-400' : bias > 0.3 ? 'text-orange-400' : 'text-gray-400';
              const sharesPct = totalShares && totalShares > 0 ? (Math.abs(signedLegNet) / totalShares) * 100 : 0;
              cumSharesPct += sharesPct;
            const nYColor = iy > 0.001 ? 'text-green-400' : iy < -0.001 ? 'text-red-400' : 'text-gray-500';
            const netYNColor =
              signedLegNet < -0.001 ? 'text-red-400' : signedLegNet > 0.001 ? 'text-green-400' : 'text-gray-500';
              const uy = typeof w.usdYes === 'number' && Number.isFinite(w.usdYes) ? w.usdYes : 0;
              const un = typeof w.usdNo === 'number' && Number.isFinite(w.usdNo) ? w.usdNo : 0;
              const fees = typeof w.feeTotal === 'number' && Number.isFinite(w.feeTotal) ? w.feeTotal : 0;
              const cashFlow =
                typeof w.cashFlow === 'number' && Number.isFinite(w.cashFlow) ? w.cashFlow : 0;
              const pyes = typeof w.pnlYes === 'number' && Number.isFinite(w.pnlYes) ? w.pnlYes : 0;
              const pno = typeof w.pnlNo === 'number' && Number.isFinite(w.pnlNo) ? w.pnlNo : 0;
              const rPnl =
                typeof w.rPnl === 'number' && Number.isFinite(w.rPnl) ? w.rPnl : pyes + pno;
              const showWinBar = effectiveWinLossTotal > 0 && effectiveWinRate != null;
            return (
              <tr key={w.wallet} className="border-b border-gray-800 hover:bg-gray-700/30">
                <td className="py-0.5 px-1 text-gray-600">{i + 1}</td>
                  <td className={`relative align-top px-1 py-0.5 ${showWinBar ? 'pb-2' : ''}`}>
                    <WalletLink wallet={w.wallet} netShares={signedLegNet} onOpenWallet={onOpenWallet} isSmart={isSmartGold(w)} holderRow={w} />
                    {showWinBar && <WinRateBottomBar winRate={effectiveWinRate!} className="absolute bottom-0 left-0 right-0" />}
                  </td>
                  <td className={`text-right px-1 font-bold ${nYColor} bg-green-900/10`}>{fmtInt(iy)}</td>
                  <td className="text-right px-1 font-bold text-red-400 bg-red-900/10">{fmtInt(inn)}</td>
                  <td className={`text-right px-1 font-bold ${netYNColor}`}>{fmtInt(signedLegNet)}</td>
                  <td className={`text-right px-1 text-gray-300 ${uy >= 0 ? '' : 'text-orange-300'}`}>{fmtUsdSigned(uy)}</td>
                  <td className={`text-right px-1 text-gray-300 ${un >= 0 ? '' : 'text-orange-300'}`}>{fmtUsdSigned(un)}</td>
                  <td className="text-right px-1 text-gray-300">{fmtPriceShare(w.priceYes)}</td>
                  <td className="text-right px-1 text-gray-300">{fmtPriceShare(w.priceNo)}</td>
                <td className="text-right px-1 text-gray-400">{w.tradeCount}</td>
                  <td className="text-right px-1 text-amber-200/90">{fees > 0 ? `$${fees.toFixed(2)}` : fees < 0 ? `−$${Math.abs(fees).toFixed(2)}` : '–'}</td>
                  <td className={`text-right px-1 font-bold ${cashFlow >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtUsdSigned(cashFlow)}</td>
                  <td className={`text-right px-1 font-bold ${rPnlToneClass(pyes)}`}>{fmtUsdSigned(pyes)}</td>
                  <td className={`text-right px-1 font-bold ${rPnlToneClass(pno)}`}>{fmtUsdSigned(pno)}</td>
                  <td className={`text-right px-1 font-bold ${rPnlToneClass(rPnl)}`}>{fmtUsdSigned(rPnl)}</td>
                  <td className="text-right px-1 text-cyan-300">{sharesPct > 0 ? `${sharesPct.toFixed(1)}%` : '-'}</td>
                  <td className="text-right px-1 text-cyan-200/70">{cumSharesPct > 0 ? `${cumSharesPct.toFixed(1)}%` : '-'}</td>
                <td className={`text-right px-1 ${biasColor}`}>{(bias * 100).toFixed(0)}%</td>
              </tr>
            );
            });
          })()}
        </tbody>
      </table>
    </div>
  );
}

export function WalletInfoDialog({
  open,
  wallet,
  initialNetShares,
  initialMarketId,
  onClose,
}: {
  open: boolean;
  wallet: string;
  initialNetShares?: number;
  /** When set (e.g. condition id), trades table opens on this market after load. */
  initialMarketId?: string;
  onClose: () => void;
}) {
  const marketLookup = useAppStore((s) => s.marketLookup);
  const [summary, setSummary] = useState<WalletSummary | null | undefined>(undefined);
  const [markets, setMarkets] = useState<WalletPosition[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [fills, setFills] = useState<OnchainFillRow[]>([]);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [loadingFills, setLoadingFills] = useState(false);
  const [fillsTotal, setFillsTotal] = useState(0);
  const [fillsPage, setFillsPage] = useState(0);
  const fillsPageSize = 200;
  const marketById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const mk of Object.values(marketLookup || {})) {
      if (mk?.id && !m[mk.id]) m[mk.id] = mk;
      const cid = ((mk as any)?.conditionId || '').trim().toLowerCase();
      if (cid && !m[cid]) m[cid] = mk;
    }
    return m;
  }, [marketLookup]);

  useEffect(() => {
    if (!open || !wallet) return;
    setSummary(undefined);
    setMarkets([]);
    setSelectedMarketId('');
    setFills([]);
    setFillsTotal(0);
    setFillsPage(0);
    setLoadingMarkets(true);
    const prefRaw = (initialMarketId || '').trim();
    const pref = prefRaw.toLowerCase();
    (async () => {
      try {
        const [s, p] = await Promise.all([
          fetchWalletSummary(wallet),
          fetchWalletPositions({ wallet, sort_by: 'trade_count', limit: 100, ledger: true }),
        ]);
        setSummary(s);
        const sorted = [...(p.positions || [])].sort((a, b) => (b.tradeCount || 0) - (a.tradeCount || 0));
        setMarkets(sorted);
        let pick = '';
        if (pref) {
          const hit = sorted.find((row) => String(row.marketId || '').trim().toLowerCase() === pref);
          if (hit) pick = hit.marketId;
          else pick = prefRaw;
        }
        if (!pick && sorted.length > 0) pick = sorted[0].marketId;
        if (pick) {
          setSelectedMarketId(pick);
          setFillsPage(0);
        }
      } finally {
        setLoadingMarkets(false);
      }
    })();
  }, [open, wallet, initialMarketId]);

  useEffect(() => {
    if (!open || !wallet || !selectedMarketId) return;
    setLoadingFills(true);
    setFills([]);
    (async () => {
      try {
        const res = await fetchOnchainFills({ wallet, market_id: selectedMarketId, limit: fillsPageSize, offset: fillsPage * fillsPageSize });
        setFills(res.fills || []);
        setFillsTotal(res.total || 0);
      } finally {
        setLoadingFills(false);
      }
    })();
  }, [open, wallet, selectedMarketId, fillsPage]);

  if (!open) return null;
  const polymarketProfileUrl = `https://polymarket.com/profile/${wallet.trim().toLowerCase()}`;
  return (
    <div className="fixed inset-0 bg-black/60 z-[60010] flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-gray-800 rounded-lg p-3 max-w-6xl w-full mx-4 shadow-xl border border-gray-700" style={{ maxHeight: '88vh' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-bold text-yellow-400">Wallet Info</span>
            <a
              href={polymarketProfileUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-400 font-mono truncate hover:underline"
              title="Open Polymarket profile"
            >
              {wallet}
            </a>
            <button
              type="button"
              className="text-gray-400 hover:text-white"
              title="Copy wallet address"
              aria-label="Copy wallet address"
              onClick={() => {
                void navigator.clipboard.writeText(wallet);
              }}
            >
              <Copy size={13} />
            </button>
            <a href={polymarketProfileUrl} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-white" title="Open Polymarket profile">
              <ExternalLink size={13} />
            </a>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={16} /></button>
        </div>

        <div className="grid grid-cols-2 gap-2 mb-2 text-[10px]">
          <div className="bg-gray-900 rounded p-2">
            <div className="text-gray-500">Net shares (selected market context)</div>
            <div className={`font-bold ${((initialNetShares || 0) > 0.001) ? 'text-green-400' : ((initialNetShares || 0) < -0.001) ? 'text-red-400' : 'text-gray-300'}`}>
              {(initialNetShares || 0) > 0 ? '+' : ''}{(initialNetShares || 0).toFixed(2)}
            </div>
          </div>
          <div className="bg-gray-900 rounded p-2">
            <div className="text-gray-500">Summary</div>
            {summary === undefined && <div className="text-gray-500">Loading...</div>}
            {summary === null && <div className="text-gray-500">No wallet summary</div>}
            {summary && (
              <div className="text-[10px] text-gray-300">
                Trades <span className="text-white">{summary.totalTrades}</span> | Vol In <span className="text-yellow-400">${summary.totalUsdcIn.toFixed(2)}</span> | PnL <span className={summary.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>{summary.pnl >= 0 ? '+' : ''}{summary.pnl.toFixed(2)}</span>
                {(summary.wins > 0 || summary.losses > 0 || summary.flat > 0) && (
                  <>
                    {' '}| Win Rate <span className={summary.winRate >= 0.5 ? 'text-green-400' : 'text-red-400'}>{(summary.winRate * 100).toFixed(0)}%</span>
                    {' '}| W/L/F <span className="text-white">{summary.wins}/{summary.losses}/{summary.flat}</span>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 overflow-hidden" style={{ height: 'calc(88vh - 160px)' }}>
          <div className="bg-gray-900 rounded p-2 overflow-y-auto">
            <div className="text-[10px] text-gray-400 font-bold mb-1">Latest Markets Traded</div>
            {loadingMarkets ? (
              <div className="text-gray-500 text-[10px]">Loading markets...</div>
            ) : markets.length === 0 ? (
              <div className="text-gray-500 text-[10px]">No markets found.</div>
            ) : (
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-1">Date</th>
                    <th className="text-left">Market</th>
                    <th className="text-right">Net Y</th>
                    <th className="text-right">Net N</th>
                    <th className="text-right">Net</th>
                    <th className="text-right" title="price_yes">Px Y</th>
                    <th className="text-right" title="price_no">Px N</th>
                  </tr>
                </thead>
                <tbody>
                  {markets.map((m) => (
                    (() => {
                      const mk = marketById[m.marketId] || marketById[(m.marketId || '').toLowerCase()] || (m.question ? m as any : null);
                      const qFromApi = (m.question || '').trim();
                      const title = qFromApi || mk?.question || mk?.groupItemTitle;
                      const marketName = title
                        ? shortenMarketName(title, undefined, undefined, m.eventSlug || mk?.eventSlug)
                        : `${m.marketAsset || '-'} ${m.marketTimeframe || ''}`;
                      const endRaw = (m.endDate || '').trim() || (mk?.endDate ? String(mk.endDate).trim() : '');
                      const dd = getDateDisplay(endRaw || null);
                      const iy = walletInvY(m);
                      const inn = walletInvN(m);
                      const netLeg = walletNet(m);
                      const fmtInv = (v: number) => `${v > 0.001 ? '+' : ''}${v.toFixed(1)}`;
                      return (
                    <tr
                      key={`${m.marketId}-${m.wallet}`}
                      className={`border-b border-gray-800 cursor-pointer hover:bg-gray-700/30 ${selectedMarketId === m.marketId ? 'bg-gray-700/40' : ''}`}
                      onClick={() => { setSelectedMarketId(m.marketId); setFillsPage(0); }}
                    >
                      <td className={`py-0.5 ${dd.color}`}>{dd.label}</td>
                      <td className="py-0.5 text-gray-200">{marketName}</td>
                      <td className={`text-right tabular-nums ${iy > 0.001 ? 'text-green-400' : iy < -0.001 ? 'text-red-400' : 'text-gray-400'}`}>{fmtInv(iy)}</td>
                      <td className={`text-right tabular-nums ${inn > 0.001 ? 'text-green-400' : inn < -0.001 ? 'text-red-400' : 'text-gray-400'}`}>{fmtInv(inn)}</td>
                      <td className={`text-right tabular-nums ${netLeg > 0.001 ? 'text-green-400' : netLeg < -0.001 ? 'text-red-400' : 'text-gray-400'}`}>{fmtInv(netLeg)}</td>
                      <td className="text-right text-gray-300 tabular-nums">{fmtPriceShare(m.priceYes)}</td>
                      <td className="text-right text-gray-300 tabular-nums">{fmtPriceShare(m.priceNo)}</td>
                    </tr>
                      );
                    })()
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-gray-900 rounded p-2 overflow-y-auto">
            <div className="text-[10px] text-gray-400 font-bold mb-1">
              Trades For Selected Market {selectedMarketId ? <span className="text-gray-500 font-mono">({selectedMarketId})</span> : null}
            </div>
            {loadingFills ? (
              <div className="text-gray-500 text-[10px]">Loading trades...</div>
            ) : fills.length === 0 ? (
              <div className="text-gray-500 text-[10px]">No trades for this wallet/market.</div>
            ) : (
              <table className="w-full text-[10px]">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-700">
                    <th className="text-left py-1">Time</th>
                    <th className="text-left">Action</th>
                    <th className="text-left">Side</th>
                    <th className="text-center w-6 px-0" title="Taker (wallet_fill_ledger.is_taker)">
                      T
                    </th>
                    <th className="text-right">Shares</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">USDC</th>
                    <th className="text-right">Fee</th>
                    <th className="text-right">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {fills.map((f) => {
                    const mid = String(f.marketId || '').trim().toLowerCase();
                    const mk =
                      marketById[selectedMarketId] ||
                      (mid && marketById[mid]) ||
                      {};
                    const bt = Number((f as { blockTime?: number }).blockTime ?? 0);
                    const ts = bt > 0
                      ? (bt > 1e12 ? new Date(bt) : new Date(bt * 1000)).toLocaleString()
                      : '-';
                    if (isLedgerFillRow(f)) {
                      const sz = Number(f.size);
                      const pr = f.price;
                      const priceFinite = pr != null && Number.isFinite(pr);
                      const sizeFinite = Number.isFinite(sz);
                      const priceLabel = priceFinite ? `${(pr * 100).toFixed(1)}¢` : '—';
                      const usdc = priceFinite && sizeFinite ? pr * sz : NaN;
                      const usdcLabel = Number.isFinite(usdc) ? `$${usdc.toFixed(2)}` : '—';
                      const feeN = Number(f.fee);
                      const feeLabel = Number.isFinite(feeN) ? `$${feeN.toFixed(2)}` : '—';
                      const rawSide = String(f.side ?? '').trim();
                      const sideLabel = rawSide || '—';
                      const su = rawSide.toUpperCase();
                      const sideCls =
                        su === 'YES' || su === 'Y' ? 'text-green-400' : su === 'NO' || su === 'N' ? 'text-red-400' : 'text-gray-300';
                      const action = String(f.action ?? '').trim();
                      const actionU = action.toUpperCase();
                      const actionCls =
                        actionU === 'BUY'
                          ? 'text-green-400'
                          : actionU === 'SELL'
                            ? 'text-red-400'
                            : actionU === 'SPLIT' || actionU === 'MERGE'
                              ? 'text-purple-400'
                              : 'text-gray-300';
                      return (
                        <tr key={`${f.txHash}-${f.logIndex}-${String(f.tokenId || '')}`} className="border-b border-gray-800">
                          <td className="py-0.5">{ts}</td>
                          <td className={actionCls}>{action || '—'}</td>
                          <td className={sideCls}>{sideLabel}</td>
                          <td className="text-center text-amber-300 font-bold tabular-nums px-0">
                            {f.isTaker === true ? 'T' : ''}
                          </td>
                          <td className="text-right">{sizeFinite ? sz.toFixed(2) : '—'}</td>
                          <td className="text-right text-gray-300 tabular-nums">{priceLabel}</td>
                          <td className="text-right text-yellow-400">{usdcLabel}</td>
                          <td className="text-right text-yellow-400/80">{feeLabel}</td>
                          <td className="text-right">
                            <a href={`https://polygonscan.com/tx/${f.txHash}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                              {f.txHash.slice(0, 6)}…{f.txHash.slice(-4)}
                            </a>
                          </td>
                        </tr>
                      );
                    }
                    const isSplitMerge = f.orderHash === 'SPLIT' || f.orderHash === 'MERGE';
                    if (isSplitMerge) {
                      const label = String(f.orderHash);
                      const amount = Number(f.makerAmount ?? 0);
                      const feeN = Number(f.fee ?? 0);
                      const feeLabel = Number.isFinite(feeN) ? `$${feeN.toFixed(2)}` : '—';
                      return (
                        <tr key={`${f.txHash}-${f.logIndex}`} className="border-b border-gray-800">
                          <td className="py-0.5">{ts}</td>
                          <td className="text-purple-400" colSpan={2}>{label}</td>
                          <td className="text-center text-amber-300 font-bold px-0">{f.isTaker === true ? 'T' : ''}</td>
                          <td className="text-right">{Number.isFinite(amount) ? amount.toFixed(2) : '—'}</td>
                          <td className="text-right text-gray-500">—</td>
                          <td className="text-right text-gray-500">{Number.isFinite(amount) ? `$${amount.toFixed(2)}` : '—'}</td>
                          <td className="text-right text-yellow-400/80">{feeLabel}</td>
                          <td className="text-right">
                            <a href={`https://polygonscan.com/tx/${f.txHash}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                              {f.txHash.slice(0, 6)}…{f.txHash.slice(-4)}
                            </a>
                          </td>
                        </tr>
                      );
                    }
                    const walletLower = wallet.toLowerCase();
                    const isTaker = (f.taker || '').toLowerCase() === walletLower;
                    const walletPaysUsdc = (isTaker && f.takerAssetId === '0') || (!isTaker && f.makerAssetId === '0');
                    const wa = String(f.walletAccountSide || '').toUpperCase();
                    const action = wa === 'BUY' || wa === 'SELL' ? wa : (walletPaysUsdc ? 'BUY' : 'SELL');
                    const shares = walletPaysUsdc
                      ? (isTaker ? f.makerAmount : f.takerAmount)
                      : (isTaker ? f.takerAmount : f.makerAmount);
                    const usdc = walletPaysUsdc
                      ? (isTaker ? f.takerAmount : f.makerAmount)
                      : (isTaker ? f.makerAmount : f.takerAmount);
                    const nShares = Number(shares);
                    const nUsdc = Number(usdc);
                    const pricePerShare = nShares > 1e-9 && Number.isFinite(nShares) && Number.isFinite(nUsdc) ? nUsdc / nShares : NaN;
                    const priceLabel = Number.isFinite(pricePerShare)
                      ? `${(pricePerShare * 100).toFixed(1)}¢`
                      : '—';
                    const { text: sideText, tone: sideTone } = fillOutcomeDisplay(f, mk);
                    const sideCls = sideTone === 'yes' ? 'text-green-400' : sideTone === 'no' ? 'text-red-400' : 'text-gray-300';
                    const feeN = Number(f.fee ?? 0);
                    const feeLabel = Number.isFinite(feeN) ? `$${feeN.toFixed(2)}` : '—';
                    return (
                      <tr key={`${f.txHash}-${f.logIndex}`} className="border-b border-gray-800">
                        <td className="py-0.5">{ts}</td>
                        <td className={action === 'BUY' ? 'text-green-400' : 'text-red-400'}>{action}</td>
                        <td className={sideCls}>{sideText}</td>
                        <td className="text-center text-amber-300 font-bold tabular-nums px-0">
                          {f.isTaker === true ? 'T' : ''}
                        </td>
                        <td className="text-right">{Number.isFinite(nShares) ? nShares.toFixed(2) : '—'}</td>
                        <td className="text-right text-gray-300 tabular-nums">{priceLabel}</td>
                        <td className="text-right text-yellow-400">{Number.isFinite(nUsdc) ? `$${nUsdc.toFixed(2)}` : '—'}</td>
                        <td className="text-right text-yellow-400/80">{feeLabel}</td>
                        <td className="text-right">
                          <a href={`https://polygonscan.com/tx/${f.txHash}`} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">
                            {f.txHash.slice(0, 6)}…{f.txHash.slice(-4)}
                          </a>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <div className="mt-2 flex items-center justify-between text-[10px] text-gray-400">
              <span>Page {fillsPage + 1} / {Math.max(1, Math.ceil(fillsTotal / fillsPageSize))} ({fillsTotal} trades)</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="px-2 py-0.5 rounded bg-gray-700 disabled:opacity-40"
                  disabled={fillsPage <= 0 || loadingFills}
                  onClick={() => setFillsPage((p) => Math.max(0, p - 1))}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="px-2 py-0.5 rounded bg-gray-700 disabled:opacity-40"
                  disabled={loadingFills || ((fillsPage + 1) * fillsPageSize >= fillsTotal)}
                  onClick={() => setFillsPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ToxicFlowDialog({ open, marketId, marketName, yesTokenId, onClose }: ToxicFlowDialogProps) {
  const marketLookup = useAppStore((s) => s.marketLookup);
  const [data, setData] = useState<ToxicFlowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('topHolders');
  const [walletDialogOpen, setWalletDialogOpen] = useState(false);
  const [selectedWallet, setSelectedWallet] = useState('');
  const [selectedWalletNet, setSelectedWalletNet] = useState<number | undefined>(undefined);

  const load = useCallback(async () => {
    if (!marketId) return;
    setLoading(true);
    setError('');
    try {
      const d = await fetchToxicFlow(marketId);
      setData(d);
    } catch (e: unknown) {
      setError((e as Error).message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    if (open) {
      setTab('topHolders');
      load();
      // Auto-refresh every 5s while open
      const iv = setInterval(async () => {
        try {
          const d = await fetchToxicFlow(marketId);
          setData(d);
        } catch { /* silent refresh failure */ }
      }, 5000);
      return () => clearInterval(iv);
    } else {
      setData(null);
    }
  }, [open, load, marketId]);

  const topYesWallets = useMemo(() => {
    const arr = filterTopYesNoTab(data?.topYes, 'yes');
    return [...arr].sort((a, b) => {
      const d = walletNet(b) - walletNet(a);
      if (d !== 0) return d;
      return (a.wallet || '').localeCompare(b.wallet || '');
    });
  }, [data?.topYes]);
  const topNoWallets = useMemo(() => {
    const arr = filterTopYesNoTab(data?.topNo, 'no');
    return [...arr].sort((a, b) => {
      const d = walletNet(a) - walletNet(b);
      if (d !== 0) return d;
      return (a.wallet || '').localeCompare(b.wallet || '');
    });
  }, [data?.topNo]);

  const topHoldersWallets = useMemo(() => {
    const arr = data?.topHolders ?? [];
    return [...arr].sort((a, b) => {
      const da = Math.abs(walletNet(a));
      const db = Math.abs(walletNet(b));
      if (db !== da) return db - da;
      return (a.wallet || '').localeCompare(b.wallet || '');
    });
  }, [data?.topHolders]);

  if (!open) return null;

  const openWalletDialog = (wallet: string, netShares?: number) => {
    setSelectedWallet(wallet);
    setSelectedWalletNet(netShares);
    setWalletDialogOpen(true);
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'topHolders', label: 'Top Holders', icon: <Crown size={11} /> },
    { key: 'topYes', label: 'Top YES', icon: <TrendingUp size={11} /> },
    { key: 'topNo', label: 'Top NO', icon: <TrendingDown size={11} /> },
    { key: 'topVolume', label: 'Top Volume', icon: <Users size={11} /> },
    { key: 'topTraders', label: 'Top Traders', icon: <AlertTriangle size={11} /> },
  ];

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[49999] flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-gray-800 rounded-lg p-4 max-w-4xl w-full mx-4 shadow-xl border border-gray-700" style={{ maxHeight: '85vh' }}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <UsersRound size={16} className="text-yellow-400" />
            <span className="text-sm font-bold text-yellow-400">Holders</span>
            <span className="text-xs text-gray-400 truncate max-w-[300px]">{marketName}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(85vh - 120px)' }}>
          {loading && <div className="text-gray-500 text-center py-8">Loading on-chain data...</div>}
          {error && <div className="text-red-400 text-center py-8">Error: {error}</div>}

          {!loading && !error && data && (
            <div className="space-y-3">
              {/* Summary Cards */}
              <div className="grid grid-cols-4 gap-2">
                <div className="bg-gray-900 rounded p-2 text-center">
                  <div className="text-[10px] text-gray-500">Wallets</div>
                  <div className="text-sm font-bold text-white">{data.totalWallets}</div>
                </div>
                <div className="bg-gray-900 rounded p-2 text-center">
                  <div className="text-[10px] text-gray-500">On-chain Fills</div>
                  <div className="text-sm font-bold text-white">{data.totalTrades}</div>
                </div>
                <div className="bg-gray-900 rounded p-2 text-center">
                  <div className="text-[10px] text-gray-500">USDC Volume</div>
                  <div className="text-sm font-bold text-yellow-400">${data.totalUsdcIn.toFixed(2)}</div>
                </div>
                <div className="bg-gray-900 rounded p-2 text-center">
                  <div className="text-[10px] text-gray-500">Concentration</div>
                  <div className={`text-sm font-bold ${data.concentration > 0.5 ? 'text-red-400' : data.concentration > 0.3 ? 'text-yellow-400' : 'text-green-400'}`}>
                    {(data.concentration * 100).toFixed(0)}%
                  </div>
                </div>
                <div className="bg-gray-900 rounded p-2 text-center">
                  <div className="text-[10px] text-gray-500">Total Shares</div>
                  <div className="text-sm font-bold text-gray-200">{Math.floor(data.totalShares || 0).toLocaleString()}</div>
                </div>
              </div>

              {/* Informed Trader Bias */}
              <div className="bg-gray-900 rounded p-3">
                <div className="text-[10px] text-gray-500 mb-2 font-bold">Informed Trader Bias</div>
                {(() => {
                  const thb = data.topHoldersBias || 0;
                  const wb = data.whaleBias || 0;
                  const isUpDownMarket = /up\s+or\s+down|updown|up-or-down/i.test(marketName || '');
                  const isUpDown1hOr4h = isUpDownMarket && /\b1[- ]?h\b|updown-4h|\b4[- ]?h\b/i.test(marketName || '');
                  const posLabel = isUpDownMarket ? 'UP' : 'YES';
                  const negLabel = isUpDownMarket ? 'DOWN' : 'NO';
                  const biasLabel = (v: number) => v > 0.01 ? posLabel : v < -0.01 ? negLabel : 'FLAT';
                  const biasColor = (v: number) => v > 0.01 ? 'text-green-400' : v < -0.01 ? 'text-red-400' : 'text-gray-500';
                  const barFor = (v: number) => Math.max(2, Math.min(98, 50 + v * 50));
                  const proven = (data as any).provenSMS || 0;
                  const crowd = (data as any).crowdBias || 0;
                  const provenPct = proven * 100;
                  const crowdPct = crowd * 100;
                  const yesTotal = (data.yesUsdcIn || 0) + (data.noUsdcIn || 0);
                  const yesPct = yesTotal > 0 ? (data.yesUsdcIn / yesTotal) * 100 : 50;
                  return (
                    <div className="space-y-2.5">
                      {/* Proven Smart Money */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-gray-500">Smart Money (proven wallets)</span>
                          <span className={`text-[11px] font-bold ${biasColor(proven)}`}>
                            {biasLabel(proven)} <span className="text-[9px] font-normal">({provenPct > 0 ? '+' : ''}{provenPct.toFixed(1)}%)</span>
                          </span>
                        </div>
                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                          <div className="bg-yellow-400/75 h-full transition-all" style={{ width: `${barFor(proven)}%` }} />
                          <div className="bg-purple-400/75 h-full transition-all flex-1" />
                        </div>
                      </div>

                      {/* Crowd Bias */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-gray-500">Crowd (all wallets)</span>
                          <span className={`text-[11px] font-bold ${biasColor(crowd)}`}>
                            {biasLabel(crowd)} <span className="text-[9px] font-normal">({crowdPct > 0 ? '+' : ''}{crowdPct.toFixed(1)}%)</span>
                          </span>
                        </div>
                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                          <div className="bg-blue-500/70 h-full transition-all" style={{ width: `${barFor(crowd)}%` }} />
                          <div className="bg-orange-500/70 h-full transition-all flex-1" />
                        </div>
                      </div>

                      {/* Top 10 Holders Bias */}
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-gray-500">Top 10 Holders Direction</span>
                        <span className={`text-[11px] font-bold ${biasColor(thb)}`}>
                          {biasLabel(thb)} <span className="text-[9px] font-normal">({thb > 0 ? '+' : ''}{thb.toFixed(1)} shares)</span>
                        </span>
                      </div>

                      {/* Whale Bias */}
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-gray-500">Whale Bias ({data.whaleCount || 0} above-median wallets)</span>
                        <span className={`text-[11px] font-bold ${biasColor(wb)}`}>
                          {biasLabel(wb)} <span className="text-[9px] font-normal">({wb > 0 ? '+' : ''}{wb.toFixed(1)} shares)</span>
                        </span>
                      </div>

                      {/* Winner Bias (USDC & Shares) — from backend via WS, same source as sidebar */}
                      {(() => {
                        const live = yesTokenId ? marketLookup[yesTokenId] : undefined;
                        const wbUsdc = typeof live?.winnerBias === 'number' && Number.isFinite(live.winnerBias) ? live.winnerBias : null;
                        const yesWR = typeof live?.winnerBiasYesWR === 'number' ? live.winnerBiasYesWR : null;
                        const noWR = typeof live?.winnerBiasNoWR === 'number' ? live.winnerBiasNoWR : null;
                        const wbShares = typeof live?.winBiasShares === 'number' && Number.isFinite(live.winBiasShares) ? live.winBiasShares : null;
                        const yesWRs = typeof live?.winBiasSharesYes === 'number' ? live.winBiasSharesYes : null;
                        const noWRs = typeof live?.winBiasSharesNo === 'number' ? live.winBiasSharesNo : null;
                        const wbCvUsdc = typeof live?.winnerBiasConviction === 'number' && Number.isFinite(live.winnerBiasConviction) ? live.winnerBiasConviction : null;
                        const yesWRcv = typeof live?.winnerBiasConvictionYesWR === 'number' ? live.winnerBiasConvictionYesWR : null;
                        const noWRcv = typeof live?.winnerBiasConvictionNoWR === 'number' ? live.winnerBiasConvictionNoWR : null;
                        const wbCvSh = typeof live?.winBiasConvictionShares === 'number' && Number.isFinite(live.winBiasConvictionShares) ? live.winBiasConvictionShares : null;
                        const yesWRcvs = typeof live?.winBiasConvictionSharesYes === 'number' ? live.winBiasConvictionSharesYes : null;
                        const noWRcvs = typeof live?.winBiasConvictionSharesNo === 'number' ? live.winBiasConvictionSharesNo : null;

                        const renderBar = (label: string, bias: number | null, yesWr: number | null, noWr: number | null) => {
                          if (bias == null) return null;
                          const barPct = Math.max(2, Math.min(98, 50 + bias * 50));
                          const side = bias > 0.01 ? posLabel : bias < -0.01 ? negLabel : 'EVEN';
                          const color = bias > 0.01 ? 'text-cyan-300' : bias < -0.01 ? 'text-pink-300' : 'text-gray-500';
                          return (
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[9px] text-gray-500">{label}</span>
                                <span className={`text-[11px] font-bold ${color}`}>{side}</span>
                              </div>
                              <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                                <div className="bg-cyan-400/75 h-full transition-all" style={{ width: `${barPct}%` }} />
                                <div className="bg-pink-400/75 h-full transition-all flex-1" />
                              </div>
                              <div className="flex justify-between mt-0.5 text-[9px] text-gray-500">
                                {yesWr != null && <span>{posLabel} WR: <span className={yesWr >= 0.5 ? 'text-cyan-300' : 'text-pink-300'}>{(yesWr * 100).toFixed(0)}%</span></span>}
                                {noWr != null && <span>{negLabel} WR: <span className={noWr >= 0.5 ? 'text-cyan-300' : 'text-pink-300'}>{(noWr * 100).toFixed(0)}%</span></span>}
                              </div>
                            </div>
                          );
                        };

                        return (
                          <div>
                            <p className="text-[8px] text-gray-500 leading-snug mb-1.5">
                              Compares <span className="text-gray-400">historical win rate</span> (top 30% of USDC or shares on each side).
                              Table <span className="text-gray-400">Cash Flow / rPnL</span> is this market only — they often diverge.
                            </p>
                            {renderBar('Winner Bias (top 30% USDC)', wbUsdc, yesWR, noWR)}
                            {renderBar('Winner Bias (top 30% Shares)', wbShares, yesWRs, noWRs)}
                            {renderBar('Winner Bias Conviction (USDC)', wbCvUsdc, yesWRcv, noWRcv)}
                            {renderBar('Winner Bias Conviction (Shares)', wbCvSh, yesWRcvs, noWRcvs)}
                          </div>
                        );
                      })()}

                      {/* YES vs NO wallet breakdown */}
                      <div className="border-t border-gray-700/70 pt-2">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-gray-500">Wallet Split</span>
                          <span className="text-[9px] text-gray-400">
                            <span className="text-green-400 font-bold">{data.yesWallets || 0}</span> YES
                            {' / '}
                            <span className="text-red-400 font-bold">{data.noWallets || 0}</span> NO
                  </span>
                </div>
                        <div className="h-2.5 bg-gray-700 rounded-full overflow-hidden flex">
                          <div className="bg-green-500/60 h-full transition-all" style={{ width: `${yesPct}%` }} />
                          <div className="bg-red-500/60 h-full transition-all flex-1" />
                        </div>
                        <div className="flex justify-between mt-0.5 text-[9px] text-gray-500">
                          <span>YES ${(data.yesUsdcIn || 0).toFixed(2)}</span>
                          <span>NO ${(data.noUsdcIn || 0).toFixed(2)}</span>
                        </div>
                      </div>

                      {/* YES/NO token volume */}
                      <div className="border-t border-gray-700/70 pt-2">
                        <div className="h-2.5 bg-gray-700 rounded-full overflow-hidden flex">
                  {(() => {
                    const total = data.totalYesVol + data.totalNoVol;
                            const yp = total > 0 ? (data.totalYesVol / total) * 100 : 50;
                    return (
                      <>
                                <div className="bg-green-500/60 h-full transition-all" style={{ width: `${yp}%` }} />
                                <div className="bg-red-500/60 h-full transition-all flex-1" />
                      </>
                    );
                  })()}
                </div>
                        <div className="flex justify-between mt-0.5 text-[9px] text-gray-500">
                  <span>YES vol: {data.totalYesVol.toFixed(1)}</span>
                  <span>NO vol: {data.totalNoVol.toFixed(1)}</span>
                </div>
              </div>
                    </div>
                  );
                })()}
              </div>

              {/* Manipulation Red Flags */}
              {(() => {
                const rf = data.redFlags ?? [];
                const highFlags = rf.filter(f => f.level === 'high');
                const medFlags = rf.filter(f => f.level === 'medium');
                const netByWallet: Record<string, number> = {};
                const winStatsByWallet: Record<string, { winRate: number; winLossTotal: number }> = {};
                const smartSet = new Set<string>();
                const addWallets = (arr?: WalletPosition[] | null) => {
                  for (const w of arr || []) {
                    if (!w?.wallet) continue;
                    const k = w.wallet.toLowerCase();
                    netByWallet[k] = w.net || 0;
                    if (isSmartGold(w)) smartSet.add(k);
                    const wl = w.winLossTotal;
                    const wr = w.winRate;
                    if (typeof wl === 'number' && wl > 0 && typeof wr === 'number' && Number.isFinite(wr)) {
                      winStatsByWallet[k] = { winRate: wr, winLossTotal: wl };
                    }
                  }
                };
                addWallets(topHoldersWallets);
                addWallets(topYesWallets);
                addWallets(topNoWallets);
                addWallets(data.topVolume);
                addWallets(data.topTraders);
                const hasConcentration = data.concentration > 0.5;
                const hasTopHolderBias = Math.abs(data.topHoldersBias || 0) > 50;
                const totalFlags = highFlags.length + medFlags.length + (hasConcentration ? 1 : 0) + (hasTopHolderBias ? 1 : 0);

                return (
                  <div className={`rounded p-3 ${highFlags.length > 0 ? 'bg-red-950/40 border border-red-800/40' : 'bg-gray-900'}`}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <ShieldAlert size={12} className={highFlags.length > 0 ? 'text-red-400' : 'text-gray-500'} />
                      <span className={`text-[10px] font-bold ${highFlags.length > 0 ? 'text-red-400' : 'text-gray-500'}`}>
                        Manipulation Signals
                        {totalFlags > 0 && <span className="ml-1 text-[9px] rounded bg-red-500/30 px-1 py-0.5">{totalFlags} active</span>}
                      </span>
                    </div>
                    <div className="space-y-1.5">
                      {highFlags.map((f, i) => {
                        const st = f.wallet ? winStatsByWallet[f.wallet.toLowerCase()] : undefined;
                        const showWinBar = !!(st && st.winLossTotal > 0 && Number.isFinite(st.winRate));
                        return (
                          <div key={`h${i}`} className="flex items-start gap-1.5 text-[10px]">
                            <AlertTriangle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                            <span className="text-gray-200">
                              {f.wallet ? (
                                <>
                                  {showWinBar ? (
                                    <span className="inline-flex flex-col gap-0.5 align-baseline mr-0.5">
                                      <WalletLink
                                        wallet={f.wallet}
                                        netShares={netByWallet[f.wallet.toLowerCase()]}
                                        onOpenWallet={openWalletDialog}
                                        isSmart={smartSet.has(f.wallet.toLowerCase())}
                                      />
                                      <WinRateBottomBar winRate={st!.winRate} />
                                    </span>
                                  ) : (
                                    <WalletLink
                                      wallet={f.wallet}
                                      netShares={netByWallet[f.wallet.toLowerCase()]}
                                      onOpenWallet={openWalletDialog}
                                      isSmart={smartSet.has(f.wallet.toLowerCase())}
                                    />
                                  )}{' '}
                                  {f.detail.replace(/^0x[a-fA-F0-9]{4}\u2026[a-fA-F0-9]{4}\s*/, '')}
                                </>
                              ) : (
                                f.detail
                              )}
                            </span>
                          </div>
                        );
                      })}
                      {medFlags.map((f, i) => {
                        const st = f.wallet ? winStatsByWallet[f.wallet.toLowerCase()] : undefined;
                        const showWinBar = !!(st && st.winLossTotal > 0 && Number.isFinite(st.winRate));
                        return (
                          <div key={`m${i}`} className="flex items-start gap-1.5 text-[10px]">
                            <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                            <span className="text-gray-300">
                              {f.wallet ? (
                                <>
                                  {showWinBar ? (
                                    <span className="inline-flex flex-col gap-0.5 align-baseline mr-0.5">
                                      <WalletLink
                                        wallet={f.wallet}
                                        netShares={netByWallet[f.wallet.toLowerCase()]}
                                        onOpenWallet={openWalletDialog}
                                        isSmart={smartSet.has(f.wallet.toLowerCase())}
                                      />
                                      <WinRateBottomBar winRate={st!.winRate} />
                                    </span>
                                  ) : (
                                    <WalletLink
                                      wallet={f.wallet}
                                      netShares={netByWallet[f.wallet.toLowerCase()]}
                                      onOpenWallet={openWalletDialog}
                                      isSmart={smartSet.has(f.wallet.toLowerCase())}
                                    />
                                  )}{' '}
                                  {f.detail.replace(/^0x[a-fA-F0-9]{4}\u2026[a-fA-F0-9]{4}\s*/, '')}
                                </>
                              ) : (
                                f.detail
                              )}
                            </span>
                          </div>
                        );
                      })}
                      {hasConcentration && (
                        <div className="flex items-start gap-1.5 text-[10px]">
                          <AlertTriangle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                          <span className="text-gray-200">Top 5 wallets control {(data.concentration * 100).toFixed(0)}% of volume — potential whale manipulation</span>
                    </div>
                  )}
                      {hasTopHolderBias && (
                        <div className="flex items-start gap-1.5 text-[10px]">
                          <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                          <span className="text-gray-300">Top 10 holders have {Math.abs(data.topHoldersBias).toFixed(0)} net {data.topHoldersBias > 0 ? 'YES' : 'NO'} shares — informed players positioned {data.topHoldersBias > 0 ? 'YES' : 'NO'}</span>
                    </div>
                  )}
                  {data.totalWallets === 0 && (
                        <div className="space-y-1.5 text-[10px] text-gray-500">
                          {data.polygonWssConfigured === false && (
                            <p className="text-amber-400/95">
                              On-chain collection is off: polycandles needs <span className="font-mono">POLYGON_WSS_URL</span> (Polygon JSON-RPC WebSocket). Check server logs and{' '}
                              <span className="font-mono">/api/onchain-status</span>.
                            </p>
                          )}
                          {data.polygonWssConfigured === true && (data.orderFilledEventsProcessed ?? 0) === 0 && (
                            <p>
                              Polygon WSS is configured but no <span className="font-mono">OrderFilled</span> events have been processed yet — verify the endpoint, subscription, and that trading is happening on tracked contracts.
                            </p>
                          )}
                          {data.polygonWssConfigured === true &&
                            (data.orderFilledEventsProcessed ?? 0) > 0 &&
                            (data.onchainFillsForMarket ?? 0) === 0 && (
                            <p>
                              Events are ingesting globally, but no fills are linked to this market in <span className="font-mono">onchain_fills</span> yet. Wait for the next Gamma sync (token map refreshes after each refresh), or confirm this market&apos;s CLOB token IDs are in the DB.
                            </p>
                          )}
                          {(data.onchainFillsForMarket ?? 0) > 0 && (
                            <p className="text-gray-400">
                              {data.onchainFillsForMarket} raw fill(s) for this market in DB; wallet rollups only appear after fills are matched to token IDs. If tables stay empty, check <span className="font-mono">wallet_market_positions</span> and server logs.
                            </p>
                          )}
                          <p>
                            Holders aggregates <span className="font-mono">wallet_market_positions</span> (ledger) for this market (not the CLOB orderbook). Data persists across restarts and backfills missed blocks automatically.
                          </p>
                    </div>
                  )}
                      {data.totalWallets > 0 && totalFlags === 0 && (
                    <div className="flex items-center gap-1.5 text-[10px]">
                          <span className="text-green-400">No manipulation signals detected.</span>
                    </div>
                  )}
                </div>
              </div>
                );
              })()}

              {/* Tabs + bottom table (switch only this section) */}
              <div className="bg-gray-900/60 rounded p-2">
                <div className="flex gap-1 mb-2 border-b border-gray-700 pb-2">
                  {tabs.map((t) => (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold transition-colors ${
                        tab === t.key
                          ? 'bg-yellow-400/20 text-yellow-400'
                          : 'text-gray-400 hover:text-white hover:bg-gray-700'
                      }`}
                    >
                      {t.icon} {t.label}
                    </button>
                  ))}
                </div>

                {tab === 'topHolders' && (
                  <WalletTable wallets={topHoldersWallets} label="holders" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                )}
                {tab === 'topYes' && (
                  <WalletTable wallets={topYesWallets} label="YES holders" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                )}
                {tab === 'topNo' && (
                  <WalletTable wallets={topNoWallets} label="NO holders" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                )}
                {tab === 'topVolume' && (
                  <WalletTable wallets={data.topVolume} label="volume" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                )}
                {tab === 'topTraders' && (
                  <WalletTable wallets={data.topTraders} label="traders" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                )}
              </div>
            </div>
          )}
        </div>
        <WalletInfoDialog
          open={walletDialogOpen}
          wallet={selectedWallet}
          initialNetShares={selectedWalletNet}
          initialMarketId={marketId}
          onClose={() => setWalletDialogOpen(false)}
        />
      </div>
    </div>
  );
}
