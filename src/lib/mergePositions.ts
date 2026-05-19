/**
 * Merge complementary YES+NO outcome shares back to USDC via Conditional Tokens Framework.
 * Polymarket proxy (Gnosis Safe): EIP-712 SafeTx sign + execTransaction (WalletConnect / PK).
 * Direct EOA: call CTF mergePositions.
 */

import { ethers } from 'ethers';
import { getEthersSigner } from './clobClient';
import { POLYGON_ETHERS_NETWORK, POLYGON_JSONRPC_URL } from './env';
import { signingDialog } from '../components/SigningDialog';

const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

const CTF_ABI = [
  'function mergePositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)',
];

const SAFE_ABI = [
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool success)',
  'function nonce() view returns (uint256)',
];

const SAFE_TX_TYPES = {
  SafeTx: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
    { name: 'operation', type: 'uint8' },
    { name: 'safeTxGas', type: 'uint256' },
    { name: 'baseGas', type: 'uint256' },
    { name: 'gasPrice', type: 'uint256' },
    { name: 'gasToken', type: 'address' },
    { name: 'refundReceiver', type: 'address' },
    { name: 'nonce', type: 'uint256' },
  ],
};

const PARENT_ZERO = '0x0000000000000000000000000000000000000000000000000000000000000000';
/** YES=1, NO=2 in Polymarket CTF partition */
const MERGE_PARTITION = [1, 2];

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

/** Pack one owner ECDSA signature for Gnosis Safe `execTransaction`. */
function packSafeOwnerSignature(sigHex: string): string {
  const { r, s, v } = ethers.utils.splitSignature(sigHex);
  return ethers.utils.solidityPack(['bytes32', 'bytes32', 'uint8'], [r, s, v]);
}

async function signGnosisSafeMergeTx(
  signer: ethers.Signer,
  safeAddress: string,
  to: string,
  data: string,
): Promise<string> {
  const readProvider = mergeReadProvider(signer);
  const safeRead = new ethers.Contract(safeAddress, SAFE_ABI, readProvider);
  const nonce = await safeRead.nonce();
  const network = await readProvider.getNetwork();
  const chainId = network.chainId;

  const domain = {
    chainId,
    verifyingContract: ethers.utils.getAddress(safeAddress),
  };
  const message = {
    to: ethers.utils.getAddress(to),
    value: 0,
    data,
    operation: 0,
    safeTxGas: 0,
    baseGas: 0,
    gasPrice: 0,
    gasToken: ethers.constants.AddressZero,
    refundReceiver: ethers.constants.AddressZero,
    nonce,
  };

  type TypedDataSigner = ethers.Signer & {
    _signTypedData: (
      domain: ethers.TypedDataDomain,
      types: Record<string, ethers.TypedDataField[]>,
      value: Record<string, unknown>,
    ) => Promise<string>;
  };
  const sig = await (signer as TypedDataSigner)._signTypedData(domain, SAFE_TX_TYPES, message);
  return packSafeOwnerSignature(sig);
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

async function executeSafeCtfMerge(
  signer: ethers.Signer,
  funderAddress: string,
  mergeData: string,
): Promise<string> {
  signingDialog.setStep('sign', 'active');
  const packedSig = await signGnosisSafeMergeTx(signer, funderAddress, CTF_ADDRESS, mergeData);
  signingDialog.setStep('sign', 'done');

  signingDialog.setStep('submit', 'active');
  const safeContract = new ethers.Contract(funderAddress, SAFE_ABI, signer);
  const gas = await polygonGasOverrides(mergeReadProvider(signer));
  const tx = await safeContract.execTransaction(
    CTF_ADDRESS,
    0,
    mergeData,
    0,
    0,
    0,
    0,
    ethers.constants.AddressZero,
    ethers.constants.AddressZero,
    packedSig,
    gas,
  );
  const receipt = await tx.wait();
  signingDialog.setStep('submit', 'done');
  signingDialog.close();
  return receipt.transactionHash as string;
}

export async function executeMergePositions(params: {
  conditionId: string;
  /** Human share count (same units as UI positions; 6 decimals on-chain) */
  amount: number;
  /** Polymarket proxy / Safe that holds outcome tokens */
  funderAddress: string;
}): Promise<{ success: true; txHash: string } | { success: false; error: string }> {
  const { conditionId, amount, funderAddress } = params;
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
    signLabel: 'Sign Safe transaction',
    submitLabel: 'Submit merge',
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

    const ctfInterface = new ethers.utils.Interface(CTF_ABI);
    const mergeData = ctfInterface.encodeFunctionData('mergePositions', [
      USDC_ADDRESS,
      PARENT_ZERO,
      condHex,
      MERGE_PARTITION,
      amountWei,
    ]);

    let txHash: string;
    if (funder === signerAddr) {
      signingDialog.setStep('sign', 'active');
      signingDialog.setStep('submit', 'active');
      txHash = await executeDirectCtfMerge(signer, condHex, amountWei);
      signingDialog.setStep('sign', 'done');
      signingDialog.setStep('submit', 'done');
      signingDialog.close();
    } else {
      txHash = await executeSafeCtfMerge(signer, funderAddress, mergeData);
    }

    return { success: true, txHash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const step = signingDialog.getState().submit === 'active' ? 'submit' : 'sign';
    signingDialog.setStep(step, 'error', msg);
    return { success: false, error: msg };
  }
}
