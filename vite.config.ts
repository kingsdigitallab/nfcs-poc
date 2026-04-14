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
      // Proxy /mds-proxy/* → https://museumdata.uk/*
      '/mds-proxy': {
        target: 'https://museumdata.uk',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/mds-proxy/, ''),
      },
      // Proxy /reconcile-proxy/* → https://wikidata.reconci.link/*
      // Despite the W3C Reconciliation API spec requiring CORS, reconci.link
      // returns a 307 redirect that strips CORS headers in the browser.
      // Routing through Vite avoids the redirect entirely.
      '/reconcile-proxy': {
        target: 'https://wikidata.reconci.link',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/reconcile-proxy/, ''),
      },
      // Proxy /ollama/* → http://localhost:11434/*
      // Ollama runs locally; this avoids CORS issues when the browser makes
      // requests to a different port.
      '/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/ollama/, ''),
      },
    },
  },
  plugins: [react()],
})
