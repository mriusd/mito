# Frontend optimizations

Notes for `polybot-react`: what shipped, tradeoffs, and backlog ideas.

---

## Completed

### Root re-renders (`App.tsx`)

- **Before:** `useAppStore((s) => s.marketLookup)` subscribed the whole tree to every bid/ask WS-driven patch on the lookup map.
- **After:** Subscribe only to `lastUpdated` as a coarse “lookup changed” epoch. The URL deep-link effect reads `useAppStore.getState().marketLookup` inside the effect body.
- **Tradeoff:** If `marketLookup` changes without `lastUpdated` advancing, deep-link resolution could lag until the next refresh tick (should match normal API refresh semantics).

### Signal / arb compute churn (`useSignalsAndArbs.ts`)

- **Before:** `orders` was in the Zustand selector and in the debounced effect dependency array → every order book tick retriggers the 200ms debounced `computeAll`.
- **After:** `computeAll()` pulls `useAppStore.getState().orders` at call time; `orders` removed from hook subscription and effect deps.
- **Tradeoff:** If *only* orders change (no other deps), debounced recompute does not reschedule; the next run still sees fresh orders via `getState()`. Acceptable for avoiding thrash; revisit if you need “order-only” invalidation with a lighter incremental pass.

### Sidebar structure (`Sidebar.tsx` + split files)

- **`SidebarChartsRow.tsx`:** `React.memo` wrapper for Chainlink + LiveTrade chart row.
- **`SidebarLiveOrderbookSection.tsx`:** Memoized live orderbook UI.
- **`SidebarLiveTradesSection.tsx`:** Memoized tape list.
- **`SidebarPolymarketOBHost.tsx`:**
  - **`usePolymarketOB` + stale book + imbalance** live here (wrapped in `memo`), not in `Sidebar`.
  - Parent holds `sidebarBookRef` synced every layout commit; order submit / replace / close / FAK read the ref at invoke time (no `displayBids`/`displayAsks` in closure deps).
  - `onTopOfBookDigestBump()` only when first ask / last bid / loading flag signature changes — `summaryPriceDecimal` and Math vs market strip use `topOfBookDigest` instead of depending on full book arrays every RAF.
  - Polymarket tape still bubbled with `onPolymarketTrades` → `polymarketTape` state so `displayLiveTrades` merge behaves as before (**parent still rerenders on poly tape updates** when source is Polymarket — next step: isolate tape).

### UX / settings

- **Header:** “Disable market price warning” — persisted; skips crossing-book confirm when limit would execute like market.
- **Orderbook overlay:** Resolved markets show **Outcome: YES/NO** (or UP/DOWN); `marketLookup` merged for `outcomePrices`.

### Build / type hygiene

- `SidebarChartsRow`: `startTime={upDownStartTime ?? undefined}` for `LiveTradeChart` prop types.
- `Sidebar`: `Market` type import + full `SidebarLiveOrderbookSectionProps` at call site (`isUpDownMarket`, `sidebarUserBidPrices`, `outcomeMarket`).

---

## Suggested next optimizations

### High impact (architecture)

1. **On-chain sidebar tape** (`useOnchainTradesWS` + `displayLiveTrades`) — Reduce parent `Sidebar` churn when only the tape updates (move hook + memo list, or ref + subtree).
2. **Header portfolio line** — Derived `positionsValueUsd` + `cashBalance` scalars vs full `positions[]` subscription.

### Medium impact (React / Zustand)

1. **Selector granularity** — Replace broad `useAppStore((s) => s.X)` wherever children only need primitives; use shallow compare (`useShallow`) for small object bundles.
2. **List virtualization** — Orderbook lists and live trades can use windowing (`react-window` / virtue) when depth or tape length grows.
3. **Stable props for memo children** — Audit `SidebarChartsRow` / forms: inline objects/functions still break memo; move callbacks to `useCallback` + memoized prop objects where profiling shows hotspots.

### Lower impact / polish

1. **Route-level code splitting** — Lazy heavy dialogs (`ToxicFlowDialog`, merge, signing) if not already dynamic.
2. `**React.Profiler` + Web Vitals** — Baseline before/after for sidebar open + market select + WS flood.
3. **Web Worker for `computeAll`** (signals) — If main-thread jank remains; watch serialization cost vs debounce.
4. **Document store update paths** — Short ADR on what updates `marketLookup` vs `lastUpdated` so future features don’t reintroduce root subscriptions.

---

## How to extend this doc

After each perf change: add a bullet under **Completed** (what/when/tradeoff) and prune **Suggested** items that shipped.