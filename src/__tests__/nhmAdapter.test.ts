import { describe, it, expect } from 'vitest'
import {
  adaptNHMResult, composeNHMDate, nhmTitle, nhmMediaList,
  type NHMRecord, type NHMDatastoreResult,
} from '../utils/nhmAdapter'

const wrap = (records: NHMRecord[]): NHMDatastoreResult => ({ total: records.length, records })

const BOT: NHMRecord = {
  _id: 1001, occurrenceID: 'aaaa-1111', institutionCode: 'NHMUK', collectionCode: 'BOT',
  basisOfRecord: 'PreservedSpecimen', scientificName: 'Plantago lanceolata L.',
  catalogNumber: 'BM001234', locality: 'Stonehenge, Wiltshire', habitat: 'Chalk downland',
  country: 'United Kingdom', decimalLatitude: '51.1789', decimalLongitude: '-1.8262',
  recordedBy: ['J. Smith', 'A. Jones'], year: '1882', month: '6', day: '18',
  subDepartment: 'Botany', family: 'Plantaginaceae', gbifID: '123456789',
  associatedMedia: [{ identifier: 'https://data.nhm.ac.uk/media/abc-123', license: 'http://creativecommons.org/licenses/by/4.0/', rightsHolder: 'The Trustees of the Natural History Museum, London' }],
  associatedMediaCount: '1',
}
const MIN: NHMRecord = {
  _id: 2002, occurrenceID: 'bbbb-2222', collectionCode: 'MIN', basisOfRecord: 'Occurrence',
  scientificName: 'Sarsen stone', subDepartment: 'Petrology', catalogNumber: 'BM.1920,123',
  locality: 'Stonehenge', year: '1920',
}
const MIN_NO_NAME: NHMRecord = {
  _id: 3003, occurrenceID: 'cccc-3333', collectionCode: 'MIN', basisOfRecord: 'Occurrence',
  scientificName: '', subDepartment: 'Petrology', catalogNumber: 'BM.1920,124',
}

describe('composeNHMDate', () => {
  it('composes year / year-month / year-month-day with zero padding', () => {
    expect(composeNHMDate('1882')).toBe('1882')
    expect(composeNHMDate('1882', '6')).toBe('1882-06')
    expect(composeNHMDate('1882', '6', '18')).toBe('1882-06-18')
    expect(composeNHMDate('1882', '11', '3')).toBe('1882-11-03')
  })
  it('returns undefined without a year, and stops at the first missing part', () => {
    expect(composeNHMDate(undefined, '6', '18')).toBeUndefined()
    expect(composeNHMDate('', '6')).toBeUndefined()
    expect(composeNHMDate('1882', '', '18')).toBe('1882')
    expect(composeNHMDate('1882', 'June')).toBe('1882')
  })
})

describe('nhmTitle fallback chain', () => {
  it('prefers scientificName (BOT and MIN rock names alike)', () => {
    expect(nhmTitle(BOT)).toBe('Plantago lanceolata L.')
    expect(nhmTitle(MIN)).toBe('Sarsen stone')
  })
  it('falls back to the filed-as determination name, then catalogNumber, then the _id', () => {
    // determinationFiledAs is a Yes/No flag parallel to determinationNames (verified in the
    // live payload) — the title must come from the name flagged "Yes", never from the flag.
    expect(nhmTitle({ ...MIN_NO_NAME, determinationNames: ['Spinax sp', 'Centroscymnus'], determinationFiledAs: ['No', 'Yes'] }))
      .toBe('Centroscymnus')
    expect(nhmTitle({ ...MIN_NO_NAME, determinationNames: ['Dolerite'], determinationFiledAs: ['Yes'] })).toBe('Dolerite')
    expect(nhmTitle({ ...MIN_NO_NAME, determinationNames: ['Dolerite', 'Spotted'] })).toBe('Dolerite')
    expect(nhmTitle({ ...MIN_NO_NAME, determinationNames: 'Dolerite' })).toBe('Dolerite')
    expect(nhmTitle({ ...MIN_NO_NAME, determinationFiledAs: ['Yes'] })).toBe('BM.1920,124')   // flag alone is NOT a title
    expect(nhmTitle(MIN_NO_NAME)).toBe('BM.1920,124')
    expect(nhmTitle({ _id: 7 })).toBe('NHM specimen 7')
  })
})

describe('nhmMediaList', () => {
  it('returns the array as-is, parses a JSON string, and tolerates garbage', () => {
    expect(nhmMediaList(BOT)).toHaveLength(1)
    const asString = { ...BOT, associatedMedia: JSON.stringify(BOT.associatedMedia) }
    expect(nhmMediaList(asString)[0].identifier).toBe('https://data.nhm.ac.uk/media/abc-123')
    expect(nhmMediaList({ ...BOT, associatedMedia: 'not json' })).toEqual([])
    expect(nhmMediaList({ ...BOT, associatedMedia: undefined })).toEqual([])
  })
})

describe('adaptNHMResult', () => {
  it('maps provenance: id, _source, _sourceId, _sourceUrl, _pid', () => {
    const [rec] = adaptNHMResult(wrap([BOT]))
    expect(rec.id).toBe('nhm:aaaa-1111')
    expect(rec._source).toBe('nhm')
    expect(rec._sourceId).toBe('aaaa-1111')
    expect(rec._sourceUrl).toBe('https://data.nhm.ac.uk/object/aaaa-1111')
    expect(rec._pid).toBe('aaaa-1111')
  })
  it('falls back to _id when occurrenceID is empty and leaves _pid/_sourceUrl undefined', () => {
    const [rec] = adaptNHMResult(wrap([{ ...BOT, occurrenceID: '' }]))
    expect(rec.id).toBe('nhm:1001')
    expect(rec._pid).toBeUndefined()
    expect(rec._sourceUrl).toBeUndefined()
    expect(rec._sourceId).toBeUndefined()
  })
  it('maps cross-service fields', () => {
    const [rec] = adaptNHMResult(wrap([BOT]))
    expect(rec.title).toBe('Plantago lanceolata L.')
    expect(rec.description).toBe('Stonehenge, Wiltshire; Chalk downland')
    expect(rec.creator).toEqual(['J. Smith', 'A. Jones'])
    expect(rec.date).toBe('1882-06-18')
    expect(rec.subject).toEqual(['BOT', 'Botany', 'Plantaginaceae'])
    expect(rec.country).toBe('United Kingdom')
  })
  it('parses coordinates: strings → numbers, "" → null, "0" → 0, junk → null', () => {
    const [a, b, c, d] = adaptNHMResult(wrap([
      BOT,
      { ...BOT, decimalLatitude: '', decimalLongitude: undefined },
      { ...BOT, decimalLatitude: '0', decimalLongitude: '0' },
      { ...BOT, decimalLatitude: 'n/a', decimalLongitude: 'x' },
    ]))
    expect(a.decimalLatitude).toBeCloseTo(51.1789)
    expect(a.decimalLongitude).toBeCloseTo(-1.8262)
    expect(b.decimalLatitude).toBeNull(); expect(b.decimalLongitude).toBeNull()
    expect(c.decimalLatitude).toBe(0);    expect(c.decimalLongitude).toBe(0)
    expect(d.decimalLatitude).toBeNull(); expect(d.decimalLongitude).toBeNull()
  })
  it('stores the raw record wholesale under nhm.* and writes NO flat domain fields', () => {
    const [rec] = adaptNHMResult(wrap([BOT]))
    const ns = rec.nhm as Record<string, unknown>
    expect(ns.scientificName).toBe('Plantago lanceolata L.')
    expect(ns.gbifID).toBe('123456789')
    expect(ns.family).toBe('Plantaginaceae')
    for (const flat of ['scientificName', 'family', 'gbifID', 'catalogNumber', 'basisOfRecord', 'collectionCode', 'locality', 'year'])
      expect(flat in rec, `flat ${flat} should not exist`).toBe(false)
  })
  it('derives nhm.thumbnail and nhm.iiifInfo from the first media item, absent when no media', () => {
    const [withMedia, without] = adaptNHMResult(wrap([BOT, MIN]))
    const ns = withMedia.nhm as Record<string, unknown>
    expect(ns.thumbnail).toBe('https://data.nhm.ac.uk/media/abc-123/thumbnail')
    expect(ns.iiifInfo).toBe('https://data.nhm.ac.uk/media/abc-123/info.json')
    const ns2 = without.nhm as Record<string, unknown>
    expect('thumbnail' in ns2).toBe(false)
    expect('iiifInfo' in ns2).toBe(false)
  })
  it('handles the mineralogy shapes: rock-name title, catalogue fallback, no gbifID, no coords', () => {
    const [min, noName] = adaptNHMResult(wrap([MIN, MIN_NO_NAME]))
    expect(min.title).toBe('Sarsen stone')
    expect(min.date).toBe('1920')
    expect(noName.title).toBe('BM.1920,124')
    expect((min.nhm as Record<string, unknown>).gbifID).toBeUndefined()
    expect(min.decimalLatitude).toBeNull()
    expect(min.description).toBe('Stonehenge')
    expect(noName.description).toBeUndefined()
  })
  it('never leaves title empty', () => {
    for (const r of adaptNHMResult(wrap([{}, { _id: 9 }, { catalogNumber: 'X' }])))
      expect((r.title as string).length).toBeGreaterThan(0)
  })
})
