/**
 * captureRecords — the shape of an Image View IIIF region capture and how
 * captures ACCUMULATE into a collection (draw → capture → next canvas or
 * record → draw → capture), so a curated set of crops with their provenance
 * can be sent on to the AI nodes as one record set.
 */
import type { RegionBox } from './imageFetch'
import type { IiifEntry } from './iiifEntries'

export type CaptureEntryKind = 'manifest' | 'image' | 'manual'

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
  /** What was loaded at capture time (`loadedUrl`): manifest URL or Image API service base. */
  entryUrl:          string
  entryKind:         CaptureEntryKind
  /** The canvas the region was drawn on: `serviceUrl || directUrl`. */
  canvasKey:         string
  /** Small data URL (≈160 px) for gallery tiles and Output cards. */
  thumbDataUrl?:     string
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
    // Navigation keys: the gallery uses them to return to the source canvas
    captureEntryUrl:  meta.entryUrl,
    captureEntryKind: meta.entryKind,
    captureCanvasKey: meta.canvasKey,
    // Underscore on purpose: collectFieldPaths / collectImageFieldCandidates skip
    // `_` keys, so the thumb never shows up as a second image field (gotcha 34).
    ...(meta.thumbDataUrl ? { _captureThumb: meta.thumbDataUrl } : {}),
    capturedAt:   new Date(meta.seq).toISOString(),
    _source:      'imageView',
    _id:          `${meta.nodeId}_cap_${meta.seq}_${meta.regionIndex}`,
  }
}

export interface CaptureTarget {
  /** The upstream entry with this url, when it is still connected. */
  entry?:      IiifEntry
  url:         string
  kind:        CaptureEntryKind
  canvasIndex: number
  canvasKey:   string
  region:      RegionBox
}

/** Where a capture came from, resolved against the current upstream entries; null for a legacy capture. */
export function resolveCaptureTarget(capture: Record<string, unknown>, entries: IiifEntry[]): CaptureTarget | null {
  const url    = capture.captureEntryUrl
  const region = capture.regionBounds as RegionBox | undefined
  if (typeof url !== 'string' || !url || !region || typeof region !== 'object') return null
  const entry = entries.find(e => e.url === url)
  const storedKind = capture.captureEntryKind
  const kind: CaptureEntryKind = entry ? entry.kind
    : (storedKind === 'image' || storedKind === 'manual' ? storedKind : 'manifest')
  return {
    entry, url, kind,
    canvasIndex: typeof capture.canvasIndex === 'number' ? capture.canvasIndex : 0,
    canvasKey:   typeof capture.captureCanvasKey === 'string' ? capture.captureCanvasKey : '',
    region:      { x: region.x, y: region.y, w: region.w, h: region.h },
  }
}

/** The collection without the capture whose `_id` matches (order kept; unknown id is a no-op). */
export function removeCapture(existing: Record<string, unknown>[] | undefined, id: string): Record<string, unknown>[] {
  return (existing ?? []).filter(r => r._id !== id)
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
