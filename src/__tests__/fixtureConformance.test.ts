import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Fixture conformance suite — treats every search fixture in public/fixtures/
 * as an empirical sample of what the adapters emit, and asserts it conforms
 * to the UnifiedRecord contract.
 *
 * Fixtures are loaded by the app via fetch('/fixtures/…') at runtime; tests
 * run under Node, so we read them from disk instead.
 *
 * ALLOWED_TOP_LEVEL must be kept in sync with src/types/UnifiedRecord.ts —
 * it is the runtime mirror of the interface (TS types are erased, so the
 * whitelist cannot be derived automatically).
 */

const FIXTURES_DIR = join(process.cwd(), 'public', 'fixtures')

/** Non-record JSON files that live alongside the fixtures. */
const SKIP_FILES = new Set(['manifest.json', 'collections-manifest.json'])

/** Mirror of the UnifiedRecord interface's top-level keys. */
const ALLOWED_TOP_LEVEL = new Set([
  'id',
  // provenance + citation
  '_citation', '_source', '_sourceId', '_sourceUrl', '_pid', '_cached', '_note',
  // cross-service normalised fields
  'title', 'description', 'creator', 'date', 'subject', 'language', 'type',
  'format', 'collection',
  // geography / temporal (cross-service)
  'spatialCoverage', 'country', 'periodStart', 'periodEnd', 'periodName',
  'decimalLatitude', 'decimalLongitude',
  // service namespaces
  'gbif', 'llds', 'ads', 'adsLibrary', 'mds', 'europeana', 'ariadne',
  'hsds', 'bodleian', 'smg', 'vam',
  // enrichment namespaces
  'geocoding', 'smartGeo', 'framesense',
])

/**
 * Legacy keys tolerated in committed fixtures until they are normalised on
 * load (task 6.4 normaliseRecord). The adapters no longer emit these after
 * task 3.2/3.2b:
 *  - 12 GBIF flat fields (dual-write removed — canonical home is gbif.*)
 *  - Bodleian's stray _service / thumbnail (canonical: _source / bodleian.thumbnail)
 */
const LEGACY_TOLERATED = new Set([
  'scientificName', 'kingdom', 'phylum', 'class', 'order', 'family', 'genus',
  'species', 'eventDate', 'basisOfRecord', 'institutionCode', 'datasetName',
  '_service', 'thumbnail',
])

function isAllowedKey(key: string): boolean {
  return ALLOWED_TOP_LEVEL.has(key) || LEGACY_TOLERATED.has(key) || key.endsWith('_reconciled')
}

function fixtureFiles(): string[] {
  return readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith('.json') && !SKIP_FILES.has(e.name))
    .map(e => e.name)
}

type AnyRecord = Record<string, unknown>

function loadRecords(file: string): AnyRecord[] | null {
  const parsed = JSON.parse(readFileSync(join(FIXTURES_DIR, file), 'utf8')) as unknown
  return Array.isArray(parsed) ? (parsed as AnyRecord[]) : null
}

describe('fixture conformance (public/fixtures/*.json)', () => {
  const files = fixtureFiles()

  it('finds fixture files to check', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it('every fixture is a JSON array of records', () => {
    const nonArrays = files.filter(f => loadRecords(f) === null)
    expect(nonArrays, `non-array fixture files: ${nonArrays.join(', ')}`).toEqual([])
  })

  it('every record has a string id and a _source', () => {
    const violations: string[] = []
    for (const file of files) {
      const records = loadRecords(file)
      if (!records) continue
      records.forEach((r, i) => {
        if (typeof r.id !== 'string' || r.id.length === 0) violations.push(`${file}[${i}]: bad id`)
        if (typeof r._source !== 'string' || r._source.length === 0) violations.push(`${file}[${i}]: missing _source`)
      })
    }
    expect(violations, violations.slice(0, 20).join('\n')).toEqual([])
  })

  it('_citation, when present, has service/serviceUrl/accessDate', () => {
    const violations: string[] = []
    for (const file of files) {
      const records = loadRecords(file)
      if (!records) continue
      records.forEach((r, i) => {
        if (r._citation === undefined) return
        const c = r._citation as AnyRecord | null
        if (c === null || typeof c !== 'object') { violations.push(`${file}[${i}]: _citation not an object`); return }
        for (const req of ['service', 'serviceUrl', 'accessDate']) {
          if (typeof c[req] !== 'string' || (c[req] as string).length === 0) {
            violations.push(`${file}[${i}]: _citation.${req} missing`)
          }
        }
      })
    }
    expect(violations, violations.slice(0, 20).join('\n')).toEqual([])
  })

  it('coordinates, when present, are number or null', () => {
    const violations: string[] = []
    for (const file of files) {
      const records = loadRecords(file)
      if (!records) continue
      records.forEach((r, i) => {
        for (const k of ['decimalLatitude', 'decimalLongitude']) {
          if (k in r && r[k] !== null && typeof r[k] !== 'number') {
            violations.push(`${file}[${i}]: ${k} is ${typeof r[k]}`)
          }
        }
      })
    }
    expect(violations, violations.slice(0, 20).join('\n')).toEqual([])
  })

  it('records carry no top-level keys outside the UnifiedRecord contract', () => {
    // Aggregate unknown keys per file for a readable failure message.
    const unknownByFile = new Map<string, Set<string>>()
    for (const file of files) {
      const records = loadRecords(file)
      if (!records) continue
      for (const r of records) {
        for (const key of Object.keys(r)) {
          if (!isAllowedKey(key)) {
            if (!unknownByFile.has(file)) unknownByFile.set(file, new Set())
            unknownByFile.get(file)!.add(key)
          }
        }
      }
    }
    const report = [...unknownByFile.entries()]
      .map(([f, ks]) => `${f}: ${[...ks].join(', ')}`)
      .join('\n')
    expect(unknownByFile.size, `unknown top-level keys found:\n${report}`).toBe(0)
  })
})
