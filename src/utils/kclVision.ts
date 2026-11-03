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
