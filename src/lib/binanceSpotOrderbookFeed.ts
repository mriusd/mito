import { useSyncExternalStore } from 'react';
import {
  normalizeBinanceSpotBook,
  parseBinanceObLevels,
  type BinanceSpotBook,
} from './binanceSpotObImpact';

export const BINANCE_SPOT_OB_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
export type BinanceSpotObAsset = (typeof BINANCE_SPOT_OB_ASSETS)[number];
export type BinanceObMarket = 'spot' | 'futures';

const SYMBOL_BY_ASSET: Record<BinanceSpotObAsset, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
};

const DEPTH_URL: Record<BinanceObMarket, string> = {
  spot: 'https://api.binance.com/api/v3/depth',
  futures: 'https://fapi.binance.com/fapi/v1/depth',
};

const DEPTH_LIMIT = 500;
const POLL_MS = 1000;

export { DEPTH_LIMIT };

type BooksSnap = Record<BinanceSpotObAsset, BinanceSpotBook | null>;

const EMPTY_BOOKS: BooksSnap = { BTC: null, ETH: null, SOL: null, XRP: null };

const MARKETS: BinanceObMarket[] = ['spot', 'futures'];

let booksByMarket: Record<BinanceObMarket, BooksSnap> = {
  spot: { ...EMPTY_BOOKS },
  futures: { ...EMPTY_BOOKS },
};
let digestByMarket: Record<BinanceObMarket, number> = { spot: 0, futures: 0 };
let refCountByMarket: Record<BinanceObMarket, number> = { spot: 0, futures: 0 };
const listenersByMarket: Record<BinanceObMarket, Set<() => void>> = {
  spot: new Set(),
  futures: new Set(),
};

let pollTimer: number | null = null;
let pollInFlight = false;

function emit(market: BinanceObMarket): void {
  digestByMarket[market] += 1;
  for (const fn of listenersByMarket[market]) fn();
}

function activeMarkets(): BinanceObMarket[] {
  return MARKETS.filter((m) => refCountByMarket[m] > 0);
}

function applyBook(market: BinanceObMarket, asset: BinanceSpotObAsset, payload: { bids?: unknown; asks?: unknown }): void {
  const next = normalizeBinanceSpotBook(parseBinanceObLevels(payload.bids), parseBinanceObLevels(payload.asks));
  if (!next) return;
  booksByMarket = { ...booksByMarket, [market]: { ...booksByMarket[market], [asset]: next } };
  emit(market);
}

async function fetchDepth(market: BinanceObMarket, asset: BinanceSpotObAsset): Promise<void> {
  const symbol = SYMBOL_BY_ASSET[asset];
  const resp = await fetch(`${DEPTH_URL[market]}?symbol=${symbol}&limit=${DEPTH_LIMIT}`);
  if (!resp.ok) {
    throw new Error(`Binance ${market} depth ${symbol} HTTP ${resp.status}`);
  }
  const data = (await resp.json()) as { bids?: unknown; asks?: unknown };
  applyBook(market, asset, data);
}

async function pollAll(): Promise<void> {
  const markets = activeMarkets();
  if (markets.length === 0 || pollInFlight) return;
  pollInFlight = true;
  try {
    await Promise.all(markets.flatMap((market) => BINANCE_SPOT_OB_ASSETS.map((asset) => fetchDepth(market, asset))));
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

function subscribeSpot(onStoreChange: () => void): () => void {
  return subscribeBinanceObOrderbooks('spot', onStoreChange);
}

function subscribeFutures(onStoreChange: () => void): () => void {
  return subscribeBinanceObOrderbooks('futures', onStoreChange);
}

function getSpotBooks(): BooksSnap {
  return booksByMarket.spot;
}

function getFuturesBooks(): BooksSnap {
  return booksByMarket.futures;
}

const SUBSCRIBE_BY_MARKET: Record<BinanceObMarket, (onStoreChange: () => void) => () => void> = {
  spot: subscribeSpot,
  futures: subscribeFutures,
};

const GET_BOOKS_BY_MARKET: Record<BinanceObMarket, () => BooksSnap> = {
  spot: getSpotBooks,
  futures: getFuturesBooks,
};

export function subscribeBinanceObOrderbooks(market: BinanceObMarket, onStoreChange: () => void): () => void {
  listenersByMarket[market].add(onStoreChange);
  refCountByMarket[market] += 1;
  if (refCountByMarket.spot + refCountByMarket.futures === 1) connect();
  return () => {
    listenersByMarket[market].delete(onStoreChange);
    refCountByMarket[market] -= 1;
    if (refCountByMarket.spot + refCountByMarket.futures === 0) {
      disconnect();
      booksByMarket = { spot: { ...EMPTY_BOOKS }, futures: { ...EMPTY_BOOKS } };
      digestByMarket = { spot: digestByMarket.spot + 1, futures: digestByMarket.futures + 1 };
    }
  };
}

export function getBinanceObOrderbooksSnapshot(market: BinanceObMarket): { digest: number; books: BooksSnap } {
  return { digest: digestByMarket[market], books: booksByMarket[market] };
}

export function useBinanceObOrderbooks(market: BinanceObMarket): BooksSnap {
  return useSyncExternalStore(SUBSCRIBE_BY_MARKET[market], GET_BOOKS_BY_MARKET[market], () => EMPTY_BOOKS);
}
