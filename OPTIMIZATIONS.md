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

### Header portfolio + wallet dialog (`Header.tsx`, `lib/portfolioMetrics.ts`)

- **Before:** `cashBalance` + `positions` selectors — any new `positions[]` reference forced Header re-render even when computed Val/Cash unchanged.
- **After:** Single `useAppStore(useShallow(...))` returns `{ cashBalance, totalVal }` (total = `portfolioPositionsValueUsd(positions) + cash`). Header re-renders only when `cashBalance` or `totalVal` change (not when `positions` is replaced with an equivalent-value array). Shared helper **`portfolioPositionsValueUsd`**.
- **Wallet Summary:** `WalletInfoDialog` via **`React.lazy`** + **`Suspense`**; mounts only when open and `tradingWallet` is set; **hover/focus** on the button warms the async chunk (`ToxicFlowDialog` module — now split off main bundle, see below).

### Sidebar merge dialog + `marketLookup` subscription

- **Merge:** `MergePositionsDialog` lazy-loaded; mounts when merge dialog open + `conditionId`; **hover/focus** on Merge preloads chunk.
- **`marketLookup` churn:** `useAppStore` on full `marketLookup` made Sidebar subscribe to **object identity** on every bid/ask WS flush (`useBidAskWS` RAF merge).
- **After:** Store **`marketLookupEpoch`** bumps whenever lookup is replaced (`setMarketData` with `marketLookup`, **`updateBidAsk`**, **`useBidAskWS`** flush). Sidebar uses **`marketLookupEpoch`** + `useMemo(() => getState().marketLookup, [epoch])` — one scalar subscription, fresh map read per paint.
- **Tradeoff:** Other panels still use `useAppStore(s => s.marketLookup)` (future: same pattern or `useMarketLookupSubset`). Merge dialog unmount-on-close resets dialog local state.

### Toxic / Holders dialog chunk (`Sidebar.tsx` + Header lazy)

- **Before:** Sidebar statically imported **`ToxicFlowDialog`**, so the module stayed in the main Rollup chunk even if Holders + Wallet Summary were never opened.
- **After:** **`ToxicFlowDialogLazy`** in Sidebar mounts only when **`toxicDialogOpen`** with a **`conditionId`**; Holders button **hover/focus** preload. **`ToxicFlowDialog-*.js`** emitted separately (~69 kB min); main **`index-*.js`** shrinks (~3.56 MB → ~3.49 MB in a local build).
- **Tradeoff:** Wallet Summary + Holders dialogs unmount when closed → in-dialog ephemeral UI resets on reopen.

### UX / settings

- **Header:** “Disable market price warning” — persisted; skips crossing-book confirm when limit would execute like market.
- **Orderbook overlay:** Resolved markets show **Outcome: YES/NO** (or UP/DOWN); `marketLookup` merged for `outcomePrices`.

### Build / type hygiene

- `SidebarChartsRow`: `startTime={upDownStartTime ?? undefined}` for `LiveTradeChart` prop types.
- `Sidebar`: `Market` type import + full `SidebarLiveOrderbookSectionProps` at call site (`isUpDownMarket`, `sidebarUserBidPrices`, `outcomeMarket`).

### `marketLookup` subscription churn (panels + ToxicFlow + EditProg)

- **Before:** `useAppStore((s) => s.marketLookup)` in PnLPanel, OrderbookPopup, SummaryTable, SmartMoneyPanel, UpOrDownHUDPanel, ArbPositionsTable, EditProgDialog, ToxicFlowDialog (WalletInfo + Toxic) — **every** bid/ask WS flush replaced the lookup object → each panel re-rendered and retained new references (main thread + retained graph growth during long sessions).
- **After:** Shared hook **`useMarketLookupSnapshot()`** (`marketLookupEpoch` + `getState().marketLookup` in `useMemo`) — one scalar subscription per panel; lookup read only when epoch bumps (same pattern as Sidebar since `marketLookupEpoch` work).
- **Tradeoff:** Same as Sidebar: if lookup mutates without epoch bump (shouldn’t in current code paths), UI could lag until next WS/API refresh.

### Sidebar live tape / on-chain rows (mirrored state)

- **Before:** `displayLiveTrades`, `onchainSidebarPositions`, `onchainSidebarTrades` were `useState` + `useEffect` copies of hook output → extra renders and duplicate array references during tape WS flood.
- **After:** **`useMemo`** derives from `useOnchainTradesWS` + `polymarketTape` / `liveTradesSource` with no sync effects.

---

## Frontend audit — 2026-05-12

Snapshot of `polybot-react` after a fresh read-through. Numbers are from the most recent `dist/` build and `wc -l` over `src/`.

### Bundle observations

- **Main chunk: `dist/assets/index-*.js` ≈ 3.56 MB minified** (next biggest non-vendor: 652 kB, 226 kB). Vite has no `build.rollupOptions.output.manualChunks` and no bundle visualizer, so vendor + app are co-mingled.
- **Heavy `node_modules`** (uncompressed):
  - `ethers` 10 MB (v5 — full BigNumber + provider tree), pulled by `clobClient`, `useWalletData`, `polymarketTradingMaker`, `mergePositions`.
  - `html2canvas` 4.4 MB — **listed in `package.json` but not imported anywhere in `src/`**. Dead dep; drop it.
  - `lighter-sdk-client` 1.7 MB (with WASM signer) — statically imported at module top of `panels/PerpBotPanel.tsx`, which is **statically** referenced from `DraggableCanvas`. Panel is dev-only (`devOnly: true` in `Header`'s add-panel menu) yet ships to every user.
  - `@reown/appkit` 1.6 MB; `@polymarket/clob-client-v2` ~700 kB.
- **Panel imports are all static** in `DraggableCanvas.tsx` (`renderPanel` switch). Largest offenders that almost no one has open by default: `BinanceChartPanel` 1.7k LOC, `AssetMarketTable` 1.5k LOC, `PriceForecastPanel` 1k LOC, `UpDownMarketsPanel` 789 LOC, `TradesPositionsOrders` 755 LOC, `PerpBotPanel` 693 LOC.
- **`Sidebar.tsx` (3 830 LOC)** is statically imported by `App.tsx`. On mobile it boots `sidebarOpen=false` and on desktop it is the second-largest single component but still ships in the main chunk along with all its (eagerly imported) dependencies: `BsFlower`, `SidebarChartsRow`, `SidebarPolymarketOBHost`, `SidebarLiveTradesSection`, `usePolymarketOB`, etc.

### Store / re-render observations

- **`positions` / `orders` / `trades` references churn every 30 s** even when content is unchanged: `useWalletData.loadWalletData` and `useMarketData.refreshData` always call `setMarketData({ positions, orders, trades, ... })` with fresh arrays from JSON parses. Every component that does `useAppStore((s) => s.positions)` (`Sidebar`, `TradesPositionsOrders`, `AssetMarketTable`, `UpDownMarketsPanel`, `UpOrDownHUDPanel`, `SummaryTable`, plus the `portfolioPositionsValueUsd` recompute in `Header`) re-renders on every refresh tick — half the tree.
- **`aboveMarkets` / `priceOnMarkets` / `weeklyHitMarkets` / `upOrDownMarkets`** are also replaced wholesale every 30 s with fresh top-level objects. `AssetMarketTable`, `PriceForecastPanel`, `BsFlower`, `useSignalsAndArbs`, etc. subscribe to the *whole* per-asset map → every refresh triggers a re-render even when the visible asset's bucket is byte-identical.
- **`AssetMarketTable` recomputes heavy lookups inline** (not memoized):
  - `signalByMarket` (foreach signals)
  - `positionLookup`, `orderLookup` (foreach positions/orders)
  - `buildTableData(markets)` is a function call on every render path with its own intermediate `Map`s.
  - `parsePriceBounds`, `getNumericValue`, `deltaBgStyle` are recreated each render.
- **Sidebar localStorage fan-out**: 13+ separate `useEffect(() => localStorage.setItem(...), [v])` blocks for tilt-notify settings. Cheap individually but noisy in diffs and inflates re-render set. A single `useLocalStorageState`/`useLocalStorageGroup` helper would collapse ~80 LOC and keep persistence in one path.
- **`useBidAskWS.mergeWsItemOntoMarket`** is ~100 LOC of repetitive `if (typeof item.X === 'number' && Number.isFinite(item.X)) next.X = item.X` over 25+ fields — same field list already declared in `WS_FIELDS`/`BIDASK_EQ_KEYS`. Data-driven copy would shave the file in half and make adding fields a one-liner.
- **`useSignalsAndArbs` debounced `computeAll`** still recomputes on every market-bucket reference replacement (the 30 s refresh), even when only `bestBid`/`bestAsk` changed via the (separate) bid/ask WS path. The actual signal math depends on bid/ask, not the bucket map identity → mostly redundant work behind the 200 ms debounce.

### Misc

- `App.tsx` reads `useAppStore.getState()` inside `keydown` handler — good. Same effect re-binds on every `selectedMarket` change; could lift the handler to a stable ref and read `getState()` for `selectedMarket` too.
- `OrderbookPopup` already uses `useMarketLookupSnapshot()`; good.
- `useOnchainTradesWS` already batches RAF and caps tape — good.
- `useBinanceWS` already merges per-RAF — good.

---

## Suggested next optimizations (ranked)

### Tier 1 — Bundle (estimated >1 MB off main chunk, low risk)

1. **Drop `html2canvas`** from `package.json` — unused. ~4.4 MB off `node_modules`; whether it was tree-shaken or not, removing dead deps avoids future regressions.
2. **Lazy-load every panel** in `DraggableCanvas.renderPanel` via `React.lazy` (use the existing `lazyWithChunkReload`). Each panel becomes its own chunk; main chunk drops by hundreds of kB. Add a small `<Suspense fallback={null}>` wrapper around `renderPanel(panel)` inside the grid item.
   - Biggest wins: `BinanceChartPanel`, `AssetMarketTable`, `PriceForecastPanel`, `UpDownMarketsPanel`, `TradesPositionsOrders`, `PerpBotPanel` (dev-only — must not ship for non-dev users).
3. **Gate `PerpBotPanel` on `IS_DEV`** at the import site (or lazy-load only when added). `lighter-sdk-client` is 1.7 MB with a WASM signer, dev-only feature.
4. **Add `manualChunks` to `vite.config.ts`** so wallet/web3 deps live in their own long-cached chunks. Suggested split:
   - `wallet`: `@reown/*`, `wagmi`, `viem`, `@base-org/account`
   - `clob`: `@polymarket/clob-client-v2`, `ethers`
   - `react`: `react`, `react-dom`, `react-grid-layout`, `react-resizable`
   - `state`: `zustand`, `@tanstack/react-query`
5. **Lazy-load `Sidebar`** + warm on hover/focus of the open-sidebar handle. On mobile the sidebar starts closed (already in code), so the 3.8k-LOC chunk + `BsFlower` + `usePolymarketOB` should not block first paint.
6. **Add `rollup-plugin-visualizer`** (devDep) and a `npm run analyze` script. Without baseline measurement, regressions silently land.

### Tier 2 — Store update hygiene (kills 30 s "everyone re-renders" wave)

1. **Dedupe `positions` / `orders` / `trades` setters** before `set({...})`. Cheapest implementation: replace `setMarketData` with one that does shallow array-of-objects equality (compare lengths + per-row `id`/`asset`/`size`/`avgPrice`/`status`) and only updates the slice when something actually changed. Same for `aboveMarkets`/`priceOnMarkets`/`weeklyHitMarkets`/`upOrDownMarkets` (compare top-level keys; if all buckets are JSON-equal, keep the old reference).
2. **Bump-and-snapshot** the slot-replaced collections (same pattern as `marketLookupEpoch`):
   - `positionsEpoch`, `ordersEpoch`, `tradesEpoch` bump on real change; panels subscribe to the epoch and pull data via `getState()` inside `useMemo`.
   - Cleanest place: a tiny `useStoreSlot<T>(key, epoch)` hook in `src/hooks/`.
3. **`useSignalsAndArbs` input gate** — hash `(aboveMarkets, priceOnMarkets, weeklyHitMarkets, manualPriceSlots, …)` via length + first/last bestBid sentinel before scheduling a recompute. Use `marketLookupEpoch` as the actual reactivity trigger; bucket map identity is no longer load-bearing once Tier 2.1 lands.
4. **`Header` portfolio value**: it already uses `useShallow`, but `portfolioPositionsValueUsd(positions)` recomputes on every `positions` identity change. If `positions` is deduped (Tier 2.1) the issue disappears; otherwise memoize per-`positionsEpoch`.

### Tier 3 — Per-component renders

1. **Memoize hot tables**: wrap `AssetMarketTable`, `UpDownMarketsPanel`, `UpOrDownHUDPanel`, `TradesPositionsOrders` in `React.memo` after Tier 2 lands (otherwise memo is useless — store-driven re-renders bypass it). Lift `panelId` and any other primitive props so memo can short-circuit.
2. **`AssetMarketTable` internal memo**:
   - `signalByMarket` → `useMemo([signals, signalsOnGrid, signalMakerMode])`
   - `positionLookup` → `useMemo([positions, onchainGridPositions, liveTradesSource])`
   - `orderLookup` → `useMemo([orders])`
   - `buildTableData` result per `(markets, showPast)` pair
3. **`useBidAskWS.mergeWsItemOntoMarket` data-driven copy**: keep field list as `[{ key, validate }]`, iterate. ~60 LOC saved, identical hot path.
4. **Consolidate Sidebar localStorage effects** behind a `useLocalStorageState(key, initialReader, serializer)` hook — converts 13+ `useEffect` blocks into a single line per setting. Optional `?storage="localStorage"` to keep types tight.

### Tier 4 — Polish

1. **List virtualization** for live tape (3500-row cap, all rendered) and Up/Down event tables when long. `react-virtuoso` is the smallest mature option (~12 kB gz) and supports sticky headers needed for the grid tables.
2. **React Profiler baseline** captured during a typical WS-flood minute on the default layout — keep a CSV under `OPTIMIZATIONS.md` for regression tracking.
3. **Web Worker `computeAll`** in `useSignalsAndArbs` — only worth it after Tier 2.3 lands and confirms a real main-thread cost; current implementation is mostly cheap loops over a few hundred markets.
4. **ADR**: which actions are allowed to bump `marketLookupEpoch` vs. replace `marketLookup` vs. just patch `bestBid/bestAsk`. Right now there are 3 paths and adding a 4th would silently reintroduce root-subscription churn.

---

## How to extend this doc

After each perf change: add a bullet under **Completed** (what/when/tradeoff) and prune **Suggested** items that shipped.