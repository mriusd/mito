// Browser-compatible Polymarket CLOB client
// Uses @polymarket/order-utils for EIP-712 order signing + Web Crypto API for HMAC auth
// Does NOT import @polymarket/clob-client (Node-only due to crypto dependency)

import { ethers } from 'ethers';
import { API_BASE } from './env';
import { ExchangeOrderBuilder, SignatureType, Side as UtilsSide } from '@polymarket/order-utils';
import type { OrderData, SignedOrder } from '@polymarket/order-utils';
import { getWalletClient } from '@wagmi/core';
import { wagmiAdapter } from './wallet';
import { signingDialog } from '../components/SigningDialog';
import { useAppStore } from '../stores/appStore';
import { getStoredPrivateKey } from '../components/PrivateKeyImportDialog';

const CLOB_URL = 'https://clob.polymarket.com';
const CHAIN_ID = 137;
const COLLATERAL_DECIMALS = 6;

// Polygon mainnet contract addresses
const EXCHANGE_ADDRESS = '0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E';
const NEG_RISK_EXCHANGE = '0xC5d563A36AE78145C45a50134d48A1215220f80a';

const MSG_TO_SIGN = 'This message attests that I control the given wallet';

// Rounding configs per tick size
const ROUNDING_CONFIG: Record<string, { price: number; size: number; amount: number }> = {
  '0.1':    { price: 1, size: 2, amount: 3 },
  '0.01':   { price: 2, size: 2, amount: 4 },
  '0.001':  { price: 3, size: 2, amount: 5 },
  '0.0001': { price: 4, size: 2, amount: 6 },
};

interface ApiKeyCreds {
  key: string;
  secret: string;
  passphrase: string;
}

// --- Cache (restored from localStorage on load) ---
const STORAGE_KEY = 'polymarket-api-creds';
let cachedAddress: string | null = null;
let cachedCreds: ApiKeyCreds | null = null;
let cachedProxyWallet: string | null = null;

// Restore cached creds from localStorage
try {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    const parsed = JSON.parse(stored);
    if (parsed.key && parsed.secret && parsed.passphrase && parsed.address && parsed.proxyWallet) {
      cachedCreds = { key: parsed.key, secret: parsed.secret, passphrase: parsed.passphrase };
      cachedAddress = parsed.address;
      cachedProxyWallet = parsed.proxyWallet;
    }
  }
} catch { /* ignore corrupt storage */ }

function persistCreds() {
  if (cachedCreds && cachedAddress && cachedProxyWallet) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      key: cachedCreds.key,
      secret: cachedCreds.secret,
      passphrase: cachedCreds.passphrase,
      address: cachedAddress,
      proxyWallet: cachedProxyWallet,
    }));
  }
}

export function clearCachedCreds() {
  cachedCreds = null;
  cachedAddress = null;
  cachedProxyWallet = null;
  localStorage.removeItem(STORAGE_KEY);
}

// Check if HMAC creds are available for a given proxy wallet
export function hasCredsForWallet(proxyWallet: string): boolean {
  return !!cachedCreds && !!cachedAddress && cachedProxyWallet === proxyWallet.toLowerCase();
}

// Derive and cache API creds for a proxy wallet (triggers wallet signature popup)
export async function ensureCredsForWallet(proxyWallet: string): Promise<void> {
  const signer = await getEthersSigner();
  await ensureCreds(signer, proxyWallet);
}

// Global wallet data refresh callback — set by useWalletData, called after order/cancel
let _walletRefreshFn: (() => void) | null = null;
export function setWalletRefreshFn(fn: () => void) { _walletRefreshFn = fn; }
export function triggerWalletRefresh() { if (_walletRefreshFn) setTimeout(_walletRefreshFn, 1500); }

// --- Backend API creds delegation ---
// Derives API creds (prompts wallet signature) and sends them to the backend
// Returns true on success, throws on failure
export async function sendCredsToBackend(): Promise<boolean> {
  const signer = await getEthersSigner();
  const address = (await signer.getAddress()).toLowerCase();
  // Resolve proxy wallet
  // Gamma API is CORS-restricted in browser contexts; always use backend proxy.
  const resp = await fetch(`${API_BASE}/api/polyproxy/gamma/users?address=${address}`);
  const users = await resp.json();
  const proxyWallet = (users?.[0]?.proxyWallet || address).toLowerCase();
  // Derive creds (triggers wallet signature popup)
  const creds = await ensureCreds(signer, proxyWallet);
  // Send to backend
  const sendResp = await fetch('/api/auth/creds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      walletAddress: address,
      proxyWallet,
      apiKey: creds.key,
      apiSecret: creds.secret,
      passphrase: creds.passphrase,
    }),
  });
  if (!sendResp.ok) {
    const err = await sendResp.json().catch(() => ({}));
    throw new Error(err.error || 'Failed to send credentials to backend');
  }
  return true;
}

// Check if backend already has active API credentials
export async function checkBackendAuth(): Promise<boolean> {
  try {
    const resp = await fetch('/api/auth/status');
    const data = await resp.json();
    return !!data.authenticated;
  } catch {
    return false;
  }
}

// --- Rounding helpers (replicate clob-client/utilities without Node crypto) ---
function roundNormal(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
function roundDown(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.floor(n * f) / f;
}
function roundUp(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.ceil(n * f) / f;
}
function decimalPlaces(n: number): number {
  const s = n.toString();
  if (!s.includes('.')) return 0;
  return s.split('.')[1].length;
}

// --- Web Crypto HMAC (replaces Node crypto.createHmac) ---
function base64Decode(b64: string): Uint8Array {
  // Convert URL-safe base64 to standard base64 before decoding
  let std = b64.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed
  while (std.length % 4 !== 0) std += '=';
  const bin = atob(std);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSha256Base64(secret: string, message: string): Promise<string> {
  const keyData = base64Decode(secret);
  const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const msgBuf = new TextEncoder().encode(message);
  const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, msgBuf);
  let b64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  // URL-safe base64 (keep = suffix)
  b64 = b64.replace(/\+/g, '-').replace(/\//g, '_');
  return b64;
}

// --- L1 Auth: EIP-712 signature for API key derivation ---
async function buildL1Headers(signer: ethers.Signer): Promise<Record<string, string>> {
  const address = await signer.getAddress();
  const ts = Math.floor(Date.now() / 1000);
  const nonce = 0;
  const domain = { name: 'ClobAuthDomain', version: '1', chainId: CHAIN_ID };
  const types = {
    ClobAuth: [
      { name: 'address', type: 'address' },
      { name: 'timestamp', type: 'string' },
      { name: 'nonce', type: 'uint256' },
      { name: 'message', type: 'string' },
    ],
  };
  const value = { address, timestamp: `${ts}`, nonce, message: MSG_TO_SIGN };
  const sig = await (signer as any)._signTypedData(domain, types, value);
  return {
    POLY_ADDRESS: address,
    POLY_SIGNATURE: sig,
    POLY_TIMESTAMP: `${ts}`,
    POLY_NONCE: `${nonce}`,
  };
}

// --- L2 Auth: HMAC signature for authenticated API calls ---
async function buildL2Headers(
  signer: ethers.Signer,
  creds: ApiKeyCreds,
  method: string,
  requestPath: string,
  body?: string,
): Promise<Record<string, string>> {
  const address = await signer.getAddress();
  return buildL2HeadersWithAddress(address, creds, method, requestPath, body);
}

async function buildL2HeadersWithAddress(
  address: string,
  creds: ApiKeyCreds,
  method: string,
  requestPath: string,
  body?: string,
): Promise<Record<string, string>> {
  const ts = Math.floor(Date.now() / 1000);
  let message = `${ts}${method}${requestPath}`;
  if (body) message += body;
  const sig = await hmacSha256Base64(creds.secret, message);
  return {
    POLY_ADDRESS: address,
    POLY_SIGNATURE: sig,
    POLY_TIMESTAMP: `${ts}`,
    POLY_API_KEY: creds.key,
    POLY_PASSPHRASE: creds.passphrase,
  };
}

// --- Get signer: private key wallet (instant) or browser wallet (popup) ---
async function getEthersSigner(): Promise<ethers.Signer> {
  const { signingMode } = useAppStore.getState();
  if (signingMode === 'privateKey') {
    const pk = getStoredPrivateKey();
    if (pk) {
      const provider = new ethers.providers.JsonRpcProvider('https://polygon-rpc.com', 137);
      return new ethers.Wallet(pk, provider);
    }
  }
  const walletClient = await getWalletClient(wagmiAdapter.wagmiConfig);
  if (!walletClient) throw new Error('No wallet connected');
  const { account, chain, transport } = walletClient;
  const network = { chainId: chain.id, name: chain.name, ensAddress: undefined };
  const provider = new ethers.providers.Web3Provider(transport, network);
  return provider.getSigner(account.address);
}

// --- API key derivation ---
async function deriveApiKey(signer: ethers.Signer): Promise<ApiKeyCreds> {
  const headers = await buildL1Headers(signer);
  // Try derive first
  let resp = await fetch(`${CLOB_URL}/auth/derive-api-key`, { headers });
  let data = await resp.json();
  if (data.apiKey) return { key: data.apiKey, secret: data.secret, passphrase: data.passphrase };
  // Fallback: create
  resp = await fetch(`${CLOB_URL}/auth/api-key`, { method: 'POST', headers });
  data = await resp.json();
  if (data.apiKey) return { key: data.apiKey, secret: data.secret, passphrase: data.passphrase };
  throw new Error('Failed to derive or create API key');
}

// --- Ensure we have cached creds for this address ---
async function ensureCreds(signer: ethers.Signer, proxyWallet: string): Promise<ApiKeyCreds> {
  const addr = (await signer.getAddress()).toLowerCase();
  if (cachedCreds && cachedAddress === addr && cachedProxyWallet === proxyWallet.toLowerCase()) {
    return cachedCreds;
  }
  const creds = await deriveApiKey(signer);
  cachedAddress = addr;
  cachedCreds = creds;
  cachedProxyWallet = proxyWallet.toLowerCase();
  persistCreds();
  return creds;
}

// --- Order amount calculation (replicates clob-client helpers.getOrderRawAmounts) ---
function getOrderRawAmounts(side: 'BUY' | 'SELL', size: number, price: number, tickSize: string) {
  const rc = ROUNDING_CONFIG[tickSize] || ROUNDING_CONFIG['0.01'];
  const rawPrice = roundNormal(price, rc.price);
  if (side === 'BUY') {
    const rawTakerAmt = roundDown(size, rc.size);
    let rawMakerAmt = rawTakerAmt * rawPrice;
    if (decimalPlaces(rawMakerAmt) > rc.amount) {
      rawMakerAmt = roundUp(rawMakerAmt, rc.amount + 4);
      if (decimalPlaces(rawMakerAmt) > rc.amount) {
        rawMakerAmt = roundDown(rawMakerAmt, rc.amount);
      }
    }
    return { side: UtilsSide.BUY, rawMakerAmt, rawTakerAmt };
  } else {
    const rawMakerAmt = roundDown(size, rc.size);
    let rawTakerAmt = rawMakerAmt * rawPrice;
    if (decimalPlaces(rawTakerAmt) > rc.amount) {
      rawTakerAmt = roundUp(rawTakerAmt, rc.amount + 4);
      if (decimalPlaces(rawTakerAmt) > rc.amount) {
        rawTakerAmt = roundDown(rawTakerAmt, rc.amount);
      }
    }
    return { side: UtilsSide.SELL, rawMakerAmt, rawTakerAmt };
  }
}

// --- Build and sign an order using @polymarket/order-utils ---
async function buildSignedOrder(
  signer: ethers.Signer,
  proxyWallet: string,
  tokenId: string,
  side: 'BUY' | 'SELL',
  price: number,
  size: number,
  feeRateBps: number,
  tickSize: string,
  negRisk: boolean,
  expiration?: number,
): Promise<SignedOrder> {
  const signerAddress = await signer.getAddress();
  const { side: utilsSide, rawMakerAmt, rawTakerAmt } = getOrderRawAmounts(side, size, price, tickSize);
  const makerAmount = ethers.utils.parseUnits(rawMakerAmt.toString(), COLLATERAL_DECIMALS).toString();
  const takerAmount = ethers.utils.parseUnits(rawTakerAmt.toString(), COLLATERAL_DECIMALS).toString();

  const orderData: OrderData = {
    maker: proxyWallet,
    taker: '0x0000000000000000000000000000000000000000',
    tokenId,
    makerAmount,
    takerAmount,
    side: utilsSide,
    feeRateBps: feeRateBps.toString(),
    nonce: '0',
    signer: signerAddress,
    expiration: (expiration || 0).toString(),
    signatureType: SignatureType.POLY_GNOSIS_SAFE,
  };

  const exchangeAddress = negRisk ? NEG_RISK_EXCHANGE : EXCHANGE_ADDRESS;
  const builder = new ExchangeOrderBuilder(exchangeAddress, CHAIN_ID, signer);
  return builder.buildSignedOrder(orderData);
}

// --- Serialize order for CLOB API (matches official clob-client orderToJson) ---
function orderToJson(order: SignedOrder, owner: string, orderType: string, deferExec = false) {
  // Convert numeric side enum (0=BUY, 1=SELL) to string
  const side = order.side === UtilsSide.BUY ? 'BUY' : 'SELL';
  return {
    deferExec,
    order: {
      salt: parseInt(order.salt, 10),
      maker: order.maker,
      signer: order.signer,
      taker: order.taker,
      tokenId: order.tokenId,
      makerAmount: order.makerAmount,
      takerAmount: order.takerAmount,
      side,
      expiration: order.expiration,
      nonce: order.nonce,
      feeRateBps: order.feeRateBps,
      signatureType: order.signatureType,
      signature: order.signature,
    },
    owner,
    orderType,
  };
}

// --- Builder API headers (order attribution) ---
async function fetchBuilderHeaders(method: string, path: string, body?: string): Promise<Record<string, string>> {
  try {
    const resp = await fetch(`${API_BASE}/api/builder-sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, path, body: body || '' }),
    });
    if (!resp.ok) { console.warn('[builder] sign request failed:', resp.status); return {}; }
    const data = await resp.json();
    console.log('[builder] headers:', data.POLY_BUILDER_API_KEY ? 'OK' : 'MISSING', 'ts:', data.POLY_BUILDER_TIMESTAMP);
    if (data.POLY_BUILDER_API_KEY) return data;
    return {};
  } catch {
    console.warn('[clobClient] builder-sign fetch failed, proceeding without builder headers');
    return {};
  }
}

// --- Public API ---

export async function fetchOpenOrdersDirect(proxyWallet: string): Promise<any[]> {
  // Only fetch if API creds are already cached (from a previous order placement or localStorage restore).
  // Never trigger a wallet signature popup from a background poll.
  if (!cachedCreds || !cachedAddress || cachedProxyWallet !== proxyWallet.toLowerCase()) return [];
  try {
    const headers = await buildL2HeadersWithAddress(cachedAddress, cachedCreds, 'GET', '/data/orders');
    const resp = await fetch(`${CLOB_URL}/data/orders`, { headers });
    const data = await resp.json();
    if (Array.isArray(data)) return data;
    if (data?.data && Array.isArray(data.data)) return data.data;
    return [];
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
  const needsAuth = !cachedCreds || cachedProxyWallet !== params.proxyWallet.toLowerCase();
  const sd = params.skipDialog ? { open: () => {}, setStep: (() => {}) as typeof signingDialog.setStep, close: () => {} } : signingDialog;
  sd.open(needsAuth, { orderInfo: params.orderInfo });
  try {
    const signer = await getEthersSigner();
    const creds = await ensureCreds(signer, params.proxyWallet);
    sd.setStep('auth', 'done');

    // Fetch tick size, neg risk, fee rate
    sd.setStep('sign', 'active');
    const [tickSizeData, negRiskData] = await Promise.all([
      fetch(`${CLOB_URL}/tick-size?token_id=${params.tokenId}`).then(r => r.json()),
      fetch(`${CLOB_URL}/neg-risk?token_id=${params.tokenId}`).then(r => r.json()),
    ]);
    const tickSize = tickSizeData.minimum_tick_size || '0.01';
    const negRisk = negRiskData.neg_risk === true;

    let feeRateBps = 0;
    try {
      const feeData = await fetch(`${CLOB_URL}/fee-rate?token_id=${params.tokenId}`).then(r => r.json());
      const rawFee = feeData.base_fee ?? feeData.fee_rate_bps ?? feeData.feeRateBps ?? 0;
      feeRateBps = typeof rawFee === 'number' ? rawFee : (parseInt(rawFee) || 0);
    } catch { /* use 0 */ }

    const useGTD = params.expiration && params.expiration > 0;
    const signed = await buildSignedOrder(
      signer, params.proxyWallet, params.tokenId,
      params.side as 'BUY' | 'SELL', params.price, params.size,
      feeRateBps, tickSize, negRisk, params.expiration,
    );
    sd.setStep('sign', 'done');

    // Post order to CLOB
    sd.setStep('submit', 'active');
    const resolvedOrderType = params.orderType ?? (useGTD ? 'GTD' : 'GTC');
    const payload = orderToJson(signed, creds.key, resolvedOrderType);
    console.log('[clobClient] order payload:', JSON.stringify(payload, null, 2));
    const body = JSON.stringify(payload);
    const headers = await buildL2Headers(signer, creds, 'POST', '/order', body);
    const builderHeaders = await fetchBuilderHeaders('POST', '/order', body);
    // Submit directly to CLOB from frontend; backend only provides builder signature headers.
    const resp = await fetch(`${CLOB_URL}/order`, {
      method: 'POST',
      headers: { ...headers, ...builderHeaders, 'Content-Type': 'application/json' },
      body,
    });
    const rawText = await resp.text();
    console.log('[clobClient] POST /order response status:', resp.status, 'body:', rawText);
    let data: any;
    try { data = JSON.parse(rawText); } catch { data = { raw: rawText }; }

    if (data.error || data.errorMsg) {
      const errMsg = data.error || data.errorMsg;
      // Retry on tick size error
      if (errMsg.includes('invalid tick size')) {
        const retryTick = await fetch(`${CLOB_URL}/tick-size?token_id=${params.tokenId}`).then(r => r.json());
        const retryTickSize = retryTick.minimum_tick_size || '0.01';
        const retrySigned = await buildSignedOrder(
          signer, params.proxyWallet, params.tokenId,
          params.side as 'BUY' | 'SELL', params.price, params.size,
          feeRateBps, retryTickSize, negRisk, params.expiration,
        );
        const retryBody = JSON.stringify(orderToJson(retrySigned, creds.key, resolvedOrderType));
        const retryHeaders = await buildL2Headers(signer, creds, 'POST', '/order', retryBody);
        const retryBuilderHeaders = await fetchBuilderHeaders('POST', '/order', retryBody);
        const retryResp = await fetch(`${CLOB_URL}/order`, {
          method: 'POST',
          headers: { ...retryHeaders, ...retryBuilderHeaders, 'Content-Type': 'application/json' },
          body: retryBody,
        });
        const retryData = await retryResp.json();
        if (retryData.error || retryData.errorMsg) {
          sd.setStep('submit', 'error', retryData.error || retryData.errorMsg);
          return { success: false, error: retryData.error || retryData.errorMsg };
        }
        sd.setStep('submit', 'done');
        setTimeout(() => sd.close(), 1200);
        return { success: true, orderID: retryData.orderID || retryData.id };
      }
      sd.setStep('submit', 'error', errMsg);
      return { success: false, error: errMsg };
    }

    sd.setStep('submit', 'done');
    setTimeout(() => sd.close(), 1200);
    return { success: true, orderID: data.orderID || data.id };
  } catch (err: any) {
    // Mark whichever step was active as error
    if (!cachedCreds) {
      sd.setStep('auth', 'error', err.message);
    } else {
      sd.setStep('sign', 'error', err.message);
    }
    return { success: false, error: err.message };
  }
}

// Sign an order (triggers wallet popup) but do NOT submit it yet.
// Returns the signed payload ready for submitSignedOrderDirect().
export async function signOrderOnly(params: {
  tokenId: string;
  side: string;
  price: number;
  size: number;
  expiration?: number;
  proxyWallet: string;
}): Promise<{ success: boolean; signedPayload?: { body: string; signer: ethers.Signer; creds: ApiKeyCreds }; error?: string }> {
  try {
    const signer = await getEthersSigner();
    const creds = await ensureCreds(signer, params.proxyWallet);

    const [tickSizeData, negRiskData] = await Promise.all([
      fetch(`${CLOB_URL}/tick-size?token_id=${params.tokenId}`).then(r => r.json()),
      fetch(`${CLOB_URL}/neg-risk?token_id=${params.tokenId}`).then(r => r.json()),
    ]);
    const tickSize = tickSizeData.minimum_tick_size || '0.01';
    const negRisk = negRiskData.neg_risk === true;

    let feeRateBps = 0;
    try {
      const feeData = await fetch(`${CLOB_URL}/fee-rate?token_id=${params.tokenId}`).then(r => r.json());
      const rawFee = feeData.base_fee ?? feeData.fee_rate_bps ?? feeData.feeRateBps ?? 0;
      feeRateBps = typeof rawFee === 'number' ? rawFee : (parseInt(rawFee) || 0);
    } catch { /* use 0 */ }

    const signed = await buildSignedOrder(
      signer, params.proxyWallet, params.tokenId,
      params.side as 'BUY' | 'SELL', params.price, params.size,
      feeRateBps, tickSize, negRisk, params.expiration,
    );

    const useGTD = params.expiration && params.expiration > 0;
    const orderType = useGTD ? 'GTD' : 'GTC';
    const body = JSON.stringify(orderToJson(signed, creds.key, orderType));

    return { success: true, signedPayload: { body, signer, creds } };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Submit a previously signed order to the CLOB.
export async function submitSignedOrderDirect(signedPayload: {
  body: string;
  signer: ethers.Signer;
  creds: ApiKeyCreds;
}): Promise<{ success: boolean; orderID?: string; error?: string }> {
  try {
    const { body, signer, creds } = signedPayload;
    const headers = await buildL2Headers(signer, creds, 'POST', '/order', body);
    const builderHeaders = await fetchBuilderHeaders('POST', '/order', body);
    const resp = await fetch(`${CLOB_URL}/order`, {
      method: 'POST',
      headers: { ...headers, ...builderHeaders, 'Content-Type': 'application/json' },
      body,
    });
    const rawText = await resp.text();
    let data: any;
    try { data = JSON.parse(rawText); } catch { data = { raw: rawText }; }

    if (data.error || data.errorMsg) {
      return { success: false, error: data.error || data.errorMsg };
    }
    return { success: true, orderID: data.orderID || data.id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export async function cancelOrderDirect(orderId: string, proxyWallet: string): Promise<{ success: boolean; error?: string }> {
  try {
    const signer = await getEthersSigner();
    const creds = await ensureCreds(signer, proxyWallet);
    const body = JSON.stringify({ orderID: orderId });
    const headers = await buildL2Headers(signer, creds, 'DELETE', '/order', body);
    const builderHeaders = await fetchBuilderHeaders('DELETE', '/order', body);
    const resp = await fetch(`${CLOB_URL}/order`, {
      method: 'DELETE',
      headers: { ...headers, ...builderHeaders, 'Content-Type': 'application/json' },
      body,
    });
    const data = await resp.json();
    if (data.error || data.errorMsg) return { success: false, error: data.error || data.errorMsg };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
