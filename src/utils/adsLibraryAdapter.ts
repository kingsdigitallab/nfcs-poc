/**
 * adsLibraryAdapter.ts — maps ADSLibraryRawRecord[] → UnifiedRecord[]
 *
 * Field mapping:
 *   title       ← raw.title
 *   creator     ← raw.authors
 *   date        ← raw.publicationDate
 *   type        ← raw.publicationType
 *   _sourceUrl  ← raw.url
 *   _sourceId   ← raw.recordId
 *   adsLibrary.* ← all raw fields preserved
 */

import type { UnifiedRecord }       from '../types/UnifiedRecord'
import type { ADSLibraryRawRecord } from './adsLibrary'

export function adaptADSLibraryRecord(
  raw: ADSLibraryRawRecord,
  index: number,
): UnifiedRecord {
  const id = raw.recordId
    ? `adslib:${raw.recordId}`
    : `adslib:idx-${index}`

  return {
    id,
    _source:    'adsLibrary',
    _sourceId:  raw.recordId || undefined,
    _sourceUrl: raw.url      || undefined,
    title:      raw.title    || `ADS Library Record ${index + 1}`,
    creator:    raw.authors,
    date:       raw.publicationDate,
    type:       raw.publicationType,
    adsLibrary: {
      recordId:        raw.recordId,
      recordType:      raw.recordType,
      publicationType: raw.publicationType,
      parentTitle:     raw.parentTitle,
      publicationDate: raw.publicationDate,
      authors:         raw.authors,
      downloadUrl:     raw.downloadUrl,
    },
  }
}

export function adaptADSLibraryRecords(raws: ADSLibraryRawRecord[]): UnifiedRecord[] {
  return raws.map((r, i) => adaptADSLibraryRecord(r, i))
}
