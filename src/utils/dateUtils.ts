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

/**
 * A period wider than this is a classification bucket, not a position —
 * ARIADNE's "prehistoric" is -500000..43 and "palaeolithic" starts at -1000000.
 * Fixture census (Nov 2026): 5% of period records; the 95th-percentile span is
 * 22,000 years, the 90th 1,900. In automatic mode such periods are skipped so
 * resolution falls through to the catalogue date instead of stretching the
 * timeline axis over half a million years. An explicit dateField ignores this.
 */
export const MAX_PERIOD_SPAN_YEARS = 20_000

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
    if (year === null) continue
    if (field === 'periodStart') {
      const end = toYear(r.periodEnd as string | undefined)
      if (end !== null && end - year > MAX_PERIOD_SPAN_YEARS) continue
    }
    return { year, field }
  }
  return null
}
