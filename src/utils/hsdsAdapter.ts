/**
 * HSDS Data Catalogue adapter — the only place that knows the shape of a
 * response from https://hsds.ac.uk/data-catalogue-api/api/search
 * Maps it to UnifiedRecord[].
 *
 * The HSDS API uses the same ARIADNE-backbone schema as ADS, with these
 * differences: publisher/contributor are arrays of {name, agentIdentifier},
 * dataType is [{label, uri}], and landingPage is a top-level URL field.
 */
import type { UnifiedRecord } from '../types/UnifiedRecord'

// ── Raw response types ────────────────────────────────────────────────────────

interface HSDSLocalised  { text: string; language?: string }
interface HSDSAgent      { name: string; agentIdentifier?: string; homepage?: string; institution?: string }
interface HSDSGeopoint   { lat: number; lon: number }
interface HSDSSpatial    { placeName?: string; geopoint?: HSDSGeopoint; centroid?: HSDSGeopoint; boundingbox?: string; [k: string]: unknown }
interface HSDSTemporal   { from?: string; until?: string; periodName?: string; uri?: string }
interface HSDSSubject    { prefLabel: string; source?: string; id?: string; lang?: string; rdfAbout?: string }
interface HSDSCountry    { id?: string; name?: string }
interface HSDSDataType   { label: string; uri?: string }
interface HSDSHasType    { label: string; uri?: string }

interface HSDSHitData {
  originalId?:      string
  title?:           HSDSLocalised
  description?:     HSDSLocalised
  creator?:         HSDSAgent[]
  contributor?:     HSDSAgent[]
  publisher?:       HSDSAgent[]
  owner?:           HSDSAgent[]
  responsible?:     HSDSAgent[]
  spatial?:         HSDSSpatial[]
  temporal?:        HSDSTemporal[]
  nativePeriod?:    { periodName?: string }[]
  nativeSubject?:   HSDSSubject[]
  derivedSubject?:  HSDSSubject[]
  ariadneSubject?:  HSDSSubject[]
  country?:         HSDSCountry[]
  dataType?:        HSDSDataType[]
  has_type?:        HSDSHasType
  issued?:          string
  modified?:        string
  wasCreated?:      string
  language?:        string
  resourceType?:    string
  landingPage?:     string
  identifier?:      string
  isPartOf?:        string[]
  accessPolicy?:    string
  accessRights?:    string
  otherId?:         string[]
  [k: string]: unknown
}

export interface HSDSHit {
  id: string
  data: HSDSHitData
}

export interface HSDSSearchResponse {
  total: { value: number; relation: string }
  hits: HSDSHit[]
  aggregations?: unknown
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export function adaptHSDSResponse(response: HSDSSearchResponse): UnifiedRecord[] {
  return response.hits.map(hit => {
    const d = hit.data

    const creators = (d.creator ?? []).map(c => c.name).filter(Boolean)
    const contributors = (d.contributor ?? []).map(c => c.name).filter(Boolean)
    const publisherName = (d.publisher ?? [])[0]?.name

    const subjects = [
      ...(d.nativeSubject ?? []).map(s => s.prefLabel),
      ...(d.derivedSubject ?? []).map(s => s.prefLabel),
    ].filter(Boolean)

    // Spatial — prefer geopoint entries, collect all place names
    const spatialEntries = d.spatial ?? []
    const geoEntry = spatialEntries.find(s => s.geopoint)
    const lat = geoEntry?.geopoint?.lat ?? null
    const lon = geoEntry?.geopoint?.lon ?? null
    const allPlaceNames = spatialEntries
      .map(s => s.placeName)
      .filter((n): n is string => Boolean(n))

    // Country
    const countryNames = (d.country ?? [])
      .map(c => c.name)
      .filter((n): n is string => Boolean(n))

    // Temporal
    const temporals = d.temporal ?? []
    const firstTemporal = temporals[0]
    const allPeriodNames = temporals
      .map(t => t.periodName)
      .filter((n): n is string => Boolean(n))

    // Data types
    const dataTypeLabels = (d.dataType ?? []).map(dt => dt.label).filter(Boolean)

    const originalId = d.originalId ?? hit.id
    const resourceType = d.has_type?.label ?? d.resourceType

    return {
      id: `hsds:${originalId}`,

      // Provenance
      _source:    'hsds',
      _sourceId:  originalId,
      _sourceUrl: d.landingPage ?? `https://hsds.ac.uk/data-catalogue/resource/${hit.id}`,

      // Cross-service fields
      title:       d.title?.text,
      description: d.description?.text,
      creator:     creators.length === 1 ? creators[0] : creators.length > 1 ? creators : undefined,
      date:        d.issued ?? d.wasCreated,
      subject:     subjects.length === 1 ? subjects[0] : subjects.length > 1 ? subjects : undefined,
      language:    d.language,
      type:        resourceType,
      format:      dataTypeLabels.length === 1 ? dataTypeLabels[0] : dataTypeLabels.length > 1 ? dataTypeLabels : undefined,

      // Geography
      spatialCoverage:  allPlaceNames[0],
      country:          countryNames.length === 1 ? countryNames[0] : countryNames.length > 1 ? countryNames : undefined,
      decimalLatitude:  lat,
      decimalLongitude: lon,

      // Temporal
      periodStart: firstTemporal?.from,
      periodEnd:   firstTemporal?.until,
      periodName:  allPeriodNames.length === 1 ? allPeriodNames[0] : allPeriodNames.length > 1 ? allPeriodNames : undefined,

      // HSDS namespace
      hsds: {
        elasticId:      hit.id,
        originalId,
        landingPage:    d.landingPage,
        modified:       d.modified,
        contributor:    contributors,
        publisherName,
        allSpatial:     spatialEntries,
        allPlaceNames,
        temporal:       temporals,
        country:        d.country ?? [],
        nativeSubject:  d.nativeSubject ?? [],
        derivedSubject: d.derivedSubject ?? [],
        ariadneSubject: d.ariadneSubject ?? [],
        dataType:       dataTypeLabels,
        hasType:        d.has_type?.label,
        accessPolicy:   d.accessPolicy,
        accessRights:   d.accessRights,
        isPartOf:       d.isPartOf ?? [],
        otherId:        d.otherId ?? [],
      },
    } satisfies UnifiedRecord
  })
}
