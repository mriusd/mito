import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Biohazard, TrendingUp, TrendingDown, Users, BarChart3, AlertTriangle, Crown } from 'lucide-react';
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

function WalletTable({ wallets, label }: { wallets: WalletPosition[] | null; label: string }) {
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
            <Biohazard size={16} className="text-yellow-400" />
            <span className="text-sm font-bold text-yellow-400">Toxic Flow</span>
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
              </div>

              {/* Imbalance Indicator */}
              <div className="bg-gray-900 rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] text-gray-500">Net Market Imbalance</span>
                  <span className={`text-xs font-bold ${data.netImbalance > 0 ? 'text-green-400' : data.netImbalance < 0 ? 'text-red-400' : 'text-gray-500'}`}>
                    {data.netImbalance > 0 ? 'YES bias' : data.netImbalance < 0 ? 'NO bias' : 'Balanced'}
                    {' '}({data.netImbalance > 0 ? '+' : ''}{data.netImbalance.toFixed(1)} shares)
                  </span>
                </div>
                {/* Visual bar */}
                <div className="h-3 bg-gray-700 rounded-full overflow-hidden flex">
                  {(() => {
                    const total = data.totalYesVol + data.totalNoVol;
                    const yesPct = total > 0 ? (data.totalYesVol / total) * 100 : 50;
                    return (
                      <>
                        <div className="bg-green-500/60 h-full transition-all" style={{ width: `${yesPct}%` }} />
                        <div className="bg-red-500/60 h-full transition-all" style={{ width: `${100 - yesPct}%` }} />
                      </>
                    );
                  })()}
                </div>
                <div className="flex justify-between mt-1 text-[9px] text-gray-500">
                  <span>YES vol: {data.totalYesVol.toFixed(1)}</span>
                  <span>NO vol: {data.totalNoVol.toFixed(1)}</span>
                </div>
              </div>

              {/* Risk Indicators */}
              <div className="bg-gray-900 rounded p-3">
                <div className="text-[10px] text-gray-500 mb-2">Risk Indicators</div>
                <div className="space-y-1.5">
                  {data.concentration > 0.5 && (
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <AlertTriangle size={12} className="text-red-400 flex-shrink-0" />
                      <span className="text-red-400 font-bold">High concentration:</span>
                      <span className="text-gray-300">Top 5 wallets control {(data.concentration * 100).toFixed(0)}% of volume — potential whale manipulation</span>
                    </div>
                  )}
                  {Math.abs(data.netImbalance) > 50 && (
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0" />
                      <span className="text-yellow-400 font-bold">Large imbalance:</span>
                      <span className="text-gray-300">Net {data.netImbalance > 0 ? 'YES' : 'NO'} position of {Math.abs(data.netImbalance).toFixed(0)} shares — smart money leaning {data.netImbalance > 0 ? 'YES' : 'NO'}</span>
                    </div>
                  )}
                  {data.totalWallets === 0 && (
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-gray-500">No on-chain fills recorded yet for this market. Data accumulates from when the collector started.</span>
                    </div>
                  )}
                  {data.totalWallets > 0 && data.concentration <= 0.5 && Math.abs(data.netImbalance) <= 50 && (
                    <div className="flex items-center gap-1.5 text-[10px]">
                      <span className="text-green-400">No significant risk indicators detected.</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Top Holders Table */}
              <div className="bg-gray-900 rounded p-2">
                <div className="text-[10px] text-gray-400 font-bold mb-1 flex items-center gap-1">
                  <Crown size={10} /> Top Holders (hover wallet for stats)
                </div>
                <WalletTable wallets={data.topHolders} label="holders" />
              </div>
            </div>
          )}

          {!loading && !error && data && tab === 'topHolders' && (
            <WalletTable wallets={data.topHolders} label="holders" />
          )}
          {!loading && !error && data && tab === 'topYes' && (
            <WalletTable wallets={data.topYes} label="YES holders" />
          )}
          {!loading && !error && data && tab === 'topNo' && (
            <WalletTable wallets={data.topNo} label="NO holders" />
          )}
          {!loading && !error && data && tab === 'topVolume' && (
            <WalletTable wallets={data.topVolume} label="volume" />
          )}
          {!loading && !error && data && tab === 'topTraders' && (
            <WalletTable wallets={data.topTraders} label="traders" />
          )}
        </div>
      </div>
    </div>
  );
}
