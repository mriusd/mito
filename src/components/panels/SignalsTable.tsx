import { useState, useCallback, useEffect } from 'react';
import { useAppStore } from '../../stores/appStore';
import { formatPriceShort, ASSET_COLORS, shortenMarketName } from '../../utils/format';
import { Share2, Zap } from 'lucide-react';
import { showToast } from '../../utils/toast';

export function SignalsTable() {
  const signals = useAppStore((s) => s.signals);
  const selectedMarket = useAppStore((s) => s.selectedMarket);
  const setSelectedMarket = useAppStore((s) => s.setSelectedMarket);
  const setSidebarOpen = useAppStore((s) => s.setSidebarOpen);
  const setSidebarOutcome = useAppStore((s) => s.setSidebarOutcome);
  const makerMode = useAppStore((s) => s.signalMakerMode);
  const setMakerModeGlobal = useAppStore((s) => s.setSignalMakerMode);
  const setSignalsOnGrid = useAppStore((s) => s.setSignalsOnGrid);

  const handleMarketClick = useCallback((market: typeof signals[0]['market'], outcome: 'YES' | 'NO' = 'YES') => {
    setSelectedMarket(market);
    setSidebarOutcome(outcome);
    setSidebarOpen(true);
  }, [setSelectedMarket, setSidebarOutcome, setSidebarOpen]);

  // Grid toggle was removed from UI; keep signals visible on market cells.
  useEffect(() => {
    setSignalsOnGrid(true);
  }, [setSignalsOnGrid]);

  const [marketTypeFilter, setMarketTypeFilter] = useState(
    localStorage.getItem('polymarket-signal-market-type') || 'ALL'
  );
  const [pctChangeFilter, setPctChangeFilter] = useState(
    localStorage.getItem('polymarket-signal-pct-change') || ''
  );
  const [maxPriceFilter, setMaxPriceFilter] = useState(
    localStorage.getItem('polymarket-signal-max-price') || ''
  );
  const [assetFilter, setAssetFilter] = useState(
    localStorage.getItem('polymarket-table-asset-filter') || 'ALL'
  );
  const [sortCol, setSortCol] = useState<'date' | 'diff' | null>('diff');
  const [sortAsc, setSortAsc] = useState(true);
  const [shareOpenId, setShareOpenId] = useState<string | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);
  const stopPanelDrag = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const getSignalKey = (sig: typeof signals[number]) => `${sig.market.id}-${sig.origSide}`;
  const getShareLink = (sig: typeof signals[number], campaign: 'x' | 'tg') =>
    `https://mito.trade/?market=${encodeURIComponent(sig.market.id)}&side=${sig.origSide.toLowerCase()}&utm_source=sig&utm_campaign=${campaign}`;

  const toBlob = (canvas: HTMLCanvasElement): Promise<Blob | null> =>
    new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));

  const captureSidebarShareImage = async (): Promise<Blob | null> => {
    const sidebar = (document.querySelector('.right-sidebar.open') || document.querySelector('.right-sidebar')) as HTMLElement | null;
    if (!sidebar) return null;
    // Let layout settle before snapshot (helps with charts/text baseline).
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    if ('fonts' in document) {
      try { await (document as Document & { fonts: FontFaceSet }).fonts.ready; } catch { /* noop */ }
    }
    const liveTrades = sidebar.querySelector('.live-trades-section') as HTMLElement | null;
    const sidebarRect = sidebar.getBoundingClientRect();
    const cropHeight = liveTrades
      ? Math.max(200, Math.floor(liveTrades.getBoundingClientRect().top - sidebarRect.top))
      : Math.floor(sidebarRect.height);

    const html2canvas = (await import('html2canvas')).default;
    const canvas = await html2canvas(sidebar, {
      backgroundColor: '#0f172a',
      useCORS: true,
      scale: Math.min(2, window.devicePixelRatio || 1.5),
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      width: Math.floor(sidebarRect.width),
      height: cropHeight,
      onclone: (doc) => {
        const cloneSidebar = doc.querySelector('.right-sidebar') as HTMLElement | null;
        if (!cloneSidebar) return;
        // Freeze sidebar geometry to avoid CSS transition/transform offsets in clone.
        cloneSidebar.style.position = 'fixed';
        cloneSidebar.style.top = `${Math.floor(sidebarRect.top)}px`;
        cloneSidebar.style.right = `${Math.max(0, Math.floor(window.innerWidth - sidebarRect.right))}px`;
        cloneSidebar.style.width = `${Math.floor(sidebarRect.width)}px`;
        cloneSidebar.style.maxWidth = `${Math.floor(sidebarRect.width)}px`;
        cloneSidebar.style.transform = 'none';
        cloneSidebar.style.transition = 'none';
        cloneSidebar.classList.add('open');

        // Disable transitions globally in cloned doc to prevent shifted intermediate frames.
        const style = doc.createElement('style');
        style.textContent = `*, *::before, *::after { transition: none !important; animation: none !important; }`;
        doc.head.appendChild(style);
        // Keep only top-5 bid/ask levels in the captured image.
        const bids = Array.from(cloneSidebar.querySelectorAll('.live-ob-bid'));
        const asks = Array.from(cloneSidebar.querySelectorAll('.live-ob-ask'));
        bids.slice(5).forEach((el) => ((el as HTMLElement).closest('div') as HTMLElement | null)?.remove());
        asks.slice(5).forEach((el) => ((el as HTMLElement).closest('div') as HTMLElement | null)?.remove());
      },
    });
    return toBlob(canvas);
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const shareSignal = async (platform: 'telegram' | 'x', sig: typeof signals[number]) => {
    const key = getSignalKey(sig);
    setSharingId(key);
    setShareOpenId(null);
    // Ensure sidebar reflects this signal before capture.
    handleMarketClick(sig.market, sig.origSide);
    await new Promise((r) => setTimeout(r, 250));
    const blob = await captureSidebarShareImage();
    const diffValuePct = makerMode ? sig.bidDiffPct : sig.diffPct;
    const diffCents = makerMode
      ? (sig.bidPrice - sig.bsPrice) * 100
      : (sig.price - sig.bsPrice) * 100;
    const diff = `${diffCents >= 0 ? '+' : ''}${diffCents.toFixed(1)}c`;
    const bestAsk = (sig.price * 100).toFixed(1);
    const mathProb = (sig.bsPrice * 100).toFixed(1);
    const marketTitle = shortenMarketName(
      sig.market.question || sig.market.groupItemTitle,
      undefined,
      undefined,
      sig.market.eventSlug
    );
    const campaign = platform === 'telegram' ? 'tg' : 'x';
    const link = getShareLink(sig, campaign);
    const text = [
      `@Polymarket market underpriced by ${Math.abs(diffValuePct).toFixed(1)}%`,
      `Market: ${marketTitle}`,
      `Mathematical Probability: ${mathProb}%`,
      `Best ask: ${bestAsk}¢`,
      `Discount: ${diff}`,
      `-> ${link}`,
    ].join('\n');

    if (!blob) {
      showToast('Share image could not be generated', 'error');
    }

    let copiedImage = false;
    try {
      if (blob && 'clipboard' in navigator && 'ClipboardItem' in window) {
        // Helpful for X/Telegram web composer: user can paste image after window opens.
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        copiedImage = true;
        showToast('Share image copied to clipboard', 'success');
      }
    } catch {
      copiedImage = false;
    }

    if (platform === 'telegram') {
      const tg = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text.replace(`\n-> ${link}`, ''))}`;
      window.open(tg, '_blank', 'noopener,noreferrer');
    } else {
      const x = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}`;
      window.open(x, '_blank', 'noopener,noreferrer');
    }

    // Always provide a tangible image file so it never gets lost.
    if (blob) {
      downloadBlob(blob, `mito-signal-${sig.asset}-${sig.market.id}.png`);
      if (!copiedImage) showToast('Share image downloaded', 'success');
    }
    setSharingId(null);
  };

  const toggleSort = (col: 'date' | 'diff') => {
    if (sortCol === col) setSortAsc(!sortAsc);
    else { setSortCol(col); setSortAsc(true); }
  };

  const filtered = signals.filter((s) => {
    if (assetFilter !== 'ALL' && s.asset !== assetFilter) return false;
    if (marketTypeFilter === 'above' && s.tableType !== 'above') return false;
    if (marketTypeFilter === 'price' && s.tableType !== 'price') return false;
    if (marketTypeFilter === 'hit' && s.tableType !== 'hit') return false;
    // % filter: use the active diff based on mode
    const activeDiffPct = makerMode ? Math.abs(s.bidDiffPct) : Math.abs(s.diffPct);
    if (pctChangeFilter && activeDiffPct < parseFloat(pctChangeFilter)) return false;
    // Max price filter: use bid or ask price based on mode
    const displayPriceCents = makerMode ? s.bidPrice * 100 : s.price * 100;
    if (maxPriceFilter && displayPriceCents > parseFloat(maxPriceFilter)) return false;
    return true;
  }).sort((a, b) => {
    if (!sortCol) return 0;
    let cmp = 0;
    if (sortCol === 'date') {
      cmp = new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
    } else if (sortCol === 'diff') {
      const diffA = makerMode ? a.bidDiffPct : a.diffPct;
      const diffB = makerMode ? b.bidDiffPct : b.diffPct;
      cmp = diffA - diffB;
    }
    return sortAsc ? cmp : -cmp;
  });

  const assets = ['ALL', 'BTC', 'ETH', 'SOL', 'XRP'];
  const assetColors: Record<string, string> = { ALL: 'text-white', BTC: 'text-orange-400', ETH: 'text-blue-400', SOL: 'text-purple-400', XRP: 'text-cyan-400' };

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3">
      <div className="panel-header">
        <h3 className="text-sm font-bold text-yellow-400 mb-2 flex items-center justify-between">
          <span>
            <Zap className="inline w-3.5 h-3.5 mr-1" />
            Signals
          </span>
          <div
            className="flex gap-1 items-center no-drag"
            onPointerDownCapture={stopPanelDrag}
            onMouseDown={stopPanelDrag}
            onTouchStart={stopPanelDrag}
          >
            <select
              value={marketTypeFilter}
              onChange={(e) => { setMarketTypeFilter(e.target.value); localStorage.setItem('polymarket-signal-market-type', e.target.value); }}
              onPointerDownCapture={stopPanelDrag}
              onMouseDown={stopPanelDrag}
              onTouchStart={stopPanelDrag}
              className="bg-gray-700 text-white text-[9px] px-0.5 py-0 rounded border border-gray-600 h-[22px]"
            >
              <option value="ALL">All</option>
              <option value="above">Above</option>
              <option value="price">Between</option>
              <option value="hit">Hit</option>
            </select>
            <select
              value={makerMode ? 'maker' : 'taker'}
              onChange={(e) => { setMakerModeGlobal(e.target.value === 'maker'); }}
              onPointerDownCapture={stopPanelDrag}
              onMouseDown={stopPanelDrag}
              onTouchStart={stopPanelDrag}
              className="bg-gray-700 text-white text-[9px] px-0.5 py-0 rounded border border-gray-600 h-[22px]"
            >
              <option value="taker">Taker</option>
              <option value="maker">Maker</option>
            </select>
            <label className="flex items-center gap-0.5 text-[9px] text-gray-400">
              %<input
                type="number"
                value={pctChangeFilter}
                onChange={(e) => { setPctChangeFilter(e.target.value); localStorage.setItem('polymarket-signal-pct-change', e.target.value); }}
                onPointerDownCapture={stopPanelDrag}
                onMouseDown={stopPanelDrag}
                onTouchStart={stopPanelDrag}
                placeholder="0"
                className="w-8 bg-gray-700 text-white text-[9px] px-0.5 rounded border border-gray-600 text-center no-spin h-[22px]"
              />
            </label>
            <label className="flex items-center gap-0.5 text-[9px] text-gray-400">
              ¢<input
                type="number"
                value={maxPriceFilter}
                onChange={(e) => { setMaxPriceFilter(e.target.value); localStorage.setItem('polymarket-signal-max-price', e.target.value); }}
                onPointerDownCapture={stopPanelDrag}
                onMouseDown={stopPanelDrag}
                onTouchStart={stopPanelDrag}
                placeholder="0"
                className="w-8 bg-gray-700 text-white text-[9px] px-0.5 rounded border border-gray-600 text-center no-spin h-[22px]"
              />
            </label>
            <select
              value={assetFilter}
              onChange={(e) => { setAssetFilter(e.target.value); localStorage.setItem('polymarket-table-asset-filter', e.target.value); }}
              onPointerDownCapture={stopPanelDrag}
              onMouseDown={stopPanelDrag}
              onTouchStart={stopPanelDrag}
              className={`bg-gray-700 text-[9px] font-bold rounded px-1 py-0 border border-gray-600 h-[22px] ${assetColors[assetFilter] || 'text-white'}`}
              style={{ outline: 'none' }}
            >
              {assets.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </h3>
      </div>
      <div className="panel-body text-xs">
        {filtered.length === 0 ? (
          <div className="text-gray-500 text-center py-4">No signals</div>
        ) : (
          <div className="overflow-y-auto max-h-full">
            <table className="w-full text-[10px]">
              <thead>
                <tr className="text-gray-500 border-b border-gray-700">
                  <th className="text-left px-1 py-0.5">Asset</th>
                  <th className="text-left px-1 py-0.5 cursor-pointer select-none" onClick={() => toggleSort('date')}>Date{sortCol === 'date' ? (sortAsc ? ' ▲' : ' ▼') : ''}</th>
                  <th className="text-left px-1 py-0.5">Market</th>
                  <th className="text-center px-1 py-0.5">Side</th>
                  <th className="text-right px-1 py-0.5">BS</th>
                  <th className="text-right px-1 py-0.5">{makerMode ? 'Bid' : 'Ask'}</th>
                  <th className="text-right px-1 py-0.5 cursor-pointer select-none" onClick={() => toggleSort('diff')}>Diff{sortCol === 'diff' ? (sortAsc ? ' ▲' : ' ▼') : ''}</th>
                  <th className="text-center px-1 py-0.5">Share</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((sig, i) => {
                  const sigKey = getSignalKey(sig);
                  const acol = ASSET_COLORS[sig.asset] || 'text-gray-400';
                  // Date formatting matching HTML
                  const endD = new Date(sig.endDate);
                  const hoursUntil = (endD.getTime() - Date.now()) / 3600000;
                  const dayAbbr = ['Su','Mo','Tu','We','Th','Fr','Sa'][endD.getDay()];
                  const isWeekend2 = endD.getDay() === 0 || endD.getDay() === 6;
                  let dateStr: string, dateColor: string;
                  if (hoursUntil > 0 && hoursUntil < 24) { dateStr = 'TODAY'; dateColor = 'text-red-400 font-bold'; }
                  else if (hoursUntil >= 24 && hoursUntil < 48) { dateStr = 'TMR'; dateColor = 'text-yellow-400 font-bold'; }
                  else { dateStr = dayAbbr + ' ' + endD.getDate(); dateColor = isWeekend2 ? 'text-purple-400' : 'text-gray-400'; }
                  // Market label: "{asset} >{strike}" with formatPriceShort
                  const strikeLabel = formatPriceShort(sig.priceStr);
                  const isSelected = selectedMarket && selectedMarket.id === sig.market.id;
                  const rowHighlight = isSelected ? 'bg-blue-900/40' : '';
                  // Display price: bid in maker/BID mode, ask otherwise
                  const displayPrice = makerMode ? sig.bidPrice * 100 : sig.price * 100;
                  // Diff: % vs B-S for both modes (bid-side % in maker, ask-side % in taker)
                  const displayDiff = (makerMode ? sig.bidDiffPct : sig.diffPct).toFixed(1) + '%';
                  return (
                    <tr key={i} className={`hover:bg-gray-700/30 cursor-pointer border-b border-gray-700/30 ${rowHighlight}`} onClick={() => handleMarketClick(sig.market, sig.origSide)}>
                      <td className={`px-1 py-0.5 font-bold ${acol}`}>{sig.asset}</td>
                      <td className={`px-1 py-0.5 ${dateColor} whitespace-nowrap`}>{dateStr}</td>
                      <td className={`px-1 py-0.5 ${acol} whitespace-nowrap truncate max-w-[100px] hover:underline`}>{sig.asset} {strikeLabel}</td>
                      <td className={`text-center px-1 py-0.5 font-bold ${sig.origSide === 'YES' ? 'text-green-400' : 'text-red-400'}`}>{sig.origSide}</td>
                      <td className="text-right px-1 py-0.5 text-gray-300">{(sig.bsPrice * 100).toFixed(1)}</td>
                      <td className="text-right px-1 py-0.5 text-gray-300">{displayPrice.toFixed(1)}¢</td>
                      <td className="text-right px-1 py-0.5 text-green-400 font-bold">{displayDiff}</td>
                      <td className="text-center px-1 py-0.5 relative">
                        <button
                          className="inline-flex items-center justify-center w-5 h-5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
                          onClick={(e) => {
                            e.stopPropagation();
                            setShareOpenId((prev) => (prev === sigKey ? null : sigKey));
                          }}
                          title="Share signal"
                          disabled={sharingId === sigKey}
                        >
                          <Share2 className="w-3 h-3" />
                        </button>
                        {shareOpenId === sigKey && (
                          <div
                            className="absolute right-0 top-6 z-20 bg-gray-800 border border-gray-600 rounded shadow-lg min-w-[88px]"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              className="block w-full text-left px-2 py-1 text-[10px] text-gray-100 hover:bg-gray-700"
                              onClick={() => { void shareSignal('telegram', sig); }}
                            >
                              Telegram
                            </button>
                            <button
                              className="block w-full text-left px-2 py-1 text-[10px] text-gray-100 hover:bg-gray-700"
                              onClick={() => { void shareSignal('x', sig); }}
                            >
                              X
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
