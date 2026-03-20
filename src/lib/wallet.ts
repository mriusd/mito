import { createAppKit } from '@reown/appkit';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { polygon } from 'viem/chains';

const projectId = '4b47e275de3b8f889313d2b78b150be2';

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
