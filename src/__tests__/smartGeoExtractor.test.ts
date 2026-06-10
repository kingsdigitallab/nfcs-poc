import { describe, it, expect } from 'vitest'
import { collectScanFields } from '../utils/smartGeoExtractor'

// ── collectScanFields ─────────────────────────────────────────────────────────

describe('collectScanFields — skipped fields', () => {
  it('skips system metadata fields (id, fetchedContent, fetchStatus, etc.)', () => {
    const fields = collectScanFields({
      id: 'r:1', fetchedContent: 'html', fetchStatus: 200, fetchedAt: '2024',
      title: 'Vase',
    })
    expect(fields).not.toContain('id')
    expect(fields).not.toContain('fetchedContent')
    expect(fields).not.toContain('fetchStatus')
    expect(fields).not.toContain('fetchedAt')
    expect(fields).toContain('title')
  })

  it('skips namespace blob keys (gbif, llds, ads, mds, etc.)', () => {
    const fields = collectScanFields({
      gbif: { key: 1 }, llds: { handle: 'x' }, ads: {}, mds: {}, title: 'Pot',
    })
    expect(fields).not.toContain('gbif')
    expect(fields).not.toContain('llds')
    expect(fields).not.toContain('ads')
    expect(fields).not.toContain('mds')
  })

  it('skips _ prefixed fields', () => {
    const fields = collectScanFields({ _source: 'gbif', _pid: '1', title: 'Vase' })
    expect(fields).not.toContain('_source')
    expect(fields).not.toContain('_pid')
  })

  it('skips fields matching skip-name pattern (_id, url, uri, thumbnail, image, date, version, status, count)', () => {
    const fields = collectScanFields({
      sourceId: 'x',
      thumbnailUrl: 'http://img',
      imageUrl: 'http://img',
      createdDate: '1900',
      recordVersion: '2',
      itemStatus: 'active',
      totalCount: 42,
      description: 'A vase',
    })
    expect(fields).not.toContain('sourceId')
    expect(fields).not.toContain('thumbnailUrl')
    expect(fields).not.toContain('imageUrl')
    expect(fields).not.toContain('createdDate')
    expect(fields).not.toContain('recordVersion')
    expect(fields).not.toContain('itemStatus')
    expect(fields).not.toContain('totalCount')
    expect(fields).toContain('description')
  })

  it('skips string values that are plain URLs', () => {
    const fields = collectScanFields({
      iiifManifest: 'https://example.com/manifest.json',
      title: 'Landscape',
    })
    expect(fields).not.toContain('iiifManifest')
    expect(fields).toContain('title')
  })

  it('skips null and undefined values', () => {
    const fields = collectScanFields({ title: 'Vase', description: null, creator: undefined })
    expect(fields).not.toContain('description')
    expect(fields).not.toContain('creator')
  })

  it('skips non-string non-array values (numbers, objects)', () => {
    const fields = collectScanFields({ year: 1850, nested: { a: 1 }, title: 'Pot' })
    expect(fields).not.toContain('year')
    expect(fields).not.toContain('nested')
    expect(fields).toContain('title')
  })
})

describe('collectScanFields — priority ordering', () => {
  it('places priority fields (title, description, subject, country, etc.) before others', () => {
    const fields = collectScanFields({
      randomExtra: 'some value',
      country: 'England',
      title: 'Roman Vase',
      description: 'Found near Bath',
    })
    const titleIdx   = fields.indexOf('title')
    const descIdx    = fields.indexOf('description')
    const countryIdx = fields.indexOf('country')
    const extraIdx   = fields.indexOf('randomExtra')

    expect(titleIdx).toBeGreaterThanOrEqual(0)
    expect(titleIdx).toBeLessThan(extraIdx)
    expect(descIdx).toBeLessThan(extraIdx)
    expect(countryIdx).toBeLessThan(extraIdx)
  })

  it('includes title, description, subject, spatialCoverage, country, collection, periodName, creator, type in priority list', () => {
    const fields = collectScanFields({
      title: 'T', description: 'D', subject: 'S', spatialCoverage: 'SC',
      country: 'C', collection: 'Col', periodName: 'Iron Age', creator: 'Smith', type: 'Pottery',
    })
    const priorityNames = ['title', 'description', 'subject', 'spatialCoverage', 'country', 'collection', 'periodName', 'creator', 'type']
    for (const name of priorityNames) {
      expect(fields).toContain(name)
    }
  })

  it('returns priority fields in canonical order regardless of object key order', () => {
    const fields = collectScanFields({ country: 'England', title: 'Vase' })
    expect(fields.indexOf('title')).toBeLessThan(fields.indexOf('country'))
  })
})

describe('collectScanFields — array fields', () => {
  it('includes array-valued string fields', () => {
    const fields = collectScanFields({ subject: ['Pottery', 'Roman'] })
    expect(fields).toContain('subject')
  })
})

describe('collectScanFields — empty input', () => {
  it('returns empty array for an empty record', () => {
    expect(collectScanFields({})).toEqual([])
  })
})
