/**
 * Merge complementary YES+NO outcome shares back to USDC via Conditional Tokens Framework.
 * Mirrors polybot/src/polymarketClient.js mergePositions (Safe proxy + direct EOA).
 */

import { ethers } from 'ethers';
import { getEthersSigner } from './clobClient';

const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';

const CTF_ABI = [
  'function mergePositions(address collateralToken, bytes32 parentCollectionId, bytes32 conditionId, uint256[] partition, uint256 amount)',
];

const SAFE_ABI = [
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) returns (bool success)',
];

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

  try {
    const signer = await getEthersSigner();
    const signerAddr = (await signer.getAddress()).toLowerCase();
    const funder = funderAddress.trim().toLowerCase();

    const amountWei = ethers.BigNumber.from(Math.floor(amount * 1e6));
    if (amountWei.lte(0)) return { success: false, error: 'Amount too small' };

    const ctfInterface = new ethers.utils.Interface(CTF_ABI);
    const mergeData = ctfInterface.encodeFunctionData('mergePositions', [
      USDC_ADDRESS,
      PARENT_ZERO,
      condHex,
      MERGE_PARTITION,
      amountWei,
    ]);

    const provider = signer.provider;
    if (!provider) return { success: false, error: 'No provider' };

    if (funder !== signerAddr) {
      const safeContract = new ethers.Contract(funderAddress, SAFE_ABI, signer);
      const ownerAddr = await signer.getAddress();
      const sig = ethers.utils.hexConcat([
        ethers.utils.hexZeroPad(ownerAddr, 32),
        ethers.utils.hexZeroPad('0x00', 32),
        '0x01',
      ]);

      const feeData = await provider.getFeeData();
      const maxPriorityFee = feeData.maxPriorityFeePerGas || ethers.utils.parseUnits('35', 'gwei');
      const maxFee = feeData.maxFeePerGas || ethers.utils.parseUnits('100', 'gwei');
      const minTip = ethers.utils.parseUnits('30', 'gwei');
      const finalTip = maxPriorityFee.gt(minTip) ? maxPriorityFee : minTip;
      const maxFeeFinal = maxFee.gt(finalTip) ? maxFee : finalTip.mul(3);

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
        sig,
        { maxPriorityFeePerGas: finalTip, maxFeePerGas: maxFeeFinal },
      );
      const receipt = await tx.wait();
      return { success: true, txHash: receipt.transactionHash };
    }

    const ctfContract = new ethers.Contract(CTF_ADDRESS, CTF_ABI, signer);
    const tx = await ctfContract.mergePositions(USDC_ADDRESS, PARENT_ZERO, condHex, MERGE_PARTITION, amountWei);
    const receipt = await tx.wait();
    return { success: true, txHash: receipt.transactionHash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}
