/**
 * LLDS adapter — the only place that knows the shape of a DSpace REST API
 * response from the Literary and Linguistic Data Service.
 *
 * Each item's metadata is an array of {key, value, language} objects using
 * Dublin Core qualifiers (dc.title, dc.contributor.author, dc.subject.lcsh, …).
 *
 * DSpace uses qualified DC throughout, so we need prefix matching for subject,
 * contributor and description to catch all variants:
 *   dc.subject        → dc.subject.lcsh, dc.subject.other, dc.subject.mesh, …
 *   dc.contributor    → dc.contributor.author, dc.contributor.editor, …
 *   dc.description    → dc.description.abstract, dc.description.provenance, …
 */
import type { UnifiedRecord } from '../types/UnifiedRecord'
import type { DSpaceItem, DSpaceMetadata } from './lldsCache'

// ─── metadata helpers ─────────────────────────────────────────────────────────

/** First value for an exact key match */
function metaOne(m: DSpaceMetadata[], key: string): string | undefined {
  return m.find(e => e.key === key)?.value
}

/** All values for an exact key match */
function metaAll(m: DSpaceMetadata[], key: string): string[] {
  return m.filter(e => e.key === key).map(e => e.value)
}

/**
 * All values whose key starts with `prefix` (handles DC qualifier variants).
 * e.g. metaPrefix(m, 'dc.subject') matches dc.subject, dc.subject.lcsh,
 * dc.subject.other, dc.subject.mesh, etc.
 */
function metaPrefix(m: DSpaceMetadata[], prefix: string): string[] {
  return m
    .filter(e => e.key === prefix || e.key.startsWith(prefix + '.'))
    .map(e => e.value)
}

// ─── adapter ─────────────────────────────────────────────────────────────────

export function adaptLLDSItem(item: DSpaceItem, cached: boolean): UnifiedRecord {
  const m = item.metadata ?? []
  const handle = item.handle ?? ''

  // dc.contributor.author is the primary author field; fall back to dc.contributor
  const creators = metaAll(m, 'dc.contributor.author').length
    ? metaAll(m, 'dc.contributor.author')
    : metaPrefix(m, 'dc.contributor')

  // Collect all subject variants: dc.subject, dc.subject.lcsh, dc.subject.other, …
  const subjects = metaPrefix(m, 'dc.subject')

  // Prefer dc.description.abstract; fall back to any dc.description.*
  const description =
    metaOne(m, 'dc.description.abstract') ??
    metaPrefix(m, 'dc.description').find(Boolean)

  return {
    id: `llds:${handle || item.id}`,

    // Provenance
    _source:    'llds',
    _sourceId:  item.id,
    _sourceUrl: `https://llds.ling-phil.ox.ac.uk/llds/xmlui/handle/${handle}`,
    _pid:       handle ? `https://hdl.handle.net/${handle}` : undefined,
    _cached:    cached || undefined,   // omit false to keep JSON clean

    // Cross-service fields
    title:       metaOne(m, 'dc.title') ?? (item.name as string | undefined),
    description,
    creator:     creators.length === 1 ? creators[0] : creators.length > 1 ? creators : undefined,
    date:        metaOne(m, 'dc.date.issued') ?? metaOne(m, 'dc.date.created'),
    subject:     subjects.length === 1 ? subjects[0] : subjects.length > 1 ? subjects : undefined,
    language:    metaOne(m, 'dc.language.iso') ?? metaOne(m, 'dc.language'),
    type:        metaOne(m, 'dc.type'),
    format:      metaOne(m, 'dc.format') ?? metaOne(m, 'dc.format.extent'),

    // Full raw item under namespace
    llds: item as unknown as Record<string, unknown>,
  }
}

// ─── client-side filters ──────────────────────────────────────────────────────

/**
 * Keyword filter — searches title, description, subject, and creator.
 * Returns true when any field contains the query string (case-insensitive).
 * An empty query matches everything.
 */
export function matchesQuery(record: UnifiedRecord, query: string): boolean {
  if (!query.trim()) return true
  const q = query.toLowerCase()

  const subjects  = Array.isArray(record.subject)  ? record.subject  : [record.subject]
  const creators  = Array.isArray(record.creator)  ? record.creator  : [record.creator]

  const fields: (string | undefined)[] = [
    record.title,
    record.description,
    ...subjects,
    ...creators,
  ]
  return fields.some(f => f?.toLowerCase().includes(q))
}

/** Language filter — matches if the record language starts with the given code */
export function matchesLanguage(record: UnifiedRecord, lang: string): boolean {
  if (!lang) return true
  return record.language?.toLowerCase().startsWith(lang.toLowerCase()) ?? false
}
