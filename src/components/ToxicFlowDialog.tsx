import { useState, useEffect, useCallback, useRef } from 'react';
import { X, TrendingUp, TrendingDown, Users, BarChart3, AlertTriangle, Crown, ShieldAlert, UsersRound } from 'lucide-react';
import { fetchToxicFlow, fetchWalletSummary } from '../api';
import type { ToxicFlowData, WalletPosition, WalletSummary } from '../api';

interface ToxicFlowDialogProps {
  open: boolean;
  marketId: string;
  marketName: string;
  onClose: () => void;
}

type Tab = 'overview' | 'topHolders' | 'topYes' | 'topNo' | 'topVolume' | 'topTraders';

function shortenWallet(w: string): string {
  if (w.length <= 12) return w;
  return w.slice(0, 6) + '…' + w.slice(-4);
}

// Wallet hover tooltip — fetches summary on hover, caches results
const summaryCache: Record<string, WalletSummary | null> = {};

function WalletLink({ wallet }: { wallet: string }) {
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
      <a href={polygonUrl} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline font-mono">
        {shortenWallet(wallet)}
      </a>
      {show && (
        <div className="absolute z-[60000] left-0 top-full mt-1 bg-gray-900 border border-gray-600 rounded shadow-xl p-2 min-w-[190px] text-[9px]"
          onMouseEnter={() => setShow(true)} onMouseLeave={onLeave}>
          <div className="font-mono text-blue-400 mb-1 text-[8px]">{wallet.slice(0, 10)}...{wallet.slice(-6)}</div>
          {summary === undefined && <div className="text-gray-500">Loading...</div>}
          {summary === null && <div className="text-gray-500">No data yet</div>}
          {summary && (
            <div className="space-y-0.5">
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

function WalletTable({ wallets, label, totalShares }: { wallets: WalletPosition[] | null; label: string; totalShares?: number }) {
  if (!wallets || wallets.length === 0) {
    return <div className="text-gray-500 text-center py-3 text-[10px]">No {label} data yet</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full whitespace-nowrap text-[10px]">
        <thead>
          <tr className="text-gray-500 border-b border-gray-700">
            <th className="text-left py-1 px-1">#</th>
            <th className="text-left px-1">Wallet</th>
            <th className="text-right px-1">B.Yes</th>
            <th className="text-right px-1">S.Yes</th>
            <th className="text-right px-1">B.No</th>
            <th className="text-right px-1">S.No</th>
            <th className="text-right px-1">Net Y</th>
            <th className="text-right px-1">Net N</th>
            <th className="text-right px-1">Net</th>
            <th className="text-right px-1">USDC In</th>
            <th className="text-right px-1">% Shares</th>
            <th className="text-right px-1">PnL</th>
            <th className="text-right px-1">Trades</th>
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
            const nNColor = nN > 0.001 ? 'text-red-400' : nN < -0.001 ? 'text-green-400' : 'text-gray-500';
            return (
              <tr key={w.wallet} className="border-b border-gray-800 hover:bg-gray-700/30">
                <td className="py-0.5 px-1 text-gray-600">{i + 1}</td>
                <td className="px-1"><WalletLink wallet={w.wallet} /></td>
                <td className="text-right px-1 text-green-400">{w.boughtYes > 0 ? w.boughtYes.toFixed(1) : '-'}</td>
                <td className="text-right px-1 text-green-300/60">{w.soldYes > 0 ? w.soldYes.toFixed(1) : '-'}</td>
                <td className="text-right px-1 text-red-400">{w.boughtNo > 0 ? w.boughtNo.toFixed(1) : '-'}</td>
                <td className="text-right px-1 text-red-300/60">{w.soldNo > 0 ? w.soldNo.toFixed(1) : '-'}</td>
                <td className={`text-right px-1 font-bold ${nYColor}`}>{nY.toFixed(1)}</td>
                <td className={`text-right px-1 font-bold ${nNColor}`}>{nN.toFixed(1)}</td>
                <td className={`text-right px-1 font-bold ${(w.net || 0) > 0.001 ? 'text-green-400' : (w.net || 0) < -0.001 ? 'text-red-400' : 'text-gray-500'}`}>{(w.net || 0) > 0 ? '+' : ''}{(w.net || 0).toFixed(1)}</td>
                <td className="text-right px-1 text-yellow-400">${w.usdcIn.toFixed(2)}</td>
                <td className="text-right px-1 text-cyan-300">{sharesPct > 0 ? `${sharesPct.toFixed(1)}%` : '-'}</td>
                <td className={`text-right px-1 font-bold ${(w.pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>{(w.pnl || 0) >= 0 ? '+' : ''}{(w.pnl || 0).toFixed(2)}</td>
                <td className="text-right px-1 text-gray-400">{w.tradeCount}</td>
                <td className={`text-right px-1 ${biasColor}`}>{(bias * 100).toFixed(0)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ToxicFlowDialog({ open, marketId, marketName, onClose }: ToxicFlowDialogProps) {
  const [data, setData] = useState<ToxicFlowData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');

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
      setTab('overview');
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

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <BarChart3 size={11} /> },
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

        {/* Tabs */}
        <div className="flex gap-1 mb-3 border-b border-gray-700 pb-2">
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

        {/* Content */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(85vh - 120px)' }}>
          {loading && <div className="text-gray-500 text-center py-8">Loading on-chain data...</div>}
          {error && <div className="text-red-400 text-center py-8">Error: {error}</div>}

          {!loading && !error && data && tab === 'overview' && (
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
                  <div className="text-sm font-bold text-gray-200">{(data.totalShares || 0).toFixed(1)}</div>
                </div>
              </div>

              {/* Informed Trader Bias */}
              <div className="bg-gray-900 rounded p-3">
                <div className="text-[10px] text-gray-500 mb-2 font-bold">Informed Trader Bias</div>
                {(() => {
                  const rawSmb = data.smartMoneyBias || 0;
                  const totalShares = data.totalShares || 0;
                  const smbPct = totalShares > 0 ? (rawSmb / totalShares) * 100 : 0;
                  const thb = data.topHoldersBias || 0;
                  const wb = data.whaleBias || 0;
                  const isUpDownMarket = /up\s+or\s+down|updown|up-or-down/i.test(marketName || '');
                  const posLabel = isUpDownMarket ? 'UP' : 'YES';
                  const negLabel = isUpDownMarket ? 'DOWN' : 'NO';
                  const biasLabel = (v: number) => v > 0.01 ? posLabel : v < -0.01 ? negLabel : 'FLAT';
                  const biasColor = (v: number) => v > 0.01 ? 'text-green-400' : v < -0.01 ? 'text-red-400' : 'text-gray-500';
                  const yesTotal = (data.yesUsdcIn || 0) + (data.noUsdcIn || 0);
                  const yesPct = yesTotal > 0 ? (data.yesUsdcIn / yesTotal) * 100 : 50;
                  return (
                    <div className="space-y-2.5">
                      {/* Smart Money Bias (volume-weighted) */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[9px] text-gray-500">Smart Money (vol-weighted)</span>
                          <span className={`text-[11px] font-bold ${biasColor(smbPct)}`}>
                            {biasLabel(smbPct)} {(rawSmb !== 0 || smbPct !== 0) && <span className="text-[9px] font-normal">({rawSmb > 0 ? '+' : ''}{rawSmb.toFixed(2)}, {smbPct > 0 ? '+' : ''}{smbPct.toFixed(2)}%)</span>}
                          </span>
                        </div>
                        <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                          <div className="bg-green-500/70 h-full transition-all" style={{ width: `${Math.max(2, Math.min(98, 50 + smbPct * 10))}%` }} />
                          <div className="bg-red-500/70 h-full transition-all flex-1" />
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
                                <WalletLink wallet={f.wallet} />{' '}
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
                                <WalletLink wallet={f.wallet} />{' '}
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

              {/* Top Holders Table */}
              <div className="bg-gray-900 rounded p-2">
                <div className="text-[10px] text-gray-400 font-bold mb-1 flex items-center gap-1">
                  <Crown size={10} /> Top Holders (hover wallet for stats)
                </div>
                <WalletTable wallets={data.topHolders} label="holders" totalShares={data.totalShares} />
              </div>
            </div>
          )}

          {!loading && !error && data && tab === 'topHolders' && (
            <WalletTable wallets={data.topHolders} label="holders" totalShares={data.totalShares} />
          )}
          {!loading && !error && data && tab === 'topYes' && (
            <WalletTable wallets={data.topYes} label="YES holders" totalShares={data.totalShares} />
          )}
          {!loading && !error && data && tab === 'topNo' && (
            <WalletTable wallets={data.topNo} label="NO holders" totalShares={data.totalShares} />
          )}
          {!loading && !error && data && tab === 'topVolume' && (
            <WalletTable wallets={data.topVolume} label="volume" totalShares={data.totalShares} />
          )}
          {!loading && !error && data && tab === 'topTraders' && (
            <WalletTable wallets={data.topTraders} label="traders" totalShares={data.totalShares} />
          )}
        </div>
      </div>
    </div>
  );
}
