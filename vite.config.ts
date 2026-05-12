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
  // No manualChunks — custom vendor splits produced circular chunk graphs (Rollup warnings) and
  // runtime crashes: TDZ in clob split; React undefined when wallet stack called createContext.
  build: {},
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
