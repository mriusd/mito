/** Shared onchain WS types — kept out of useOnchainTradesWS to avoid circular imports with sidebarOnchainTradesStore. */

export interface WSPosition {
  tokenId: string;
  size: number;
  avgPrice: number;
  feesPaid?: number;
  title?: string;
  slug?: string;
  eventSlug?: string;
  marketId?: string;
  outcome?: string;
  endDate?: string;
  underlyingAsset?: string;
}

export interface WSTrade {
  /** Stable dedupe key — set once at ingest. */
  id?: string;
  /** Mempool overlay — superseded by ledger row with same txHash. */
  pending?: boolean;
  /** true = LIMIT/approx price from calldata fast path; replaced by trace broadcast. */
  priceApproximate?: boolean;
  tokenId: string;
  /** Condition id when known */
  marketId?: string;
  side: 'BUY' | 'SELL' | 'SPLIT' | 'MERGE' | 'REDEEM';
  outcome?: string;
  size: number;
  price: number;
  fee: number;
  deltaUsd?: number;
  isTaker?: boolean;
  blockTime: number;
  txHash?: string;
  /** Same tx can have multiple OrderFilled logs — required for dedupe. */
  logIndex?: number;
  title?: string;
  slug?: string;
  eventSlug?: string;
}

export type WalletPnlDayBucket = { bought: number; sold: number };
export type WalletPnlByDate = Record<string, WalletPnlDayBucket>;
export type WalletPnlCategory = 'CRYPTO' | 'WEATHER' | 'OTHER';

export type WalletPnlDailyWS = {
  from: string;
  to: string;
  tradeByDate: WalletPnlByDate;
  marketByDate: WalletPnlByDate;
  /** Present after polycandles deploy — per Crypto/Weather/Other day buckets. */
  tradeByDateByCategory?: Partial<Record<WalletPnlCategory, WalletPnlByDate>>;
  marketByDateByCategory?: Partial<Record<WalletPnlCategory, WalletPnlByDate>>;
};
