import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'http'

// ── URL proxy helpers ─────────────────────────────────────────────────────────

const PROXY_TIMEOUT_MS  = 30_000   // simple fetch hard limit
const BROWSER_TIMEOUT_MS = 45_000  // Puppeteer page load hard limit

/** Simple fetch path — no JS execution, just HTTP response body. */
async function fetchSimple(target: string, res: ServerResponse) {
  const upstream = await fetch(target, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; iDAH-Federation-PoC/1.0)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*',
    },
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    redirect: 'follow',
  })
  res.statusCode = upstream.status
  const ct = upstream.headers.get('content-type')
  if (ct) res.setHeader('Content-Type', ct)
  res.setHeader('Access-Control-Allow-Origin', '*')
  const body = await upstream.arrayBuffer()
  res.end(Buffer.from(body))
}

// ── Puppeteer browser singleton ───────────────────────────────────────────────
// The browser is launched once on the first JS-render request and reused for
// the lifetime of the dev server. Each fetch gets its own page (tab) which is
// closed after use. The singleton is automatically cleared on disconnect so the
// next request triggers a clean relaunch rather than inheriting a broken state.

// A realistic Chrome UA avoids bot-detection blocks that can abruptly close
// the connection and produce "Connection closed" errors.
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Errors that indicate the browser process itself has died. When caught, we
// clear the singleton so the next request gets a fresh browser.
const FATAL_PATTERNS = ['Connection closed', 'Target closed', 'Session closed', 'Protocol error']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _browserPromise: Promise<any> | null = null

async function getOrLaunchBrowser() {
  if (!_browserPromise) {
    _browserPromise = (async () => {
      // Dynamic import keeps puppeteer out of the browser bundle entirely
      const { default: puppeteer } = await import('puppeteer')
      console.log('[url-proxy] Launching headless browser for JS rendering…')
      const browser = await puppeteer.launch({
        headless: true,
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
      browser.on('disconnected', () => {
        console.warn('[url-proxy] Headless browser disconnected — will relaunch on next request')
        _browserPromise = null
      })
      console.log('[url-proxy] Headless browser ready.')
      return browser
    })()
  }
  return _browserPromise
}

/**
 * Headless-browser path — loads the page in Puppeteer and waits for the
 * chosen load event before capturing the fully-rendered HTML.
 *
 * Images, fonts, and media are intercepted and aborted to reduce page-load
 * time and avoid crashes caused by heavy resources triggering Chrome OOM.
 *
 * Navigation errors that are non-fatal (e.g. ERR_ABORTED on a redirect that
 * already delivered content) are logged but not re-thrown; we still attempt
 * to capture whatever the DOM contains at that point.
 */
async function fetchWithBrowser(
  target: string,
  res: ServerResponse,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  waitUntil: any = 'networkidle2',
) {
  const browser = await getOrLaunchBrowser()
  const page = await browser.newPage()
  try {
    await page.setUserAgent(DESKTOP_UA)
    await page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS)

    // Block heavy resources — speeds up load and reduces Chrome crash risk
    await page.setRequestInterception(true)
    page.on('request', req => {
      const t = req.resourceType()
      if (t === 'image' || t === 'font' || t === 'media') {
        req.abort()
      } else {
        req.continue()
      }
    })

    try {
      await page.goto(target, { waitUntil })
    } catch (navErr) {
      const msg = navErr instanceof Error ? navErr.message : String(navErr)
      const isFatal = FATAL_PATTERNS.some(p => msg.includes(p))
      if (isFatal) {
        // Browser process died — reset singleton and propagate so the caller
        // returns a 502 rather than trying to read from a dead page.
        _browserPromise = null
        throw navErr
      }
      // Non-fatal navigation errors (ERR_ABORTED, ERR_NAME_NOT_RESOLVED, etc.)
      // — the DOM may already contain useful content so we fall through and
      // attempt page.content() before giving up.
      console.warn('[url-proxy] Navigation warning (will try page.content()):', msg)
    }

    const html = await page.content()
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(html)
  } finally {
    await page.close().catch(() => {/* ignore close errors */})
  }
}

// ── Generic URL proxy middleware ──────────────────────────────────────────────
// Browser fetches /url-proxy?url=<encoded>[&js=true][&wait=networkidle0]
// Vite handles it server-side, sidestepping CORS entirely.
// Only used by URLFetchNode; GET requests only.

function urlProxyMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  if (!req.url?.startsWith('/url-proxy')) { next(); return }

  const parsed   = new URL(req.url, 'http://localhost')
  const target   = parsed.searchParams.get('url')
  const renderJs = parsed.searchParams.get('js') === 'true'
  const waitStrategy = parsed.searchParams.get('wait') ?? 'networkidle2'

  if (!target || !/^https?:\/\//.test(target)) {
    res.statusCode = 400
    res.end('Missing or invalid url param')
    return
  }

  ;(async () => {
    try {
      if (renderJs) {
        await fetchWithBrowser(target, res, waitStrategy)
      } else {
        await fetchSimple(target, res)
      }
    } catch (err) {
      if (!res.headersSent) {
        res.statusCode = 502
        res.end(`Proxy error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  })()
}

// ── Vite config ───────────────────────────────────────────────────────────────

export default defineConfig({
  server: {
    port: 5174,
    proxy: {
      // Proxy /llds-proxy/* → https://llds.ling-phil.ox.ac.uk/llds/*
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
      '/reconcile-proxy': {
        target: 'https://wikidata.reconci.link',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/reconcile-proxy/, ''),
      },
      // Proxy /ollama/* → http://localhost:11434/*
      '/ollama': {
        target: 'http://localhost:11434',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/ollama/, ''),
      },
    },
  },
  plugins: [
    react(),
    {
      name: 'url-proxy',
      configureServer(server) {
        server.middlewares.use(urlProxyMiddleware)
      },
    },
  ],
})
