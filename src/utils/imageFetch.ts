/**
 * imageFetch — the ONLY way the browser turns an image URL into bytes it can
 * read (a data URL for the vision model, EXIF, capture).
 *
 * Direct fetch first (V&A framemark, Europeana and Bodleian send CORS
 * headers); on any failure retry ONCE through /image-proxy, whose host
 * allowlist is fixed in server/urlProxyPolicy.mjs (SMG's coimages CDN sends
 * no CORS headers at all). Large images are downscaled client-side before
 * they are sent anywhere.
 */

export const IMAGE_MAX_DIM = 1280

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Downscale a data URL so its long edge is ≤ maxDim (re-encoded as JPEG q0.85); smaller images pass through. */
export function resizeDataUrl(dataUrl: string, maxDim: number = IMAGE_MAX_DIM): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const { naturalWidth: w, naturalHeight: h } = img
      if (w <= maxDim && h <= maxDim) { resolve(dataUrl); return }
      const scale  = maxDim / Math.max(w, h)
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(w * scale)
      canvas.height = Math.round(h * scale)
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('Image load failed for resize'))
    img.src = dataUrl
  })
}

export interface FetchImageOptions {
  /** Long-edge cap applied to the result; 0 disables resizing (also for tests, where Image never loads). */
  maxDim?:    number
  timeoutMs?: number
}

export async function fetchImageAsDataUrl(url: string, { maxDim = IMAGE_MAX_DIM, timeoutMs = 20_000 }: FetchImageOptions = {}): Promise<string> {
  const finish = (dataUrl: string) => (maxDim > 0 ? resizeDataUrl(dataUrl, maxDim) : Promise.resolve(dataUrl))
  if (url.startsWith('data:')) return finish(url)

  const attempt = async (target: string) => {
    const r = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) })
    if (!r.ok) {
      const detail = typeof r.text === 'function' ? await r.text().catch(() => '') : ''
      throw new Error(detail ? `HTTP ${r.status}: ${detail.slice(0, 200)}` : `HTTP ${r.status}`)
    }
    return blobToDataUrl(await r.blob())
  }

  try {
    return await finish(await attempt(url))
  } catch {
    return finish(await attempt(`/image-proxy?url=${encodeURIComponent(url)}`))
  }
}

// ── IIIF Image API regions ───────────────────────────────────────────────────

export interface RegionBox { x: number; y: number; w: number; h: number }   // 0–1 fractions of the canvas

export interface IiifRegionRequest {
  /** Fractional box; omitted = the whole image. */
  region?: RegionBox
  /** Constrained size tried first (IIIF `!w,h`). */
  size?:   string
  /** Long-edge cap applied client-side when the server only gave us `max`; 0 disables (tests). */
  maxDim?: number
}

export const DEFAULT_REGION_SIZE = '!1024,1024'

/** `pct:x,y,w,h` with one decimal, or `full`. */
export function iiifRegionParam(region?: RegionBox): string {
  if (!region) return 'full'
  const p = (v: number) => (v * 100).toFixed(1)
  return `pct:${p(region.x)},${p(region.y)},${p(region.w)},${p(region.h)}`
}

/**
 * Fetch one region of a IIIF Image API service as a data URL. The constrained
 * size is tried first; if the server refuses it (SMG's zoom.* CloudFront 403s
 * most explicit sizes but serves `max` — gotcha 33) the same region is fetched
 * at `max` and downscaled here. Throws naming both attempts.
 */
export async function fetchIiifRegion(
  serviceUrl: string,
  { region, size = DEFAULT_REGION_SIZE, maxDim = 1024 }: IiifRegionRequest = {},
): Promise<string> {
  const base = serviceUrl.replace(/\/+$/, '')
  const url  = (s: string) => `${base}/${iiifRegionParam(region)}/${s}/0/default.jpg`
  try {
    return await fetchImageAsDataUrl(url(size), { maxDim: 0 })
  } catch (sizedErr) {
    try {
      return await fetchImageAsDataUrl(url('max'), { maxDim })
    } catch (maxErr) {
      const m = (e: unknown) => (e instanceof Error ? e.message : String(e))
      throw new Error(`sized ${size} → ${m(sizedErr)}; max → ${m(maxErr)}`)
    }
  }
}
