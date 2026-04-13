/**
 * ADS Data Catalogue adapter — the only place that knows the shape of a
 * response from https://archaeologydataservice.ac.uk/data-catalogue-api/api/search
 * Maps it to UnifiedRecord[].
 */
import type { UnifiedRecord } from '../types/UnifiedRecord'

// ── Raw response types ────────────────────────────────────────────────────────

interface ADSLocalised  { text: string; language?: string }
interface ADSCreator    { name: string; role?: string; identifier?: string; uri?: string; [k: string]: unknown }
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
  format?: string
  rights?: string
  license?: string
  publisher?: string
  identifier?: string
  relation?: string[]
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

    // Spatial — promote first entry's coordinates and place name
    const firstSpatial  = d.spatial?.[0]
    const lat  = firstSpatial?.geopoint?.lat ?? null
    const lon  = firstSpatial?.geopoint?.lon ?? null
    const allPlaceNames = (d.spatial ?? [])
      .map(s => s.placeName)
      .filter((n): n is string => Boolean(n))

    // Country names — promote as readable string(s)
    const countryNames = (d.country ?? [])
      .map(c => c.name)
      .filter((n): n is string => Boolean(n))

    // Temporal — promote first period's dates and collect all period names
    const temporals = d.temporal ?? []
    const firstTemporal = temporals[0]
    const allPeriodNames = temporals
      .map(t => t.periodName)
      .filter((n): n is string => Boolean(n))

    // Creator details beyond name — keep in namespace
    const creatorDetails = (d.creator ?? []).map(c => ({
      name:       c.name,
      role:       c.role,
      identifier: c.identifier,
      uri:        c.uri,
    }))

    const originalId = d.originalId ?? hit.id

    return {
      id: `ads:${originalId}`,

      // Provenance
      _source:    'ads',
      _sourceId:  originalId,
      _sourceUrl: `https://archaeologydataservice.ac.uk/data-catalogue/resource/${hit.id}`,

      // Cross-service fields
      title:       d.title?.text,
      description: d.description?.text,
      creator:     creators.length === 1 ? creators[0] : creators.length > 1 ? creators : undefined,
      date:        d.issued,
      subject:     subjects.length === 1 ? subjects[0] : subjects.length > 1 ? subjects : undefined,
      language:    d.language,
      type:        d.resourceType,
      format:      d.format,

      // Geography — top-level for reconciliation and map nodes
      spatialCoverage:  allPlaceNames.length === 1 ? allPlaceNames[0] : allPlaceNames.length > 1 ? allPlaceNames[0] : undefined,
      country:          countryNames.length === 1 ? countryNames[0] : countryNames.length > 1 ? countryNames : undefined,
      decimalLatitude:  lat,
      decimalLongitude: lon,

      // Temporal coverage — top-level for timeline node
      periodStart: firstTemporal?.from,
      periodEnd:   firstTemporal?.until,
      periodName:  allPeriodNames.length === 1 ? allPeriodNames[0] : allPeriodNames.length > 1 ? allPeriodNames : undefined,

      // ADS namespace — full raw fields for downstream processing
      ads: {
        elasticId:      hit.id,
        temporal:       temporals,
        country:        d.country ?? [],
        allSpatial:     d.spatial ?? [],
        allPlaceNames,
        creatorDetails,
        nativeSubject:  d.nativeSubject ?? [],
        derivedSubject: d.derivedSubject ?? [],
        rights:         d.rights,
        license:        d.license,
        publisher:      d.publisher,
        identifier:     d.identifier,
        relation:       d.relation ?? [],
        titleLanguage:  d.title?.language,
        descLanguage:   d.description?.language,
      },
    } satisfies UnifiedRecord
  })
}
