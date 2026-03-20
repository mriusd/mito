import { useAccount } from 'wagmi';
import { appKit } from '../lib/wallet';

function formatAddress(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

export function WalletButton() {
  const { address, isConnected } = useAccount();

  if (isConnected && address) {
    return (
      <button
        onClick={() => appKit.open({ view: 'Account' })}
        className="flex items-center gap-1.5 bg-gray-800/50 rounded px-2 h-[28px] hover:bg-gray-700/50 transition text-xs"
      >
        <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
        <span className="text-green-400 font-mono font-bold">{formatAddress(address)}</span>
      </button>
    );
  }

  return (
    <button
      onClick={() => appKit.open({ view: 'Connect' })}
      className="flex items-center gap-1 bg-cyan-700 hover:bg-cyan-600 rounded px-2 h-[28px] transition text-xs font-bold text-white"
    >
      Connect Wallet
    </button>
  );
}
