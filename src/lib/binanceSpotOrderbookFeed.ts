import { useSyncExternalStore } from 'react';
import {
  normalizeBinanceSpotBook,
  parseBinanceObLevels,
  type BinanceSpotBook,
} from './binanceSpotObImpact';

export const BINANCE_SPOT_OB_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
export type BinanceSpotObAsset = (typeof BINANCE_SPOT_OB_ASSETS)[number];

const SYMBOL_BY_ASSET: Record<BinanceSpotObAsset, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
};

const DEPTH_LIMIT = 500;
const POLL_MS = 1000;

export { DEPTH_LIMIT };

type BooksSnap = Record<BinanceSpotObAsset, BinanceSpotBook | null>;

const EMPTY_BOOKS: BooksSnap = { BTC: null, ETH: null, SOL: null, XRP: null };

let books: BooksSnap = { ...EMPTY_BOOKS };
let digest = 0;
let refCount = 0;
let pollTimer: number | null = null;
let pollInFlight = false;
const listeners = new Set<() => void>();

function emit(): void {
  digest += 1;
  for (const fn of listeners) fn();
}

function applyBook(asset: BinanceSpotObAsset, payload: { bids?: unknown; asks?: unknown }): void {
  const next = normalizeBinanceSpotBook(parseBinanceObLevels(payload.bids), parseBinanceObLevels(payload.asks));
  if (!next) return;
  books = { ...books, [asset]: next };
  emit();
}

async function fetchDepth(asset: BinanceSpotObAsset): Promise<void> {
  const symbol = SYMBOL_BY_ASSET[asset];
  const resp = await fetch(`https://api.binance.com/api/v3/depth?symbol=${symbol}&limit=${DEPTH_LIMIT}`);
  if (!resp.ok) {
    throw new Error(`Binance depth ${symbol} HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as { bids?: unknown; asks?: unknown };
  applyBook(asset, data);
}

async function pollAll(): Promise<void> {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    await Promise.all(BINANCE_SPOT_OB_ASSETS.map((asset) => fetchDepth(asset)));
  } finally {
    pollInFlight = false;
  }
}

function connect(): void {
  if (pollTimer != null) return;
  void pollAll();
  pollTimer = window.setInterval(() => {
    void pollAll();
  }, POLL_MS);
}

function disconnect(): void {
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
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
