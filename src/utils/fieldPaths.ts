/**
 * Field-path discovery for the AI Inference nodes' pickers: every top-level
 * scalar/array plus one level into namespace objects (`vam.thumbnail`,
 * `gbif.scientificName`), across ALL connected sources, with a population
 * count and a coarse kind so image-valued paths can be offered to the vision
 * model. Values are read back with getFieldByPath (fieldPath.ts).
 */
import type { UnifiedRecord } from '../types/UnifiedRecord'
import { getFieldByPath } from './fieldPath'
import { IMAGE_VALUE } from './imageFields'
import { isImageServiceRef } from './iiifImage'

export type FieldKind = 'scalar' | 'array' | 'image'

export interface FieldPathInfo {
  path:  string
  kind:  FieldKind
  /** Records (all, not just representatives) with a non-null, non-empty value at `path`. */
  count: number
}

export interface CollectFieldPathsOptions {
  /** How many records to inspect for keys beyond one representative per `_source`. */
  sample?: number
}

const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v)
const skipKey = (k: string) => k.startsWith('_') || k.endsWith('_reconciled')

/**
 * Keys whose http(s) value is an image even without an image extension —
 * Europeana's thumbnail API URL ends in `.json?uri=…`. Narrower than
 * imageFields.IMAGE_KEYS on purpose: this kind drives the AI node's default
 * Input mode, so `url`/`href` record-page links must stay text.
 */
const IMAGE_KIND_KEYS = /thumb|image|photo|picture|preview|icon/i

function kindOf(path: string, v: unknown): FieldKind {
  if (Array.isArray(v)) return 'array'
  if (typeof v !== 'string') return 'scalar'
  if (isImageServiceRef(path, v) || IMAGE_VALUE.test(v)) return 'image'
  if (/^https?:\/\//i.test(v) && IMAGE_KIND_KEYS.test(path.split('.').at(-1) ?? '')) return 'image'
  return 'scalar'
}

function present(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

export function collectFieldPaths(records: UnifiedRecord[], { sample = 50 }: CollectFieldPathsOptions = {}): FieldPathInfo[] {
  if (!records.length) return []

  // One representative per _source guarantees every service's namespace is
  // seen; the sample on top catches sparse keys within a source.
  const seen = new Set<string>()
  const probe: Record<string, unknown>[] = []
  for (const r of records) {
    const src = String((r as Record<string, unknown>)._source ?? '')
    if (!seen.has(src)) { seen.add(src); probe.push(r as Record<string, unknown>) }
  }
  for (const r of records.slice(0, sample)) if (!probe.includes(r as Record<string, unknown>)) probe.push(r as Record<string, unknown>)

  const kinds = new Map<string, FieldKind>()
  const note = (path: string, v: unknown) => {
    const k = kindOf(path, v)
    const prev = kinds.get(path)
    // an image sighting wins over a scalar one for the same path
    if (!prev || (prev === 'scalar' && k !== 'scalar')) kinds.set(path, k)
  }
  for (const r of probe) {
    for (const [k, v] of Object.entries(r)) {
      if (skipKey(k) || v == null) continue
      if (isObj(v)) {
        for (const [nk, nv] of Object.entries(v)) {
          if (skipKey(nk) || nv == null || isObj(nv)) continue
          note(`${k}.${nk}`, nv)
        }
      } else {
        note(k, v)
      }
    }
  }

  const top    = [...kinds.keys()].filter(p => !p.includes('.')).sort()
  const nested = [...kinds.keys()].filter(p => p.includes('.')).sort()
  return [...top, ...nested].map(path => ({
    path,
    kind:  kinds.get(path)!,
    count: records.reduce((n, r) => n + (present(getFieldByPath(r, path)) ? 1 : 0), 0),
  }))
}
