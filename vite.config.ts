import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import { visualizer } from 'rollup-plugin-visualizer'

const analyze = process.env.ANALYZE === '1'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({ include: ['crypto', 'buffer', 'stream', 'util'] }),
    ...(analyze
      ? [
          visualizer({
            filename: 'dist/stats.html',
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          // Keep ethers + @polymarket in the same chunk as wagmi/viem. Splitting them as `vendor-clob`
          // created circular chunks (wallet ↔ clob) → runtime "Cannot access before initialization" / black screen.
          if (
            id.includes('@reown') ||
            id.includes('node_modules/wagmi') ||
            id.includes('/wagmi/') ||
            id.includes('node_modules/viem') ||
            id.includes('/viem/') ||
            id.includes('@base-org') ||
            id.includes('ethers') ||
            id.includes('@polymarket')
          ) {
            return 'vendor-wallet'
          }
          if (id.includes('react-grid-layout') || id.includes('react-resizable')) return 'vendor-grid'
          if (id.includes('@tanstack/react-query')) return 'vendor-query'
          if (id.includes('node_modules/zustand')) return 'vendor-zustand'
          if (id.includes('lucide-react')) return 'vendor-icons'
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'vendor-react'
          return 'vendor-misc'
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3099',
        changeOrigin: true,
      },
    },
  },
})
