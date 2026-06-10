/**
 * filterTransformUtils.ts — pure functions for filter and transform operations.
 * Imported by both the NodeRunner (server-side execution) and any preview logic.
 */

import type { UnifiedRecord } from '../types/UnifiedRecord'
import type { FilterOp, TransformOp } from '../nodes/FilterTransformNode'

// ─── helpers ──────────────────────────────────────────────────────────────────

function toStr(val: unknown): string {
  if (val == null)          return ''
  if (Array.isArray(val))   return val.join(', ')
  return String(val)
}

function resolveField(record: Record<string, unknown>, field: string): unknown {
  if (field.includes('.')) {
    const dot = field.indexOf('.')
    const ns  = field.slice(0, dot)
    const key = field.slice(dot + 1)
    const ns_val = record[ns]
    if (ns_val && typeof ns_val === 'object' && !Array.isArray(ns_val))
      return (ns_val as Record<string, unknown>)[key]
    return undefined
  }
  return record[field]
}

// ─── filter ───────────────────────────────────────────────────────────────────

export function matchFilter(record: UnifiedRecord, op: FilterOp): boolean {
  const str = toStr(resolveField(record as Record<string, unknown>, op.field))
  const num = parseFloat(str)

  switch (op.operator) {
    case 'contains':    return str.toLowerCase().includes(op.value.toLowerCase())
    case 'equals':      return str === op.value
    case 'startsWith':  return str.toLowerCase().startsWith(op.value.toLowerCase())
    case 'isEmpty':     return str.trim() === ''
    case 'isNotEmpty':  return str.trim() !== ''
    case 'greaterThan': return !isNaN(num) && num > parseFloat(op.value)
    case 'lessThan':    return !isNaN(num) && num < parseFloat(op.value)
    default:            return true
  }
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
