/**
 * llds.ts — HTML scraper for the LLDS DSpace discover page.
 *
 * The DSpace REST API at LLDS returns XML by default and the metadata key
 * schema differs from what the JSON spec describes, making it unreliable.
 * Instead we scrape the human-readable search results page, which is stable
 * and returns the data we actually need.
 *
 * Search URL (via Vite dev proxy):
 *   /llds-proxy/xmlui/discover?query={q}&rpp={n}
 *   → https://llds.ling-phil.ox.ac.uk/llds/xmlui/discover?query={q}&rpp={n}
 *
 * Two-step fetch (same pattern as mds.ts):
 *   1. Probe with rpp=1 to read total from <h4>Showing … out of N results</h4>
 *   2. Re-fetch with rpp=min(total, userLimit, LLDS_CAP) to get all records
 *
 * Per-item structure (li.item-box):
 *   .artifact-title a     → title text + href (/llds/xmlui/handle/{handle})
 *   .publisher-date .date → publication date
 *   .artifact-info .author span a  → author names (one <a> per author)
 *   .artifact-abstract    → description text
 *   .item-type            → resource type (Text, Dataset, …)
 *   .item-branding        → collection label (EEBO-TCP, OTA, …)
 */

const LLDS_DISCOVER = '/llds-proxy/xmlui/discover'
const LLDS_CAP      = 50
const TIMEOUT_MS    = 15_000

// ─── types ────────────────────────────────────────────────────────────────────

export interface LLDSRawRecord {
  /** Handle string, e.g. "20.500.14106/A47049" */
  handle:      string
  /** Full item URL on LLDS */
  url:         string
  title:       string
  date:        string | undefined
  authors:     string[]
  description: string | undefined
  itemType:    string | undefined
  /** Collection / branding label (EEBO-TCP, OTA Legacy Collection, …) */
  branding:    string | undefined
}

// ─── internal helpers ─────────────────────────────────────────────────────────

async function fetchHTML(query: string, rpp: number): Promise<Document> {
  const params = new URLSearchParams({ query, rpp: String(rpp) })
  const url    = `${LLDS_DISCOVER}?${params}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    console.log('[LLDS] GET', url)
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const html = await res.text()
    return new DOMParser().parseFromString(html, 'text/html')
  } finally {
    clearTimeout(timer)
  }
}

/** Extract total from <h4>Showing 1 to N out of TOTAL results</h4> */
function extractTotal(doc: Document): number {
  for (const h4 of doc.querySelectorAll('h4')) {
    const m = /out of ([\d,]+) results/i.exec(h4.textContent ?? '')
    if (m) return parseInt(m[1].replace(/,/g, ''), 10)
  }
  // Fallback: count items already on the page
  return doc.querySelectorAll('li.item-box').length
}

/** Parse all li.item-box elements from a discover results page. */
function parseItems(doc: Document): LLDSRawRecord[] {
  const records: LLDSRawRecord[] = []

  for (const li of doc.querySelectorAll('li.item-box')) {
    // ── Title + handle ─────────────────────────────────────────────────────
    const titleAnchor = li.querySelector('.artifact-title a')
    const title       = titleAnchor?.textContent?.trim() ?? ''
    if (!title) continue   // skip separator <li> elements

    const href        = titleAnchor?.getAttribute('href') ?? ''
    // href = "/llds/xmlui/handle/20.500.14106/A47049"
    const handleMatch = /\/handle\/(.+)$/.exec(href)
    const handle      = handleMatch?.[1] ?? ''
    const url         = handle
      ? `https://llds.ling-phil.ox.ac.uk/llds/xmlui/handle/${handle}`
      : ''

    // ── Date ───────────────────────────────────────────────────────────────
    const date = li.querySelector('.publisher-date .date')?.textContent?.trim()

    // ── Authors ────────────────────────────────────────────────────────────
    // Each author lives in a <span> inside .author; the <a> inside holds the name.
    const authors = Array.from(li.querySelectorAll('.artifact-info .author span a'))
      .map(a => a.textContent?.trim() ?? '')
      .filter(Boolean)

    // ── Description ────────────────────────────────────────────────────────
    const description = li.querySelector('.artifact-abstract')?.textContent?.trim() || undefined

    // ── Type + branding ────────────────────────────────────────────────────
    const itemType = li.querySelector('.item-type')?.textContent?.trim()   || undefined
    const branding = li.querySelector('.item-branding')?.textContent?.trim() || undefined

    records.push({ handle, url, title, date, authors, description, itemType, branding })
  }

  return records
}

// ─── public API ───────────────────────────────────────────────────────────────

export interface LLDSFetchResult {
  records: LLDSRawRecord[]
  total:   number
  capped:  boolean
}

/**
 * Search LLDS and return parsed records.
 *
 * @param query  Search string passed to the discover endpoint
 * @param limit  Maximum records to return (hard-capped at LLDS_CAP = 50)
 */
export async function fetchLLDSRecords(
  query: string,
  limit: number,
): Promise<LLDSFetchResult> {
  // Step 1 — lightweight probe to read total
  const probeDoc = await fetchHTML(query, 1)
  const total    = extractTotal(probeDoc)

  console.log(`[LLDS] total=${total}`)

  const fetchCount = Math.min(total || 0, limit, LLDS_CAP)
  const capped     = total > fetchCount

  if (fetchCount === 0) {
    return { records: [], total: 0, capped: false }
  }

  // Step 2 — full fetch with the right page size
  const fullDoc = await fetchHTML(query, fetchCount)
  const records = parseItems(fullDoc)

  console.log(`[LLDS] parsed ${records.length} records (fetchCount=${fetchCount}, capped=${capped})`)

  return { records, total, capped }
}
