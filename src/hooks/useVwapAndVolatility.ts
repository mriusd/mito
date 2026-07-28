import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import type { AssetSymbol } from '../types';

const SYMBOLS: AssetSymbol[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];

export function useVwapAndVolatility() {
  const vwapCandlesRef = useRef(useAppStore.getState().vwapCandles);

  useEffect(() => {
    async function fetchVWAP(symbol: AssetSymbol) {
      try {
        const limit = vwapCandlesRef.current;
        const resp = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1m&limit=${limit}`);
        const klines = await resp.json();
        let sumPV = 0, sumV = 0;
        for (const k of klines) {
          const typical = (parseFloat(k[2]) + parseFloat(k[3]) + parseFloat(k[4])) / 3;
          const vol = parseFloat(k[5]);
          sumPV += typical * vol;
          sumV += vol;
        }
        if (sumV > 0) {
          useAppStore.getState().setVwapData(symbol, sumPV / sumV);
        }
      } catch (e) {
        console.warn('VWAP fetch failed for', symbol, e);
      }
    }

    async function fetchAllVWAP() {
      await Promise.all(SYMBOLS.map((s) => fetchVWAP(s)));
    }

    fetchAllVWAP();
    const interval = setInterval(fetchAllVWAP, 60000);
    const unsub = useAppStore.subscribe((state, prev) => {
      if (state.vwapCandles === prev.vwapCandles) return;
      vwapCandlesRef.current = state.vwapCandles;
      void fetchAllVWAP();
    });
    return () => {
      clearInterval(interval);
      unsub();
    };
  }, []);

  useEffect(() => {
    async function fetchVolatility() {
      for (const symbol of SYMBOLS) {
        try {
          const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=365`);
          const klines = await response.json();
          if (klines && klines.length >= 2) {
            const returns: number[] = [];
            for (let i = 1; i < klines.length; i++) {
              const prevClose = parseFloat(klines[i - 1][4]);
              const currClose = parseFloat(klines[i][4]);
              if (prevClose > 0 && currClose > 0) {
                returns.push(Math.log(currClose / prevClose));
              }
            }
            if (returns.length >= 10) {
              const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
              const uncondVar = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / returns.length;
              const alpha = 0.10, beta = 0.85;
              const omega = uncondVar * (1 - alpha - beta);
              let sigma2 = uncondVar;
              for (let j = 0; j < returns.length; j++) {
                const r = returns[j] - mean;
                sigma2 = omega + alpha * r * r + beta * sigma2;
              }
              const annualizedVol = Math.sqrt(sigma2) * Math.sqrt(365);
              useAppStore.getState().setVolatilityData(symbol, Math.max(0.20, Math.min(2.0, annualizedVol)));
            }
          }
        } catch (err) {
          console.error(`Failed to fetch volatility for ${symbol}:`, err);
        }
      }
    }
    fetchVolatility();
  }, []);
}
