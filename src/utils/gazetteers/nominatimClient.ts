import type { GeoCandidate } from '../../types/UnifiedRecord'

const NOMINATIM_BASE = '/nominatim-proxy/search'
const TIMEOUT_MS     = 12_000

interface NominatimResult {
  lat:          string
  lon:          string
  name:         string
  display_name: string
  class:        string
  type:         string
  importance:   number
}

export async function queryNominatim(toponym: string): Promise<GeoCandidate[]> {
  const url = `${NOMINATIM_BASE}?q=${encodeURIComponent(toponym)}&format=json&limit=5&addressdetails=0`
  const res  = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal:  AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`)

  const results = await res.json() as NominatimResult[]
  return results
    .filter(r => r.lat && r.lon)
    .slice(0, 5)
    .map(r => {
      const parts = r.display_name.split(',').map((s: string) => s.trim())
      return {
        source:      'nominatim' as const,
        uri:         `https://www.openstreetmap.org/search?query=${encodeURIComponent(r.name || toponym)}`,
        label:       r.name || parts[0] || toponym,
        lat:         parseFloat(r.lat),
        lng:         parseFloat(r.lon),
        placeType:   r.type || r.class || undefined,
        parentLabel: parts.slice(1, 3).join(', ').trim() || undefined,
        score:       0,
      }
    })
}
