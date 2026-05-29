// Polymarket CLOB client (browser): `@polymarket/clob-client-v2` + Vite node polyfills for HMAC.
// Builder attribution: V2 `builderCode` on the signed order — no backend `/api/builder-sign`.

import { ethers } from 'ethers';
import {
  Chain,
  ClobClient,
  OrderType,
  Side,
  SignatureTypeV2,
  type ApiKeyCreds,
  type SignedOrder,
} from '@polymarket/clob-client-v2';
import { API_BASE, POLYGON_ETHERS_NETWORK, POLYGON_JSONRPC_URL, vitePolyBuilderCode } from './env';
import { refreshSidebarOnchainWallet } from './sidebarOnchainTradesStore';
import { inferPolymarketClobSignatureType, resolvePolymarketMakerAddress } from './polymarketTradingMaker';
import { fetchProxyWallet } from '../api/polymarket';
import { getConnection } from '@wagmi/core';
import { wagmiAdapter } from './wallet';
import { signingDialog } from '../components/SigningDialog';
import { useAppStore } from '../stores/appStore';
import { getStoredPrivateKey } from '../components/PrivateKeyImportDialog';
import { polygon } from 'viem/chains';

const CLOB_URL = 'https://clob.polymarket.com';

function polyClobLog(payload: Record<string, unknown>) {
  console.info('[polyClob]', payload);
}

function apiKeyBrief(creds: StoredCreds | null | undefined): string {
  const k = creds?.key;
  return typeof k === 'string' && k.length >= 13 ? `${k.slice(0, 8)}…${k.slice(-4)}` : String(k ?? 'none');
}

function isSignerApiKeyMismatch(errorMsg: string): boolean {
  return /signer address has to be the address of the API KEY/i.test(errorMsg || '');
}

type StoredCreds = ApiKeyCreds;

interface PolyReplacePayload {
  order: SignedOrder;
  orderType: OrderType;
  signer: ethers.Signer;
  creds: StoredCreds;
  proxyWallet: string;
  signatureType: SignatureTypeV2;
}

const LEGACY_STORAGE_KEY = 'polymarket-api-creds-v2';
function storageKeyForEoa(eoa: string): string {
  return `polymarket-api-creds-v3:${eoa.trim().toLowerCase()}`;
}

function migrateLegacyCredsOnce(): void {
  try {
    const stored = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!stored) return;
    const parsed = JSON.parse(stored);
    const eoa = String(parsed.address || '').trim().toLowerCase();
    if (!eoa || !parsed.key || !parsed.secret || !parsed.passphrase) {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      storageKeyForEoa(eoa),
      JSON.stringify({
        key: parsed.key,
        secret: parsed.secret,
        passphrase: parsed.passphrase,
        proxyWallet: String(parsed.proxyWallet || '').trim().toLowerCase(),
      }),
    );
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}


let cachedAddress: string | null = null;
let cachedCreds: StoredCreds | null = null;
let cachedProxyWallet: string | null = null;
let cachedInferKey: string | null = null;
let cachedInferSigType: SignatureTypeV2 | null = null;
/** Last signing channel — wipe L2/infer memory only when the EOA changes; PK ↔ wallet same address keeps cached API creds. */
let lastSigningChannel: { mode: 'wallet' | 'privateKey'; addr: string } | null = null;

function loadStoredCredsForBundle(eoa: string, proxyWalletLc: string): boolean {
  migrateLegacyCredsOnce();
  const raw = localStorage.getItem(storageKeyForEoa(eoa));
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.key || !parsed?.secret || !parsed?.passphrase) return false;
    const storedPw = String(parsed.proxyWallet || '').trim().toLowerCase();
    const eoaLc = eoa.trim().toLowerCase();
    const makerLc = proxyWalletLc.trim().toLowerCase();
    // L2 creds are per signer EOA. Stored `proxyWallet` can disagree with freshly resolved maker
    // (Gamma lag, null→Safe, env) — refusing load caused re-L1 sign every PK↔wallet toggle.
    cachedCreds = {
      key: String(parsed.key),
      secret: String(parsed.secret),
      passphrase: String(parsed.passphrase),
    };
    cachedAddress = eoaLc;
    cachedProxyWallet = makerLc;
    if (storedPw !== makerLc) {
      polyClobLog({
        event: 'storedCredsProxyRealigned',
        eoa: eoaLc,
        stored: storedPw || '(empty)',
        current: makerLc,
      });
      persistCreds();
    }
    return true;
  } catch {
    return false;
  }
}

function persistCreds() {
  if (cachedCreds && cachedAddress && cachedProxyWallet) {
    localStorage.setItem(
      storageKeyForEoa(cachedAddress),
      JSON.stringify({
        key: cachedCreds.key,
        secret: cachedCreds.secret,
        passphrase: cachedCreds.passphrase,
        proxyWallet: cachedProxyWallet,
      }),
    );
  }
}

export function clearCachedCreds() {
  const a = cachedAddress;
  obliterateStoredCredsForEoa(a ?? '');
  cachedCreds = null;
  cachedAddress = null;
  cachedProxyWallet = null;
  cachedInferKey = null;
  cachedInferSigType = null;
  lastSigningChannel = null;
  deriveInflight.clear();
}

/** Drop in-memory L2 creds after PK ↔ wallet switch — next order reloads from disk or re-derives. */
export function invalidateClobMemoryCreds(): void {
  deriveInflight.clear();
  cachedCreds = null;
  cachedAddress = null;
  cachedProxyWallet = null;
  cachedInferKey = null;
  cachedInferSigType = null;
}

export async function resolveTradingMakerForActiveSigner(): Promise<string> {
  const signer = await getEthersSigner();
  const eoa = (await signer.getAddress()).toLowerCase();
  const pw = await fetchProxyWallet(eoa);
  return resolvePolymarketMakerAddress(eoa, pw);
}

/** Drop LS + in-memory creds for this EOA — safe when server rejects stale/mismatched bundle. */
function obliterateStoredCredsForEoa(eoaLc: string) {
  const lc = eoaLc.trim().toLowerCase();
  if (!lc) return;
  for (const k of [...deriveInflight.keys()]) {
    if (k.startsWith(`${lc}:`)) deriveInflight.delete(k);
  }
  try {
    localStorage.removeItem(storageKeyForEoa(lc));
  } catch {
    /* ignore */
  }
  if (cachedAddress?.toLowerCase() === lc) {
    cachedCreds = null;
    cachedAddress = null;
    cachedProxyWallet = null;
    cachedInferKey = null;
    cachedInferSigType = null;
  }
}

function credBundleMatches(makerWallet: string, signerEoa: string): boolean {
  const eoa = signerEoa.trim().toLowerCase();
  return (
    !!cachedCreds &&
    !!cachedAddress &&
    !!eoa &&
    cachedProxyWallet === makerWallet.trim().toLowerCase() &&
    cachedAddress === eoa
  );
}

export function hasCredsForWallet(makerWallet: string, signerEoa: string): boolean {
  const maker = makerWallet.trim().toLowerCase();
  const eoa = signerEoa.trim().toLowerCase();
  if (!eoa) return false;
  if (credBundleMatches(makerWallet, signerEoa)) return true;
  return loadStoredCredsForBundle(eoa, maker);
}

/** Read persisted L2 creds for user WS (same storage as CLOB trading). */
export function getStoredApiCredsForEoa(eoa: string): StoredCreds | null {
  const eoaLc = eoa.trim().toLowerCase();
  if (!eoaLc) return null;
  if (cachedCreds && cachedAddress === eoaLc) return cachedCreds;
  migrateLegacyCredsOnce();
  const raw = localStorage.getItem(storageKeyForEoa(eoaLc));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.key || !parsed?.secret || !parsed?.passphrase) return null;
    return {
      key: String(parsed.key),
      secret: String(parsed.secret),
      passphrase: String(parsed.passphrase),
    };
  } catch {
    return null;
  }
}

export async function ensureCredsForWallet(proxyWallet: string): Promise<void> {
  const signer = await getEthersSigner();
  await ensureCreds(signer, proxyWallet);
}

let _walletRefreshFn: (() => void) | null = null;
let _ordersRefreshFn: (() => void) | null = null;

export function setWalletRefreshFn(fn: () => void) {
  _walletRefreshFn = fn;
}

export function setOrdersRefreshFn(fn: () => void) {
  _ordersRefreshFn = fn;
}

export function triggerWalletRefresh() {
  if (_ordersRefreshFn) setTimeout(_ordersRefreshFn, 200);
  refreshSidebarOnchainWallet();
  setTimeout(refreshSidebarOnchainWallet, 2500);
  if (_walletRefreshFn) {
    _walletRefreshFn();
    setTimeout(_walletRefreshFn, 1500);
  }
}

export async function refreshOpenOrdersInStore(proxyWallet: string): Promise<void> {
  const orders = await fetchOpenOrdersDirect(proxyWallet);
  useAppStore.getState().setMarketData({ orders });
}

export async function sendCredsToBackend(): Promise<boolean> {
  const signer = await getEthersSigner();
  const address = (await signer.getAddress()).toLowerCase();
  const resp = await fetch(`${API_BASE}/api/polyproxy/gamma/users?address=${address}`);
  const users = await resp.json();
  const gammaPw = users?.[0]?.proxyWallet != null ? String(users[0].proxyWallet) : null;
  const proxyWallet = resolvePolymarketMakerAddress(address, gammaPw);
  await ensureCreds(signer, proxyWallet);
  const sendResp = await fetch('/api/auth/creds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress: address,
      proxyWallet,
      apiKey: cachedCreds!.key,
      apiSecret: cachedCreds!.secret,
      passphrase: cachedCreds!.passphrase,
    }),
  });
  if (!sendResp.ok) {
    const err = await sendResp.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || 'Failed to send credentials to backend');
  }
  return true;
}

export async function checkBackendAuth(): Promise<boolean> {
  try {
    const resp = await fetch('/api/auth/status');
    const data = await resp.json();
    return !!data.authenticated;
  } catch {
    return false;
  }
}

export async function getEthersSigner(): Promise<ethers.Signer> {
  const { signingMode } = useAppStore.getState();
  if (signingMode === 'privateKey') {
    const pk = getStoredPrivateKey();
    if (pk) {
      // JsonRpcProvider probes eth_chainId (detectNetwork) — often fails in browser (CORS / flaky RPC) → NO_NETWORK.
      // StaticJsonRpcProvider trusts chain 137 and only uses RPC for transactions.
      const provider = new ethers.providers.StaticJsonRpcProvider(POLYGON_JSONRPC_URL, POLYGON_ETHERS_NETWORK);
      const w = new ethers.Wallet(pk, provider);
      await noteActiveSigningChannel(w);
      return w;
    }
  }
  const conn = getConnection(wagmiAdapter.wagmiConfig);
  if (conn.status !== 'connected' || !conn.connector || !conn.address) {
    throw new Error('No wallet connected');
  }
  const chainId = conn.chainId;
  if (chainId != null && chainId !== polygon.id) {
    throw new Error(`Switch wallet to Polygon (chain ${polygon.id}) for merges and trading`);
  }

  let eip1193: unknown;
  try {
    eip1193 = await conn.connector.getProvider?.({ chainId: polygon.id });
  } catch {
    eip1193 = undefined;
  }
  if (!eip1193 || typeof (eip1193 as { request?: unknown }).request !== 'function') {
    try {
      eip1193 = await conn.connector.getProvider?.();
    } catch {
      /* ignore */
    }
  }

  const ext = eip1193 as ethers.providers.ExternalProvider | null;
  if (!ext || typeof (ext as { request?: unknown }).request !== 'function') {
    throw new Error('Wallet EIP-1193 provider unavailable — reconnect wallet');
  }

  const ethersProvider = new ethers.providers.Web3Provider(ext, 'any');
  const s = ethersProvider.getSigner(conn.address);
  await noteActiveSigningChannel(s);
  return s;
}

function builderConfig():
  | {
      builderCode: string;
    }
  | undefined {
  const code = vitePolyBuilderCode();
  if (!code) return undefined;
  return { builderCode: code };
}

async function deriveOrCreateApiKey(signer: ethers.Signer): Promise<StoredCreds> {
  const rawAddr = await signer.getAddress();
  const chk = ethers.utils.getAddress(rawAddr);
  polyClobLog({
    event: 'deriveApiKeySigner',
    fromWallet: String(rawAddr),
    checksum: chk,
    match: chk.toLowerCase() === rawAddr.trim().toLowerCase(),
  });
  const l1 = new ClobClient({
    host: CLOB_URL,
    chain: Chain.POLYGON,
    signer: signer as any,
  });
  try {
    const d = await l1.deriveApiKey();
    if (d?.key) return d;
  } catch {
    /* create */
  }
  return l1.createApiKey();
}

/** Discard cached L2 secrets and align with server via derive (preferred) — never call create-only; server returns 400 if key exists. */
async function wipeStaleCredsAndReDeriveApi(signer: ethers.Signer, proxyLc: string): Promise<StoredCreds> {
  const addr = (await signer.getAddress()).toLowerCase();
  polyClobLog({ event: 'wipeStaleCredsReDerive', eoa: addr, maker: proxyLc });
  obliterateStoredCredsForEoa(addr);
  const creds = await deriveOrCreateApiKey(signer);
  cachedAddress = addr;
  cachedCreds = creds;
  cachedProxyWallet = proxyLc;
  cachedInferKey = null;
  cachedInferSigType = null;
  persistCreds();
  polyClobLog({ event: 'reDerivedApiCreds', eoa: addr, maker: proxyLc, apiKey: apiKeyBrief(creds) });
  return creds;
}

const deriveInflight = new Map<string, Promise<StoredCreds>>();

async function noteActiveSigningChannel(signer: ethers.Signer): Promise<void> {
  const mode = useAppStore.getState().signingMode;
  const addr = (await signer.getAddress()).toLowerCase();
  if (lastSigningChannel === null) {
    lastSigningChannel = { mode, addr };
    return;
  }
  if (lastSigningChannel.mode === mode && lastSigningChannel.addr === addr) return;

  const prev = lastSigningChannel;
  lastSigningChannel = { mode, addr };
  const addrChanged = prev.addr !== addr;
  const modeChanged = prev.mode !== mode;
  polyClobLog({
    event: 'signingChannelBumped',
    addrChanged,
    modeChanged,
    from: `${prev.mode}:${prev.addr}`,
    to: `${mode}:${addr}`,
  });

  deriveInflight.clear();
  if (addrChanged || modeChanged) {
    cachedCreds = null;
    cachedAddress = null;
    cachedProxyWallet = null;
    cachedInferKey = null;
    cachedInferSigType = null;
  }
}

async function ensureCreds(signer: ethers.Signer, proxyWallet: string): Promise<StoredCreds> {
  await noteActiveSigningChannel(signer);
  const addr = (await signer.getAddress()).toLowerCase();
  const proxyLc = proxyWallet.trim().toLowerCase();
  const inflightKey = `${addr}:${proxyLc}`;
  const running = deriveInflight.get(inflightKey);
  if (running) return running;

  const work = (async (): Promise<StoredCreds> => {
    migrateLegacyCredsOnce();
    const memOk = cachedCreds && cachedAddress === addr && cachedProxyWallet === proxyLc;
    const diskOk = memOk ? true : loadStoredCredsForBundle(addr, proxyLc);
    if (memOk) {
      polyClobLog({ event: 'ensureCreds', source: 'memory', eoa: addr, maker: proxyLc, apiKey: apiKeyBrief(cachedCreds) });
      return cachedCreds!;
    }
    if (diskOk) {
      polyClobLog({ event: 'ensureCreds', source: 'disk', eoa: addr, maker: proxyLc, apiKey: apiKeyBrief(cachedCreds) });
      return cachedCreds!;
    }

    const creds = await deriveOrCreateApiKey(signer);
    cachedAddress = addr;
    cachedCreds = creds;
    cachedProxyWallet = proxyLc;
    cachedInferKey = null;
    cachedInferSigType = null;
    persistCreds();
    polyClobLog({ event: 'ensureCreds', source: 'derived', eoa: addr, maker: proxyLc, apiKey: apiKeyBrief(creds) });
    return creds;
  })();

  deriveInflight.set(inflightKey, work);
  try {
    return await work;
  } finally {
    if (deriveInflight.get(inflightKey) === work) deriveInflight.delete(inflightKey);
  }
}

async function tradingSignatureType(eoa: string, maker: string): Promise<SignatureTypeV2> {
  const k = `${eoa.toLowerCase()}:${maker.toLowerCase()}`;
  if (cachedInferKey === k && cachedInferSigType !== null) return cachedInferSigType;
  const t = await inferPolymarketClobSignatureType(eoa, maker, POLYGON_JSONRPC_URL);
  cachedInferKey = k;
  cachedInferSigType = t;
  return t;
}

/**
 * Trading client (HMAC headers + posting + cancel + open-orders) — uses the REAL EOA signer
 * so `POLY_ADDRESS` matches the API key's owner on the server. Never used for `createOrder`
 * on POLY_1271 — `buildOrderSignerClient` wraps the signer for that path.
 */
function makeTradingClient(
  signer: ethers.Signer,
  tradingMakerAddress: string,
  creds: StoredCreds,
  signatureType: SignatureTypeV2,
): ClobClient {
  return new ClobClient({
    host: CLOB_URL,
    chain: Chain.POLYGON,
    signer: signer as any,
    creds,
    signatureType,
    funderAddress: tradingMakerAddress.toLowerCase(),
    builderConfig: builderConfig(),
  });
}

/**
 * Order-builder client. POLY_1271 deposit orders: `order.signer` MUST be the deposit/maker (1271 contract),
 * not the EOA — clob-client-v2 v1.0.2 enforces `order.signer === await signer.getAddress()`. Wrap so `getAddress`
 * returns the maker; `_signTypedData` delegates to the real EOA so the EIP-712 sig still recovers to the deposit owner.
 *
 * For other signature types this is a no-op (just returns a `makeTradingClient`).
 */
function buildOrderSignerClient(
  signer: ethers.Signer,
  tradingMakerAddress: string,
  creds: StoredCreds,
  signatureType: SignatureTypeV2,
): ClobClient {
  if (signatureType !== SignatureTypeV2.POLY_1271) {
    return makeTradingClient(signer, tradingMakerAddress, creds, signatureType);
  }
  const wrapped = signerWithMakerAddress(signer, tradingMakerAddress);
  return new ClobClient({
    host: CLOB_URL,
    chain: Chain.POLYGON,
    signer: wrapped as any,
    creds,
    signatureType,
    funderAddress: tradingMakerAddress.toLowerCase(),
    builderConfig: builderConfig(),
  });
}

/**
 * For POLY_1271 orders we don't want clob-client-v2 to prompt the wallet at all — its flat EIP-712
 * signature is thrown away and replaced with the nested ERC-7739 TypedDataSign blob. Stub
 * `_signTypedData` / `signMessage` to return zero bytes so the wallet only prompts once (our own sign).
 */
const DUMMY_SIG_HEX = `0x${'0'.repeat(130)}`;

function signerWithMakerAddress(signer: ethers.Signer, makerAddress: string): ethers.Signer {
  const makerChecksum = ethers.utils.getAddress(makerAddress.trim());
  return new Proxy(signer as object, {
    get(_t, prop, recv) {
      if (prop === 'getAddress') return async () => makerChecksum;
      if (prop === '_signTypedData' || prop === 'signTypedData') {
        return async () => DUMMY_SIG_HEX;
      }
      if (prop === 'signMessage') return async () => DUMMY_SIG_HEX;
      const v = Reflect.get(signer, prop, recv);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(signer) : v;
    },
  }) as ethers.Signer;
}

/** CTF Exchange V2 verifying-contract addresses (Polygon). */
const CTF_EXCHANGE_V2 = '0xE111180000d2663C0091e4f400237545B87B996B';
const NEG_RISK_CTF_EXCHANGE_V2 = '0xe2222d279d744050d28e00520010520000310F59';

const POLY1271_ORDER_TYPE_STRING =
  'Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)';

const POLY1271_ORDER_FIELDS = [
  { name: 'salt', type: 'uint256' },
  { name: 'maker', type: 'address' },
  { name: 'signer', type: 'address' },
  { name: 'tokenId', type: 'uint256' },
  { name: 'makerAmount', type: 'uint256' },
  { name: 'takerAmount', type: 'uint256' },
  { name: 'side', type: 'uint8' },
  { name: 'signatureType', type: 'uint8' },
  { name: 'timestamp', type: 'uint256' },
  { name: 'metadata', type: 'bytes32' },
  { name: 'builder', type: 'bytes32' },
] as const;

/**
 * Polymarket POLY_1271 deposit signature — ERC-7739 "nested TypedDataSign":
 *   innerSig (65) || appDomainSep (32) || contentsHash (32) || orderTypeString || uint16BE(orderTypeString.length)
 *
 * `clob-client-v2` v1.0.2 only produces the flat 65-byte EIP-712 sig (rejected with "invalid signature" by Polymarket's
 * 1271 deposit contract). Mirrors mitobot's `signPoly1271DepositOrder`.
 */
async function signPoly1271DepositOrder(
  realSigner: ethers.Signer,
  exchangeContract: string,
  signed: SignedOrder,
  chainId: number,
): Promise<string> {
  const orderMsg = {
    salt: ethers.BigNumber.from(signed.salt as unknown as ethers.BigNumberish).toString(),
    maker: ethers.utils.getAddress(signed.maker),
    signer: ethers.utils.getAddress(signed.signer),
    tokenId: ethers.BigNumber.from(signed.tokenId as unknown as ethers.BigNumberish).toString(),
    makerAmount: ethers.BigNumber.from(signed.makerAmount as unknown as ethers.BigNumberish).toString(),
    takerAmount: ethers.BigNumber.from(signed.takerAmount as unknown as ethers.BigNumberish).toString(),
    side: signed.side === 'BUY' ? 0 : 1,
    signatureType: Number(signed.signatureType),
    timestamp: ethers.BigNumber.from(signed.timestamp as unknown as ethers.BigNumberish).toString(),
    metadata: signed.metadata,
    builder: signed.builder,
  };

  const contentsHash = ethers.utils._TypedDataEncoder.hashStruct(
    'Order',
    { Order: [...POLY1271_ORDER_FIELDS] },
    orderMsg,
  );

  const appDomain = {
    name: 'Polymarket CTF Exchange',
    version: '2',
    chainId,
    verifyingContract: ethers.utils.getAddress(exchangeContract),
  };
  const appDomainSep = ethers.utils._TypedDataEncoder.hashDomain(appDomain);

  const typedDataSignTypes = {
    TypedDataSign: [
      { name: 'contents', type: 'Order' },
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
      { name: 'salt', type: 'bytes32' },
    ],
    Order: [...POLY1271_ORDER_FIELDS],
  };
  const innerMessage = {
    contents: orderMsg,
    name: 'DepositWallet',
    version: '1',
    chainId,
    verifyingContract: orderMsg.signer,
    salt: ethers.constants.HashZero,
  };
  const innerSigHex = await (realSigner as unknown as {
    _signTypedData: (
      domain: ethers.TypedDataDomain,
      types: Record<string, ethers.TypedDataField[]>,
      value: Record<string, unknown>,
    ) => Promise<string>;
  })._signTypedData(appDomain, typedDataSignTypes, innerMessage);

  const innerSig = ethers.utils.arrayify(innerSigHex);
  const appSep = ethers.utils.arrayify(appDomainSep);
  const contents = ethers.utils.arrayify(contentsHash);
  const typeStr = ethers.utils.toUtf8Bytes(POLY1271_ORDER_TYPE_STRING);
  if (typeStr.length > 0xffff) throw new Error('order type string too long');
  const lenBE = new Uint8Array([(typeStr.length >> 8) & 0xff, typeStr.length & 0xff]);

  return ethers.utils.hexlify(ethers.utils.concat([innerSig, appSep, contents, typeStr, lenBE]));
}

async function applyPoly1271DepositSignature(
  realSigner: ethers.Signer,
  signed: SignedOrder,
  negRisk: boolean,
): Promise<SignedOrder> {
  const exchange = negRisk ? NEG_RISK_CTF_EXCHANGE_V2 : CTF_EXCHANGE_V2;
  const sigBlob = await signPoly1271DepositOrder(realSigner, exchange, signed, 137);
  polyClobLog({
    event: 'poly1271NestedSig',
    exchange,
    signer: signed.signer,
    maker: signed.maker,
    sigLen: (sigBlob.length - 2) / 2,
  });
  return { ...signed, signature: sigBlob };
}

function toTickSize(raw: string): '0.1' | '0.01' | '0.001' | '0.0001' {
  if (raw === '0.1' || raw === '0.01' || raw === '0.001' || raw === '0.0001') return raw;
  return '0.01';
}

function mapOrderType(
  explicit: 'GTC' | 'GTD' | 'FAK' | 'FOK' | undefined,
  useGTD: boolean,
): OrderType {
  if (explicit === 'FAK') return OrderType.FAK;
  if (explicit === 'FOK') return OrderType.FOK;
  if (explicit === 'GTD' || useGTD) return OrderType.GTD;
  return OrderType.GTC;
}

function parsePostOrder(res: unknown): { orderID?: string; error?: string } {
  if (res == null || typeof res !== 'object') return { error: 'empty response' };
  const r = res as Record<string, unknown>;
  if (r.error != null) return { error: String(r.error) };
  if (r.errorMsg != null) return { error: String(r.errorMsg) };
  const orderID =
    r.orderID != null || r.orderId != null || r.id != null
      ? String(r.orderID ?? r.orderId ?? r.id)
      : undefined;
  return { orderID };
}

function adjustedSellSizeFromBalanceError(errMsg: string, currentSize: number): number | null {
  const m = /balance:\s*([0-9]+)\s*,\s*order amount:\s*([0-9]+)/i.exec(errMsg);
  if (!m) return null;
  const balanceRaw = parseInt(m[1], 10);
  const orderAmtRaw = parseInt(m[2], 10);
  if (!Number.isFinite(balanceRaw) || !Number.isFinite(orderAmtRaw) || balanceRaw <= 0 || orderAmtRaw <= 0)
    return null;
  if (balanceRaw >= orderAmtRaw) return null;
  const f = Math.pow(10, 2);
  const maxByBalance = Math.max(0, Math.floor((balanceRaw - 1) / 1e6 * f) / f);
  if (!Number.isFinite(maxByBalance) || maxByBalance <= 0) return null;
  if (maxByBalance >= currentSize) return null;
  return maxByBalance;
}

export async function fetchOpenOrdersDirect(proxyWallet: string): Promise<any[]> {
  try {
    const signer = await getEthersSigner();
    const eoa = (await signer.getAddress()).toLowerCase();
    if (!hasCredsForWallet(proxyWallet, eoa)) return [];
    const sig = await tradingSignatureType(eoa, proxyWallet);
    const client = makeTradingClient(signer, proxyWallet, cachedCreds!, sig);
    let data: unknown;
    try {
      data = await client.getOpenOrders();
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 401) {
        obliterateStoredCredsForEoa(eoa);
        polyClobLog({ event: 'openOrders401Wipe', eoa, maker: proxyWallet.trim().toLowerCase() });
      }
      throw e;
    }
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.warn('[clobClient] fetchOpenOrders error:', err);
    return [];
  }
}

export async function placeOrderDirect(params: {
  tokenId: string;
  side: string;
  price: number;
  size: number;
  expiration?: number;
  proxyWallet: string;
  skipDialog?: boolean;
  orderInfo?: string;
  orderType?: 'GTC' | 'GTD' | 'FAK' | 'FOK';
}): Promise<{ success: boolean; orderID?: string; error?: string }> {
  const sd = params.skipDialog
    ? { open: () => {}, setStep: (() => {}) as typeof signingDialog.setStep, close: () => {} }
    : signingDialog;
  try {
    const signer = await getEthersSigner();
    const eoaPrecheck = (await signer.getAddress()).toLowerCase();
    if (cachedAddress && cachedAddress !== eoaPrecheck) {
      invalidateClobMemoryCreds();
    }
    const needsAuth = !hasCredsForWallet(params.proxyWallet, eoaPrecheck);
    sd.open(needsAuth, { orderInfo: params.orderInfo });

    let creds = await ensureCreds(signer, params.proxyWallet);
    const eoa = eoaPrecheck;
    const makerLc = params.proxyWallet.trim().toLowerCase();
    let sig = await tradingSignatureType(eoa, params.proxyWallet);
    const sigLabels = ['EOA', 'POLY_PROXY', 'POLY_GNOSIS_SAFE', 'POLY_1271'] as const;
    polyClobLog({
      event: 'placeOrderClobReady',
      eoa,
      maker: makerLc,
      sigType: sig,
      sigTypeLabel: sigLabels[sig as number] ?? String(sig),
      apiKey: apiKeyBrief(creds),
    });
    let postClient = makeTradingClient(signer, params.proxyWallet, creds, sig);
    let buildClient = buildOrderSignerClient(signer, params.proxyWallet, creds, sig);
    sd.setStep('auth', 'done');

    sd.setStep('sign', 'active');
    const [tickSizeData, negRiskData] = await Promise.all([
      fetch(`${CLOB_URL}/tick-size?token_id=${params.tokenId}`).then((r) => r.json()),
      fetch(`${CLOB_URL}/neg-risk?token_id=${params.tokenId}`).then((r) => r.json()),
    ]);
    const tickSize = toTickSize(String(tickSizeData.minimum_tick_size || '0.01'));
    const negRisk = negRiskData.neg_risk === true;
    const useGTD = !!(params.expiration && params.expiration > 0);
    const orderTypeEnum = mapOrderType(params.orderType, useGTD);

    const userOrder = {
      tokenID: params.tokenId,
      price: params.price,
      size: params.size,
      side: params.side === 'BUY' ? Side.BUY : Side.SELL,
      expiration: params.expiration ?? 0,
    };

    const buildAndSign = async (uo: typeof userOrder, ts: typeof tickSize) => {
      const built = await buildClient.createOrder(uo, { tickSize: ts, negRisk });
      return sig === SignatureTypeV2.POLY_1271
        ? await applyPoly1271DepositSignature(signer, built, negRisk)
        : built;
    };

    let signed = await buildAndSign(userOrder, tickSize);
    sd.setStep('sign', 'done');

    sd.setStep('submit', 'active');
    let res = await postClient.postOrder(signed, orderTypeEnum);
    let parsed = parsePostOrder(res);

    if (parsed.error) {
      const errMsg = parsed.error;
      if (params.side === 'SELL') {
        const adjustedSize = adjustedSellSizeFromBalanceError(errMsg, params.size);
        if (adjustedSize != null) {
          const u2 = { ...userOrder, size: adjustedSize };
          signed = await buildAndSign(u2, tickSize);
          res = await postClient.postOrder(signed, orderTypeEnum);
          parsed = parsePostOrder(res);
        }
      }
      if (parsed.error && (parsed.error.includes('invalid tick size') || errMsg.includes('invalid tick size'))) {
        const retryTick = await fetch(`${CLOB_URL}/tick-size?token_id=${params.tokenId}`).then((r) => r.json());
        const ts2 = toTickSize(String(retryTick.minimum_tick_size || '0.01'));
        signed = await buildAndSign(userOrder, ts2);
        res = await postClient.postOrder(signed, orderTypeEnum);
        parsed = parsePostOrder(res);
      }
      if (parsed.error && isSignerApiKeyMismatch(parsed.error)) {
        const ord = signed as { signer?: string };
        polyClobLog({
          event: 'order400SignerMismatchRetry',
          eoa,
          maker: makerLc,
          orderSigner: ord.signer,
          err: parsed.error,
          hadApiKey: apiKeyBrief(creds),
        });
        creds = await wipeStaleCredsAndReDeriveApi(signer, makerLc);
        postClient = makeTradingClient(signer, params.proxyWallet, creds, sig);
        buildClient = buildOrderSignerClient(signer, params.proxyWallet, creds, sig);
        signed = await buildAndSign(userOrder, tickSize);
        res = await postClient.postOrder(signed, orderTypeEnum);
        parsed = parsePostOrder(res);
      }
      if (parsed.error) {
        sd.setStep('submit', 'error', parsed.error);
        return { success: false, error: parsed.error };
      }
    }

    sd.setStep('submit', 'done');
    setTimeout(() => sd.close(), 1200);
    return { success: true, orderID: parsed.orderID };
  } catch (err: any) {
    if (!cachedCreds) sd.setStep('auth', 'error', err.message);
    else sd.setStep('sign', 'error', err.message);
    return { success: false, error: err.message };
  }
}

export async function signOrderOnly(params: {
  tokenId: string;
  side: string;
  price: number;
  size: number;
  expiration?: number;
  proxyWallet: string;
}): Promise<{ success: boolean; signedPayload?: PolyReplacePayload; error?: string }> {
  try {
    const signer = await getEthersSigner();
    const creds = await ensureCreds(signer, params.proxyWallet);
    const eoa = (await signer.getAddress()).toLowerCase();
    const sig = await tradingSignatureType(eoa, params.proxyWallet);
    const buildClient = buildOrderSignerClient(signer, params.proxyWallet, creds, sig);

    const [tickSizeData, negRiskData] = await Promise.all([
      fetch(`${CLOB_URL}/tick-size?token_id=${params.tokenId}`).then((r) => r.json()),
      fetch(`${CLOB_URL}/neg-risk?token_id=${params.tokenId}`).then((r) => r.json()),
    ]);
    const tickSize = toTickSize(String(tickSizeData.minimum_tick_size || '0.01'));
    const negRisk = negRiskData.neg_risk === true;
    const useGTD = !!(params.expiration && params.expiration > 0);
    const orderType = useGTD ? OrderType.GTD : OrderType.GTC;

    const built = await buildClient.createOrder(
      {
        tokenID: params.tokenId,
        price: params.price,
        size: params.size,
        side: params.side === 'BUY' ? Side.BUY : Side.SELL,
        expiration: params.expiration ?? 0,
      },
      { tickSize, negRisk },
    );
    const order =
      sig === SignatureTypeV2.POLY_1271
        ? await applyPoly1271DepositSignature(signer, built, negRisk)
        : built;

    return {
      success: true,
      signedPayload: { order, orderType, signer, creds, proxyWallet: params.proxyWallet, signatureType: sig },
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function submitSignedOrderDirect(
  signedPayload: PolyReplacePayload,
): Promise<{ success: boolean; orderID?: string; error?: string }> {
  try {
    const { order, orderType, signer, proxyWallet, signatureType } = signedPayload;
    const addr = (await signer.getAddress()).toLowerCase();
    const ord = order as { signer?: string };
    const expectedSigner =
      signatureType === SignatureTypeV2.POLY_1271 ? proxyWallet.trim().toLowerCase() : addr;
    if (typeof ord.signer === 'string' && ord.signer.trim().toLowerCase() !== expectedSigner) {
      return { success: false, error: 'Order signer does not match the active wallet.' };
    }
    let creds = await ensureCreds(signer, proxyWallet);
    let client = makeTradingClient(signer, proxyWallet, creds, signatureType);
    let res = await client.postOrder(order, orderType);
    let parsed = parsePostOrder(res);
    if (parsed.error && isSignerApiKeyMismatch(parsed.error)) {
      const makerLc = proxyWallet.trim().toLowerCase();
      const ord = order as { signer?: string };
      polyClobLog({
        event: 'submit400SignerMismatchRetry',
        eoa: addr,
        maker: makerLc,
        orderSigner: ord.signer,
        err: parsed.error,
        hadApiKey: apiKeyBrief(creds),
      });
      creds = await wipeStaleCredsAndReDeriveApi(signer, makerLc);
      client = makeTradingClient(signer, proxyWallet, creds, signatureType);
      res = await client.postOrder(order, orderType);
      parsed = parsePostOrder(res);
    }
    if (parsed.error) return { success: false, error: parsed.error };
    return { success: true, orderID: parsed.orderID };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function cancelOrderDirect(
  orderId: string,
  proxyWallet: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const signer = await getEthersSigner();
    const creds = await ensureCreds(signer, proxyWallet);
    const eoa = (await signer.getAddress()).toLowerCase();
    const sig = await tradingSignatureType(eoa, proxyWallet);
    const client = makeTradingClient(signer, proxyWallet, creds, sig);
    const data = (await client.cancelOrder({ orderID: orderId })) as Record<string, unknown>;

    if (data.error || data.errorMsg) {
      return { success: false, error: String(data.error || data.errorMsg) };
    }

    const oid = orderId.trim().toLowerCase();
    const canceledRaw = data.canceled;
    const notCanceledRaw = data.not_canceled;
    const canceled: string[] = Array.isArray(canceledRaw) ? canceledRaw.map((x) => String(x)) : [];
    const notCanceled: Record<string, string> =
      notCanceledRaw && typeof notCanceledRaw === 'object' && !Array.isArray(notCanceledRaw)
        ? (notCanceledRaw as Record<string, string>)
        : {};

    for (const k of Object.keys(notCanceled)) {
      if (String(k).trim().toLowerCase() === oid) {
        const reason = notCanceled[k];
        return {
          success: false,
          error: String(reason || 'Order could not be cancelled (e.g. already matched or not found)'),
        };
      }
    }

    const listedAsCanceled = canceled.some((id) => String(id).trim().toLowerCase() === oid);
    if (listedAsCanceled) return { success: true };

    if (canceled.length === 0 && Object.keys(notCanceled).length === 0) {
      return {
        success: false,
        error: 'Unexpected cancel response; order may have executed. Not assuming cancel succeeded.',
      };
    }

    return {
      success: false,
      error: 'Order was not in the cancelled list; it may have filled. Replacement aborted.',
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function cancelOrdersDirect(
  orderIds: string[],
  proxyWallet: string,
): Promise<{ success: boolean; error?: string; cancelled?: number }> {
  const ids = orderIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return { success: true, cancelled: 0 };
  try {
    const signer = await getEthersSigner();
    const creds = await ensureCreds(signer, proxyWallet);
    const eoa = (await signer.getAddress()).toLowerCase();
    const sig = await tradingSignatureType(eoa, proxyWallet);
    const client = makeTradingClient(signer, proxyWallet, creds, sig);
    const data = (await client.cancelOrders(ids)) as Record<string, unknown>;

    if (data.error || data.errorMsg) {
      return { success: false, error: String(data.error || data.errorMsg) };
    }

    const canceledRaw = data.canceled;
    const notCanceledRaw = data.not_canceled;
    const canceled: string[] = Array.isArray(canceledRaw) ? canceledRaw.map((x) => String(x)) : [];
    const notCanceled: Record<string, string> =
      notCanceledRaw && typeof notCanceledRaw === 'object' && !Array.isArray(notCanceledRaw)
        ? (notCanceledRaw as Record<string, string>)
        : {};

    if (canceled.length === 0 && Object.keys(notCanceled).length > 0) {
      const firstReason = Object.values(notCanceled)[0];
      return { success: false, error: String(firstReason || 'Cancel failed'), cancelled: 0 };
    }

    if (canceled.length === 0 && Object.keys(notCanceled).length === 0) {
      return {
        success: false,
        error: 'Unexpected cancel response; orders may have executed.',
        cancelled: 0,
      };
    }

    return { success: true, cancelled: canceled.length };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
