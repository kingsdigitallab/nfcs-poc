import type { UnifiedRecord } from './UnifiedRecord'

export interface NfcsSavedSearchMeta {
  version: 1
  savedAt: string
  sources: string[]
  sourceCounts: Record<string, number>
  recordCount: number
  /** Keyed by "{nodeType}::{nodeId}" — upstream source node params, transient fields stripped */
  searchParams: Record<string, Record<string, unknown>>
}

export interface NfcsSavedSearch {
  _nfcs: NfcsSavedSearchMeta
  records: UnifiedRecord[]
}

export function isNfcsSavedSearch(v: unknown): v is NfcsSavedSearch {
  return (
    typeof v === 'object' &&
    v !== null &&
    '_nfcs' in v &&
    'records' in v &&
    Array.isArray((v as NfcsSavedSearch).records)
  )
}
