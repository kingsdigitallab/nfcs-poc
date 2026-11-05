import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'http'
import { writeFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
// Proxy table + 4 custom middleware — single source of truth shared with
// server/index.mjs (prod). Add new data sources in server/proxies.mjs.
// Plain ESM module; typed by server/proxies.d.mts
import { makeViteProxyConfig, lldsSearchMiddleware, urlProxyMiddleware, imageProxyMiddleware } from './server/proxies.mjs'
import { exampleAuthoringMiddleware } from './server/examples.mjs'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
  server: {
    port: 5174,
    proxy: makeViteProxyConfig(),
  },
  plugins: [
    react(),
    {
      name: 'url-proxy',
      configureServer(server) {
        // ── Shared proxy middleware (dev + prod) ──────────────────────────────
        server.middlewares.use(lldsSearchMiddleware)
        server.middlewares.use(urlProxyMiddleware)
        server.middlewares.use(imageProxyMiddleware)

        // ── Dev-only: write fixture JSON to public/fixtures/ ──────────────────
        // Used by FixturePreflightPanel to bulk-generate offline fixtures.
        // NOT included in server/index.mjs (production).
        server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.method !== 'POST' || !req.url?.startsWith('/dev/write-fixture')) { next(); return }
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', () => {
            try {
              const { filename, records } = JSON.parse(body) as { filename: string; records: unknown }
              if (!filename || typeof filename !== 'string' || !/^[\w-]+\.json$/.test(filename)) {
                res.statusCode = 400
                res.end('Invalid filename')
                return
              }
              if (!Array.isArray(records) || records.length === 0) {
                res.statusCode = 400
                res.end('records must be a non-empty array')
                return
              }
              // Sanity-check the first record looks like a UnifiedRecord, not HTML/garbage
              if (typeof records[0] !== 'object' || records[0] === null || Array.isArray(records[0])) {
                res.statusCode = 400
                res.end('records[0] is not an object — refusing to save potentially corrupt fixture')
                return
              }
              const dir = join(process.cwd(), 'public', 'fixtures')
              mkdirSync(dir, { recursive: true })
              writeFileSync(join(dir, filename), JSON.stringify(records, null, 2))
              // Regenerate manifest from all fixture filenames
              const manifest: Record<string, string[]> = {}
              for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'manifest.json')) {
                const m = /^([a-zA-Z]+)-(.+)\.json$/.exec(f)
                if (!m) continue
                const [, nodeType, slug] = m
                ;(manifest[nodeType] ??= []).push(slug)
              }
              for (const k of Object.keys(manifest)) manifest[k].sort()
              writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
              res.setHeader('Content-Type', 'application/json')
              res.statusCode = 200
              res.end(JSON.stringify({ saved: filename }))
            } catch (e) {
              res.statusCode = 400
              res.end(String(e))
            }
          })
        })

        // ── Example workflow authoring (dev: always on) ───────────────────────
        // POST /dev/write-example { slug, title, description, group, workflow }
        // POST /dev/delete-example { slug }
        // Writes/removes public/examples/<slug>.json and regenerates manifest.json.
        // Same middleware in server/index.mjs (prod), gated by ENABLE_EXAMPLE_AUTHORING.
        server.middlewares.use(exampleAuthoringMiddleware(join(process.cwd(), 'public', 'examples')))
      },
    },
  ],
})
