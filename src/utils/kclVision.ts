/**
 * kclVision — the ONE builder of OpenAI-style multipart user content for the
 * KCL inference nodes (component AND runner paths of AI Inference, and the
 * image-input mode of AI Inference (by field)).
 *
 * An image value may be a data URL (local files, PDF pages, FrameSense,
 * Image View capture), a finished http(s) image URL (vam.thumbnail,
 * europeana.thumbnail, smg.thumbnail) or a bare IIIF Image API service
 * (vam.iiifImageBase, nhm.iiifInfo). resolveImageSrc normalises the last two
 * and fetchImageAsDataUrl turns http(s) into bytes (direct, then
 * /image-proxy), downscaled to IMAGE_MAX_DIM before they are sent.
 */
import { getFieldByPath } from './fieldPath'
import { resolveImageSrc, DEFAULT_IMAGE_SIZE } from './iiifImage'
import { fetchImageAsDataUrl, IMAGE_MAX_DIM } from './imageFetch'
import { sourceName } from './iiifEntries'

export type ImagePart   = { type: 'image_url'; image_url: { url: string; format: string } }
export type TextPart    = { type: 'text'; text: string }
export type ContentPart = TextPart | ImagePart

export const isImagePart = (p: unknown): p is ImagePart =>
  !!p && typeof p === 'object' && (p as { type?: string }).type === 'image_url'

export interface ImagePartOptions {
  /** IIIF size parameter used when the value is a bare Image API service. */
  size?:     string
  /** Long-edge cap applied before sending (0 = none). */
  maxDim?:   number
  /** Fallback mime type when the data URL carries none. */
  mimeType?: string
}

/** One image part for a field value, or null when the value is not an image. */
export async function imagePartFor(path: string, value: unknown, opts: ImagePartOptions = {}): Promise<ImagePart | null> {
  const src = resolveImageSrc(path, value, opts.size ?? DEFAULT_IMAGE_SIZE)
  if (!src) return null
  const url    = await fetchImageAsDataUrl(src, { maxDim: opts.maxDim ?? IMAGE_MAX_DIM })
  const format = /^data:(image\/[^;]+)/.exec(url)?.[1] ?? opts.mimeType ?? 'image/jpeg'
  return { type: 'image_url', image_url: { url, format } }
}

/**
 * User message content for one record: the plain prompt, or
 * [text, image] when an image is found.
 *   imageField set → that (dot-)path only.
 *   imageField ''  → auto: `content` when contentType === 'image' (data URL
 *                    or the http URL Image View now writes), else the first
 *                    top-level data:image value. Auto never fetches other
 *                    http URLs — pick the field explicitly for those.
 */
export async function buildUserContent(
  textPrompt: string,
  record: Record<string, unknown>,
  imageField: string,
  opts: ImagePartOptions = {},
): Promise<string | ContentPart[]> {
  const mimeType = typeof record.mimeType === 'string' ? record.mimeType : undefined
  let part: ImagePart | null = null
  if (imageField) {
    part = await imagePartFor(imageField, getFieldByPath(record, imageField), { mimeType, ...opts })
  } else if (record.contentType === 'image' && typeof record.content === 'string') {
    part = await imagePartFor('content', record.content, { mimeType, ...opts })
  } else {
    for (const [k, v] of Object.entries(record)) {
      if (typeof v === 'string' && v.startsWith('data:image/')) { part = await imagePartFor(k, v, { mimeType, ...opts }); break }
    }
  }
  if (!part) return textPrompt
  return [{ type: 'text', text: textPrompt }, part]
}

// ── Batches for AI Inference (by field) image input ──────────────────────────

export const recordLabel = (r: Record<string, unknown>): string => String(r.title || r.id || 'untitled')

export interface ImageBatch {
  parts:    ImagePart[]
  /** The records the parts came from, in order (one per part). */
  records:  Record<string, unknown>[]
  /** Records with a value at the path that could not be turned into an image, as "label: reason". */
  failures: string[]
  /** Records with a value at the path that were not attempted because of `max`. */
  skipped:  number
}

/**
 * Up to `max` image parts from the records that have a value at `path`,
 * fetched sequentially (the partner CDNs rate-limit bursts). A record whose
 * image cannot be fetched is reported, not thrown.
 */
export async function collectImageParts(
  records: Record<string, unknown>[],
  path: string,
  max: number,
  opts: ImagePartOptions = {},
): Promise<ImageBatch> {
  const withValue = records.filter(r => {
    const v = getFieldByPath(r, path)
    return typeof v === 'string' && v.trim().length > 0
  })
  const batch: ImageBatch = { parts: [], records: [], failures: [], skipped: Math.max(0, withValue.length - max) }
  for (const r of withValue.slice(0, max)) {
    try {
      const part = await imagePartFor(path, getFieldByPath(r, path), opts)
      if (!part) { batch.failures.push(`${recordLabel(r)}: not an image`); continue }
      batch.parts.push(part); batch.records.push(r)
    } catch (err) {
      batch.failures.push(`${recordLabel(r)}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return batch
}

/** "Images:\n1. title (Source)\n2. …" — lets the model refer to images by number. */
export function imageListText(records: Record<string, unknown>[]): string {
  return 'Images:\n' + records.map((r, i) => `${i + 1}. ${recordLabel(r)} (${sourceName(typeof r._source === 'string' ? r._source : undefined)})`).join('\n')
}

/**
 * Vision default for AI Inference: an explicit stored choice wins; otherwise
 * on when every upstream record is an image (Image View captures, local image
 * files) — the user never has to find the checkbox for the obvious case.
 */
export function defaultVisionMode(records: Record<string, unknown>[], stored: boolean | undefined): boolean {
  if (stored !== undefined) return stored
  return records.length > 0 && records.every(r => r.contentType === 'image')
}
