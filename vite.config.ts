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

// ── ADS Library search middleware ─────────────────────────────────────────────
// Browser fetches GET /ads-library-search?q=<query>&size=<n>
// The middleware does the two-step JSF session dance server-side:
//   1. GET the search page to obtain JSESSIONID cookie + jakarta.faces.ViewState
//   2. POST the search with those tokens
//   3. Extract the CDATA HTML from the JSF partial-response XML
//   4. Return the inner HTML so the browser can parse it with DOMParser

const ADS_LIB_URL =
  'https://archaeologydataservice.ac.uk/library/search/searchResults.xhtml'
const ADS_LIB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0'

async function adsLibrarySearchMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  if (!req.url?.startsWith('/ads-library-search')) { next(); return }

  const parsed = new URL(req.url, 'http://localhost')
  const query  = parsed.searchParams.get('q') ?? ''
  const size   = parsed.searchParams.get('size') ?? '20'

  try {
    // Step 1 — GET the search page; extract session cookie + ViewState
    console.log('[ads-library] GET', ADS_LIB_URL)
    const getRes = await fetch(ADS_LIB_URL, {
      headers: {
        'User-Agent': ADS_LIB_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
      redirect: 'follow',
    })
    if (!getRes.ok) throw new Error(`GET ${getRes.status}: Cloudflare or server block`)

    // Collect Set-Cookie headers (getSetCookie added in Node 18 undici)
    const hdrs = getRes.headers as unknown as { getSetCookie?: () => string[] }
    const rawCookies: string[] = hdrs.getSetCookie?.()
      ?? (getRes.headers.get('set-cookie') ? [getRes.headers.get('set-cookie')!] : [])
    const cookieStr = rawCookies
      .filter(Boolean)
      .map(c => c.split(';')[0].trim())
      .join('; ')

    const pageHtml = await getRes.text()

    // Extract jakarta.faces.ViewState
    const vsMatch =
      /name="jakarta\.faces\.ViewState"[^>]*value="([^"]*)"/.exec(pageHtml) ??
      /value="([^"]*)"[^>]*name="jakarta\.faces\.ViewState"/.exec(pageHtml)
    if (!vsMatch) {
      throw new Error('ViewState not found — the page may have been blocked by Cloudflare')
    }
    const viewState = vsMatch[1]

    // Extract the submit-button component ID (j_idt44 or equivalent)
    const btnMatch =
      /id="(j_idt\d+)"[^>]*type="submit"/.exec(pageHtml) ??
      /type="submit"[^>]*id="(j_idt\d+)"/.exec(pageHtml)
    const btnId = btnMatch?.[1] ?? 'j_idt44'

    console.log(`[ads-library] viewState ok, btnId=${btnId}`)

    // Step 2 — POST the search
    const body = new URLSearchParams({
      'jakarta.faces.partial.ajax': 'true',
      'jakarta.faces.source': btnId,
      'jakarta.faces.partial.execute': '@all',
      'jakarta.faces.partial.render': 'searchResultForm',
      [btnId]: btnId,
      'searchResultForm': 'searchResultForm',
      'searchFieldSelector': '',
      'searchText': query,
      'perPage': size,
      'sortBy': '',
      'perPage2': size,
      'jakarta.faces.ViewState': viewState,
    })

    console.log('[ads-library] POST q=', query, 'size=', size)
    const postRes = await fetch(ADS_LIB_URL, {
      method: 'POST',
      headers: {
        'User-Agent': ADS_LIB_UA,
        'Accept': 'application/xml, text/xml, */*; q=0.01',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Faces-Request': 'partial/ajax',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin': 'https://archaeologydataservice.ac.uk',
        'Referer': ADS_LIB_URL,
        ...(cookieStr ? { Cookie: cookieStr } : {}),
      },
      body: body.toString(),
      signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
    })
    if (!postRes.ok) throw new Error(`POST ${postRes.status}`)

    const xmlText = await postRes.text()
    console.log('[ads-library] response length:', xmlText.length)

    // Extract CDATA HTML from JSF partial-response
    // <update id="searchResultForm"><![CDATA[...HTML...]]></update>
    const cdataMatch =
      /<update[^>]*id="searchResultForm[^"]*"[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/update>/i.exec(xmlText)

    const html = cdataMatch?.[1] ?? xmlText

    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(html)
  } catch (err) {
    if (!res.headersSent) {
      res.statusCode = 502
      res.end(`ADS Library proxy error: ${err instanceof Error ? err.message : String(err)}`)
    }
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
        server.middlewares.use(adsLibrarySearchMiddleware)
        server.middlewares.use(urlProxyMiddleware)
      },
    },
  ],
})
