import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * Dev runs the SPA on :5173 proxying /api to the BFF on :7777; production is single-port with
 * the built assets served by the CLI. This proxy is the only place the two differ.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // Types only. The layering rule keeps core's Node code out of the browser bundle.
      '@mock-knight/core/types': fileURLToPath(new URL('../core/src/types.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://127.0.0.1:7777', changeOrigin: true } },
  },
  build: { outDir: 'dist', sourcemap: true },
})
