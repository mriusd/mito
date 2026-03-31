import { useAccount } from 'wagmi';
import { appKit } from '../lib/wallet';
import { useAppStore } from '../stores/appStore';

function formatAddress(addr: string): string {
  return addr.slice(0, 6) + '...' + addr.slice(-4);
}

function formatAddressCompact(addr: string): string {
  return addr.slice(0, 4) + '...' + addr.slice(-3);
}

export function WalletButton() {
  const { address, isConnected } = useAccount();
  const signingMode = useAppStore((s) => s.signingMode);
  const pkAddress = useAppStore((s) => s.pkAddress);

  const isPkActive = signingMode === 'privateKey' && !!pkAddress;
  const displayAddr = isPkActive ? pkAddress : address;
  const connected = isPkActive || (isConnected && !!address);

  if (connected && displayAddr) {
    const dotColor = isPkActive ? 'bg-yellow-400' : 'bg-green-400';
    const textColor = isPkActive ? 'text-yellow-400' : 'text-green-400';
    return (
      <button
        onClick={() => appKit.open({ view: 'Account' })}
        className="flex items-center gap-1.5 bg-gray-800/50 rounded px-2 h-[28px] hover:bg-gray-700/50 transition text-xs"
      >
        <span className={`w-2 h-2 rounded-full ${dotColor} flex-shrink-0`} />
        <span className={`${textColor} font-mono font-bold max-[639px]:hidden`}>{formatAddress(displayAddr)}</span>
        <span className={`${textColor} font-mono font-bold min-[640px]:hidden`}>{formatAddressCompact(displayAddr)}</span>
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
