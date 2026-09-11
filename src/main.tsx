import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { wagmiAdapter } from './lib/wallet'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { clearChunkReloadFlag } from './utils/lazyWithChunkReload'

// Amplitude (incl. session replay) intentionally not loaded — prod UI was lagging
// under continuous bid/ask DOM updates while local vite (no Amplitude) stayed smooth.

// Drop stale chunk-reload lock from a prior aborted HMR/navigation so lazy panels can mount.
clearChunkReloadFlag()

const queryClient = new QueryClient()

// StrictMode double-mounts effects in DEV (2× WS connects, 2× intervals) — fine for
// correctness checks, brutal with Vite compiling panel modules. Prod builds only.
const rootTree = (
  <WagmiProvider config={wagmiAdapter.wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary name="root">
        <App />
      </ErrorBoundary>
    </QueryClientProvider>
  </WagmiProvider>
);

createRoot(document.getElementById('root')!).render(
  import.meta.env.PROD ? <StrictMode>{rootTree}</StrictMode> : rootTree,
)
