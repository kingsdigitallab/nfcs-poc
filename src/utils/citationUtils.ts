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

// ── Per-record formatting ─────────────────────────────────────────────────────

/** Format a single record as a plain-text bibliographic reference. */
export function formatRecordCitation(c: RecordCitation): string {
  const parts: string[] = []
  if (c.creator) {
    parts.push(Array.isArray(c.creator) ? c.creator.join('; ') : c.creator)
  }
  if (c.date) parts.push(`(${c.date})`)
  if (c.title) parts.push(`"${c.title}"`)
  parts.push(c.publisher ? `${c.service} / ${c.publisher}` : c.service)
  const link = c.pid || c.url
  if (link) parts.push(`Available at: ${link}`)
  parts.push(
    `Accessed: ${new Date(c.accessDate).toLocaleDateString('en-GB', {
      year: 'numeric', month: 'long', day: 'numeric',
    })}`,
  )
  if (c.licence) parts.push(`Licence: ${c.licence}`)
  return parts.join('. ')
}

/** Format all per-record citations from a record set for copy / download. */
export function formatAllCitations(records: Record<string, unknown>[]): string {
  const citable = records.filter(r => r._citation && typeof r._citation === 'object' && !Array.isArray(r._citation))
  if (citable.length === 0) return 'No citation metadata available.'
  return citable
    .map((r, i) => `[${i + 1}] ${formatRecordCitation(r._citation as RecordCitation)}`)
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
