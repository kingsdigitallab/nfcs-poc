/**
 * server/proxies.mjs — single source of truth for all proxy + middleware logic.
 *
 * Consumed by BOTH:
 *   vite.config.ts   → makeViteProxyConfig() + the 4 exported middleware  (dev)
 *   server/index.mjs → PROXY_TABLE          + the 4 exported middleware  (prod)
 *
 * Adding a new data source:
 *   • Simple reverse-proxy  → add an entry to PROXY_TABLE below
 *   • Custom middleware      → export a new function and wire it in both consumers
 *
 * This module has NO express / vite / http-proxy-middleware imports so it is
 * safe to import from either runtime without extra bundling.
 */

// ── Timeouts ──────────────────────────────────────────────────────────────────

const PROXY_TIMEOUT_MS   = 30_000   // simple fetch hard limit (ms)
const BROWSER_TIMEOUT_MS = 45_000   // Puppeteer page-load hard limit (ms)

// ── Shared User-Agent strings ─────────────────────────────────────────────────

const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// ── Puppeteer fatal-error patterns ────────────────────────────────────────────
// Errors that indicate the browser process itself has died. Catching one clears
// the singleton so the next request triggers a fresh launch.

const FATAL_PATTERNS = ['Connection closed', 'Target closed', 'Session closed', 'Protocol error']

// ── ADS constants ─────────────────────────────────────────────────────────────

const ADS_LIB_URL =
  'https://archaeologydataservice.ac.uk/library/search/searchResults.xhtml'
const ADS_LIB_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:149.0) Gecko/20100101 Firefox/149.0'
const ADS_CAT_ORIGIN = 'https://archaeologydataservice.ac.uk'
const ADS_CAT_API    = `${ADS_CAT_ORIGIN}/data-catalogue-api/api/search`
const ADS_CAT_WARMUP = `${ADS_CAT_ORIGIN}/data-catalogue/`

// ── Puppeteer browser singleton ───────────────────────────────────────────────
// The browser is launched once on the first JS-render request and reused for
// the lifetime of the server process. Each fetch gets its own page (tab) which
// is closed after use. Both singletons are cleared on disconnect so the next
// request triggers a clean relaunch rather than inheriting a broken state.

let _browserPromise = null
let _adsPagePromise = null

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
      // Reset BOTH singletons when the browser process dies so the next request
      // gets a clean relaunch rather than an unresolvable broken promise.
      // (CLAUDE.md gotcha #11 — do not remove this handler)
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

// ── fetch helpers ─────────────────────────────────────────────────────────────

/** Simple fetch path — no JS execution, just the raw HTTP response body. */
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
        // Browser process died — reset singleton so next request gets a fresh launch
        _browserPromise = null
        throw navErr
      }
      // Non-fatal (ERR_ABORTED, etc.) — DOM may still have useful content
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

/** Long-lived Puppeteer page warmed on the ADS site to hold a cf_clearance cookie. */
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

// ── Custom middleware (connect-compatible: (req, res, next)) ──────────────────
// These functions work identically under Vite's server.middlewares.use() (dev)
// and Express's app.use() (prod) — both accept the connect signature.

/**
 * /ads-library-search?q=<query>&size=<n>
 * Two-step JSF session dance: GET ViewState + POST search → CDATA HTML.
 */
export async function adsLibrarySearchMiddleware(req, res, next) {
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
    const hdrs = getRes.headers
    const rawCookies = hdrs.getSetCookie?.()
      ?? (getRes.headers.get('set-cookie') ? [getRes.headers.get('set-cookie')] : [])
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
      'jakarta.faces.partial.ajax':   'true',
      'jakarta.faces.source':         btnId,
      'jakarta.faces.partial.execute': '@all',
      'jakarta.faces.partial.render': 'searchResultForm',
      [btnId]:                         btnId,
      'searchResultForm':              'searchResultForm',
      'searchFieldSelector':           '',
      'searchText':                    query,
      'perPage':                       size,
      'sortBy':                        '',
      'perPage2':                      size,
      'jakarta.faces.ViewState':       viewState,
    })

    console.log('[ads-library] POST q=', query, 'size=', size)
    const postRes = await fetch(ADS_LIB_URL, {
      method: 'POST',
      headers: {
        'User-Agent':      ADS_LIB_UA,
        'Accept':          'application/xml, text/xml, */*; q=0.01',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Content-Type':    'application/x-www-form-urlencoded; charset=UTF-8',
        'Faces-Request':   'partial/ajax',
        'X-Requested-With': 'XMLHttpRequest',
        'Origin':          'https://archaeologydataservice.ac.uk',
        'Referer':         ADS_LIB_URL,
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

/**
 * /ads-catalogue-search?<qs>
 * Cloudflare bypass: runs the API fetch inside the warmed Puppeteer page context.
 * On 403 the page singleton is cleared so the next request re-warms.
 */
export async function adsCatalogueSearchMiddleware(req, res, next) {
  if (!req.url?.startsWith('/ads-catalogue-search')) { next(); return }

  const parsed = new URL(req.url, 'http://localhost')
  const qs     = parsed.searchParams.toString()
  const apiUrl = `${ADS_CAT_API}?${qs}`

  try {
    const page   = await getOrWarmADSPage()
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

// ── Proxy table ───────────────────────────────────────────────────────────────
/**
 * All 13 simple reverse-proxy routes, described as data.
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
    prefix:  '/ads-proxy',
    target:  'https://archaeologydataservice.ac.uk',
    rewrite: path => path.replace(/^\/ads-proxy/, ''),
    headers: {
      'User-Agent': DESKTOP_UA,
      'Referer':    'https://archaeologydataservice.ac.uk/',
      'Accept':     'application/json, text/plain, */*',
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
