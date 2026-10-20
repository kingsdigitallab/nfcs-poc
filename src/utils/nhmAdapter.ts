/**
 * NHM Data Portal adapter — the only place that knows the shape of a CKAN
 * `datastore_search` result from https://data.nhm.ac.uk. Maps the flat Darwin
 * Core specimen records to UnifiedRecord[].
 *
 * Namespace hygiene (docs/federation-baseline.md): the raw record is stored
 * wholesale under nhm.*; only genuinely cross-service fields are lifted to the
 * top level. Two derived keys are added to the namespace when the record has
 * media: nhm.thumbnail (JPEG) and nhm.iiifInfo (IIIF Image API 3 info.json).
 * There is no Presentation manifest, so nhm.manifest is deliberately absent.
 *
 * Payload facts (verified 2026-10-20, see docs/handoff-nhm-search-node.md):
 * all scalars are strings (coordinates, year, month, day included);
 * recordedBy is string[]; associatedMedia is an array of objects whose
 * `identifier` is https://data.nhm.ac.uk/media/{assetID}.
 */
import type { UnifiedRecord } from '../types/UnifiedRecord'

export const NHM_MEDIA_BASE = 'https://data.nhm.ac.uk/media/'
export const NHM_OBJECT_BASE = 'https://data.nhm.ac.uk/object/'

export interface NHMMedia {
  identifier?: string
  title?: string
  license?: string
  rightsHolder?: string
  [k: string]: unknown
}

export interface NHMRecord {
  _id?: number | string
  occurrenceID?: string
  scientificName?: string
  determinationFiledAs?: string | string[]
  catalogNumber?: string
  locality?: string
  habitat?: string
  recordedBy?: string | string[]
  year?: string
  month?: string
  day?: string
  collectionCode?: string
  subDepartment?: string
  family?: string
  country?: string
  decimalLatitude?: string | number
  decimalLongitude?: string | number
  associatedMedia?: NHMMedia[] | string
  associatedMediaCount?: string | number
  gbifID?: string
  [k: string]: unknown
}

export interface NHMDatastoreResult {
  total: number
  records: NHMRecord[]
  fields?: { id: string; type: string }[]
  facets?: Record<string, { values: Record<string, number> }>
  after?: unknown
}

/** CKAN action envelope. On failure `success` is false and `error` is set. */
export interface NHMDatastoreResponse {
  success: boolean
  result?: NHMDatastoreResult
  error?: { message?: unknown; __type?: string; [k: string]: unknown }
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/** Zero-padded `YYYY[-MM[-DD]]`, truncated at the first missing/non-numeric part. */
export function composeNHMDate(year?: unknown, month?: unknown, day?: unknown): string | undefined {
  const y = str(year)
  if (!/^\d{1,4}$/.test(y)) return undefined
  const m = str(month)
  if (!/^\d{1,2}$/.test(m)) return y
  const d = str(day)
  if (!/^\d{1,2}$/.test(d)) return `${y}-${m.padStart(2, '0')}`
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/** scientificName → determinationFiledAs → catalogNumber → "NHM specimen {_id}". */
export function nhmTitle(rec: NHMRecord): string {
  const filedAs = Array.isArray(rec.determinationFiledAs) ? rec.determinationFiledAs[0] : rec.determinationFiledAs
  return str(rec.scientificName) || str(filedAs) || str(rec.catalogNumber) || `NHM specimen ${rec._id ?? '(unknown)'}`
}

/** associatedMedia as an array — accepts the array, a JSON-encoded string, or nothing. */
export function nhmMediaList(rec: NHMRecord): NHMMedia[] {
  const raw = rec.associatedMedia
  if (Array.isArray(raw)) return raw.filter((m): m is NHMMedia => !!m && typeof m === 'object')
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as unknown
      return Array.isArray(parsed) ? parsed.filter((m): m is NHMMedia => !!m && typeof m === 'object') : []
    } catch { return [] }
  }
  return []
}

function toCoord(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = str(v)
  if (!s) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

export function adaptNHMResult(result: NHMDatastoreResult): UnifiedRecord[] {
  return (result.records ?? []).map(rec => {
    const occ = str(rec.occurrenceID)
    const media = nhmMediaList(rec)
    const firstMedia = str(media[0]?.identifier)
    const subject = [rec.collectionCode, rec.subDepartment, rec.family].map(str).filter(Boolean)
    const description = [rec.locality, rec.habitat].map(str).filter(Boolean).join('; ')
    const creator = Array.isArray(rec.recordedBy)
      ? (rec.recordedBy.length ? rec.recordedBy : undefined)
      : (str(rec.recordedBy) || undefined)

    return {
      id: occ ? `nhm:${occ}` : `nhm:${rec._id ?? 'unknown'}`,

      _source:    'nhm',
      _sourceId:  occ || undefined,
      _sourceUrl: occ ? `${NHM_OBJECT_BASE}${occ}` : undefined,
      _pid:       occ || undefined,   // CETAF stable identifier

      title:       nhmTitle(rec),
      description: description || undefined,
      creator,
      date:        composeNHMDate(rec.year, rec.month, rec.day),
      subject:     subject.length ? subject : undefined,
      country:     str(rec.country) || undefined,
      decimalLatitude:  toCoord(rec.decimalLatitude),
      decimalLongitude: toCoord(rec.decimalLongitude),

      nhm: {
        ...(rec as Record<string, unknown>),
        ...(firstMedia ? { thumbnail: `${firstMedia}/thumbnail`, iiifInfo: `${firstMedia}/info.json` } : {}),
      },
    } satisfies UnifiedRecord
  })
}
