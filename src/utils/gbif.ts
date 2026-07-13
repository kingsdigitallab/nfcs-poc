import { fetchWithTimeout } from './fetchWithTimeout'

// Routed through the same-origin proxy (server/proxies.mjs) so requests carry
// the descriptive User-Agent GBIF asks for and share a single client IP —
// both reduce the HTTP 429 rate-limiting seen on direct browser calls.
const BASE     = '/gbif-proxy/v1'
const PAGE_SIZE = 300   // GBIF API maximum per request

/** HTTP error that preserves the status code (and Retry-After when present) so
 *  the runner can branch on 429 and back off rather than failing outright. */
export class GBIFHttpError extends Error {
  status: number
  retryAfterMs?: number
  constructor(status: number, statusText: string, retryAfterMs?: number) {
    super(`HTTP ${status} ${statusText}`)
    this.name = 'GBIFHttpError'
    this.status = status
    this.retryAfterMs = retryAfterMs
  }
}

/** Parse a Retry-After header (delta-seconds or HTTP-date) into ms, if present. */
function parseRetryAfter(res: Response): number | undefined {
  const h = res.headers.get('retry-after')
  if (!h) return undefined
  const secs = Number(h)
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000)
  const date = Date.parse(h)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined
}

export interface GBIFParams {
  q?: string
  scientificName?: string
  country?: string
  year?: string
  limit?: string
  offset?: string
}

export function buildGBIFUrl(params: GBIFParams): string {
  const qs = new URLSearchParams()
  for (const [key, val] of Object.entries(params)) {
    if (val !== undefined && val.trim() !== '') {
      qs.set(key, val.trim())
    }
  }
  return `${BASE}/occurrence/search?${qs.toString()}`
}

export async function fetchGBIF(params: GBIFParams): Promise<unknown> {
  const url = buildGBIFUrl(params)
  console.log('[GBIF] GET', url)
  const t0 = performance.now()
  const res = await fetchWithTimeout(url)
  const ms = Math.round(performance.now() - t0)
  if (!res.ok) throw new GBIFHttpError(res.status, res.statusText, parseRetryAfter(res))
  const json = await res.json()
  console.log(`[GBIF] response in ${ms}ms — count: ${(json as { count: number }).count}`, json)
  return json
}

export { PAGE_SIZE as GBIF_PAGE_SIZE }
