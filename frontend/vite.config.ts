import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Poll for changes instead of relying on filesystem events.
    //
    // fsevents did not reliably deliver writes made by tooling here, so the dev server
    // kept serving a stale transform of a file that had already changed on disk — the
    // UI appeared not to update and required a manual restart. Polling trades a little
    // idle CPU for edits that are always picked up.
    watch: {
      usePolling: true,
      interval: 300,
    },
    proxy: {
      // Proxy API calls to the NestJS backend so the browser only ever talks to
      // the Vite origin. Avoids CORS issues and keeps baseURL as a relative path.
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
