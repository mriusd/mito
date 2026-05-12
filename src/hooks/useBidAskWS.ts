import { useEffect, useRef } from 'react';
import type { Market } from '../types';
import { useAppStore } from '../stores/appStore';
import { WS_BASE } from '../lib/env';

/** Fields bid/ask WS batches can materially change vs prior store row — cheap equality gate. */
const BIDASK_EQ_KEYS: (keyof Market)[] = [
  'bestBid',
  'bestAsk',
  'volume',
  'sharesInExistence',
  'marketNetDirection',
  'holders',
  'smartMoneyBias',
  'provenSMS',
  'crowdBias',
  'liveBias',
  'liveBiasWindowMin',
  'concentration',
  'winnerBias',
  'winnerBiasYesWR',
  'winnerBiasNoWR',
  'winBiasShares',
  'winBiasSharesYes',
  'winBiasSharesNo',
  'winnerBiasConviction',
  'winnerBiasConvictionYesWR',
  'winnerBiasConvictionNoWR',
  'winBiasConvictionShares',
  'winBiasConvictionSharesYes',
  'winBiasConvictionSharesNo',
  'stakedUsdYesLeg',
  'stakedUsdNoLeg',
  'stakedSumAbsSignedNetUsd',
  'stakedTopHoldersCohortYesUsd',
  'stakedTopHoldersCohortNoUsd',
];

export function bidAskWsRowEqual(prev: Market | undefined | null, next: Market | undefined | null): boolean {
  if (prev === next) return true;
  if (!prev || !next) return false;
  for (const k of BIDASK_EQ_KEYS) {
    if (prev[k] !== next[k]) return false;
  }
  return true;
}

/** Partial row from `/ws/chart` bid/ask batches — keys overlap `Market`. */
type BidAskWsItem = Record<string, unknown> & {
  assetId?: string;
  bestBid?: number;
  bestAsk?: number;
  usdcVolume?: number;
  volume?: number;
};

function mergeWsItemOntoMarket(seed: Market, item: BidAskWsItem): Market {
  const bestBid = item.bestBid ?? 0;
  const bestAsk = item.bestAsk ?? 0;
  const next: Market = {
    ...seed,
    bestBid,
    bestAsk,
  };
  for (const key of BIDASK_EQ_KEYS) {
    if (key === 'bestBid' || key === 'bestAsk') continue;
    const v = item[key as string];
    if (key === 'liveBiasWindowMin') {
      if (typeof v === 'number' && v > 0) next.liveBiasWindowMin = v;
      continue;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      (next as unknown as Record<string, unknown>)[key as string] = v;
    }
  }
  const vol = item.usdcVolume ?? item.volume;
  if (typeof vol === 'number' && Number.isFinite(vol)) {
    next.volume = vol;
  }
  return next;
}

export function useBidAskWS() {
  const wsRef = useRef<WebSocket | null>(null);
  const pendingPatchRef = useRef<Record<string, Market>>({});
  const flushRafRef = useRef<number | null>(null);

  useEffect(() => {
    let pingIv: ReturnType<typeof setInterval>;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    function flushPendingBidAsk() {
      flushRafRef.current = null;
      const snapshot = pendingPatchRef.current;
      pendingPatchRef.current = {};
      const ids = Object.keys(snapshot);
      if (ids.length === 0) return;

      useAppStore.setState((state) => {
        const lookup = state.marketLookup;
        let merged = lookup;
        let bumped = false;
        for (const id of ids) {
          const next = snapshot[id];
          const baseline = lookup[id];
          if (bidAskWsRowEqual(baseline, next)) continue;
          if (merged === lookup) merged = { ...lookup };
          merged[id] = next;
          bumped = true;
        }
        if (!bumped) return {};
        return { marketLookup: merged, marketLookupEpoch: state.marketLookupEpoch + 1 };
      });
    }

    function scheduleBidAskFlush() {
      if (flushRafRef.current !== null) return;
      flushRafRef.current = requestAnimationFrame(() => flushPendingBidAsk());
    }

    function enqueueBidAskPatches(items: BidAskWsItem[]) {
      const lookup = useAppStore.getState().marketLookup;
      const pending = pendingPatchRef.current;
      for (const item of items) {
        if (!item.assetId) continue;
        const id = item.assetId;
        /** Skip unknown assetIds — adding stubs grew marketLookup unbounded across the session and pumped re-renders for non-existent markets. */
        const seed = pending[id] ?? lookup[id];
        if (!seed) continue;
        const next = mergeWsItemOntoMarket(seed, item);
        if (bidAskWsRowEqual(lookup[id], next)) {
          delete pending[id];
          continue;
        }
        pending[id] = next;
      }
      if (Object.keys(pending).length > 0) scheduleBidAskFlush();
    }

    function connect() {
      const ws = new WebSocket(`${WS_BASE}/ws/chart`);
      wsRef.current = ws;

      ws.onopen = () => {
        pingIv = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
        }, 30000);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'bidAskBatch' && Array.isArray(msg.data)) {
            enqueueBidAskPatches(msg.data as BidAskWsItem[]);
          } else if (msg.type === 'bidAskUpDown' && msg.data && typeof msg.data === 'object') {
            enqueueBidAskPatches([msg.data as BidAskWsItem]);
          }
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        clearInterval(pingIv);
        reconnectTimeout = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearInterval(pingIv);
      clearTimeout(reconnectTimeout);
      if (flushRafRef.current !== null) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
      pendingPatchRef.current = {};
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);
}
