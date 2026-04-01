import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { X, TrendingUp, TrendingDown, Users, BarChart3, AlertTriangle, Crown, ShieldAlert, UsersRound, ExternalLink } from 'lucide-react';
import { fetchToxicFlow, fetchWalletSummary, fetchWalletPositions, fetchOnchainFills } from '../api';
import type { ToxicFlowData, WalletPosition, WalletSummary, OnchainFillRow } from '../api';
import { shortenMarketName } from '../utils/format';
import { useAppStore } from '../stores/appStore';

interface ToxicFlowDialogProps {
  open: boolean;
  marketId: string;
  marketName: string;
  onClose: () => void;
}

type Tab = 'topHolders' | 'topYes' | 'topNo' | 'topVolume' | 'topTraders';

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
  // Prefer backend truth from market_results join on wallet_positions.
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

// Wallet hover tooltip — fetches summary on hover, caches results
const summaryCache: Record<string, WalletSummary | null> = {};

function WalletLink({
  wallet,
  netShares,
  winRate,
  winLossTotal,
  onOpenWallet,
}: {
  wallet: string;
  netShares?: number;
  /** 0–1; shown only when winLossTotal > 0 */
  winRate?: number;
  winLossTotal?: number;
  onOpenWallet?: (wallet: string, netShares?: number) => void;
}) {
  const [summary, setSummary] = useState<WalletSummary | null | undefined>(undefined);
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const polygonUrl = `https://polygonscan.com/address/${wallet}`;

  const onEnter = () => {
    timerRef.current = setTimeout(async () => {
      setShow(true);
      if (wallet in summaryCache) {
        setSummary(summaryCache[wallet]);
      } else {
        const s = await fetchWalletSummary(wallet);
        summaryCache[wallet] = s;
        setSummary(s);
      }
    }, 300);
  };
  const onLeave = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setShow(false);
    setSummary(undefined);
  };

  return (
    <span className="relative" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenWallet?.(wallet, netShares);
        }}
        className="text-blue-400 hover:underline font-mono inline-flex items-baseline flex-wrap gap-x-0"
      >
        <span>{shortenWallet(wallet)}</span>
        {typeof winLossTotal === 'number' && winLossTotal > 0 && typeof winRate === 'number' && Number.isFinite(winRate) && (
          <span className={`ml-0.5 font-sans font-bold ${winRate >= 0.5 ? 'text-green-400' : 'text-red-400'}`}>
            ({(winRate * 100).toFixed(0)}%)
          </span>
        )}
      </button>
      {show && (
        <div className="absolute z-[60000] left-0 top-full mt-1 bg-gray-900 border border-gray-600 rounded shadow-xl p-2 min-w-[190px] text-[9px]"
          onMouseEnter={() => setShow(true)} onMouseLeave={onLeave}>
          <div className="font-mono text-blue-400 mb-1 text-[8px]">{wallet.slice(0, 10)}...{wallet.slice(-6)}</div>
          {summary === undefined && <div className="text-gray-500">Loading...</div>}
          {summary === null && <div className="text-gray-500">No data yet</div>}
          {summary && (
            <div className="space-y-0.5">
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
              <div className="flex justify-between gap-3"><span className="text-gray-500">Markets</span><span className="text-white font-bold">{summary.totalMarkets}{summary.resolvedMarkets > 0 ? <span className="text-gray-500 font-normal"> ({summary.resolvedMarkets} resolved)</span> : ''}</span></div>
              <div className="flex justify-between gap-3"><span className="text-gray-500">Trades</span><span className="text-white">{summary.totalTrades}</span></div>
              <div className="flex justify-between gap-3"><span className="text-gray-500">Vol In</span><span className="text-yellow-400">${summary.totalUsdcIn.toFixed(2)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-gray-500">Vol Out</span><span className="text-yellow-400">${summary.totalUsdcOut.toFixed(2)}</span></div>
              <div className="border-t border-gray-700 my-0.5" />
              <div className="flex justify-between gap-3"><span className="text-gray-500">Trading PnL</span><span className={`${summary.tradingPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{summary.tradingPnl >= 0 ? '+' : ''}{summary.tradingPnl.toFixed(2)}</span></div>
              {summary.resolvedMarkets > 0 && (
                <div className="flex justify-between gap-3"><span className="text-gray-500">Resolution</span><span className={`${summary.resolutionValue >= 0 ? 'text-green-400' : 'text-red-400'}`}>{summary.resolutionValue >= 0 ? '+' : ''}{summary.resolutionValue.toFixed(2)}</span></div>
              )}
              <div className="flex justify-between gap-3"><span className="text-gray-500">Total PnL</span><span className={`font-bold ${summary.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{summary.pnl >= 0 ? '+' : ''}{summary.pnl.toFixed(2)}</span></div>
              {(summary.wins > 0 || summary.losses > 0) && (
                <>
                  <div className="border-t border-gray-700 my-0.5" />
                  <div className="flex justify-between gap-3"><span className="text-gray-500">Win Rate</span><span className={`font-bold ${summary.winRate >= 0.5 ? 'text-green-400' : 'text-red-400'}`}>{(summary.winRate * 100).toFixed(0)}%</span></div>
                  <div className="flex justify-between gap-3"><span className="text-gray-500">W / L / F</span><span className="text-white">{summary.wins}/{summary.losses}/{summary.flat}</span></div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

function WalletTable({ wallets, label, totalShares, onOpenWallet }: { wallets: WalletPosition[] | null; label: string; totalShares?: number; onOpenWallet?: (wallet: string, netShares?: number) => void }) {
  if (!wallets || wallets.length === 0) {
    return <div className="text-gray-500 text-center py-3 text-[10px]">No {label} data yet</div>;
  }
  const fmtInt = (v: number) => Math.round(v).toLocaleString();
  const fmtSignedInt = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v).toLocaleString()}`;

  return (
    <div className="overflow-x-auto">
      <table className="w-full whitespace-nowrap text-[10px]">
        <thead>
          <tr className="text-gray-500 border-b border-gray-700">
            <th className="text-left py-1 px-1">#</th>
            <th className="text-left px-1">Wallet</th>
            <th className="text-right px-1 bg-green-900/15">B.Yes</th>
            <th className="text-right px-1 bg-green-900/15">S.Yes</th>
            <th className="text-right px-1 bg-green-900/15">Net Y</th>
            <th className="text-right px-1 bg-red-900/15">B.No</th>
            <th className="text-right px-1 bg-red-900/15">S.No</th>
            <th className="text-right px-1 bg-red-900/15">Net N</th>
            <th className="text-right px-1">USDC In</th>
            <th className="text-right px-1">% Shares</th>
            <th className="text-right px-1">PnL</th>
            <th className="text-right px-1">Trades</th>
            <th className="text-right px-1">Net</th>
            <th className="text-right px-1">Bias</th>
          </tr>
        </thead>
        <tbody>
          {wallets.map((w, i) => {
            const totalVol = (w.boughtYes || 0) + (w.soldYes || 0) + (w.boughtNo || 0) + (w.soldNo || 0);
            const bias = totalVol > 0 ? Math.abs(w.net || 0) / totalVol : 0;
            const biasColor = bias > 0.5 ? 'text-yellow-400' : bias > 0.3 ? 'text-orange-400' : 'text-gray-400';
            const nY = w.netYes ?? ((w.boughtYes || 0) - (w.soldYes || 0));
            const nN = w.netNo ?? ((w.boughtNo || 0) - (w.soldNo || 0));
            const sharesPct = totalShares && totalShares > 0 ? (Math.abs(w.net || 0) / totalShares) * 100 : 0;
            const nYColor = nY > 0.001 ? 'text-green-400' : nY < -0.001 ? 'text-red-400' : 'text-gray-500';
            const nNColor = nN > 0.001 ? 'text-green-400' : nN < -0.001 ? 'text-red-400' : 'text-gray-500';
            return (
              <tr key={w.wallet} className="border-b border-gray-800 hover:bg-gray-700/30">
                <td className="py-0.5 px-1 text-gray-600">{i + 1}</td>
                <td className="px-1">
                  <WalletLink
                    wallet={w.wallet}
                    netShares={w.net}
                    winRate={w.winRate}
                    winLossTotal={w.winLossTotal}
                    onOpenWallet={onOpenWallet}
                  />
                </td>
                <td className="text-right px-1 text-green-400 bg-green-900/10">{w.boughtYes > 0 ? fmtInt(w.boughtYes) : '-'}</td>
                <td className="text-right px-1 text-red-400 bg-green-900/10">{w.soldYes > 0 ? fmtInt(w.soldYes) : '-'}</td>
                <td className={`text-right px-1 font-bold ${nYColor} bg-green-900/10`}>{fmtSignedInt(nY)}</td>
                <td className="text-right px-1 text-green-400 bg-red-900/10">{w.boughtNo > 0 ? fmtInt(w.boughtNo) : '-'}</td>
                <td className="text-right px-1 text-red-300/60 bg-red-900/10">{w.soldNo > 0 ? fmtInt(w.soldNo) : '-'}</td>
                <td className={`text-right px-1 font-bold ${nNColor} bg-red-900/10`}>{fmtSignedInt(nN)}</td>
                <td className="text-right px-1 text-yellow-400">${fmtInt(w.usdcIn)}</td>
                <td className="text-right px-1 text-cyan-300">{sharesPct > 0 ? `${sharesPct.toFixed(1)}%` : '-'}</td>
                <td className={`text-right px-1 font-bold ${(w.pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtSignedInt(w.pnl || 0)}</td>
                <td className="text-right px-1 text-gray-400">{w.tradeCount}</td>
                <td className={`text-right px-1 font-bold ${(w.net || 0) > 0.001 ? 'text-green-400' : (w.net || 0) < -0.001 ? 'text-red-400' : 'text-gray-500'}`}>{fmtSignedInt(w.net || 0)}</td>
                <td className={`text-right px-1 ${biasColor}`}>{(bias * 100).toFixed(0)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function WalletInfoDialog({ open, wallet, initialNetShares, onClose }: { open: boolean; wallet: string; initialNetShares?: number; onClose: () => void }) {
  const marketLookup = useAppStore((s) => s.marketLookup);
  const [summary, setSummary] = useState<WalletSummary | null | undefined>(undefined);
  const [markets, setMarkets] = useState<WalletPosition[]>([]);
  const [selectedMarketId, setSelectedMarketId] = useState('');
  const [fills, setFills] = useState<OnchainFillRow[]>([]);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [loadingFills, setLoadingFills] = useState(false);
  const [fillsTotal, setFillsTotal] = useState(0);
  const [fillsPage, setFillsPage] = useState(0);
  const fillsPageSize = 50;
  const marketById = useMemo(() => {
    const m: Record<string, any> = {};
    for (const mk of Object.values(marketLookup || {})) {
      if (mk?.id && !m[mk.id]) m[mk.id] = mk;
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
    (async () => {
      try {
        const [s, p] = await Promise.all([
          fetchWalletSummary(wallet),
          fetchWalletPositions({ wallet, sort_by: 'last_trade_time', limit: 100 }),
        ]);
        setSummary(s);
        const sorted = [...(p.positions || [])].sort((a, b) => (b.lastTradeTime || 0) - (a.lastTradeTime || 0));
        setMarkets(sorted);
        if (sorted.length > 0) {
          setSelectedMarketId(sorted[0].marketId);
          setFillsPage(0);
        }
      } finally {
        setLoadingMarkets(false);
      }
    })();
  }, [open, wallet]);

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
  const polygonUrl = `https://polygonscan.com/address/${wallet}`;
  return (
    <div className="fixed inset-0 bg-black/60 z-[60010] flex items-center justify-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-gray-800 rounded-lg p-3 max-w-6xl w-full mx-4 shadow-xl border border-gray-700" style={{ maxHeight: '88vh' }}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-bold text-yellow-400">Wallet Info</span>
            <span className="text-xs text-blue-400 font-mono truncate">{wallet}</span>
            <a href={polygonUrl} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-white" title="Open in Polygonscan">
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
                    <th className="text-left">Resolved</th>
                    <th className="text-center">W/L</th>
                    <th className="text-right">Net</th>
                    <th className="text-right">USDC In</th>
                  </tr>
                </thead>
                <tbody>
                  {markets.map((m) => (
                    (() => {
                      const mk = marketById[m.marketId];
                      const marketName = mk
                        ? shortenMarketName(mk.question || mk.groupItemTitle, undefined, undefined, mk.eventSlug)
                        : `${m.marketAsset || '-'} ${m.marketTimeframe || ''} #${m.marketId}`;
                      const dd = getDateDisplay(mk?.endDate || null);
                      const rd = getResolvedDisplay(mk, m);
                      const net = m.net || 0;
                      const resolvedYes = typeof m.resultYes === 'number' ? m.resultYes : -1;
                      const wl = resolvedYes >= 0
                        ? (net > 0.001
                            ? (resolvedYes === 1 ? 'W' : 'L')
                            : (net < -0.001 ? (resolvedYes === 0 ? 'W' : 'L') : '-'))
                        : '-';
                      const wlColor = wl === 'W' ? 'text-green-400' : wl === 'L' ? 'text-red-400' : 'text-gray-500';
                      return (
                    <tr
                      key={`${m.marketId}-${m.wallet}`}
                      className={`border-b border-gray-800 cursor-pointer hover:bg-gray-700/30 ${selectedMarketId === m.marketId ? 'bg-gray-700/40' : ''}`}
                      onClick={() => { setSelectedMarketId(m.marketId); setFillsPage(0); }}
                    >
                      <td className={`py-0.5 ${dd.color}`}>{dd.label}</td>
                      <td className="py-0.5 text-gray-200">{marketName}</td>
                      <td className={`py-0.5 ${rd.color}`}>{rd.label}</td>
                      <td className={`text-center font-bold ${wlColor}`}>{wl}</td>
                      <td className={`text-right ${net > 0.001 ? 'text-green-400' : net < -0.001 ? 'text-red-400' : 'text-gray-400'}`}>{net > 0 ? '+' : ''}{net.toFixed(1)}</td>
                      <td className="text-right text-yellow-400">${(m.usdcIn || 0).toFixed(2)}</td>
                    </tr>
                      );
                    })()
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-gray-900 rounded p-2 overflow-y-auto">
            <div className="text-[10px] text-gray-400 font-bold mb-1">Trades For Selected Market</div>
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
                    <th className="text-right">Shares</th>
                    <th className="text-right">Price</th>
                    <th className="text-right">USDC</th>
                    <th className="text-right">Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {fills.map((f) => {
                    const walletLower = wallet.toLowerCase();
                    const isTaker = (f.taker || '').toLowerCase() === walletLower;
                    const walletPaysUsdc = (isTaker && f.takerAssetId === '0') || (!isTaker && f.makerAssetId === '0');
                    const action = walletPaysUsdc ? 'BUY' : 'SELL';
                    const shares = walletPaysUsdc
                      ? (isTaker ? f.makerAmount : f.takerAmount)
                      : (isTaker ? f.takerAmount : f.makerAmount);
                    const usdc = walletPaysUsdc
                      ? (isTaker ? f.takerAmount : f.makerAmount)
                      : (isTaker ? f.makerAmount : f.takerAmount);
                    const pricePerShare = shares > 1e-9 ? usdc / shares : NaN;
                    const priceLabel = Number.isFinite(pricePerShare)
                      ? `${(pricePerShare * 100).toFixed(1)}¢`
                      : '—';
                    const bt = Number((f as any).blockTime ?? 0);
                    const ts = bt > 0
                      ? (bt > 1e12 ? new Date(bt) : new Date(bt * 1000)).toLocaleString()
                      : '-';
                    return (
                      <tr key={`${f.txHash}-${f.logIndex}`} className="border-b border-gray-800">
                        <td className="py-0.5">{ts}</td>
                        <td className={action === 'BUY' ? 'text-green-400' : 'text-red-400'}>{action}</td>
                        <td className={f.side === 'YES' ? 'text-green-400' : 'text-red-400'}>{f.side}</td>
                        <td className="text-right">{shares.toFixed(2)}</td>
                        <td className="text-right text-gray-300 tabular-nums">{priceLabel}</td>
                        <td className="text-right text-yellow-400">${usdc.toFixed(2)}</td>
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

export function ToxicFlowDialog({ open, marketId, marketName, onClose }: ToxicFlowDialogProps) {
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
                  const live = (data as any).liveBias || 0;
                  const liveWin = isUpDown1hOr4h ? 5 : ((data as any).liveBiasWindowMin || 30);
                  const proven = (data as any).provenSMS || 0;
                  const crowd = (data as any).crowdBias || 0;
                  const livePct = live * 100;
                  const provenPct = proven * 100;
                  const crowdPct = crowd * 100;
                  const yesTotal = (data.yesUsdcIn || 0) + (data.noUsdcIn || 0);
                  const yesPct = yesTotal > 0 ? (data.yesUsdcIn / yesTotal) * 100 : 50;
                  return (
                    <div className="space-y-2.5">
                      {/* Live Taker Flow Bias */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-gray-500">Live Flow ({liveWin}m taker bias)</span>
                          <span className={`text-[11px] font-bold ${biasColor(live)}`}>
                            {biasLabel(live)} <span className="text-[9px] font-normal">({livePct > 0 ? '+' : ''}{livePct.toFixed(1)}%)</span>
                          </span>
                        </div>
                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                          <div className="bg-cyan-500/70 h-full transition-all" style={{ width: `${barFor(live)}%` }} />
                          <div className="bg-pink-500/70 h-full transition-all flex-1" />
                        </div>
                      </div>

                      {/* Proven Smart Money */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-gray-500">Smart Money (proven wallets)</span>
                          <span className={`text-[11px] font-bold ${biasColor(proven)}`}>
                            {biasLabel(proven)} <span className="text-[9px] font-normal">({provenPct > 0 ? '+' : ''}{provenPct.toFixed(1)}%)</span>
                          </span>
                        </div>
                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                          <div className="bg-green-500/70 h-full transition-all" style={{ width: `${barFor(proven)}%` }} />
                          <div className="bg-red-500/70 h-full transition-all flex-1" />
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
                const addWallets = (arr?: WalletPosition[] | null) => {
                  for (const w of arr || []) {
                    if (!w?.wallet) continue;
                    const k = w.wallet.toLowerCase();
                    netByWallet[k] = w.net || 0;
                    const wl = w.winLossTotal;
                    const wr = w.winRate;
                    if (typeof wl === 'number' && wl > 0 && typeof wr === 'number' && Number.isFinite(wr)) {
                      winStatsByWallet[k] = { winRate: wr, winLossTotal: wl };
                    }
                  }
                };
                addWallets(data.topHolders);
                addWallets(data.topYes);
                addWallets(data.topNo);
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
                      {highFlags.map((f, i) => (
                        <div key={`h${i}`} className="flex items-start gap-1.5 text-[10px]">
                          <AlertTriangle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                          <span className="text-gray-200">
                            {f.wallet ? (
                              <>
                                <WalletLink
                                  wallet={f.wallet}
                                  netShares={netByWallet[f.wallet.toLowerCase()]}
                                  winRate={winStatsByWallet[f.wallet.toLowerCase()]?.winRate}
                                  winLossTotal={winStatsByWallet[f.wallet.toLowerCase()]?.winLossTotal}
                                  onOpenWallet={openWalletDialog}
                                />{' '}
                                {f.detail.replace(/^0x[a-fA-F0-9]{4}\u2026[a-fA-F0-9]{4}\s*/, '')}
                              </>
                            ) : f.detail}
                          </span>
                        </div>
                      ))}
                      {medFlags.map((f, i) => (
                        <div key={`m${i}`} className="flex items-start gap-1.5 text-[10px]">
                          <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                          <span className="text-gray-300">
                            {f.wallet ? (
                              <>
                                <WalletLink
                                  wallet={f.wallet}
                                  netShares={netByWallet[f.wallet.toLowerCase()]}
                                  winRate={winStatsByWallet[f.wallet.toLowerCase()]?.winRate}
                                  winLossTotal={winStatsByWallet[f.wallet.toLowerCase()]?.winLossTotal}
                                  onOpenWallet={openWalletDialog}
                                />{' '}
                                {f.detail.replace(/^0x[a-fA-F0-9]{4}\u2026[a-fA-F0-9]{4}\s*/, '')}
                              </>
                            ) : f.detail}
                          </span>
                        </div>
                      ))}
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
                              {data.onchainFillsForMarket} raw fill(s) for this market in DB; wallet rollups only appear after fills are matched to token IDs. If tables stay empty, check <span className="font-mono">wallet_positions</span> and server logs.
                            </p>
                          )}
                          <p>
                            Holders aggregates <span className="font-mono">wallet_positions</span> for this market (not the CLOB orderbook). Data persists across restarts and backfills missed blocks automatically.
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
                  <WalletTable wallets={data.topHolders} label="holders" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                )}
                {tab === 'topYes' && (
                  <WalletTable wallets={data.topYes} label="YES holders" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
                )}
                {tab === 'topNo' && (
                  <WalletTable wallets={data.topNo} label="NO holders" totalShares={data.totalShares} onOpenWallet={openWalletDialog} />
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
          onClose={() => setWalletDialogOpen(false)}
        />
      </div>
    </div>
  );
}
