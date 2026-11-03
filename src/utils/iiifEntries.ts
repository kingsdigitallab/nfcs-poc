/**
 * IIIF entry discovery for ImageViewNode's IIIF mode: one entry per upstream
 * record that offers either a Presentation manifest or a bare Image API
 * service (vam.iiifImageBase, nhm.iiifInfo). Pure so it can be unit-tested;
 * the node renders what this returns and navigates over it.
 */
import type { UnifiedRecord } from '../types/UnifiedRecord'
import { IIIF_SERVICE_KEYS, imageServiceBase, isImageServiceRef } from './iiifImage'

export interface IiifEntry {
  kind:        'manifest' | 'image'
  /** Manifest URL, or the Image API service base (no trailing slash). */
  url:         string
  /** Title / shelfmark / id, disambiguated with the accession number when titles repeat. */
  label:       string
  /** Display name of the record's `_source`. */
  source:      string
  recordIndex: number
  record:      UnifiedRecord
}

// Display names live in sourceIdentity.ts (one table for name + colour + shape);
// re-exported here so existing imports keep working.
import { sourceName } from './sourceIdentity'
export { SOURCE_NAMES, sourceName } from './sourceIdentity'

const MANIFEST_KEYS = ['manifest', 'manifestUrl', 'iiifManifest', 'iiif']
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const isObj = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v)

function findManifest(rec: Record<string, unknown>): string {
  // 1. Any namespace sub-object with a string `manifest` (bodleian, smg, vam, …)
  for (const v of Object.values(rec)) {
    if (isObj(v) && str(v.manifest)) return str(v.manifest)
  }
  // 2. Top-level field names
  for (const k of MANIFEST_KEYS) if (str(rec[k])) return str(rec[k])
  // 3. Any top-level string that looks like a manifest URL
  for (const v of Object.values(rec)) {
    const s = str(v)
    if (s.includes('/iiif/manifest/')) return s
  }
  return ''
}

function findImageService(rec: Record<string, unknown>): string {
  for (const [k, v] of Object.entries(rec)) {
    if (k.startsWith('_')) continue
    if (isObj(v)) {
      for (const [nk, nv] of Object.entries(v)) {
        if ((IIIF_SERVICE_KEYS.test(nk) || isImageServiceRef(nk, nv)) && str(nv)) return imageServiceBase(str(nv))
      }
    } else if (isImageServiceRef(k, v)) {
      return imageServiceBase(str(v))
    }
  }
  return ''
}

function baseLabel(rec: Record<string, unknown>, url: string): string {
  const ns = Object.values(rec).find(isObj)
  return str(rec.title) || str(ns?.shelfmark) || str(rec.id) || str(rec._id) || url.split('/').filter(Boolean).at(-1) || url
}

function accession(rec: Record<string, unknown>): string {
  for (const v of Object.values(rec)) {
    if (isObj(v) && str(v.accessionNumber)) return str(v.accessionNumber)
  }
  return str(rec._pid) || str(rec.id)
}

export function collectIiifEntries(records: UnifiedRecord[]): IiifEntry[] {
  const seen    = new Set<string>()
  const entries: IiifEntry[] = []

  records.forEach((record, recordIndex) => {
    const rec = record as Record<string, unknown>
    let kind: IiifEntry['kind'] = 'manifest'
    let url  = findManifest(rec)
    if (!url) { url = findImageService(rec); kind = 'image' }
    if (!url || seen.has(url)) return
    seen.add(url)
    entries.push({ kind, url, label: baseLabel(rec, url), source: sourceName(str(rec._source) || undefined), recordIndex, record })
  })

  // Repeated titles (19× "Stone Henge" in a V&A result set) get the accession number appended.
  const counts = new Map<string, number>()
  for (const e of entries) counts.set(e.label, (counts.get(e.label) ?? 0) + 1)
  for (const e of entries) {
    if ((counts.get(e.label) ?? 0) > 1) {
      const acc = accession(e.record as Record<string, unknown>)
      if (acc && acc !== e.label) e.label = `${e.label} (${acc})`
    }
  }
  return entries
}
