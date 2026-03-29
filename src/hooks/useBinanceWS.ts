import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import type { AssetSymbol } from '../types';

export function useBinanceWS() {
  const setPriceData = useAppStore((s) => s.setPriceData);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    function connect() {
      const streams = ['btcusdt@ticker', 'ethusdt@ticker', 'solusdt@ticker', 'xrpusdt@ticker'];
      const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams.join('/')}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.data?.s) {
          const symbol = data.data.s as AssetSymbol;
          const price = parseFloat(data.data.c);
          setPriceData(symbol, price);
        }
      };

      ws.onclose = () => {
        setTimeout(connect, 5000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    // Fetch initial prices
    fetch('https://api.binance.com/api/v3/ticker/price')
      .then((r) => r.json())
      .then((data) => {
        const symbols: AssetSymbol[] = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT'];
        for (const item of data) {
          if (symbols.includes(item.symbol as AssetSymbol)) {
            setPriceData(item.symbol as AssetSymbol, parseFloat(item.price));
          }
        }
      })
      .catch(() => {});

    connect();

    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [setPriceData]);
}
