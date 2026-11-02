import { describe, it, expect } from 'vitest'
import { recordsWithField, collectImageFieldCandidates, IMAGE_KEYS } from '../utils/imageFields'
import type { UnifiedRecord } from '../types/UnifiedRecord'

const R = (o: Record<string, unknown>) => o as unknown as UnifiedRecord

// Mixed V&A + Europeana result set, as in the workshop session that prompted this
const vam = (i: number) => R({
  id: `vam-${i}`, title: `V&A ${i}`, _source: 'vam', description: 'd',
  vam: { thumbnail: `https://framemark.vam.ac.uk/collections/${i}/full/!100,100/0/default.jpg`, iiifImageBase: 'https://framemark.vam.ac.uk/x' },
})
const eur = (i: number, withThumb = true) => R({
  id: `eur-${i}`, title: `Europeana ${i}`, _source: 'europeana',
  europeana: { thumbnail: withThumb ? `https://api.europeana.eu/thumbnail/v3/200/${i}` : '', shownAt: `https://example.org/${i}` },
})
const mixed = [vam(1), vam(2), vam(3), eur(1), eur(2), eur(3, false)]

describe('recordsWithField', () => {
  it('keeps only records with a non-empty string at the path', () => {
    const out = recordsWithField(mixed, 'europeana.thumbnail')
    expect(out.map(r => r.id)).toEqual(['eur-1', 'eur-2'])
  })
  it('returns everything for an empty path and nothing for an unknown one', () => {
    expect(recordsWithField(mixed, '')).toHaveLength(6)
    expect(recordsWithField(mixed, 'bodleian.thumbnail')).toHaveLength(0)
  })
})

describe('collectImageFieldCandidates', () => {
  it('keeps the broad key match (url/href/src are still image candidates)', () => {
    expect(IMAGE_KEYS.test('shownAt')).toBe(false)
    expect(IMAGE_KEYS.test('url')).toBe(true)
  })

  it('groups namespaced thumbnail fields as image fields with populations over ALL records', () => {
    const { imageFields, otherFields } = collectImageFieldCandidates(mixed)
    const byPath = Object.fromEntries(imageFields.map(f => [f.path, f.count]))
    expect(byPath['vam.thumbnail']).toBe(3)
    expect(byPath['europeana.thumbnail']).toBe(2)       // eur-3 has an empty thumbnail
    expect(byPath['vam.iiifImageBase']).toBe(3)
    expect(imageFields.map(f => f.path)).not.toContain('europeana.shownAt')
    expect(otherFields).toContain('title')
    expect(otherFields).toContain('description')
    expect(otherFields).not.toContain('vam.thumbnail')
  })

  it('orders image fields by population, then name', () => {
    const { imageFields } = collectImageFieldCandidates(mixed)
    const counts = imageFields.map(f => f.count)
    expect(counts).toEqual([...counts].sort((a, b) => b - a))
    expect(imageFields[0].path).toBe('vam.iiifImageBase')   // 3, alphabetical before vam.thumbnail
  })

  it('promotes a top-level key whose value is a data:image URL or an image URL', () => {
    const local = [R({ id: 'f1', _source: 'local', content: 'data:image/png;base64,AAAA', contentType: 'image', filename: 'a.png' })]
    const { imageFields, otherFields } = collectImageFieldCandidates(local)
    expect(imageFields.map(f => f.path)).toEqual(['content'])
    expect(otherFields).toContain('filename')

    const web = [R({ id: 'w', _source: 'x', pic: 'https://example.org/a.jpeg', page: 'https://example.org/a.html', iiif: 'https://x/iiif/2/abc/info.json' })]
    expect(collectImageFieldCandidates(web).imageFields.map(f => f.path).sort()).toEqual(['iiif', 'pic'])
  })

  it('returns empty lists for no records', () => {
    expect(collectImageFieldCandidates([])).toEqual({ imageFields: [], otherFields: [] })
  })

  it('skips underscore keys and non-string namespaced values', () => {
    const recs = [R({ id: 'a', _source: 's', _pid: 'x', ns: { thumbnail: 'https://a/b.png', images: ['x'], count: 3 } })]
    const { imageFields, otherFields } = collectImageFieldCandidates(recs)
    expect(imageFields.map(f => f.path)).toEqual(['ns.thumbnail'])
    expect(otherFields).toEqual(['id', 'ns'])
  })
})
