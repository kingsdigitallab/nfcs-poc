import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'http'
import { writeFileSync, readFileSync, mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
// Proxy table + 4 custom middleware — single source of truth shared with
// server/index.mjs (prod). Add new data sources in server/proxies.mjs.
// Single-line import: @ts-ignore must cover the module-specifier line
// (proxies.d.ts cannot pair with a .mjs import — TS would want .d.mts).
// @ts-ignore — plain ESM module; documented in server/proxies.d.ts
import { makeViteProxyConfig, adsLibrarySearchMiddleware, adsCatalogueSearchMiddleware, lldsSearchMiddleware, urlProxyMiddleware } from './server/proxies.mjs'

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
        server.middlewares.use(adsLibrarySearchMiddleware)
        server.middlewares.use(adsCatalogueSearchMiddleware)
        server.middlewares.use(lldsSearchMiddleware)
        server.middlewares.use(urlProxyMiddleware)

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

        // ── Dev endpoint: save the current canvas as a named example workflow ─
        // POST /dev/write-example  { slug, title, description, workflow }
        // Writes public/examples/<slug>.json and regenerates manifest.json.
        // Also available in production (server/index.mjs) so facilitators can
        // author examples on the deployed instance.
        server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
          if (req.method !== 'POST' || !req.url?.startsWith('/dev/write-example')) { next(); return }
          let body = ''
          req.on('data', (chunk: Buffer) => { body += chunk.toString() })
          req.on('end', () => {
            try {
              const { slug, title, description, workflow } =
                JSON.parse(body) as { slug: string; title: string; description?: string; workflow: unknown }
              if (!slug || !/^[\w-]+$/.test(slug)) {
                res.statusCode = 400; res.end('Invalid slug'); return
              }
              if (!title || typeof title !== 'string') {
                res.statusCode = 400; res.end('title is required'); return
              }
              if (!workflow || typeof workflow !== 'object' || !Array.isArray((workflow as any).nodes)) {
                res.statusCode = 400; res.end('workflow must be a valid workflow object with a nodes array'); return
              }
              const dir = join(process.cwd(), 'public', 'examples')
              mkdirSync(dir, { recursive: true })
              const payload = { ...(workflow as object), title, description: description ?? '' }
              writeFileSync(join(dir, `${slug}.json`), JSON.stringify(payload, null, 2))
              // Regenerate manifest from all saved examples
              const manifest: Array<{ slug: string; title: string; description: string }> = []
              for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'manifest.json')) {
                try {
                  const parsed = JSON.parse(String(readFileSync(join(dir, f)))) as Record<string, unknown>
                  const s = f.replace(/\.json$/, '')
                  manifest.push({ slug: s, title: String(parsed.title ?? s), description: String(parsed.description ?? '') })
                } catch { /* skip malformed files */ }
              }
              manifest.sort((a, b) => a.title.localeCompare(b.title))
              writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
              res.setHeader('Content-Type', 'application/json')
              res.statusCode = 200
              res.end(JSON.stringify({ saved: slug }))
            } catch (e) {
              res.statusCode = 400
              res.end(String(e))
            }
          })
        })
      },
    },
  ],
})
