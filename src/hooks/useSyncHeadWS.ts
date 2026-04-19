import { useEffect, useState } from 'react';
import { WS_BASE } from '../lib/env';

export type SyncHeadState = {
  lastProcessedBlock: number;
  chainHeadBlock: number;
  behindBlocks: number;
};

/**
 * Live kv_store last_processed_block + chain tip from backend (/ws/sync-head).
 */
export function useSyncHeadWS(): SyncHeadState | null {
  const [state, setState] = useState<SyncHeadState | null>(null);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let stopped = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      try {
        ws = new WebSocket(`${WS_BASE}/ws/sync-head`);
      } catch {
        reconnectTimer = setTimeout(connect, 2500);
        return;
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as {
            type?: string;
            data?: {
              lastProcessedBlock?: number;
              chainHeadBlock?: number;
              behindBlocks?: number;
            };
          };
          if (msg.type !== 'syncHead' || !msg.data) return;
          const last = Number(msg.data.lastProcessedBlock) || 0;
          const tip = Number(msg.data.chainHeadBlock) || 0;
          const behind = Number(msg.data.behindBlocks);
          setState({
            lastProcessedBlock: last,
            chainHeadBlock: tip,
            behindBlocks: Number.isFinite(behind) ? behind : 0,
          });
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
        if (stopped) return;
        reconnectTimer = setTimeout(connect, 2500);
      };
    };

    connect();

    return () => {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return state;
}
