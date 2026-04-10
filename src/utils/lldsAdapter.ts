/**
 * LLDS adapter — the only place that knows the shape of a DSpace REST API
 * response from the Literary and Linguistic Data Service.
 *
 * Each item's metadata is an array of {key, value, language} objects using
 * Dublin Core qualifiers (dc.title, dc.contributor.author, etc.).
 */
import type { UnifiedRecord } from '../types/UnifiedRecord'
import type { DSpaceItem, DSpaceMetadata } from './lldsCache'

/** First matching value for a metadata key */
function metaOne(m: DSpaceMetadata[], key: string): string | undefined {
  return m.find(e => e.key === key)?.value
}

/** All values for a metadata key (for multi-valued fields like authors, subjects) */
function metaAll(m: DSpaceMetadata[], key: string): string[] {
  return m.filter(e => e.key === key).map(e => e.value)
}

export function adaptLLDSItem(item: DSpaceItem, cached: boolean): UnifiedRecord {
  const m = item.metadata ?? []
  const handle = item.handle ?? ''

  const creators = metaAll(m, 'dc.contributor.author')
  const subjects = metaAll(m, 'dc.subject')

  return {
    id: `llds:${handle || item.id}`,

    // Provenance
    _source: 'llds',
    _sourceId: item.id,
    _sourceUrl: `https://llds.ling-phil.ox.ac.uk/llds/xmlui/handle/${handle}`,
    _pid: handle ? `https://hdl.handle.net/${handle}` : undefined,
    _cached: cached || undefined,   // omit false to keep JSON clean

    // Cross-service fields
    title:       metaOne(m, 'dc.title'),
    description: metaOne(m, 'dc.description.abstract') ?? metaOne(m, 'dc.description'),
    creator:     creators.length === 1 ? creators[0] : creators.length > 1 ? creators : undefined,
    date:        metaOne(m, 'dc.date.issued'),
    subject:     subjects.length === 1 ? subjects[0] : subjects.length > 1 ? subjects : undefined,
    language:    metaOne(m, 'dc.language.iso'),
    type:        metaOne(m, 'dc.type'),
    format:      metaOne(m, 'dc.format'),

    // Full raw item under namespace
    llds: item as unknown as Record<string, unknown>,
  }
}

/** Client-side keyword filter — searches title, description, and subjects */
export function matchesQuery(record: UnifiedRecord, query: string): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase()
  const fields: (string | undefined)[] = [
    record.title,
    record.description,
    ...(Array.isArray(record.subject) ? record.subject : [record.subject]),
  ]
  return fields.some(f => f?.toLowerCase().includes(q))
}

/** Client-side language filter */
export function matchesLanguage(record: UnifiedRecord, lang: string): boolean {
  if (!lang) return true
  return record.language?.toLowerCase().startsWith(lang.toLowerCase()) ?? false
}
