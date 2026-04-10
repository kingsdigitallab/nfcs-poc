import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  server: {
    port: 5174,
    proxy: {
      // Proxy /llds-proxy/* → https://llds.ling-phil.ox.ac.uk/llds/*
      // The browser fetches from localhost (same origin) so no CORS header is
      // needed. Vite forwards the request server-side where CORS doesn't apply.
      // In production this would be replaced by a real lightweight proxy
      // (e.g. a single Cloudflare Worker or Express route).
      '/llds-proxy': {
        target: 'https://llds.ling-phil.ox.ac.uk',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/llds-proxy/, '/llds'),
      },
      // Proxy /ads-proxy/* → https://archaeologydataservice.ac.uk/*
      '/ads-proxy': {
        target: 'https://archaeologydataservice.ac.uk',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/ads-proxy/, ''),
      },
    },
  },
  plugins: [react()],
})
