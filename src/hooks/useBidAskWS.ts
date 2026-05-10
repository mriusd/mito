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
    if ((prev as any)[k] !== (next as any)[k]) return false;
  }
  return true;
}

function mergeWsItemOntoMarket(seed: Market | undefined, item: any): Market {
  const bestBid = item.bestBid ?? 0;
  const bestAsk = item.bestAsk ?? 0;
  const next = seed
    ? {
        ...seed,
        bestBid,
        bestAsk,
      }
    : ({
        id: item.assetId,
        clobTokenIds: [item.assetId],
        question: '',
        endDate: '',
        bestBid,
        bestAsk,
      } as Market);
  const v = item.usdcVolume ?? item.volume;
  if (typeof v === 'number' && Number.isFinite(v)) {
    next.volume = v;
  }
  if (typeof item.sharesInExistence === 'number' && Number.isFinite(item.sharesInExistence)) {
    next.sharesInExistence = item.sharesInExistence;
  }
  if (typeof item.marketNetDirection === 'number' && Number.isFinite(item.marketNetDirection)) {
    next.marketNetDirection = item.marketNetDirection;
  }
  if (typeof item.holders === 'number' && Number.isFinite(item.holders)) {
    next.holders = item.holders;
  }
  if (typeof item.smartMoneyBias === 'number' && Number.isFinite(item.smartMoneyBias)) {
    next.smartMoneyBias = item.smartMoneyBias;
  }
  if (typeof item.provenSMS === 'number' && Number.isFinite(item.provenSMS)) {
    next.provenSMS = item.provenSMS;
  }
  if (typeof item.crowdBias === 'number' && Number.isFinite(item.crowdBias)) {
    next.crowdBias = item.crowdBias;
  }
  if (typeof item.liveBias === 'number' && Number.isFinite(item.liveBias)) {
    next.liveBias = item.liveBias;
  }
  if (typeof item.liveBiasWindowMin === 'number' && item.liveBiasWindowMin > 0) {
    next.liveBiasWindowMin = item.liveBiasWindowMin;
  }
  if (typeof item.concentration === 'number' && Number.isFinite(item.concentration)) {
    next.concentration = item.concentration;
  }
  if (typeof item.winnerBias === 'number' && Number.isFinite(item.winnerBias)) {
    next.winnerBias = item.winnerBias;
  }
  if (typeof item.winnerBiasYesWR === 'number' && Number.isFinite(item.winnerBiasYesWR)) {
    next.winnerBiasYesWR = item.winnerBiasYesWR;
  }
  if (typeof item.winnerBiasNoWR === 'number' && Number.isFinite(item.winnerBiasNoWR)) {
    next.winnerBiasNoWR = item.winnerBiasNoWR;
  }
  if (typeof item.winBiasShares === 'number' && Number.isFinite(item.winBiasShares)) {
    next.winBiasShares = item.winBiasShares;
  }
  if (typeof item.winBiasSharesYes === 'number' && Number.isFinite(item.winBiasSharesYes)) {
    next.winBiasSharesYes = item.winBiasSharesYes;
  }
  if (typeof item.winBiasSharesNo === 'number' && Number.isFinite(item.winBiasSharesNo)) {
    next.winBiasSharesNo = item.winBiasSharesNo;
  }
  if (typeof item.winnerBiasConviction === 'number' && Number.isFinite(item.winnerBiasConviction)) {
    next.winnerBiasConviction = item.winnerBiasConviction;
  }
  if (typeof item.winnerBiasConvictionYesWR === 'number' && Number.isFinite(item.winnerBiasConvictionYesWR)) {
    next.winnerBiasConvictionYesWR = item.winnerBiasConvictionYesWR;
  }
  if (typeof item.winnerBiasConvictionNoWR === 'number' && Number.isFinite(item.winnerBiasConvictionNoWR)) {
    next.winnerBiasConvictionNoWR = item.winnerBiasConvictionNoWR;
  }
  if (typeof item.winBiasConvictionShares === 'number' && Number.isFinite(item.winBiasConvictionShares)) {
    next.winBiasConvictionShares = item.winBiasConvictionShares;
  }
  if (typeof item.winBiasConvictionSharesYes === 'number' && Number.isFinite(item.winBiasConvictionSharesYes)) {
    next.winBiasConvictionSharesYes = item.winBiasConvictionSharesYes;
  }
  if (typeof item.winBiasConvictionSharesNo === 'number' && Number.isFinite(item.winBiasConvictionSharesNo)) {
    next.winBiasConvictionSharesNo = item.winBiasConvictionSharesNo;
  }
  if (typeof item.stakedUsdYesLeg === 'number' && Number.isFinite(item.stakedUsdYesLeg)) {
    next.stakedUsdYesLeg = item.stakedUsdYesLeg;
  }
  if (typeof item.stakedUsdNoLeg === 'number' && Number.isFinite(item.stakedUsdNoLeg)) {
    next.stakedUsdNoLeg = item.stakedUsdNoLeg;
  }
  if (typeof item.stakedSumAbsSignedNetUsd === 'number' && Number.isFinite(item.stakedSumAbsSignedNetUsd)) {
    next.stakedSumAbsSignedNetUsd = item.stakedSumAbsSignedNetUsd;
  }
  if (typeof item.stakedTopHoldersCohortYesUsd === 'number' && Number.isFinite(item.stakedTopHoldersCohortYesUsd)) {
    next.stakedTopHoldersCohortYesUsd = item.stakedTopHoldersCohortYesUsd;
  }
  if (typeof item.stakedTopHoldersCohortNoUsd === 'number' && Number.isFinite(item.stakedTopHoldersCohortNoUsd)) {
    next.stakedTopHoldersCohortNoUsd = item.stakedTopHoldersCohortNoUsd;
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
        return { marketLookup: merged, bidAskTick: state.bidAskTick + 1 };
      });
    }

    function scheduleBidAskFlush() {
      if (flushRafRef.current !== null) return;
      flushRafRef.current = requestAnimationFrame(() => flushPendingBidAsk());
    }

    function enqueueBidAskPatches(items: any[]) {
      const lookup = useAppStore.getState().marketLookup;
      const pending = pendingPatchRef.current;
      for (const item of items) {
        if (!item.assetId) continue;
        const id = item.assetId;
        const seed = pending[id] ?? lookup[id];
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
            enqueueBidAskPatches(msg.data);
          } else if (msg.type === 'bidAskUpDown' && msg.data && typeof msg.data === 'object') {
            enqueueBidAskPatches([msg.data]);
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
