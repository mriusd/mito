/**
 * Gamma gives Polymarket `proxyWallet` for connected EOA. That wallet can be:
 * - legacy Gnosis Safe (browser wallets)
 * - legacy Magic/Google POLY_PROXY
 * - newer deposit EIP-1271 wallet
 *
 * Prefer CREATE2 derivation match against the active signer over heuristics —
 * mis-classifying a Safe/proxy as POLY_1271 causes
 * "Deposit wallet mismatch: expected <derived>, got <funder>" on merge/split.
 */
import { ethers } from 'ethers';
import { SignatureTypeV2 } from '@polymarket/clob-client-v2';
import {
  deriveDepositWallet,
  deriveProxyWallet,
  deriveSafe,
} from '@polymarket/builder-relayer-client';
import { vitePolymarketSignatureType, vitePolymarketFunder } from './env';

/** Gnosis Safe `getOwners()` selector */
const SAFE_GET_OWNERS = '0xa0e67e2b';

const SAFE_OWNERS_INTERFACE = new ethers.utils.Interface([
  'function getOwners() external view returns (address[])',
]);

/** Polygon mainnet factories — same as @polymarket/builder-relayer-client POL config. */
const POLYGON_SAFE_FACTORY = '0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b';
const POLYGON_PROXY_FACTORY = '0xaB45c5A4B0c941a2F231C04C3f49182e1A254052';
const POLYGON_DEPOSIT_FACTORY = '0x00000000000Fb5C9ADea0298D729A0CB3823Cc07';
const POLYGON_DEPOSIT_IMPLEMENTATION = '0x58CA52ebe0DadfdF531Cde7062e76746de4Db1eB';

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

/** Deterministic Polymarket wallet addresses for an EOA (CREATE2). */
export function derivePolymarketWalletsForEoa(eoaAddress: string): {
  safe: string;
  proxy: string;
  deposit: string;
} {
  const eoa = eoaAddress.trim().toLowerCase();
  return {
    safe: deriveSafe(eoa, POLYGON_SAFE_FACTORY).toLowerCase(),
    proxy: deriveProxyWallet(eoa, POLYGON_PROXY_FACTORY).toLowerCase(),
    deposit: deriveDepositWallet(
      eoa,
      POLYGON_DEPOSIT_FACTORY,
      POLYGON_DEPOSIT_IMPLEMENTATION,
    ).toLowerCase(),
  };
}

/**
 * Match trading maker to Safe / Magic proxy / deposit wallet derived from the signer.
 * Returns null when maker is not one of the deterministic wallets for this EOA.
 */
export function matchDerivedPolymarketWalletType(
  signerEoa: string,
  tradingMakerAddress: string,
): SignatureTypeV2 | null {
  const eoaL = signerEoa.trim().toLowerCase();
  const makerL = tradingMakerAddress.trim().toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(eoaL) || !/^0x[0-9a-f]{40}$/.test(makerL)) return null;
  if (makerL === eoaL) return SignatureTypeV2.EOA;
  try {
    const w = derivePolymarketWalletsForEoa(eoaL);
    if (makerL === w.safe) return SignatureTypeV2.POLY_GNOSIS_SAFE;
    if (makerL === w.proxy) return SignatureTypeV2.POLY_PROXY;
    if (makerL === w.deposit) return SignatureTypeV2.POLY_1271;
  } catch {
    return null;
  }
  return null;
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
 * Infer CLOB signature type for WalletConnect / browser / PK wallets.
 * Explicit VITE_POLYMARKET_* overrides when set; otherwise CREATE2 match, then Safe RPC heuristic.
 */
export async function inferPolymarketClobSignatureType(
  signerEoa: string,
  tradingMakerAddress: string,
  rpcUrl: string,
): Promise<SignatureTypeV2> {
  const explicit = vitePolymarketSignatureType();
  const eoaL = signerEoa.toLowerCase();
  const makerL = tradingMakerAddress.toLowerCase();

  if (explicit === 0 || makerL === eoaL) return SignatureTypeV2.EOA;
  if (explicit === 1) return SignatureTypeV2.POLY_PROXY;
  if (explicit === 2) return SignatureTypeV2.POLY_GNOSIS_SAFE;
  if (explicit === 3) return SignatureTypeV2.POLY_1271;

  // Prefer deterministic CREATE2 match (works for PK + connected wallet).
  // Do NOT default unknown contracts to POLY_1271 — that requires funder === deriveDepositWallet(signer).
  const matched = matchDerivedPolymarketWalletType(eoaL, makerL);
  if (matched != null) return matched;

  const gnosis = await isLikelyGnosisSafe(makerL, rpcUrl);
  if (gnosis) return SignatureTypeV2.POLY_GNOSIS_SAFE;

  // Gamma proxy that isn't CREATE2-derived for this EOA — legacy Magic path, not deposit.
  return SignatureTypeV2.POLY_PROXY;
}
