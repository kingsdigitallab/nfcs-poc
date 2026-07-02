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

export function adaptGBIFResponse(response: GBIFSearchResponse): UnifiedRecord[] {
  return response.results.map(hit => ({
    id: `gbif:${hit.key ?? Math.random()}`,

    // Provenance
    _source: 'gbif',
    _sourceId: hit.key,
    _sourceUrl: hit.key ? `https://www.gbif.org/occurrence/${hit.key}` : undefined,

    // Cross-service fields — makes GBIF records work in mixed-source tables
    title: hit.scientificName,
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
