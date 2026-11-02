import type { UnifiedRecord } from '../types/UnifiedRecord'
import { getFieldByPath } from './fieldPath'

/**
 * Year extraction shared by the Timeline component, its runner and the table's
 * date badge. Keep the three in step by changing THIS file only.
 */

/** Parse a date-ish string to a signed year. BCE → negative. Null when nothing parses. */
export function toYear(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null
  const s = String(dateStr).trim()
  if (/^-\d+$/.test(s)) return parseInt(s, 10)
  const bce = /(\d+)\s*(?:BCE|B\.C\.E\.?|BC|B\.C\.)/i.exec(s)
  if (bce) return -parseInt(bce[1], 10)
  const m = /\b(\d{4})\b/.exec(s)
  if (m) { const n = parseInt(m[1], 10); if (n >= 0 && n <= 2200) return n }
  const m3 = /\b(\d{3})\b/.exec(s)
  if (m3) return parseInt(m3[1], 10)
  return null
}

/**
 * Automatic date-field priority. `periodStart` comes FIRST on purpose: the
 * ARIADNE/HSDS adapters also write `date` from the catalogue's `issued` field
 * (e.g. 2020-06-08), so with `date` first a Stonehenge result set plots in the
 * 2000s instead of the Neolithic. `gbif.eventDate` is mirrored into `date` by
 * the adapter but records transformed upstream may carry only the namespaced copy.
 */
export const AUTO_DATE_FIELDS = ['periodStart', 'date', 'gbif.eventDate'] as const

export interface ResolvedYear {
  year:  number
  /** The record path the year was read from — shown in the timeline's key. */
  field: string
}

/**
 * Resolve a record's plottable year. With `dateField` set, only that path is
 * consulted (no fallback); otherwise the first AUTO_DATE_FIELDS path that parses.
 */
export function resolveRecordYear(r: UnifiedRecord, dateField?: string): ResolvedYear | null {
  if (dateField) {
    const year = toYear(getFieldByPath(r, dateField) as string | undefined)
    return year === null ? null : { year, field: dateField }
  }
  for (const field of AUTO_DATE_FIELDS) {
    const year = toYear(getFieldByPath(r, field) as string | undefined)
    if (year !== null) return { year, field }
  }
  return null
}
