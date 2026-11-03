/**
 * IIIF Image API helpers — the ONLY place that turns a service reference into
 * an image request.
 *
 * Some adapters write a bare Image API *service* rather than a finished image
 * URL: `vam.iiifImageBase` (`https://framemark.vam.ac.uk/collections/<id>/`,
 * trailing slash) and `nhm.iiifInfo` (`…/<media>/info.json`). Opened as-is
 * the V&A base 404s ("neither a file nor part of an image sequence"); the
 * value has to be completed with `/full/<size>/0/default.jpg`. Everything
 * that displays or ships an image field goes through `resolveImageSrc` so
 * that rule lives in one place (CLAUDE.md gotcha 30).
 */

/** Last path segment of a field path that names an Image API service. */
export const IIIF_SERVICE_KEYS = /^(iiifImageBase|iiifInfo|iiifService|imageService)$/i

/** Default display size — matches the viewer's zoom-1 tier. */
export const DEFAULT_IMAGE_SIZE = '!1200,1200'

/** Strips a trailing slash, `/info.json` or a `/full/…` request back to the service id. */
export function imageServiceBase(value: string): string {
  return value.trim().replace(/\/(info\.json|full\/.+)$/, '').replace(/\/+$/, '')
}

/** True when the field key or the value marks an Image API service rather than an image. */
export function isImageServiceRef(path: string, value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  if (/\/info\.json$/i.test(value.trim())) return true
  const key = path.split('.').at(-1) ?? ''
  return IIIF_SERVICE_KEYS.test(key)
}

/** `${base}/full/${size}/0/default.jpg` — accepts a base with or without the trailing slash. */
export function imageServiceUrl(base: string, size: string = DEFAULT_IMAGE_SIZE): string {
  return `${imageServiceBase(base)}/full/${size}/0/default.jpg`
}

/**
 * Displayable image source for a field value: service references become an
 * Image API request, finished http(s)/data URLs pass through, anything else
 * is null.
 */
export function resolveImageSrc(path: string, value: unknown, size: string = DEFAULT_IMAGE_SIZE): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  if (!v) return null
  if (isImageServiceRef(path, v)) return imageServiceUrl(v, size)
  if (/^(https?:\/\/|data:image\/)/i.test(v)) return v
  return null
}

/** Image API service base from a IIIF `service` property (string, object or array). */
export function extractServiceBase(service: unknown): string | null {
  if (!service) return null
  if (Array.isArray(service)) {
    for (const s of service) { const u = extractServiceBase(s); if (u) return u }
    return null
  }
  if (typeof service === 'string') return service.replace(/\/(info\.json|full\/.+)$/, '')
  if (typeof service === 'object') {
    const s = service as Record<string, unknown>
    const id = String(s.id || s['@id'] || '')
    return id ? id.replace(/\/(info\.json|full\/.+)$/, '') : null
  }
  return null
}

// Tiered size parameter — only fetch full resolution when zoomed far in.
// IIIF Image API spec: /full/!w,h/0/default.jpg constrains to fit within w×h.
export function iiifSizeParam(zoom: number): string {
  if (zoom <= 0.75) return '!600,600'
  if (zoom <= 1.5)  return DEFAULT_IMAGE_SIZE
  if (zoom <= 3)    return '!2400,2400'
  return 'max'
}

export function iiifSizeLabel(param: string): string {
  if (param === 'max') return 'Full resolution'
  const n = param.replace('!', '').split(',')[0]
  return `≤ ${n} px (constrained)`
}
