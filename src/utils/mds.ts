/**
 * mds.ts — HTML scraper for museumdata.uk
 *
 * museumdata.uk has no public JSON API that can be called without per-query
 * auth tokens. Instead we scrape the search results page directly via the Vite
 * dev proxy (/mds-proxy → https://museumdata.uk).
 *
 * Page structure (per result):
 *
 *   <details class="object-overview" id="object-{objectNumber}">
 *     <summary>
 *       <dl>
 *         <div class="object-overview__title"><dt>Title:</dt><dd>…</dd></div>
 *         <div><dt>Object name(s):</dt><dd>…</dd></div>
 *         …
 *       </dl>
 *     </summary>
 *     <div class="object-overview__category">
 *       <div style="…"><dt>Brief description:</dt><dd>…</dd></div>
 *       <dl>
 *         <div><dt>Condition:</dt><dd>…</dd></div>
 *         <div><dt>Content - concept:</dt><dd>stone circles</dd></div>
 *         …
 *       </dl>
 *     </div>
 *     <p>…<a href="/objects/{uuid}">…</a></p>
 *     <p>Use licence for this record: CC BY-NC</p>
 *   </details>
 *
 * Two-step fetch:
 *   1. Fetch with just ?q= to read the total count.
 *   2. Re-fetch with ?q=&view={n} (capped at MDS_CAP) to get all results on
 *      one page, then parse every <details class="object-overview">.
 */

const MDS_SEARCH = '/mds-proxy/object-search/'
const MDS_CAP    = 200
const TIMEOUT_MS = 20_000

// ─── types ────────────────────────────────────────────────────────────────────

export interface MDSRawRecord {
  /** UUID from the persistent shareable link, e.g. "822a4191-0ee5-367f-9539-…" */
  uuid:         string
  /** Canonical URL: https://museumdata.uk/objects/{uuid} */
  url:          string
  /** Native object number from the <details id="object-{objectNumber}"> attribute */
  objectNumber: string
  /**
   * All dt→dd pairs collected from both the <summary> section and
   * .object-overview__category, keyed by normalised label (colon stripped).
   * Repeated labels (e.g. "Content - concept") accumulate as arrays.
   */
  fields:  Record<string, string[]>
  /** Licence text from "Use licence for this record:" paragraph */
  licence: string | undefined
}

// ─── internal helpers ─────────────────────────────────────────────────────────

async function fetchHTML(query: string, view?: number): Promise<Document> {
  const params = new URLSearchParams({ q: query })
  if (view !== undefined) params.set('view', String(view))

  const url = `${MDS_SEARCH}?${params}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    console.log('[MDS] GET', url)
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    const html = await res.text()
    return new DOMParser().parseFromString(html, 'text/html')
  } finally {
    clearTimeout(timer)
  }
}

/** Read the total hit count from "N records match your search" in the page body. */
function extractTotal(doc: Document): number {
  const body = doc.body?.textContent ?? ''
  const m = /(\d[\d,]*)\s+records?\s+match\s+your\s+search/i.exec(body)
  if (m) return parseInt(m[1].replace(/,/g, ''), 10)
  // Fallback: count visible result elements
  return doc.querySelectorAll('details.object-overview').length
}

/**
 * Walk `container` collecting all dt→dd pairs in two structural patterns:
 *
 * Pattern A — <div><dt>…</dt><dd>…</dd></div>  (MDS summary + category sections)
 *   Captures every <dd> sibling of the <dt> within the same <div>.
 *
 * Pattern B — <dl><dt>…</dt><dd>…</dd></dl>  (dt/dd as direct <dl> children)
 *   Streams direct children of each <dl>; a <div> child resets the label context
 *   so it is never double-counted with Pattern A.
 *
 * Labels are normalised by stripping trailing colons and whitespace.
 * Repeated labels (e.g. multiple "Content - concept" divs) produce arrays.
 * Exact duplicate values for the same label are suppressed.
 */
function collectFields(container: Element, fields: Record<string, string[]>): void {
  function addValue(label: string, value: string): void {
    if (!label || !value) return
    if (!fields[label]) fields[label] = []
    if (!fields[label].includes(value)) fields[label].push(value)
  }

  // Pattern A: <div><dt>…</dt><dd>…</dd>…</div>
  for (const div of container.querySelectorAll('div')) {
    const dt = div.querySelector(':scope > dt')
    if (!dt) continue
    const label = (dt.textContent ?? '').replace(/:\s*$/, '').trim()
    for (const dd of div.querySelectorAll(':scope > dd')) {
      addValue(label, (dd.textContent ?? '').trim())
    }
  }

  // Pattern B: <dl><dt>…</dt><dd>…</dd></dl> — direct dl children, no wrapping div
  for (const dl of container.querySelectorAll('dl')) {
    let currentLabel: string | null = null
    for (const child of dl.children) {
      if (child.tagName === 'DT') {
        currentLabel = (child.textContent ?? '').replace(/:\s*$/, '').trim() || null
      } else if (child.tagName === 'DD' && currentLabel) {
        addValue(currentLabel, (child.textContent ?? '').trim())
      } else {
        // <div> or other non-dt/dd child — handled by Pattern A; reset label context
        currentLabel = null
      }
    }
  }
}

/** Parse every <details class="object-overview"> block in the document. */
function parseOverviews(doc: Document): MDSRawRecord[] {
  const details = doc.querySelectorAll('details.object-overview')
  const records: MDSRawRecord[] = []

  for (const el of details) {
    // ── Object number from id attribute ───────────────────────────────────
    // id="object-DZSWS:2022.7007.6"  →  "DZSWS:2022.7007.6"
    const rawId       = el.getAttribute('id') ?? ''
    const objectNumber = rawId.startsWith('object-') ? rawId.slice('object-'.length) : rawId

    // ── All dt/dd fields (summary + category combined) ────────────────────
    const fields: Record<string, string[]> = {}
    collectFields(el, fields)

    // ── UUID + canonical URL from persistent shareable link ───────────────
    // href="/objects/822a4191-0ee5-367f-9539-a05c96ee022e"  (note: /objects/ plural)
    let uuid = ''
    let url  = ''
    for (const a of el.querySelectorAll('a[href]')) {
      const href = (a as HTMLAnchorElement).getAttribute('href') ?? ''
      const m = /\/objects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(href)
      if (m) {
        uuid = m[1]
        url  = `https://museumdata.uk/objects/${uuid}`
        break
      }
    }

    // ── Licence from "Use licence for this record:" paragraph ─────────────
    let licence: string | undefined
    for (const p of el.querySelectorAll('p')) {
      const text = p.textContent ?? ''
      const m = /Use licence for this record:\s*(.+)/i.exec(text)
      if (m) {
        licence = m[1].trim()
        break
      }
    }

    if (objectNumber || uuid || Object.keys(fields).length > 0) {
      records.push({ uuid, url, objectNumber, fields, licence })
    }
  }

  return records
}

// ─── public API ───────────────────────────────────────────────────────────────

export interface MDSFetchResult {
  records: MDSRawRecord[]
  /** Total hit count reported by the site */
  total:   number
  /** True when total > fetchCount (MDS_CAP or user limit) */
  capped:  boolean
}

/**
 * Fetch and parse MDS search results.
 *
 * @param query  Search string
 * @param limit  Maximum records requested by the user node (≤ MDS_CAP)
 */
export async function fetchMDSRecords(
  query: string,
  limit: number,
): Promise<MDSFetchResult> {
  // Step 1 — probe page to get total count
  const probeDoc = await fetchHTML(query)
  const total    = extractTotal(probeDoc)

  console.log(`[MDS] total=${total}`)

  const fetchCount = Math.min(total || 0, limit, MDS_CAP)
  const capped     = total > fetchCount

  if (fetchCount === 0) {
    // Parse whatever the probe page returned (may be 0 results)
    const records = parseOverviews(probeDoc)
    return { records, total: records.length, capped: false }
  }

  // Step 2 — re-fetch with explicit view size to get all records on one page
  const fullDoc = await fetchHTML(query, fetchCount)
  const records = parseOverviews(fullDoc)

  console.log(`[MDS] parsed ${records.length} records (fetchCount=${fetchCount}, capped=${capped})`)

  return { records, total, capped }
}
