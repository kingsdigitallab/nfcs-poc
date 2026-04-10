/**
 * mdsAdapter.ts — maps MDSRawRecord[] → UnifiedRecord[]
 *
 * Field mapping:
 *   title          ← "Title"
 *   description    ← "Brief description" | "Physical description"
 *   creator        ← "Object production person" + "Object production organisation"
 *   date           ← "Object production date" | "Date - earliest / single"
 *   subject        ← "Object name(s)" + "Object name" + "Content - concept" + "Associated concept"
 *   type           ← "Museum object" (fixed)
 *   _sourceId      ← "Object number" | uuid
 *   _sourceUrl     ← https://museumdata.uk/object/{uuid}
 *   id             ← "mds:{uuid}" | "mds:idx-{index}"
 *   mds.*          ← all remaining/extended fields
 */

import type { UnifiedRecord } from '../types/UnifiedRecord'
import type { MDSRawRecord }  from './mds'

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Return the first value found under any of the given field labels. */
function first(fields: Record<string, string[]>, ...labels: string[]): string | undefined {
  for (const label of labels) {
    if (fields[label]?.length) return fields[label][0]
  }
  return undefined
}

/** Concatenate values from multiple field labels into one flat array. */
function all(fields: Record<string, string[]>, ...labels: string[]): string[] {
  const out: string[] = []
  for (const label of labels) {
    if (fields[label]) out.push(...fields[label])
  }
  return out
}

/** Normalise an array-or-string result for UnifiedRecord (avoid wrapping single values). */
function toStrOrArr(
  values: string[],
): string | string[] | undefined {
  if (values.length === 0) return undefined
  if (values.length === 1) return values[0]
  return values
}

// ─── adapter ─────────────────────────────────────────────────────────────────

export function adaptMDSRecord(raw: MDSRawRecord, index: number): UnifiedRecord {
  const f = raw.fields

  const title       = first(f, 'Title') ?? `MDS Record ${index + 1}`
  const description = first(f, 'Brief description', 'Physical description')
  const creators    = all(f, 'Object production person', 'Object production organisation')
  const date        = first(f, 'Object production date', 'Date - earliest / single')
  const subjects    = all(f, 'Object name(s)', 'Object name', 'Content - concept', 'Associated concept')
  // Prefer the id-attribute value (always present); fall back to the field
  const objectNum   = raw.objectNumber || first(f, 'Object number')
  const collection  = first(f, 'Collection')
  const materials   = all(f, 'Material')
  const places      = all(f, 'Object production place', 'Content - place', 'Associated place')
  const dimensions  = all(f, 'Dimension', 'Dimension value')
  const persons     = all(f, "Person's association")

  const id = raw.uuid ? `mds:${raw.uuid}` : `mds:idx-${index}`

  return {
    id,
    _source:    'mds',
    _sourceId:  objectNum ?? raw.uuid ?? undefined,
    _sourceUrl: raw.url || undefined,
    title,
    description,
    creator: toStrOrArr(creators),
    date,
    subject: toStrOrArr(subjects),
    type:    'Museum object',
    mds: {
      uuid:             raw.uuid || undefined,
      objectNumber:     objectNum,
      collection,
      material:         materials.length ? materials : undefined,
      place:            places.length    ? places    : undefined,
      condition:        first(f, 'Condition'),
      dimensions:       dimensions.length ? dimensions : undefined,
      objectHistory:    first(f, 'Object history note'),
      numberOfObjects:  first(f, 'Number of objects'),
      inscriptionContent: first(f, 'Inscription content'),
      personAssociation: persons.length ? persons : undefined,
      licence:          raw.licence,
      // Retain the complete field map for downstream processing nodes
      allFields:        f,
    },
  }
}

export function adaptMDSRecords(raws: MDSRawRecord[]): UnifiedRecord[] {
  return raws.map((r, i) => adaptMDSRecord(r, i))
}
