import { describe, it, expect } from 'vitest'
import { adaptGBIFResponse } from '../utils/gbifAdapter'
import type { GBIFSearchResponse } from '../utils/gbifAdapter'

const wrap = (results: GBIFSearchResponse['results']): GBIFSearchResponse => ({
  count: results.length,
  offset: 0,
  limit: 50,
  endOfRecords: true,
  results,
})

describe('adaptGBIFResponse', () => {
  it('writes no flat biodiversity fields — gbif.* is canonical', () => {
    const [rec] = adaptGBIFResponse(wrap([{
      key: 1, scientificName: 'Vulpes vulpes', kingdom: 'Animalia',
      basisOfRecord: 'HumanObservation', institutionCode: 'NHM',
    }]))
    expect(rec.title).toBe('Vulpes vulpes')
    expect((rec.gbif as Record<string, unknown>).scientificName).toBe('Vulpes vulpes')
    expect((rec.gbif as Record<string, unknown>).kingdom).toBe('Animalia')
    for (const flat of ['scientificName', 'kingdom', 'basisOfRecord', 'institutionCode', 'eventDate', 'datasetName']) {
      expect(flat in rec, `flat field ${flat} should not exist`).toBe(false)
    }
  })

  it('keeps coordinates top-level, null when absent', () => {
    const [withCoords, without] = adaptGBIFResponse(wrap([
      { key: 1, decimalLatitude: 51.5, decimalLongitude: -0.1 },
      { key: 2 },
    ]))
    expect(withCoords.decimalLatitude).toBe(51.5)
    expect(without.decimalLatitude).toBeNull()
    expect(without.decimalLongitude).toBeNull()
  })

  describe('title fallback chain', () => {
    it('prefers scientificName', () => {
      const [rec] = adaptGBIFResponse(wrap([{ key: 1, scientificName: 'Quercus robur', species: 'robur' }]))
      expect(rec.title).toBe('Quercus robur')
    })

    it('falls back to species, then genus', () => {
      const [bySpecies] = adaptGBIFResponse(wrap([{ key: 1, species: 'Homo sapiens' }]))
      expect(bySpecies.title).toBe('Homo sapiens')
      const [byGenus] = adaptGBIFResponse(wrap([{ key: 1, genus: 'Panthera' }]))
      expect(byGenus.title).toBe('Panthera')
    })

    it('falls back to datasetName with basisOfRecord', () => {
      const [rec] = adaptGBIFResponse(wrap([{ key: 1, datasetName: 'iNaturalist observations', basisOfRecord: 'HumanObservation' }]))
      expect(rec.title).toBe('iNaturalist observations (HumanObservation)')
    })

    it('falls back to basisOfRecord alone, then to the occurrence key', () => {
      const [byBasis] = adaptGBIFResponse(wrap([{ key: 1, basisOfRecord: 'FossilSpecimen' }]))
      expect(byBasis.title).toBe('FossilSpecimen occurrence')
      const [byKey] = adaptGBIFResponse(wrap([{ key: 42 }]))
      expect(byKey.title).toBe('GBIF occurrence 42')
    })

    it('never leaves title empty', () => {
      const records = adaptGBIFResponse(wrap([{}, { key: 9 }, { datasetName: 'X' }]))
      for (const r of records) {
        expect(typeof r.title).toBe('string')
        expect((r.title as string).length).toBeGreaterThan(0)
      }
    })
  })
})
