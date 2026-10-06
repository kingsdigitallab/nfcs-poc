/**
 * server/proxies.mjs — single source of truth for all proxy + middleware logic.
 *
 * Consumed by BOTH:
 *   vite.config.ts   → makeViteProxyConfig() + the 3 exported middleware  (dev)
 *   server/index.mjs → PROXY_TABLE          + the 3 exported middleware  (prod)
 *
 * Adding a new data source:
 *   • Simple reverse-proxy  → add an entry to PROXY_TABLE below
 *   • Custom middleware      → export a new function and wire it in both consumers
 *
 * This module has NO express / vite / http-proxy-middleware imports so it is
 * safe to import from either runtime without extra bundling.
 */

import { lookup } from 'node:dns/promises'
import {
  WAIT_STRATEGIES,
  MAX_RESPONSE_BYTES,
  parseAllowlist,
  isPrivateHost,
  isAllowedTarget,
} from './urlProxyPolicy.mjs'

// ── Timeouts ──────────────────────────────────────────────────────────────────

const PROXY_TIMEOUT_MS   = 30_000   // simple fetch hard limit (ms)
const BROWSER_TIMEOUT_MS = 45_000   // Puppeteer page-load hard limit (ms)
const MAX_REDIRECTS      = 5

// ── /url-proxy policy ─────────────────────────────────────────────────────────
// URL_PROXY_ALLOWLIST: comma-separated host suffixes the proxy may fetch
// (e.g. "ac.uk,europeana.eu,wikipedia.org"). When unset:
//   • development  → allow any PUBLIC host (private/loopback always denied)
//   • production   → deny everything — the deployed app must opt in explicitly.
// The pure allow/deny rules live in urlProxyPolicy.mjs (unit-tested).

const URL_PROXY_ALLOWLIST = parseAllowlist(process.env.URL_PROXY_ALLOWLIST)
const URL_PROXY_ALLOW_ALL =
  URL_PROXY_ALLOWLIST.length === 0 && process.env.NODE_ENV !== 'production'

let _policyLogged = false
function logPolicyOnce() {
  if (_policyLogged) return
  _policyLogged = true
  if (URL_PROXY_ALLOW_ALL) {
    console.warn('[url-proxy] No URL_PROXY_ALLOWLIST set — allowing any public host (dev mode).')
  } else if (URL_PROXY_ALLOWLIST.length === 0) {
    console.warn('[url-proxy] No URL_PROXY_ALLOWLIST set and NODE_ENV=production — all targets denied.')
  } else {
    console.log(`[url-proxy] Allowlist: ${URL_PROXY_ALLOWLIST.join(', ')}`)
  }
}

/** Error carrying the HTTP status the middleware should answer with. */
class ProxyRefused extends Error {
  constructor(status, message) { super(message); this.status = status }
}

/** Synchronous policy check (no DNS) — used for redirects inside Puppeteer. */
function policyDecision(target) {
  return isAllowedTarget(target, URL_PROXY_ALLOWLIST, { allowAll: URL_PROXY_ALLOW_ALL })
}

/**
 * Full check: policy rules, then resolve the hostname and make sure a public
 * name does not point at a private address (DNS-rebinding guard).
 * @returns {Promise<{ ok: true, url: URL } | { ok: false, reason: string }>}
 */
async function checkTarget(target) {
  const decision = policyDecision(target)
  if (!decision.ok) return decision
  const host = decision.url.hostname
  const isLiteral = /^[\d.]+$/.test(host) || host.includes(':')
  if (!isLiteral) {
    try {
      const { address } = await lookup(host)
      if (isPrivateHost(address)) {
        return { ok: false, reason: `Host resolves to a private address: ${host}` }
      }
    } catch {
      return { ok: false, reason: `DNS lookup failed for ${host}` }
    }
  }
  return decision
}

// ── Shared User-Agent strings ─────────────────────────────────────────────────

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ── Puppeteer fatal-error patterns ────────────────────────────────────────────
// Errors that indicate the browser process itself has died. Catching one clears
// the singleton so the next request triggers a fresh launch.

const FATAL_PATTERNS = ['Connection closed', 'Target closed', 'Session closed', 'Protocol error']

// ── Puppeteer browser singleton ───────────────────────────────────────────────
// The browser is launched once on the first JS-render request and reused for
// the lifetime of the server process. Each fetch gets its own page (tab) which
// is closed after use. The singleton is cleared on disconnect so the next
// request triggers a clean relaunch rather than inheriting a broken state.

let _browserPromise = null

async function getOrLaunchBrowser() {
  if (!_browserPromise) {
    _browserPromise = (async () => {
      // Dynamic import keeps puppeteer out of the browser bundle entirely
      const { default: puppeteer } = await import('puppeteer')
      console.log('[url-proxy] Launching headless browser…')
      // PUPPETEER_EXECUTABLE_PATH is set in the Docker image (system Chromium)
      const execPath = process.env.PUPPETEER_EXECUTABLE_PATH
      const browser = await puppeteer.launch({
        headless: true,
        ...(execPath ? { executablePath: execPath } : {}),
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-extensions',
        ],
      })
      // Reset the singleton when the browser process dies so the next request
      // gets a clean relaunch rather than an unresolvable broken promise.
      // (CLAUDE.md gotcha #11 — do not remove this handler)
      browser.on('disconnected', () => {
        console.warn('[url-proxy] Browser disconnected — will relaunch on next request')
        _browserPromise = null
      })
      console.log('[url-proxy] Browser ready.')
      return browser
    })()
  }
  return _browserPromise
}

// ── fetch helpers ─────────────────────────────────────────────────────────────

/**
 * Simple fetch path — no JS execution, just the raw HTTP response body.
 * Redirects are followed by hand so every hop is re-checked against the
 * policy (an allowed host must not bounce us to a private one), and the
 * body is read with a running byte count so an oversized upstream cannot
 * exhaust memory.
 */
async function fetchSimple(target, res) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; iDAH-Federation-PoC/1.0)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*',
  }
  let current = target
  let upstream
  for (let hop = 0; ; hop++) {
    upstream = await fetch(current, {
      headers,
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      redirect: 'manual',
    })
    const location = upstream.headers.get('location')
    if (upstream.status >= 300 && upstream.status < 400 && location) {
      if (hop >= MAX_REDIRECTS) throw new ProxyRefused(502, 'Too many redirects')
      const next = new URL(location, current).href
      const decision = await checkTarget(next)
      if (!decision.ok) throw new ProxyRefused(403, `Redirect blocked: ${decision.reason}`)
      current = next
      continue
    }
    break
  }

  const declared = Number(upstream.headers.get('content-length') ?? 0)
  if (declared > MAX_RESPONSE_BYTES) throw new ProxyRefused(413, 'Upstream response too large')

  const chunks = []
  let total = 0
  if (upstream.body) {
    const reader = upstream.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {})
        throw new ProxyRefused(413, 'Upstream response too large')
      }
      chunks.push(value)
    }
  }

  res.statusCode = upstream.status
  const ct = upstream.headers.get('content-type')
  if (ct) res.setHeader('Content-Type', ct)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.end(Buffer.concat(chunks))
}

/**
 * Headless-browser path — loads the page in Puppeteer and waits for the
 * chosen load event before capturing the fully-rendered HTML.
 *
 * Images, fonts, and media are intercepted and aborted to reduce page-load
 * time and avoid crashes caused by heavy resources triggering Chrome OOM.
 */
async function fetchWithBrowser(target, res, waitUntil = 'networkidle2') {
  const browser = await getOrLaunchBrowser()
  const page = await browser.newPage()
  try {
    await page.setUserAgent(DESKTOP_UA)
    await page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS)
    await page.setRequestInterception(true)
    // Every top-level document request (the initial load, HTTP redirects,
    // location.href changes) goes through the same policy + DNS check as the
    // simple path. A refusal is remembered so the response is a 403 with a
    // reason rather than an empty 200 from page.content().
    let blockedReason = null
    page.on('request', req => {
      const t = req.resourceType()
      if (t === 'image' || t === 'font' || t === 'media') { req.abort().catch(() => {}); return }
      if (t === 'document') {
        checkTarget(req.url()).then(decision => {
          if (decision.ok) return req.continue()
          blockedReason = blockedReason ?? `${decision.reason} (${req.url()})`
          return req.abort('blockedbyclient')
        }).catch(() => req.abort('failed').catch(() => {}))
        return
      }
      req.continue().catch(() => {})
    })
    try {
      await page.goto(target, { waitUntil })
    } catch (navErr) {
      if (blockedReason) throw new ProxyRefused(403, `Redirect blocked: ${blockedReason}`)
      const msg = navErr instanceof Error ? navErr.message : String(navErr)
      const isFatal = FATAL_PATTERNS.some(p => msg.includes(p))
      if (isFatal) {
        // Browser process died — reset singleton so next request gets a fresh launch
        _browserPromise = null
        throw navErr
      }
      // Non-fatal (ERR_ABORTED, etc.) — DOM may still have useful content
      console.warn('[url-proxy] Navigation warning (will try page.content()):', msg)
    }
    if (blockedReason) throw new ProxyRefused(403, `Redirect blocked: ${blockedReason}`)
    const html = await page.content()
    if (html.length > MAX_RESPONSE_BYTES) throw new ProxyRefused(413, 'Rendered page too large')
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(html)
  } finally {
    await page.close().catch(() => {/* ignore close errors */})
  }
}

// ── Custom middleware (connect-compatible: (req, res, next)) ──────────────────
// These functions work identically under Vite's server.middlewares.use() (dev)
// and Express's app.use() (prod) — both accept the connect signature.

/**
 * /llds-search?q=<query>&rpp=<n>
 * Uses Puppeteer to solve the Anubis JS proof-of-work challenge.
 */
export async function lldsSearchMiddleware(req, res, next) {
  if (!req.url?.startsWith('/llds-search')) { next(); return }

  const parsed = new URL(req.url, 'http://localhost')
  const q   = parsed.searchParams.get('q') ?? ''
  const rpp = parsed.searchParams.get('rpp') ?? '50'

  const target =
    `https://llds.ling-phil.ox.ac.uk/llds/xmlui/discover` +
    `?query=${encodeURIComponent(q)}&rpp=${encodeURIComponent(rpp)}`

  try {
    await fetchWithBrowser(target, res, 'networkidle2')
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 502
      res.end(`LLDS search error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/**
 * /url-proxy?url=<encoded>[&js=true][&wait=<strategy>]
 * Generic URL proxy: plain fetch (js=false) or Puppeteer render (js=true).
 * Used by URLFetchNode and ImageViewNode.
 */
export function urlProxyMiddleware(req, res, next) {
  if (!req.url?.startsWith('/url-proxy')) { next(); return }

  const parsed      = new URL(req.url, 'http://localhost')
  const target      = parsed.searchParams.get('url')
  const renderJs    = parsed.searchParams.get('js') === 'true'
  const waitStrategy = parsed.searchParams.get('wait') ?? 'networkidle2'

  if (!target || !/^https?:\/\//.test(target)) {
    res.statusCode = 400
    res.end('Missing or invalid url param')
    return
  }
  if (!WAIT_STRATEGIES.has(waitStrategy)) {
    res.statusCode = 400
    res.end(`Invalid wait param — expected one of: ${[...WAIT_STRATEGIES].join(', ')}`)
    return
  }

  logPolicyOnce()

  ;(async () => {
    try {
      const decision = await checkTarget(target)
      if (!decision.ok) throw new ProxyRefused(403, decision.reason)
      if (renderJs) {
        await fetchWithBrowser(target, res, waitStrategy)
      } else {
        await fetchSimple(target, res)
      }
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = err instanceof ProxyRefused ? err.status : 502
        res.end(`Proxy error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  })()
}

// ── Proxy table ───────────────────────────────────────────────────────────────
/**
 * All 15 simple reverse-proxy routes, described as data.
 *
 * @property prefix   - Path prefix matched on the incoming request.
 * @property target   - Upstream origin URL.
 * @property rewrite  - Transforms the FULL incoming path (prefix included) to
 *                      the upstream path. Used directly by Vite; the Express
 *                      consumer calls entry.rewrite(entry.prefix + mountedPath)
 *                      because Express strips the prefix before calling the
 *                      createProxyMiddleware handler.
 * @property headers  - Optional headers added to every outbound request.
 *
 * OLLAMA_HOST: defaults to http://localhost:11434 in dev; set the env var
 * in docker-compose.yml or .env to reach a remote Ollama instance.
 */
export const PROXY_TABLE = [
  {
    prefix:  '/llds-proxy',
    target:  'https://llds.ling-phil.ox.ac.uk',
    // /llds-proxy/rest/items → /llds/rest/items  (note: not a simple strip)
    rewrite: path => path.replace(/^\/llds-proxy/, '/llds'),
    headers: {
      'User-Agent':      DESKTOP_UA,
      'Referer':         'https://llds.ling-phil.ox.ac.uk/',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-GB,en;q=0.9',
    },
  },
  {
    prefix:  '/mds-proxy',
    target:  'https://museumdata.uk',
    rewrite: path => path.replace(/^\/mds-proxy/, ''),
  },
  {
    prefix:  '/reconcile-proxy',
    target:  'https://wikidata.reconci.link',
    rewrite: path => path.replace(/^\/reconcile-proxy/, ''),
  },
  {
    prefix:  '/ollama',
    target:  process.env.OLLAMA_HOST || 'http://localhost:11434',
    rewrite: path => path.replace(/^\/ollama/, ''),
  },
  {
    prefix:  '/kcl-proxy',
    target:  'https://api.ai.create.kcl.ac.uk',
    rewrite: path => path.replace(/^\/kcl-proxy/, ''),
  },
  {
    prefix:  '/bodleian-proxy',
    target:  'https://digital.bodleian.ox.ac.uk',
    rewrite: path => path.replace(/^\/bodleian-proxy/, ''),
  },
  {
    prefix:  '/smg-proxy',
    target:  'https://collection.sciencemuseumgroup.org.uk',
    rewrite: path => path.replace(/^\/smg-proxy/, ''),
    headers: {
      'User-Agent': DESKTOP_UA,
      'Referer':    'https://collection.sciencemuseumgroup.org.uk/',
    },
  },
  {
    prefix:  '/vam-proxy',
    target:  'https://api.vam.ac.uk',
    rewrite: path => path.replace(/^\/vam-proxy/, ''),
  },
  {
    prefix:  '/tgn-proxy',
    target:  'https://vocab.getty.edu',
    rewrite: path => path.replace(/^\/tgn-proxy/, ''),
  },
  {
    prefix:  '/getty-search-proxy',
    target:  'https://www.getty.edu',
    rewrite: path => path.replace(/^\/getty-search-proxy/, ''),
  },
  {
    prefix:  '/nominatim-proxy',
    target:  'https://nominatim.openstreetmap.org',
    rewrite: path => path.replace(/^\/nominatim-proxy/, ''),
    headers: {
      'User-Agent':      'iDAH-Federation-PoC/1.0 (https://github.com/kingsdigitallab/nfcs-poc)',
      'Accept-Language': 'en',
    },
  },
  {
    prefix:  '/hsds-proxy',
    target:  'https://hsds.ac.uk',
    rewrite: path => path.replace(/^\/hsds-proxy/, ''),
    headers: {
      'User-Agent': DESKTOP_UA,
      'Accept':     'application/json, text/plain, */*',
    },
  },
  {
    // Wikidata Query Service (SPARQL). WDQS policy requires a descriptive
    // User-Agent; Accept pins the JSON results format.
    prefix:  '/wdqs-proxy',
    target:  'https://query.wikidata.org',
    rewrite: path => path.replace(/^\/wdqs-proxy/, ''),
    headers: {
      'User-Agent': 'iDAH-Federation-PoC/1.0 (https://github.com/kingsdigitallab/nfcs-poc)',
      'Accept':     'application/sparql-results+json',
    },
  },
  {
    // GBIF occurrence API. Direct browser calls (no User-Agent, browser IP) get
    // rate-limited (429); routing through the proxy attaches a descriptive
    // User-Agent and a single server IP, which GBIF's guidance asks for.
    prefix:  '/gbif-proxy',
    target:  'https://api.gbif.org',
    rewrite: path => path.replace(/^\/gbif-proxy/, ''),
    headers: {
      'User-Agent': 'iDAH-Federation-PoC/1.0 (https://github.com/kingsdigitallab/nfcs-poc)',
    },
  },
  {
    // British National Bibliography SPARQL (SparqlSearchNode endpoint option).
    // The BNB linked-data platform has been OFFLINE since the British Library
    // cyber-incident (verified July 2026 — DNS resolves, server never answers).
    // Route kept ready; flip `available` in src/utils/sparqlEndpoints.ts when
    // BL restores the service.
    prefix:  '/bnb-proxy',
    target:  'https://bnb.data.bl.uk',
    rewrite: path => path.replace(/^\/bnb-proxy/, ''),
    headers: {
      'User-Agent': 'iDAH-Federation-PoC/1.0 (https://github.com/kingsdigitallab/nfcs-poc)',
    },
  },
]

// ── Vite proxy config builder ─────────────────────────────────────────────────

/**
 * Returns a Vite server.proxy config object built from PROXY_TABLE.
 *
 * Also applies the accept-encoding strip via the configure hook, giving dev
 * the same Cloudflare double-compression fix that Express uses via stripEncoding.
 * (Without this, Cloudflare re-compresses gzip responses in a way that corrupts
 * content-length, causing the browser to abort the request.)
 */
export function makeViteProxyConfig() {
  const config = {}
  for (const entry of PROXY_TABLE) {
    config[entry.prefix] = {
      target:       entry.target,
      changeOrigin: true,
      rewrite:      entry.rewrite,
      ...(entry.headers ? { headers: entry.headers } : {}),
      configure(proxy) {
        proxy.on('proxyReq', proxyReq => proxyReq.removeHeader('accept-encoding'))
      },
    }
  }
  return config
}
