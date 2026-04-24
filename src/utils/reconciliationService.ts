/**
 * reconciliationService.ts
 *
 * Wikidata Reconciliation Service API (W3C Reconciliation API v0.2).
 * https://wikidata.reconci.link/en/api
 *
 * The Wikidata reconciliation endpoint supports CORS, so browser fetch works
 * directly without a Vite proxy.  For other authorities (VIAF, GeoNames) only
 * the config stubs are defined here; the actual fetch is not implemented yet.
 *
 * Batch strategy: unique field values are collected across all records and sent
 * in a single POST request (queries=JSON).  Records are then augmented from a
 * lookup map — no per-record API calls.
 */

import type { UnifiedRecord } from '../types/UnifiedRecord'

// ─── authority types ──────────────────────────────────────────────────────────

export interface AuthorityConfig {
  label:      string
  value:      string
  /** Wikidata type constraint (Q-ID), null means no type filter */
  type:       string | null
  /** True while the backend is not yet implemented — rendered but unselectable */
  comingSoon?: boolean
}

// ─── field → authority mapping ────────────────────────────────────────────────

const PLACE_AUTHORITIES: AuthorityConfig[] = [
  { label: 'Wikidata Places', value: 'wikidata-place', type: 'Q618123' },
  { label: 'GeoNames',        value: 'geonames',       type: null,     comingSoon: true },
]

const TAXON_AUTHORITIES: AuthorityConfig[] = [
  { label: 'Wikidata Taxa', value: 'wikidata-taxon', type: 'Q16521' },
]

const ITEM_AUTHORITIES: AuthorityConfig[] = [
  { label: 'Wikidata Items', value: 'wikidata-item', type: null },
]

export const FIELD_AUTHORITY_MAP: Record<string, AuthorityConfig[]> = {
  creator: [
    { label: 'Wikidata People', value: 'wikidata-person', type: 'Q5'  },
    { label: 'VIAF',            value: 'viaf',            type: null, comingSoon: true },
  ],
  country:         PLACE_AUTHORITIES,
  spatialCoverage: PLACE_AUTHORITIES,
  scientificName:  TAXON_AUTHORITIES,
  species:         TAXON_AUTHORITIES,
  genus:           TAXON_AUTHORITIES,
  subject:         ITEM_AUTHORITIES,
  title:           ITEM_AUTHORITIES,
  institutionCode: [
    { label: 'Wikidata Orgs', value: 'wikidata-org', type: 'Q43229' },
  ],
  default: ITEM_AUTHORITIES,
}

export function authoritiesForField(fieldName: string): AuthorityConfig[] {
  return FIELD_AUTHORITY_MAP[fieldName] ?? FIELD_AUTHORITY_MAP.default
}

/**
 * Type guard: returns true when a record field value is a ReconciliationResult
 * (i.e. a `${fieldName}_reconciled` key written by ReconciliationNode).
 */
export function isReconciledValue(v: unknown): v is ReconciliationResult {
  return (
    typeof v === 'object' && v !== null &&
    'status' in v &&
    ((v as ReconciliationResult).status === 'resolved' ||
     (v as ReconciliationResult).status === 'review')
  )
}

// ─── output type ─────────────────────────────────────────────────────────────

export interface ReconciliationResult {
  qid:         string | null
  label:       string | null
  description: string | null
  /** Normalised 0–1 (Wikidata API returns 0–100) */
  confidence:  number
  status:      'resolved' | 'review'
  candidates:  { qid: string; label: string; score: number }[]
  authority:   string
}

// ─── field candidate helpers ──────────────────────────────────────────────────

/** Fields excluded from the reconciliation field selector */
const EXCLUDE_FIELDS = new Set([
  // provenance / metadata
  'id', '_source', '_sourceId', '_sourceUrl', '_pid', '_cached',
  '_capped', '_total', 'count', 'status', 'statusMessage',
  // numeric / coordinate fields
  'decimalLatitude', 'decimalLongitude',
])

// Namespace objects excluded from top-level fields but expanded when requested
const NAMESPACE_KEYS = new Set(['gbif', 'llds', 'ads', 'mds', 'adsLibrary'])

/**
 * Derive reconcilable field names from a sample record.
 * Excludes: known-metadata keys, numeric values, nested objects,
 * and previously-reconciled `*_reconciled` keys.
 */
export function candidateFields(
  records: Record<string, unknown> | Record<string, unknown>[],
  expandNamespaces = false,
): string[] {
  const sample = (Array.isArray(records) ? records : [records]).slice(0, 50)

  const top = new Set<string>()
  const nested = new Set<string>()

  for (const record of sample) {
    for (const k of Object.keys(record)) {
      if (EXCLUDE_FIELDS.has(k))     continue
      if (k.endsWith('_reconciled')) continue
      const v = record[k]
      if (v === null || v === undefined) continue
      if (typeof v === 'boolean')        continue

      if (NAMESPACE_KEYS.has(k)) {
        if (expandNamespaces && typeof v === 'object' && !Array.isArray(v)) {
          for (const [subk, subv] of Object.entries(v as Record<string, unknown>)) {
            if (subv == null) continue
            nested.add(`${k}.${subk}`)
          }
        }
        continue
      }

      if (typeof v === 'number')                         continue
      if (typeof v === 'object' && !Array.isArray(v))   continue
      top.add(k)
    }
  }

  return [...top, ...nested]
}

// ─── reconciliation API ───────────────────────────────────────────────────────

const RECONCILE_API = '/reconcile-proxy/en/api'
const TIMEOUT_MS    = 20_000
/** Maximum unique values sent per POST — avoids oversized request bodies. */
const MAX_BATCH     = 200

interface RawCandidate {
  id:           string
  name:         string
  description?: string
  score:        number
  match:        boolean
}

/**
 * Reconcile `fieldName` values across `records` against a Wikidata authority.
 *
 * @returns New array where every record gains a `${fieldName}_reconciled` key
 *          containing a ReconciliationResult (or null for missing field values).
 */
export async function reconcileField(
  records:             UnifiedRecord[],
  fieldName:           string,
  authorityConfig:     AuthorityConfig,
  confidenceThreshold: number,
): Promise<UnifiedRecord[]> {
  // Cast to loose type for dynamic field access
  const recs = records as unknown as Record<string, unknown>[]

  // Collect unique non-empty string values for the field
  const uniqueValues = [
    ...new Set(
      recs
        .map(r => r[fieldName])
        .filter((v): v is string => typeof v === 'string' && v.trim() !== ''),
    ),
  ]

  const batchValues = uniqueValues.slice(0, MAX_BATCH)
  if (batchValues.length < uniqueValues.length) {
    console.warn(`[Reconciliation] ${uniqueValues.length} unique values for "${fieldName}" — capped at ${MAX_BATCH}`)
  }

  if (batchValues.length === 0) {
    return records.map(r => ({
      ...r, [`${fieldName}_reconciled`]: null,
    } as unknown as UnifiedRecord))
  }

  // Build batch query object
  const queries = Object.fromEntries(
    batchValues.map((val, i) => [
      `q${i}`,
      {
        query: String(val),
        ...(authorityConfig.type && { type: authorityConfig.type }),
        limit: 3,
      },
    ]),
  )

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let data: Record<string, { result?: RawCandidate[] }>
  try {
    console.log(`[Reconciliation] POST ${RECONCILE_API}`, { field: fieldName, authority: authorityConfig.value, uniqueValues: batchValues.length })
    const res = await fetch(RECONCILE_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    `queries=${encodeURIComponent(JSON.stringify(queries))}`,
      signal:  controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
    data = await res.json() as typeof data
  } finally {
    clearTimeout(timer)
  }

  // Build lookup: field value → ReconciliationResult
  const resultMap = new Map<string, ReconciliationResult>()
  batchValues.forEach((val, i) => {
    const candidates = data[`q${i}`]?.result ?? []
    const top        = candidates[0]
    const confidence = top ? top.score / 100 : 0

    resultMap.set(val, {
      qid:         top?.id          ?? null,
      label:       top?.name        ?? null,
      description: top?.description ?? null,
      confidence,
      status:     confidence >= confidenceThreshold ? 'resolved' : 'review',
      candidates: candidates.slice(0, 3).map(c => ({
        qid:   c.id,
        label: c.name,
        score: c.score / 100,
      })),
      authority: authorityConfig.value,
    })
  })

  const key = `${fieldName}_reconciled`
  return recs.map(r => ({
    ...r,
    [key]: resultMap.get(r[fieldName] as string) ?? null,
  })) as unknown as UnifiedRecord[]
}
