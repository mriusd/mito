import { useAppStore } from '../stores/appStore';

/** Drop portfolio rows tied to previous signer before loading the next wallet. */
export function clearWalletAccountSlice(): void {
  useAppStore.getState().setMarketData({
    positions: [],
    orders: [],
    trades: [],
    cashBalance: 0,
    makerAddress: '',
  });
  useAppStore.getState().setOnchainGridPositions([]);
}
