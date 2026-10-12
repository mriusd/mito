/**
 * Polymarket deposit wallet (POLY_1271) helpers — derive + gasless deploy via relayer.
 */
import { ethers } from 'ethers';
import { RelayClient } from '@polymarket/builder-relayer-client';
import type { JsonRpcSigner } from '@ethersproject/providers';
import { BuilderConfig } from '@polymarket/builder-relayer-client/node_modules/@polymarket/builder-signing-sdk';
import { API_BASE, POLYGON_JSONRPC_URL } from './env';
import { derivePolymarketWalletsForEoa } from './polymarketTradingMaker';

const POLYGON_CHAIN_ID = 137;
const RELAYER_URL = 'https://relayer-v2.polymarket.com';
const BUILDER_SIGN_URL = `${API_BASE}/api/builder-sign`.replace(/([^:]\/)\/+/g, '$1');

function relayBuilderConfig(): BuilderConfig {
  return new BuilderConfig({
    remoteBuilderConfig: { url: BUILDER_SIGN_URL },
  });
}

async function hasContractCode(address: string): Promise<boolean> {
  try {
    const r = await fetch(POLYGON_JSONRPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getCode',
        params: [address, 'latest'],
      }),
    });
    const j = (await r.json()) as { result?: string };
    const code = typeof j.result === 'string' ? j.result : '0x';
    return code !== '0x' && code !== '0x0' && code.length > 2;
  } catch {
    return false;
  }
}

/** CREATE2 deposit address for an EOA (may be undeployed). */
export function predictDepositWalletAddress(eoa: string): string {
  return derivePolymarketWalletsForEoa(eoa).deposit;
}

/**
 * Ensure the signer's Polymarket deposit wallet exists on Polygon.
 * Returns the deposit address (lowercase).
 */
export async function ensureDepositWalletDeployed(signer: ethers.Signer): Promise<string> {
  const eoa = (await signer.getAddress()).toLowerCase();
  const predicted = predictDepositWalletAddress(eoa);

  if (await hasContractCode(predicted)) {
    return predicted;
  }

  const builderConfig = relayBuilderConfig();
  if (!builderConfig.isValid()) {
    throw new Error(
      `Deposit wallet ${predicted} is not deployed and builder signing is unavailable to deploy it`,
    );
  }

  const client = new RelayClient(
    RELAYER_URL,
    POLYGON_CHAIN_ID,
    signer as JsonRpcSigner | ethers.Wallet,
    builderConfig,
  );

  const derived = (await client.deriveDepositWalletAddress()).toLowerCase();
  if (derived !== predicted) {
    // Prefer RelayClient derivation (authoritative for this SDK/config).
    if (await hasContractCode(derived)) return derived;
  }

  const target = derived || predicted;
  if (await hasContractCode(target)) return target;

  const response = await client.deployDepositWallet();
  const result = await response.wait();
  if (!result?.transactionHash && !(await hasContractCode(target))) {
    throw new Error('Deposit wallet deploy failed or timed out');
  }
  // Brief settle — code may lag the receipt.
  for (let i = 0; i < 8; i++) {
    if (await hasContractCode(target)) return target;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!(await hasContractCode(target))) {
    throw new Error(`Deposit wallet deploy submitted but ${target} still has no code`);
  }
  return target;
}

export function isDepositWalletFlowError(msg: string): boolean {
  return /maker address not allowed|deposit wallet flow|use the deposit wallet/i.test(msg || '');
}
