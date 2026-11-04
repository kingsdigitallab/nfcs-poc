/**
 * aggregateValues — the ONE builder of the {{values}} block for the field-
 * inference nodes' aggregate mode (AI Inference (by field) and OllamaByField,
 * runner and component paths — four hand-copied join blocks collapsed Nov 2026).
 *
 * Each value is headed by "id: <id> · title (Source)" so the model can name
 * records in its answer and those ids can be pasted into Filter and Transform.
 * (The image-aggregate path numbers its images instead — imageListText in
 * kclVision.ts — because there the model answers "by number"; here it must
 * answer by id, so no number is offered.)
 *
 * Truncation lives here on purpose: per-value truncation happens BEFORE
 * concatenation (CLAUDE.md gotcha 19), and the whole block stops at maxChars
 * on an item boundary — a heading is never cut in half, and `included`
 * reports what the model really received so {{count}} stays honest.
 */
import { getFieldByPath } from './fieldPath'
import { sourceName } from './sourceIdentity'

export const DEFAULT_AGGREGATE_PROMPT =
  'The following are {{field}} values from {{count}} research records. '
  + 'Each value is headed by a line beginning "id:" giving its record id, title and source. '
  + 'Provide a concise thematic summary of what this collection covers; when you refer to particular records, quote the id exactly as given after "id:":\n\n{{values}}'

export interface AggregateOptions {
  /** Head each value with recordHeading — default true. */
  label?: boolean
  /** Budget for the whole joined block (getContentMaxChars). Omitted = uncapped. */
  maxChars?: number
}

export interface AggregateResult {
  /** The joined block for {{values}}. */
  values:   string
  /** Values actually sent: non-empty and inside the budget. */
  included: number
  /** Upstream records offered. */
  total:    number
}

const SEP = '\n---\n'
const MIN_PER_VALUE = 500

/**
 * "id: vam:12 · Roman coin (V&A)" — what the model is told to cite.
 * Deliberately NOT numbered: a first cut used "[n] id · title" and the model
 * answered with the bracketed positions ("[8], [21]…") because they were the
 * shortest id-looking token on the line, especially next to long Europeana
 * ids. Naming the id and giving it nothing to compete with fixed it.
 */
export function recordHeading(r: Record<string, unknown>): string {
  const id    = String(r.id ?? '').trim()
  const title = String(r.title ?? '').trim()
  const src   = typeof r._source === 'string' && r._source ? ` (${sourceName(r._source)})` : ''
  const name  = [id, title && title !== id ? title : ''].filter(Boolean).join(' · ')
  return `id:${name ? ' ' + name : ''}${src}`
}

function readValue(r: Record<string, unknown>, field: string): string {
  const v = field in r ? r[field] : getFieldByPath(r, field)
  return Array.isArray(v) ? v.join('; ') : String(v ?? '').trim()
}

export function aggregateFieldValues(
  records: Record<string, unknown>[],
  field: string,
  opts: AggregateOptions = {},
): AggregateResult {
  const label    = opts.label ?? true
  const maxChars = opts.maxChars
  const total    = records.length
  const perValMax = maxChars === undefined
    ? Infinity
    : Math.max(MIN_PER_VALUE, Math.floor(maxChars / Math.max(total, 1)))

  const items: string[] = []
  for (const r of records) {
    const raw = readValue(r, field)
    if (!raw) continue
    const value = raw.length > perValMax ? raw.slice(0, perValMax) + '…' : raw
    items.push(label ? `${recordHeading(r)}\n${value}` : value)
  }

  if (maxChars === undefined) return { values: items.join(SEP), included: items.length, total }

  let out = ''
  let included = 0
  for (const item of items) {
    const next = included === 0 ? item : out + SEP + item
    if (next.length > maxChars) break
    out = next
    included++
  }
  // A single value can exceed the budget on its own (perValMax ≥ 500, plus the
  // heading) — send it cut rather than nothing.
  if (included === 0 && items.length > 0) return { values: items[0].slice(0, maxChars), included: 1, total }
  return { values: out, included, total }
}
