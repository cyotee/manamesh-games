import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// Optimized for static IPFS deployment: relative base paths, no absolute asset URLs.
export default defineConfig({
  plugins: [react()],
  base: './', // relative paths so the built app works when served from any subpath / IPFS
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          'fflate': ['fflate'],
        },
      },
    },
  },
  server: {
    port: 5174,
  },
})
