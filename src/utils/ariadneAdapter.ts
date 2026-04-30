/**
 * ARIADNE portal adapter — maps https://portal.ariadne-infrastructure.eu/api/search
 * responses to UnifiedRecord[]. Response shape is nearly identical to the ADS
 * data-catalogue-api, so field mappings mirror adsAdapter.ts closely.
 */
import type { UnifiedRecord } from '../types/UnifiedRecord'

interface ARIADNELocalised  { text: string; language?: string }
interface ARIADNEAgent      { name: string; homepage?: string; institution?: string; agentIdentifier?: string; email?: string }
interface ARIADNEGeopoint   { lat: number; lon: number }
interface ARIADNESpatial    { placeName?: string; geopoint?: ARIADNEGeopoint; centroid?: ARIADNEGeopoint; [k: string]: unknown }
interface ARIADNETemporal   { from?: string; until?: string; periodName?: string; uri?: string }
interface ARIADNESubject    { prefLabel: string; source?: string; id?: string; lang?: string; rdfAbout?: string }
interface ARIADNECountry    { id?: string; name?: string }
interface ARIADNEDataType   { label?: string; uri?: string }

interface ARIADNEHitData {
  title?:          ARIADNELocalised
  description?:    ARIADNELocalised
  creator?:        ARIADNEAgent[]
  contributor?:    ARIADNEAgent[]
  publisher?:      ARIADNEAgent[]
  owner?:          ARIADNEAgent[]
  responsible?:    ARIADNEAgent[]
  spatial?:        ARIADNESpatial[]
  temporal?:       ARIADNETemporal[]
  nativePeriod?:   { periodName?: string }[]
  nativeSubject?:  ARIADNESubject[]
  derivedSubject?: ARIADNESubject[]
  ariadneSubject?: { prefLabel: string }[]
  country?:        ARIADNECountry[]
  dataType?:       ARIADNEDataType[]
  issued?:         string
  modified?:       string
  language?:       string
  resourceType?:   string
  originalId?:     string
  identifier?:     string
  accessPolicy?:   string
  accessRights?:   string
  isPartOf?:       string[]
  otherId?:        string[]
  [k: string]:     unknown
}

export interface ARIADNEHit {
  id:   string
  data: ARIADNEHitData
}

export interface ARIADNESearchResponse {
  total:         { value: number; relation: string }
  hits:          ARIADNEHit[]
  aggregations?: unknown
}

export function adaptARIADNEResponse(response: ARIADNESearchResponse): UnifiedRecord[] {
  return response.hits.map(hit => {
    const d = hit.data

    const creators = (d.creator ?? []).map(c => c.name).filter(Boolean)
    const subjects = [
      ...(d.nativeSubject  ?? []).map(s => s.prefLabel),
      ...(d.derivedSubject ?? []).map(s => s.prefLabel),
    ].filter(Boolean)

    const firstSpatial   = d.spatial?.[0]
    const lat            = firstSpatial?.geopoint?.lat  ?? firstSpatial?.centroid?.lat  ?? null
    const lon            = firstSpatial?.geopoint?.lon  ?? firstSpatial?.centroid?.lon  ?? null
    const allPlaceNames  = (d.spatial ?? []).map(s => s.placeName).filter((n): n is string => Boolean(n))

    const countryNames   = (d.country ?? []).map(c => c.name).filter((n): n is string => Boolean(n))

    const temporals      = d.temporal ?? []
    const firstTemporal  = temporals[0]
    const allPeriodNames = temporals.map(t => t.periodName).filter((n): n is string => Boolean(n))

    const publisherNames    = (d.publisher    ?? []).map(p => p.name).filter(Boolean)
    const contributorNames  = (d.contributor  ?? []).map(c => c.name).filter(Boolean)

    const originalId = d.originalId ?? hit.id

    return {
      id: `ariadne:${hit.id}`,

      _source:    'ariadne',
      _sourceId:  originalId,
      _sourceUrl: `https://portal.ariadne-infrastructure.eu/resource/${hit.id}`,

      title:       d.title?.text,
      description: d.description?.text,
      creator:     creators.length === 1 ? creators[0] : creators.length > 1 ? creators : undefined,
      date:        d.issued,
      subject:     subjects.length === 1 ? subjects[0] : subjects.length > 1 ? subjects : undefined,
      language:    d.language,
      type:        d.resourceType,

      spatialCoverage:  allPlaceNames[0],
      country:          countryNames.length === 1 ? countryNames[0] : countryNames.length > 1 ? countryNames : undefined,
      decimalLatitude:  lat,
      decimalLongitude: lon,

      periodStart: firstTemporal?.from,
      periodEnd:   firstTemporal?.until,
      periodName:  allPeriodNames.length === 1 ? allPeriodNames[0] : allPeriodNames.length > 1 ? allPeriodNames : undefined,

      ariadne: {
        elasticId:      hit.id,
        temporal:       temporals,
        country:        d.country ?? [],
        allSpatial:     d.spatial ?? [],
        allPlaceNames,
        creatorDetails: (d.creator ?? []).map(c => ({ name: c.name, agentIdentifier: c.agentIdentifier })),
        nativeSubject:  d.nativeSubject  ?? [],
        derivedSubject: d.derivedSubject ?? [],
        ariadneSubject: d.ariadneSubject ?? [],
        publisher:      publisherNames.length === 1 ? publisherNames[0] : publisherNames.length > 1 ? publisherNames : undefined,
        contributor:    contributorNames.length === 1 ? contributorNames[0] : contributorNames.length > 1 ? contributorNames : undefined,
        dataType:       (d.dataType ?? []).map(dt => dt.label).filter(Boolean),
        identifier:     d.identifier,
        otherId:        d.otherId     ?? [],
        isPartOf:       d.isPartOf    ?? [],
        accessRights:   d.accessRights,
        nativePeriod:   (d.nativePeriod ?? []).map(p => p.periodName).filter(Boolean),
      },
    } satisfies UnifiedRecord
  })
}
