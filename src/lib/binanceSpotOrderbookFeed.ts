import { useSyncExternalStore } from 'react';
import {
  normalizeBinanceSpotBook,
  parseBinanceObLevels,
  type BinanceSpotBook,
} from './binanceSpotObImpact';

export const BINANCE_SPOT_OB_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
export type BinanceSpotObAsset = (typeof BINANCE_SPOT_OB_ASSETS)[number];

const BINANCE_SPOT_WS = 'wss://stream.binance.com:9443/stream?streams=btcusdt@depth20@100ms/ethusdt@depth20@100ms/solusdt@depth20@100ms/xrpusdt@depth20@100ms';

const ASSET_BY_STREAM: Record<string, BinanceSpotObAsset> = {
  btcusdt: 'BTC',
  ethusdt: 'ETH',
  solusdt: 'SOL',
  xrpusdt: 'XRP',
};

type BooksSnap = Record<BinanceSpotObAsset, BinanceSpotBook | null>;

const EMPTY_BOOKS: BooksSnap = { BTC: null, ETH: null, SOL: null, XRP: null };

let books: BooksSnap = { ...EMPTY_BOOKS };
let digest = 0;
let ws: WebSocket | null = null;
let refCount = 0;
let reconnectTimer: number | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  digest += 1;
  for (const fn of listeners) fn();
}

function parseStreamAsset(stream: string): BinanceSpotObAsset | null {
  const key = stream.split('@')[0]?.toLowerCase() ?? '';
  return ASSET_BY_STREAM[key] ?? null;
}

function applyDepthMessage(asset: BinanceSpotObAsset, payload: { bids?: unknown; asks?: unknown }): void {
  const next = normalizeBinanceSpotBook(parseBinanceObLevels(payload.bids), parseBinanceObLevels(payload.asks));
  if (!next) return;
  books = { ...books, [asset]: next };
  emit();
}

function connect(): void {
  if (ws) return;
  ws = new WebSocket(BINANCE_SPOT_WS);
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as { stream?: string; data?: { bids?: unknown; asks?: unknown } };
      const stream = String(msg.stream ?? '');
      const asset = parseStreamAsset(stream);
      if (!asset || !msg.data) return;
      applyDepthMessage(asset, msg.data);
    } catch {
      /* ignore malformed frame */
    }
  };
  ws.onclose = () => {
    ws = null;
    if (refCount > 0) {
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, 1500);
    }
  };
  ws.onerror = () => {
    ws?.close();
  };
}

function disconnect(): void {
  if (reconnectTimer != null) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  ws?.close();
  ws = null;
}

export function subscribeBinanceSpotOrderbooks(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  refCount += 1;
  if (refCount === 1) connect();
  return () => {
    listeners.delete(onStoreChange);
    refCount -= 1;
    if (refCount === 0) {
      disconnect();
      books = { ...EMPTY_BOOKS };
      digest += 1;
      emit();
    }
  };
}

export function getBinanceSpotOrderbooksSnapshot(): { digest: number; books: BooksSnap } {
  return { digest, books };
}

export function useBinanceSpotOrderbooks(): BooksSnap {
  return useSyncExternalStore(
    subscribeBinanceSpotOrderbooks,
    () => getBinanceSpotOrderbooksSnapshot().books,
    () => EMPTY_BOOKS,
  );
}
