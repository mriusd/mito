import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { getMarketProbability } from '../utils/bsMath';
import type { AssetSymbol, Market, Signal, ArbOpportunity } from '../types';

const GRID_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;

// --- Orderbook cache (30s) ---
interface OBEntry { price: number; size: number; }
interface OBBook { bids: OBEntry[]; asks: OBEntry[]; }
const arbOBCache: Record<string, { data: OBBook; time: number }> = {};

async function fetchArbOrderbook(tokenId: string): Promise<OBBook> {
  const cached = arbOBCache[tokenId];
  if (cached && Date.now() - cached.time < 30000) return cached.data;
  try {
    const resp = await fetch(`/api/polyproxy/clob/book?token_id=${tokenId}`);
    const raw = await resp.json();
    const data: OBBook = {
      bids: (raw.bids || []).map((b: { price: string; size: string }) => ({ price: parseFloat(b.price), size: parseFloat(b.size) })),
      asks: (raw.asks || []).map((a: { price: string; size: string }) => ({ price: parseFloat(a.price), size: parseFloat(a.size) })),
    };
    arbOBCache[tokenId] = { data, time: Date.now() };
    return data;
  } catch {
    return { bids: [], asks: [] };
  }
}

// Walk two sorted-ascending ask books to compute arb: max shares where Y ask + N ask < 100¢
function computeArbFromBooks(
  yesAsks: OBEntry[], noAsks: OBEntry[], maxQty: number,
): { yesPrice: number; noPrice: number; maxSize: number; diff: number } | null {
  if (!yesAsks.length || !noAsks.length) return null;
  let yi = 0, ni = 0;
  let yesRemaining = yesAsks[0].size;
  let noRemaining = noAsks[0].size;
  let totalSize = 0, totalYesCost = 0, totalNoCost = 0;
  const sizeLimit = maxQty > 0 ? maxQty : Infinity;

  while (yi < yesAsks.length && ni < noAsks.length) {
    const yPrice = yesAsks[yi].price * 100;
    const nPrice = noAsks[ni].price * 100;
    if (yPrice + nPrice >= 100) break;
    let fillSize = Math.min(yesRemaining, noRemaining);
    if (totalSize + fillSize > sizeLimit) fillSize = sizeLimit - totalSize;
    if (fillSize <= 0) break;
    totalSize += fillSize;
    totalYesCost += fillSize * yPrice;
    totalNoCost += fillSize * nPrice;
    yesRemaining -= fillSize;
    noRemaining -= fillSize;
    if (totalSize >= sizeLimit) break;
    if (yesRemaining <= 0.001) { yi++; if (yi < yesAsks.length) yesRemaining = yesAsks[yi].size; }
    if (noRemaining <= 0.001) { ni++; if (ni < noAsks.length) noRemaining = noAsks[ni].size; }
  }
  if (totalSize <= 0) return null;
  const avgYes = totalYesCost / totalSize;
  const avgNo = totalNoCost / totalSize;
  return { yesPrice: avgYes, noPrice: avgNo, maxSize: totalSize, diff: avgYes + avgNo - 100 };
}

function assetToSymbol(a: string): AssetSymbol {
  return (a + 'USDT') as AssetSymbol;
}

function parsePriceBounds(priceStr: string): { low: number; high: number } {
  const s = priceStr.replace(/[\$,]/g, '');
  if (s.startsWith('<')) return { low: 0, high: parseFloat(s.substring(1)) };
  if (s.startsWith('>')) return { low: parseFloat(s.substring(1)), high: Infinity };
  if (s.includes('-')) {
    const parts = s.split('-');
    return { low: parseFloat(parts[0]), high: parseFloat(parts[1]) };
  }
  const n = parseFloat(s);
  return { low: n, high: n };
}

/**
 * Computes signals and arbs from market data + BS probabilities
 * and pushes them into the store. Runs whenever market data or prices change.
 */
export function useSignalsAndArbs() {
  const aboveMarkets = useAppStore((s) => s.aboveMarkets);
  const priceOnMarkets = useAppStore((s) => s.priceOnMarkets);
  const weeklyHitMarkets = useAppStore((s) => s.weeklyHitMarkets);
  const priceData = useAppStore((s) => s.priceData);
  const vwapData = useAppStore((s) => s.vwapData);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const manualPriceSlots = useAppStore((s) => s.manualPriceSlots);
  const activeRangeSlot = useAppStore((s) => s.activeRangeSlot);
  const useLivePrice = useAppStore((s) => s.useLivePrice);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);
  const vwapCorrection = useAppStore((s) => s.vwapCorrection);
  const orders = useAppStore((s) => s.orders);
  const arbMatchMult = useAppStore((s) => s.arbMatchMult);
  const signalMakerMode = useAppStore((s) => s.signalMakerMode);
  const setSignals = useAppStore((s) => s.setSignals);
  const setArbs = useAppStore((s) => s.setArbs);
  const setTriArbs = useAppStore((s) => s.setTriArbs);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Debounce: recompute 200ms after last dependency change
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      computeAll().catch(e => console.error('[signals] computeAll error:', e));
    }, 200);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aboveMarkets, priceOnMarkets, weeklyHitMarkets, priceData, vwapData, volatilityData, volMultiplier, manualPriceSlots, activeRangeSlot, useLivePrice, bsTimeOffsetHours, vwapCorrection, orders, arbMatchMult, signalMakerMode]);

  function getAssetPrice(symbol: AssetSymbol): number {
    const slot = manualPriceSlots[symbol]?.[activeRangeSlot[symbol]];
    if (slot && !useLivePrice[symbol]) return slot.low;
    return vwapData[symbol]?.price || priceData[symbol]?.price || 0;
  }

  async function computeAll() {
    const signals: Signal[] = [];
    const now = Date.now();

    // Build order lookup for skip-own-order detection
    const ordersByToken: Record<string, typeof orders> = {};
    for (const o of orders) {
      const tid = o.asset_id || o.token_id || '';
      if (tid) {
        if (!ordersByToken[tid]) ordersByToken[tid] = [];
        ordersByToken[tid].push(o);
      }
    }

    // --- SIGNALS --- (iterate ALL assets from market data, not just grid assets)
    const allAssetNames = [...new Set([...Object.keys(aboveMarkets), ...Object.keys(priceOnMarkets), ...Object.keys(weeklyHitMarkets)])];
    for (const asset of allAssetNames) {
      const symbol = assetToSymbol(asset);
      // Use VWAP/spot price for BS (matches BsFlower center), not manual slot
      const bsLivePrice = vwapData[symbol]?.price || priceData[symbol]?.price || 0;
      const livePrice = getAssetPrice(symbol);
      const sigma = (volatilityData[symbol] || 0.60) * volMultiplier;
      if (livePrice <= 0) continue;

      const allMarkets = [
        ...((aboveMarkets[asset] || []).map(m => ({ m, tableType: 'above' as const }))),
        ...((priceOnMarkets[asset] || []).map(m => ({ m, tableType: 'price' as const }))),
        ...((weeklyHitMarkets[asset] || []).map(m => ({ m, tableType: 'hit' as const }))),
      ];

      for (const { m, tableType } of allMarkets) {
        const priceStr = m.groupItemTitle || '';
        if (!priceStr) continue;
        const endDate = m.endDate || '';
        if (!endDate) continue;
        if (m.closed || new Date(endDate).getTime() < now) continue;

        const tokenIds = m.clobTokenIds || [];
        const yesTokenId = tokenIds[0] || '';
        const noTokenId = tokenIds[1] || '';

        // Normalize price string for BS calculation (↑ → >, ↓ → <)
        const cleaned = priceStr.replace(/[\$,]/g, '').replace(/(.+)↑/, '>$1').replace(/(.+)↓/, '<$1').trim();
        const bsPriceStr = (cleaned.startsWith('>') || cleaned.startsWith('<') || cleaned.includes('-'))
          ? cleaned : '>' + cleaned;

        // BS at VWAP/spot price (matches BsFlower center value)
        const bsYes = getMarketProbability(bsPriceStr, bsLivePrice || livePrice, endDate, sigma, bsTimeOffsetHours);
        if (bsYes === null) continue;
        const bsNo = 1 - bsYes;

        const yesProbNum = bsYes * 100;
        const noProbNum = bsNo * 100;

        // YES side: ask price (price to buy YES)
        const yesAskNum = m.bestAsk ? m.bestAsk * 100 : 0;
        // NO side: ask price = 1 - bestBid (price to buy NO)
        const noAskNum = m.bestBid ? (1 - m.bestBid) * 100 : 0;
        // Bid prices: YES bid = bestBid, NO bid = 1 - bestAsk
        const yesBidNum = m.bestBid ? m.bestBid * 100 : 0;
        const noBidNum = m.bestAsk ? (1 - m.bestAsk) * 100 : 0;

        // Diffs
        const yesDiffPct = yesProbNum > 0 ? ((yesAskNum - yesProbNum) / yesProbNum) * 100 : 0;
        const noDiffPct = noProbNum > 0 ? ((noAskNum - noProbNum) / noProbNum) * 100 : 0;
        const yesBidDiffPct = yesProbNum > 0 ? ((yesBidNum - yesProbNum) / yesProbNum) * 100 : 0;
        const noBidDiffPct = noProbNum > 0 ? ((noBidNum - noProbNum) / noProbNum) * 100 : 0;

        // Maker mode: invert bid diff so positive bid-above-BS becomes negative (= signal)
        const yesMakerDiffPct = -yesBidDiffPct;
        const noMakerDiffPct = -noBidDiffPct;

        // Use bid or ask diff for signal detection based on mode
        let yesSignalDiff: number, noSignalDiff: number;
        if (signalMakerMode) {
          yesSignalDiff = yesMakerDiffPct;
          noSignalDiff = noMakerDiffPct;
        } else {
          yesSignalDiff = yesDiffPct;
          noSignalDiff = noDiffPct;
        }

        // Check data availability based on mode
        // Taker needs ask data; BID mode also needs bid data; maker needs bid data
        const yesHasAskData = yesAskNum > 0;
        const noHasAskData = noAskNum > 0;
        const yesHasBidData = yesBidNum > 0;
        const noHasBidData = noBidNum > 0;
        let yesHasData: boolean, noHasData: boolean;
        if (signalMakerMode) {
          yesHasData = yesHasBidData;
          noHasData = noHasBidData;
        } else {
          yesHasData = yesHasAskData;
          noHasData = noHasAskData;
        }

        // Own-order detection helpers
        const yesOrds = ordersByToken[yesTokenId] || [];
        const noOrds = ordersByToken[noTokenId] || [];
        const yesBuyOrders = yesOrds.filter(o => o.side === 'BUY');
        const yesSellOrders = yesOrds.filter(o => o.side === 'SELL');
        const noBuyOrders = noOrds.filter(o => o.side === 'BUY');
        const noSellOrders = noOrds.filter(o => o.side === 'SELL');

        // YES signal
        if (yesHasData && yesProbNum > 0 && yesSignalDiff < -20) {
          // Skip if best price is user's own order
          const yesMyBestBuy = yesBuyOrders.length > 0 ? Math.max(...yesBuyOrders.map(o => parseFloat(o.price))) : 0;
          const yesBestBidIsMyOrder = yesMyBestBuy > 0 && (m.bestBid ?? 0) > 0 && Math.abs(yesMyBestBuy - (m.bestBid ?? 0)) < 0.0001;
          const yesMyBestSell = yesSellOrders.length > 0 ? Math.min(...yesSellOrders.map(o => parseFloat(o.price))) : Infinity;
          const yesBestAskIsMyOrder = yesMyBestSell < Infinity && m.bestAsk != null && Math.abs(yesMyBestSell - m.bestAsk) < 0.0001;
          const yesSkipSignal = signalMakerMode ? yesBestBidIsMyOrder : yesBestAskIsMyOrder;
          if (!yesSkipSignal) {
            const bounds = parsePriceBounds(priceStr);
            let isBullish: boolean;
            if (tableType === 'hit') {
              isBullish = priceStr.includes('↑');
            } else if (tableType === 'above' || priceStr.includes('>')) {
              isBullish = true;
            } else if (tableType === 'price' && livePrice > 0) {
              const mid = (bounds.low + bounds.high) / 2;
              isBullish = livePrice < mid;
            } else {
              isBullish = false;
            }
            const displayPrice = tableType === 'hit' ? priceStr
              : (tableType === 'above' && !priceStr.includes('>') && !priceStr.includes('<'))
              ? '>' + priceStr : priceStr;
            // In maker mode: YES orig -> flip type, show NO side data
            signals.push({
              market: m,
              type: signalMakerMode ? (isBullish ? 'BEAR' : 'BULL') : (isBullish ? 'BULL' : 'BEAR'),
              price: signalMakerMode ? noAskNum / 100 : yesAskNum / 100,
              bsPrice: signalMakerMode ? noProbNum / 100 : yesProbNum / 100,
              diff: signalMakerMode ? (noAskNum - noProbNum) / 100 : (yesAskNum - yesProbNum) / 100,
              diffPct: signalMakerMode ? yesMakerDiffPct : yesDiffPct,
              bidPrice: signalMakerMode ? noBidNum / 100 : yesBidNum / 100,
              bidDiffPct: yesBidDiffPct,
              asset,
              endDate,
              priceStr: displayPrice,
              origSide: signalMakerMode ? 'NO' : 'YES',
              tableType,
            });
          }
        }

        // NO signal
        if (noHasData && noProbNum > 0 && noSignalDiff < -20) {
          // Skip if best price is user's own order
          const noMyBestBuy = noBuyOrders.length > 0 ? Math.max(...noBuyOrders.map(o => parseFloat(o.price))) : 0;
          const noBestBidDecimal = m.bestAsk ? (1 - m.bestAsk) : 0;
          const noBestBidIsMyOrder = noMyBestBuy > 0 && noBestBidDecimal > 0 && Math.abs(noMyBestBuy - noBestBidDecimal) < 0.0001;
          const noMyBestSell = noSellOrders.length > 0 ? Math.min(...noSellOrders.map(o => parseFloat(o.price))) : Infinity;
          const noBestAskDecimal = m.bestBid ? (1 - m.bestBid) : 0;
          const noBestAskIsMyOrder = noMyBestSell < Infinity && noBestAskDecimal > 0 && Math.abs(noMyBestSell - noBestAskDecimal) < 0.0001;
          const noSkipSignal = signalMakerMode ? noBestBidIsMyOrder : noBestAskIsMyOrder;
          if (!noSkipSignal) {
            const bounds = parsePriceBounds(priceStr);
            let isBullish: boolean;
            if (tableType === 'hit') {
              isBullish = priceStr.includes('↓');
            } else if (tableType === 'price' && livePrice > 0) {
              const mid = (bounds.low + bounds.high) / 2;
              isBullish = livePrice >= mid;
            } else {
              isBullish = priceStr.includes('<');
            }
            const displayPrice = tableType === 'hit' ? priceStr
              : (tableType === 'above' && !priceStr.includes('>') && !priceStr.includes('<'))
              ? '>' + priceStr : priceStr;
            // In maker mode: NO orig -> show YES side data
            signals.push({
              market: m,
              type: isBullish ? 'BULL' : 'BEAR',
              price: signalMakerMode ? yesAskNum / 100 : noAskNum / 100,
              bsPrice: signalMakerMode ? yesProbNum / 100 : noProbNum / 100,
              diff: signalMakerMode ? (yesAskNum - yesProbNum) / 100 : (noAskNum - noProbNum) / 100,
              diffPct: signalMakerMode ? noMakerDiffPct : noDiffPct,
              bidPrice: signalMakerMode ? yesBidNum / 100 : noBidNum / 100,
              bidDiffPct: noBidDiffPct,
              asset,
              endDate,
              priceStr: displayPrice,
              origSide: signalMakerMode ? 'YES' : 'NO',
              tableType,
            });
          }
        }
      }
    }

    // --- ARBS (2-leg cross-asset same-date) ---
    const arbs: ArbOpportunity[] = [];

    // Build per-asset map: { asset -> dateKey -> [{ strike, market, ... }] }
    interface MarketEntry {
      asset: string;
      strike: number;
      pctFromLive: number;
      volNormPct: number;
      endDate: string;
      market: Market;
      priceStr: string;
    }
    const assetMarketsByDate: Record<string, Record<string, MarketEntry[]>> = {};

    for (const asset of GRID_ASSETS) {
      const symbol = assetToSymbol(asset);
      const livePrice = getAssetPrice(symbol);
      if (livePrice <= 0) continue;
      assetMarketsByDate[asset] = {};
      const assetVol = (volatilityData[symbol] || 0.60) * volMultiplier;

      for (const m of (aboveMarkets[asset] || [])) {
        const priceStr = m.groupItemTitle || '';
        if (!priceStr) continue;
        const cleaned = priceStr.replace(/[\$,]/g, '');
        let strike: number;
        if (cleaned.startsWith('>')) strike = parseFloat(cleaned.substring(1));
        else if (cleaned.startsWith('<') || cleaned.includes('-')) continue;
        else strike = parseFloat(cleaned);
        if (isNaN(strike) || strike <= 0) continue;

        const endDate = m.endDate || '';
        if (!endDate || m.closed || new Date(endDate).getTime() < now) continue;

        const pctFromLive = ((strike - livePrice) / livePrice) * 100;
        const volNormPct = assetVol > 0 ? pctFromLive / (assetVol * 100) : pctFromLive;
        const dateKey = new Date(endDate).toDateString();

        if (!assetMarketsByDate[asset][dateKey]) assetMarketsByDate[asset][dateKey] = [];
        assetMarketsByDate[asset][dateKey].push({ asset, strike, pctFromLive, volNormPct, endDate, market: m, priceStr });
      }
    }

    // Helper: compute BS yes probability for a market entry at a given price
    function bsYesAtPrice(entry: MarketEntry, price: number): number | null {
      if (price <= 0) return null;
      const sym = assetToSymbol(entry.asset);
      const sigma = (volatilityData[sym] || 0.60) * volMultiplier;
      const bsStr = '>' + entry.priceStr.replace(/[>$,]/g, '');
      const prob = getMarketProbability(bsStr, price, entry.endDate, sigma, bsTimeOffsetHours);
      return prob !== null ? prob * 100 : null;
    }

    // Compute live BS (VWAP/spot) for OB mode
    function computeBsLive(entry: MarketEntry): number | null {
      const sym = assetToSymbol(entry.asset);
      const lp = vwapData[sym]?.price || priceData[sym]?.price || 0;
      return bsYesAtPrice(entry, lp);
    }

    // Compute slot-based BS (conservative min of low/high bounds) for BS1/BS2 modes
    function computeBsSlot(entry: MarketEntry, slotIndex: number): number | null {
      const sym = assetToSymbol(entry.asset);
      const slot = manualPriceSlots[sym]?.[slotIndex];
      if (!slot || !slot.low) return null;
      const probLow = bsYesAtPrice(entry, slot.low);
      if (slot.high && slot.high !== slot.low) {
        const probHigh = bsYesAtPrice(entry, slot.high);
        if (probLow !== null && probHigh !== null) return Math.min(probLow, probHigh);
        return probLow ?? probHigh;
      }
      return probLow;
    }

    // First pass: collect candidates using bestBid/bestAsk (quick filter)
    const candidates: { yesM: MarketEntry; noM: MarketEntry }[] = [];
    for (let i = 0; i < GRID_ASSETS.length; i++) {
      for (let j = i + 1; j < GRID_ASSETS.length; j++) {
        const assetA = GRID_ASSETS[i];
        const assetB = GRID_ASSETS[j];
        const datesA = assetMarketsByDate[assetA] || {};
        const datesB = assetMarketsByDate[assetB] || {};

        for (const dateKey of Object.keys(datesA)) {
          if (!datesB[dateKey]) continue;
          for (const mA of datesA[dateKey]) {
            for (const mB of datesB[dateKey]) {
              if (Math.abs(mA.volNormPct - mB.volNormPct) > 0.01 * arbMatchMult) continue;
              // Quick check: YES on A + NO on B
              const yesAskA = mA.market.bestAsk ? (mA.market.bestAsk * 100) : null;
              const noAskB = mB.market.bestBid ? ((1 - mB.market.bestBid) * 100) : null;
              if (yesAskA !== null && noAskB !== null && yesAskA + noAskB < 100) {
                candidates.push({ yesM: mA, noM: mB });
              }
              // Quick check: YES on B + NO on A
              const yesAskB = mB.market.bestAsk ? (mB.market.bestAsk * 100) : null;
              const noAskA = mA.market.bestBid ? ((1 - mA.market.bestBid) * 100) : null;
              if (yesAskB !== null && noAskA !== null && yesAskB + noAskA < 100) {
                candidates.push({ yesM: mB, noM: mA });
              }
            }
          }
        }
      }
    }

    // Set signals immediately (sync), then fetch orderbooks for arbs (async)
    setSignals(signals);

    if (candidates.length === 0) {
      setArbs([]);
      setTriArbs([]);
      return;
    }

    // Collect unique YES token IDs to fetch (NO asks are derived from YES bids)
    const tokenIdsToFetch = new Set<string>();
    for (const c of candidates) {
      const yesTokenId = (c.yesM.market.clobTokenIds || [])[0];
      const noYesTokenId = (c.noM.market.clobTokenIds || [])[0]; // YES token of the NO market
      if (yesTokenId) tokenIdsToFetch.add(yesTokenId);
      if (noYesTokenId) tokenIdsToFetch.add(noYesTokenId);
    }

    // Fetch all orderbooks in parallel
    const bookPromises: Record<string, Promise<OBBook>> = {};
    for (const tid of tokenIdsToFetch) {
      bookPromises[tid] = fetchArbOrderbook(tid);
    }
    const books: Record<string, OBBook> = {};
    for (const tid of tokenIdsToFetch) {
      books[tid] = await bookPromises[tid];
    }

    // Second pass: compute arbs using actual orderbook depth
    const shareQty = parseInt(localStorage.getItem('polymarket-arb-share-qty') || '0') || 0;
    for (const c of candidates) {
      const yesTokenId = (c.yesM.market.clobTokenIds || [])[0] || '';
      const noYesTokenId = (c.noM.market.clobTokenIds || [])[0] || '';

      const yesBook = books[yesTokenId] || { bids: [], asks: [] };
      const noYesBook = books[noYesTokenId] || { bids: [], asks: [] };

      // YES asks: sorted ascending by price
      const yesAsks = yesBook.asks
        .filter(a => a.price > 0 && a.size > 0)
        .sort((a, b) => a.price - b.price);

      // NO asks = derived from YES bids of the NO market: NO ask price = 1 - YES bid price
      const noAsks = noYesBook.bids
        .map(b => ({ price: 1 - b.price, size: b.size }))
        .filter(a => a.price > 0 && a.size > 0)
        .sort((a, b) => a.price - b.price);

      const result = computeArbFromBooks(yesAsks, noAsks, shareQty);
      if (!result || result.maxSize <= 0) continue;

      // Bid prices for selling: YES bid = best bid from YES book, NO bid = 1 - best ask from NO's YES book
      const yesBids = yesBook.bids.filter(b => b.price > 0 && b.size > 0).sort((a, b) => b.price - a.price);
      const noYesAsks = noYesBook.asks.filter(a => a.price > 0 && a.size > 0).sort((a, b) => a.price - b.price);
      const yesBidPrice = yesBids.length > 0 ? yesBids[0].price * 100 : 0;
      const noBidPrice = noYesAsks.length > 0 ? (1 - noYesAsks[0].price) * 100 : 0;

      const yesPrice = result.yesPrice / 100; // convert cents back to decimal
      const noPrice = result.noPrice / 100;
      const totalCost = yesPrice + noPrice;
      const edge = 1 - totalCost;
      const edgePct = totalCost > 0 ? (edge / totalCost) * 100 : 0;

      // Compute all BS variants: live (OB), slot0 (BS1), slot1 (BS2)
      const yBsLive = computeBsLive(c.yesM);
      const nBsLive = computeBsLive(c.noM);
      const yBs1 = computeBsSlot(c.yesM, 0);
      const nBs1 = computeBsSlot(c.noM, 0);
      const yBs2 = computeBsSlot(c.yesM, 1);
      const nBs2 = computeBsSlot(c.noM, 1);

      arbs.push({
        id: `${c.yesM.market.id}_${c.noM.market.id}_yn`,
        yesMarket: c.yesM.market,
        noMarket: c.noM.market,
        yesPrice,
        noPrice,
        edge,
        edgePct,
        asset: `${c.yesM.asset}/${c.noM.asset}`,
        endDate: c.yesM.endDate,
        yesPct: c.yesM.pctFromLive,
        noPct: c.noM.pctFromLive,
        maxSize: Math.floor(result.maxSize),
        yesBs: yBsLive,
        noBs: nBsLive !== null ? (100 - nBsLive) : null,
        yesBs1: yBs1,
        noBs1: nBs1 !== null ? (100 - nBs1) : null,
        yesBs2: yBs2,
        noBs2: nBs2 !== null ? (100 - nBs2) : null,
        yesBidPrice,
        noBidPrice,
      });
    }

    // Sort arbs by edge% descending
    arbs.sort((a, b) => b.edgePct - a.edgePct);
    setArbs(arbs);

    // --- TRI-ARBS (3-leg same-asset same-date) ---
    // TODO: implement if needed; for now set empty
    setTriArbs([]);
  }
}
