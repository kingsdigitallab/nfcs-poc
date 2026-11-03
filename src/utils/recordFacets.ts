/**
 * recordFacets — the ONLY per-record predicates behind the Table Output
 * header badges (📍 coordinates, 📅 plottable date, 🖼 image) and the Map's
 * "mappable" filter. Keep them here so the badge counts can never disagree
 * with the node they point the user at.
 */
import type { UnifiedRecord } from '../types/UnifiedRecord'
import { resolveRecordYear } from './dateUtils'
import { collectFieldPaths } from './fieldPaths'
import { getFieldByPath } from './fieldPath'

/** MapOutputNode's exact predicate. */
export const hasCoordinates = (r: Record<string, unknown>): boolean =>
  r.decimalLatitude != null && r.decimalLongitude != null

/** Timeline's automatic year resolution succeeds. */
export const hasPlottableDate = (r: UnifiedRecord): boolean => resolveRecordYear(r) !== null

/**
 * Image-kind field paths present across `records` — thumbnails, data URLs,
 * IIIF manifests and Image API services (`vam.iiifImageBase`), as classified
 * by collectFieldPaths (the same list the AI Inference pickers offer).
 */
export function imagePathsOf(records: UnifiedRecord[]): string[] {
  return collectFieldPaths(records).filter(f => f.kind === 'image').map(f => f.path)
}

/** True when any of `imagePaths` holds a non-empty string on `r`. */
export function hasImage(r: Record<string, unknown>, imagePaths: string[]): boolean {
  for (const p of imagePaths) {
    const v = getFieldByPath(r, p)
    if (typeof v === 'string' && v.trim().length > 0) return true
  }
  return false
}

export interface RecordFacets { coords: number; dates: number; images: number }

/** One pass over `records` for the three header badges. */
export function countFacets(records: UnifiedRecord[]): RecordFacets {
  const paths = records.length ? imagePathsOf(records) : []
  let coords = 0, dates = 0, images = 0
  for (const r of records) {
    if (hasCoordinates(r))          coords++
    if (hasPlottableDate(r))        dates++
    if (paths.length && hasImage(r, paths)) images++
  }
  return { coords, dates, images }
}
