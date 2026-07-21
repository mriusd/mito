import { useEffect, useRef, useState } from 'react';
import { WS_BASE } from '../lib/env';
import { backendWsRetryDelayMs, markBackendDownFromWs, markBackendWsUp } from '../lib/fetchBackend';
import { onBackendReconnect } from '../lib/backendReconnect';

export type SyncHeadState = {
  lastProcessedBlock: number;
  chainHeadBlock: number;
  behindBlocks: number;
  startupSync: boolean;
  startupPhase: string;
  startupBatchLo: number;
  startupBatchHi: number;
};

function syncHeadEqual(a: SyncHeadState | null, b: SyncHeadState): boolean {
  if (!a) return false;
  return (
    a.lastProcessedBlock === b.lastProcessedBlock &&
    a.chainHeadBlock === b.chainHeadBlock &&
    a.behindBlocks === b.behindBlocks &&
    a.startupSync === b.startupSync &&
    a.startupPhase === b.startupPhase &&
    a.startupBatchLo === b.startupBatchLo &&
    a.startupBatchHi === b.startupBatchHi
  );
}

/**
 * Live kv_store last_processed_block + chain tip from backend (/ws/sync-head).
 */
export function useSyncHeadWS(): SyncHeadState | null {
  const [state, setState] = useState<SyncHeadState | null>(null);
  const stateRef = useRef<SyncHeadState | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const clearReconnect = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const teardownSocket = () => {
      if (!ws) return;
      const sock = ws;
      ws = null;
      sock.onclose = null;
      sock.onerror = null;
      sock.onmessage = null;
      try {
        sock.close();
      } catch {
        /* ignore */
      }
    };

    const connect = () => {
      if (stopped) return;
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
      clearReconnect();
      teardownSocket();
      try {
        ws = new WebSocket(`${WS_BASE}/ws/sync-head`);
      } catch {
        markBackendDownFromWs();
        reconnectTimer = setTimeout(connect, backendWsRetryDelayMs(2500));
        return;
      }

      ws.onopen = () => {
        markBackendWsUp();
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as {
            type?: string;
            data?: {
              lastProcessedBlock?: number;
              chainHeadBlock?: number;
              behindBlocks?: number;
              startupSync?: boolean;
              startupPhase?: string;
              startupBatchLo?: number;
              startupBatchHi?: number;
            };
          };
          if (msg.type !== 'syncHead' || !msg.data) return;
          const last = Number(msg.data.lastProcessedBlock) || 0;
          const tip = Number(msg.data.chainHeadBlock) || 0;
          const behind = Number(msg.data.behindBlocks);
          const next: SyncHeadState = {
            lastProcessedBlock: last,
            chainHeadBlock: tip,
            behindBlocks: Number.isFinite(behind) ? behind : 0,
            startupSync: msg.data.startupSync === true,
            startupPhase: String(msg.data.startupPhase ?? '').trim(),
            startupBatchLo: Number(msg.data.startupBatchLo) || 0,
            startupBatchHi: Number(msg.data.startupBatchHi) || 0,
          };
          if (syncHeadEqual(stateRef.current, next)) return;
          stateRef.current = next;
          setState(next);
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {
        try {
          ws?.close();
        } catch {
          /* ignore */
        }
      };

      ws.onclose = () => {
        ws = null;
        if (stopped) return;
        markBackendDownFromWs();
        clearReconnect();
        reconnectTimer = setTimeout(connect, backendWsRetryDelayMs(2500));
      };
    };

    connect();

    const offReconnect = onBackendReconnect(() => {
      if (stopped) return;
      clearReconnect();
      teardownSocket();
      connect();
    });

    return () => {
      stopped = true;
      offReconnect();
      clearReconnect();
      teardownSocket();
    };
  }, []);

  return state;
}
