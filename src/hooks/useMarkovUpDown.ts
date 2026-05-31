import { useEffect, useState } from 'react';
import { API_BASE } from '../lib/env';

// Markov up/down model served by polycandles /api/markov-updown.
// Outcome index convention: 0 = DOWN, 1 = UP.
export interface MarkovTFModel {
  t1: [number, number]; // T1[prev] = P(up | previous resolved = prev)
  n1: [number, number];
  t2: [[number, number], [number, number]]; // T2[prev2][prev1] = P(up | prev2, prev1)
  n2: [[number, number], [number, number]];
  marginalUp: number;
  prev: number; // most recent resolved outcome: 1=up, 0=down, -1=unknown
  prev2: number; // resolved outcome before `prev`
  n: number;
}

export type MarkovModelMap = Record<string, Record<string, MarkovTFModel>>;

const MARKOV_POLL_MS = 60_000;

/** Polls the up/down Markov model set. Refresh cadence matches the backend rebuild (~minutes). */
export function useMarkovUpDown(): MarkovModelMap | null {
  const [models, setModels] = useState<MarkovModelMap | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = () => {
      void fetch(`${API_BASE}/api/markov-updown`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data: MarkovModelMap | null) => {
          if (!disposed && data && typeof data === 'object') setModels(data);
        })
        .catch(() => {
          /* transient — keep last good models */
        });
    };

    load();
    timer = setInterval(load, MARKOV_POLL_MS);
    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return models;
}

export interface MarkovNextProb {
  order1: number | null; // P(next market up), 1st order, live-conditioned
  order2: number | null; // P(next market up), 2nd order, live-conditioned
}

/**
 * Live-conditioned Markov prediction of the NEXT market's up probability by marginalizing
 * over the in-flight window's live up probability pUpCur (= bs_prob / mathYesProb):
 *
 *   order-1: pUpCur·T1[up] + (1−pUpCur)·T1[down]
 *   order-2: pUpCur·T2[prevResolved][up] + (1−pUpCur)·T2[prevResolved][down]
 *
 * pUpCur in [0,1]. Returns nulls when the model/inputs are unusable.
 */
export function markovNextUpProb(model: MarkovTFModel | undefined, pUpCur: number | null): MarkovNextProb {
  if (!model || pUpCur == null || !Number.isFinite(pUpCur)) {
    return { order1: null, order2: null };
  }
  const p = Math.max(0, Math.min(1, pUpCur));

  const order1 = p * model.t1[1] + (1 - p) * model.t1[0];

  let order2: number | null = null;
  const prev = model.prev;
  if (prev === 0 || prev === 1) {
    order2 = p * model.t2[prev][1] + (1 - p) * model.t2[prev][0];
  } else {
    order2 = order1; // no resolved predecessor yet → fall back to 1st order
  }

  return {
    order1: Number.isFinite(order1) ? order1 : null,
    order2: order2 != null && Number.isFinite(order2) ? order2 : null,
  };
}
