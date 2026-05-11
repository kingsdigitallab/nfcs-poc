import type { GeoCandidate } from '../../types/UnifiedRecord'

// Direct Wikidata REST API — no proxy needed; origin=* enables browser CORS.
// Consistent with existing wikidataApi.ts pattern in this codebase.
const WD_API    = 'https://www.wikidata.org/w/api.php'
const TIMEOUT_MS = 15_000

interface WDSearchResult { id: string; label?: string; description?: string }
interface WDSearchResponse { search: WDSearchResult[] }

interface WDClaimSnak {
  datavalue?: {
    type: string
    value: Record<string, unknown>
  }
}
interface WDClaim { mainsnak: WDClaimSnak }
interface WDEntity {
  labels?: Record<string, { value: string }>
  claims?: Record<string, WDClaim[]>
}
interface WDEntitiesResponse { entities: Record<string, WDEntity> }

function qs(params: Record<string, string>): string {
  return new URLSearchParams({ ...params, format: 'json', origin: '*' }).toString()
}

export async function queryWikidata(toponym: string): Promise<GeoCandidate[]> {
  // Step 1 — search for matching items by label
  const searchRes = await fetch(
    `${WD_API}?${qs({ action: 'wbsearchentities', search: toponym, language: 'en', limit: '5', type: 'item' })}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  )
  if (!searchRes.ok) throw new Error(`Wikidata search HTTP ${searchRes.status}`)
  const searchData = await searchRes.json() as WDSearchResponse
  const qids = searchData.search.map(r => r.id).filter(Boolean)
  if (qids.length === 0) return []

  // Step 2 — fetch entity details: P625 (coords), P17 (country), P1667 (TGN ID), P31 (instance of)
  const entityRes = await fetch(
    `${WD_API}?${qs({ action: 'wbgetentities', ids: qids.join('|'), props: 'claims|labels', languages: 'en' })}`,
    { signal: AbortSignal.timeout(TIMEOUT_MS) },
  )
  if (!entityRes.ok) throw new Error(`Wikidata entities HTTP ${entityRes.status}`)
  const entityData = await entityRes.json() as WDEntitiesResponse

  const candidates: GeoCandidate[] = []

  for (const qid of qids) {
    const entity = entityData.entities[qid]
    if (!entity) continue

    // Must have P625 (coordinate location) — otherwise not a geographic place
    const coordClaim = entity.claims?.P625?.[0]?.mainsnak?.datavalue
    if (!coordClaim || coordClaim.type !== 'globecoordinate') continue

    const coords = coordClaim.value as { latitude: number; longitude: number }
    const lat = coords.latitude
    const lng = coords.longitude
    if (isNaN(lat) || isNaN(lng)) continue

    const label = entity.labels?.en?.value ?? toponym

    // Extract TGN cross-reference (P1667) if present
    const tgnClaim = entity.claims?.P1667?.[0]?.mainsnak?.datavalue
    const tgnId    = tgnClaim?.type === 'string' ? String(tgnClaim.value) : undefined
    const tgnUri   = tgnId ? `http://vocab.getty.edu/tgn/${tgnId}` : undefined

    // Extract place type hint from P31 (instance of) — first label only
    const instClaim = entity.claims?.P31?.[0]?.mainsnak?.datavalue
    const placeType = instClaim?.type === 'wikibase-entityid'
      ? `Q${(instClaim.value as { 'numeric-id': number })['numeric-id']}`
      : undefined

    candidates.push({
      source:    'wikidata',
      uri:       `https://www.wikidata.org/entity/${qid}`,
      label,
      lat,
      lng,
      placeType,
      tgnUri,
      score: 0,
    })
  }

  return candidates
}
