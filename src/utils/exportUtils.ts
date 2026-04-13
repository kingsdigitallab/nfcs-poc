/**
 * exportUtils.ts — CSV, JSON, and GeoJSON serialisers for UnifiedRecord arrays.
 *
 * Rules:
 *  - Namespace objects (gbif, llds, ads, mds) are excluded from flat exports
 *    (CSV, GeoJSON properties) because they contain raw service responses.
 *  - *_reconciled fields are flattened to four sub-columns:
 *    {field}_qid, {field}_label, {field}_confidence, {field}_status
 *  - Arrays (creator, subject) are joined with "; "
 *  - JSON export includes the full record graph verbatim.
 */

import type { UnifiedRecord } from '../types/UnifiedRecord'
import { isReconciledValue }  from './reconciliationService'

// ─── namespace keys excluded from flat exports ────────────────────────────────

const NAMESPACE_KEYS = new Set(['gbif', 'llds', 'ads', 'mds'])

// ─── helpers ──────────────────────────────────────────────────────────────────

function csvCell(val: unknown): string {
  if (val === null || val === undefined) return ''
  const s = Array.isArray(val) ? val.join('; ') : String(val)
  // Wrap in quotes if the value contains a comma, quote, or newline
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * Flatten a record to a plain string-keyed object suitable for CSV / GeoJSON
 * properties.  Reconciled values are expanded; namespace objects are dropped.
 */
export function flattenRecord(record: UnifiedRecord): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(record)) {
    if (NAMESPACE_KEYS.has(k)) continue
    if (v === null || v === undefined) continue
    if (isReconciledValue(v)) {
      out[`${k}_qid`]        = v.qid        ?? ''
      out[`${k}_label`]      = v.label      ?? ''
      out[`${k}_confidence`] = v.confidence
      out[`${k}_status`]     = v.status
    } else {
      out[k] = v
    }
  }
  return out
}

// ─── CSV ──────────────────────────────────────────────────────────────────────

export function toCSV(records: UnifiedRecord[]): string {
  if (records.length === 0) return ''
  const rows = records.map(flattenRecord)
  // Union of all keys across all rows
  const allKeys = [...new Set(rows.flatMap(r => Object.keys(r)))]
  const header = allKeys.map(csvCell).join(',')
  const body = rows.map(row =>
    allKeys.map(k => csvCell(row[k])).join(',')
  ).join('\n')
  return `${header}\n${body}`
}

// ─── JSON ─────────────────────────────────────────────────────────────────────

export function toJSON(records: UnifiedRecord[]): string {
  return JSON.stringify(records, null, 2)
}

// ─── GeoJSON ─────────────────────────────────────────────────────────────────

export function toGeoJSON(records: UnifiedRecord[]): string {
  const features = records
    .filter(r => r.decimalLatitude != null && r.decimalLongitude != null)
    .map(r => ({
      type:     'Feature' as const,
      geometry: {
        type:        'Point' as const,
        coordinates: [r.decimalLongitude as number, r.decimalLatitude as number],
      },
      properties: flattenRecord(r),
    }))
  return JSON.stringify({ type: 'FeatureCollection', features }, null, 2)
}

// ─── download trigger ─────────────────────────────────────────────────────────

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** ISO date string suitable for a filename, e.g. "2026-04-13" */
export function dateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}
