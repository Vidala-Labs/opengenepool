import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// Allow serving files from the repo root (one level above example/). The
// library source lives in ../src and fetches runtime assets at their real
// paths — the alignment Web Worker (new URL('./alignment.worker.js', ...)) and
// the WASM module (fetch('./alignment.wasm')). Without this, Vite's fs allow
// list 403s those requests, breaking the worker (and silently falling back).
const repoRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
    fs: {
      allow: [repoRoot]
    }
  }
})
