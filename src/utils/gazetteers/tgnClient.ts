import type { GeoCandidate } from '../../types/UnifiedRecord'

const SERVLET   = '/getty-search-proxy/vow/TGNServlet'
const JSON_BASE = '/tgn-proxy/tgn'
const TIMEOUT_MS = 15_000

// ── Step 1: Scrape TGNServlet HTML ────────────────────────────────────────────

interface ServletHit {
  id:          string
  label:       string
  placeType:   string
  parentLabel: string
}

function parseServletHTML(html: string): ServletHit[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')

  // Results come directly after <input name="subjectid"> — use as a page sanity check
  if (!doc.querySelector('input[name="subjectid"]')) return []

  const checkboxes = Array.from(doc.querySelectorAll<HTMLInputElement>('input[name="checked"]'))
  if (checkboxes.length === 0) return []

  return checkboxes.slice(0, 3).flatMap(cb => {
    const id = cb.value
    if (!id) return []

    const row = cb.closest('tr')

    // Label is in the last <td> as a <b> element; place type follows in parens after dots
    const lastCell = row?.querySelector('td:last-child')
    const label     = lastCell?.querySelector('b')?.textContent?.trim() ?? ''
    const cellText  = lastCell?.textContent ?? ''
    const ptMatch   = cellText.match(/\.{2,}\s*\(([^)]+)\)/)
    const placeType = ptMatch?.[1]?.trim() ?? ''

    // Parent hierarchy is in the immediately following <tr>
    const nextRow    = row?.nextElementSibling
    const parentText = nextRow?.querySelector('span.page')?.textContent?.trim() ?? ''
    // Format: "(World, Europe, United Kingdom, England, Greater London, Hillingdon) [1005476]"
    const parentMatch  = parentText.match(/^\(([^)]+)\)/)
    const parts        = parentMatch?.[1]?.split(',').map(s => s.trim()) ?? []
    // Second-to-last segment is the immediate parent (last is the country/top-level)
    const parentLabel  = parts.length >= 2 ? parts[parts.length - 2] : (parts[0] ?? '')

    return [{ id, label, placeType, parentLabel }]
  })
}

// ── Step 2: Fetch Linked Art JSON by subject ID ───────────────────────────────
// TGN returns Linked Art JSON (not JSON-LD). Key paths:
//   Coordinates: first object anywhere in the tree with type "crm:E47_Spatial_Coordinates",
//                value is a GeoJSON string "[lng, lat]"
//   Label:       identified_by[] entry whose classified_as[] contains aat/300404670 (preferred term)

const PREFERRED_TERM = 'http://vocab.getty.edu/aat/300404670'

function findByType(obj: unknown, targetType: string): Record<string, unknown> | null {
  if (!obj || typeof obj !== 'object') return null
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const hit = findByType(item, targetType)
      if (hit) return hit
    }
    return null
  }
  const o = obj as Record<string, unknown>
  if (o['type'] === targetType) return o
  for (const v of Object.values(o)) {
    const hit = findByType(v, targetType)
    if (hit) return hit
  }
  return null
}

function extractCoords(json: Record<string, unknown>): { lat: number; lng: number } | null {
  const coordObj = findByType(json, 'crm:E47_Spatial_Coordinates')
  if (!coordObj || typeof coordObj['value'] !== 'string') return null
  try {
    const [lng, lat] = JSON.parse(coordObj['value']) as [number, number]
    if (isNaN(lat) || isNaN(lng)) return null
    return { lat, lng }
  } catch { return null }
}

function extractPreferredLabel(json: Record<string, unknown>): string | null {
  const identifiedBy = json['identified_by']
  if (!Array.isArray(identifiedBy)) return null
  for (const item of identifiedBy) {
    if (!item || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    const cas = entry['classified_as']
    if (!Array.isArray(cas)) continue
    const isPreferred = cas.some(
      c => c && typeof c === 'object' && (c as Record<string, unknown>)['id'] === PREFERRED_TERM,
    )
    if (isPreferred && typeof entry['content'] === 'string') return entry['content']
  }
  return null
}

async function fetchTGNJson(hit: ServletHit): Promise<GeoCandidate | null> {
  const res = await fetch(`${JSON_BASE}/${hit.id}.json`, {
    headers: { Accept: 'application/json' },
    signal:  AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) return null

  const json   = await res.json() as Record<string, unknown>
  const coords = extractCoords(json)
  if (!coords) return null

  const label = extractPreferredLabel(json) || hit.label

  return {
    source:      'tgn',
    uri:         `http://vocab.getty.edu/tgn/${hit.id}`,
    label,
    lat:         coords.lat,
    lng:         coords.lng,
    placeType:   hit.placeType  || undefined,
    parentLabel: hit.parentLabel || undefined,
    score:       0,
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function queryTGN(toponym: string, nation = 'United Kingdom'): Promise<GeoCandidate[]> {
  const url = `${SERVLET}?english=Y&find=${encodeURIComponent(toponym)}&place=&page=1&nation=${encodeURIComponent(nation)}`

  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`TGN servlet HTTP ${res.status}`)

  const hits = parseServletHTML(await res.text())
  if (hits.length === 0) return []   // clean not-found — no JSON fetches needed

  const settled = await Promise.allSettled(hits.map(fetchTGNJson))
  return settled
    .filter((r): r is PromiseFulfilledResult<GeoCandidate> => r.status === 'fulfilled' && r.value !== null)
    .map(r => r.value)
}
