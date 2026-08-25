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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiAdapter.wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary name="root">
          <App />
        </ErrorBoundary>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
