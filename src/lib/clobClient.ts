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
import { inferPolymarketClobSignatureType, resolvePolymarketMakerAddress } from './polymarketTradingMaker';
import { getConnection } from '@wagmi/core';
import { wagmiAdapter } from './wallet';
import { signingDialog } from '../components/SigningDialog';
import { useAppStore } from '../stores/appStore';
import { getStoredPrivateKey } from '../components/PrivateKeyImportDialog';
import { polygon } from 'viem/chains';

const CLOB_URL = 'https://clob.polymarket.com';

type StoredCreds = ApiKeyCreds;

interface PolyReplacePayload {
  order: SignedOrder;
  orderType: OrderType;
  signer: ethers.Signer;
  creds: StoredCreds;
  proxyWallet: string;
  signatureType: SignatureTypeV2;
}

const STORAGE_KEY = 'polymarket-api-creds-v2';

/** CLOB stores API keys under the L1 `ClobAuth.address` string; checksummed vs lowercase breaks POST /order (400 signer vs API key). */
function lowerAddressSignerForClobClient(signer: ethers.Signer): ethers.Signer {
  return new Proxy(signer as object, {
    get(_target, prop, receiver) {
      if (prop === 'getAddress') {
        return async () => {
          const a = await signer.getAddress();
          return typeof a === 'string' ? a.trim().toLowerCase() : a;
        };
      }
      const v = Reflect.get(signer, prop, receiver);
      return typeof v === 'function' ? (v as (...args: unknown[]) => unknown).bind(signer) : v;
    },
  }) as ethers.Signer;
}
let cachedAddress: string | null = null;
let cachedCreds: StoredCreds | null = null;
let cachedProxyWallet: string | null = null;
let cachedInferKey: string | null = null;
let cachedInferSigType: SignatureTypeV2 | null = null;

try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    if (parsed.key && parsed.secret && parsed.passphrase && parsed.address && parsed.proxyWallet) {
      cachedCreds = { key: parsed.key, secret: parsed.secret, passphrase: parsed.passphrase };
      cachedAddress = String(parsed.address).trim().toLowerCase();
      cachedProxyWallet = String(parsed.proxyWallet).trim().toLowerCase();
    }
  }
} catch {
  /* ignore */
}

function persistCreds() {
  if (cachedCreds && cachedAddress && cachedProxyWallet) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        key: cachedCreds.key,
        secret: cachedCreds.secret,
        passphrase: cachedCreds.passphrase,
        address: cachedAddress,
        proxyWallet: cachedProxyWallet,
      }),
    );
  }
}

export function clearCachedCreds() {
  cachedCreds = null;
  cachedAddress = null;
  cachedProxyWallet = null;
  cachedInferKey = null;
  cachedInferSigType = null;
  localStorage.removeItem(STORAGE_KEY);
}

/** Cached L2 creds are scoped to BOTH signing EOA and Polymarket maker — mismatch caused "signer … API KEY" rejects. */
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
  return credBundleMatches(makerWallet, signerEoa);
}

export async function ensureCredsForWallet(proxyWallet: string): Promise<void> {
  const signer = await getEthersSigner();
  await ensureCreds(signer, proxyWallet);
}

let _walletRefreshFn: (() => void) | null = null;
export function setWalletRefreshFn(fn: () => void) {
  _walletRefreshFn = fn;
}
export function triggerWalletRefresh() {
  if (_walletRefreshFn) setTimeout(_walletRefreshFn, 1500);
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
      return new ethers.Wallet(pk, provider);
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
  return ethersProvider.getSigner(conn.address);
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
  const w = lowerAddressSignerForClobClient(signer);
  const l1 = new ClobClient({
    host: CLOB_URL,
    chain: Chain.POLYGON,
    signer: w as any,
  });
  try {
    const d = await l1.deriveApiKey();
    if (d?.key) return d;
  } catch {
    /* create */
  }
  return l1.createApiKey();
}

async function ensureCreds(signer: ethers.Signer, proxyWallet: string): Promise<StoredCreds> {
  const addr = (await signer.getAddress()).toLowerCase();
  if (cachedCreds && cachedAddress === addr && cachedProxyWallet === proxyWallet.toLowerCase()) {
    return cachedCreds;
  }
  const creds = await deriveOrCreateApiKey(signer);
  cachedAddress = addr;
  cachedCreds = creds;
  cachedProxyWallet = proxyWallet.toLowerCase();
  cachedInferKey = null;
  cachedInferSigType = null;
  persistCreds();
  return creds;
}

async function tradingSignatureType(eoa: string, maker: string): Promise<SignatureTypeV2> {
  const k = `${eoa.toLowerCase()}:${maker.toLowerCase()}`;
  if (cachedInferKey === k && cachedInferSigType !== null) return cachedInferSigType;
  const t = await inferPolymarketClobSignatureType(eoa, maker, POLYGON_JSONRPC_URL);
  cachedInferKey = k;
  cachedInferSigType = t;
  return t;
}

function makeTradingClient(
  signer: ethers.Signer,
  tradingMakerAddress: string,
  creds: StoredCreds,
  signatureType: SignatureTypeV2,
): ClobClient {
  const w = lowerAddressSignerForClobClient(signer);
  return new ClobClient({
    host: CLOB_URL,
    chain: Chain.POLYGON,
    signer: w as any,
    creds,
    signatureType,
    funderAddress: tradingMakerAddress.toLowerCase(),
    builderConfig: builderConfig(),
  });
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
    if (!credBundleMatches(proxyWallet, eoa)) return [];
    const sig = await tradingSignatureType(eoa, proxyWallet);
    const client = makeTradingClient(signer, proxyWallet, cachedCreds!, sig);
    const data = await client.getOpenOrders();
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
    const needsAuth = !credBundleMatches(params.proxyWallet, eoaPrecheck);
    sd.open(needsAuth, { orderInfo: params.orderInfo });

    const creds = await ensureCreds(signer, params.proxyWallet);
    const eoa = eoaPrecheck;
    const sig = await tradingSignatureType(eoa, params.proxyWallet);
    const client = makeTradingClient(signer, params.proxyWallet, creds, sig);
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

    let signed = await client.createOrder(userOrder, { tickSize, negRisk });
    sd.setStep('sign', 'done');

    sd.setStep('submit', 'active');
    let res = await client.postOrder(signed, orderTypeEnum);
    let parsed = parsePostOrder(res);

    if (parsed.error) {
      const errMsg = parsed.error;
      if (params.side === 'SELL') {
        const adjustedSize = adjustedSellSizeFromBalanceError(errMsg, params.size);
        if (adjustedSize != null) {
          const u2 = { ...userOrder, size: adjustedSize };
          signed = await client.createOrder(u2, { tickSize, negRisk });
          res = await client.postOrder(signed, orderTypeEnum);
          parsed = parsePostOrder(res);
        }
      }
      if (parsed.error && (parsed.error.includes('invalid tick size') || errMsg.includes('invalid tick size'))) {
        const retryTick = await fetch(`${CLOB_URL}/tick-size?token_id=${params.tokenId}`).then((r) => r.json());
        const ts2 = toTickSize(String(retryTick.minimum_tick_size || '0.01'));
        signed = await client.createOrder(userOrder, { tickSize: ts2, negRisk });
        res = await client.postOrder(signed, orderTypeEnum);
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
    const client = makeTradingClient(signer, params.proxyWallet, creds, sig);

    const [tickSizeData, negRiskData] = await Promise.all([
      fetch(`${CLOB_URL}/tick-size?token_id=${params.tokenId}`).then((r) => r.json()),
      fetch(`${CLOB_URL}/neg-risk?token_id=${params.tokenId}`).then((r) => r.json()),
    ]);
    const tickSize = toTickSize(String(tickSizeData.minimum_tick_size || '0.01'));
    const negRisk = negRiskData.neg_risk === true;
    const useGTD = !!(params.expiration && params.expiration > 0);
    const orderType = useGTD ? OrderType.GTD : OrderType.GTC;

    const order = await client.createOrder(
      {
        tokenID: params.tokenId,
        price: params.price,
        size: params.size,
        side: params.side === 'BUY' ? Side.BUY : Side.SELL,
        expiration: params.expiration ?? 0,
      },
      { tickSize, negRisk },
    );

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
    const { order, orderType, signer, creds, proxyWallet, signatureType } = signedPayload;
    const addr = (await signer.getAddress()).toLowerCase();
    const ord = order as { signer?: string };
    if (typeof ord.signer === 'string' && ord.signer.trim().toLowerCase() !== addr) {
      return { success: false, error: 'Order signer does not match the active wallet.' };
    }
    const client = makeTradingClient(signer, proxyWallet, creds, signatureType);
    const res = await client.postOrder(order, orderType);
    const parsed = parsePostOrder(res);
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
