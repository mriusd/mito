import { useState, useEffect, useRef } from 'react';
import { fetchOrderbook } from '../api';
import { OrderbookPopupPanel, type OBEntry } from './OrderbookPopupPanel';

interface PopupState {
  visible: boolean;
  x: number;
  y: number;
  tokenId: string;
  title: string;
  asset: string;
  strike: string;
  endDate: string;
  isYes: boolean;
  bids: OBEntry[];
  asks: OBEntry[];
  loading: boolean;
  error: boolean;
}

const obCache: Record<string, { data: { bids: OBEntry[]; asks: OBEntry[] }; time: number }> = {};
function pruneCache() {
  const keys = Object.keys(obCache);
  if (keys.length > 50) {
    keys.sort((a, b) => obCache[a].time - obCache[b].time);
    for (let i = 0; i < keys.length - 50; i++) delete obCache[keys[i]];
  }
}

export function OrderbookPopup() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);

  const [state, setState] = useState<PopupState>({
    visible: false,
    x: 0,
    y: 0,
    tokenId: '',
    title: '',
    asset: '',
    strike: '',
    endDate: '',
    isYes: true,
    bids: [],
    asks: [],
    loading: false,
    error: false,
  });
  const hoverRef = useRef<HTMLElement | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (isMobile && state.visible) {
      setState((s) => ({ ...s, visible: false }));
    }
  }, [isMobile, state.visible]);

  useEffect(() => {
    if (isMobile) return;

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
        const popupWidth = 250;
        const x = Math.min(rect.right + 10, window.innerWidth - popupWidth - 10);
        const y = Math.max(10, rect.top - 100);
        const title = trigger.dataset.marketTitle || 'Orderbook';
        const bsAsset = trigger.dataset.asset || '';
        const bsStrike = trigger.dataset.strike || '';
        const bsEndDate = trigger.dataset.endDate || '';
        const isYes = title.includes('(YES)') || title.includes('(UP)');

        setState((s) => ({
          ...s,
          visible: true,
          x,
          y,
          tokenId,
          title,
          asset: bsAsset,
          strike: bsStrike,
          endDate: bsEndDate,
          isYes,
          loading: true,
          error: false,
          bids: [],
          asks: [],
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
            setState((s) => ({ ...s, bids, asks, loading: false }));
          }
        } catch {
          if (hoverRef.current === trigger) {
            setState((s) => ({ ...s, loading: false, error: true }));
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
      setState((s) => ({ ...s, visible: false }));
    };

    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
    return () => {
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseout', handleMouseOut);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [isMobile]);

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
  }, [state.visible, state.bids, state.asks]);

  if (!state.visible || isMobile) return null;

  return (
    <OrderbookPopupPanel
      ref={popupRef}
      className="fixed z-[60100] bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 pointer-events-none"
      style={{ left: state.x, top: state.y, minWidth: 220, maxWidth: 250, maxHeight: '80vh', overflowY: 'auto', fontSize: 11 }}
      title={state.title}
      tokenId={state.tokenId}
      isYes={state.isYes}
      asset={state.asset}
      strike={state.strike}
      endDate={state.endDate}
      bids={state.bids}
      asks={state.asks}
      loading={state.loading}
      error={state.error}
    />
  );
}
