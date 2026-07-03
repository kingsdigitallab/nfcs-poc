import { describe, it, expect } from 'vitest'
import { normaliseRecord, normaliseRecords } from '../utils/recordNormalise'

describe('normaliseRecord', () => {
  it('strips flat GBIF fields, preserving them under gbif.* when missing there', () => {
    const legacy = {
      id: 'gbif:1',
      _source: 'gbif',
      scientificName: 'Vulpes vulpes',
      kingdom: 'Animalia',
      gbif: { key: 1, scientificName: 'Vulpes vulpes' },  // kingdom missing in namespace
    }
    const out = normaliseRecord(legacy) as Record<string, unknown>
    expect('scientificName' in out).toBe(false)
    expect('kingdom' in out).toBe(false)
    const gbif = out.gbif as Record<string, unknown>
    expect(gbif.scientificName).toBe('Vulpes vulpes')
    expect(gbif.kingdom).toBe('Animalia')  // rescued from the flat copy
  })

  it('never overwrites an existing namespaced value with the flat copy', () => {
    const out = normaliseRecord({
      id: 'gbif:1', _source: 'gbif',
      scientificName: 'stale flat value',
      gbif: { scientificName: 'canonical value' },
    }) as Record<string, unknown>
    expect((out.gbif as Record<string, unknown>).scientificName).toBe('canonical value')
  })

  it('creates the gbif namespace for legacy GBIF records that lack one', () => {
    const out = normaliseRecord({
      id: 'gbif:1', _source: 'gbif', basisOfRecord: 'FossilSpecimen',
    }) as Record<string, unknown>
    expect((out.gbif as Record<string, unknown>).basisOfRecord).toBe('FossilSpecimen')
    expect('basisOfRecord' in out).toBe(false)
  })

  it('does not attach a gbif namespace to non-GBIF records with stale keys', () => {
    const out = normaliseRecord({
      id: 'x:1', _source: 'x', institutionCode: 'ABC',
    }) as Record<string, unknown>
    expect('gbif' in out).toBe(false)
    expect('institutionCode' in out).toBe(false)
  })

  it('removes _service and rescues top-level thumbnail into bodleian.*', () => {
    const out = normaliseRecord({
      id: 'bodleian:1', _source: 'bodleian',
      _service: 'bodleian',
      thumbnail: 'https://iiif.example/thumb.jpg',
      bodleian: { uuid: 'abc' },
    }) as Record<string, unknown>
    expect('_service' in out).toBe(false)
    expect('thumbnail' in out).toBe(false)
    expect((out.bodleian as Record<string, unknown>).thumbnail).toBe('https://iiif.example/thumb.jpg')
  })

  it('leaves period* and coordinates untouched', () => {
    const rec = {
      id: 'ariadne:1', _source: 'ariadne',
      periodStart: '-2500', periodEnd: '-1500', periodName: ['Bronze Age'],
      decimalLatitude: 51.1789, decimalLongitude: -1.8262,
    }
    const out = normaliseRecord(rec) as Record<string, unknown>
    expect(out.periodStart).toBe('-2500')
    expect(out.periodName).toEqual(['Bronze Age'])
    expect(out.decimalLatitude).toBe(51.1789)
  })

  it('is idempotent and returns the same object when nothing needs changing', () => {
    const clean = { id: 'gbif:1', _source: 'gbif', title: 'Vulpes vulpes', gbif: { key: 1 } }
    const once = normaliseRecord(clean)
    expect(once).toBe(clean)  // no copy when already conformant
    const legacy = { id: 'gbif:2', _source: 'gbif', kingdom: 'Animalia', gbif: {} }
    const first = normaliseRecord(legacy) as Record<string, unknown>
    const second = normaliseRecord(first as Record<string, unknown>)
    expect(second).toBe(first)
    expect(second).toEqual(first)
  })

  it('normaliseRecords maps arrays', () => {
    const out = normaliseRecords([
      { id: 'a', _source: 'gbif', species: 'X', gbif: {} },
      { id: 'b', _source: 'llds' },
    ]) as Record<string, unknown>[]
    expect('species' in out[0]).toBe(false)
    expect(out[1]).toEqual({ id: 'b', _source: 'llds' })
  })
})
