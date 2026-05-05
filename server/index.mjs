import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3001
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434'

const app = express()

// ── Constants ─────────────────────────────────────────────────────────────────

const PROXY_TIMEOUT_MS   = 30_000
const BROWSER_TIMEOUT_MS = 45_000
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const FATAL_PATTERNS = ['Connection closed', 'Target closed', 'Session closed', 'Protocol error']

const ADS_LIB_URL =
  'https://archaeologydataservice.ac.uk/library/search/searchResults.xhtml'
const ADS_LIB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0'
const ADS_CAT_ORIGIN = 'https://archaeologydataservice.ac.uk'
const ADS_CAT_API    = `${ADS_CAT_ORIGIN}/data-catalogue-api/api/search`
const ADS_CAT_WARMUP = `${ADS_CAT_ORIGIN}/data-catalogue/`

// ── Puppeteer browser singleton ───────────────────────────────────────────────

let _browserPromise  = null
let _adsPagePromise  = null

async function getOrLaunchBrowser() {
  if (!_browserPromise) {
    _browserPromise = (async () => {
      const { default: puppeteer } = await import('puppeteer')
      console.log('[url-proxy] Launching headless browser…')
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
      browser.on('disconnected', () => {
        console.warn('[url-proxy] Browser disconnected — will relaunch on next request')
        _browserPromise = null
        _adsPagePromise = null
      })
      console.log('[url-proxy] Browser ready.')
      return browser
    })()
  }
  return _browserPromise
}

async function fetchSimple(target, res) {
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

async function fetchWithBrowser(target, res, waitUntil = 'networkidle2') {
  const browser = await getOrLaunchBrowser()
  const page = await browser.newPage()
  try {
    await page.setUserAgent(DESKTOP_UA)
    await page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS)
    await page.setRequestInterception(true)
    page.on('request', req => {
      const t = req.resourceType()
      if (t === 'image' || t === 'font' || t === 'media') req.abort()
      else req.continue()
    })
    try {
      await page.goto(target, { waitUntil })
    } catch (navErr) {
      const msg = navErr instanceof Error ? navErr.message : String(navErr)
      const isFatal = FATAL_PATTERNS.some(p => msg.includes(p))
      if (isFatal) {
        _browserPromise = null
        throw navErr
      }
      console.warn('[url-proxy] Navigation warning (will try page.content()):', msg)
    }
    const html = await page.content()
    res.statusCode = 200
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(html)
  } finally {
    await page.close().catch(() => {})
  }
}

// ── ADS Library search middleware ─────────────────────────────────────────────

async function adsLibrarySearchMiddleware(req, res, next) {
  if (!req.url?.startsWith('/ads-library-search')) { next(); return }

  const parsed = new URL(req.url, 'http://localhost')
  const query  = parsed.searchParams.get('q') ?? ''
  const size   = parsed.searchParams.get('size') ?? '20'

  try {
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

    const hdrs = getRes.headers
    const rawCookies = hdrs.getSetCookie?.()
      ?? (getRes.headers.get('set-cookie') ? [getRes.headers.get('set-cookie')] : [])
    const cookieStr = rawCookies
      .filter(Boolean)
      .map(c => c.split(';')[0].trim())
      .join('; ')

    const pageHtml = await getRes.text()

    const vsMatch =
      /name="jakarta\.faces\.ViewState"[^>]*value="([^"]*)"/.exec(pageHtml) ??
      /value="([^"]*)"[^>]*name="jakarta\.faces\.ViewState"/.exec(pageHtml)
    if (!vsMatch) {
      throw new Error('ViewState not found — the page may have been blocked by Cloudflare')
    }
    const viewState = vsMatch[1]

    const btnMatch =
      /id="(j_idt\d+)"[^>]*type="submit"/.exec(pageHtml) ??
      /type="submit"[^>]*id="(j_idt\d+)"/.exec(pageHtml)
    const btnId = btnMatch?.[1] ?? 'j_idt44'

    console.log(`[ads-library] viewState ok, btnId=${btnId}`)

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

// ── ADS Data Catalogue middleware (Cloudflare bypass via Puppeteer) ────────────

async function getOrWarmADSPage() {
  if (!_adsPagePromise) {
    _adsPagePromise = (async () => {
      const browser = await getOrLaunchBrowser()
      const page = await browser.newPage()
      await page.setUserAgent(DESKTOP_UA)
      await page.setDefaultNavigationTimeout(BROWSER_TIMEOUT_MS)
      await page.setRequestInterception(true)
      page.on('request', req => {
        const t = req.resourceType()
        if (t === 'image' || t === 'font' || t === 'media') req.abort()
        else req.continue()
      })
      console.log('[ads-catalogue] Warming Puppeteer page for Cloudflare session…')
      await page.goto(ADS_CAT_WARMUP, { waitUntil: 'networkidle2' })
      console.log('[ads-catalogue] Page warmed.')
      return page
    })()
  }
  return _adsPagePromise
}

async function adsCatalogueSearchMiddleware(req, res, next) {
  if (!req.url?.startsWith('/ads-catalogue-search')) { next(); return }

  const parsed = new URL(req.url, 'http://localhost')
  const qs     = parsed.searchParams.toString()
  const apiUrl = `${ADS_CAT_API}?${qs}`

  try {
    const page = await getOrWarmADSPage()
    const result = await page.evaluate(async (url) => {
      const r = await fetch(url, { headers: { Accept: 'application/json' } })
      return { status: r.status, body: await r.text() }
    }, apiUrl)

    if (result.status === 403) {
      _adsPagePromise = null
      throw new Error('Cloudflare session expired (403) — will re-warm on next request')
    }

    res.statusCode = result.status
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.end(result.body)
  } catch (err) {
    _adsPagePromise = null
    if (!res.headersSent) {
      res.statusCode = 502
      res.end(`ADS catalogue proxy error: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// ── Generic URL proxy middleware ──────────────────────────────────────────────

function urlProxyMiddleware(req, res, next) {
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

// ── Simple proxy routes ───────────────────────────────────────────────────────
// Mounted at path prefix so Express strips the prefix before forwarding.
// pathRewrite re-adds the correct upstream path segment where needed.
//
// Accept-Encoding is stripped from all outbound proxy requests to prevent
// double-compression conflicts when Cloudflare processes responses from the
// tunnel. Without this, Cloudflare decompresses/re-compresses gzip responses
// in a way that corrupts content-length, causing the browser to abort.

const stripEncoding = (proxyReq) => proxyReq.removeHeader('accept-encoding')

app.use('/llds-proxy', createProxyMiddleware({
  target: 'https://llds.ling-phil.ox.ac.uk',
  changeOrigin: true,
  // /llds-proxy/rest/items → (prefix stripped) /rest/items → /llds/rest/items
  pathRewrite: { '^/': '/llds/' },
  on: { proxyReq: stripEncoding },
}))

app.use('/ads-proxy', createProxyMiddleware({
  target: 'https://archaeologydataservice.ac.uk',
  changeOrigin: true,
  on: {
    proxyReq: (proxyReq) => {
      stripEncoding(proxyReq)
      proxyReq.setHeader('User-Agent', DESKTOP_UA)
      proxyReq.setHeader('Referer', 'https://archaeologydataservice.ac.uk/')
      proxyReq.setHeader('Accept', 'application/json, text/plain, */*')
    },
  },
}))

app.use('/mds-proxy', createProxyMiddleware({
  target: 'https://museumdata.uk',
  changeOrigin: true,
  on: { proxyReq: stripEncoding },
}))

app.use('/reconcile-proxy', createProxyMiddleware({
  target: 'https://wikidata.reconci.link',
  changeOrigin: true,
  on: { proxyReq: stripEncoding },
}))

app.use('/ollama', createProxyMiddleware({
  target: OLLAMA_HOST,
  changeOrigin: true,
  on: { proxyReq: stripEncoding },
}))

// ── Custom middleware ─────────────────────────────────────────────────────────

app.use(adsLibrarySearchMiddleware)
app.use(adsCatalogueSearchMiddleware)
app.use(urlProxyMiddleware)

// ── Static frontend + SPA fallback ───────────────────────────────────────────

app.use(express.static(join(__dirname, '../dist')))

app.get('*', (_req, res) => {
  res.sendFile(join(__dirname, '../dist/index.html'))
})

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`iDAH Federation server running on http://localhost:${PORT}`)
  console.log(`Ollama forwarding to: ${OLLAMA_HOST}`)
})
