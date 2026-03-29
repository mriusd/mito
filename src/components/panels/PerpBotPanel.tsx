import { InfoClient, InfoPrivateClient, WasmSigner } from 'lighter-sdk-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const LIGHTER_BASE = 'https://mainnet.zklighter.elliot.ai';
const LIGHTER_ORDERBOOK_URL = `${LIGHTER_BASE}/api/v1/orderBookDetails`;
const POLL_MS = 5000;
const LIGHTER_CREDS_KEY = 'polybot-lighter-api-creds';
const MAX_ACTIVE_ORDER_MARKETS = 32;
const TRADE_HISTORY_LIMIT = 25;

const ASSETS = ['BTC', 'ETH', 'SOL', 'XRP'] as const;
type AssetSym = (typeof ASSETS)[number];

const ASSET_COLORS: Record<AssetSym, string> = {
  BTC: 'text-orange-400',
  ETH: 'text-blue-400',
  SOL: 'text-violet-400',
  XRP: 'text-cyan-400',
};

/** Matches Lighter: API key index, public key, private key, L2 account index. */
interface LighterApiCreds {
  apiKeyIndex: string;
  publicKey: string;
  privateKey: string;
  accountIndex: string;
}

const EMPTY_CREDS: LighterApiCreds = {
  apiKeyIndex: '',
  publicKey: '',
  privateKey: '',
  accountIndex: '',
};

interface OrderBookRow {
  symbol: string;
  market_id: number;
  market_type?: string;
  last_trade_price: number;
  daily_price_change?: number;
  daily_price_low?: number;
  daily_price_high?: number;
}

interface AccountPositionRow {
  market_id: number;
  symbol: string;
  position: string;
  avg_entry_price: string;
  unrealized_pnl: string;
  position_value: string;
}

interface AccountSnapshot {
  available_balance: string;
  collateral: string;
  positions: AccountPositionRow[];
}

/** SDK / API order shape (active orders). */
interface ActiveOrderRow {
  market_index: number;
  order_index?: number;
  side: string;
  price: string;
  remaining_base_amount: string;
  is_ask: boolean;
  type: string;
  status: string;
  timestamp: number;
}

interface TradeRow {
  trade_id: number;
  market_id: number;
  size: string;
  price: string;
  timestamp: number;
  type: string;
  is_maker_ask: boolean;
}

function loadLighterCreds(): LighterApiCreds {
  try {
    const raw = localStorage.getItem(LIGHTER_CREDS_KEY);
    if (!raw) return { ...EMPTY_CREDS };
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (j.apiKeyIndex != null || j.publicKey != null || j.privateKey != null || j.accountIndex != null) {
      return {
        apiKeyIndex: j.apiKeyIndex != null ? String(j.apiKeyIndex) : '',
        publicKey: typeof j.publicKey === 'string' ? j.publicKey : '',
        privateKey: typeof j.privateKey === 'string' ? j.privateKey : '',
        accountIndex: j.accountIndex != null ? String(j.accountIndex) : '',
      };
    }
    if (typeof j.apiKey === 'string' || typeof j.secret === 'string') {
      return {
        apiKeyIndex: typeof j.apiKey === 'string' ? j.apiKey : '',
        publicKey: typeof j.secret === 'string' ? j.secret : '',
        privateKey: typeof j.passphrase === 'string' ? j.passphrase : '',
        accountIndex: '',
      };
    }
    return { ...EMPTY_CREDS };
  } catch {
    return { ...EMPTY_CREDS };
  }
}

function formatUsd(price: number, sym: AssetSym): string {
  if (!Number.isFinite(price)) return '—';
  if (sym === 'BTC' || sym === 'ETH') {
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (sym === 'SOL') {
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  }
  return price.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
}

function parseNum(s: string | undefined): number {
  if (s == null || s === '') return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

export function PerpBotPanel() {
  const infoClient = useMemo(() => new InfoClient({ baseURL: LIGHTER_BASE }), []);

  const [bySymbol, setBySymbol] = useState<Partial<Record<AssetSym, OrderBookRow>>>({});
  const bySymbolRef = useRef(bySymbol);
  bySymbolRef.current = bySymbol;

  const [status, setStatus] = useState<string>('Loading…');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [keysOpen, setKeysOpen] = useState(false);
  const [credsForm, setCredsForm] = useState<LighterApiCreds>(() => loadLighterCreds());
  const [savedCreds, setSavedCreds] = useState<LighterApiCreds>(() => loadLighterCreds());
  const [hasStoredKeys, setHasStoredKeys] = useState(() => {
    const c = loadLighterCreds();
    return !!(c.apiKeyIndex || c.publicKey || c.privateKey || c.accountIndex);
  });

  const [accountSnap, setAccountSnap] = useState<AccountSnapshot | null>(null);
  const accountSnapRef = useRef<AccountSnapshot | null>(null);
  accountSnapRef.current = accountSnap;
  const [accountErr, setAccountErr] = useState<string | null>(null);
  const [activeOrders, setActiveOrders] = useState<ActiveOrderRow[]>([]);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [privateErr, setPrivateErr] = useState<string | null>(null);
  const [wasmErr, setWasmErr] = useState<string | null>(null);
  const [wasmReady, setWasmReady] = useState(false);

  const wasmSignerRef = useRef<WasmSigner | null>(null);
  const privateClientRef = useRef<InfoPrivateClient | null>(null);
  const marketSymbolByIdRef = useRef<Map<number, string>>(new Map());

  const accountIdxParsed = parseInt(savedCreds.accountIndex.trim(), 10);
  const accountIdxOk = Number.isFinite(accountIdxParsed) && accountIdxParsed >= 0;
  const apiKeyIdxParsed = parseInt(savedCreds.apiKeyIndex.trim(), 10);
  const apiKeyIdxOk = Number.isFinite(apiKeyIdxParsed) && apiKeyIdxParsed >= 0;
  const canUsePrivate =
    accountIdxOk &&
    apiKeyIdxOk &&
    savedCreds.privateKey.trim().length > 0;

  const fetchPrices = useCallback(async () => {
    try {
      const res = await fetch(LIGHTER_ORDERBOOK_URL);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = (await res.json()) as { code?: number; order_book_details?: OrderBookRow[] };
      const rows = data.order_book_details;
      if (!Array.isArray(rows)) throw new Error('Bad response');
      const next: Partial<Record<AssetSym, OrderBookRow>> = {};
      for (const sym of ASSETS) {
        const row = rows.find((r) => r.symbol === sym);
        if (row) next[sym] = row;
      }
      const idMap = new Map<number, string>();
      for (const r of rows) {
        if (r.market_type === 'perp' || r.market_type === undefined) {
          idMap.set(r.market_id, r.symbol);
        }
      }
      marketSymbolByIdRef.current = idMap;
      setBySymbol(next);
      setStatus('Lighter zkLighter');
      setUpdatedAt(Date.now());
    } catch {
      setStatus('Failed to load');
    }
  }, []);

  useEffect(() => {
    fetchPrices();
    const t = setInterval(fetchPrices, POLL_MS);
    return () => clearInterval(t);
  }, [fetchPrices]);

  /** Load WASM signer + private API client when keys + account index are valid. */
  useEffect(() => {
    if (!canUsePrivate) {
      wasmSignerRef.current = null;
      privateClientRef.current = null;
      setWasmReady(false);
      setWasmErr(null);
      setActiveOrders([]);
      setTrades([]);
      setPrivateErr(null);
      return;
    }

    let cancelled = false;
    const signer = new WasmSigner({
      url: LIGHTER_BASE,
      wasmPath: '/wasm/lighter-signer.wasm',
      wasmExecPath: '/wasm/lighter-wasm-exec.js',
    });

    (async () => {
      try {
        await signer.initialize();
        if (cancelled) return;
        signer.setAccount(savedCreds.privateKey.trim(), apiKeyIdxParsed, accountIdxParsed);
        const cr = signer.createClient();
        if (cr?.error) {
          if (!cancelled) {
            setWasmErr(cr.error);
            setWasmReady(false);
            wasmSignerRef.current = null;
            privateClientRef.current = null;
          }
          return;
        }
        if (cancelled) return;
        wasmSignerRef.current = signer;
        privateClientRef.current = new InfoPrivateClient({
          baseURL: LIGHTER_BASE,
          wasmSigner: signer,
        });
        setWasmErr(null);
        setWasmReady(true);
      } catch (e) {
        if (!cancelled) {
          setWasmErr(e instanceof Error ? e.message : String(e));
          setWasmReady(false);
          wasmSignerRef.current = null;
          privateClientRef.current = null;
        }
      }
    })();

    return () => {
      cancelled = true;
      wasmSignerRef.current = null;
      privateClientRef.current = null;
      setWasmReady(false);
    };
  }, [canUsePrivate, savedCreds.privateKey, apiKeyIdxParsed, accountIdxParsed]);

  /** Poll account, orders, trades when keys are saved. */
  useEffect(() => {
    if (!hasStoredKeys || !accountIdxOk) {
      setAccountSnap(null);
      setAccountErr(null);
      return;
    }

    let alive = true;

    const tick = async () => {
      try {
        const accRes = await infoClient.getAccountInfo({ by: 'index', value: String(accountIdxParsed) });
        if (!alive) return;
        if (accRes.code !== 200 || !accRes.accounts?.length) {
          setAccountErr(accRes.message ?? `Account lookup failed (${accRes.code})`);
          setAccountSnap(null);
          return;
        }
        const a = accRes.accounts[0];
        setAccountErr(null);
        setAccountSnap({
          available_balance: a.available_balance ?? '0',
          collateral: a.collateral ?? '0',
          positions: (a.positions ?? []).map((p) => ({
            market_id: p.market_id,
            symbol: p.symbol,
            position: p.position,
            avg_entry_price: p.avg_entry_price,
            unrealized_pnl: p.unrealized_pnl,
            position_value: p.position_value,
          })),
        });
      } catch (e) {
        if (!alive) return;
        setAccountErr(e instanceof Error ? e.message : String(e));
        setAccountSnap(null);
      }

      const pc = privateClientRef.current;
      if (!wasmReady || !pc) {
        if (alive) {
          setPrivateErr(null);
          if (!wasmReady && canUsePrivate && !wasmErr) setPrivateErr('Initializing signer…');
        }
        return;
      }

      try {
        const marketIds = new Set<number>();
        for (const sym of ASSETS) {
          const mid = bySymbolRef.current[sym]?.market_id;
          if (mid != null) marketIds.add(mid);
        }
        for (const p of accountSnapRef.current?.positions ?? []) {
          if (parseNum(p.position) !== 0) marketIds.add(p.market_id);
        }
        const ids = Array.from(marketIds).slice(0, MAX_ACTIVE_ORDER_MARKETS);

        const orderLists = await Promise.all(
          ids.map(async (market_id) => {
            try {
              const o = await pc.getAccountActiveOrders({ account_index: accountIdxParsed, market_id });
              if (o.code !== 200 || !Array.isArray(o.orders)) return [] as ActiveOrderRow[];
              return o.orders as ActiveOrderRow[];
            } catch {
              return [];
            }
          }),
        );
        if (!alive) return;
        const merged: ActiveOrderRow[] = [];
        const seen = new Set<string>();
        for (const list of orderLists) {
          for (const o of list) {
            const k = `${o.market_index}-${o.order_index ?? o.price}-${o.timestamp}`;
            if (seen.has(k)) continue;
            seen.add(k);
            merged.push(o);
          }
        }
        merged.sort((a, b) => b.timestamp - a.timestamp);
        setActiveOrders(merged);

        const tr = await pc.getTrades({
          sort_by: 'timestamp',
          sort_dir: 'desc',
          limit: TRADE_HISTORY_LIMIT,
          account_index: accountIdxParsed,
        });
        if (!alive) return;
        if (tr.code !== 200 || !Array.isArray(tr.trades)) {
          setPrivateErr(tr.message ?? `Trades failed (${tr.code})`);
          setTrades([]);
        } else {
          setPrivateErr(null);
          setTrades(tr.trades as TradeRow[]);
        }
      } catch (e) {
        if (!alive) return;
        setPrivateErr(e instanceof Error ? e.message : String(e));
      }
    };

    tick();
    const t = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [hasStoredKeys, accountIdxOk, accountIdxParsed, infoClient, wasmReady, canUsePrivate, wasmErr]);

  const openKeysDialog = () => {
    setCredsForm(loadLighterCreds());
    setKeysOpen(true);
  };

  const saveKeys = () => {
    try {
      localStorage.setItem(LIGHTER_CREDS_KEY, JSON.stringify(credsForm));
      setSavedCreds({ ...credsForm });
      setHasStoredKeys(
        !!(credsForm.apiKeyIndex || credsForm.publicKey || credsForm.privateKey || credsForm.accountIndex),
      );
    } catch {
      /* ignore quota */
    }
    setKeysOpen(false);
  };

  const clearKeys = () => {
    try {
      localStorage.removeItem(LIGHTER_CREDS_KEY);
    } catch {
      /* ignore */
    }
    setCredsForm({ ...EMPTY_CREDS });
    setSavedCreds({ ...EMPTY_CREDS });
    setHasStoredKeys(false);
    setKeysOpen(false);
    setAccountSnap(null);
    setActiveOrders([]);
    setTrades([]);
  };

  const showAccountSections = hasStoredKeys && accountIdxOk;

  return (
    <div className="panel-wrapper bg-gray-800/50 rounded-lg p-3 flex flex-col min-h-0 h-full">
      <div className="panel-header flex flex-col gap-2 mb-2 shrink-0 cursor-grab">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-sm font-bold text-sky-300">Perp Bot</h3>
          <span className="text-[9px] text-gray-500">Lighter perp last trade</span>
          <button
            type="button"
            onClick={openKeysDialog}
            onPointerDown={(e) => e.stopPropagation()}
            className="ml-1 rounded border border-sky-700/60 bg-sky-950/50 px-2 py-0.5 text-[10px] font-semibold text-sky-200 hover:bg-sky-900/50 hover:border-sky-500/70 cursor-pointer"
          >
            Add API keys
          </button>
          {hasStoredKeys && (
            <span className="text-[8px] text-emerald-500/90" title="Keys saved in localStorage">
              ● saved
            </span>
          )}
          <span className="text-[9px] text-gray-500 ml-auto tabular-nums">
            {status}
            {updatedAt != null && (
              <span className="text-gray-600 ml-1">
                · {new Date(updatedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
            )}
          </span>
        </div>

        <div
          className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-b border-gray-700/60 pb-2 text-[11px] cursor-default"
          onPointerDown={(e) => e.stopPropagation()}
        >
          {ASSETS.map((sym) => {
            const row = bySymbol[sym];
            const price = row?.last_trade_price;
            const ch = row?.daily_price_change;
            return (
              <div key={sym} className="flex items-baseline gap-1.5 shrink-0">
                <span className={`font-bold ${ASSET_COLORS[sym]}`}>{sym}</span>
                <span className="font-mono tabular-nums text-gray-100">
                  {price != null && Number.isFinite(price) ? `$${formatUsd(price, sym)}` : '—'}
                </span>
                {ch != null && Number.isFinite(ch) && (
                  <span className={`text-[10px] font-mono tabular-nums ${ch >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {ch >= 0 ? '+' : ''}
                    {ch.toFixed(1)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto text-[10px] text-gray-300 px-0.5 cursor-default space-y-3 pr-1"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {!hasStoredKeys && (
          <p className="text-gray-600">
            Public prices from order book details. Save Lighter API credentials to see balance, positions, orders, and trade
            history.
          </p>
        )}
        {hasStoredKeys && !accountIdxOk && (
          <p className="text-amber-400/90">
            Add your numeric <span className="font-semibold">Account index</span> in “Add API keys” to load balance and positions.
          </p>
        )}
        {showAccountSections && (
          <>
            <section>
              <h4 className="text-[10px] font-bold uppercase tracking-wide text-sky-400/90 mb-1">Balance on Lighter</h4>
              {accountErr && <p className="text-rose-400/90">{accountErr}</p>}
              {accountSnap && !accountErr && (
                <div className="font-mono tabular-nums text-gray-200 space-y-0.5">
                  <div>
                    <span className="text-gray-500">Available </span>
                    {accountSnap.available_balance}
                  </div>
                  <div>
                    <span className="text-gray-500">Collateral </span>
                    {accountSnap.collateral}
                  </div>
                </div>
              )}
            </section>

            <section>
              <h4 className="text-[10px] font-bold uppercase tracking-wide text-sky-400/90 mb-1">Active positions</h4>
              {accountSnap && !accountErr && (
                <ul className="space-y-1">
                  {accountSnap.positions.filter((p) => parseNum(p.position) !== 0).length === 0 ? (
                    <li className="text-gray-600">No open perp positions</li>
                  ) : (
                    accountSnap.positions
                      .filter((p) => parseNum(p.position) !== 0)
                      .map((p) => (
                        <li key={p.market_id} className="border-b border-gray-700/40 pb-1 font-mono text-[10px]">
                          <span className="text-gray-100 font-semibold">{p.symbol}</span>{' '}
                          <span className={parseNum(p.position) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{p.position}</span>
                          <span className="text-gray-500"> @ {p.avg_entry_price}</span>
                          <div className="text-gray-500 mt-0.5">
                            uPnL {p.unrealized_pnl} · notional {p.position_value}
                          </div>
                        </li>
                      ))
                  )}
                </ul>
              )}
            </section>

            <section>
              <h4 className="text-[10px] font-bold uppercase tracking-wide text-sky-400/90 mb-1">Active orders</h4>
              {wasmErr && <p className="text-rose-400/90 text-[10px]">Signer: {wasmErr}</p>}
              {!canUsePrivate && !wasmErr && (
                <p className="text-gray-600">Set API key index, private key, and account index to load orders.</p>
              )}
              {canUsePrivate && !wasmReady && !wasmErr && (
                <p className="text-gray-600">Loading signer…</p>
              )}
              {wasmReady && privateErr && <p className="text-rose-400/90 text-[10px]">{privateErr}</p>}
              {wasmReady && !privateErr && activeOrders.length === 0 && (
                <p className="text-gray-600">No active orders (checked headline markets + markets with positions).</p>
              )}
              {wasmReady && activeOrders.length > 0 && (
                <ul className="space-y-1 max-h-36 overflow-y-auto">
                  {activeOrders.map((o, i) => {
                    const sym = marketSymbolByIdRef.current.get(o.market_index) ?? `m${o.market_index}`;
                    return (
                      <li key={`${o.market_index}-${i}`} className="font-mono text-[10px] border-b border-gray-700/30 pb-0.5">
                        <span className="text-gray-200">{sym}</span>{' '}
                        <span className={o.is_ask ? 'text-rose-400' : 'text-emerald-400'}>
                          {o.is_ask ? 'sell' : 'buy'}
                        </span>{' '}
                        <span className="text-gray-300">{o.remaining_base_amount}</span>
                        <span className="text-gray-500"> @ {o.price}</span>
                        <span className="text-gray-600"> · {o.type}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <h4 className="text-[10px] font-bold uppercase tracking-wide text-sky-400/90 mb-1">Trade history</h4>
              {wasmReady && trades.length === 0 && !privateErr && (
                <p className="text-gray-600">No recent fills in this window.</p>
              )}
              {wasmReady && trades.length > 0 && (
                <ul className="space-y-1 max-h-40 overflow-y-auto">
                  {trades.map((t) => {
                    const sym = marketSymbolByIdRef.current.get(t.market_id) ?? `m${t.market_id}`;
                    const ts = t.timestamp
                      ? new Date(t.timestamp * 1000).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : '—';
                    return (
                      <li key={t.trade_id} className="font-mono text-[10px] border-b border-gray-700/30 pb-0.5">
                        <span className="text-gray-500">{ts}</span>{' '}
                        <span className="text-gray-200">{sym}</span>{' '}
                        <span className="text-gray-300">{t.size}</span>
                        <span className="text-gray-500"> @ {t.price}</span>
                        <span className="text-gray-600"> · {t.type}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!wasmReady && canUsePrivate && (
                <p className="text-gray-600">Trade history loads after the signer is ready.</p>
              )}
            </section>
          </>
        )}
      </div>

      {keysOpen && (
        <div
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/65 p-4"
          onClick={() => setKeysOpen(false)}
          onPointerDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-lg border border-gray-600 bg-gray-900 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="lighter-keys-title"
            aria-modal="true"
          >
            <h4 id="lighter-keys-title" className="text-sm font-bold text-sky-200">
              Lighter API credentials
            </h4>
            <p className="mt-1 text-[10px] text-gray-500 leading-snug">
              API key index, public key, private key, and your L2 account index. Saved in{' '}
              <code className="text-gray-400">localStorage</code> on this device only — not sent to our servers by this panel.
              Orders and trade history use the in-browser WASM signer (bundled under <code className="text-gray-400">public/wasm</code>
              ).
            </p>
            <div className="mt-3 space-y-2">
              <label className="block">
                <span className="text-[10px] text-gray-400">Account index</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={credsForm.accountIndex}
                  onChange={(e) => setCredsForm((c) => ({ ...c, accountIndex: e.target.value }))}
                  className="mt-0.5 w-full rounded border border-gray-600 bg-gray-950 px-2 py-1.5 font-mono text-xs text-gray-100 outline-none focus:border-sky-600"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="L2 account index (integer)"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-gray-400">API key index</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={credsForm.apiKeyIndex}
                  onChange={(e) => setCredsForm((c) => ({ ...c, apiKeyIndex: e.target.value }))}
                  className="mt-0.5 w-full rounded border border-gray-600 bg-gray-950 px-2 py-1.5 font-mono text-xs text-gray-100 outline-none focus:border-sky-600"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="e.g. 0"
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-gray-400">Public key</span>
                <input
                  type="text"
                  value={credsForm.publicKey}
                  onChange={(e) => setCredsForm((c) => ({ ...c, publicKey: e.target.value }))}
                  className="mt-0.5 w-full rounded border border-gray-600 bg-gray-950 px-2 py-1.5 font-mono text-[11px] text-gray-100 outline-none focus:border-sky-600"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="block">
                <span className="text-[10px] text-gray-400">Private key</span>
                <input
                  type="password"
                  value={credsForm.privateKey}
                  onChange={(e) => setCredsForm((c) => ({ ...c, privateKey: e.target.value }))}
                  className="mt-0.5 w-full rounded border border-gray-600 bg-gray-950 px-2 py-1.5 font-mono text-[11px] text-gray-100 outline-none focus:border-sky-600"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={saveKeys}
                className="rounded bg-sky-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-600"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setKeysOpen(false)}
                className="rounded border border-gray-600 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={clearKeys}
                className="ml-auto rounded border border-red-900/60 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/40"
              >
                Clear stored keys
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
