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
import {
  PROXY_TABLE,
  lldsSearchMiddleware,
  urlProxyMiddleware,
  imageProxyMiddleware,
} from './proxies.mjs'
import { exampleAuthoringMiddleware } from './examples.mjs'

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

app.use(lldsSearchMiddleware)
app.use(urlProxyMiddleware)
app.use(imageProxyMiddleware)

// ── Example workflow authoring ────────────────────────────────────────────────
// POST /dev/write-example  { slug, title, description, group, workflow }
// POST /dev/delete-example { slug }
// Both live in server/examples.mjs (shared with the Vite dev server, where
// they are always on). They write into dist/examples (a host-mounted volume
// in docker-compose) and are unauthenticated, so they are OFF unless the
// deployment opts in with ENABLE_EXAMPLE_AUTHORING=true (e.g. for a workshop
// facilitator authoring examples on the deployed instance).

if (process.env.ENABLE_EXAMPLE_AUTHORING === 'true') {
  console.log('[example] Example authoring endpoints enabled (/dev/write-example, /dev/delete-example)')
  app.use(exampleAuthoringMiddleware(join(__dirname, '../dist/examples')))
}

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
