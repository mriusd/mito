import { useState, useEffect, useRef, useMemo } from 'react';
import { fetchOrderbook } from '../api';
import { useAppStore } from '../stores/appStore';
import { BsFlower } from './BsFlower';

interface OBEntry {
  price: string;
  size: string;
}

interface PopupState {
  visible: boolean;
  x: number;
  y: number;
  tokenId: string;
  title: string;
  asset: string;
  strike: string;
  endDate: string;
  bids: OBEntry[];
  asks: OBEntry[];
  loading: boolean;
  error: boolean;
}

// 10-second cache
const obCache: Record<string, { data: { bids: OBEntry[]; asks: OBEntry[] }; time: number }> = {};
function pruneCache() {
  const keys = Object.keys(obCache);
  if (keys.length > 50) {
    keys.sort((a, b) => obCache[a].time - obCache[b].time);
    for (let i = 0; i < keys.length - 50; i++) delete obCache[keys[i]];
  }
}

// Shorten market title: strip common prefixes, keep strike + outcome
function shortenTitle(title: string): string {
  // e.g. "Will the price of Bitcoin be above $80,000 on March 14? (YES)" -> ">$80k (YES)"
  // or "BTC > $80,000 (YES)" -> ">80k (YES)"
  let s = title;
  // Extract outcome suffix
  const outcomeMatch = s.match(/\((YES|NO)\)\s*$/);
  const outcome = outcomeMatch ? outcomeMatch[1] : '';
  if (outcomeMatch) s = s.substring(0, outcomeMatch.index).trim();
  // Try to extract just the price/range part
  const priceMatch = s.match(/[\$>< ]*([\d,]+(?:\.\d+)?(?:k)?(?:\s*-\s*[\d,]+(?:\.\d+)?(?:k)?)?)/i);
  if (priceMatch) {
    const raw = priceMatch[0].trim();
    // Abbreviate large numbers
    const abbreviated = raw.replace(/\$?([\d,]+)/g, (_, num) => {
      const n = parseFloat(num.replace(/,/g, ''));
      if (n >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k';
      return String(n);
    });
    return abbreviated + (outcome ? ` (${outcome})` : '');
  }
  // Fallback: truncate
  if (s.length > 30) s = s.substring(0, 30) + '…';
  return s + (outcome ? ` (${outcome})` : '');
}

export function OrderbookPopup() {
  const positions = useAppStore((s) => s.positions);
  const orders = useAppStore((s) => s.orders);

  const [state, setState] = useState<PopupState>({
    visible: false, x: 0, y: 0, tokenId: '', title: '',
    asset: '', strike: '', endDate: '',
    bids: [], asks: [], loading: false, error: false,
  });
  const hoverRef = useRef<HTMLElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Position for this token
  const position = useMemo(() => {
    if (!state.tokenId) return null;
    return positions.find(p => p.asset === state.tokenId && p.size > 0) || null;
  }, [positions, state.tokenId]);

  // Orders for this token
  const tokenOrders = useMemo(() => {
    if (!state.tokenId) return [];
    return orders.filter(o => (o.asset_id || o.token_id || '') === state.tokenId);
  }, [orders, state.tokenId]);

  const isYes = state.title.includes('(YES)');

  useEffect(() => {
    const handleMouseOver = (e: MouseEvent) => {
      const trigger = (e.target as HTMLElement).closest?.('.ob-trigger[data-token-id]') as HTMLElement | null;
      if (!trigger || hoverRef.current === trigger) return;

      const tokenId = trigger.dataset.tokenId;
      if (!tokenId) return;

      hoverRef.current = trigger;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      timeoutRef.current = setTimeout(async () => {
        if (hoverRef.current !== trigger) return;

        const rect = trigger.getBoundingClientRect();
        const x = Math.min(rect.right + 10, window.innerWidth - 310);
        const y = Math.max(10, rect.top - 100);
        const title = trigger.dataset.marketTitle || 'Orderbook';
        const bsAsset = trigger.dataset.asset || '';
        const bsStrike = trigger.dataset.strike || '';
        const bsEndDate = trigger.dataset.endDate || '';

        setState(s => ({
          ...s, visible: true, x, y, tokenId, title,
          asset: bsAsset, strike: bsStrike, endDate: bsEndDate,
          loading: true, error: false, bids: [], asks: [],
        }));

        try {
          const cached = obCache[tokenId];
          let data: { bids: OBEntry[]; asks: OBEntry[] };
          if (cached && Date.now() - cached.time < 10000) {
            data = cached.data;
          } else {
            data = await fetchOrderbook(tokenId);
            obCache[tokenId] = { data, time: Date.now() };
            pruneCache();
          }
          if (hoverRef.current === trigger) {
            const bids = [...data.bids].sort((a, b) => parseFloat(b.price) - parseFloat(a.price)).slice(0, 20);
            const asks = [...data.asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price)).slice(0, 20);
            setState(s => ({ ...s, bids, asks, loading: false }));
          }
        } catch {
          if (hoverRef.current === trigger) {
            setState(s => ({ ...s, loading: false, error: true }));
          }
        }
      }, 200);
    };

    const handleMouseOut = (e: MouseEvent) => {
      const trigger = (e.target as HTMLElement).closest?.('.ob-trigger[data-token-id]') as HTMLElement | null;
      if (!trigger) return;
      const related = (e.relatedTarget as HTMLElement)?.closest?.('.ob-trigger[data-token-id]') as HTMLElement | null;
      if (related === trigger) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      hoverRef.current = null;
      setState(s => ({ ...s, visible: false }));
    };

    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
    return () => {
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseout', handleMouseOut);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  // Adjust if popup overflows bottom
  useEffect(() => {
    if (state.visible && popupRef.current) {
      requestAnimationFrame(() => {
        const el = popupRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        if (rect.bottom > window.innerHeight - 10) {
          el.style.top = Math.max(10, window.innerHeight - rect.height - 10) + 'px';
        }
      });
    }
  }, [state.visible, state.bids, state.asks, position, tokenOrders]);

  if (!state.visible) return null;

  const maxRows = Math.max(state.bids.length, state.asks.length, 1);
  const fmtSz = (n: number) => { const v = Math.floor(n); return v >= 1000 ? (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : v.toLocaleString(); };

  // Build set of user order prices for highlighting in the OB
  const userBidPrices = new Set<string>();
  const userAskPrices = new Set<string>();
  for (const o of tokenOrders) {
    const pp = (parseFloat(o.price) * 100).toFixed(1);
    if (o.side === 'BUY') userBidPrices.add(pp);
    else userAskPrices.add(pp);
  }

  return (
    <div
      ref={popupRef}
      className="fixed z-[10020] bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 pointer-events-none"
      style={{ left: state.x, top: state.y, minWidth: 280, maxHeight: '80vh', overflowY: 'auto', fontSize: 11 }}
    >
      {/* Title */}
      <div className="text-xs text-gray-400 mb-2 pb-1 border-b border-gray-700 truncate">
        {shortenTitle(state.title)}
      </div>

      {/* Position */}
      {position && (
        <div className="mb-2 pb-2 border-b border-gray-600">
          <div className="text-[10px] text-gray-500 mb-0.5">Position:</div>
          <div className="text-[11px]">
            <span className={isYes ? 'text-green-400' : 'text-red-400'}>
              {fmtSz(position.size)} {isYes ? 'YES' : 'NO'}
            </span>
            {position.avgPrice != null && (
              <span className="text-gray-400"> @ {(position.avgPrice * 100).toFixed(1)}¢</span>
            )}
          </div>
          {position.avgPrice != null && (
            <div className="text-[10px] text-gray-400">
              Cost: ${(position.avgPrice * position.size).toFixed(2)}
            </div>
          )}
        </div>
      )}

      {/* Orders */}
      {tokenOrders.length > 0 && (
        <div className="mb-2 pb-2 border-b border-gray-600">
          <div className="text-[10px] text-gray-500 mb-0.5">Orders:</div>
          {tokenOrders.map((o) => {
            const pr = (parseFloat(o.price) * 100).toFixed(1);
            const sz = Math.round(parseFloat(o.original_size || o.size));
            const val = (parseFloat(o.price) * parseFloat(o.original_size || o.size)).toFixed(2);
            const color = o.side === 'BUY' ? 'text-green-400' : 'text-red-400';
            return (
              <div key={o.id} className={`text-[11px] ${color}`}>
                {o.side} {isYes ? 'YES' : 'NO'} {sz} @ {pr}¢ (${val})
              </div>
            );
          })}
        </div>
      )}

      {/* BS Flower */}
      {state.asset && state.strike && (
        <div className="mb-2 pb-2 border-b border-gray-600">
          <BsFlower asset={state.asset} strike={state.strike} endDate={state.endDate} isYes={isYes} />
        </div>
      )}

      {state.loading && (
        <div className="text-xs text-gray-500">Loading orderbook...</div>
      )}

      {state.error && (
        <div className="text-xs text-red-400">Failed to load orderbook</div>
      )}

      {!state.loading && !state.error && (
        <>
          {/* Header */}
          <div className="grid gap-0.5 text-[10px] text-gray-500 mb-1" style={{ gridTemplateColumns: '50px 50px 50px 50px' }}>
            <span>Bid</span>
            <span className="text-right">Size</span>
            <span>Ask</span>
            <span className="text-right">Size</span>
          </div>

          {/* Rows */}
          {state.bids.length === 0 && state.asks.length === 0 ? (
            <div className="text-xs text-gray-500 text-center py-2">No orders in book</div>
          ) : (
            Array.from({ length: maxRows }, (_, i) => {
              const bid = state.bids[i];
              const ask = state.asks[i];
              const bidPrice = bid ? (parseFloat(bid.price) * 100).toFixed(1) : '';
              const askPrice = ask ? (parseFloat(ask.price) * 100).toFixed(1) : '';
              const bidHl = bidPrice && userBidPrices.has(bidPrice) ? 'bg-blue-900/50 font-bold' : '';
              const askHl = askPrice && userAskPrices.has(askPrice) ? 'bg-orange-900/50 font-bold' : '';
              return (
                <div key={i} className="grid gap-0.5" style={{ gridTemplateColumns: '50px 50px 50px 50px', fontSize: 11, padding: '1px 0' }}>
                  {bid ? (
                    <>
                      <span className={`text-green-400 ${bidHl}`}>{bidPrice}¢</span>
                      <span className={`text-green-400 text-right ${bidHl}`}>{parseFloat(bid.size).toFixed(0)}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-600">-</span>
                      <span className="text-gray-600 text-right">-</span>
                    </>
                  )}
                  {ask ? (
                    <>
                      <span className={`text-red-400 ${askHl}`}>{askPrice}¢</span>
                      <span className={`text-red-400 text-right ${askHl}`}>{parseFloat(ask.size).toFixed(0)}</span>
                    </>
                  ) : (
                    <>
                      <span className="text-gray-600">-</span>
                      <span className="text-gray-600 text-right">-</span>
                    </>
                  )}
                </div>
              );
            })
          )}
        </>
      )}
    </div>
  );
}
