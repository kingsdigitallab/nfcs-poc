/**
 * smartFilterUtils — the pure half of Smart Filter.
 *
 * The node asks a KCL model to turn a natural-language request into a
 * `SmartFilter` conditions object; everything here is the deterministic part:
 * the vocabulary, evaluating a condition against a record, and parsing the
 * model's reply tolerantly enough to say WHAT went wrong (a truncated reply
 * used to surface as "Unterminated string in JSON at position 566").
 * Extracted from SmartFilterNode.tsx in Nov 2026 so it can be unit-tested;
 * the node imports from here and holds no private copy.
 */
import { getFieldByPath } from './fieldPath'

export type FilterOp =
  | 'contains' | 'notContains'
  | 'equals'   | 'notEquals'
  | 'startsWith' | 'endsWith'
  | 'gt' | 'lt' | 'gte' | 'lte'
  | 'exists'   | 'notExists'
  | 'in' | 'notIn'

export const FILTER_OPS: readonly FilterOp[] = [
  'contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'endsWith',
  'gt', 'lt', 'gte', 'lte', 'exists', 'notExists', 'in', 'notIn',
]

export interface FilterCondition {
  /** Single field path. Use `fields` instead for multi-field OR text searches. */
  field?: string
  /** Check multiple fields — a record passes if ANY field satisfies a positive condition, EVERY field a negative one. */
  fields?: string[]
  op: FilterOp
  value?: unknown
  caseSensitive?: boolean
}

export interface SmartFilter {
  logic: 'AND' | 'OR'
  conditions: FilterCondition[]
  explanation: string
}

export const OP_LABELS: Record<FilterOp, string> = {
  contains: 'contains', notContains: 'does not contain',
  equals: '=', notEquals: '≠',
  startsWith: 'starts with', endsWith: 'ends with',
  gt: '>', lt: '<', gte: '≥', lte: '≤',
  exists: 'is present', notExists: 'is absent',
  in: 'is one of', notIn: 'is not in list',
}

/** Operators where a multi-field condition must hold for EVERY field (AND across fields). */
const NEGATIVE_OPS = new Set<FilterOp>(['notContains', 'notEquals', 'notExists', 'notIn'])

// ── Evaluation ────────────────────────────────────────────────────────────────

/** Flat key first (literal dotted keys), then a deep dot walk. */
function resolveField(record: Record<string, unknown>, path: string): unknown {
  if (path in record) return record[path]
  return getFieldByPath(record, path)
}

function norm(val: unknown, cs: boolean): string {
  const s = String(val ?? '')
  return cs ? s : s.toLowerCase()
}

export function testSingleField(record: Record<string, unknown>, field: string, c: FilterCondition): boolean {
  const raw = resolveField(record, field)
  const cs  = c.caseSensitive ?? false
  const cv  = c.value

  const isEmpty = raw == null || raw === '' || (Array.isArray(raw) && (raw as unknown[]).length === 0)

  switch (c.op) {
    case 'exists':    return !isEmpty
    case 'notExists': return isEmpty
  }

  const candidates: unknown[] = Array.isArray(raw) ? raw as unknown[] : [raw]
  const list = (): unknown[] => (Array.isArray(cv) ? cv : [cv]) as unknown[]

  switch (c.op) {
    case 'equals':     return candidates.some(v => norm(v, cs) === norm(cv, cs))
    case 'notEquals':  return candidates.every(v => norm(v, cs) !== norm(cv, cs))
    case 'contains':   return candidates.some(v => norm(v, cs).includes(norm(cv as string, cs)))
    case 'notContains':return candidates.every(v => !norm(v, cs).includes(norm(cv as string, cs)))
    case 'startsWith': return candidates.some(v => norm(v, cs).startsWith(norm(cv as string, cs)))
    case 'endsWith':   return candidates.some(v => norm(v, cs).endsWith(norm(cv as string, cs)))
    case 'gt':  return candidates.some(v => Number(v) >  Number(cv))
    case 'lt':  return candidates.some(v => Number(v) <  Number(cv))
    case 'gte': return candidates.some(v => Number(v) >= Number(cv))
    case 'lte': return candidates.some(v => Number(v) <= Number(cv))
    case 'in':    return candidates.some(v => list().some(l => norm(v, cs) === norm(l, cs)))
    case 'notIn': return candidates.every(v => !list().some(l => norm(v, cs) === norm(l, cs)))
    default: return true
  }
}

export function testCondition(record: Record<string, unknown>, c: FilterCondition): boolean {
  const fieldsToCheck = c.fields ?? (c.field ? [c.field] : [])
  if (fieldsToCheck.length === 0) return true
  return NEGATIVE_OPS.has(c.op)
    ? fieldsToCheck.every(f => testSingleField(record, f, c))
    : fieldsToCheck.some(f  => testSingleField(record, f, c))
}

export function applySmartFilter(
  records: Record<string, unknown>[],
  filter: SmartFilter,
  disabled: boolean[] = [],
): Record<string, unknown>[] {
  const active = filter.conditions.filter((_, i) => !disabled[i])
  if (active.length === 0) return records
  return records.filter(r => {
    const results = active.map(c => testCondition(r, c))
    return filter.logic === 'AND' ? results.every(Boolean) : results.some(Boolean)
  })
}

// ── Parsing the model reply ───────────────────────────────────────────────────

export interface ParsedSmartFilter {
  filter?: SmartFilter
  /** Why the reply could not be used — written for the node's status line. */
  error?: string
}

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v)

/**
 * Fence-stripped JSON.parse; on failure, retry on the outermost {…} (models
 * add prose despite response_format); a reply whose braces never close is
 * reported as truncated rather than as a character position. Validates the
 * shape and every `op` so a bad vocabulary is named, not silently ignored.
 */
export function parseSmartFilterResponse(raw: string): ParsedSmartFilter {
  const cleaned = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end   = cleaned.lastIndexOf('}')
    const truncated = { error: 'the reply was cut off before the JSON closed (truncated) — shorten the request, or paste the list into Filter and Transform → in list' }
    if (start === -1) return { error: cleaned.length ? 'the reply was not JSON' : 'the model returned an empty reply' }
    if (end <= start) return truncated
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1))
    } catch {
      return truncated
    }
  }
  if (!isObj(parsed)) return { error: 'the reply was not a JSON object' }
  if (!Array.isArray(parsed.conditions)) return { error: 'the reply has no "conditions" array' }
  const conditions: FilterCondition[] = []
  for (const c of parsed.conditions) {
    if (!isObj(c) || typeof c.op !== 'string') return { error: 'a condition has no "op"' }
    if (!FILTER_OPS.includes(c.op as FilterOp)) return { error: `unknown operator "${c.op}" — supported: ${FILTER_OPS.join(', ')}` }
    conditions.push(c as unknown as FilterCondition)
  }
  return {
    filter: {
      logic:       parsed.logic === 'OR' ? 'OR' : 'AND',
      conditions,
      explanation: typeof parsed.explanation === 'string' ? parsed.explanation : '',
    },
  }
}
