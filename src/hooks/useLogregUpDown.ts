import { useEffect, useState } from 'react';
import { API_BASE } from '../lib/env';

// Logistic-regression up/down model served by polycandles /api/logreg-updown.
export interface LrBacktest {
  n: number;
  accuracy: number;
  baselineAcc: number;
  edgeAcc: number;
  logLoss: number;
  brier: number;
  auc: number;
  refits: number;
}

export interface LrTFModel {
  coef: number[];
  featNames: string[];
  featuresNow: number[];
  prediction: number; // P(next market up)
  nTrain: number;
  n: number;
  backtest: LrBacktest;
  ok: boolean;
}

export type LrModelMap = Record<string, Record<string, LrTFModel>>;

const LR_POLL_MS = 120_000;

/** Polls the up/down logistic-regression model set (rebuilt ~15m on the backend). */
export function useLogregUpDown(): LrModelMap | null {
  const [models, setModels] = useState<LrModelMap | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = () => {
      void fetch(`${API_BASE}/api/logreg-updown`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: LrModelMap | null) => {
          if (!disposed && data && typeof data === 'object') setModels(data);
        })
        .catch(() => {
          /* transient — keep last good models */
        });
    };

    load();
    timer = setInterval(load, LR_POLL_MS);
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return models;
}
