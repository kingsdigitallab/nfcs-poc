/**
 * server/index.mjs — production Express server (Docker).
 *
 * Proxy + middleware logic lives in server/proxies.mjs (the single source of
 * truth shared with vite.config.ts). Add new data sources there, not here.
 *
 * Run modes:
 *   npm run dev        → Vite dev server on port 5174 (vite.config.ts)
 *   docker compose up  → this server on PORT (default 3001)
 */

import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { mkdir, writeFile } from 'fs/promises'
import { writeFileSync, readFileSync, mkdirSync, readdirSync } from 'fs'
import {
  PROXY_TABLE,
  adsLibrarySearchMiddleware,
  adsCatalogueSearchMiddleware,
  lldsSearchMiddleware,
  urlProxyMiddleware,
} from './proxies.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3001

const app = express()

// ── Simple reverse-proxy routes ───────────────────────────────────────────────
// Built from PROXY_TABLE in server/proxies.mjs — add new services there.
//
// Accept-Encoding is stripped from all outbound requests to prevent
// double-compression conflicts when Cloudflare processes tunnel responses.

const stripEncoding = proxyReq => proxyReq.removeHeader('accept-encoding')

for (const entry of PROXY_TABLE) {
  const extraHeaders = entry.headers
  app.use(entry.prefix, createProxyMiddleware({
    target:       entry.target,
    changeOrigin: true,
    // Express strips the prefix before passing to the middleware, so we
    // restore it here for the shared rewrite function (which expects the
    // full path including the prefix).
    pathRewrite:  path => entry.rewrite(entry.prefix + path),
    on: {
      proxyReq: proxyReq => {
        stripEncoding(proxyReq)
        if (extraHeaders) {
          for (const [k, v] of Object.entries(extraHeaders)) proxyReq.setHeader(k, v)
        }
      },
    },
  }))
}

// ── Custom middleware ─────────────────────────────────────────────────────────
// Defined in server/proxies.mjs; connect-compatible so they work here and
// in Vite's server.middlewares.use() identically.

app.use(adsLibrarySearchMiddleware)
app.use(adsCatalogueSearchMiddleware)
app.use(lldsSearchMiddleware)
app.use(urlProxyMiddleware)

// ── Example workflow authoring ────────────────────────────────────────────────
// POST /dev/write-example — saves a canvas as a named loadable example.
// Available in production so workshop facilitators can author examples on the
// deployed instance (protected by obscurity of the author-mode easter egg).

app.post('/dev/write-example', express.json({ limit: '10mb' }), (req, res) => {
  try {
    const { slug, title, description, workflow } = req.body ?? {}
    if (!slug || !/^[\w-]+$/.test(slug)) {
      res.status(400).json({ error: 'Invalid slug' }); return
    }
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' }); return
    }
    if (!workflow || typeof workflow !== 'object' || !Array.isArray(workflow.nodes)) {
      res.status(400).json({ error: 'workflow must be a valid workflow object with a nodes array' }); return
    }
    const dir = join(__dirname, '../dist/examples')
    mkdirSync(dir, { recursive: true })
    const payload = { ...workflow, title, description: description ?? '' }
    writeFileSync(join(dir, `${slug}.json`), JSON.stringify(payload, null, 2))
    // Regenerate manifest
    const manifest = []
    for (const f of readdirSync(dir).filter(f => f.endsWith('.json') && f !== 'manifest.json')) {
      try {
        const parsed = JSON.parse(String(readFileSync(join(dir, f))))
        const s = f.replace(/\.json$/, '')
        manifest.push({ slug: s, title: String(parsed.title ?? s), description: String(parsed.description ?? '') })
      } catch { /* skip malformed */ }
    }
    manifest.sort((a, b) => a.title.localeCompare(b.title))
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
    console.log(`[example] Saved: ${slug}`)
    res.status(200).json({ saved: slug })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── Workshop workflow saves ────────────────────────────────────────────────────

const WORKFLOWS_DIR = join(__dirname, '../data/workflows')
mkdir(WORKFLOWS_DIR, { recursive: true })
  .catch(err => console.error('[save] Could not create workflows directory:', err))

app.post('/api/save-workflow', express.json({ limit: '10mb' }), (req, res) => {
  const body = req.body
  if (!body || body.version == null || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) {
    res.status(400).json({ error: 'Invalid workflow payload' })
    return
  }
  const enriched = {
    ...body,
    serverReceivedAt: new Date().toISOString(),
    remoteIp: req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown',
  }
  const random   = Math.random().toString(36).slice(2, 8)
  const filename = `${new Date().toISOString().replace(/:/g, '-')}-${random}.json`
  writeFile(join(WORKFLOWS_DIR, filename), JSON.stringify(enriched, null, 2))
    .then(() => {
      console.log(`[save] Workflow saved: ${filename}`)
      res.status(201).json({ saved: filename })
    })
    .catch(err => {
      console.error('[save] Write failed:', err)
      res.status(500).json({ error: 'Failed to save workflow' })
    })
})

// ── Static frontend + SPA fallback ────────────────────────────────────────────

app.use(express.static(join(__dirname, '../dist')))

app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, '../dist/index.html'))
})

// ── Start ──────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434'
  console.log(`iDAH Federation server running on http://localhost:${PORT}`)
  console.log(`Ollama forwarding to: ${ollamaHost}`)
})
