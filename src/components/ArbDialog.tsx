import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAppStore } from '../stores/appStore';
import { formatPriceShort, ASSET_COLORS } from '../utils/format';
import { createProgArb } from '../api';
import type { AssetSymbol } from '../types';

export function ArbDialog() {
  const arb = useAppStore((s) => s.arbDialogArb);
  const setArbDialogArb = useAppStore((s) => s.setArbDialogArb);
  const priceData = useAppStore((s) => s.priceData);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const cashBalance = useAppStore((s) => s.cashBalance);
  const positions = useAppStore((s) => s.positions);

  const [size, setSize] = useState('');
  const [yesPrice, setYesPrice] = useState('');
  const [noPrice, setNoPrice] = useState('');
  const [minEdge, setMinEdge] = useState('1');
  const [creating, setCreating] = useState(false);
  const [statusLines, setStatusLines] = useState<{ text: string; color: string }[]>([]);
  const [progress, setProgress] = useState(0);
  const [progressColor, setProgressColor] = useState('bg-emerald-500');
  const [done, setDone] = useState(false);

  // Derived arb info
  const info = useMemo(() => {
    if (!arb) return null;
    const assetParts = arb.asset.split('/');
    const yesAsset = assetParts[0] || '';
    const noAsset = assetParts[1] || assetParts[0] || '';
    const yesStrike = arb.yesMarket?.groupItemTitle || '';
    const noStrike = arb.noMarket?.groupItemTitle || '';
    const yFmt = formatPriceShort(yesStrike.includes('>') ? yesStrike : '>' + yesStrike).replace(/^>/, '');
    const nFmt = formatPriceShort(noStrike.includes('>') ? noStrike : '>' + noStrike).replace(/^>/, '');
    const yesAskCents = arb.yesPrice * 100;
    const noAskCents = arb.noPrice * 100;
    const yesTokenId = arb.yesMarket?.clobTokenIds?.[0] || '';
    const noTokenId = arb.noMarket?.clobTokenIds?.[1] || '';
    const yesStrikeVal = parseFloat(yesStrike.replace(/[>$,]/g, ''));
    const noStrikeVal = parseFloat(noStrike.replace(/[>$,]/g, ''));
    const yesLive = priceData[(yesAsset + 'USDT') as AssetSymbol]?.price || 0;
    const noLive = priceData[(noAsset + 'USDT') as AssetSymbol]?.price || 0;
    const yesPct = yesLive > 0 ? ((yesStrikeVal - yesLive) / yesLive) * 100 : 0;
    const noPct = noLive > 0 ? ((noStrikeVal - noLive) / noLive) * 100 : 0;
    const yesVol = (volatilityData[(yesAsset + 'USDT') as AssetSymbol] || 0.60) * volMultiplier;
    const noVol = (volatilityData[(noAsset + 'USDT') as AssetSymbol] || 0.60) * volMultiplier;
    const yesAbove = yesLive >= yesStrikeVal;
    const noAbove = noLive >= noStrikeVal;
    return {
      yesAsset, noAsset, yesStrike, noStrike, yFmt, nFmt,
      yesAskCents, noAskCents, yesTokenId, noTokenId,
      yesStrikeVal, noStrikeVal, yesLive, noLive,
      yesPct, noPct, yesVol, noVol, yesAbove, noAbove,
    };
  }, [arb, priceData, volatilityData, volMultiplier]);

  // Date label
  const dateLabel = useMemo(() => {
    if (!arb?.endDate) return null;
    const ed = new Date(arb.endDate);
    const h = (ed.getTime() - Date.now()) / 3600000;
    const da = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'][ed.getDay()];
    if (h > 0 && h < 24) return { text: 'TODAY', cls: 'text-red-400 font-bold' };
    if (h >= 24 && h < 48) return { text: 'TMR', cls: 'text-yellow-400 font-bold' };
    const wk = ed.getDay() === 0 || ed.getDay() === 6;
    return { text: da + ' ' + ed.getDate(), cls: wk ? 'text-purple-400' : 'text-gray-400' };
  }, [arb?.endDate]);

  // Initialize prices/size when arb changes
  useEffect(() => {
    if (!arb || !info) return;
    const yesCeil = Math.ceil(info.yesAskCents);
    const noCeil = Math.ceil(info.noAskCents);
    setYesPrice(yesCeil.toFixed(1));
    setNoPrice(noCeil.toFixed(1));
    // Calculate max size
    const costPerShare = (yesCeil + noCeil) / 100;
    const cash = cashBalance || 0;
    const maxByCash = costPerShare > 0 ? Math.floor(cash / costPerShare) : 999;
    setSize(String(maxByCash));
    setCreating(false);
    setStatusLines([]);
    setProgress(0);
    setProgressColor('bg-emerald-500');
    setDone(false);
    setMinEdge('1');
  }, [arb, info, cashBalance]);

  const yesCents = parseFloat(yesPrice) || 0;
  const noCents = parseFloat(noPrice) || 0;
  const sizeNum = parseInt(size) || 0;
  const totalCost = sizeNum * (yesCents + noCents) / 100;
  const payout = sizeNum;
  const profit = payout - totalCost;

  // Min/max size
  const minSize = useMemo(() => {
    if (yesCents <= 0 || noCents <= 0) return 1;
    return Math.max(Math.ceil(100 / yesCents), Math.ceil(100 / noCents));
  }, [yesCents, noCents]);

  const maxSize = useMemo(() => {
    const costPerShare = (yesCents + noCents) / 100;
    const cash = cashBalance || 0;
    return costPerShare > 0 ? Math.floor(cash / costPerShare) : 999;
  }, [yesCents, noCents, cashBalance]);

  // Price total display
  const priceTotalCents = yesCents + noCents;
  const priceEdgeCents = 100 - priceTotalCents;

  // Validate size: each leg value must be >= $1
  const yesVal = sizeNum * yesCents / 100;
  const noVal = sizeNum * noCents / 100;
  const sizeValid = yesVal >= 1 && noVal >= 1;

  const handleCreate = useCallback(async () => {
    if (!arb || !info || creating) return;
    if (sizeNum <= 0) return;
    if (yesCents <= 0 || noCents <= 0) return;

    setCreating(true);
    setDone(false);
    setStatusLines([{ text: 'Creating smart order & placing bids...', color: 'text-gray-400' }]);
    setProgress(20);
    setProgressColor('bg-emerald-500');

    try {
      const yesPosBaseline = (() => {
        const pos = positions.find(p => (p.asset === info.yesTokenId || p.asset_id === info.yesTokenId) && p.size > 0);
        return pos ? Math.floor(pos.size) : 0;
      })();
      const noPosBaseline = (() => {
        const pos = positions.find(p => (p.asset === info.noTokenId || p.asset_id === info.noTokenId) && p.size > 0);
        return pos ? Math.floor(pos.size) : 0;
      })();

      const data = await createProgArb({
        legs: [
          { asset: info.yesAsset, strike: info.yesStrike, tokenId: info.yesTokenId, bidPrice: yesCents / 100, posBaseline: yesPosBaseline },
          { asset: info.noAsset, strike: info.noStrike, tokenId: info.noTokenId, bidPrice: noCents / 100, posBaseline: noPosBaseline },
        ],
        endDate: arb.endDate || '',
        minEdge: parseFloat(minEdge) || 1,
        size: sizeNum,
      });

      if (!data.success) {
        setStatusLines(prev => [...prev, { text: `Failed: ${data.error || 'Unknown error'}`, color: 'text-red-400' }]);
        setProgressColor('bg-red-500');
        setProgress(100);
        setDone(true);
        setCreating(false);
        return;
      }

      setStatusLines(prev => [...prev, { text: `Smart order #${data.id} ${data.merged ? 'merged (size increased)' : 'created'}`, color: 'text-green-400' }]);
      setProgress(40);

      const yesLabel = `${info.yesAsset} >${info.yFmt}`;
      const noLabel = `${info.noAsset} >${info.nFmt}`;
      const labels = [yesLabel, noLabel];
      const legOrders = data.orders || [];
      const legErrors = data.orderErrors || [];
      let allOk = true;

      for (let i = 0; i < legOrders.length; i++) {
        const lo = legOrders[i];
        if (lo && lo.price) {
          const lp = (lo.price * 100).toFixed(1);
          setStatusLines(prev => [...prev, { text: `Leg ${i} bid placed: ${sizeNum} ${labels[i] || 'L' + i} @ ${lp}¢`, color: 'text-green-400' }]);
        } else {
          allOk = false;
          const errMsg = legErrors[i] || '';
          setStatusLines(prev => [...prev, { text: `Leg ${i} bid failed${errMsg ? ': ' + errMsg : ''}`, color: 'text-red-400' }]);
        }
      }

      setProgress(100);
      if (!allOk) setProgressColor('bg-yellow-500');
      setDone(true);
      setCreating(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setStatusLines(prev => [...prev, { text: `Failed: ${msg}`, color: 'text-red-400' }]);
      setProgressColor('bg-red-500');
      setProgress(100);
      setDone(true);
      setCreating(false);
    }
  }, [arb, info, sizeNum, yesCents, noCents, minEdge, creating, positions]);

  const handleClose = useCallback(() => {
    setArbDialogArb(null);
  }, [setArbDialogArb]);

  if (!arb || !info) return null;

  const yCol = ASSET_COLORS[info.yesAsset as keyof typeof ASSET_COLORS] || '';
  const nCol = ASSET_COLORS[info.noAsset as keyof typeof ASSET_COLORS] || '';
  const s1 = info.yesAbove && !info.noAbove;
  const s2 = info.yesAbove && info.noAbove;
  const s3 = !info.yesAbove && !info.noAbove;
  const s4 = !info.yesAbove && info.noAbove;
  const lossCost = info.yesAskCents > 0 && info.noAskCents > 0 ? ((info.yesAskCents + info.noAskCents) / 100).toFixed(2) : '?';
  const now = <span className="text-yellow-300 font-bold ml-1">◄ NOW</span>;

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[10010] flex items-center justify-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div className="bg-gray-800 rounded-lg p-6 max-w-md mx-4 shadow-xl border border-gray-700">
        {/* Title */}
        <div className="text-lg font-bold mb-3 text-emerald-400 flex items-center gap-2">
          <span>Programmatic Arb</span>
          <span className="text-xs px-1.5 py-0.5 rounded font-bold bg-orange-600 text-white">ASK</span>
        </div>

        {/* Details */}
        <div className="text-sm text-gray-300 mb-3 space-y-1">
          {/* Date */}
          {dateLabel && (
            <div className="text-xs mb-1"><span className={dateLabel.cls}>{dateLabel.text}</span></div>
          )}

          {/* BUY YES */}
          <div>
            BUY YES <span className={`${yCol} font-bold`}>{info.yesAsset} &gt;{info.yFmt}</span>
            {' '}@ <span
              className="text-green-300 ob-trigger cursor-pointer hover:underline"
              data-token-id={info.yesTokenId}
              data-market-title={`${info.yesAsset} >${info.yFmt} (YES)`}
              data-asset={info.yesAsset}
              data-strike={info.yesStrike}
              data-end-date={arb.endDate || ''}
            >{info.yesAskCents.toFixed(1)}¢</span>
            {' '}<span className="text-gray-500">({info.yesPct >= 0 ? '+' : ''}{info.yesPct.toFixed(1)}%)</span>
          </div>

          {/* BUY NO */}
          <div>
            BUY NO <span className={`${nCol} font-bold`}>{info.noAsset} &gt;{info.nFmt}</span>
            {' '}@ <span
              className="text-red-300 ob-trigger cursor-pointer hover:underline"
              data-token-id={info.noTokenId}
              data-market-title={`${info.noAsset} >${info.nFmt} (NO)`}
              data-asset={info.noAsset}
              data-strike={info.noStrike}
              data-end-date={arb.endDate || ''}
            >{info.noAskCents.toFixed(1)}¢</span>
            {' '}<span className="text-gray-500">({info.noPct >= 0 ? '+' : ''}{info.noPct.toFixed(1)}%)</span>
          </div>

          {/* Volatility */}
          <div className="text-[10px] text-gray-500 mt-1">
            <span className={yCol}>{info.yesAsset}</span> σ{(info.yesVol * 100).toFixed(0)}%
            {' · '}<span className={nCol}>{info.noAsset}</span> σ{(info.noVol * 100).toFixed(0)}%
          </div>

          {/* Total/edge */}
          <div className="text-gray-500 mt-1">
            Total cost: <span className="text-white">{(info.yesAskCents + info.noAskCents).toFixed(1)}¢</span>
            {' · '}Edge: <span className="text-emerald-400">{(100 - info.yesAskCents - info.noAskCents).toFixed(1)}¢</span>
          </div>

          {/* Scenarios */}
          <div className="text-[10px] mt-2 space-y-0.5 border-t border-gray-700 pt-2">
            <div className={`text-emerald-400 ${s1 ? 'bg-emerald-400/10 rounded px-1 -mx-1' : ''}`}>
              ✓ <span className={yCol}>{info.yesAsset}</span> above {info.yFmt} AND <span className={nCol}>{info.noAsset}</span> below {info.nFmt} → both pay, +$2{s1 && now}
            </div>
            <div className={`text-gray-300 ${s2 ? 'bg-gray-500/10 rounded px-1 -mx-1' : ''}`}>
              ≈ <span className={yCol}>{info.yesAsset}</span> above {info.yFmt} AND <span className={nCol}>{info.noAsset}</span> above {info.nFmt} → YES pays, +$1{s2 && now}
            </div>
            <div className={`text-gray-300 ${s3 ? 'bg-gray-500/10 rounded px-1 -mx-1' : ''}`}>
              ≈ <span className={yCol}>{info.yesAsset}</span> below {info.yFmt} AND <span className={nCol}>{info.noAsset}</span> below {info.nFmt} → NO pays, +$1{s3 && now}
            </div>
            <div className={`text-red-400 ${s4 ? 'bg-red-400/10 rounded px-1 -mx-1' : ''}`}>
              ✗ <span className={yCol}>{info.yesAsset}</span> below {info.yFmt} AND <span className={nCol}>{info.noAsset}</span> above {info.nFmt} → both lose, -${lossCost}{s4 && now}
            </div>
          </div>
        </div>

        {/* Size input */}
        <div className="flex items-center gap-2 mb-3">
          <label className="text-sm text-gray-400">Size:</label>
          <input
            type="number"
            value={size}
            onChange={(e) => setSize(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 w-24 text-sm font-bold no-spin"
            style={{ outline: 'none', color: sizeValid ? 'white' : '#f87171' }}
            autoFocus
          />
          <span className="text-xs text-gray-500">
            <span className="cursor-pointer hover:text-white" onClick={() => setSize(String(minSize))}>min {minSize}</span>
            {' · '}
            <span className="cursor-pointer hover:text-white" onClick={() => setSize(String(maxSize))}>max {maxSize}</span>
          </span>
        </div>

        {/* Min Edge */}
        <div className="flex items-center gap-2 mb-3">
          <label className="text-sm text-gray-400">Min Edge:</label>
          <input
            type="number"
            value={minEdge}
            onChange={(e) => setMinEdge(e.target.value)}
            min="0.1"
            step="0.1"
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 w-20 text-white text-sm font-bold no-spin"
            style={{ outline: 'none' }}
          />
          <span className="text-xs text-gray-500">¢ (won't quote if edge below)</span>
        </div>

        {/* Price inputs */}
        <div className="mb-3">
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-sm text-green-400 w-8">Y¢:</label>
            <input
              type="number"
              step="0.1"
              value={yesPrice}
              onChange={(e) => setYesPrice(e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1 w-20 text-white text-sm font-bold no-spin"
              style={{ outline: 'none' }}
            />
            <span className="text-xs text-gray-500">¢</span>
          </div>
          <div className="flex items-center gap-2 mb-1.5">
            <label className="text-sm text-red-400 w-8">N¢:</label>
            <input
              type="number"
              step="0.1"
              value={noPrice}
              onChange={(e) => setNoPrice(e.target.value)}
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1 w-20 text-white text-sm font-bold no-spin"
              style={{ outline: 'none' }}
            />
            <span className="text-xs text-gray-500">¢</span>
          </div>
          <div className="text-xs text-gray-400 ml-10">
            Total: <span className="text-white">{priceTotalCents.toFixed(1)}¢</span>
            {' · '}Edge: <span className={priceEdgeCents > 0 ? 'text-emerald-400' : 'text-red-400'}>{priceEdgeCents.toFixed(1)}¢</span>
          </div>
        </div>

        {/* Cost display */}
        {sizeNum > 0 && (
          <div className="text-xs text-gray-400 mb-3">
            Cost: <span className="text-white font-bold">${totalCost.toFixed(2)}</span>
            {' · '}Payout: <span className="text-white">${payout.toFixed(2)}</span>
            {' · '}Profit: <span className="text-emerald-400 font-bold">${profit.toFixed(2)}</span>
          </div>
        )}

        {/* Progress area */}
        {statusLines.length > 0 && (
          <div className="mb-3">
            <div className="w-full bg-gray-700 rounded-full h-2 mb-2">
              <div className={`${progressColor} h-2 rounded-full transition-all`} style={{ width: `${progress}%` }} />
            </div>
            <div className="text-xs space-y-1 max-h-24 overflow-y-auto">
              {statusLines.map((line, i) => (
                <div key={i} className={line.color}>{line.text}</div>
              ))}
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={handleClose}
            className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg text-sm font-medium transition"
          >Cancel</button>
          <button
            onClick={done ? handleClose : handleCreate}
            disabled={creating}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg text-sm font-medium transition disabled:opacity-50"
          >
            {creating ? 'Placing orders...' : done ? 'Done' : 'Create Smart Order'}
          </button>
        </div>
      </div>
    </div>
  );
}
