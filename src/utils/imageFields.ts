import type { UnifiedRecord } from '../types/UnifiedRecord'
import { getFieldByPath, nonEmptyString } from './fieldPath'

/**
 * Image-field discovery for ImageViewNode. Pure so it can be unit-tested; the
 * node only renders what this returns.
 */

/**
 * Namespaced keys matching this are offered as image candidates. Deliberately
 * broad (url/href/src/media match record-page links too) — a decision taken on
 * 2026-11-02; a wrong entry in the "Image fields" group is preferred over a
 * missing one.
 */
export const IMAGE_KEYS = /thumb|image|url|src|href|photo|picture|preview|media|icon/i

/** A sample VALUE that is evidently an image, whatever its key is called. */
const IMAGE_VALUE = /^data:image\/|^https?:\/\/.+\.(?:jpe?g|png|gif|webp|svg|tiff?)(?:[?#].*)?$|^https?:\/\/.+\/iiif\//i

export interface ImageFieldCandidate {
  path:  string
  /** Records (all upstream, not just representatives) with a non-empty string at `path`. */
  count: number
}

export interface ImageFieldCandidates {
  /** Sorted by population desc, then path. */
  imageFields: ImageFieldCandidate[]
  /** Every other discovered top-level key, alphabetical. */
  otherFields: string[]
}

/** Records with a non-empty string at `path`; an empty path returns everything. */
export function recordsWithField(records: UnifiedRecord[], path: string): UnifiedRecord[] {
  if (!path) return records
  return records.filter(r => nonEmptyString(getFieldByPath(r, path)))
}

export function collectImageFieldCandidates(records: UnifiedRecord[]): ImageFieldCandidates {
  if (!records.length) return { imageFields: [], otherFields: [] }

  // One representative record per _source ensures namespace fields from every
  // connected data service are discovered, regardless of dataset sizes.
  const seen = new Set<string>()
  const representatives: UnifiedRecord[] = []
  for (const r of records) {
    const src = (r as Record<string, unknown>)._source as string | undefined ?? ''
    if (!seen.has(src)) { seen.add(src); representatives.push(r) }
  }

  const imagePaths = new Set<string>()
  const otherPaths = new Set<string>()
  for (const r of representatives) {
    for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
      if (k.startsWith('_')) continue
      if (typeof v === 'string' && IMAGE_VALUE.test(v)) { imagePaths.add(k); continue }
      otherPaths.add(k)
      if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        for (const [nk, nv] of Object.entries(v as Record<string, unknown>)) {
          const path = `${k}.${nk}`
          if (IMAGE_KEYS.test(nk) && (typeof nv === 'string' || nv == null)) imagePaths.add(path)
          else if (typeof nv === 'string' && IMAGE_VALUE.test(nv)) imagePaths.add(path)
        }
      }
    }
  }
  for (const p of imagePaths) otherPaths.delete(p)

  const imageFields = [...imagePaths]
    .map(path => ({ path, count: recordsWithField(records, path).length }))
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))

  return { imageFields, otherFields: [...otherPaths].sort() }
}
