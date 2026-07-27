/**
 * Split USDC into complementary YES+NO outcome shares via CTF.
 * Same relayer / wallet paths as mergePositions.
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
  'function splitPosition(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)',
];

const PARENT_ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';
const SPLIT_PARTITION = [1, 2];

const POLYGON_SAFE_FACTORY = '0xaacFeEa03eb1561C4e67d661e40682Bd20E3541b';
const POLYGON_CHAIN_ID = 137;
const RELAYER_URL = 'https://relayer-v2.polymarket.com';
const BUILDER_SIGN_URL = `${API_BASE}/api/builder-sign`.replace(/([^:]\/)\/+/g, '$1');
const CLOB_URL = 'https://clob.polymarket.com';

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

function splitReadProvider(signer: ethers.Signer): ethers.providers.Provider {
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

function splitCollateralAdapter(negRisk: boolean): string {
  return (negRisk ? NEG_RISK_COLLATERAL_ADAPTER : CTF_COLLATERAL_ADAPTER).toLowerCase();
}

function packSplitCalldata(condHex: string, amountWei: ethers.BigNumber, depositWallet: boolean): string {
  const ctfInterface = new ethers.utils.Interface(CTF_ABI);
  const collateral = depositWallet ? PUSD_ADDRESS : USDC_ADDRESS;
  return ctfInterface.encodeFunctionData('splitPosition', [
    collateral,
    PARENT_ZERO,
    condHex,
    SPLIT_PARTITION,
    amountWei,
  ]);
}

function formatSplitError(e: unknown): string {
  if (e instanceof Error) {
    const msg = e.message || String(e);
    if (/builder signing not configured|invalid builder creds/i.test(msg)) {
      return 'Gasless split unavailable (builder signing not configured on server)';
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

async function executeDirectCtfSplit(
  signer: ethers.Signer,
  condHex: string,
  amountWei: ethers.BigNumber,
  negRisk: boolean,
): Promise<string> {
  const target = negRisk ? splitCollateralAdapter(true) : CTF_ADDRESS;
  const ctfContract = new ethers.Contract(target, CTF_ABI, signer);
  const gas = await polygonGasOverrides(splitReadProvider(signer));
  const tx = await ctfContract.splitPosition(USDC_ADDRESS, PARENT_ZERO, condHex, SPLIT_PARTITION, amountWei, gas);
  const receipt = await tx.wait();
  return receipt.transactionHash as string;
}

async function executeGaslessDepositWalletSplit(
  signer: ethers.Signer,
  funderAddress: string,
  splitData: string,
  negRisk: boolean,
): Promise<string> {
  const builderConfig = relayBuilderConfig();
  if (!builderConfig.isValid()) {
    throw new Error('Gasless split unavailable (builder signing not configured on server)');
  }
  const client = new RelayClient(RELAYER_URL, POLYGON_CHAIN_ID, relayerSigner(signer), builderConfig);

  const derived = (await client.deriveDepositWalletAddress()).toLowerCase();
  const funder = funderAddress.trim().toLowerCase();
  if (derived !== funder) {
    throw new Error(`Deposit wallet mismatch: expected ${derived}, got ${funder}`);
  }

  const deadline = String(Math.floor(Date.now() / 1000) + 600);
  const adapter = splitCollateralAdapter(negRisk);

  signingDialog.setStep('sign', 'active');
  const response = await client.executeDepositWalletBatch(
    [{ target: adapter, value: '0', data: splitData }],
    funderAddress,
    deadline,
  );
  signingDialog.setStep('sign', 'done');

  signingDialog.setStep('submit', 'active');
  const result = await response.wait();
  if (!result?.transactionHash) {
    throw new Error('Relayer split failed or timed out');
  }
  signingDialog.setStep('submit', 'done');
  signingDialog.close();
  return result.transactionHash;
}

async function executeGaslessSafeOrProxySplit(
  signer: ethers.Signer,
  funderAddress: string,
  splitData: string,
  sigType: SignatureTypeV2,
  negRisk: boolean,
): Promise<string> {
  const builderConfig = relayBuilderConfig();
  if (!builderConfig.isValid()) {
    throw new Error('Gasless split unavailable (builder signing not configured on server)');
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

  const splitTarget = negRisk ? splitCollateralAdapter(true) : CTF_ADDRESS;
  signingDialog.setStep('sign', 'active');
  const response = await client.execute([{ to: splitTarget, data: splitData, value: '0' }], 'Split position');
  signingDialog.setStep('sign', 'done');

  signingDialog.setStep('submit', 'active');
  const result = await response.wait();
  if (!result?.transactionHash) {
    throw new Error('Relayer split failed or timed out');
  }
  signingDialog.setStep('submit', 'done');
  signingDialog.close();
  return result.transactionHash;
}

async function fetchNegRiskForToken(tokenId: string): Promise<boolean> {
  const tid = tokenId.trim();
  if (!tid) throw new Error('token id required for split');
  const resp = await fetch(`${CLOB_URL}/neg-risk?token_id=${encodeURIComponent(tid)}`);
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `neg-risk lookup failed (${resp.status})`);
  }
  const data = (await resp.json()) as { neg_risk?: boolean };
  return data.neg_risk === true;
}

export async function executeSplitPositions(params: {
  conditionId: string;
  /** USDC amount (1 USDC → 1 YES + 1 NO share). */
  amountUsd: number;
  funderAddress: string;
  negRisk?: boolean;
  tokenId?: string;
}): Promise<{ success: true; txHash: string } | { success: false; error: string }> {
  const { conditionId, amountUsd, funderAddress, tokenId } = params;
  let negRisk = params.negRisk;
  if (negRisk == null) {
    if (!tokenId?.trim()) {
      return { success: false, error: 'token id required for split' };
    }
    try {
      negRisk = await fetchNegRiskForToken(tokenId);
    } catch (e) {
      return { success: false, error: formatSplitError(e) };
    }
  }
  if (!amountUsd || amountUsd <= 0) return { success: false, error: 'Amount must be positive' };
  if (!funderAddress?.trim()) return { success: false, error: 'Proxy wallet not set' };

  let condHex: string;
  try {
    condHex = normalizeConditionId(conditionId);
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Invalid condition id' };
  }

  signingDialog.open(false, {
    title: 'Split position',
    signLabel: 'Sign split',
    submitLabel: 'Submit via relayer',
    orderInfo: `$${amountUsd.toFixed(2)} USDC → ${amountUsd.toFixed(2)} YES + NO`,
  });

  try {
    const signer = await getEthersSigner();
    const signerAddr = (await signer.getAddress()).toLowerCase();
    const funder = funderAddress.trim().toLowerCase();

    const amountWei = ethers.BigNumber.from(Math.floor(amountUsd * 1e6));
    if (amountWei.lte(0)) {
      signingDialog.setStep('sign', 'error', 'Amount too small');
      return { success: false, error: 'Amount too small' };
    }

    let txHash: string;
    if (funder === signerAddr) {
      signingDialog.setStep('sign', 'active');
      signingDialog.setStep('submit', 'active');
      txHash = await executeDirectCtfSplit(signer, condHex, amountWei, negRisk);
      signingDialog.setStep('sign', 'done');
      signingDialog.setStep('submit', 'done');
      signingDialog.close();
    } else {
      const sigType = await inferPolymarketClobSignatureType(signerAddr, funderAddress, POLYGON_JSONRPC_URL);
      if (sigType === SignatureTypeV2.POLY_1271) {
        const splitData = packSplitCalldata(condHex, amountWei, true);
        txHash = await executeGaslessDepositWalletSplit(signer, funderAddress, splitData, negRisk);
      } else if (
        sigType === SignatureTypeV2.POLY_GNOSIS_SAFE ||
        sigType === SignatureTypeV2.POLY_PROXY
      ) {
        const splitData = packSplitCalldata(condHex, amountWei, false);
        txHash = await executeGaslessSafeOrProxySplit(signer, funderAddress, splitData, sigType, negRisk);
      } else {
        throw new Error(`Unsupported wallet type for gasless split (${sigType})`);
      }
    }

    return { success: true, txHash };
  } catch (e) {
    const msg = formatSplitError(e);
    const step = signingDialog.getState().submit === 'active' ? 'submit' : 'sign';
    signingDialog.setStep(step, 'error', msg);
    return { success: false, error: msg };
  }
}
