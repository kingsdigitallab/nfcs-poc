/**
 * lldsAdapter.ts — maps LLDSRawRecord (scraped HTML) → UnifiedRecord.
 */
import type { UnifiedRecord }  from '../types/UnifiedRecord'
import type { LLDSRawRecord }  from './llds'

export function adaptLLDSRecord(raw: LLDSRawRecord, index: number): UnifiedRecord {
  const creators = raw.authors

  return {
    id: `llds:${raw.handle || `idx-${index}`}`,

    _source:    'llds',
    _sourceId:  raw.handle || undefined,
    _sourceUrl: raw.url    || undefined,
    _pid:       raw.handle ? `https://hdl.handle.net/${raw.handle}` : undefined,

    title:       raw.title,
    description: raw.description,
    creator:     creators.length === 1
      ? creators[0]
      : creators.length > 1
        ? creators
        : undefined,
    date:        raw.date,
    type:        raw.itemType,

    llds: {
      handle:   raw.handle   || undefined,
      branding: raw.branding || undefined,
      itemType: raw.itemType || undefined,
    },
  }
}

export function adaptLLDSRecords(raws: LLDSRawRecord[]): UnifiedRecord[] {
  return raws.map((r, i) => adaptLLDSRecord(r, i))
}
