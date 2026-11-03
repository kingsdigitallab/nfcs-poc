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
