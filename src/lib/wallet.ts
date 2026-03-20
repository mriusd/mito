import { createAppKit } from '@reown/appkit';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { polygon } from 'viem/chains';

const projectId = 'a0cb8786d15c99c954a8f8ef28fdb79e';

export const wagmiAdapter = new WagmiAdapter({
  projectId,
  networks: [polygon],
});

export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  projectId,
  networks: [polygon],
  metadata: {
    name: 'Mito Dashboard',
    description: 'Polymarket trading dashboard',
    url: window.location.origin || 'https://localhost:5173',
    icons: [],
  },
  features: {
    analytics: false,
    email: false,
    socials: false,
  },
});
