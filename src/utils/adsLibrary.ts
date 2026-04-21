/**
 * adsLibrary.ts — fetch and parse ADS Library catalogue search results.
 *
 * The Vite middleware at /ads-library-search handles the two-step JSF session
 * dance (GET ViewState → POST search → extract CDATA HTML). This module calls
 * that endpoint and parses the returned HTML fragment.
 *
 * Confirmed HTML structure per record row (tr):
 *
 *   <tr>
 *     <td>
 *       <div style="margin-top:15px; margin-left:15px">        ← outer
 *         <div style="float:left">                             ← inner
 *           <a href="/library/browse/details.xhtml?recordId=…">Title</a>
 *           <div>Publication Type:&nbsp;<img title="Journal"></div>
 *           <div>Parent Title:&nbsp;&nbsp;Sussex…</div>
 *           <div>Publication Date:&nbsp;&nbsp;1930</div>
 *           <div>Author(s):&nbsp;&nbsp;Eliot Curwen</div>
 *           <div>
 *             Abstract:
 *             <img alt="No abstract icon">               ← always present
 *             <a href="…"><img alt="Download icon"></a>  ← present if downloadable
 *           </div>
 *         </div>
 *       </div>
 *     </td>
 *   </tr>
 *
 * Footer/summary rows are excluded because they have no a[href*="recordId"].
 */

const ADS_LIB_SEARCH = '/ads-library-search'
const TIMEOUT_MS      = 45_000
const ADS_BASE        = 'https://archaeologydataservice.ac.uk'

// ─── types ───────────────────────────────────────────────────────────────────

export interface ADSLibraryRawRecord {
  title:           string
  url:             string
  recordId:        string
  recordType:      string
  publicationType: string | undefined
  parentTitle:     string | undefined
  publicationDate: string | undefined
  authors:         string | undefined
  downloadUrl:     string | undefined
}

export interface ADSLibraryFetchResult {
  records: ADSLibraryRawRecord[]
  total:   number
  capped:  boolean
}

// ─── parsing helpers ──────────────────────────────────────────────────────────

/** Strip &nbsp; (U+00A0) and collapse whitespace. */
function clean(text: string): string {
  return text.replace(/[\u00a0\s]+/g, ' ').trim()
}

function toAbsolute(href: string): string {
  return href.startsWith('http') ? href : `${ADS_BASE}${href.startsWith('/') ? '' : '/'}${href}`
}

function extractTotal(doc: Document): number {
  const center = doc.getElementById('resultsCenterDiv')
  if (!center) return 0
  const table = center.querySelector('table')
  if (!table) return 0
  const summaryRow = table.querySelector('tr')
  if (!summaryRow) return 0
  const text = summaryRow.textContent ?? ''
  const m =
    /of\s+([\d,]+)/i.exec(text) ??
    /(\d[\d,]*)\s+result/i.exec(text)
  if (m) return parseInt(m[1].replace(/,/g, ''), 10)
  return 0
}

function parseRecord(tr: Element): ADSLibraryRawRecord | null {
  // Only process rows that contain a catalogue record link
  const titleAnchor = tr.querySelector('a[href*="recordId"]') as HTMLAnchorElement | null
  if (!titleAnchor) return null

  const title   = clean(titleAnchor.textContent ?? '')
  const href    = titleAnchor.getAttribute('href') ?? ''
  const url     = toAbsolute(href)

  const qs         = href.split('?')[1] ?? ''
  const params     = new URLSearchParams(qs)
  const recordId   = params.get('recordId')   ?? ''
  const recordType = params.get('recordType') ?? ''

  // Field divs are siblings of the title anchor inside the float:left container
  const container = titleAnchor.parentElement
  if (!container) return { title, url, recordId, recordType, publicationType: undefined, parentTitle: undefined, publicationDate: undefined, authors: undefined, downloadUrl: undefined }

  let publicationType: string | undefined
  let parentTitle:     string | undefined
  let publicationDate: string | undefined
  let authors:         string | undefined
  let downloadUrl:     string | undefined

  for (const div of container.querySelectorAll(':scope > div')) {
    const raw = clean(div.textContent ?? '')

    if (/^Publication Type:/i.test(raw)) {
      const img = div.querySelector('img') as HTMLImageElement | null
      publicationType = img?.getAttribute('title') ?? raw.replace(/^Publication Type:\s*/i, '')

    } else if (/^Parent Title:/i.test(raw)) {
      parentTitle = raw.replace(/^Parent Title:\s*/i, '')

    } else if (/^Publication Date:/i.test(raw)) {
      publicationDate = raw.replace(/^Publication Date:\s*/i, '')

    } else if (/^Author\(s\):/i.test(raw)) {
      authors = raw.replace(/^Author\(s\):\s*/i, '')

    } else if (/^Abstract:/i.test(raw)) {
      // Look for a download link: <a href="…"><img alt="…download…">
      for (const a of div.querySelectorAll('a[href]')) {
        const img = a.querySelector('img')
        if (img && /download/i.test(img.getAttribute('alt') ?? '')) {
          downloadUrl = toAbsolute(a.getAttribute('href') ?? '')
          break
        }
      }
    }
  }

  return { title, url, recordId, recordType, publicationType, parentTitle, publicationDate, authors, downloadUrl }
}

function parseHTML(html: string): { records: ADSLibraryRawRecord[]; total: number } {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  const total  = extractTotal(doc)
  const center = doc.getElementById('resultsCenterDiv')
  if (!center) return { records: [], total }

  const table = center.querySelector('table')
  if (!table) return { records: [], total }

  const records: ADSLibraryRawRecord[] = []
  for (const tr of table.querySelectorAll('tr')) {
    const rec = parseRecord(tr)
    if (rec) records.push(rec)
  }

  return { records, total }
}

// ─── public API ───────────────────────────────────────────────────────────────

export async function fetchADSLibraryRecords(
  query: string,
  limit: number,
): Promise<ADSLibraryFetchResult> {
  const params     = new URLSearchParams({ q: query, size: String(limit) })
  const url        = `${ADS_LIB_SEARCH}?${params}`
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    console.log('[ADS Library] GET', url)
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`)
    }
    const html              = await res.text()
    const { records, total } = parseHTML(html)
    const capped             = total > 0 && records.length < total
    console.log(`[ADS Library] parsed ${records.length} of ${total}`)
    return { records, total, capped }
  } finally {
    clearTimeout(timer)
  }
}
