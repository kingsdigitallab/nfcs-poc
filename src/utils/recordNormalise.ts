/**
 * Legacy-record normalisation — applied wherever previously serialised
 * UnifiedRecords re-enter the app (fixture loads, saved-search loads).
 *
 * Before refactor task 3.2 the GBIF adapter dual-wrote 12 biodiversity
 * fields both flat and under gbif.*, and the Bodleian adapter emitted
 * stray top-level _service / thumbnail keys. Live adapters no longer do
 * either, but committed fixtures and users' saved .nfcs.json files still
 * carry the old shape. Normalising on load means those files keep working
 * without rewriting them, and downstream nodes only ever see the
 * post-3.2 contract.
 *
 * Idempotent — safe to apply to already-normalised records.
 */
import type { UnifiedRecord } from '../types/UnifiedRecord'

/** Flat GBIF keys removed from UnifiedRecord in task 3.2 — canonical home is gbif.*. */
const STALE_GBIF_KEYS = [
  'scientificName', 'kingdom', 'phylum', 'class', 'order', 'family',
  'genus', 'species', 'eventDate', 'basisOfRecord', 'institutionCode',
  'datasetName',
] as const

/** Stray top-level keys the Bodleian adapter used to emit (task 3.2b). */
const STALE_MISC_KEYS = ['_service', 'thumbnail'] as const

type AnyRecord = Record<string, unknown>

export function normaliseRecord(rec: AnyRecord): UnifiedRecord {
  let out: AnyRecord | null = null
  const ensureOut = () => (out ??= { ...rec })

  for (const key of STALE_GBIF_KEYS) {
    if (!(key in rec)) continue
    const o = ensureOut()
    // Preserve the value under gbif.* if the namespace is missing it
    // (never overwrite — the namespaced copy is canonical).
    const gbif = (o.gbif ?? null) as AnyRecord | null
    if (gbif && typeof gbif === 'object' && !(key in gbif)) {
      o.gbif = { ...gbif, [key]: rec[key] }
    } else if (!gbif && rec._source === 'gbif') {
      o.gbif = { [key]: rec[key] }
    }
    delete o[key]
  }

  for (const key of STALE_MISC_KEYS) {
    if (!(key in rec)) continue
    const o = ensureOut()
    if (key === 'thumbnail') {
      const bodleian = (o.bodleian ?? null) as AnyRecord | null
      if (bodleian && typeof bodleian === 'object' && !('thumbnail' in bodleian)) {
        o.bodleian = { ...bodleian, thumbnail: rec.thumbnail }
      }
    }
    delete o[key]
  }

  // SMG stored records (fixtures, saved searches) carry a synthesised
  // smg.manifest for every object, but SMG's manifest is empty when the object
  // has no digitised media. The live adapter now omits it; drop it here so the
  // Image View's IIIF picker never offers a dead entry.
  if (rec._source === 'smg') {
    const smg = (rec.smg ?? null) as AnyRecord | null
    if (smg && typeof smg === 'object' && smg.manifest && !smg.thumbnail) {
      const o = ensureOut()
      const { manifest: _dropped, ...rest } = smg
      void _dropped
      o.smg = rest
    }
  }

  return (out ?? rec) as UnifiedRecord
}

export function normaliseRecords(records: AnyRecord[]): UnifiedRecord[] {
  return records.map(normaliseRecord)
}
