import { useEffect, useState } from 'react';
import { API_BASE } from '../lib/env';

// Markov up/down model served by polycandles /api/markov-updown.
// Outcome index convention: 0 = DOWN, 1 = UP.
type M2 = [[number, number], [number, number]];
type M3 = [M2, M2];
type M4 = [M3, M3];

export interface MarkovTFModel {
  t1: [number, number]; // T1[prev] = P(up | previous resolved = prev)
  n1: [number, number];
  t2: M2; // T2[prev2][prev1] = P(up | prev2, prev1)
  n2: M2;
  t3: M3; // T3[prev3][prev2][prev1]
  n3: M3;
  t4: M4; // T4[prev4][prev3][prev2][prev1]
  n4: M4;
  marginalUp: number;
  prev: number; // most recent resolved outcome: 1=up, 0=down, -1=unknown
  prev2: number; // resolved outcome before `prev`
  prev3: number;
  prev4: number;
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
  order2: number | null; // 2nd order
  order3: number | null; // 3rd order
  order4: number | null; // 4th order
}

/**
 * Live-conditioned Markov prediction of the NEXT market's up probability by marginalizing
 * over the in-flight window's live up probability pUpCur (= bs_prob / mathYesProb):
 *
 *   order-k: pUpCur·Tk[...prev][up] + (1−pUpCur)·Tk[...prev][down]
 *
 * where the conditioning context for order-k is the (k−1) most recent RESOLVED outcomes.
 * Higher orders fall back to the next-lower order when their predecessor is unknown.
 * pUpCur in [0,1]. Returns nulls when the model/inputs are unusable.
 */
export function markovNextUpProb(model: MarkovTFModel | undefined, pUpCur: number | null): MarkovNextProb {
  if (!model || pUpCur == null || !Number.isFinite(pUpCur)) {
    return { order1: null, order2: null, order3: null, order4: null };
  }
  const p = Math.max(0, Math.min(1, pUpCur));
  const valid = (s: number) => s === 0 || s === 1;
  const fin = (v: number | null) => (v != null && Number.isFinite(v) ? v : null);

  const order1 = p * model.t1[1] + (1 - p) * model.t1[0];

  const { prev, prev2, prev3 } = model;
  let order2 = order1;
  if (valid(prev)) order2 = p * model.t2[prev][1] + (1 - p) * model.t2[prev][0];

  let order3 = order2;
  if (valid(prev) && valid(prev2)) {
    order3 = p * model.t3[prev2][prev][1] + (1 - p) * model.t3[prev2][prev][0];
  }

  let order4 = order3;
  if (valid(prev) && valid(prev2) && valid(prev3)) {
    order4 = p * model.t4[prev3][prev2][prev][1] + (1 - p) * model.t4[prev3][prev2][prev][0];
  }

  return { order1: fin(order1), order2: fin(order2), order3: fin(order3), order4: fin(order4) };
}
