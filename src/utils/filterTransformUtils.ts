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

// ─── filter ───────────────────────────────────────────────────────────────────

export function matchFilter(record: UnifiedRecord, op: FilterOp): boolean {
  const str = toStr((record as Record<string, unknown>)[op.field])
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
      const out = { ...r, [op.newName]: r[op.field] }
      if (op.dropOriginal) delete out[op.field]
      return out
    }

    case 'extract': {
      if (!op.field) return r
      const str = toStr(r[op.field])
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
      const v1  = toStr(r[op.field1])
      const v2  = toStr(r[op.field2])
      const key = op.newField
        || [op.field1, op.field2].filter(Boolean).join('_')
        || 'concat'
      return { ...r, [key]: v1 + op.separator + v2 }
    }

    case 'lowercase': {
      if (!op.field) return r
      const raw = r[op.field]
      return { ...r, [op.field]: Array.isArray(raw)
        ? raw.map(v => String(v).toLowerCase())
        : toStr(raw).toLowerCase()
      }
    }

    case 'uppercase': {
      if (!op.field) return r
      const raw = r[op.field]
      return { ...r, [op.field]: Array.isArray(raw)
        ? raw.map(v => String(v).toUpperCase())
        : toStr(raw).toUpperCase()
      }
    }

    case 'truncate': {
      if (!op.field) return r
      const maxLen = Math.max(1, parseInt(op.maxLen, 10) || 100)
      const str = toStr(r[op.field])
      return { ...r, [op.field]: str.length > maxLen ? `${str.slice(0, maxLen)}…` : str }
    }

    default: return r
  }
}

export function applyTransforms(
  records: UnifiedRecord[],
  ops: TransformOp[],
): UnifiedRecord[] {
  const active = ops.filter(op =>
    op.type === 'concat' ? !!(op.field1 || op.field2) : !!op.field,
  )
  if (active.length === 0) return records
  return records.map(record => {
    let r = record as unknown as Record<string, unknown>
    for (const op of active) r = applyTransform(r, op)
    return r as unknown as UnifiedRecord
  })
}
