/**
 * Gamma gives Polymarket `proxyWallet` for connected EOA. That wallet can be legacy Gnosis Safe
 * or newer deposit EIP-1271 wallet — discriminator: Safe implements getOwners().
 */
import { ethers } from 'ethers';
import { SignatureTypeV2 } from '@polymarket/clob-client-v2';
import { vitePolymarketSignatureType, vitePolymarketFunder } from './env';

/** Gnosis Safe `getOwners()` selector */
const SAFE_GET_OWNERS = '0xa0e67e2b';

const SAFE_OWNERS_INTERFACE = new ethers.utils.Interface([
  'function getOwners() external view returns (address[])',
]);

async function jsonRpc(rpcUrl: string, payload: Record<string, unknown>): Promise<{ result?: unknown; error?: unknown }> {
  const r = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = (await r.json()) as { result?: unknown; error?: unknown };
  return j;
}

async function isLikelyGnosisSafe(contractAddress: string, rpcUrl: string): Promise<boolean> {
  try {
    const codeRes = await jsonRpc(rpcUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getCode',
      params: [contractAddress, 'latest'],
    });
    const code =
      typeof codeRes.result === 'string' && codeRes.result !== '0x' ? codeRes.result : '';

    if (code === '' || code === '0x') return false;

    const callRes = await jsonRpc(rpcUrl, {
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: contractAddress, data: SAFE_GET_OWNERS }, 'latest'],
    });
    if (callRes.error != null) return false;
    const ret = callRes.result;
    if (typeof ret !== 'string' || ret.length < 10) return false;
    const owners = SAFE_OWNERS_INTERFACE.decodeFunctionResult('getOwners', ret)[0] as string[];
    return Array.isArray(owners) && owners.length >= 1;
  } catch {
    return false;
  }
}

/** Maker shown in Polymarket UI — Gamma `proxyWallet` or optional env override (bots). */
export function resolvePolymarketMakerAddress(eoaAddress: string, gammaProxyWallet: string | null): string {
  const eoa = eoaAddress.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(eoa)) throw new Error('resolvePolymarketMakerAddress: invalid EOA');

  const envF = vitePolymarketFunder();
  if (envF) {
    if (envF === eoa) throw new Error('VITE_POLYMARKET_FUNDER must be deposit/sc proxy contract, not EOA');
    return envF;
  }

  if (vitePolymarketSignatureType() === 0) return eoa;

  const gm = gammaProxyWallet?.trim();
  if (gm && /^0x[0-9a-f]{40}$/i.test(gm)) return gm.toLowerCase();
  return eoa;
}

/**
 * Infer CLOB signature type for WalletConnect / browser wallets (no `.env`).
 * Explicit VITE_POLYMARKET_* overrides when set.
 */
export async function inferPolymarketClobSignatureType(
  signerEoa: string,
  tradingMakerAddress: string,
  rpcUrl: string,
): Promise<SignatureTypeV2> {
  const envF = vitePolymarketFunder();
  if (envF) return SignatureTypeV2.POLY_1271;

  const explicit = vitePolymarketSignatureType();
  const eoaL = signerEoa.toLowerCase();
  const makerL = tradingMakerAddress.toLowerCase();

  if (explicit === 1) throw new Error('VITE_POLYMARKET_SIGNATURE_TYPE=1 not supported in this app');

  if (explicit === 0 || makerL === eoaL) return SignatureTypeV2.EOA;
  if (explicit === 2) return SignatureTypeV2.POLY_GNOSIS_SAFE;
  if (explicit === 3) return SignatureTypeV2.POLY_1271;

  const gnosis = await isLikelyGnosisSafe(makerL, rpcUrl);
  return gnosis ? SignatureTypeV2.POLY_GNOSIS_SAFE : SignatureTypeV2.POLY_1271;
}
