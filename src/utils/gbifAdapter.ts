/**
 * GBIF adapter — the only place that knows the shape of a GBIF occurrence
 * search response. Maps it to UnifiedRecord[].
 */
import type { UnifiedRecord } from '../types/UnifiedRecord'

interface GBIFOccurrence {
  key?: number
  scientificName?: string
  kingdom?: string
  phylum?: string
  class?: string
  order?: string
  family?: string
  genus?: string
  species?: string
  country?: string
  eventDate?: string
  decimalLatitude?: number
  decimalLongitude?: number
  basisOfRecord?: string
  institutionCode?: string
  datasetName?: string
  [key: string]: unknown
}

export interface GBIFSearchResponse {
  count: number
  offset: number
  limit: number
  endOfRecords: boolean
  results: GBIFOccurrence[]
}

/**
 * Every record must carry a display title — mixed-source tables, map popups
 * and timelines all lean on it. Many GBIF occurrences lack scientificName
 * (fossils, unidentified specimens), so fall through the taxonomy and then
 * to dataset/record identity rather than leaving the title blank.
 */
function gbifTitle(hit: GBIFOccurrence): string {
  return (
    hit.scientificName
    ?? hit.species
    ?? hit.genus
    ?? (hit.datasetName && hit.basisOfRecord ? `${hit.datasetName} (${hit.basisOfRecord})` : hit.datasetName)
    ?? (hit.basisOfRecord ? `${hit.basisOfRecord} occurrence` : undefined)
    ?? `GBIF occurrence ${hit.key ?? '(unknown)'}`
  )
}

export function adaptGBIFResponse(response: GBIFSearchResponse): UnifiedRecord[] {
  return response.results.map(hit => ({
    id: `gbif:${hit.key ?? Math.random()}`,

    // Provenance
    _source: 'gbif',
    _sourceId: hit.key,
    _sourceUrl: hit.key ? `https://www.gbif.org/occurrence/${hit.key}` : undefined,

    // Cross-service fields — makes GBIF records work in mixed-source tables
    title: gbifTitle(hit),
    date: hit.eventDate,

    country: hit.country,
    decimalLatitude: hit.decimalLatitude ?? null,
    decimalLongitude: hit.decimalLongitude ?? null,
    // Biodiversity-specific fields (scientificName, kingdom, …, datasetName)
    // live ONLY under the gbif.* namespace — the raw occurrence is stored
    // wholesale below. Read them as gbif.scientificName etc.

    // Full raw occurrence under namespace
    gbif: hit as Record<string, unknown>,
  }))
}
