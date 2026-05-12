const BASE     = 'https://api.gbif.org/v1'
const PAGE_SIZE = 300   // GBIF API maximum per request

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
  const res = await fetch(url)
  const ms = Math.round(performance.now() - t0)
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const json = await res.json()
  console.log(`[GBIF] response in ${ms}ms — count: ${(json as { count: number }).count}`, json)
  return json
}

export { PAGE_SIZE as GBIF_PAGE_SIZE }
