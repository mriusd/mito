/**
 * Build a candle-hover CEX OB snapshot from the live Binance/OKX spot+futures
 * orderbook feeds (same sources as SpotOrderbookPanel).
 *
 * Candle REST klines often have empty `cex_ob` (even non-slim); sidebar charts
 * usually get it from chart-WS patches on *active* candle-target tokens only.
 * Wallet-info charts frequently view other tokens — use the asset-level live books.
 */
import {
  BINANCE_SPOT_OB_ASSETS,
  getBinanceObPanelSnapshot,
  type BinanceObAssetPanel,
  type BinanceSpotObAsset,
} from './binanceSpotOrderbookFeed';
import { getOkxObPanelSnapshot } from './okxSpotOrderbookFeed';
import type { CexObAssetPanel, CexObCandleSnapshot, CexObExchangePanels } from './cexObSnapshot';

function toCexPanel(p: BinanceObAssetPanel | null | undefined): CexObAssetPanel | null {
  if (!p) return null;
  if (p.mid == null && p.up.length === 0 && p.down.length === 0) return null;
  return {
    synced: p.synced === true,
    mid: p.mid,
    up: p.up.map((c) => ({ pct: c.pct, usd: c.usd, capped: c.capped === true })),
    down: p.down.map((c) => ({ pct: c.pct, usd: c.usd, capped: c.capped === true })),
  };
}

function exchangePanels(
  bin: BinanceObAssetPanel | null | undefined,
  okx: BinanceObAssetPanel | null | undefined,
): CexObExchangePanels | null {
  const binance = toCexPanel(bin);
  const okxPanel = toCexPanel(okx);
  if (!binance && !okxPanel) return null;
  return { binance, okx: okxPanel };
}

export function isLiveCexObAsset(asset: string | null | undefined): asset is BinanceSpotObAsset {
  const a = String(asset || '').trim().toUpperCase();
  return (BINANCE_SPOT_OB_ASSETS as readonly string[]).includes(a);
}

/** Live CEX OB for hover — null when asset unsupported or books not synced yet. */
export function buildLiveCexObSnapshot(asset: string | null | undefined): CexObCandleSnapshot | null {
  const a = String(asset || '').trim().toUpperCase();
  if (!isLiveCexObAsset(a)) return null;

  const binSpot = getBinanceObPanelSnapshot('spot')?.assets[a] ?? null;
  const binFut = getBinanceObPanelSnapshot('futures')?.assets[a] ?? null;
  const okxSpot = getOkxObPanelSnapshot('spot')?.assets[a] ?? null;
  const okxFut = getOkxObPanelSnapshot('futures')?.assets[a] ?? null;

  const spot = exchangePanels(binSpot, okxSpot);
  const futures = exchangePanels(binFut, okxFut);
  if (!spot && !futures) return null;

  const updatedAt = Math.max(
    getBinanceObPanelSnapshot('spot')?.updatedAt ?? 0,
    getBinanceObPanelSnapshot('futures')?.updatedAt ?? 0,
    getOkxObPanelSnapshot('spot')?.updatedAt ?? 0,
    getOkxObPanelSnapshot('futures')?.updatedAt ?? 0,
  );

  return {
    asset: a,
    updatedAt,
    spot,
    futures,
  };
}
