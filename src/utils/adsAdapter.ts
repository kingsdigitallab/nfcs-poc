/**
 * ADS Data Catalogue adapter — the only place that knows the shape of a
 * response from https://archaeologydataservice.ac.uk/data-catalogue-api/api/search
 * Maps it to UnifiedRecord[].
 */
import type { UnifiedRecord } from '../types/UnifiedRecord'

// ── Raw response types ────────────────────────────────────────────────────────

interface ADSLocalised  { text: string; language?: string }
interface ADSCreator    { name: string; [k: string]: unknown }
interface ADSGeopoint   { lat: number; lon: number }
interface ADSSpatial    { placeName?: string; geopoint?: ADSGeopoint; [k: string]: unknown }
interface ADSTemporal   { from?: string; until?: string; periodName?: string; [k: string]: unknown }
interface ADSSubject    { prefLabel: string; source?: string }
interface ADSCountry    { id?: string; name?: string }

interface ADSHitData {
  originalId?: string
  title?: ADSLocalised
  description?: ADSLocalised
  creator?: ADSCreator[]
  spatial?: ADSSpatial[]
  temporal?: ADSTemporal[]
  nativeSubject?: ADSSubject[]
  derivedSubject?: ADSSubject[]
  country?: ADSCountry[]
  issued?: string
  language?: string
  resourceType?: string
  [k: string]: unknown
}

export interface ADSHit {
  id: string
  data: ADSHitData
}

export interface ADSSearchResponse {
  total: { value: number; relation: string }
  hits: ADSHit[]
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export function adaptADSResponse(response: ADSSearchResponse): UnifiedRecord[] {
  return response.hits.map(hit => {
    const d = hit.data

    const creators = (d.creator ?? []).map(c => c.name).filter(Boolean)
    const subjects = [
      ...(d.nativeSubject ?? []).map(s => s.prefLabel),
      ...(d.derivedSubject ?? []).map(s => s.prefLabel),
    ].filter(Boolean)

    const firstSpatial = d.spatial?.[0]
    const lat  = firstSpatial?.geopoint?.lat ?? null
    const lon  = firstSpatial?.geopoint?.lon ?? null

    const originalId = d.originalId ?? hit.id

    return {
      id: `ads:${originalId}`,

      // Provenance
      _source:    'ads',
      _sourceId:  originalId,
      _sourceUrl: `https://archaeologydataservice.ac.uk/archsearch/record?titleId=${originalId}`,

      // Cross-service fields
      title:       d.title?.text,
      description: d.description?.text,
      creator:     creators.length === 1 ? creators[0] : creators.length > 1 ? creators : undefined,
      date:        d.issued,
      subject:     subjects.length === 1 ? subjects[0] : subjects.length > 1 ? subjects : undefined,
      language:    d.language,
      type:        d.resourceType,

      // Geo — uses same UnifiedRecord fields as GBIF so map layers work later
      decimalLatitude:  lat,
      decimalLongitude: lon,

      // ADS namespace — full fields for downstream processing
      ads: {
        id:          hit.id,
        temporal:    d.temporal ?? [],
        country:     d.country ?? [],
        allSpatial:  d.spatial ?? [],
        spatialCoverage: firstSpatial?.placeName,
      },
    } satisfies UnifiedRecord
  })
}
