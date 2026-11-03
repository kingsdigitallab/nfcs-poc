/**
 * captureRecords — the shape of an Image View IIIF region capture and how
 * captures ACCUMULATE into a collection (draw → capture → next canvas or
 * record → draw → capture), so a curated set of crops with their provenance
 * can be sent on to the AI nodes as one record set.
 */
import type { RegionBox } from './imageFetch'

export interface CaptureMeta {
  nodeId:            string
  /** Capture batch stamp (Date.now()) — with regionIndex it makes `_id` unique across captures. */
  seq:               number
  regionIndex:       number
  region:            RegionBox
  regionLabel:       string
  canvasLabel:       string
  canvasIndex:       number
  canvasCount:       number
  /** The upstream record the manifest/service came from (undefined for a manual URL). */
  sourceRecord?:     Record<string, unknown>
  /** `Source · title` as the viewer shows it (or 'Manual URL'). */
  sourceLabel:       string
  manifestTitle?:    string
  manifestProvider?: string
}

/** Provenance copied from the upstream record onto a capture. */
const PROVENANCE_KEYS = ['id', 'title', 'creator', 'date', '_sourceUrl', '_citation', '_pid', '_sourceId'] as const

export function pickProvenance(record: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!record) return {}
  const out: Record<string, unknown> = {}
  for (const k of PROVENANCE_KEYS) if (record[k] !== undefined) out[k] = record[k]
  // The source namespace object (vam, smg, bodleian, …) travels too
  for (const [k, v] of Object.entries(record)) {
    if (!k.startsWith('_') && v != null && typeof v === 'object' && !Array.isArray(v)) out[k] = v
  }
  if (typeof record._source === 'string') out._origin = record._source
  if (typeof record.description === 'string') out.sourceDescription = record.description
  return out
}

/** One captured crop as a record the AI nodes can send (`content` data URL, `contentType: 'image'`). */
export function buildCaptureRecord(dataUrl: string, meta: CaptureMeta): Record<string, unknown> {
  const mimeType = /^data:(image\/[^;]+)/.exec(dataUrl)?.[1] ?? 'image/jpeg'
  const canvasPart = meta.canvasLabel ? `${meta.canvasLabel} (${meta.canvasIndex + 1}/${meta.canvasCount})` : `canvas ${meta.canvasIndex + 1}/${meta.canvasCount}`
  const src = meta.sourceRecord
  return {
    ...pickProvenance(src),
    content:      dataUrl,
    contentType:  'image',
    mimeType,
    title:        meta.regionLabel,
    // What AI Inference's vision-mode {{content}} renders — each crop carries its own context
    description:  `${meta.sourceLabel} · ${canvasPart} · ${meta.regionLabel}`,
    captureSource:      meta.sourceLabel.split(' · ')[0],
    captureRecordTitle: typeof src?.title === 'string' ? src.title : undefined,
    regionIndex:  meta.regionIndex,
    regionBounds: { ...meta.region },
    canvasIndex:  meta.canvasIndex,
    canvasLabel:  meta.canvasLabel,
    ...(meta.manifestTitle    !== undefined ? { manifestTitle:    meta.manifestTitle }    : {}),
    ...(meta.manifestProvider !== undefined ? { manifestProvider: meta.manifestProvider } : {}),
    capturedAt:   new Date(meta.seq).toISOString(),
    _source:      'imageView',
    _id:          `${meta.nodeId}_cap_${meta.seq}_${meta.regionIndex}`,
  }
}

export function isCaptureRecord(r: Record<string, unknown> | undefined): boolean {
  return !!r && r._source === 'imageView' && r.contentType === 'image'
    && typeof r.regionBounds === 'object' && r.regionBounds !== null
}

/** Existing captures (only — an Images-mode single record is dropped) followed by the new ones. */
export function appendCaptures(
  existing: Record<string, unknown>[] | undefined,
  added: Record<string, unknown>[],
): Record<string, unknown>[] {
  return [...(existing ?? []).filter(isCaptureRecord), ...added]
}
