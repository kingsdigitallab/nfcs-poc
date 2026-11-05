export interface RecordCitation {
  /** Data service name, e.g. 'GBIF', 'ADS' */
  service: string
  /** Canonical homepage of the service */
  serviceUrl: string
  /** ISO 8601 timestamp of when the node was run */
  accessDate: string
  /** Institutional publisher of the service */
  publisher?: string
  /** Data licence declared by the service */
  licence?: string
  /** Search query used to retrieve this record */
  query?: string
  /** Service's own identifier for this record */
  recordId?: string
  /** Record title */
  title?: string
  /** Direct URL to this record in the service's UI */
  url?: string
  /** Persistent identifier — DOI, handle, ARK, etc. */
  pid?: string
  /** Author / creator of the record */
  creator?: string | string[]
  /** Publication / event date of the record */
  date?: string
}

// ── Citation styles ───────────────────────────────────────────────────────────

export type CitationStyle = 'harvard' | 'apa' | 'mla' | 'chicago'

export const CITATION_STYLES: Record<CitationStyle, { label: string }> = {
  harvard: { label: 'Harvard' },
  apa:     { label: 'APA 7th' },
  mla:     { label: 'MLA 9th' },
  chicago: { label: 'Chicago (author-date)' },
}

export const DEFAULT_CITATION_STYLE: CitationStyle = 'harvard'

export function isCitationStyle(v: unknown): v is CitationStyle {
  return typeof v === 'string' && v in CITATION_STYLES
}

/** A reference split around its title so a UI can link the title. `before + title + after` is the string form. */
export interface CitationParts {
  before: string
  title:  string
  after:  string
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
// MLA abbreviates every month longer than four letters
const MLA_MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.']

function accessedOn(iso: string, style: CitationStyle): string {
  const dt = new Date(iso)
  if (Number.isNaN(dt.getTime())) return iso
  const d = dt.getDate(), m = dt.getMonth(), y = dt.getFullYear()
  switch (style) {
    case 'harvard': return `${d} ${MONTHS[m]} ${y}`
    case 'mla':     return `${d} ${MLA_MONTHS[m]} ${y}`
    default:        return `${MONTHS[m]} ${d}, ${y}`   // APA and Chicago
  }
}

/** First four-digit year in the record date, else n.d. (ISO dates, bare years, "c. 1850", "1960-1965"). */
function yearOf(c: RecordCitation): string {
  const m = /\d{4}/.exec(c.date ?? '')
  return m ? m[0] : 'n.d.'
}

const endsWithStop = (s: string) => /[.?!]$/.test(s)
/** Append a full stop unless the text already ends in terminal punctuation (initials, "& Co.", "?"). */
const stop = (s: string) => (endsWithStop(s) ? s : `${s}.`)

function creators(c: RecordCitation): string[] {
  const raw = Array.isArray(c.creator) ? c.creator : c.creator ? [c.creator] : []
  return raw.map(s => String(s).trim()).filter(Boolean)
}

/** Author string per style; with no creator the publisher (else the service) stands in as corporate author. */
function authors(c: RecordCitation, style: CitationStyle): { text: string; corporate: boolean } {
  const list = creators(c)
  if (list.length === 0) return { text: c.publisher || c.service, corporate: true }
  if (list.length === 1) return { text: list[0], corporate: false }
  const head = list.slice(0, -1), last = list[list.length - 1]
  switch (style) {
    case 'harvard': return { text: `${head.join(', ')} and ${last}`, corporate: false }
    case 'apa':     return { text: `${head.join(', ')}, & ${last}`, corporate: false }
    case 'mla':     return { text: list.length === 2 ? `${list[0]}, and ${last}` : `${list[0]}, et al.`, corporate: false }
    case 'chicago': return { text: `${head.join(', ')}, and ${last}`, corporate: false }
  }
}

/** Service and publisher (when it adds information), minus whatever already stands as corporate author. */
function container(c: RecordCitation, corporateAuthor: string | null, sep: string): string {
  const parts = [c.service]
  if (c.publisher && c.publisher !== c.service) parts.push(c.publisher)
  return parts.filter(p => p !== corporateAuthor).join(sep)
}

/** The link: a URL pid as-is, a DOI pid resolved via doi.org, else the record URL, else the service homepage. */
function linkOf(c: RecordCitation): string {
  const pid = (c.pid ?? '').trim()
  if (/^https?:\/\//i.test(pid)) return pid
  const doi = /^(?:doi:)?(10\.\d{4,9}\/\S+)$/i.exec(pid)
  if (doi) return `https://doi.org/${doi[1]}`
  return c.url || c.serviceUrl
}

/** Format a single record as a bibliographic reference, split around the title. */
export function formatRecordCitationParts(c: RecordCitation, style: CitationStyle = DEFAULT_CITATION_STYLE): CitationParts {
  const a      = authors(c, style)
  const corp   = a.corporate ? a.text : null
  const year   = yearOf(c)
  const title  = (c.title ?? '').trim() || (c.recordId ? `Record ${c.recordId}` : 'Untitled record')
  const link   = linkOf(c)
  const when   = accessedOn(c.accessDate, style)
  const tStop  = endsWithStop(title) ? '' : '.'

  switch (style) {
    case 'harvard': {
      const cont = container(c, corp, ', ')
      const tail = [
        `${tStop} [Online]`, cont ? ` ${stop(cont)}` : '',
        ` Available at: ${link} (Accessed: ${when}).`,
        c.licence ? ` Licence: ${stop(c.licence)}` : '',
      ].join('')
      return { before: `${a.text} (${year}) `, title, after: tail }
    }
    case 'apa': {
      const cont = container(c, corp, '; ')
      return { before: `${stop(a.text)} (${year}). `, title, after: ` [Data set].${cont ? ` ${stop(cont)}` : ''} ${link}` }
    }
    case 'mla': {
      const cont = container(c, corp, ', ')
      return { before: `${stop(a.text)} "`, title, after: `${tStop}" ${cont ? `${cont}, ` : ''}${year}, ${link}. Accessed ${when}.` }
    }
    case 'chicago': {
      const cont = container(c, corp, ', ')
      return { before: `${stop(a.text)} ${stop(year)} "`, title, after: `${tStop}"${cont ? ` ${stop(cont)}` : ''} Accessed ${when}. ${link}.` }
    }
  }
}

/** Format a single record as a plain-text bibliographic reference in the given style (Harvard by default). */
export function formatRecordCitation(c: RecordCitation, style: CitationStyle = DEFAULT_CITATION_STYLE): string {
  const p = formatRecordCitationParts(c, style)
  return p.before + p.title + p.after
}

/** The records that carry a `_citation` object (the one filter the node and the formatter share). */
export function citableRecords<T extends Record<string, unknown>>(records: T[]): T[] {
  return records.filter(r => !!r._citation && typeof r._citation === 'object' && !Array.isArray(r._citation))
}

/**
 * Identity of a citable set for "reset the page when upstream changes":
 * length + first and last ids. `useUpstreamRecords` rebuilds its array every
 * render, so keying an effect on the array itself reset the page on every
 * click (the pagination that never left page 1).
 */
export function citationFingerprint(citable: Record<string, unknown>[]): string {
  const first = citable[0]?.id ?? ''
  const last  = citable[citable.length - 1]?.id ?? ''
  return `${citable.length}:${String(first)}:${String(last)}`
}

/** Format all per-record citations from a record set for copy / download. */
export function formatAllCitations(records: Record<string, unknown>[], style: CitationStyle = DEFAULT_CITATION_STYLE): string {
  const citable = citableRecords(records)
  if (citable.length === 0) return 'No citation metadata available.'
  return citable
    .map((r, i) => `[${i + 1}] ${formatRecordCitation(r._citation as RecordCitation, style)}`)
    .join('\n\n')
}

// ── Search-run aggregation (used by ExportNode / future tooling) ──────────────

function citationKey(c: RecordCitation): string {
  return `${c.service}::${c.query ?? ''}::${c.accessDate.slice(0, 16)}`
}

/** Deduplicate citations by service + query + minute — one entry per search run. */
export function groupCitationsBySearch(records: Record<string, unknown>[]): RecordCitation[] {
  const seen = new Map<string, RecordCitation>()
  for (const record of records) {
    const c = record._citation
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue
    const key = citationKey(c as RecordCitation)
    if (!seen.has(key)) seen.set(key, c as RecordCitation)
  }
  return Array.from(seen.values())
}

/** Count how many records came from each search run. */
export function countBySearch(records: Record<string, unknown>[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const record of records) {
    const c = record._citation
    if (!c || typeof c !== 'object' || Array.isArray(c)) continue
    const key = citationKey(c as RecordCitation)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

// ── Runner helper ─────────────────────────────────────────────────────────────

/**
 * Stamp _citation onto each record in a batch. Call in source runners after
 * the adapter produces records. Per-record fields are derived from the record
 * itself; service-level fields come from base.
 */
export function addCitation<T extends Record<string, unknown>>(
  records: T[],
  base: Omit<RecordCitation, 'recordId' | 'url' | 'pid' | 'title' | 'creator' | 'date'>,
): (T & { _citation: RecordCitation })[] {
  return records.map(r => ({
    ...r,
    _citation: {
      ...base,
      recordId: r.id      as string | undefined,
      title:    r.title   as string | undefined,
      url:      r._sourceUrl as string | undefined,
      pid:      r._pid    as string | undefined,
      creator:  r.creator as string | string[] | undefined,
      date:     r.date    as string | undefined,
    },
  }))
}
