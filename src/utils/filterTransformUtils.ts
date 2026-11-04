/**
 * filterTransformUtils.ts — pure functions for filter and transform operations.
 * Imported by both the NodeRunner (server-side execution) and any preview logic.
 */

import type { UnifiedRecord } from '../types/UnifiedRecord'
import type { FilterOp, TransformOp } from '../nodes/FilterTransformNode'
import { getFieldByPath } from './fieldPath'
import { collectFieldPaths } from './fieldPaths'

// ─── helpers ──────────────────────────────────────────────────────────────────

function toStr(val: unknown): string {
  if (val == null)          return ''
  if (Array.isArray(val))   return val.join(', ')
  return String(val)
}

/** Flat key first (a record may carry a literal dotted key), then a deep dot walk. */
function resolveField(record: Record<string, unknown>, field: string): unknown {
  if (field in record) return record[field]
  return getFieldByPath(record, field)
}

/**
 * The value of an `in` / `notIn` condition: one entry per line or comma,
 * trimmed, blanks dropped. A leading `IDS:` label is ignored so the last line
 * of the "Flag misfiled records by id" recipe pastes verbatim.
 */
export function parseListValue(value: string): string[] {
  return value
    .replace(/^\s*ids\s*:/i, '')
    .split(/[\n,]/)
    .map(s => s.trim())
    .filter(Boolean)
}

/** The strings an exact-match operator compares: each element of an array field, else the one value. */
function elements(raw: unknown): string[] {
  if (raw == null) return ['']
  return Array.isArray(raw) ? raw.map(v => toStr(v)) : [String(raw)]
}

function safeRegex(pattern: string): RegExp | null {
  try { return new RegExp(pattern, 'i') } catch { return null }
}

// ─── filter ───────────────────────────────────────────────────────────────────

export function matchFilter(record: UnifiedRecord, op: FilterOp): boolean {
  const raw = resolveField(record as Record<string, unknown>, op.field)
  const str = toStr(raw)
  const num = parseFloat(str)
  const lc  = str.toLowerCase()
  const val = op.value
  const vlc = val.toLowerCase()

  switch (op.operator) {
    case 'contains':    return lc.includes(vlc)
    case 'notContains': return !lc.includes(vlc)
    case 'equals':      return elements(raw).some(e => e === val)
    case 'notEquals':   return elements(raw).every(e => e !== val)
    case 'startsWith':  return lc.startsWith(vlc)
    case 'endsWith':    return lc.endsWith(vlc)
    case 'in': {
      const list = parseListValue(val)
      return elements(raw).some(e => list.includes(e.trim()))
    }
    case 'notIn': {
      const list = parseListValue(val)
      return elements(raw).every(e => !list.includes(e.trim()))
    }
    case 'matches': {
      const re = safeRegex(val)
      return re ? re.test(str) : false
    }
    case 'isEmpty':     return str.trim() === ''
    case 'isNotEmpty':  return str.trim() !== ''
    case 'greaterThan': return !isNaN(num) && num > parseFloat(val)
    case 'lessThan':    return !isNaN(num) && num < parseFloat(val)
    default:            return true
  }
}

// ─── field picker ─────────────────────────────────────────────────────────────

export interface FilterFieldOption {
  /** 'core' for top-level fields, else the namespace (`gbif`, `europeana`, …). */
  group: string
  path:  string
  /** Records (within the sample) that carry a value at this path. */
  count: number
  total: number
}

/**
 * The paths a Filter and Transform condition can target: everything
 * `collectFieldPaths` finds (all namespaces, numbers and booleans included)
 * plus `id` and `_source` — the two keys users filter on that the generic
 * walker leaves out (`_`-prefix rule). Core fields first, then namespaces in
 * first-seen order. Replaced reconciliationService.candidateFields here
 * (Nov 2026): that helper excluded `id`, coordinates and every namespace but
 * gbif/llds/ads/mds, and skipped numbers.
 */
export function filterFieldOptions(records: UnifiedRecord[]): FilterFieldOption[] {
  if (!records.length) return []
  const total = records.length
  const infos = collectFieldPaths(records)
  const has = (path: string) => infos.some(i => i.path === path)
  const countOf = (path: string) => records.filter(r => {
    const v = resolveField(r as Record<string, unknown>, path)
    return v != null && v !== '' && !(Array.isArray(v) && v.length === 0)
  }).length

  const core: FilterFieldOption[] = []
  const byNs = new Map<string, FilterFieldOption[]>()
  const push = (path: string, count: number) => {
    const dot = path.indexOf('.')
    if (dot === -1) { core.push({ group: 'core', path, count, total }); return }
    const ns = path.slice(0, dot)
    if (!byNs.has(ns)) byNs.set(ns, [])
    byNs.get(ns)!.push({ group: ns, path, count, total })
  }

  if (!has('id')) push('id', countOf('id'))
  push('_source', countOf('_source'))
  for (const i of infos) push(i.path, i.count)
  // id is always the first option; the rest keep collectFieldPaths' order
  core.sort((a, b) => (a.path === 'id' ? -1 : b.path === 'id' ? 1 : 0))
  return [...core, ...[...byNs.values()].flat()]
}

export function applyFilters(
  records: UnifiedRecord[],
  ops: FilterOp[],
  combinator: 'AND' | 'OR',
): UnifiedRecord[] {
  const active = ops.filter(o => o.field)
  if (active.length === 0) return records
  return records.filter(r => {
    const hits = active.map(op => matchFilter(r, op))
    return combinator === 'AND' ? hits.every(Boolean) : hits.some(Boolean)
  })
}

// ─── transform ────────────────────────────────────────────────────────────────

export function applyTransform(
  r: Record<string, unknown>,
  op: TransformOp,
): Record<string, unknown> {
  switch (op.type) {

    case 'rename': {
      if (!op.field || !op.newName) return r
      const out = { ...r, [op.newName]: resolveField(r, op.field) }
      if (op.dropOriginal) delete out[op.field]
      return out
    }

    case 'extract': {
      if (!op.field) return r
      const str = toStr(resolveField(r, op.field))
      let result: string
      if (op.useRegex && op.regex) {
        try {
          const m = str.match(new RegExp(op.regex))
          result = m ? (m[1] ?? m[0]) : ''
        } catch { result = '' }
      } else {
        const s = op.start !== '' ? parseInt(op.start, 10) : 0
        const e = op.end   !== '' ? parseInt(op.end,   10) : undefined
        result = str.slice(s, e)
      }
      return { ...r, [op.newField || `${op.field}_extracted`]: result }
    }

    case 'concat': {
      const v1  = toStr(resolveField(r, op.field1))
      const v2  = toStr(resolveField(r, op.field2))
      const key = op.newField
        || [op.field1, op.field2].filter(Boolean).join('_')
        || 'concat'
      return { ...r, [key]: v1 + op.separator + v2 }
    }

    case 'lowercase': {
      if (!op.field) return r
      const raw = resolveField(r, op.field)
      return { ...r, [op.field]: Array.isArray(raw)
        ? raw.map(v => String(v).toLowerCase())
        : toStr(raw).toLowerCase()
      }
    }

    case 'uppercase': {
      if (!op.field) return r
      const raw = resolveField(r, op.field)
      return { ...r, [op.field]: Array.isArray(raw)
        ? raw.map(v => String(v).toUpperCase())
        : toStr(raw).toUpperCase()
      }
    }

    case 'truncate': {
      if (!op.field) return r
      const maxLen = Math.max(1, parseInt(op.maxLen, 10) || 100)
      const str = toStr(resolveField(r, op.field))
      return { ...r, [op.field]: str.length > maxLen ? `${str.slice(0, maxLen)}…` : str }
    }

    case 'splitToList': {
      if (!op.field) return r
      const raw = toStr(resolveField(r, op.field))
      if (!raw.trim()) return r
      let items: string[] = []
      try {
        switch (op.mode) {
          case 'lines':
            items = raw
              .split(/\r?\n/)
              .map(s => s.trim().replace(/^[-*•\d]+[.)]\s*/, ''))
              .filter(Boolean)
            break
          case 'delimiter':
            items = raw.split(op.delimiter || ',').map(s => s.trim()).filter(Boolean)
            break
          case 'json': {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) items = parsed.map(v => String(v).trim()).filter(Boolean)
            break
          }
          case 'jsonObjects': {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed) && op.jsonKey)
              items = parsed
                .map(obj => (obj && typeof obj === 'object'
                  ? String((obj as Record<string, unknown>)[op.jsonKey] ?? '')
                  : ''))
                .filter(Boolean)
            break
          }
        }
      } catch { return r }
      if (items.length === 0) return r
      const seen = new Set<string>()
      const deduped = items.filter(s => { if (seen.has(s)) return false; seen.add(s); return true })
      const outField = op.newField || `${op.field}_list`
      return { ...r, [outField]: deduped }
    }

    case 'dropFields': {
      if (!op.fields?.length) return r
      const out = { ...r }
      op.fields.forEach(f => delete out[f])
      return out
    }

    case 'keepFields': {
      if (!op.fields?.length) return r
      const kept: Record<string, unknown> = {}
      op.fields.forEach(f => {
        if (f in r) kept[f] = r[f]
        const rc = `${f}_reconciled`
        if (rc in r) kept[rc] = r[rc]
      })
      return kept
    }

    default: return r
  }
}

export function applyTransforms(
  records: UnifiedRecord[],
  ops: TransformOp[],
): UnifiedRecord[] {
  const active = ops.filter(op => {
    if (op.type === 'concat')                                 return !!(op.field1 || op.field2)
    if (op.type === 'dropFields' || op.type === 'keepFields') return op.fields.length > 0
    return !!op.field
  })
  if (active.length === 0) return records
  return records.map(record => {
    let r = record as unknown as Record<string, unknown>
    for (const op of active) r = applyTransform(r, op)
    return r as unknown as UnifiedRecord
  })
}
