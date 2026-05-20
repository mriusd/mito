/**
 * Merge complementary YES+NO outcome shares back to USDC via CTF.
 * Polymarket proxy wallets: gasless via PM relayer (direct); builder HMAC via backend /api/builder-sign.
 * Direct EOA: on-chain mergePositions (user pays gas).
 */

import { ethers } from 'ethers';
import { SignatureTypeV2 } from '@polymarket/clob-client-v2';
import { RelayClient, RelayerTxType, deriveSafe } from '@polymarket/builder-relayer-client';
import type { JsonRpcSigner } from '@ethersproject/providers';
import { BuilderConfig } from '@polymarket/builder-relayer-client/node_modules/@polymarket/builder-signing-sdk';
import { getEthersSigner } from './clobClient';
import { API_BASE, POLYGON_ETHERS_NETWORK, POLYGON_JSONRPC_URL } from './env';
import { inferPolymarketClobSignatureType } from './polymarketTradingMaker';
import { signingDialog } from '../components/SigningDialog';

const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const PUSD_ADDRESS = '0xC011a7E12a19f7B1f670d46F03B03f3342E82DFB';
const CTF_COLLATERAL_ADAPTER = '0xAdA100Db00Ca00073811820692005400218FcE1f';
const NEG_RISK_COLLATERAL_ADAPTER = '0xadA2005600Dec949baf300f4C6120000bDB6eAab';

const CTF_ABI = [
  'function mergePositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)',
];

const PARENT_ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';
const MERGE_PARTITION = [1, 2];

const POLYGON_SAFE_FACTORY = '0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b';
const POLYGON_CHAIN_ID = 137;
/** PM relayer — browser CORS allowed (localhost, data.mito.trade, polymarket.com). */
const RELAYER_URL = 'https://relayer-v2.polymarket.com';
const BUILDER_SIGN_URL = `${API_BASE}/api/builder-sign`.replace(/([^:]\/)\/+/g, '$1');

function relayerSigner(signer: ethers.Signer): JsonRpcSigner | ethers.Wallet {
  return signer as JsonRpcSigner | ethers.Wallet;
}

function normalizeConditionId(conditionId: string): string {
  let h = conditionId.trim().toLowerCase();
  if (!h.startsWith('0x')) h = `0x${h}`;
  const body = h.slice(2);
  if (!/^[0-9a-f]*$/i.test(body)) throw new Error('Invalid condition id');
  if (body.length > 64) throw new Error('Invalid condition id');
  if (body.length < 64) {
    try {
      return ethers.utils.hexZeroPad(h, 32);
    } catch {
      throw new Error('Invalid condition id');
    }
  }
  return h;
}

function mergeReadProvider(signer: ethers.Signer): ethers.providers.Provider {
  return signer.provider ?? new ethers.providers.StaticJsonRpcProvider(POLYGON_JSONRPC_URL, POLYGON_ETHERS_NETWORK);
}

async function polygonGasOverrides(provider: ethers.providers.Provider) {
  const feeData = await provider.getFeeData();
  const maxPriorityFee = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('35', 'gwei');
  const maxFee = feeData.maxFeePerGas || ethers.utils.parseUnits('100', 'gwei');
  const minTip = ethers.utils.parseUnits('30', 'gwei');
  const finalTip = maxPriorityFee.gt(minTip) ? maxPriorityFee : minTip;
  const maxFeeFinal = maxFee.gt(finalTip) ? maxFee : finalTip.mul(3);
  return { maxPriorityFeePerGas: finalTip, maxFeePerGas: maxFeeFinal };
}

function mergeCollateralAdapter(negRisk: boolean): string {
  return (negRisk ? NEG_RISK_COLLATERAL_ADAPTER : CTF_COLLATERAL_ADAPTER).toLowerCase();
}

function packMergeCalldata(condHex: string, amountWei: ethers.BigNumber, depositWallet: boolean): string {
  const ctfInterface = new ethers.utils.Interface(CTF_ABI);
  const collateral = depositWallet ? PUSD_ADDRESS : USDC_ADDRESS;
  return ctfInterface.encodeFunctionData('mergePositions', [
    collateral,
    PARENT_ZERO,
    condHex,
    MERGE_PARTITION,
    amountWei,
  ]);
}

function formatMergeError(e: unknown): string {
  if (e instanceof Error) {
    const msg = e.message || String(e);
    if (/builder signing not configured|invalid builder creds/i.test(msg)) {
      return 'Gasless merge unavailable (builder signing not configured on server)';
    }
    if (/SAFE_NOT_DEPLOYED/i.test(msg)) {
      return 'Polymarket Safe not deployed for this wallet';
    }
    if (/insufficient funds/i.test(msg)) {
      return 'Insufficient MATIC for gas — reconnect wallet and retry (should use gasless relayer)';
    }
    if (msg.length > 280) return `${msg.slice(0, 280)}…`;
    return msg;
  }
  return String(e);
}

function relayBuilderConfig(): BuilderConfig {
  return new BuilderConfig({
    remoteBuilderConfig: { url: BUILDER_SIGN_URL },
  });
}

function relayTxType(sigType: SignatureTypeV2): RelayerTxType {
  if (sigType === SignatureTypeV2.POLY_PROXY) return RelayerTxType.PROXY;
  return RelayerTxType.SAFE;
}

async function executeDirectCtfMerge(
  signer: ethers.Signer,
  condHex: string,
  amountWei: ethers.BigNumber,
): Promise<string> {
  const ctfContract = new ethers.Contract(CTF_ADDRESS, CTF_ABI, signer);
  const gas = await polygonGasOverrides(mergeReadProvider(signer));
  const tx = await ctfContract.mergePositions(USDC_ADDRESS, PARENT_ZERO, condHex, MERGE_PARTITION, amountWei, gas);
  const receipt = await tx.wait();
  return receipt.transactionHash as string;
}

async function executeGaslessDepositWalletMerge(
  signer: ethers.Signer,
  funderAddress: string,
  mergeData: string,
  negRisk: boolean,
): Promise<string> {
  const builderConfig = relayBuilderConfig();
  if (!builderConfig.isValid()) {
    throw new Error('Gasless merge unavailable (builder signing not configured on server)');
  }
  const client = new RelayClient(RELAYER_URL, POLYGON_CHAIN_ID, relayerSigner(signer), builderConfig);

  const derived = (await client.deriveDepositWalletAddress()).toLowerCase();
  const funder = funderAddress.trim().toLowerCase();
  if (derived !== funder) {
    throw new Error(`Deposit wallet mismatch: expected ${derived}, got ${funder}`);
  }

  const deadline = String(Math.floor(Date.now() / 1000) + 600);
  const adapter = mergeCollateralAdapter(negRisk);

  signingDialog.setStep('sign', 'active');
  const response = await client.executeDepositWalletBatch(
    [{ target: adapter, value: '0', data: mergeData }],
    funderAddress,
    deadline,
  );
  signingDialog.setStep('sign', 'done');

  signingDialog.setStep('submit', 'active');
  const result = await response.wait();
  if (!result?.transactionHash) {
    throw new Error('Relayer merge failed or timed out');
  }
  signingDialog.setStep('submit', 'done');
  signingDialog.close();
  return result.transactionHash;
}

async function executeGaslessSafeOrProxyMerge(
  signer: ethers.Signer,
  funderAddress: string,
  mergeData: string,
  sigType: SignatureTypeV2,
): Promise<string> {
  const builderConfig = relayBuilderConfig();
  if (!builderConfig.isValid()) {
    throw new Error('Gasless merge unavailable (builder signing not configured on server)');
  }
  const txType = relayTxType(sigType);
  const client = new RelayClient(RELAYER_URL, POLYGON_CHAIN_ID, relayerSigner(signer), builderConfig, txType);

  if (txType === RelayerTxType.SAFE) {
    const expected = deriveSafe(await signer.getAddress(), POLYGON_SAFE_FACTORY).toLowerCase();
    const funder = funderAddress.trim().toLowerCase();
    if (expected !== funder) {
      throw new Error(`Safe wallet mismatch: expected ${expected}, got ${funder}`);
    }
  }

  signingDialog.setStep('sign', 'active');
  const response = await client.execute([{ to: CTF_ADDRESS, data: mergeData, value: '0' }], 'Merge positions');
  signingDialog.setStep('sign', 'done');

  signingDialog.setStep('submit', 'active');
  const result = await response.wait();
  if (!result?.transactionHash) {
    throw new Error('Relayer merge failed or timed out');
  }
  signingDialog.setStep('submit', 'done');
  signingDialog.close();
  return result.transactionHash;
}

export async function executeMergePositions(params: {
  conditionId: string;
  amount: number;
  funderAddress: string;
  negRisk?: boolean;
}): Promise<{ success: true; txHash: string } | { success: false; error: string }> {
  const { conditionId, amount, funderAddress, negRisk = false } = params;
  if (!amount || amount <= 0) return { success: false, error: 'Amount must be positive' };
  if (!funderAddress?.trim()) return { success: false, error: 'Proxy wallet not set' };

  let condHex: string;
  try {
    condHex = normalizeConditionId(conditionId);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Invalid condition id' };
  }

  signingDialog.open(false, {
    title: 'Merge positions',
    signLabel: 'Sign merge',
    submitLabel: 'Submit via relayer',
    orderInfo: `${amount} share pairs → USDC`,
  });

  try {
    const signer = await getEthersSigner();
    const signerAddr = (await signer.getAddress()).toLowerCase();
    const funder = funderAddress.trim().toLowerCase();

    const amountWei = ethers.BigNumber.from(Math.floor(amount * 1e6));
    if (amountWei.lte(0)) {
      signingDialog.setStep('sign', 'error', 'Amount too small');
      return { success: false, error: 'Amount too small' };
    }

    let txHash: string;
    if (funder === signerAddr) {
      signingDialog.setStep('sign', 'active');
      signingDialog.setStep('submit', 'active');
      txHash = await executeDirectCtfMerge(signer, condHex, amountWei);
      signingDialog.setStep('sign', 'done');
      signingDialog.setStep('submit', 'done');
      signingDialog.close();
    } else {
      const sigType = await inferPolymarketClobSignatureType(signerAddr, funderAddress, POLYGON_JSONRPC_URL);
      if (sigType === SignatureTypeV2.POLY_1271) {
        const mergeData = packMergeCalldata(condHex, amountWei, true);
        txHash = await executeGaslessDepositWalletMerge(signer, funderAddress, mergeData, negRisk);
      } else if (
        sigType === SignatureTypeV2.POLY_GNOSIS_SAFE ||
        sigType === SignatureTypeV2.POLY_PROXY
      ) {
        const mergeData = packMergeCalldata(condHex, amountWei, false);
        txHash = await executeGaslessSafeOrProxyMerge(signer, funderAddress, mergeData, sigType);
      } else {
        throw new Error(`Unsupported wallet type for gasless merge (${sigType})`);
      }
    }

    return { success: true, txHash };
  } catch (e) {
    const msg = formatMergeError(e);
    const step = signingDialog.getState().submit === 'active' ? 'submit' : 'sign';
    signingDialog.setStep(step, 'error', msg);
    return { success: false, error: msg };
  }
}
