import { describe, it, expect } from 'vitest'
import { flattenRecord, toCSV, toJSON, toGeoJSON } from '../utils/exportUtils'
import type { UnifiedRecord } from '../types/UnifiedRecord'

function rec(overrides: Partial<UnifiedRecord> = {}): UnifiedRecord {
  return { id: 'test:1', title: 'Test record', ...overrides }
}

describe('flattenRecord', () => {
  it('includes basic scalar fields', () => {
    const result = flattenRecord(rec({ title: 'My Title', date: '1900' }))
    expect(result.title).toBe('My Title')
    expect(result.date).toBe('1900')
  })

  it('drops namespace keys (gbif, llds, ads, mds)', () => {
    const result = flattenRecord(rec({
      gbif: { key: 123 },
      llds: { handle: 'abc' },
      ads:  { temporal: 'Iron Age' },
      mds:  { collection: 'X' },
    }))
    expect(result.gbif).toBeUndefined()
    expect(result.llds).toBeUndefined()
    expect(result.ads).toBeUndefined()
    expect(result.mds).toBeUndefined()
  })

  it('expands _reconciled values into four sub-columns', () => {
    const result = flattenRecord(rec({
      country_reconciled: {
        qid: 'Q21', label: 'England', confidence: 0.9,
        status: 'resolved', description: null, candidates: [], authority: 'wikidata-place',
      } as never,
    }))
    expect(result['country_reconciled_qid']).toBe('Q21')
    expect(result['country_reconciled_label']).toBe('England')
    expect(result['country_reconciled_confidence']).toBe(0.9)
    expect(result['country_reconciled_status']).toBe('resolved')
  })

  it('drops null / undefined fields', () => {
    const result = flattenRecord(rec({ description: undefined, language: undefined }))
    expect('description' in result).toBe(false)
    expect('language' in result).toBe(false)
  })

  it('preserves array values as-is (not joined here — csvCell joins them)', () => {
    const result = flattenRecord(rec({ subject: ['Pottery', 'Roman'] }))
    expect(result.subject).toEqual(['Pottery', 'Roman'])
  })
})

describe('toCSV', () => {
  it('returns empty string for empty records', () => {
    expect(toCSV([])).toBe('')
  })

  it('produces a header row and a data row', () => {
    const csv = toCSV([rec({ title: 'Alpha', date: '1800' })])
    const lines = csv.split('\n')
    expect(lines[0]).toContain('title')
    expect(lines[1]).toContain('Alpha')
  })

  it('covers all record keys across rows (union of columns)', () => {
    const records = [
      rec({ title: 'A', date: '1800' }),
      rec({ title: 'B', creator: 'Smith' }),
    ]
    const csv = toCSV(records)
    const header = csv.split('\n')[0]
    expect(header).toContain('title')
    expect(header).toContain('date')
    expect(header).toContain('creator')
  })

  it('wraps values containing commas in double quotes', () => {
    const csv = toCSV([rec({ title: 'Smith, John' })])
    expect(csv).toContain('"Smith, John"')
  })

  it('escapes embedded double quotes by doubling them', () => {
    const csv = toCSV([rec({ title: 'He said "hello"' })])
    expect(csv).toContain('""hello""')
  })

  it('joins array values with "; "', () => {
    const csv = toCSV([rec({ subject: ['Pottery', 'Roman'] as never })])
    expect(csv).toContain('Pottery; Roman')
  })
})

describe('toJSON', () => {
  it('serialises records verbatim', () => {
    const records = [rec({ title: 'A' }), rec({ id: 'test:2', title: 'B' })]
    const parsed = JSON.parse(toJSON(records)) as UnifiedRecord[]
    expect(parsed).toHaveLength(2)
    expect(parsed[0].title).toBe('A')
    expect(parsed[1].id).toBe('test:2')
  })

  it('includes namespace objects in JSON export', () => {
    const records = [rec({ gbif: { key: 42 } })]
    const parsed = JSON.parse(toJSON(records)) as UnifiedRecord[]
    expect((parsed[0].gbif as Record<string, unknown>)?.key).toBe(42)
  })
})

describe('toGeoJSON', () => {
  it('returns a FeatureCollection', () => {
    const gj = JSON.parse(toGeoJSON([])) as { type: string; features: unknown[] }
    expect(gj.type).toBe('FeatureCollection')
    expect(gj.features).toEqual([])
  })

  it('excludes records without coordinates', () => {
    const records = [rec({ title: 'No coords' })]
    const gj = JSON.parse(toGeoJSON(records)) as { features: unknown[] }
    expect(gj.features).toHaveLength(0)
  })

  it('includes records with coordinates as Point features', () => {
    const records = [rec({ decimalLatitude: 51.5, decimalLongitude: -0.12 })]
    const gj = JSON.parse(toGeoJSON(records)) as {
      features: Array<{ type: string; geometry: { type: string; coordinates: number[] } }>
    }
    expect(gj.features).toHaveLength(1)
    expect(gj.features[0].type).toBe('Feature')
    expect(gj.features[0].geometry.type).toBe('Point')
    // GeoJSON coordinates are [lng, lat]
    expect(gj.features[0].geometry.coordinates[0]).toBe(-0.12)
    expect(gj.features[0].geometry.coordinates[1]).toBe(51.5)
  })

  it('drops namespace keys from GeoJSON properties', () => {
    const records = [rec({ decimalLatitude: 51.5, decimalLongitude: -0.12, gbif: { key: 1 } })]
    const gj = JSON.parse(toGeoJSON(records)) as {
      features: Array<{ properties: Record<string, unknown> }>
    }
    expect(gj.features[0].properties.gbif).toBeUndefined()
  })
})
