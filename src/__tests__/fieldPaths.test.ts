import { describe, it, expect } from 'vitest'
import { collectFieldPaths } from '../utils/fieldPaths'
import type { UnifiedRecord } from '../types/UnifiedRecord'

const R = (o: Record<string, unknown>) => o as unknown as UnifiedRecord

const vam = (i: number) => R({
  id: `vam:${i}`, _source: 'vam', _sourceUrl: 'https://x', title: `T${i}`, subject: ['a', 'b'], title_reconciled: null,
  vam: { objectType: 'Teapot', thumbnail: `https://framemark.vam.ac.uk/collections/${i}/full/!100,100/0/default.jpg`, iiifImageBase: `https://framemark.vam.ac.uk/collections/${i}/`, onDisplay: true },
})
const eur = R({ id: 'eur:1', _source: 'europeana', title: 'E', europeana: { thumbnail: 'https://api.europeana.eu/thumbnail/v2/url.json?uri=x&type=IMAGE', rights: 'cc' } })

describe('collectFieldPaths', () => {
  it('lists top-level scalars and arrays, then one level into namespace objects', () => {
    const paths = collectFieldPaths([vam(1), vam(2), eur]).map(f => f.path)
    expect(paths).toEqual([
      'id', 'subject', 'title',
      'europeana.rights', 'europeana.thumbnail',
      'vam.iiifImageBase', 'vam.objectType', 'vam.onDisplay', 'vam.thumbnail',
    ])
  })

  it('skips underscore keys and *_reconciled fields', () => {
    const paths = collectFieldPaths([vam(1)]).map(f => f.path)
    expect(paths).not.toContain('_source')
    expect(paths).not.toContain('_sourceUrl')
    expect(paths).not.toContain('title_reconciled')
  })

  it('classifies kinds and counts population over all records', () => {
    const by = Object.fromEntries(collectFieldPaths([vam(1), vam(2), eur]).map(f => [f.path, f]))
    expect(by['subject'].kind).toBe('array')
    expect(by['title'].kind).toBe('scalar')
    expect(by['vam.thumbnail'].kind).toBe('image')
    expect(by['vam.iiifImageBase'].kind).toBe('image')     // Image API service → still an image
    expect(by['europeana.thumbnail'].kind).toBe('image')
    expect(by['vam.objectType'].count).toBe(2)
    expect(by['europeana.thumbnail'].count).toBe(1)
    expect(by['title'].count).toBe(3)
  })

  it('discovers keys from every source, not just the first record', () => {
    const paths = collectFieldPaths([vam(1), eur]).map(f => f.path)
    expect(paths).toContain('europeana.thumbnail')
  })

  it('returns [] for no records', () => {
    expect(collectFieldPaths([])).toEqual([])
  })
})
