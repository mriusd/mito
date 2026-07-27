import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { getMarketProbability, getSignalYesProbability } from '../utils/bsMath';
import { hitStrikeMetaForBs, getSignalTablePriceStr } from '../utils/format';
import type { AssetSymbol, Market, Signal, ArbOpportunity } from '../types';

const GRID_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
/** Price/vwap ticks — do not re-run React; throttle compute via store subscribe. */
const PRICE_RECOMPUTE_MS = 1000;

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
 * and pushes them into the store.
 * High-freq price/vwap: store.subscribe + throttle (no React re-render on every tick).
 */
export function useSignalsAndArbs() {
  const aboveMarkets = useAppStore((s) => s.aboveMarkets);
  const priceOnMarkets = useAppStore((s) => s.priceOnMarkets);
  const weeklyHitMarkets = useAppStore((s) => s.weeklyHitMarkets);
  const volatilityData = useAppStore((s) => s.volatilityData);
  const volMultiplier = useAppStore((s) => s.volMultiplier);
  const manualPriceSlots = useAppStore((s) => s.manualPriceSlots);
  const activeRangeSlot = useAppStore((s) => s.activeRangeSlot);
  const useLivePrice = useAppStore((s) => s.useLivePrice);
  const bsTimeOffsetHours = useAppStore((s) => s.bsTimeOffsetHours);
  const vwapCorrection = useAppStore((s) => s.vwapCorrection);
  const arbMatchMult = useAppStore((s) => s.arbMatchMult);
  const signalMakerMode = useAppStore((s) => s.signalMakerMode);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const priceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const computeRef = useRef<() => void>(() => {});

  const scheduleCompute = (delayMs: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      computeRef.current();
    }, delayMs);
  };

  useEffect(() => {
    scheduleCompute(50);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- price via subscribe below
  }, [
    aboveMarkets,
    priceOnMarkets,
    weeklyHitMarkets,
    volatilityData,
    volMultiplier,
    manualPriceSlots,
    activeRangeSlot,
    useLivePrice,
    bsTimeOffsetHours,
    vwapCorrection,
    arbMatchMult,
    signalMakerMode,
  ]);

  // priceData / vwapData — throttle without re-rendering this host on every tick.
  useEffect(() => {
    let lastPd = useAppStore.getState().priceData;
    let lastVwap = useAppStore.getState().vwapData;
    const unsub = useAppStore.subscribe((state) => {
      if (state.priceData === lastPd && state.vwapData === lastVwap) return;
      lastPd = state.priceData;
      lastVwap = state.vwapData;
      if (priceTimerRef.current != null) return;
      priceTimerRef.current = setTimeout(() => {
        priceTimerRef.current = null;
        scheduleCompute(0);
      }, PRICE_RECOMPUTE_MS);
    });
    return () => {
      unsub();
      if (priceTimerRef.current) clearTimeout(priceTimerRef.current);
    };
  }, []);

  function getAssetPrice(
    symbol: AssetSymbol,
    priceData: ReturnType<typeof useAppStore.getState>['priceData'],
    vwapData: ReturnType<typeof useAppStore.getState>['vwapData'],
  ): number {
    const slot = manualPriceSlots[symbol]?.[activeRangeSlot[symbol]];
    if (slot && !useLivePrice[symbol]) return slot.low;
    return vwapData[symbol]?.price || priceData[symbol]?.price || 0;
  }

  async function computeAll() {
    const st = useAppStore.getState();
    const { priceData, vwapData, setSignals, setArbs, setTriArbs, orders } = st;
    const signals: Signal[] = [];
    const now = Date.now();

    const ordersByToken: Record<string, typeof orders> = {};
    for (const o of orders) {
      const tid = o.asset_id || o.token_id || '';
      if (tid) {
        if (!ordersByToken[tid]) ordersByToken[tid] = [];
        ordersByToken[tid].push(o);
      }
    }

    const allAssetNames = [
      ...new Set([...Object.keys(aboveMarkets), ...Object.keys(priceOnMarkets), ...Object.keys(weeklyHitMarkets)]),
    ];
    for (const asset of allAssetNames) {
      const symbol = assetToSymbol(asset);
      const bsLivePrice = vwapData[symbol]?.price || priceData[symbol]?.price || 0;
      const livePrice = getAssetPrice(symbol, priceData, vwapData);
      const sigma = (volatilityData[symbol] || 0.6) * volMultiplier;
      if (livePrice <= 0) continue;

      const allMarkets = [
        ...((aboveMarkets[asset] || []).map((m) => ({ m, tableType: 'above' as const }))),
        ...((priceOnMarkets[asset] || []).map((m) => ({ m, tableType: 'price' as const }))),
        ...((weeklyHitMarkets[asset] || []).map((m) => ({ m, tableType: 'hit' as const }))),
      ];

      for (const { m, tableType } of allMarkets) {
        const priceStr = m.groupItemTitle || '';
        if (!priceStr && tableType !== 'hit') continue;
        const endDate = m.endDate || '';
        if (!endDate) continue;
        if (m.closed || new Date(endDate).getTime() < now) continue;

        const tokenIds = m.clobTokenIds || [];
        const yesTokenId = tokenIds[0] || '';
        const noTokenId = tokenIds[1] || '';

        let bsPriceStr: string;
        let hitIsReach = false;
        let hitIsDip = false;
        if (tableType === 'hit') {
          const hitMeta = hitStrikeMetaForBs(m);
          if (!hitMeta) continue;
          bsPriceStr = hitMeta.bsPriceStr;
          hitIsReach = hitMeta.isReachHit;
          hitIsDip = hitMeta.isDipHit;
        } else {
          if (!priceStr) continue;
          const cleaned = priceStr
            .replace(/[\$,]/g, '')
            .replace(/(.+)↑/, '>$1')
            .replace(/(.+)↓/, '<$1')
            .trim();
          bsPriceStr =
            cleaned.startsWith('>') || cleaned.startsWith('<') || cleaned.includes('-')
              ? cleaned
              : '>' + cleaned;
        }

        const bsYes = getSignalYesProbability(
          tableType,
          bsPriceStr,
          bsLivePrice || livePrice,
          endDate,
          sigma,
          bsTimeOffsetHours,
        );
        if (bsYes === null) continue;
        const bsNo = 1 - bsYes;

        const yesProbNum = bsYes * 100;
        const noProbNum = bsNo * 100;

        const yesAskNum = m.bestAsk ? m.bestAsk * 100 : 0;
        const noAskNum = m.bestBid ? (1 - m.bestBid) * 100 : 0;
        const yesBidNum = m.bestBid ? m.bestBid * 100 : 0;
        const noBidNum = m.bestAsk ? (1 - m.bestAsk) * 100 : 0;

        const yesDiffPct = yesProbNum > 0 ? ((yesAskNum - yesProbNum) / yesProbNum) * 100 : 0;
        const noDiffPct = noProbNum > 0 ? ((noAskNum - noProbNum) / noProbNum) * 100 : 0;
        const yesBidDiffPct = yesProbNum > 0 ? ((yesBidNum - yesProbNum) / yesProbNum) * 100 : 0;
        const noBidDiffPct = noProbNum > 0 ? ((noBidNum - noProbNum) / noProbNum) * 100 : 0;

        const yesHasAskData = yesAskNum > 0;
        const noHasAskData = noAskNum > 0;
        const yesHasBidData = yesBidNum > 0;
        const noHasBidData = noBidNum > 0;
        let yesHasData: boolean, noHasData: boolean;
        if (signalMakerMode) {
          yesHasData = noHasBidData;
          noHasData = yesHasBidData;
        } else {
          yesHasData = yesHasAskData;
          noHasData = noHasAskData;
        }

        const yesOrds = ordersByToken[yesTokenId] || [];
        const noOrds = ordersByToken[noTokenId] || [];
        const yesBuyOrders = yesOrds.filter((o) => o.side === 'BUY');
        const yesSellOrders = yesOrds.filter((o) => o.side === 'SELL');
        const noBuyOrders = noOrds.filter((o) => o.side === 'BUY');
        const noSellOrders = noOrds.filter((o) => o.side === 'SELL');

        const yesMyBestBuy = yesBuyOrders.length > 0 ? Math.max(...yesBuyOrders.map((o) => parseFloat(o.price))) : 0;
        const yesBestBidIsMyOrder =
          yesMyBestBuy > 0 && (m.bestBid ?? 0) > 0 && Math.abs(yesMyBestBuy - (m.bestBid ?? 0)) < 0.0001;
        const yesMyBestSell =
          yesSellOrders.length > 0 ? Math.min(...yesSellOrders.map((o) => parseFloat(o.price))) : Infinity;
        const yesBestAskIsMyOrder =
          yesMyBestSell < Infinity && m.bestAsk != null && Math.abs(yesMyBestSell - m.bestAsk) < 0.0001;

        const noMyBestBuy = noBuyOrders.length > 0 ? Math.max(...noBuyOrders.map((o) => parseFloat(o.price))) : 0;
        const noBestBidDecimal = m.bestAsk ? 1 - m.bestAsk : 0;
        const noBestBidIsMyOrder =
          noMyBestBuy > 0 && noBestBidDecimal > 0 && Math.abs(noMyBestBuy - noBestBidDecimal) < 0.0001;
        const noMyBestSell =
          noSellOrders.length > 0 ? Math.min(...noSellOrders.map((o) => parseFloat(o.price))) : Infinity;
        const noBestAskDecimal = m.bestBid ? 1 - m.bestBid : 0;
        const noBestAskIsMyOrder =
          noMyBestSell < Infinity && noBestAskDecimal > 0 && Math.abs(noMyBestSell - noBestAskDecimal) < 0.0001;

        const yesBranchSignal = signalMakerMode
          ? noHasBidData && noProbNum > 0 && noBidDiffPct < -20
          : yesHasData && yesProbNum > 0 && yesDiffPct < -20;
        if (yesBranchSignal) {
          const yesSkipSignal = signalMakerMode ? noBestBidIsMyOrder : yesBestAskIsMyOrder;
          if (!yesSkipSignal) {
            const bounds = parsePriceBounds(priceStr || m.groupItemTitle || '');
            let isBullish: boolean;
            if (tableType === 'hit') {
              isBullish = hitIsReach;
            } else if (tableType === 'above' || priceStr.includes('>')) {
              isBullish = true;
            } else if (tableType === 'price' && livePrice > 0) {
              const mid = (bounds.low + bounds.high) / 2;
              isBullish = livePrice < mid;
            } else {
              isBullish = false;
            }
            const displayPrice = getSignalTablePriceStr(m);
            signals.push({
              market: m,
              type: signalMakerMode ? (isBullish ? 'BEAR' : 'BULL') : isBullish ? 'BULL' : 'BEAR',
              price: signalMakerMode ? noAskNum / 100 : yesAskNum / 100,
              bsPrice: signalMakerMode ? noProbNum / 100 : yesProbNum / 100,
              diff: signalMakerMode ? (noBidNum - noProbNum) / 100 : (yesAskNum - yesProbNum) / 100,
              diffPct: signalMakerMode ? noBidDiffPct : yesDiffPct,
              bidPrice: signalMakerMode ? noBidNum / 100 : yesBidNum / 100,
              bidDiffPct: signalMakerMode ? noBidDiffPct : yesBidDiffPct,
              asset,
              endDate,
              priceStr: displayPrice,
              origSide: signalMakerMode ? 'NO' : 'YES',
              tableType,
            });
          }
        }

        const noBranchSignal = signalMakerMode
          ? yesHasBidData && yesProbNum > 0 && yesBidDiffPct < -20
          : noHasData && noProbNum > 0 && noDiffPct < -20;
        if (noBranchSignal) {
          const noSkipSignal = signalMakerMode ? yesBestBidIsMyOrder : noBestAskIsMyOrder;
          if (!noSkipSignal) {
            const bounds = parsePriceBounds(priceStr || m.groupItemTitle || '');
            let isBullish: boolean;
            if (tableType === 'hit') {
              isBullish = hitIsDip;
            } else if (tableType === 'price' && livePrice > 0) {
              const mid = (bounds.low + bounds.high) / 2;
              isBullish = livePrice >= mid;
            } else {
              isBullish = priceStr.includes('<');
            }
            const displayPrice = getSignalTablePriceStr(m);
            signals.push({
              market: m,
              type: isBullish ? 'BULL' : 'BEAR',
              price: signalMakerMode ? yesAskNum / 100 : noAskNum / 100,
              bsPrice: signalMakerMode ? yesProbNum / 100 : noProbNum / 100,
              diff: signalMakerMode ? (yesBidNum - yesProbNum) / 100 : (noAskNum - noProbNum) / 100,
              diffPct: signalMakerMode ? yesBidDiffPct : noDiffPct,
              bidPrice: signalMakerMode ? yesBidNum / 100 : noBidNum / 100,
              bidDiffPct: signalMakerMode ? yesBidDiffPct : noBidDiffPct,
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

    const arbs: ArbOpportunity[] = [];

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
      const livePrice = getAssetPrice(symbol, priceData, vwapData);
      if (livePrice <= 0) continue;
      assetMarketsByDate[asset] = {};
      const assetVol = (volatilityData[symbol] || 0.6) * volMultiplier;

      for (const m of aboveMarkets[asset] || []) {
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
        assetMarketsByDate[asset][dateKey].push({
          asset,
          strike,
          pctFromLive,
          volNormPct,
          endDate,
          market: m,
          priceStr,
        });
      }
    }

    function bsYesAtPrice(entry: MarketEntry, price: number): number | null {
      if (price <= 0) return null;
      const sym = assetToSymbol(entry.asset);
      const sigma = (volatilityData[sym] || 0.6) * volMultiplier;
      const bsStr = '>' + entry.priceStr.replace(/[>$,]/g, '');
      const prob = getMarketProbability(bsStr, price, entry.endDate, sigma, bsTimeOffsetHours);
      return prob !== null ? prob * 100 : null;
    }

    function computeBsLive(entry: MarketEntry): number | null {
      const sym = assetToSymbol(entry.asset);
      const lp = vwapData[sym]?.price || priceData[sym]?.price || 0;
      return bsYesAtPrice(entry, lp);
    }

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
              const yesAskA = mA.market.bestAsk ? mA.market.bestAsk * 100 : null;
              const noAskB = mB.market.bestBid ? (1 - mB.market.bestBid) * 100 : null;
              if (yesAskA !== null && noAskB !== null && yesAskA + noAskB < 100) {
                candidates.push({ yesM: mA, noM: mB });
              }
              const yesAskB = mB.market.bestAsk ? mB.market.bestAsk * 100 : null;
              const noAskA = mA.market.bestBid ? (1 - mA.market.bestBid) * 100 : null;
              if (yesAskB !== null && noAskA !== null && yesAskB + noAskA < 100) {
                candidates.push({ yesM: mB, noM: mA });
              }
            }
          }
        }
      }
    }

    setSignals(signals);

    if (candidates.length === 0) {
      setArbs([]);
      setTriArbs([]);
      return;
    }

    for (const c of candidates) {
      const yesAsk = c.yesM.market.bestAsk || 0;
      const noAsk = c.noM.market.bestBid ? 1 - c.noM.market.bestBid : 0;
      if (yesAsk <= 0 || noAsk <= 0) continue;
      if (yesAsk + noAsk >= 1) continue;

      const yesBidPrice = (c.yesM.market.bestBid || 0) * 100;
      const noBidPrice = c.noM.market.bestAsk ? (1 - c.noM.market.bestAsk) * 100 : 0;

      const yesPrice = yesAsk;
      const noPrice = noAsk;
      const totalCost = yesPrice + noPrice;
      const edge = 1 - totalCost;
      const edgePct = totalCost > 0 ? (edge / totalCost) * 100 : 0;

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
        maxSize: 0,
        yesBs: yBsLive,
        noBs: nBsLive !== null ? 100 - nBsLive : null,
        yesBs1: yBs1,
        noBs1: nBs1 !== null ? 100 - nBs1 : null,
        yesBs2: yBs2,
        noBs2: nBs2 !== null ? 100 - nBs2 : null,
        yesBidPrice,
        noBidPrice,
      });
    }

    arbs.sort((a, b) => b.edgePct - a.edgePct);
    setArbs(arbs);
    setTriArbs([]);
  }

  computeRef.current = () => {
    void computeAll().catch((e) => console.error('[signals] computeAll error:', e));
  };
}
