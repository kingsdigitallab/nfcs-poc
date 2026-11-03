import { describe, it, expect } from 'vitest'
import { collectIiifEntries, sourceName } from '../utils/iiifEntries'
import type { UnifiedRecord } from '../types/UnifiedRecord'

const R = (o: Record<string, unknown>) => o as unknown as UnifiedRecord

const vamFull = R({
  id: 'vam:O1', _source: 'vam', title: 'Stone Henge', _sourceUrl: 'https://collections.vam.ac.uk/item/O1',
  vam: { accessionNumber: '800-1888', manifest: 'https://iiif.vam.ac.uk/collections/O1/manifest.json', iiifImageBase: 'https://framemark.vam.ac.uk/collections/2013GE8498/' },
})
const vamBaseOnly = R({
  id: 'vam:O2', _source: 'vam', title: 'Stone Henge',
  vam: { accessionNumber: 'E.1-1900', iiifImageBase: 'https://framemark.vam.ac.uk/collections/2016JG8103/' },
})
const vamNothing = R({ id: 'vam:O3', _source: 'vam', title: 'Teapot', vam: { accessionNumber: 'M.1' } })
const smgNoMedia = R({ id: 'smg:co53933', _source: 'smg', title: 'Seismoscope', smg: { accessionNumber: '1910-121' } })
const smgMedia   = R({
  id: 'smg:co49346', _source: 'smg', title: 'Amazon tumbler',
  smg: { manifest: 'https://collection.sciencemuseumgroup.org.uk/iiif/objects/co49346', thumbnail: 'https://coimages.sciencemuseumgroup.org.uk/a.jpg' },
})
const nhm = R({ id: 'nhm:1', _source: 'nhm', title: 'Plantago', nhm: { iiifInfo: 'https://data.nhm.ac.uk/media/5b3f91d5/info.json', thumbnail: 'https://data.nhm.ac.uk/media/5b3f91d5/thumbnail' } })
const bod = R({ id: 'bod:1', _source: 'bodleian', bodleian: { shelfmark: 'MS. Top. gen. c. 24', manifest: 'https://iiif.bodleian.ox.ac.uk/iiif/manifest/d16a.json' } })
const topLevel = R({ id: 'x:1', _source: 'x', title: 'Top', manifest: 'https://example.org/iiif/manifest/abc.json' })

describe('collectIiifEntries', () => {
  it('prefers a manifest, falls back to an Image API service, skips records with neither', () => {
    const entries = collectIiifEntries([vamFull, vamBaseOnly, vamNothing, smgNoMedia, smgMedia, nhm, bod, topLevel])
    expect(entries.map(e => [e.kind, e.url])).toEqual([
      ['manifest', 'https://iiif.vam.ac.uk/collections/O1/manifest.json'],
      ['image',    'https://framemark.vam.ac.uk/collections/2016JG8103'],       // base without the trailing slash
      ['manifest', 'https://collection.sciencemuseumgroup.org.uk/iiif/objects/co49346'],
      ['image',    'https://data.nhm.ac.uk/media/5b3f91d5'],
      ['manifest', 'https://iiif.bodleian.ox.ac.uk/iiif/manifest/d16a.json'],
      ['manifest', 'https://example.org/iiif/manifest/abc.json'],
    ])
  })

  it('carries the record, its index and a display source name', () => {
    const [e] = collectIiifEntries([smgNoMedia, smgMedia])
    expect(e.record).toBe(smgMedia)
    expect(e.recordIndex).toBe(1)
    expect(e.source).toBe('Science Museum Group')
  })

  it('disambiguates repeated titles with the accession number', () => {
    const entries = collectIiifEntries([vamFull, vamBaseOnly])
    expect(entries[0].label).toBe('Stone Henge (800-1888)')
    expect(entries[1].label).toBe('Stone Henge (E.1-1900)')
  })

  it('labels by shelfmark when there is no title, and de-duplicates urls', () => {
    const entries = collectIiifEntries([bod, bod])
    expect(entries).toHaveLength(1)
    expect(entries[0].label).toBe('MS. Top. gen. c. 24')
  })

  it('does not cap the list at 100', () => {
    const many = Array.from({ length: 150 }, (_, i) => R({ id: `v:${i}`, _source: 'vam', title: `T${i}`, vam: { iiifImageBase: `https://framemark.vam.ac.uk/collections/${i}/` } }))
    expect(collectIiifEntries(many)).toHaveLength(150)
  })
})

describe('sourceName', () => {
  it('maps known _source keys and capitalises unknown ones', () => {
    expect(sourceName('vam')).toBe('V&A')
    expect(sourceName('bodleian')).toBe('Bodleian')
    expect(sourceName('europeana')).toBe('Europeana')
    expect(sourceName('frobnicator')).toBe('Frobnicator')
    expect(sourceName(undefined)).toBe('Unknown source')
  })
})
